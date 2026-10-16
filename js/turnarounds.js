/* Visualization 5 — how much of a late arrival gets handed back before the
 * aircraft leaves again?
 *
 * Two earlier designs failed here and both failures are worth stating.
 *
 * The first was a single-aircraft Gantt chart whose aircraft-days were
 * selected for containing a 30+ minute delay and then used as evidence that
 * delay propagates — assuming what it set out to show.
 *
 * The second was a scatter plot with one point per airport. It was honest but
 * unreadable: 203 points, each an average over very different turnarounds,
 * spread the signal across a cloud while the medians it plotted differed by
 * only a few minutes. Overplotting was the symptom; the real problem was that
 * the airport is the wrong unit for this question.
 *
 * So the primary view bins the turnarounds themselves by the one thing the
 * schedule actually controls — how long the aircraft was given on the ground —
 * with millions of observations behind every row. The airport view is kept,
 * rebuilt as the same dumbbell so the two read alike, and restricted to the
 * ends of the ranking where the differences are large enough to mean anything.
 *
 * Every measure here counts only turnarounds where the aircraft arrived at
 * least fifteen minutes late. Unconditioned, schedule padding makes almost
 * every airport look as though it adds delay. Both timestamps are recorded at
 * the same airport, so no time-zone conversion enters this view.
 *
 * Reads: data/processed/ground_bins.json   (primary view)
 *        data/processed/turnarounds.json   (airport view)
 *        data/processed/airports.json      (optional, for city names)
 */

import {
  showTip, moveTip, hideTip, fmtInt, fmtMin, fmtPct,
  AIRPORT_SELECT_EVENT, fail,
} from "./shared.js";

const W = 960;
const M = { top: 54, right: 250, bottom: 52, left: 168 };
const ROW = 27;

const ARRIVE = "#9E2C5E";   // the delay it landed with
const DEPART = "#5C7C92";   // the delay it left with
const WORSE  = "#C26A86";

const VIEWS = [
  { key: "ground",  label: "By scheduled ground time" },
  { key: "airport", label: "By airport" },
];

const SORTS = [
  { key: "best",  label: "Gives back most" },
  { key: "worst", label: "Gives back least" },
  { key: "busy",  label: "Busiest" },
];

const state = { view: "ground", sort: "best", carrier: "ALL", selected: null };

let BINS = null, ROWS = [], CITY = new Map(), MOUNT = null;

export async function drawTurnarounds() {
  MOUNT = document.querySelector("#viz-aircraft");
  try {
    const [bins, rows, airports] = await Promise.all([
      d3.json("data/processed/ground_bins.json").catch(() => null),
      d3.json("data/processed/turnarounds.json"),
      d3.json("data/processed/airports.json").catch(() => []),
    ]);
    BINS = bins;
    ROWS = rows;
    (airports || []).forEach((a) => CITY.set(a.iata, a.city));
    if (!BINS) state.view = "airport";

    window.addEventListener(AIRPORT_SELECT_EVENT, (e) => {
      state.selected = (e.detail && e.detail.airport) || null;
      if (ROWS.length) render();
    });

    render();
  } catch (err) {
    fail("#viz-aircraft", err);
  }
}

/* ------------------------------------------------------------------ */

function render() {
  MOUNT.innerHTML = "";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;flex-wrap:wrap;gap:1.4rem;padding:0.85rem 1rem 0.7rem;" +
    "border-bottom:1px solid var(--rule,#C2CBC7);align-items:center";
  MOUNT.appendChild(bar);

  if (BINS) {
    bar.appendChild(controls("Rows", VIEWS, state.view, (k) => {
      state.view = k; render();
    }));
  }
  if (state.view === "airport") {
    bar.appendChild(controls("Show", SORTS, state.sort, (k) => {
      state.sort = k; render();
    }));
    const carriers = [{ key: "ALL", label: "All carriers" }].concat(
      d3.rollups(ROWS.filter((d) => d.carrier !== "ALL"), (v) => v.length, (d) => d.carrier)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([c]) => ({
          key: c,
          label: (ROWS.find((r) => r.carrier === c) || {}).carrier_name || c,
        })));
    if (carriers.length > 1) {
      bar.appendChild(controls("Carrier", carriers, state.carrier, (k) => {
        state.carrier = k; render();
      }));
    }
  }

  const rows = state.view === "ground" ? groundRows() : airportRows();
  const H = M.top + M.bottom + rows.length * ROW;

  const holder = document.createElement("div");
  MOUNT.appendChild(holder);
  const svg = d3.select(holder).append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", "For each row, the median delay an aircraft arrived with and the median delay it departed with, joined by a line whose length is the delay given back on the ground");

  draw(svg, rows, H);
}

function controls(title, items, active, onPick) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:0.5rem";
  const lab = document.createElement("span");
  lab.textContent = title;
  lab.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:0.72rem;color:#8A9AA1";
  wrap.appendChild(lab);
  items.forEach((it) => {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.style.cssText =
      "font:inherit;font-size:0.8rem;padding:0.22rem 0.6rem;cursor:pointer;" +
      "border:1px solid #C2CBC7;background:#fff;color:#17313D;border-radius:2px";
    b.addEventListener("click", () => onPick(it.key));
    b.style.background = it.key === active ? "#17313D" : "#fff";
    b.style.color = it.key === active ? "#fff" : "#17313D";
    b.style.borderColor = it.key === active ? "#17313D" : "#C2CBC7";
    wrap.appendChild(b);
  });
  return wrap;
}

/* ------------------------------------------------------------------ */

/* `gap` is what the chart draws: the distance between the two dots, which is
   the median delay on arrival minus the median delay on departure. `typical`
   is the median of the per-turnaround differences — a better summary of one
   aircraft's experience, but not equal to the gap, because the median of a
   set of differences is not the difference of the medians when the
   distribution is skewed. The visible number has to be the one the eye can
   measure, so `gap` is labelled and sorted on and `typical` is kept for the
   tooltip, where the difference between the two is itself worth seeing. */
function groundRows() {
  return BINS.map((d) => ({
    key: d.bin,
    label: d.bin + " min",
    sub: fmtInt(d.n) + " turnarounds",
    inMed: d.in_med,
    outMed: d.out_med,
    gap: +(d.in_med - d.out_med).toFixed(1),
    typical: d.recovered_med,
    still: d.still_late_share,
    n: d.n,
    kind: "bin",
  }));
}

function airportRows(nEnds = 11) {
  const pts = ROWS.filter((d) => d.carrier === state.carrier
    && d.late_in_med != null && d.late_out_med != null);
  const mk = (d) => ({
    key: d.airport,
    label: d.airport,
    // the count belongs next to the name: a small field can top the ranking
    sub: [CITY.get(d.airport), d3.format(".2s")(d.n_late) + " turns"]
      .filter(Boolean).join(" · "),
    inMed: d.late_in_med,
    outMed: d.late_out_med,
    gap: +(d.late_in_med - d.late_out_med).toFixed(1),
    typical: d.recovered_med,
    still: d.still_late_share,
    ground: d.ground_med,
    n: d.n_late,
    kind: "airport",
  });

  if (state.sort === "busy") {
    return pts.slice().sort((a, b) => b.n_late - a.n_late).slice(0, nEnds * 2).map(mk);
  }
  const sorted = pts.slice().sort((a, b) =>
    (b.late_in_med - b.late_out_med) - (a.late_in_med - a.late_out_med));
  if (sorted.length <= nEnds * 2) return sorted.map(mk);

  const top = sorted.slice(0, nEnds).map(mk);
  const bottom = sorted.slice(-nEnds).map(mk);
  const gap = {
    key: "__gap__", kind: "gap",
    label: `${sorted.length - nEnds * 2} airports between`,
  };
  return state.sort === "best"
    ? top.concat([gap], bottom)
    : bottom.reverse().concat([gap], top.reverse());
}

/* ------------------------------------------------------------------ */

function draw(svg, rows, H) {
  const data = rows.filter((d) => d.kind !== "gap");
  /* Every row here counts only arrivals of 15+ minutes, so no value can fall
     near zero. Anchoring the scale there would spend a third of the width on
     empty space and compress the differences the chart exists to show, so the
     domain is fitted to the data instead. */
  const lo = d3.min(data, (d) => Math.min(d.inMed, d.outMed));
  const hi = d3.max(data, (d) => Math.max(d.inMed, d.outMed));
  const pad = Math.max(2, (hi - lo) * 0.14);
  const x = d3.scaleLinear()
    .domain([lo - pad, hi + pad])
    .range([M.left, W - M.right]);

  const y = (i) => M.top + i * ROW + ROW / 2;

  svg.append("g").selectAll("line")
    .data(x.ticks(6)).join("line")
    .attr("x1", x).attr("x2", x)
    .attr("y1", M.top - 6).attr("y2", H - M.bottom)
    .attr("stroke", (d) => (d === 0 ? "#9AABB1" : "#E4E8E5"))
    .attr("stroke-width", (d) => (d === 0 ? 1.2 : 1));

  // one row = one dumbbell: landed here, left there
  rows.forEach((d, i) => {
    const yy = y(i);

    if (d.kind === "gap") {
      svg.append("line")
        .attr("x1", M.left).attr("x2", W - M.right)
        .attr("y1", yy).attr("y2", yy)
        .attr("stroke", "#C2CBC7").attr("stroke-dasharray", "2 4");
      svg.append("text")
        .attr("x", M.left - 12).attr("y", yy + 3.5).attr("text-anchor", "end")
        .attr("font-family", "IBM Plex Sans, sans-serif")
        .attr("font-size", 10.5).attr("fill", "#9AABB1")
        .text(d.label);
      return;
    }

    const sel = d.kind === "airport" && d.key === state.selected;
    const g = svg.append("g")
      .style("cursor", d.kind === "airport" ? "pointer" : "default")
      .on("mouseenter", (e) => showTip(e, tipHtml(d)))
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);

    if (d.kind === "airport") {
      g.on("click", () => {
        state.selected = sel ? null : d.key;
        window.dispatchEvent(new CustomEvent(AIRPORT_SELECT_EVENT, {
          detail: { airport: state.selected },
        }));
        render();
      });
    }

    g.append("rect")
      .attr("x", 8).attr("y", yy - ROW / 2)
      .attr("width", W - 16).attr("height", ROW)
      .attr("fill", sel ? "#EEF2F3" : "transparent");

    g.append("line")
      .attr("x1", x(d.outMed)).attr("x2", x(d.inMed))
      .attr("y1", yy).attr("y2", yy)
      .attr("stroke", d.gap >= 0 ? DEPART : WORSE)
      .attr("stroke-width", 3.5).attr("stroke-linecap", "round")
      .attr("stroke-opacity", 0.55);

    g.append("circle")
      .attr("cx", x(d.inMed)).attr("cy", yy).attr("r", 5)
      .attr("fill", "#fff").attr("stroke", ARRIVE).attr("stroke-width", 2);

    g.append("circle")
      .attr("cx", x(d.outMed)).attr("cy", yy).attr("r", 5)
      .attr("fill", DEPART);

    g.append("text")
      .attr("x", M.left - 12).attr("y", yy + (d.sub ? 0 : 3.5))
      .attr("text-anchor", "end")
      .attr("font-family", d.kind === "airport"
        ? "IBM Plex Mono, monospace" : "IBM Plex Sans, sans-serif")
      .attr("font-size", 11.5).attr("fill", "#17313D")
      .text(d.label);

    if (d.sub) {
      g.append("text")
        .attr("x", M.left - 12).attr("y", yy + 12).attr("text-anchor", "end")
        .attr("font-family", "IBM Plex Sans, sans-serif")
        .attr("font-size", 9.5).attr("fill", "#9AABB1")
        .text(d.sub);
    }

    // recovered minutes, then how many of those aircraft were still late
    g.append("text")
      .attr("x", W - M.right + 46).attr("y", yy + 3.5).attr("text-anchor", "end")
      .attr("font-family", "IBM Plex Mono, monospace")
      .attr("font-size", 11).attr("fill", d.gap >= 0 ? "#17313D" : WORSE)
      .text(d3.format("+.0f")(d.gap));

    const bx = W - M.right + 70, bw = 104;
    g.append("rect")
      .attr("x", bx).attr("y", yy - 5).attr("width", bw).attr("height", 10)
      .attr("fill", "#EDEFEE");
    g.append("rect")
      .attr("x", bx).attr("y", yy - 5).attr("width", bw * (d.still || 0)).attr("height", 10)
      .attr("fill", ARRIVE).attr("fill-opacity", 0.75);
    g.append("text")
      .attr("x", bx + bw + 8).attr("y", yy + 3.5)
      .attr("font-family", "IBM Plex Mono, monospace")
      .attr("font-size", 10.5).attr("fill", "#5A6E78")
      .text(d3.format(".0%")(d.still || 0));
  });

  drawChrome(svg, x, H);
}

function tipHtml(d) {
  return `
    <span class="k">${d.label}</span> ${d.sub || ""}<br>
    <span class="d">after arriving 15+ min late</span><br>
    <span class="d">&nbsp;&nbsp;landed</span> ${fmtMin(d.inMed)}<br>
    <span class="d">&nbsp;&nbsp;left again</span> ${fmtMin(d.outMed)}<br>
    <span class="d">&nbsp;&nbsp;gap between the two</span> ${fmtMin(d.gap)}<br>
    <span class="d">&nbsp;&nbsp;typical single turnaround</span> ${fmtMin(d.typical)}<br>
    <span class="d">&nbsp;&nbsp;still 15+ late leaving</span> ${fmtPct(d.still)}<br>
    ${d.ground != null
      ? `<span class="d">scheduled ground time</span> ${d3.format(".0f")(d.ground)} min<br>` : ""}
    <span class="d">turnarounds</span> ${fmtInt(d.n)}
    ${d.kind === "airport" ? '<br><span class="d">click to filter the heatmap</span>' : ""}`;
}

function drawChrome(svg, x, H) {
  svg.append("g")
    .attr("transform", `translate(0,${H - M.bottom + 4})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("+.0f"))
      .tickSize(0).tickPadding(7))
    .call((g) => g.select(".domain").remove());

  svg.selectAll("g text")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11).attr("fill", "#5A6E78");

  svg.append("text")
    .attr("x", (M.left + W - M.right) / 2).attr("y", H - 14)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11.5).attr("fill", "#5A6E78")
    .text("minutes of delay — hollow dot where it landed, solid dot where it left again");

  svg.append("text")
    .attr("x", M.left - 12).attr("y", M.top - 26).attr("text-anchor", "end")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5).attr("fill", "#8A9AA1")
    .text(state.view === "ground" ? "scheduled ground time" : "airport");

  const key = svg.append("g")
    .attr("transform", `translate(${M.left}, ${M.top - 30})`)
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5).attr("fill", "#8A9AA1");
  key.append("circle").attr("cx", 5).attr("cy", -3).attr("r", 5)
    .attr("fill", "#fff").attr("stroke", ARRIVE).attr("stroke-width", 2);
  key.append("text").attr("x", 16).attr("y", 0.5).text("landed");
  key.append("circle").attr("cx", 76).attr("cy", -3).attr("r", 5).attr("fill", DEPART);
  key.append("text").attr("x", 87).attr("y", 0.5)
    .text("left again — the gap between them is what the ground gave back");

  svg.append("text")
    .attr("x", W - M.right + 46).attr("y", M.top - 26).attr("text-anchor", "end")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5).attr("fill", "#8A9AA1")
    .text("given back");

  svg.append("text")
    .attr("x", W - M.right + 70).attr("y", M.top - 26)
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5).attr("fill", "#8A9AA1")
    .text("still 15+ min late when it left");
}