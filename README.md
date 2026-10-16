# US Flight Delays: From Symptoms to Source

STATS 401 final project — **Group 13** — Tian Liang & Jiayang Sun.

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

**Note:** “Median minutes given back” is the median of turnaround-level recovery values.
It is not necessarily identical to the difference between the plotted median arrival
delay and median departure delay.

## Setup

```bash
pip install duckdb pandas
