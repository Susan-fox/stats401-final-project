#!/usr/bin/env python3
"""
build_data.py — reduce the raw BTS On-Time Performance CSVs into small JSON
files that the browser can load.

Usage:
    python scripts/build_data.py
    python scripts/build_data.py --raw some/dir

Outputs (all in data/processed/):
    summary.json
    airports.json
    hour_dow.json
    causes.json
    distance_delay.json
    aircraft_chains.json
"""

import argparse
import json
import os
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb is not installed. Run: pip install duckdb")


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

OUT = os.path.join(ROOT, "data", "processed")
AIRPORT_META = os.path.join(ROOT, "data", "airports_meta.csv")


# ============================================================
# Columns read from BTS raw files
# ============================================================

COLS = [
    "Year",
    "Month",
    "DayOfWeek",
    "FlightDate",

    "Reporting_Airline",
    "DOT_ID_Reporting_Airline",
    "Tail_Number",

    "Origin",
    "Dest",
    "OriginCityName",
    "OriginStateName",

    "CRSDepTime",
    "DepDelay",

    "CRSArrTime",
    "ArrDelay",
    "ArrDel15",

    "Cancelled",
    "CancellationCode",
    "Diverted",

    "CRSElapsedTime",
    "ActualElapsedTime",

    "Distance",

    "CarrierDelay",
    "WeatherDelay",
    "NASDelay",
    "SecurityDelay",
    "LateAircraftDelay",
]


# ============================================================
# Carrier names
# ============================================================

CARRIER_NAMES = {
    "AA": "American",
    "AS": "Alaska",
    "B6": "JetBlue",
    "DL": "Delta",
    "F9": "Frontier",
    "G4": "Allegiant",
    "HA": "Hawaiian",
    "MQ": "Envoy",
    "NK": "Spirit",
    "OH": "PSA",
    "OO": "SkyWest",
    "QX": "Horizon",
    "UA": "United",
    "WN": "Southwest",
    "YX": "Republic",
    "9E": "Endeavor",
    "YV": "Mesa",
    "ZW": "Air Wisconsin",
    "C5": "CommuteAir",
    "PT": "Piedmont",
    "EV": "ExpressJet",
    "VX": "Virgin America",
    "US": "US Airways",
}


# ============================================================
# DuckDB connection and shared cleaned views
# ============================================================

def connect(raw_glob):

    con = duckdb.connect()

    cols_sql = ", ".join(f'"{c}"' for c in COLS)

    con.execute(f"""
        CREATE OR REPLACE VIEW raw AS

        SELECT
            {cols_sql}

        FROM read_csv_auto(
            '{raw_glob}',
            union_by_name=true,
            sample_size=-1
        )
    """)


    # --------------------------------------------------------
    # Cleaned flight view
    # --------------------------------------------------------

    con.execute("""
        CREATE OR REPLACE VIEW f AS

        SELECT

            Year,
            Month,
            DayOfWeek,
            FlightDate,

            Reporting_Airline AS carrier,

            DOT_ID_Reporting_Airline AS carrier_id,

            Tail_Number AS tail,

            Origin,
            Dest,

            TRY_CAST(CRSDepTime AS INTEGER) AS crs_dep_hhmm,

            TRY_CAST(CRSArrTime AS INTEGER) AS crs_arr_hhmm,


            CAST(
                TRY_CAST(CRSDepTime AS INTEGER) / 100
                AS INTEGER
            ) % 24 AS dep_hour,


            TRY_CAST(DepDelay AS DOUBLE) AS dep_delay,

            TRY_CAST(ArrDelay AS DOUBLE) AS arr_delay,

            TRY_CAST(Distance AS DOUBLE) AS distance,

            TRY_CAST(CRSElapsedTime AS DOUBLE) AS sched_min,

            TRY_CAST(ActualElapsedTime AS DOUBLE) AS actual_min,


            COALESCE(
                TRY_CAST(Cancelled AS DOUBLE),
                0
            ) = 1 AS cancelled,


            COALESCE(
                TRY_CAST(Diverted AS DOUBLE),
                0
            ) = 1 AS diverted,


            CancellationCode AS cancel_code,


            TRY_CAST(CarrierDelay AS DOUBLE)
                AS c_carrier,

            TRY_CAST(WeatherDelay AS DOUBLE)
                AS c_weather,

            TRY_CAST(NASDelay AS DOUBLE)
                AS c_nas,

            TRY_CAST(SecurityDelay AS DOUBLE)
                AS c_security,

            TRY_CAST(LateAircraftDelay AS DOUBLE)
                AS c_late_aircraft


        FROM raw
    """)


    # Flights that actually operated
    con.execute("""
        CREATE OR REPLACE VIEW ops AS

        SELECT *

        FROM f

        WHERE
            NOT cancelled
            AND NOT diverted
            AND arr_delay IS NOT NULL
    """)

    return con


# ============================================================
# JSON writer
# ============================================================

def write(name, obj):

    os.makedirs(OUT, exist_ok=True)

    path = os.path.join(OUT, name)

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(
            obj,
            fh,
            separators=(",", ":")
        )

    kb = os.path.getsize(path) / 1024

    print(
        f"  wrote {name:24s} "
        f"{kb:8.1f} KB"
    )


# ============================================================
# Visualization 0 / headline summary
# ============================================================

def build_summary(con):

    r = con.execute("""
        SELECT

            (
                SELECT COUNT(*)
                FROM f
            ) AS total_rows,

            (
                SELECT COUNT(*)
                FROM f
                WHERE cancelled
            ) AS cancelled,

            (
                SELECT COUNT(*)
                FROM f
                WHERE diverted
            ) AS diverted,

            (
                SELECT COUNT(*)
                FROM ops
            ) AS operated,

            (
                SELECT COUNT(*)
                FROM ops
                WHERE arr_delay >= 15
            ) AS delayed15,

            (
                SELECT MEDIAN(arr_delay)
                FROM ops
            ) AS median_delay,

            (
                SELECT AVG(arr_delay)
                FROM ops
            ) AS mean_delay,

            (
                SELECT COUNT(DISTINCT Origin)
                FROM f
            ) AS n_airports,

            (
                SELECT COUNT(DISTINCT carrier_id)
                FROM f
            ) AS n_carriers
    """).df().iloc[0].to_dict()


    causes = con.execute("""
        SELECT

            SUM(c_carrier)
                AS carrier,

            SUM(c_weather)
                AS weather,

            SUM(c_nas)
                AS nas,

            SUM(c_security)
                AS security,

            SUM(c_late_aircraft)
                AS late_aircraft

        FROM ops

        WHERE arr_delay >= 15
    """).df().iloc[0].to_dict()


    total = sum(
        v or 0
        for v in causes.values()
    ) or 1


    out = {
        k: (
            None
            if v is None
            else float(v)
        )
        for k, v in r.items()
    }


    out["cause_minutes"] = {
        k: float(v or 0)
        for k, v in causes.items()
    }


    out["cause_share"] = {
        k: round(
            (v or 0) / total,
            4
        )
        for k, v in causes.items()
    }


    out["cancel_rate"] = round(
        out["cancelled"]
        / max(out["total_rows"], 1),
        4
    )


    out["delay15_rate"] = round(
        out["delayed15"]
        / max(out["operated"], 1),
        4
    )


    ranked = sorted(
        out["cause_share"].items(),
        key=lambda kv: -kv[1]
    )


    out["largest_cause"] = ranked[0][0]


    print(
        "\n  >> largest reported cause: "
        f"{ranked[0][0]} "
        f"({ranked[0][1] * 100:.1f}% "
        "of delay minutes)"
    )


    print(
        "     full ranking: "
        + ", ".join(
            f"{k} {v * 100:.1f}%"
            for k, v in ranked
        )
        + "\n"
    )


    write(
        "summary.json",
        out
    )

    return out


# ============================================================
# Visualization 1 — airports
# ============================================================

def build_airports(con):

    con.execute(f"""
        CREATE OR REPLACE VIEW meta AS

        SELECT *

        FROM read_csv_auto(
            '{AIRPORT_META}',
            header=true
        )
    """)


    df = con.execute("""
        WITH dep AS (

            SELECT

                Origin AS iata,

                COUNT(*) AS flights,

                MEDIAN(arr_delay)
                    AS median_delay,

                QUANTILE_CONT(
                    arr_delay,
                    0.9
                ) AS p90_delay,

                AVG(
                    CASE
                        WHEN arr_delay >= 15
                        THEN 1.0
                        ELSE 0
                    END
                ) AS delay15_rate,

                SUM(c_late_aircraft)
                    AS m_late,

                SUM(
                    COALESCE(c_carrier, 0)
                    + COALESCE(c_weather, 0)
                    + COALESCE(c_nas, 0)
                    + COALESCE(c_security, 0)
                    + COALESCE(c_late_aircraft, 0)
                ) AS m_total

            FROM ops

            GROUP BY Origin
        ),


        cx AS (

            SELECT

                Origin AS iata,

                AVG(
                    CASE
                        WHEN cancelled
                        THEN 1.0
                        ELSE 0
                    END
                ) AS cancel_rate,

                COUNT(*) AS scheduled

            FROM f

            GROUP BY Origin
        )


        SELECT

            dep.iata,

            meta.name,

            meta.city,

            meta.lat,

            meta.lon,

            dep.flights,

            cx.scheduled,

            ROUND(
                dep.median_delay,
                2
            ) AS median_delay,

            ROUND(
                dep.p90_delay,
                2
            ) AS p90_delay,

            ROUND(
                dep.delay15_rate,
                4
            ) AS delay15_rate,

            ROUND(
                cx.cancel_rate,
                4
            ) AS cancel_rate,

            ROUND(
                dep.m_late
                / NULLIF(dep.m_total, 0),
                4
            ) AS late_aircraft_share


        FROM dep


        JOIN cx

            ON cx.iata = dep.iata


        LEFT JOIN meta

            ON meta.iata = dep.iata


        WHERE dep.flights >= 1000


        ORDER BY dep.flights DESC
    """).df()


    missing = (
        df[
            df["lat"].isna()
        ]["iata"]
        .tolist()
    )


    if missing:

        print(
            f"  !! {len(missing)} airports "
            "had no coordinate match: "
            + ", ".join(missing[:12])
            + (
                "..."
                if len(missing) > 12
                else ""
            )
        )


    df = df.dropna(
        subset=[
            "lat",
            "lon"
        ]
    )


    write(
        "airports.json",
        json.loads(
            df.to_json(
                orient="records"
            )
        )
    )

    return df


# ============================================================
# Visualization 2 — hour × weekday
# ============================================================

def build_hour_dow(
    con,
    top_n=30
):

    df = con.execute(f"""
        WITH top AS (

            SELECT Origin

            FROM ops

            GROUP BY Origin

            ORDER BY COUNT(*) DESC

            LIMIT {top_n}
        )


        SELECT

            'ALL' AS airport,

            dep_hour AS hour,

            DayOfWeek AS dow,

            COUNT(*) AS n,

            ROUND(
                MEDIAN(arr_delay),
                2
            ) AS median_delay,

            ROUND(
                AVG(
                    CASE
                        WHEN arr_delay >= 15
                        THEN 1.0
                        ELSE 0
                    END
                ),
                4
            ) AS delay15_rate


        FROM ops


        GROUP BY
            1,
            2,
            3


        UNION ALL


        SELECT

            Origin AS airport,

            dep_hour AS hour,

            DayOfWeek AS dow,

            COUNT(*) AS n,

            ROUND(
                MEDIAN(arr_delay),
                2
            ) AS median_delay,

            ROUND(
                AVG(
                    CASE
                        WHEN arr_delay >= 15
                        THEN 1.0
                        ELSE 0
                    END
                ),
                4
            ) AS delay15_rate


        FROM ops


        WHERE Origin IN (
            SELECT Origin
            FROM top
        )


        GROUP BY
            1,
            2,
            3


        ORDER BY
            airport,
            dow,
            hour
    """).df()


    write(
        "hour_dow.json",
        json.loads(
            df.to_json(
                orient="records"
            )
        )
    )

    return df


# ============================================================
# Visualization 3 — delay causes
# ============================================================

def build_causes(
    con,
    min_delayed=2000
):

    df = con.execute(f"""
        SELECT

            carrier,

            COUNT(*)
                AS delayed_flights,

            SUM(
                COALESCE(
                    c_carrier,
                    0
                )
            ) AS carrier_min,

            SUM(
                COALESCE(
                    c_weather,
                    0
                )
            ) AS weather_min,

            SUM(
                COALESCE(
                    c_nas,
                    0
                )
            ) AS nas_min,

            SUM(
                COALESCE(
                    c_security,
                    0
                )
            ) AS security_min,

            SUM(
                COALESCE(
                    c_late_aircraft,
                    0
                )
            ) AS late_aircraft_min


        FROM ops


        WHERE arr_delay >= 15


        GROUP BY carrier


        HAVING COUNT(*) >= {min_delayed}


        ORDER BY delayed_flights DESC
    """).df()


    parts = [
        "carrier_min",
        "weather_min",
        "nas_min",
        "security_min",
        "late_aircraft_min",
    ]


    df["total_min"] = (
        df[parts]
        .sum(axis=1)
    )


    for p in parts:

        df[
            p.replace(
                "_min",
                "_share"
            )
        ] = (
            df[p]
            / df["total_min"]
        ).round(4)


    df["name"] = (
        df["carrier"]
        .map(CARRIER_NAMES)
        .fillna(
            df["carrier"]
        )
    )


    write(
        "causes.json",
        json.loads(
            df.to_json(
                orient="records"
            )
        )
    )

    return df


# ============================================================
# Visualization 4 — distance vs delay
# ============================================================

def build_distance_delay(con):

    df = con.execute("""
        WITH b AS (

            SELECT

                CASE

                    WHEN distance < 250
                        THEN '0-250'

                    WHEN distance < 500
                        THEN '250-500'

                    WHEN distance < 750
                        THEN '500-750'

                    WHEN distance < 1000
                        THEN '750-1000'

                    WHEN distance < 1500
                        THEN '1000-1500'

                    WHEN distance < 2000
                        THEN '1500-2000'

                    WHEN distance < 2500
                        THEN '2000-2500'

                    ELSE '2500+'

                END AS bin,


                CASE

                    WHEN distance < 250
                        THEN 1

                    WHEN distance < 500
                        THEN 2

                    WHEN distance < 750
                        THEN 3

                    WHEN distance < 1000
                        THEN 4

                    WHEN distance < 1500
                        THEN 5

                    WHEN distance < 2000
                        THEN 6

                    WHEN distance < 2500
                        THEN 7

                    ELSE 8

                END AS ord,


                arr_delay,

                c_late_aircraft,

                c_carrier,

                c_weather,

                c_nas,

                c_security


            FROM ops


            WHERE distance IS NOT NULL
        )


        SELECT

            bin,

            ord,

            COUNT(*) AS n,


            ROUND(
                QUANTILE_CONT(
                    arr_delay,
                    0.25
                ),
                2
            ) AS q25,


            ROUND(
                MEDIAN(arr_delay),
                2
            ) AS median,


            ROUND(
                QUANTILE_CONT(
                    arr_delay,
                    0.75
                ),
                2
            ) AS q75,


            ROUND(
                QUANTILE_CONT(
                    arr_delay,
                    0.90
                ),
                2
            ) AS p90,


            ROUND(
                AVG(
                    CASE
                        WHEN arr_delay >= 15
                        THEN 1.0
                        ELSE 0
                    END
                ),
                4
            ) AS delay15_rate,


            ROUND(

                SUM(
                    COALESCE(
                        c_late_aircraft,
                        0
                    )
                )

                /

                NULLIF(

                    SUM(
                        COALESCE(
                            c_carrier,
                            0
                        )
                        + COALESCE(
                            c_weather,
                            0
                        )
                        + COALESCE(
                            c_nas,
                            0
                        )
                        + COALESCE(
                            c_security,
                            0
                        )
                        + COALESCE(
                            c_late_aircraft,
                            0
                        )
                    ),

                    0
                ),

                4

            ) AS late_aircraft_share


        FROM b


        GROUP BY
            bin,
            ord


        ORDER BY ord
    """).df()


    write(
        "distance_delay.json",
        json.loads(
            df.to_json(
                orient="records"
            )
        )
    )

    return df


# ============================================================
# Visualization 5 — aircraft delay chains
# ============================================================

def build_aircraft_chains(
    con,
    n_chains=12,
    min_legs=4,
    min_peak_delay=30
):

    """
    Build reproducible aircraft-day sequences.

    We do NOT manually choose one dramatic example.

    Candidate aircraft-days must:
        1. contain at least min_legs operated flights;
        2. have at least one arrival delay >= min_peak_delay;
        3. form a continuous airport sequence when sorted by
           scheduled departure time:
               previous destination == next origin.

    We keep the top n_chains ranked by:
        - number of legs,
        - maximum arrival delay,
        - date,
        - tail number.

    The visualization can therefore offer a dropdown between
    several reproducibly selected aircraft chains.
    """


    df = con.execute(f"""
        WITH base AS (

            SELECT

                CAST(
                    FlightDate
                    AS VARCHAR
                ) AS flight_date,

                tail,

                carrier,

                Origin AS origin,

                Dest AS dest,

                crs_dep_hhmm,

                crs_arr_hhmm,

                dep_delay,

                arr_delay,

                sched_min,

                actual_min,

                distance,


                ROW_NUMBER() OVER (

                    PARTITION BY
                        FlightDate,
                        tail

                    ORDER BY
                        crs_dep_hhmm,
                        Origin,
                        Dest

                ) AS leg_order,


                LAG(Dest) OVER (

                    PARTITION BY
                        FlightDate,
                        tail

                    ORDER BY
                        crs_dep_hhmm,
                        Origin,
                        Dest

                ) AS previous_dest


            FROM ops


            WHERE

                tail IS NOT NULL

                AND TRIM(
                    CAST(
                        tail
                        AS VARCHAR
                    )
                ) <> ''

                AND crs_dep_hhmm IS NOT NULL

        ),


        stats AS (

            SELECT

                flight_date,

                tail,

                COUNT(*) AS n_legs,

                MAX(arr_delay)
                    AS max_arr_delay,

                SUM(
                    CASE

                        WHEN leg_order = 1
                            THEN 0

                        WHEN previous_dest = origin
                            THEN 0

                        ELSE 1

                    END
                ) AS continuity_breaks


            FROM base


            GROUP BY
                flight_date,
                tail


            HAVING

                COUNT(*) >= {min_legs}

                AND MAX(arr_delay) >= {min_peak_delay}

        ),


        selected AS (

            SELECT

                flight_date,

                tail,

                n_legs,

                max_arr_delay,


                ROW_NUMBER() OVER (

                    ORDER BY

                        n_legs DESC,

                        max_arr_delay DESC,

                        flight_date,

                        tail

                ) AS chain_rank


            FROM stats


            WHERE continuity_breaks = 0


            QUALIFY chain_rank <= {n_chains}
        )


        SELECT

            selected.chain_rank,


            base.flight_date
                || ' / '
                || CAST(
                    base.tail
                    AS VARCHAR
                )
                AS chain_id,


            base.flight_date,

            CAST(
                base.tail
                AS VARCHAR
            ) AS tail,


            base.carrier,

            base.leg_order,

            base.origin,

            base.dest,


            base.crs_dep_hhmm
                AS scheduled_departure,


            base.crs_arr_hhmm
                AS scheduled_arrival,


            ROUND(
                base.dep_delay,
                1
            ) AS departure_delay,


            ROUND(
                base.arr_delay,
                1
            ) AS arrival_delay,


            ROUND(
                base.sched_min,
                1
            ) AS scheduled_duration,


            ROUND(
                base.actual_min,
                1
            ) AS actual_duration,


            ROUND(
                base.distance,
                0
            ) AS distance,


            selected.n_legs,

            ROUND(
                selected.max_arr_delay,
                1
            ) AS chain_max_delay


        FROM base


        JOIN selected

            ON selected.flight_date
                = base.flight_date

            AND selected.tail
                = base.tail


        ORDER BY

            selected.chain_rank,

            base.leg_order
    """).df()


    if df.empty:

        print(
            "  !! aircraft_chains.json is empty. "
            "Try lowering min_peak_delay or min_legs."
        )

        write(
            "aircraft_chains.json",
            []
        )

        return df


    # Add readable carrier names.
    df["carrier_name"] = (
        df["carrier"]
        .map(CARRIER_NAMES)
        .fillna(
            df["carrier"]
        )
    )


    # --------------------------------------------------------
    # Delay change relative to previous leg
    # --------------------------------------------------------

    df["delay_change"] = (
        df
        .groupby("chain_id")[
            "arrival_delay"
        ]
        .diff()
        .round(1)
    )


    # First leg has no previous leg.
    df["delay_change"] = (
        df["delay_change"]
        .where(
            df["delay_change"].notna(),
            None
        )
    )


    # --------------------------------------------------------
    # Create a compact summary of each selected chain
    # --------------------------------------------------------

    summaries = []

    for chain_id, g in df.groupby(
        "chain_id",
        sort=False
    ):

        first = g.iloc[0]

        summaries.append({

            "chain_id":
                chain_id,

            "chain_rank":
                int(first["chain_rank"]),

            "date":
                first["flight_date"],

            "tail":
                first["tail"],

            "carrier":
                first["carrier"],

            "carrier_name":
                first["carrier_name"],

            "n_legs":
                int(first["n_legs"]),

            "max_arrival_delay":
                float(
                    first[
                        "chain_max_delay"
                    ]
                ),

            "start_airport":
                g.iloc[0]["origin"],

            "end_airport":
                g.iloc[-1]["dest"],

            "legs":
                json.loads(
                    g[
                        [
                            "leg_order",
                            "origin",
                            "dest",
                            "scheduled_departure",
                            "scheduled_arrival",
                            "departure_delay",
                            "arrival_delay",
                            "delay_change",
                            "scheduled_duration",
                            "actual_duration",
                            "distance",
                        ]
                    ]
                    .to_json(
                        orient="records"
                    )
                ),
        })


    output = {

        "selection_rule": (
            f"Top {n_chains} continuous aircraft-day chains "
            f"with at least {min_legs} operated legs and at least "
            f"one arrival delay of {min_peak_delay}+ minutes; "
            "ranked by number of legs, then maximum arrival delay."
        ),

        "chains":
            summaries,
    }


    write(
        "aircraft_chains.json",
        output
    )


    print(
        f"  selected {len(summaries)} "
        "aircraft-day chains"
    )


    if summaries:

        first = summaries[0]

        print(
            "  default chain: "
            f"{first['date']} / "
            f"{first['tail']} / "
            f"{first['carrier_name']} / "
            f"{first['n_legs']} legs / "
            f"max delay "
            f"{first['max_arrival_delay']:.0f} min"
        )


    return df


# ============================================================
# Main
# ============================================================

def main():

    ap = argparse.ArgumentParser()


    ap.add_argument(

        "--raw",

        default=os.path.join(
            ROOT,
            "data",
            "raw"
        ),

        help=(
            "directory containing "
            "the unzipped monthly CSVs"
        )
    )


    args = ap.parse_args()


    raw_glob = os.path.join(
        args.raw,
        "*.csv"
    )


    print(
        f"reading {raw_glob}"
    )


    con = connect(
        raw_glob
    )


    n = con.execute(
        "SELECT COUNT(*) FROM raw"
    ).fetchone()[0]


    print(
        f"  {n:,} raw rows\n"
    )


    build_summary(con)

    build_airports(con)

    build_hour_dow(con)

    build_causes(con)

    build_distance_delay(con)

    build_aircraft_chains(con)


    print(
        "\ndone. "
        "data/processed/ is what you commit; "
        "data/raw/ is not."
    )


if __name__ == "__main__":
    main()
