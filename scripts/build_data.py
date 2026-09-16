#!/usr/bin/env python3
"""
build_data.py — reduce the raw BTS On-Time Performance CSVs into small JSON
files that the browser can load.

Usage:
    python scripts/build_data.py                    # reads data/raw/*.csv
    python scripts/build_data.py --raw some/dir     # custom input directory

Outputs (all in data/processed/):
    summary.json         headline numbers for the page
    airports.json        per-airport metrics + coordinates   -> Viz 1 (map)
    hour_dow.json        hour x weekday delay matrix         -> Viz 2 (heatmap)
    causes.json          five-cause composition by carrier   -> Viz 3 (stacked bar)
    distance_delay.json  distance-bin delay quantiles        -> Viz 4 (relationship)

Every output is a few hundred KB at most. The raw CSVs are never shipped.
"""

import argparse
import json
import os
import sys

try:
    import duckdb
except ImportError:
    sys.exit("duckdb is not installed.  Run:  pip install duckdb")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "processed")
AIRPORT_META = os.path.join(ROOT, "data", "airports_meta.csv")

# Only these columns are read. Reading all 110 is what makes pandas fall over.
COLS = [
    "Year", "Month", "DayOfWeek", "FlightDate",
    "Reporting_Airline", "DOT_ID_Reporting_Airline", "Tail_Number",
    "Origin", "Dest", "OriginCityName", "OriginStateName",
    "CRSDepTime", "DepDelay", "CRSArrTime", "ArrDelay", "ArrDel15",
    "Cancelled", "CancellationCode", "Diverted",
    "CRSElapsedTime", "ActualElapsedTime", "Distance",
    "CarrierDelay", "WeatherDelay", "NASDelay", "SecurityDelay",
    "LateAircraftDelay",
]

# Carrier codes -> readable names. Extend as needed.
CARRIER_NAMES = {
    "AA": "American", "AS": "Alaska", "B6": "JetBlue", "DL": "Delta",
    "F9": "Frontier", "G4": "Allegiant", "HA": "Hawaiian", "MQ": "Envoy",
    "NK": "Spirit", "OH": "PSA", "OO": "SkyWest", "QX": "Horizon",
    "UA": "United", "WN": "Southwest", "YX": "Republic", "9E": "Endeavor",
    "YV": "Mesa", "ZW": "Air Wisconsin", "C5": "CommuteAir", "PT": "Piedmont",
    "EV": "ExpressJet", "VX": "Virgin America", "US": "US Airways",
}


def connect(raw_glob):
    con = duckdb.connect()
    cols_sql = ", ".join(f'"{c}"' for c in COLS)
    # union_by_name tolerates column-order changes between months.
    # BTS rows end with a trailing comma; selecting named columns sidesteps it.
    con.execute(f"""
        CREATE OR REPLACE VIEW raw AS
        SELECT {cols_sql}
        FROM read_csv_auto('{raw_glob}', union_by_name=true, sample_size=-1)
    """)

    # ---- the four cleaning decisions, applied once, here ----
    # 1. Cancelled/diverted flights have NULL ArrDelay. They are NOT delay-zero,
    #    so they are excluded from delay statistics but counted separately.
    # 2. hhmm integers -> hour of day. 2400 is a legal value and means midnight.
    # 3. The five cause columns are only populated when ArrDelay >= 15.
    #    NULL there means "not applicable", not zero.
    # 4. DOT_ID_Reporting_Airline is the stable carrier key; the two-letter
    #    code has been reassigned between airlines over the years.
    con.execute("""
        CREATE OR REPLACE VIEW f AS
        SELECT
            Year, Month, DayOfWeek, FlightDate,
            Reporting_Airline            AS carrier,
            DOT_ID_Reporting_Airline     AS carrier_id,
            Tail_Number                  AS tail,
            Origin, Dest,
            CAST(TRY_CAST(CRSDepTime AS INTEGER) / 100 AS INTEGER) % 24 AS dep_hour,
            TRY_CAST(DepDelay  AS DOUBLE) AS dep_delay,
            TRY_CAST(ArrDelay  AS DOUBLE) AS arr_delay,
            TRY_CAST(Distance  AS DOUBLE) AS distance,
            TRY_CAST(CRSElapsedTime    AS DOUBLE) AS sched_min,
            TRY_CAST(ActualElapsedTime AS DOUBLE) AS actual_min,
            COALESCE(TRY_CAST(Cancelled AS DOUBLE), 0) = 1 AS cancelled,
            COALESCE(TRY_CAST(Diverted  AS DOUBLE), 0) = 1 AS diverted,
            CancellationCode AS cancel_code,
            TRY_CAST(CarrierDelay      AS DOUBLE) AS c_carrier,
            TRY_CAST(WeatherDelay      AS DOUBLE) AS c_weather,
            TRY_CAST(NASDelay          AS DOUBLE) AS c_nas,
            TRY_CAST(SecurityDelay     AS DOUBLE) AS c_security,
            TRY_CAST(LateAircraftDelay AS DOUBLE) AS c_late_aircraft
        FROM raw
    """)

    # Flights that actually operated and have a usable arrival delay.
    con.execute("""
        CREATE OR REPLACE VIEW ops AS
        SELECT * FROM f WHERE NOT cancelled AND NOT diverted AND arr_delay IS NOT NULL
    """)
    return con


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"))
    kb = os.path.getsize(path) / 1024
    print(f"  wrote {name:22s} {kb:8.1f} KB")


# --------------------------------------------------------------------------- #

def build_summary(con):
    r = con.execute("""
        SELECT
            (SELECT COUNT(*) FROM f)                                  AS total_rows,
            (SELECT COUNT(*) FROM f WHERE cancelled)                  AS cancelled,
            (SELECT COUNT(*) FROM f WHERE diverted)                   AS diverted,
            (SELECT COUNT(*) FROM ops)                                AS operated,
            (SELECT COUNT(*) FROM ops WHERE arr_delay >= 15)          AS delayed15,
            (SELECT MEDIAN(arr_delay) FROM ops)                       AS median_delay,
            (SELECT AVG(arr_delay) FROM ops)                          AS mean_delay,
            (SELECT COUNT(DISTINCT Origin) FROM f)                    AS n_airports,
            (SELECT COUNT(DISTINCT carrier_id) FROM f)                AS n_carriers
    """).df().iloc[0].to_dict()

    causes = con.execute("""
        SELECT SUM(c_carrier)       AS carrier,
               SUM(c_weather)       AS weather,
               SUM(c_nas)           AS nas,
               SUM(c_security)      AS security,
               SUM(c_late_aircraft) AS late_aircraft
        FROM ops WHERE arr_delay >= 15
    """).df().iloc[0].to_dict()
    total = sum(v or 0 for v in causes.values()) or 1

    out = {k: (None if v is None else float(v)) for k, v in r.items()}
    out["cause_minutes"] = {k: float(v or 0) for k, v in causes.items()}
    out["cause_share"] = {k: round((v or 0) / total, 4) for k, v in causes.items()}
    out["cancel_rate"] = round(out["cancelled"] / max(out["total_rows"], 1), 4)
    out["delay15_rate"] = round(out["delayed15"] / max(out["operated"], 1), 4)

    ranked = sorted(out["cause_share"].items(), key=lambda kv: -kv[1])
    out["largest_cause"] = ranked[0][0]
    print(f"\n  >> largest reported cause: {ranked[0][0]} "
          f"({ranked[0][1]*100:.1f}% of delay minutes)")
    print("     full ranking: " +
          ", ".join(f"{k} {v*100:.1f}%" for k, v in ranked) + "\n")
    write("summary.json", out)
    return out


def build_airports(con):
    con.execute(f"""
        CREATE OR REPLACE VIEW meta AS
        SELECT * FROM read_csv_auto('{AIRPORT_META}', header=true)
    """)
    df = con.execute("""
        WITH dep AS (
            SELECT Origin AS iata,
                   COUNT(*)                                        AS flights,
                   MEDIAN(arr_delay)                               AS median_delay,
                   QUANTILE_CONT(arr_delay, 0.9)                   AS p90_delay,
                   AVG(CASE WHEN arr_delay >= 15 THEN 1.0 ELSE 0 END) AS delay15_rate,
                   SUM(c_late_aircraft)                            AS m_late,
                   SUM(COALESCE(c_carrier,0)+COALESCE(c_weather,0)
                      +COALESCE(c_nas,0)+COALESCE(c_security,0)
                      +COALESCE(c_late_aircraft,0))                AS m_total
            FROM ops GROUP BY Origin
        ),
        cx AS (
            SELECT Origin AS iata,
                   AVG(CASE WHEN cancelled THEN 1.0 ELSE 0 END) AS cancel_rate,
                   COUNT(*) AS scheduled
            FROM f GROUP BY Origin
        )
        SELECT dep.iata, meta.name, meta.city, meta.lat, meta.lon,
               dep.flights, cx.scheduled,
               ROUND(dep.median_delay, 2)  AS median_delay,
               ROUND(dep.p90_delay, 2)     AS p90_delay,
               ROUND(dep.delay15_rate, 4)  AS delay15_rate,
               ROUND(cx.cancel_rate, 4)    AS cancel_rate,
               ROUND(dep.m_late / NULLIF(dep.m_total, 0), 4) AS late_aircraft_share
        FROM dep
        JOIN cx   ON cx.iata = dep.iata
        LEFT JOIN meta ON meta.iata = dep.iata
        WHERE dep.flights >= 1000
        ORDER BY dep.flights DESC
    """).df()

    missing = df[df["lat"].isna()]["iata"].tolist()
    if missing:
        print(f"  !! {len(missing)} airports had no coordinate match: "
              f"{', '.join(missing[:12])}{'...' if len(missing) > 12 else ''}")
    df = df.dropna(subset=["lat", "lon"])
    write("airports.json", json.loads(df.to_json(orient="records")))
    return df


def build_hour_dow(con, top_n=30):
    df = con.execute(f"""
        WITH top AS (
            SELECT Origin FROM ops GROUP BY Origin
            ORDER BY COUNT(*) DESC LIMIT {top_n}
        )
        SELECT 'ALL' AS airport, dep_hour AS hour, DayOfWeek AS dow,
               COUNT(*) AS n,
               ROUND(MEDIAN(arr_delay), 2) AS median_delay,
               ROUND(AVG(CASE WHEN arr_delay >= 15 THEN 1.0 ELSE 0 END), 4) AS delay15_rate
        FROM ops GROUP BY 1, 2, 3
        UNION ALL
        SELECT Origin AS airport, dep_hour AS hour, DayOfWeek AS dow,
               COUNT(*) AS n,
               ROUND(MEDIAN(arr_delay), 2) AS median_delay,
               ROUND(AVG(CASE WHEN arr_delay >= 15 THEN 1.0 ELSE 0 END), 4) AS delay15_rate
        FROM ops WHERE Origin IN (SELECT Origin FROM top)
        GROUP BY 1, 2, 3
        ORDER BY airport, dow, hour
    """).df()
    write("hour_dow.json", json.loads(df.to_json(orient="records")))
    return df


def build_causes(con, min_delayed=2000):
    df = con.execute(f"""
        SELECT carrier,
               COUNT(*)                          AS delayed_flights,
               SUM(COALESCE(c_carrier,0))        AS carrier_min,
               SUM(COALESCE(c_weather,0))        AS weather_min,
               SUM(COALESCE(c_nas,0))            AS nas_min,
               SUM(COALESCE(c_security,0))       AS security_min,
               SUM(COALESCE(c_late_aircraft,0))  AS late_aircraft_min
        FROM ops WHERE arr_delay >= 15
        GROUP BY carrier
        HAVING COUNT(*) >= {min_delayed}
        ORDER BY 2 DESC
    """).df()
    parts = ["carrier_min", "weather_min", "nas_min",
             "security_min", "late_aircraft_min"]
    df["total_min"] = df[parts].sum(axis=1)
    for p in parts:
        df[p.replace("_min", "_share")] = (df[p] / df["total_min"]).round(4)
    df["name"] = df["carrier"].map(CARRIER_NAMES).fillna(df["carrier"])
    write("causes.json", json.loads(df.to_json(orient="records")))
    return df


def build_distance_delay(con):
    df = con.execute("""
        WITH b AS (
            SELECT CASE
                     WHEN distance <  250 THEN '0-250'
                     WHEN distance <  500 THEN '250-500'
                     WHEN distance <  750 THEN '500-750'
                     WHEN distance < 1000 THEN '750-1000'
                     WHEN distance < 1500 THEN '1000-1500'
                     WHEN distance < 2000 THEN '1500-2000'
                     WHEN distance < 2500 THEN '2000-2500'
                     ELSE '2500+'
                   END AS bin,
                   CASE
                     WHEN distance <  250 THEN 1 WHEN distance <  500 THEN 2
                     WHEN distance <  750 THEN 3 WHEN distance < 1000 THEN 4
                     WHEN distance < 1500 THEN 5 WHEN distance < 2000 THEN 6
                     WHEN distance < 2500 THEN 7 ELSE 8
                   END AS ord,
                   arr_delay, c_late_aircraft, c_carrier, c_weather, c_nas, c_security
            FROM ops WHERE distance IS NOT NULL
        )
        SELECT bin, ord, COUNT(*) AS n,
               ROUND(QUANTILE_CONT(arr_delay, 0.25), 2) AS q25,
               ROUND(MEDIAN(arr_delay), 2)              AS median,
               ROUND(QUANTILE_CONT(arr_delay, 0.75), 2) AS q75,
               ROUND(QUANTILE_CONT(arr_delay, 0.90), 2) AS p90,
               ROUND(AVG(CASE WHEN arr_delay >= 15 THEN 1.0 ELSE 0 END), 4) AS delay15_rate,
               ROUND(SUM(COALESCE(c_late_aircraft,0)) / NULLIF(SUM(
                    COALESCE(c_carrier,0)+COALESCE(c_weather,0)+COALESCE(c_nas,0)
                   +COALESCE(c_security,0)+COALESCE(c_late_aircraft,0)), 0), 4)
                                                        AS late_aircraft_share
        FROM b GROUP BY bin, ord ORDER BY ord
    """).df()
    write("distance_delay.json", json.loads(df.to_json(orient="records")))
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"),
                    help="directory containing the unzipped monthly CSVs")
    args = ap.parse_args()
    raw_glob = os.path.join(args.raw, "*.csv")

    print(f"reading {raw_glob}")
    con = connect(raw_glob)
    n = con.execute("SELECT COUNT(*) FROM raw").fetchone()[0]
    print(f"  {n:,} raw rows\n")

    build_summary(con)
    build_airports(con)
    build_hour_dow(con)
    build_causes(con)
    build_distance_delay(con)
    print("\ndone.  data/processed/ is what you commit; data/raw/ is not.")


if __name__ == "__main__":
    main()
