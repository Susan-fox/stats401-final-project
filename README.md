# US Flight Delays: From Symptoms to Source

Final project — data visualization. Tian Liang & Jiayang Sun.

Live page: **https://susan-fox.github.io/stats401-final-project/**

## What this is

Travelers attribute flight delay to airports, airlines, weather, and season. In the BTS
on-time data the largest reported category of delay minutes is *late inbound aircraft* —
the plane arrived late from its own previous leg. The project walks a reader from the
familiar symptoms to that source.

## Setup

```bash
pip install duckdb pandas
```

## Getting the data

The raw files are 2.5 GB and are **not** in this repository. Regenerate them:

```bash
bash scripts/download.sh 2024     # 12 monthly zips -> data/raw/, then unzips
python scripts/build_data.py      # data/raw/*.csv  -> data/processed/*.json
```

`build_data.py` prints the five-cause ranking when it finishes. That ranking is the
project's central claim, so check it every time the input changes.

If you already downloaded the zips by hand, just unzip them into `data/raw/` and run
step two. To point at a different folder:

```bash
python scripts/build_data.py --raw /path/to/csvs
```

## Viewing the page

The charts fetch JSON, which browsers block over `file://`. Serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Layout

```
index.html              the page (all four milestone sections)
css/style.css
js/shared.js            tooltip, colour scales, formatting
js/map.js               Viz 1  airport map
js/heatmap.js           Viz 2  hour x weekday heatmap
js/causes.js            Viz 3  cause composition + hero ribbon
js/main.js              entry point
scripts/download.sh     fetch the raw monthly files
scripts/build_data.py   raw CSV -> processed JSON
data/airports_meta.csv  US airport coordinates (from OpenFlights), committed
data/raw/               gitignored
data/processed/         committed, ~500 KB total
```

## Publishing to GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`. The page is
plain static files, so no build step is needed.

## Data notes

Four properties of this dataset drive the processing decisions in `build_data.py`:

1. The five cause columns are populated only when arrival delay is 15+ minutes. Blank is
   not zero, so cause shares use delayed flights as the denominator.
2. Cancelled and diverted flights have null `ArrDelay`. They are excluded from delay
   statistics and reported separately as a cancellation rate.
3. Times are `hhmm` integers, `2400` is legal, and overnight flights arrive at a smaller
   clock value than they departed. Durations come from `ActualElapsedTime`.
4. Two-letter carrier codes have been reassigned between airlines over the years;
   `DOT_ID_Reporting_Airline` is the stable key.

## Sources

- BTS Reporting Carrier On-Time Performance — https://transtats.bts.gov/DatabaseInfo.asp?QO_VQ=EFD
- Field definitions — https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ
- OpenFlights airports — https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat
