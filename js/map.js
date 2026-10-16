/* Visualization 1 — where delay concentrates.
 *
 * Two layers, one job each. Earlier drafts had the circles carry both traffic
 * volume and delay at once, which made the northeast corridor unreadable and
 * left the whole land area blank. Now the states carry the performance measure
 * and the circles carry volume only.
 *
 * Selection is shared with the rest of the page through AIRPORT_SELECT_EVENT.
 * This module both dispatches it (when a circle is clicked) and listens for it
 * (so an airport chosen in Visualization 5 is highlighted here too). The click
 * handler only dispatches; the listener does the repainting, so there is one
 * code path for a selection however it arrives.
 *
 * Reads: data/processed/airports.json
 *        us-atlas states topology (CDN)
 */

import {
  showTip, moveTip, hideTip, fmtInt, fmtMin, fmtPct,
  sequentialScale, rampLegend, RAMP_BLUE, AIRPORT_SELECT_EVENT, fail,
} from "./shared.js";

const W = 960, H = 600;
const LABEL_N = 14;
const DOT = "#d4b5c4";
const PAPER = "#FFFFFF";
const NO_DATA = "#EDF1F4";

const METRICS = [
  { key: "delay15_rate", label: "Delayed 15+ min",
    title: "Flights delayed 15+ min, by state",
    sub: "flight-weighted across the state's airports" },
  { key: "cancel_rate", label: "Cancelled",
    title: "Flights cancelled, by state",
    sub: "share of scheduled departures" },
];

const state = { metric: "delay15_rate", selected: null };

let CTX = null;   // everything render() needs, built once

export async function drawMap() {
  const mount = document.querySelector("#viz-map");
  try {
    const [airports, us] = await Promise.all([
      d3.json("data/processed/airports.json"),
      d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"),
    ]);

    mount.innerHTML = "";

    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;flex-wrap:wrap;gap:1.4rem;padding:0.85rem 1rem 0.7rem;" +
      "border-bottom:1px solid var(--rule,#C2CBC7);align-items:center";
    mount.appendChild(bar);
    bar.appendChild(controlGroup("State measure", METRICS, state.metric, (k) => {
      state.metric = k;
      render();
    }));

    const holder = document.createElement("div");
    mount.appendChild(holder);

    const svg = d3.select(holder).append("svg")
      .attr("id", "map-svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img")
      .attr("aria-label", "US states shaded by the selected delay measure, with every reporting airport drawn as a circle sized by departures");

    const states = topojson.feature(us, us.objects.states);
    const projection = d3.geoAlbersUsa().fitExtent([[22, 22], [W - 54, H - 108]], states);
    const path = d3.geoPath(projection);

    /* Each airport's state is derived from the state polygons rather than from
       a column in the data, so there is no state-name spelling to keep in sync
       with the pipeline. Airports outside the 50 states (Puerto Rico, the US
       Virgin Islands) match no polygon and drop out of the state totals; they
       are also unplaceable by this projection, so they do not appear as
       circles either. The figure caption says so. */
    const feats = states.features;
    airports.forEach((a) => {
      const f = feats.find((ft) => d3.geoContains(ft, [a.lon, a.lat]));
      a.stateName = f ? f.properties.name : null;
      a.xy = projection([a.lon, a.lat]);
    });

    const byState = d3.rollup(
      airports.filter((d) => d.stateName),
      (v) => {
        const flights = d3.sum(v, (d) => d.flights);
        const scheduled = d3.sum(v, (d) => d.scheduled || d.flights);
        return {
          flights,
          scheduled,
          airports: v.length,
          delay15_rate: d3.sum(v, (d) => d.delay15_rate * d.flights) / flights,
          cancel_rate: d3.sum(v, (d) => d.cancel_rate * (d.scheduled || d.flights)) / scheduled,
          worst: v.slice().sort((a, b) => b.delay15_rate - a.delay15_rate)[0],
        };
      },
      (d) => d.stateName
    );

    const pts = airports.filter((d) => d.xy).sort((a, b) => b.flights - a.flights);
    const r = d3.scaleSqrt().domain([0, d3.max(pts, (d) => d.flights)]).range([0, 21]);

    const gStates = svg.append("g");
    const gBorders = svg.append("g");
    const gDots = svg.append("g");
    const gLabels = svg.append("g");
    const gLegend = svg.append("g");

    gBorders.append("path")
      .datum(topojson.mesh(us, us.objects.states, (a, b) => a !== b))
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", PAPER)
      .attr("stroke-width", 0.9)
      .attr("stroke-linejoin", "round");

    CTX = { svg, feats, path, byState, pts, r, gStates, gDots, gLabels, gLegend };

    drawDots();
    drawLabels();
    render();

    // A selection made anywhere on the page lands here.
    window.addEventListener(AIRPORT_SELECT_EVENT, (e) => {
      state.selected = (e.detail && e.detail.airport) || null;
      paintSelection();
    });
  } catch (err) {
    fail("#viz-map", err);
  }
}

/* ------------------------------------------------------------------ */

function controlGroup(title, items, active, onPick) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:0.5rem";

  const lab = document.createElement("span");
  lab.textContent = title;
  lab.style.cssText =
    "font-family:'IBM Plex Mono',monospace;font-size:0.72rem;color:#8A9AA1";
  wrap.appendChild(lab);

  items.forEach((it) => {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.style.cssText =
      "font:inherit;font-size:0.8rem;padding:0.22rem 0.6rem;cursor:pointer;" +
      "border:1px solid #C2CBC7;background:#fff;color:#17313D;border-radius:2px";
    b.addEventListener("click", () => {
      [...wrap.querySelectorAll("button")].forEach((o) => paint(o, false));
      paint(b, true);
      onPick(it.key);
    });
    paint(b, it.key === active);
    wrap.appendChild(b);
  });
  return wrap;
}

function paint(btn, on) {
  btn.style.background = on ? "#17313D" : "#fff";
  btn.style.color = on ? "#fff" : "#17313D";
  btn.style.borderColor = on ? "#17313D" : "#C2CBC7";
}

/* ------------------------------------------------------------------ */

function render() {
  const { feats, path, byState, gStates, gLegend } = CTX;
  const metric = METRICS.find((m) => m.key === state.metric);

  const values = [...byState.values()].map((d) => d[metric.key]);
  const color = sequentialScale(values, RAMP_BLUE);

  const sel = gStates.selectAll("path").data(feats, (d) => d.properties.name);
  const entered = sel.enter().append("path")
    .attr("d", path)
    .attr("fill", NO_DATA)
    .style("cursor", "pointer")
    .on("mouseenter", (e, d) => showTip(e, stateTip(d)))
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip);

  entered.merge(sel)
    .transition().duration(420)
    .attr("fill", (d) => {
      const s = byState.get(d.properties.name);
      return s ? color(s[metric.key]) : NO_DATA;
    });

  gLegend.selectAll("*").remove();
  const g = gLegend
    .attr("transform", `translate(32, ${H - 80})`)
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5)
    .attr("fill", "#5A6E78");

  // Cancellation rates sit near 1–3%, where whole-percent ticks collapse into
  // repeated labels. Pick the precision from the spread rather than fixing it.
  const spread = color.hi - color.lo;
  rampLegend(g, color, {
    width: 185,
    title: metric.title,
    format: d3.format(spread < 0.05 ? ".1%" : ".0%"),
    sub: metric.sub,
  });

  const sg = g.append("g").attr("transform", "translate(248, 0)");
  sg.append("text").attr("y", -6).text(`Departures, all ${CTX.pts.length} reporting airports`);
  const ticks = [10000, 100000, 300000].filter((t) => t <= CTX.r.domain()[1]);
  let x = 0;
  ticks.forEach((t) => {
    const rad = Math.max(1.6, CTX.r(t));
    sg.append("circle").attr("cx", x + rad).attr("cy", 30).attr("r", rad)
      .attr("fill", DOT).attr("fill-opacity", 0.72)
      .attr("stroke", PAPER).attr("stroke-width", 0.8);
    sg.append("text").attr("x", x + rad).attr("y", 58).attr("text-anchor", "middle")
      .text(d3.format(".0s")(t));
    x += rad * 2 + 24;
  });

  paintSelection();
}

function stateTip(d) {
  const s = CTX.byState.get(d.properties.name);
  if (!s) {
    return `<span class="k">${d.properties.name}</span><br>
            <span class="d">no reporting airport</span>`;
  }
  return `
    <span class="k">${d.properties.name}</span><br>
    <span class="d">flights delayed 15+ min</span> ${fmtPct(s.delay15_rate)}<br>
    <span class="d">cancelled</span> ${fmtPct(s.cancel_rate)}<br>
    <span class="d">departures</span> ${fmtInt(s.flights)}<br>
    <span class="d">reporting airports</span> ${s.airports}<br>
    <span class="d">worst in state</span> ${s.worst.iata} ${fmtPct(s.worst.delay15_rate)}`;
}

/* Circles are drawn once; only their selection styling changes afterwards.
   Largest first, so the small fields stay clickable on top. */
function drawDots() {
  const { gDots, pts, r } = CTX;
  gDots.selectAll("circle")
    .data(pts, (d) => d.iata)
    .join("circle")
    .attr("cx", (d) => d.xy[0])
    .attr("cy", (d) => d.xy[1])
    .attr("r", (d) => Math.max(1.6, r(d.flights)))
    .attr("fill", DOT)
    .attr("fill-opacity", 0.72)
    .attr("stroke", PAPER)
    .attr("stroke-width", 0.8)
    .style("cursor", "pointer")
    .on("mouseenter", (e, d) => showTip(e, airportTip(d)))
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip)
    .on("click", (e, d) => {
      e.stopPropagation();
      const next = state.selected === d.iata ? null : d.iata;
      window.dispatchEvent(new CustomEvent(AIRPORT_SELECT_EVENT, {
        detail: { airport: next },
      }));
    });
}

function airportTip(d) {
  return `
    <span class="k">${d.iata}</span> ${d.city || ""}<br>
    <span class="d">departures</span> ${fmtInt(d.flights)}<br>
    <span class="d">delayed 15+ min</span> ${fmtPct(d.delay15_rate)}<br>
    <span class="d">median arrival delay</span> ${fmtMin(d.median_delay)}<br>
    <span class="d">90th percentile</span> ${fmtMin(d.p90_delay)}<br>
    <span class="d">cancelled</span> ${fmtPct(d.cancel_rate)}<br>
    <span class="d">late-aircraft share</span> ${fmtPct(d.late_aircraft_share)}<br>
    <span class="d">${state.selected === d.iata ? "click again to clear" : "click to filter the heatmap"}</span>`;
}

function paintSelection() {
  if (!CTX) return;
  CTX.gDots.selectAll("circle")
    .attr("stroke", (d) => (d.iata === state.selected ? "#17313D" : PAPER))
    .attr("stroke-width", (d) => (d.iata === state.selected ? 3 : 0.8))
    .attr("fill-opacity", (d) => (d.iata === state.selected ? 1 : 0.72));
}

function drawLabels() {
  const { gLabels, pts, r } = CTX;
  gLabels
    .attr("font-family", "IBM Plex Mono, monospace")
    .attr("font-size", 10)
    .attr("fill", "#1B3B52")
    .attr("pointer-events", "none")
    .selectAll("text")
    .data(pts.slice(0, LABEL_N))
    .join("text")
    .attr("x", (d) => Math.min(Math.max(d.xy[0], 22), W - 22))
    .attr("y", (d) => d.xy[1] - Math.max(1.6, r(d.flights)) - 5)
    .attr("text-anchor", (d) => (d.xy[0] > W - 70 ? "end" : (d.xy[0] < 70 ? "start" : "middle")))
    .attr("paint-order", "stroke")
    .attr("stroke", PAPER)
    .attr("stroke-width", 3)
    .text((d) => d.iata);
}