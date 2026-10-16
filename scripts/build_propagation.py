#!/usr/bin/env python3
"""
build_propagation.py — the two new aggregates for Visualizations 4 and 5.

Run it after (or instead of) build_data.py; it reuses that script's cleaned
views so there is one definition of "an operated flight".

    python scripts/build_propagation.py

Outputs into data/processed/:

    propagation.json   leg index x first-leg outcome x haul   -> Visualization 4
    turnarounds.json   airport (x carrier) turnaround summary -> Visualization 5
    sequence_diag.json how many aircraft-days were usable     -> Discussion/limitations

Both replace the previous distance_delay.json and aircraft_chains.json as the
primary sources for views 4 and 5. aircraft_chains.json stays, but becomes a
drill-down layer rather than a standalone visualization.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_data import connect, write, CARRIER_NAMES, ROOT  # noqa: E402


# ---------------------------------------------------------------------------
# Shared aircraft-day sequence view
# ---------------------------------------------------------------------------
#
# Legs are ordered by scheduled local departure time. BTS publishes local
# clock times while airline operations run on UTC, so in principle a westbound
# leg could appear to depart before the leg that fed it. In US domestic
# service it essentially cannot: the clock only runs backwards by the time-zone
# difference (at most 3 hours within the contiguous states), and every route
# that crosses that many zones has a block time far longer than 3 hours.
#
# The continuity test below is the real guard. If the ordering were ever wrong,
# the previous destination would stop matching the next origin and the whole
# aircraft-day is dropped. So the risk is not a mis-drawn sequence; it is a
# silent loss of some aircraft-days. build_sequence_diagnostics() measures
# exactly how many, so the number can go in the report rather than being
# assumed away.

SEQUENCE_SQL = """
    CREATE OR REPLACE VIEW legs AS
    SELECT
        FlightDate,
        tail,
        carrier,
        Origin,
        Dest,
        crs_dep_hhmm,
        crs_arr_hhmm,
        dep_delay,
        arr_delay,
        distance,
        sched_min,

        -- hhmm integer -> minutes past local midnight (2400 is a legal value)
        CAST(crs_dep_hhmm AS INTEGER) // 100 % 24 * 60
            + CAST(crs_dep_hhmm AS INTEGER) % 100          AS dep_min,
        CAST(crs_arr_hhmm AS INTEGER) // 100 % 24 * 60
            + CAST(crs_arr_hhmm AS INTEGER) % 100          AS arr_min,

        ROW_NUMBER() OVER w  AS leg,
        LAG(Dest)     OVER w AS prev_dest,
        LEAD(Origin)  OVER w AS next_origin,
        LEAD(dep_delay)   OVER w AS next_dep_delay,
        LEAD(crs_dep_hhmm) OVER w AS next_crs_dep_hhmm
    FROM {src}
    WHERE tail IS NOT NULL
      AND TRIM(CAST(tail AS VARCHAR)) <> ''
      AND crs_dep_hhmm IS NOT NULL
      AND crs_arr_hhmm IS NOT NULL
    WINDOW w AS (
        PARTITION BY FlightDate, tail
        ORDER BY crs_dep_hhmm, Origin, Dest
    )
"""

# Aircraft-days that form an unbroken A->B->C chain and have enough legs
# to say anything about propagation.
DAYS_SQL = """
    CREATE OR REPLACE VIEW aircraft_days AS
    SELECT
        FlightDate,
        tail,
        ANY_VALUE(carrier) AS carrier,
        COUNT(*)           AS n_legs,
        SUM(CASE WHEN leg = 1 THEN 0
                 WHEN prev_dest = Origin THEN 0
                 ELSE 1 END) AS breaks,
        MAX(CASE WHEN leg = 1 THEN arr_delay END) AS leg1_delay,
        MEDIAN(distance)   AS med_distance
    FROM legs
    GROUP BY FlightDate, tail
"""


# Some versions of build_data.py expose only the departure *hour* on the `f`
# view, not the raw scheduled hhmm values. Leg ordering needs minutes, and the
# turnaround view needs a scheduled arrival as well, so when those columns are
# absent this rebuilds an equivalent source over `raw`. The WHERE clause is the
# same one `ops` applies, kept literally identical so the two definitions of
# "an operated flight" cannot drift apart.
OPS_FALLBACK_SQL = """
    CREATE OR REPLACE VIEW ops_seq AS
    SELECT
        FlightDate,
        Reporting_Airline        AS carrier,
        Tail_Number              AS tail,
        Origin,
        Dest,
        TRY_CAST(CRSDepTime     AS INTEGER) AS crs_dep_hhmm,
        TRY_CAST(CRSArrTime     AS INTEGER) AS crs_arr_hhmm,
        TRY_CAST(DepDelay       AS DOUBLE)  AS dep_delay,
        TRY_CAST(ArrDelay       AS DOUBLE)  AS arr_delay,
        TRY_CAST(Distance       AS DOUBLE)  AS distance,
        TRY_CAST(CRSElapsedTime AS DOUBLE)  AS sched_min
    FROM raw
    WHERE COALESCE(TRY_CAST(Cancelled AS DOUBLE), 0) <> 1
      AND COALESCE(TRY_CAST(Diverted  AS DOUBLE), 0) <> 1
      AND TRY_CAST(ArrDelay AS DOUBLE) IS NOT NULL
"""


def prepare(con):
    have = {r[0] for r in con.execute("DESCRIBE ops").fetchall()}
    needed = {"crs_dep_hhmm", "crs_arr_hhmm"}

    if needed <= have:
        src = "ops"
    else:
        con.execute(OPS_FALLBACK_SQL)
        src = "ops_seq"
        print("  note: build_data.py's `ops` view has no "
              + ", ".join(sorted(needed - have))
              + " — rebuilding an equivalent source from `raw`.")

    con.execute(SEQUENCE_SQL.format(src=src))
    con.execute(DAYS_SQL)
    con.execute("""
        CREATE OR REPLACE VIEW usable_days AS
        SELECT * FROM aircraft_days
        WHERE breaks = 0 AND n_legs >= 3 AND leg1_delay IS NOT NULL
    """)


# ---------------------------------------------------------------------------
# Diagnostics — the number that goes in the limitations section
# ---------------------------------------------------------------------------

def build_sequence_diagnostics(con):
    d = con.execute("""
        SELECT
            COUNT(*)                                            AS aircraft_days,
            SUM(CASE WHEN breaks > 0 THEN 1 ELSE 0 END)         AS days_with_breaks,
            SUM(CASE WHEN n_legs < 3 THEN 1 ELSE 0 END)         AS days_under_3_legs,
            SUM(n_legs)                                         AS legs_total,
            SUM(CASE WHEN breaks > 0 THEN n_legs ELSE 0 END)    AS legs_in_broken_days
        FROM aircraft_days
    """).df().iloc[0].to_dict()

    # Independent sanity check on the ordering, using no external time-zone table.
    # scheduled arrival - scheduled departure - scheduled block time, in minutes,
    # recovers the implied UTC offset between the two airports. If our minute
    # arithmetic is right, almost every leg should land within a few minutes of a
    # whole hour.
    tz = con.execute("""
        WITH x AS (
            SELECT ((arr_min - dep_min - sched_min) % 1440 + 1440) % 1440 AS off
            FROM legs
            WHERE sched_min IS NOT NULL
        ),
        y AS (
            SELECT CASE WHEN off > 720 THEN off - 1440 ELSE off END AS offset_min
            FROM x
        )
        SELECT
            COUNT(*) AS n,
            AVG(CASE WHEN ABS(offset_min - ROUND(offset_min / 60.0) * 60) <= 5
                     THEN 1.0 ELSE 0 END) AS share_near_whole_hour,
            MIN(offset_min) AS min_offset,
            MAX(offset_min) AS max_offset
        FROM y
    """).df().iloc[0].to_dict()

    usable = con.execute("SELECT COUNT(*) FROM usable_days").fetchone()[0]

    out = {k: (None if v is None else float(v)) for k, v in d.items()}
    out["usable_days"] = int(usable)
    out["share_days_dropped_for_breaks"] = round(
        out["days_with_breaks"] / max(out["aircraft_days"], 1), 4)
    out["share_legs_in_broken_days"] = round(
        out["legs_in_broken_days"] / max(out["legs_total"], 1), 4)
    out["tz_check"] = {k: (None if v is None else float(v)) for k, v in tz.items()}

    print(f"\n  aircraft-days total        {out['aircraft_days']:,.0f}")
    print(f"  dropped (broken sequence)  {out['days_with_breaks']:,.0f}"
          f"  ({out['share_days_dropped_for_breaks']*100:.1f}%)")
    print(f"  usable for propagation     {out['usable_days']:,}")
    print(f"  legs whose implied offset is within 5 min of a whole hour: "
          f"{tz['share_near_whole_hour']*100:.1f}%"
          f"  (range {tz['min_offset']:.0f} to {tz['max_offset']:.0f} min)")

    write("sequence_diag.json", out)
    return out


# ---------------------------------------------------------------------------
# Visualization 4 — does delay actually accumulate leg over leg?
# ---------------------------------------------------------------------------

def build_propagation(con, max_leg=8, min_cell=200):
    """
    For every usable aircraft-day, follow median arrival delay across leg index,
    conditioned on how the day's FIRST leg ended.

    If delay were an external shock, every group would sit at the same level and
    stay flat. If it is inherited down the rotation, groups that started late
    stay above the others — and the gap between them is the quantity of interest:
    it shows how much of a morning delay is still present by evening.

    `haul` splits each curve by the day's median leg distance, which is where
    the old distance question now lives: short-haul rotations fly more legs with
    less scheduled ground time between them.
    """
    df = con.execute(f"""
        WITH j AS (
            SELECT
                l.leg,
                l.arr_delay,
                d.carrier,
                CASE
                    WHEN d.leg1_delay <  15 THEN 'on time'
                    WHEN d.leg1_delay <  30 THEN 'late 15-29'
                    WHEN d.leg1_delay <  60 THEN 'late 30-59'
                    ELSE                         'late 60+'
                END AS start_group,
                CASE WHEN d.med_distance < 700 THEN 'short' ELSE 'long' END AS haul
            FROM legs l
            JOIN usable_days d
              ON d.FlightDate = l.FlightDate
             AND d.tail       = l.tail
            WHERE l.leg <= {max_leg}
        ),
        stacked AS (
            SELECT leg, arr_delay, start_group, haul FROM j
            UNION ALL
            SELECT leg, arr_delay, start_group, 'all' AS haul FROM j
        )
        SELECT
            start_group,
            haul,
            leg,
            COUNT(*)                                  AS n,
            ROUND(MEDIAN(arr_delay), 2)               AS median,
            ROUND(QUANTILE_CONT(arr_delay, 0.25), 2)  AS q25,
            ROUND(QUANTILE_CONT(arr_delay, 0.75), 2)  AS q75,
            ROUND(QUANTILE_CONT(arr_delay, 0.90), 2)  AS p90,
            ROUND(AVG(CASE WHEN arr_delay >= 15 THEN 1.0 ELSE 0 END), 4) AS delay15_rate
        FROM stacked
        GROUP BY start_group, haul, leg
        HAVING COUNT(*) >= {min_cell}
        ORDER BY haul, start_group, leg
    """).df()

    write("propagation.json", json.loads(df.to_json(orient="records")))

    head = df[(df.haul == "all") & (df.leg.isin([1, 2, 4, 6]))]
    if not head.empty:
        print("\n  median arrival delay by leg (all hauls):")
        piv = head.pivot(index="start_group", columns="leg", values="median")
        for grp, row in piv.iterrows():
            cells = "  ".join(
                f"leg{int(c)} {v:+6.1f}" for c, v in row.items() if v == v)
            print(f"    {grp:<12s} {cells}")
    return df



# ---------------------------------------------------------------------------
# Visualization 4 — where each aircraft's delay state goes, leg by leg
# ---------------------------------------------------------------------------

def build_transitions(con, n_cols=5):
    """
    Counts of aircraft moving between delay states from one leg to the next.

    The median curves say how far the middle aircraft falls back. They cannot
    say whether that happened because every aircraft recovered a little or
    because half recovered fully and half stayed late — two pictures with very
    different meanings for the argument. The transition counts can.

    Restricted to rotations of at least n_cols legs so the same aircraft appear
    in every column. Without that the population shrinks column by column as
    short rotations end, and ribbons would appear to lose mass for a reason
    that has nothing to do with delay.
    """
    con.execute(f"""
        CREATE OR REPLACE VIEW long_days AS
        SELECT * FROM usable_days WHERE n_legs >= {n_cols}
    """)

    df = con.execute(f"""
        WITH s AS (
            SELECT
                l.FlightDate,
                l.tail,
                l.leg,
                CASE
                    WHEN l.arr_delay < 15 THEN 0
                    WHEN l.arr_delay < 30 THEN 1
                    WHEN l.arr_delay < 60 THEN 2
                    ELSE 3
                END AS st,
                CASE WHEN d.med_distance < 700 THEN 'short' ELSE 'long' END AS haul
            FROM legs l
            JOIN long_days d
              ON d.FlightDate = l.FlightDate AND d.tail = l.tail
            WHERE l.leg <= {n_cols}
        ),
        tagged AS (
            SELECT *, FIRST_VALUE(st) OVER (
                PARTITION BY FlightDate, tail ORDER BY leg
            ) AS start_state
            FROM s
        ),
        p AS (
            SELECT
                haul, start_state,
                leg AS from_leg,
                st  AS from_state,
                LEAD(st) OVER (
                    PARTITION BY FlightDate, tail ORDER BY leg
                ) AS to_state
            FROM tagged
        ),
        stacked AS (
            SELECT haul, start_state, from_leg, from_state, to_state FROM p
            UNION ALL
            SELECT 'all' AS haul, start_state, from_leg, from_state, to_state FROM p
        )
        SELECT haul, start_state, from_leg, from_state, to_state, COUNT(*) AS n
        FROM stacked
        WHERE to_state IS NOT NULL
        GROUP BY haul, start_state, from_leg, from_state, to_state
        ORDER BY haul, start_state, from_leg, from_state, to_state
    """).df()

    rotations = con.execute("SELECT COUNT(*) FROM long_days").fetchone()[0]

    write("transitions.json", {
        "n_cols": n_cols,
        "rotations": int(rotations),
        "note": (f"Rotations of at least {n_cols} legs, so the same aircraft "
                 "appear in every column."),
        "rows": json.loads(df.to_json(orient="records")),
    })

    a = df[df.haul == "all"]
    if not a.empty:
        print(f"\n  {rotations:,} rotations of {n_cols}+ legs")
        for st, name in [(3, "60+ min late"), (2, "30-59 min late")]:
            coh = a[a.start_state == st]
            n0 = coh[coh.from_leg == 1]["n"].sum()
            if not n0:
                continue
            last = coh[coh.from_leg == n_cols - 1]
            back = last[last.to_state == 0]["n"].sum()
            still = last[last.to_state >= 2]["n"].sum()
            print(f"  started {name}: by leg {n_cols}, {back / n0:.0%} are back "
                  f"on time and {still / n0:.0%} are still 30+ late")
    return df

# ---------------------------------------------------------------------------
# Visualization 5 — which airports absorb inherited delay, and which pass it on?
# ---------------------------------------------------------------------------

def build_turnarounds(con, min_total=1000, min_carrier=400, min_late=200):
    """
    A turnaround is one aircraft landing at an airport and departing again on its
    next leg: the delay it arrived with, and the delay it left with.

    The headline measure is conditioned on the aircraft ACTUALLY ARRIVING LATE.
    The unconditioned version is confounded: US schedules carry enough padding
    that the median flight lands early, while pushback is close to on time, so
    "departed later than it arrived" is true at nearly every airport for
    reasons that have nothing to do with delay propagation. Restricting to
    arrivals of 15 minutes or more removes that, because inbound padding has
    already been used up — what remains is a real question, namely how much of
    a late arrival an airport manages to hand back before the aircraft leaves.

    Both measures are exported. The conditioned one drives the default view;
    the unconditioned one is kept so the chart can show why it is the wrong
    thing to read.

    Scheduled ground time is the mechanism worth showing alongside: it is the
    slack available to absorb a late arrival, and both timestamps are recorded
    at the same airport, so no time-zone conversion is involved.
    """
    con.execute("""
        CREATE OR REPLACE VIEW turns AS
        SELECT
            Dest AS airport,
            carrier,
            arr_delay      AS in_delay,
            next_dep_delay AS out_delay,
            next_dep_delay - arr_delay AS retained,
            ((
                (CAST(next_crs_dep_hhmm AS INTEGER) // 100 % 24 * 60
                 + CAST(next_crs_dep_hhmm AS INTEGER) % 100) - arr_min
            ) % 1440 + 1440) % 1440 AS ground_min
        FROM legs
        WHERE next_origin = Dest
          AND next_dep_delay IS NOT NULL
          AND arr_delay IS NOT NULL
    """)

    # 20 minutes is below any real turn; past 8 hours the aircraft is parked,
    # not turning, and the pair says nothing about delay being handed forward.
    con.execute("""
        CREATE OR REPLACE VIEW turns_ok AS
        SELECT * FROM turns WHERE ground_min BETWEEN 20 AND 480
    """)

    # One aggregate expression list, used for the airport level and the
    # airport x carrier level, so the two can never drift apart.
    AGG = """
               COUNT(*)                                         AS n,
               MEDIAN(in_delay)                                 AS in_med,
               MEDIAN(out_delay)                                AS out_med,
               MEDIAN(retained)                                 AS retained_med,
               MEDIAN(ground_min)                               AS ground_med,
               QUANTILE_CONT(in_delay, 0.9)                     AS in_p90,
               QUANTILE_CONT(out_delay, 0.9)                    AS out_p90,
               AVG(CASE WHEN retained > 0 THEN 1.0 ELSE 0 END)  AS share_amplified,

               -- conditioned on the aircraft actually arriving late
               COUNT(*) FILTER (WHERE in_delay >= 15)           AS n_late,
               MEDIAN(in_delay)  FILTER (WHERE in_delay >= 15)  AS late_in_med,
               MEDIAN(out_delay) FILTER (WHERE in_delay >= 15)  AS late_out_med,
               MEDIAN(in_delay - out_delay)
                                 FILTER (WHERE in_delay >= 15)  AS recovered_med,
               MEDIAN(ground_min) FILTER (WHERE in_delay >= 15) AS late_ground_med,
               AVG(CASE WHEN out_delay >= 15 THEN 1.0 ELSE 0 END)
                                 FILTER (WHERE in_delay >= 15)  AS still_late_share
    """

    df = con.execute(f"""
        WITH per_airport AS (
            SELECT airport, 'ALL' AS carrier, {AGG}
            FROM turns_ok GROUP BY airport
            HAVING COUNT(*) >= {min_total}
               AND COUNT(*) FILTER (WHERE in_delay >= 15) >= {min_late}
        ),
        per_carrier AS (
            SELECT airport, carrier, {AGG}
            FROM turns_ok GROUP BY airport, carrier
            HAVING COUNT(*) >= {min_carrier}
               AND COUNT(*) FILTER (WHERE in_delay >= 15) >= {min_late}
        )
        SELECT * FROM per_airport
        UNION ALL
        SELECT pc.* FROM per_carrier pc
        JOIN (SELECT airport FROM per_airport) a ON a.airport = pc.airport
        ORDER BY airport, carrier
    """).df()

    for c in ["in_med", "out_med", "retained_med", "ground_med", "in_p90",
              "out_p90", "late_in_med", "late_out_med", "recovered_med",
              "late_ground_med"]:
        df[c] = df[c].round(2)
    for c in ["share_amplified", "still_late_share"]:
        df[c] = df[c].round(4)
    df["carrier_name"] = df["carrier"].map(CARRIER_NAMES).fillna(df["carrier"])

    write("turnarounds.json", json.loads(df.to_json(orient="records")))

    a = df[df.carrier == "ALL"]
    if not a.empty:
        print(f"\n  {len(a)} airports with enough turnarounds")

        # The unconditioned measure, shown only so the confound is visible.
        u = a.sort_values("retained_med")
        print("  [unconditioned, confounded by inbound schedule padding]")
        print("    kept least:  " + ", ".join(
            f"{r.airport} {r.retained_med:+.0f}" for r in u.head(4).itertuples()))
        print("    kept most:   " + ", ".join(
            f"{r.airport} {r.retained_med:+.0f}" for r in u.tail(4).itertuples()))

        c = a.sort_values("recovered_med", ascending=False)
        print("  [conditioned on arriving 15+ min late — the headline measure]")
        print("    recovers most: " + ", ".join(
            f"{r.airport} {r.recovered_med:+.0f}" for r in c.head(5).itertuples()))
        print("    recovers least: " + ", ".join(
            f"{r.airport} {r.recovered_med:+.0f}" for r in c.tail(5).itertuples()))
        print(f"    spread across airports: {c.recovered_med.min():+.0f} to "
              f"{c.recovered_med.max():+.0f} min "
              f"(median {c.recovered_med.median():+.0f})")
        print(f"    still 15+ late on departure: "
              f"{c.still_late_share.min():.0%} to {c.still_late_share.max():.0%}")
        print(f"  median scheduled ground time: {a.ground_med.median():.0f} min "
              f"overall, {a.late_ground_med.median():.0f} min after a late arrival")
    return df


# ---------------------------------------------------------------------------

def build_ground_bins(con):
    """
    Recovery by how much ground time the schedule allowed, measured over
    turnarounds rather than over airports.

    The airport-level scatter asks the same question but answers it through a
    couple of hundred noisy points, each averaging very different turnarounds.
    Binning the turnarounds themselves puts millions of observations behind
    every bin, which is where a mechanism this weak per-airport becomes
    visible.
    """
    df = con.execute("""
        WITH b AS (
            SELECT
                CASE
                    WHEN ground_min <  35 THEN '<35'
                    WHEN ground_min <  45 THEN '35-44'
                    WHEN ground_min <  55 THEN '45-54'
                    WHEN ground_min <  70 THEN '55-69'
                    WHEN ground_min <  90 THEN '70-89'
                    WHEN ground_min < 120 THEN '90-119'
                    ELSE '120+'
                END AS bin,
                CASE
                    WHEN ground_min <  35 THEN 1
                    WHEN ground_min <  45 THEN 2
                    WHEN ground_min <  55 THEN 3
                    WHEN ground_min <  70 THEN 4
                    WHEN ground_min <  90 THEN 5
                    WHEN ground_min < 120 THEN 6
                    ELSE 7
                END AS ord,
                in_delay, out_delay, in_delay - out_delay AS recovered
            FROM turns_ok
            WHERE in_delay >= 15
        )
        SELECT
            bin, ord,
            COUNT(*)                                 AS n,
            ROUND(MEDIAN(in_delay), 2)               AS in_med,
            ROUND(MEDIAN(out_delay), 2)              AS out_med,
            ROUND(MEDIAN(recovered), 2)              AS recovered_med,
            ROUND(QUANTILE_CONT(recovered, 0.25), 2) AS q25,
            ROUND(QUANTILE_CONT(recovered, 0.75), 2) AS q75,
            ROUND(AVG(CASE WHEN out_delay >= 15 THEN 1.0 ELSE 0 END), 4)
                                                     AS still_late_share
        FROM b
        GROUP BY bin, ord
        ORDER BY ord
    """).df()

    write("ground_bins.json", json.loads(df.to_json(orient="records")))

    if not df.empty:
        print(f"\n  recovery by scheduled ground time, over "
              f"{df.n.sum():,} late-arrival turnarounds:")
        for r in df.itertuples():
            print(f"    {r.bin:>7s} min  n={r.n:>9,}  recovered {r.recovered_med:+6.1f}"
                  f"  still 15+ late {r.still_late_share:.0%}")
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"))
    args = ap.parse_args()

    raw_glob = os.path.join(args.raw, "*.csv")
    print(f"reading {raw_glob}")

    con = connect(raw_glob)
    prepare(con)

    build_sequence_diagnostics(con)
    build_propagation(con)
    build_transitions(con)
    build_turnarounds(con)
    build_ground_bins(con)

    print("\ndone.")


if __name__ == "__main__":
    main()