# US Flight Delays: From Symptoms to Source

**STATS 401 Final Report · Group 13**  
**Tian Liang & Jiayang Sun**

Live site: https://susan-fox.github.io/stats401-final-project/  
Repository: https://github.com/Susan-fox/stats401-final-project

---

## Introduction

Ask a traveler why their flight was late and the answer names something external: the
airport, the airline, the weather. The US Bureau of Transportation Statistics records a
different leading explanation. Across 7,079,061 scheduled domestic flights in 2024, the
largest category of reported delay minutes — 40.4% — is *late inbound aircraft*: the
plane arrived late from its own previous leg. With carrier operations, categories inside
the airline's control account for 74.9%. Delay, on this evidence, is less something that
happens *to* the network than something the network carries forward through its own
schedule.

That reframing is our visualization goal: move a reader from familiar symptoms toward an
operational source, then ask what decides whether a late arrival is handed onward or
given back. Five questions structure the sequence:

1. Which airports and regions experience the highest levels of delay?
2. How do delay patterns vary by time of day and weekday?
3. What share of reported delay is attributed to each of the five recorded causes?
4. Does a delay early in an aircraft's day persist across its later legs?
5. How much of a late arrival gets handed back before the aircraft departs again?

The intended audience is frequent travelers and general readers with no aviation
background. Visualization suits the argument because "delay propagates" is a claim about
how one event relates to the next, over distributions heavy enough in the tail that a
table of averages would hide both. The project also depends on comparing several
conditionings at once — by airport, hour, carrier, starting state and scheduled slack —
which coordinated interactive views support and static summaries do not.

## Method

**Data sources and acquisition.** The primary dataset is the BTS *Reporting Carrier
On-Time Performance* database for 2024, one row per scheduled domestic flight reported by
carriers with at least 0.5% of domestic passenger revenue. Rather than the interactive
form, we scripted retrieval of the twelve pre-packaged monthly archives
(`scripts/download.sh`): roughly 2.5 GB of CSV across 110 columns. BTS publishes no
coordinates, so airport latitude and longitude were joined from OpenFlights on IATA
code.

**Cleaning and filtering.** Processing runs in Python with DuckDB, which queries the raw
CSVs with SQL without loading them into memory, and writes one small pre-aggregated JSON
per view. Five decisions mattered most. The cause columns are populated only when arrival delay
reaches 15 minutes, so blank is not zero and cause shares use delayed flights as the
denominator. The categories are carrier *attributions*, not physical causes: the weather
field covers extreme weather only, so our 6.0% is a lower bound. Cancelled and diverted
flights (96,315 and 17,499) carry null arrival delays and are excluded from delay
statistics but reported as a 1.4% cancellation rate. Scheduled times are `hhmm` integers
where `2400` is legal and overnight flights land at a smaller clock value than they
departed, so durations come from reported elapsed time. Two-letter carrier codes have
been reassigned historically, so `DOT_ID_Reporting_Airline` is the stable key.

**Transformation.** Visualizations 4 and 5 required reconstructing aircraft rotations:
grouping by tail number and date, ordering by scheduled local departure, and checking
that each leg's destination is the next leg's origin. Operations run on UTC while BTS
publishes local time, so that continuity test guards against mis-ordered sequences; 2.6%
of aircraft-days fail and are discarded, leaving 1,328,671. An independent check recovers
each leg's implied UTC offset from `CRSArrTime − CRSDepTime − CRSElapsedTime` and finds it
within five minutes of a whole hour for 100.0% of legs.

**Implementation.** The site is static HTML, CSS and JavaScript using D3.js v7 with
TopoJSON and `us-atlas` for geography, published through GitHub Pages. All five views are
generated programmatically from JSON; the browser never touches the raw data, and the
entire processed payload is under one megabyte.

## Results

### 1 · Where delays concentrate

![Visualization 1: Geographic distribution of U.S. flight delays](figures/viz1-map.png)

A choropleth of states by the share of flights delayed 15+ minutes, flight-weighted
across each state's airports, with every reporting airport overlaid as a circle sized by
departures. Giving each mark one job keeps the dense northeast corridor readable. Users
switch the state measure between delay rate and cancellation rate, hover for detail, and
click an airport to filter Visualization 2 and highlight it in Visualization 5. Geography
is established as a symptom: volume and delay performance are visibly not the same
variable.

### 2 · When delay accumulates

![Visualization 2: Median arrival delay by scheduled departure hour and weekday](figures/viz2-heatmap.png)

An hour × weekday matrix of median arrival delay. Every row runs pale on the left to dark
on the right: flights scheduled later in the day are progressively later. This is the
first structural hint, because accumulation within a shared fleet looks like this and an
external shock does not. Selecting an airport upstream switches the matrix from the
national pattern to that airport's.

### 3 · What the delay is attributed to

![Visualization 3: Delay cause composition across carriers](figures/viz3-causes.png)

Normalized stacked bars, one per carrier, over the five reported causes. Clicking a cause
re-sorts carriers by its share; hovering emphasises that category across every row. The
view turns the argument: the dominant category describes delay inherited from an earlier
flight, and its size varies far more across carriers than weather does.

### 4 · Whether delay persists

![Visualization 4: Delay-state flows across successive aircraft legs](figures/viz4-flows.png)

A flow diagram following rotations of five or more legs between four delay states, with
median curves available as a second view. Users choose which starting cohort to follow,
filter by haul, and click any band to trace it forward. Of aircraft 60+ minutes late on
leg one, **30.9% are still 60+ late on leg five** and only 43.8% recover fully. Delay
also compounds: **13.2%** of aircraft merely 15–29 minutes late at leg one finish 60+
late. A median curve cannot show that second result at all.

### 5 · How much gets handed back

![Visualization 5: Turnaround recovery by scheduled ground time](figures/viz5-dumbbell.png)

Dumbbells of median arrival delay against median departure delay for the same
turnarounds, counting only arrivals 15+ minutes late. Rows are scheduled ground-time
bands by default and individual airports on demand. The relationship is monotone and
crosses zero: below about 45 minutes of scheduled ground time a late arrival leaves
*later* than it landed (−2 and −1 minutes), while past two hours the median turnaround
gives back 62 minutes. The share still 15+ minutes late on departure falls from 93% to
36% across the same range.

## Discussion

**What.** The views represent flight-level records aggregated to five different units —
state and airport (geographic, quantitative), hour × weekday (ordinal × ordinal), carrier
× cause (categorical, part-to-whole), leg × delay state (sequential, categorical), and
turnaround × ground-time band (quantitative). **Why.** The supported tasks move from
overview and comparison (1–3) to trend and relationship discovery (4–5), with filtering,
selection and details-on-demand throughout. **How.** Idioms are matched to task rather
than to novelty: position on a common scale wherever precision matters, area only for
volume, a single-hue sequential ramp for ordered measures, and a small categorical
palette whose grouping separates the airline's own operation from external conditions.

The design's main strength is that its conclusions survive scrutiny, which took four
corrections we did not anticipate. An early Visualization 5 selected aircraft-days
*required* to contain a 30-minute delay, then used them as evidence that delay propagates
— assuming what it set out to show. Its replacement was confounded by schedule padding:
the median flight lands six minutes early, so almost every airport appeared to add delay
for reasons unrelated to propagation, which is why every turnaround measure is now
conditioned on genuinely late arrivals. Plotting recovery against arrival delay would
have manufactured a trend, since recovery is arrival minus departure and shares a term
with that axis; ground time shares none. And grouping rotations by their first leg
guarantees regression to the mean, so any single curve's decline overstates recovery —
hence the gap measure, which subtracts the on-time group at each leg.

Two readability failures taught the same lesson from the other direction. A whole-fleet
flow diagram was unreadable because 73% of aircraft are on time at any leg, leaving the
states we cared about as slivers; an airport scatter was unreadable because 203 noisy
points had medians differing by a few minutes. Neither was a colour problem. Both were
fixed by changing what a mark represents — one cohort rather than the fleet, one
ground-time band rather than one airport.

Limitations remain. The ground-time relationship is an association, not a demonstrated
cause: airports with long scheduled turns are disproportionately hubs, which also have
spare aircraft, crews and gates. The discarded 2.6% may fall unevenly on fleets crossing
several time zones, and the data covers domestic flights by larger carriers only. The
airport ranking can also be topped by very small stations — ACV has 281 late-arrival
turnarounds against DFW's 51,707 — which is why counts appear beside every airport name.
With more time we would run a formal evaluation round and model the hub confound rather
than noting it.

## Conclusion

Returning to the questions: delay does concentrate geographically and temporally, but
neither pattern is the source. The reported causes point inward, and following individual
aircraft confirms it — nearly a third of aircraft that start an hour late are still an
hour late five legs later, and a minor morning delay can grow into a major evening one.
What decides the outcome is not weather and not airport size but the slack the timetable
allows between legs. The break-even sits around 45 minutes of scheduled ground time,
which is almost exactly the industry median: US turnarounds are scheduled, on average, at
the point where a late arrival is neither absorbed nor amplified.

For a reader, the practical lesson is that a delayed flight is rarely isolated: a tight
connection onto an aircraft already running late is a different risk from the same
connection on a fresh one. The methodological lesson is that three of our five views
only became meaningful after we changed what a single mark represented — choosing the
unit of analysis did more for clarity than any choice of colour or chart type.

## Roles and Responsibilities

**Jiayang Sun** — data acquisition and the download pipeline; DuckDB cleaning,
filtering and aggregation; reconstruction of aircraft rotations from tail numbers and
the continuity and time-zone checks behind it; Visualization 2 (hour × weekday heatmap)
and Visualization 3 (cause composition).

**Tian Liang** — Visualization 1 (national delay map), Visualization 4 (delay-state
flows and median curves) and Visualization 5 (turnaround dumbbells); the shared
selection mechanism linking the three; page integration and visual design; project
documentation, the README and this report.

Both members contributed to question refinement, design review, testing and the
presentation.
