# US Flight Delays: From Symptoms to Source

STATS 401 final project — Tian Liang & Jiayang Sun.

**Live site: https://susan-fox.github.io/stats401-final-project/**

## What this is

Travelers attribute flight delay to airports, airlines, weather and season. In the BTS
on-time data the largest reported category of delay minutes is *late inbound aircraft* —
the plane arrived late from its own previous leg. The project walks a reader from those
familiar symptoms toward that source, and then asks what decides whether a late arrival
is handed onward or given back.

## What we found

All figures are 2024 US domestic flights, produced by the scripts in this repository.

- **40.4%** of reported delay minutes are attributed to late inbound aircraft — the
  largest of the five categories, ahead of carrier operations at 34.5%.
- The median flight arrives **6 minutes early**. Schedules are padded, which is why
  every measure in Visualization 5 is conditioned on arrivals that were genuinely
  15+ minutes late; without that condition almost every airport appears to add delay.
- Of aircraft that are **60+ minutes late on their first leg**, by their fifth leg
  **30.9% are still 60+ late** and only **43.8%** have returned to on time.
- Delay also compounds: of aircraft only **15–29 minutes late** on leg one,
  **13.2%** end up 60+ late by leg five.
- Recovery is governed by scheduled ground time. Below about 45 minutes a late arrival
  gets **worse**, not better; past two hours the median turnaround gives back an hour.

| Scheduled ground time | Late-arrival turnarounds | Median minutes given back | Still 15+ late on departure |
|---|---:|---:|---:|
| under 35 min | 40,570 | −2 | 93% |
| 35–44 | 133,023 | −1 | 90% |
| 45–54 | 223,348 | +1 | 87% |
| 55–69 | 241,785 | +7 | 77% |
| 70–89 | 116,911 | +18 | 59% |
| 90–119 | 60,285 | +32 | 43% |
| 120+ | 92,915 | +62 | 36% |

## Setup

```bash
pip install duckdb pandas
```

## Getting the data

The raw BTS files are about 2.5 GB and are **not** in this repository. The processed
JSON is committed, so the site runs without them; regenerate from scratch with:

```bash
bash scripts/download.sh 2024        # 12 monthly zips -> data/raw/, then unzips
python scripts/build_data.py         # -> Visualizations 1-3
python scripts/build_propagation.py  # -> Visualizations 4-5
```

Both scripts read `data/raw/*.csv` and write to `data/processed/`. Either accepts a
different input folder:

```bash
python scripts/build_data.py --raw /path/to/csvs
python scripts/build_propagation.py --raw /path/to/csvs
```

`build_propagation.py` imports the cleaned views from `build_data.py` rather than
redefining them, so "an operated flight" has one definition across the whole pipeline.
Run `build_data.py` first if you are regenerating everything.

Each script prints its headline numbers on exit — the five-cause ranking, the share of
aircraft-days discarded, the cohort outcomes, and the ground-time table above. Those are
the project's central claims, so check them whenever the input changes.

## Viewing the page

The charts fetch JSON, which browsers block over `file://`. Serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Layout

```
index.html                    the page: dataset, five views, interactions, discussion
css/style.css

js/main.js                    entry point
js/shared.js                  tooltip, colour scales, formatting, selection event
js/map.js                     Viz 1  states by delay rate, airports by volume
js/heatmap.js                 Viz 2  hour x weekday matrix
js/causes.js                  Viz 3  cause composition + hero ribbon
js/propagation.js             Viz 4  delay-state flows, with median curves as a 2nd view
js/turnarounds.js             Viz 5  dumbbells: delay on arrival vs. on departure

scripts/download.sh           fetch the raw monthly files
scripts/build_data.py         raw CSV -> Viz 1-3 JSON
scripts/build_propagation.py  raw CSV -> Viz 4-5 JSON (aircraft rotations)

data/airports_meta.csv        US airport coordinates, from OpenFlights (committed)
data/raw/                     gitignored
data/processed/               committed, well under 1 MB
```

### Processed files

| File | Grain | Used by |
|---|---|---|
| `summary.json` | whole year | headline figures |
| `airports.json` | airport | Viz 1 |
| `hour_dow.json` | airport × weekday × hour | Viz 2 |
| `causes.json` | carrier | Viz 3 |
| `transitions.json` | leg × delay state × next state × starting cohort | Viz 4, flow view |
| `propagation.json` | leg × first-leg outcome × haul | Viz 4, median view |
| `ground_bins.json` | scheduled ground-time band | Viz 5, default view |
| `turnarounds.json` | airport, and airport × carrier | Viz 5, airport view |
| `sequence_diag.json` | rotation reconstruction | limitations and reporting |

## Interaction

Airport selection is shared page-wide through a `stats401:airport-select` event on
`window`, carrying `{ airport: "LGA" }` or `{ airport: null }`. The map and the
turnaround chart both dispatch it and both listen for it, and the heatmap listens, so
choosing an airport anywhere updates everywhere without those modules importing each
other.

## Data notes

Decisions in `build_data.py`:

1. The five cause columns are populated only when arrival delay reaches 15 minutes.
   Blank is not zero, so cause shares use delayed flights as the denominator.
2. The categories are carrier attributions, not physical causes. BTS documents that the
   weather field covers only extreme weather, while ordinary weather falls under the
   national-airspace category, so the weather share here is a lower bound.
3. Cancelled and diverted flights have null `ArrDelay`. They are excluded from delay
   statistics and reported separately as a cancellation rate.
4. Times are `hhmm` integers, `2400` is a legal value, and overnight flights arrive at a
   smaller clock value than they departed. Durations come from `ActualElapsedTime`.
5. Two-letter carrier codes have been reassigned between airlines over the years, so
   `DOT_ID_Reporting_Airline` is the stable key.

Decisions in `build_propagation.py`:

6. Rotations are rebuilt by grouping on `Tail_Number` and date and ordering by scheduled
   local departure. Airline operations run on UTC while BTS publishes local clock times,
   so every rotation is checked for continuity — one leg's destination must be the next
   leg's origin — and any aircraft-day that fails is discarded rather than drawn in the
   wrong order. **2.6%** are discarded this way, leaving 1,328,671 usable aircraft-days.
7. The flow view is restricted to rotations of at least five legs (642,945 of them) so
   the same aircraft appear in every column and the ribbons conserve mass.
8. Grouping rotations by their first leg guarantees some regression to the mean, so the
   decline of any one median curve overstates recovery. The gap measure subtracts the
   on-time group at each leg, which regression cannot manufacture.
9. Turnaround measures count only arrivals of 15+ minutes, for the padding reason above.
   Both timestamps are recorded at the same airport, so no time-zone conversion enters
   that view.

## Sources

- BTS Reporting Carrier On-Time Performance — https://transtats.bts.gov/DatabaseInfo.asp?QO_VQ=EFD
- Field definitions — https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ
- Cause-of-delay reporting — https://www.bts.gov/topics/airlines-and-airports/understanding-reporting-causes-flight-delays-and-cancellations
- OpenFlights airports — https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat
