/* Visualization 4 — does a delay early in an aircraft's day survive its later legs?
 *
 * Two views of the same question.
 *
 * The flow view follows every rotation between four delay states, leg by leg.
 * The median curves below it say how far the middle aircraft falls back, but
 * they cannot say whether that happened because every aircraft recovered a
 * little or because some recovered fully while others stayed late — two
 * pictures with very different meanings for the argument. The ribbons can.
 *
 * Route length, the old Q3, survives as the haul toggle in both views:
 * short-haul rotations fly more legs with less scheduled ground time, so they
 * get more chances to pass delay forward.
 *
 * Reads: data/processed/transitions.json  (flow view)
 *        data/processed/propagation.json  (median view)
 */

import { showTip, moveTip, hideTip, fmtInt, fmtMin, fmtPct, fail } from "./shared.js";

const W = 960;
const H_FLOW = 480, H_LINE = 430;

/* Ordered by severity, so the colours are a ladder rather than a set of
   unrelated hues. "On time" is deliberately quiet: it is the baseline the
   other three are read against. */
const STATES = [
  { st: 0, label: "on time",     short: "on time",  color: "#8FA0A8" },
  { st: 1, label: "15–29 late",  short: "15–29",    color: "#EFA9C0" },
  { st: 2, label: "30–59 late",  short: "30–59",    color: "#D9608D" },
  { st: 3, label: "60+ late",    short: "60+",      color: "#9E2C5E" },
];

const GROUPS = [
  { key: "on time",    label: "started on time",    color: "#8FA0A8" },
  { key: "late 15-29", label: "started 15–29 late", color: "#EFA9C0" },
  { key: "late 30-59", label: "started 30–59 late", color: "#D9608D" },
  { key: "late 60+",   label: "started 60+ late",   color: "#9E2C5E" },
];

const VIEWS = [
  { key: "flows",   label: "Delay-state flows" },
  { key: "medians", label: "Median curves" },
];

const METRICS = [
  { key: "median",       label: "Median delay",    fmt: fmtMin, band: true },
  { key: "gap",          label: "Gap vs on-time",  fmt: fmtMin, band: false, derived: true },
  { key: "p90",          label: "90th percentile", fmt: fmtMin, band: false },
  { key: "delay15_rate", label: "Delayed 15+ min", fmt: fmtPct, band: false },
];

/* Following one starting cohort rather than the whole fleet is what makes the
   diagram readable. Across all rotations, 73% of aircraft are on time at any
   given leg, so that one band takes three quarters of the height and the
   delayed states — the entire subject of the chart — are reduced to slivers.
   Conditioning on where an aircraft started puts the group being asked about
   at full height. */
const COHORTS = [
  { key: "3",   label: "Started 60+ late" },
  { key: "2",   label: "Started 30–59 late" },
  { key: "1",   label: "Started 15–29 late" },
  { key: "0",   label: "Started on time" },
  { key: "all", label: "Whole fleet" },
];

const HAULS = [
  { key: "all",   label: "All rotations" },
  { key: "short", label: "Short haul" },
  { key: "long",  label: "Long haul" },
];

const state = {
  view: "flows", haul: "all", cohort: "3",
  metric: "median", isolated: null, trace: null,
};

let LINES = [], FLOW = null, MOUNT = null;

export async function drawPropagation() {
  MOUNT = document.querySelector("#viz-distance");
  try {
    const [lines, flow] = await Promise.all([
      d3.json("data/processed/propagation.json"),
      d3.json("data/processed/transitions.json").catch(() => null),
    ]);
    LINES = lines;
    FLOW = flow;
    if (!FLOW) state.view = "medians";
    render();
  } catch (err) {
    fail("#viz-distance", err);
  }
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function render() {
  MOUNT.innerHTML = "";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;flex-wrap:wrap;gap:1.4rem;padding:0.85rem 1rem 0.7rem;" +
    "border-bottom:1px solid var(--rule,#C2CBC7);align-items:center";
  MOUNT.appendChild(bar);

  if (FLOW) {
    bar.appendChild(controlGroup("View", VIEWS, state.view, (k) => {
      state.view = k; state.trace = null; state.isolated = null; render();
    }));
  }
  if (FLOW && state.view === "flows") {
    bar.appendChild(controlGroup("Follow", COHORTS, state.cohort, (k) => {
      state.cohort = k; state.trace = null; render();
    }));
  }
  bar.appendChild(controlGroup("Rotations", HAULS, state.haul, (k) => {
    state.haul = k; state.trace = null; render();
  }));
  if (state.view === "medians") {
    bar.appendChild(controlGroup("Measure", METRICS, state.metric, (k) => {
      state.metric = k; render();
    }));
  }

  const holder = document.createElement("div");
  MOUNT.appendChild(holder);

  const h = state.view === "flows" ? H_FLOW : H_LINE;
  const svg = d3.select(holder).append("svg")
    .attr("viewBox", `0 0 ${W} ${h}`)
    .attr("role", "img")
    .attr("aria-label", state.view === "flows"
      ? "Flow diagram of how aircraft move between delay states across the legs of one day"
      : "Median arrival delay across an aircraft's successive legs, grouped by how its first leg ended");

  if (state.view === "flows") renderFlows(svg);
  else renderLines(svg);
}

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
    b.addEventListener("click", () => onPick(it.key));
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
/* View 1 — the flows                                                  */
/* ------------------------------------------------------------------ */

const FM = { top: 40, right: 128, bottom: 50, left: 84 };
const NODE_W = 13, NODE_GAP = 13;

function renderFlows(svg) {
  const cohort = state.cohort;
  const raw = FLOW.rows.filter((d) => d.haul === state.haul
    && (cohort === "all" || String(d.start_state) === cohort));

  // Sum away start_state once the cohort filter has been applied, so the rest
  // of the layout works on one flow per (leg, from, to) as before.
  const rows = Array.from(
    d3.rollup(raw, (v) => d3.sum(v, (d) => d.n),
      (d) => d.from_leg, (d) => d.from_state, (d) => d.to_state),
    ([from_leg, m1]) => Array.from(m1, ([from_state, m2]) =>
      Array.from(m2, ([to_state, n]) => ({ from_leg, from_state, to_state, n })))
  ).flat(2);
  if (!rows.length) {
    svg.append("text").attr("x", W / 2).attr("y", H_FLOW / 2)
      .attr("text-anchor", "middle")
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 13).attr("fill", "#5A6E78")
      .text("No rotations in this category.");
    return;
  }

  const nCols = FLOW.n_cols;
  const legs = d3.range(1, nCols + 1);

  /* Node totals. Because the data is restricted to rotations with at least
     nCols legs, every column holds the same aircraft, so the columns all sum
     to the same number and the ribbons conserve mass. */
  const nodeN = new Map();           // "leg|state" -> count
  legs.forEach((leg) => STATES.forEach((s) => nodeN.set(`${leg}|${s.st}`, 0)));
  rows.forEach((d) => {
    const k = `${d.from_leg}|${d.from_state}`;
    nodeN.set(k, nodeN.get(k) + d.n);
    if (d.from_leg + 1 === nCols) {
      const k2 = `${nCols}|${d.to_state}`;
      nodeN.set(k2, nodeN.get(k2) + d.n);
    }
  });

  const total = d3.sum(STATES, (s) => nodeN.get(`1|${s.st}`)) || 1;
  const plotH = H_FLOW - FM.top - FM.bottom;
  const unit = (plotH - NODE_GAP * (STATES.length - 1)) / total;

  const colX = (i) => FM.left + i * ((W - FM.right - FM.left - NODE_W) / (nCols - 1));

  // Stack from the bottom so the biggest band sits as a floor and the
  // delayed bands, which carry the story, sit on top of it.
  const node = new Map();
  legs.forEach((leg, i) => {
    let yb = H_FLOW - FM.bottom;
    STATES.forEach((s) => {
      const n = nodeN.get(`${leg}|${s.st}`) || 0;
      const h = n * unit;
      node.set(`${leg}|${s.st}`, { x: colX(i), y: yb - h, h, n });
      yb -= h + NODE_GAP;
    });
  });

  /* Which ribbons descend from the traced node? Forward reachability only:
     the question is where a delay goes, not where it came from. */
  let reach = null;
  if (state.trace) {
    reach = new Set([`${state.trace.leg}|${state.trace.st}`]);
    for (let leg = state.trace.leg; leg < nCols; leg++) {
      rows.filter((d) => d.from_leg === leg && reach.has(`${leg}|${d.from_state}`))
        .forEach((d) => reach.add(`${leg + 1}|${d.to_state}`));
    }
  }
  const lit = (d) => !reach
    || (reach.has(`${d.from_leg}|${d.from_state}`) && d.from_leg >= state.trace.leg);

  // Ribbon endpoints: ordered by the other end's state so bands cross as
  // little as possible.
  const outCur = new Map(), inCur = new Map();
  const ribbons = rows.slice().sort((a, b) =>
    a.from_leg - b.from_leg || a.from_state - b.from_state || a.to_state - b.to_state);

  ribbons.forEach((d) => {
    const sKey = `${d.from_leg}|${d.from_state}`;
    const tKey = `${d.from_leg + 1}|${d.to_state}`;
    const sN = node.get(sKey), tN = node.get(tKey);
    if (!sN || !tN) return;
    const so = outCur.get(sKey) || 0;
    const to = inCur.get(tKey) || 0;
    d._s0 = sN.y + so;
    d._s1 = d._s0 + d.n * unit;
    d._t0 = tN.y + to;
    d._t1 = d._t0 + d.n * unit;
    outCur.set(sKey, so + d.n * unit);
    inCur.set(tKey, to + d.n * unit);
  });

  const band = (d) => {
    const x1 = d._sx + NODE_W, x2 = d._tx, cx = (x1 + x2) / 2;
    return `M${x1},${d._s0} C${cx},${d._s0} ${cx},${d._t0} ${x2},${d._t0}`
         + ` L${x2},${d._t1} C${cx},${d._t1} ${cx},${d._s1} ${x1},${d._s1} Z`;
  };
  ribbons.forEach((d) => {
    d._sx = node.get(`${d.from_leg}|${d.from_state}`).x;
    d._tx = node.get(`${d.from_leg + 1}|${d.to_state}`).x;
  });

  svg.append("g").selectAll("path")
    .data(ribbons.filter((d) => d._s0 != null))
    .join("path")
    .attr("d", band)
    .attr("fill", (d) => STATES[d.from_state].color)
    .attr("fill-opacity", (d) => (lit(d) ? 0.46 : 0.06))
    .style("cursor", "pointer")
    .on("mouseenter", function (e, d) {
      d3.select(this).attr("fill-opacity", lit(d) ? 0.75 : 0.2);
      const srcN = node.get(`${d.from_leg}|${d.from_state}`).n;
      showTip(e, `
        <span class="k">leg ${d.from_leg} → ${d.from_leg + 1}</span><br>
        ${STATES[d.from_state].label} → ${STATES[d.to_state].label}<br>
        <span class="d">rotations</span> ${fmtInt(d.n)}<br>
        <span class="d">of those ${STATES[d.from_state].label} at leg ${d.from_leg}</span>
        ${fmtPct(d.n / srcN)}`);
    })
    .on("mousemove", moveTip)
    .on("mouseleave", function (e, d) {
      d3.select(this).attr("fill-opacity", lit(d) ? 0.46 : 0.06);
      hideTip();
    });

  // Nodes
  /* States with no aircraft in them are left undrawn. In a cohort view three
     of the four states are empty in the first column, and a minimum-height
     rectangle turns each of them into a stray one-pixel dash. */
  svg.append("g").selectAll("rect")
    .data(legs.flatMap((leg) => STATES.map((s) => ({ leg, s, ...node.get(`${leg}|${s.st}`) })))
      .filter((d) => d.n > 0))
    .join("rect")
    .attr("x", (d) => d.x).attr("y", (d) => d.y)
    .attr("width", NODE_W).attr("height", (d) => Math.max(1, d.h))
    .attr("fill", (d) => d.s.color)
    .attr("fill-opacity", (d) =>
      (!reach || reach.has(`${d.leg}|${d.s.st}`)) ? 0.95 : 0.2)
    .style("cursor", "pointer")
    .on("mouseenter", (e, d) => showTip(e, `
      <span class="k">leg ${d.leg} · ${STATES[d.s.st].label}</span><br>
      <span class="d">rotations</span> ${fmtInt(d.n)}<br>
      <span class="d">share of the fleet</span> ${fmtPct(d.n / total)}<br>
      <span class="d">${state.trace ? "click to clear the trace" : "click to follow this group forward"}</span>`))
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip)
    .on("click", (e, d) => {
      const same = state.trace
        && state.trace.leg === d.leg && state.trace.st === d.s.st;
      state.trace = same ? null : { leg: d.leg, st: d.s.st };
      render();
    });

  drawFlowChrome(svg, legs, colX, node, nodeN, total, nCols);
}

function drawFlowChrome(svg, legs, colX, node, nodeN, total, nCols) {
  /* State labels down the left. They are aligned to the first column in which
     every state actually has mass: when one starting cohort is being followed,
     column 1 holds a single node and the other three labels would otherwise
     stack on zero-height bands at the bottom of the chart. */
  const refLeg = legs.find((leg) =>
    STATES.every((s) => (node.get(`${leg}|${s.st}`) || {}).h > 3)) || legs[0];

  svg.append("g")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11).attr("fill", "#5A6E78")
    .selectAll("text")
    .data(STATES.filter((s) => (node.get(`${refLeg}|${s.st}`) || {}).h > 3))
    .join("text")
    .attr("x", FM.left - 10)
    .attr("y", (s) => {
      const n = node.get(`${refLeg}|${s.st}`);
      return n.y + n.h / 2 + 3.5;
    })
    .attr("text-anchor", "end")
    .text((s) => s.label);

  // share of the fleet in each state at the last column
  svg.append("g")
    .attr("font-family", "IBM Plex Mono, monospace")
    .attr("font-size", 10.5).attr("fill", "#17313D")
    .selectAll("text")
    .data(STATES)
    .join("text")
    .attr("x", colX(nCols - 1) + NODE_W + 10)
    .attr("y", (s) => {
      const n = node.get(`${nCols}|${s.st}`);
      return n.y + n.h / 2 + 3.5;
    })
    .text((s) => d3.format(".1%")(nodeN.get(`${nCols}|${s.st}`) / total));

  svg.append("text")
    .attr("x", colX(nCols - 1) + NODE_W + 10).attr("y", FM.top - 18)
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5).attr("fill", "#8A9AA1")
    .text("share at leg " + nCols);

  // leg numbers
  svg.append("g")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11).attr("fill", "#5A6E78")
    .selectAll("text")
    .data(legs)
    .join("text")
    .attr("x", (d, i) => colX(i) + NODE_W / 2)
    .attr("y", H_FLOW - FM.bottom + 20)
    .attr("text-anchor", "middle")
    .text((d) => d);

  svg.append("text")
    .attr("x", (FM.left + W - FM.right) / 2).attr("y", H_FLOW - 14)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11.5).attr("fill", "#5A6E78")
    .text("leg number within the aircraft's day");

  svg.append("text")
    .attr("x", FM.left - 10).attr("y", FM.top - 18)
    .attr("text-anchor", "end")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5).attr("fill", "#8A9AA1")
    .text("delay state");

  const coh = COHORTS.find((c) => c.key === state.cohort);
  const msg = state.trace
    ? `following the ${STATES[state.trace.st].label} group from leg ${state.trace.leg} — click it again to clear`
    : `${coh.label.toLowerCase()} · ${fmtInt(total)} rotations of ${nCols}+ legs `
      + `· click a band to follow it forward`;
  svg.append("text")
    .attr("x", FM.left).attr("y", FM.top - 18)
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11).attr("fill", "#8A9AA1")
    .text(msg);
}

/* ------------------------------------------------------------------ */
/* View 2 — the median curves                                          */
/* ------------------------------------------------------------------ */

const LM = { top: 24, right: 150, bottom: 52, left: 58 };

/* The decline within a group is not by itself evidence that the system
   absorbs delay. Groups are defined by how the FIRST leg ended, so a group
   selected on being extremely late at leg 1 would fall back at later legs even
   if nothing were ever recovered — regression to the mean, not recovery.

   What regression cannot explain is the distance between the groups, because
   every group regresses. Subtracting the on-time group at the same leg leaves
   the part of a morning delay that is still being carried. */
function withGap(rows) {
  const base = new Map();
  rows.filter((d) => d.start_group === "on time")
    .forEach((d) => base.set(`${d.haul}|${d.leg}`, d.median));
  return rows.map((d) => {
    const b = base.get(`${d.haul}|${d.leg}`);
    return { ...d, gap: b == null ? null : +(d.median - b).toFixed(2) };
  }).filter((d) => d.gap != null);
}

function renderLines(svg) {
  const metric = METRICS.find((m) => m.key === state.metric);
  let rows = LINES.filter((d) => d.haul === state.haul);
  if (metric.derived) rows = withGap(rows);

  if (!rows.length) {
    svg.append("text").attr("x", W / 2).attr("y", H_LINE / 2)
      .attr("text-anchor", "middle")
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 13).attr("fill", "#5A6E78")
      .text("No rotations in this category met the minimum sample size.");
    return;
  }

  const byGroup = d3.group(rows, (d) => d.start_group);
  const legs = [...new Set(rows.map((d) => d.leg))].sort(d3.ascending);
  const x = d3.scalePoint().domain(legs).range([LM.left, W - LM.right]).padding(0.5);

  const showBand = metric.band && state.isolated;
  const vals = [];
  rows.forEach((d) => {
    vals.push(d[metric.key]);
    if (showBand && d.start_group === state.isolated) vals.push(d.q25, d.q75);
  });
  const pad = (d3.max(vals) - d3.min(vals)) * 0.12 || 1;
  const y = d3.scaleLinear()
    .domain([d3.min(vals) - pad, d3.max(vals) + pad])
    .range([H_LINE - LM.bottom, LM.top]).nice();

  svg.append("g").selectAll("line")
    .data(y.ticks(6))
    .join("line")
    .attr("x1", LM.left).attr("x2", W - LM.right)
    .attr("y1", y).attr("y2", y)
    .attr("stroke", (d) => (d === 0 ? "#9AABB1" : "#E4E8E5"))
    .attr("stroke-width", (d) => (d === 0 ? 1.2 : 1));

  if (metric.key === "gap") {
    svg.append("text")
      .attr("x", LM.left + 8).attr("y", y(0) - 7)
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 11).attr("fill", "#8A9AA1")
      .text("on-time group, by definition");
  }

  const line = d3.line().x((d) => x(d.leg)).y((d) => y(d[metric.key]));
  const area = d3.area().x((d) => x(d.leg)).y0((d) => y(d.q25)).y1((d) => y(d.q75));

  GROUPS.forEach((g) => {
    const series = (byGroup.get(g.key) || []).slice().sort((a, b) => a.leg - b.leg);
    if (!series.length) return;
    const dim = state.isolated && state.isolated !== g.key;

    if (showBand && state.isolated === g.key) {
      svg.append("path").datum(series)
        .attr("d", area).attr("fill", g.color).attr("fill-opacity", 0.14);
    }
    svg.append("path").datum(series)
      .attr("d", line).attr("fill", "none")
      .attr("stroke", g.color)
      .attr("stroke-width", state.isolated === g.key ? 3 : 2)
      .attr("stroke-opacity", dim ? 0.18 : 1)
      .attr("stroke-linejoin", "round").attr("stroke-linecap", "round");

    svg.append("g").selectAll("circle")
      .data(series).join("circle")
      .attr("cx", (d) => x(d.leg)).attr("cy", (d) => y(d[metric.key]))
      .attr("r", 3.4).attr("fill", g.color)
      .attr("fill-opacity", dim ? 0.18 : 1)
      .attr("stroke", "#fff").attr("stroke-width", 1);
  });

  svg.append("g")
    .attr("transform", `translate(0,${H_LINE - LM.bottom})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(9))
    .call((g) => g.select(".domain").remove());

  svg.append("g")
    .attr("transform", `translate(${LM.left},0)`)
    .call(d3.axisLeft(y).ticks(6)
      .tickFormat(metric.key === "delay15_rate" ? d3.format(".0%") : d3.format("+.0f"))
      .tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").remove());

  svg.selectAll("g text")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11).attr("fill", "#5A6E78");

  svg.append("text")
    .attr("x", (LM.left + W - LM.right) / 2).attr("y", H_LINE - 14)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11.5).attr("fill", "#5A6E78")
    .text("leg number within the aircraft's day");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(LM.top + H_LINE - LM.bottom) / 2).attr("y", 15)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 11.5).attr("fill", "#5A6E78")
    .text(metric.label + (metric.key === "delay15_rate" ? "" : " (min)"));

  drawLineLegend(svg, byGroup, legs, metric);
  drawLineHover(svg, x, y, legs, byGroup, metric);
}

function drawLineLegend(svg, byGroup, legs, metric) {
  const lastLeg = legs[legs.length - 1];
  const g = svg.append("g")
    .attr("transform", `translate(${W - LM.right + 14}, ${LM.top + 4})`)
    .attr("font-family", "IBM Plex Sans, sans-serif");

  g.append("text").attr("y", -6).attr("font-size", 10.5).attr("fill", "#8A9AA1")
    .text("click to isolate");

  GROUPS.forEach((grp, i) => {
    const series = byGroup.get(grp.key) || [];
    const last = series.find((d) => d.leg === lastLeg);
    const dim = state.isolated && state.isolated !== grp.key;

    const row = g.append("g")
      .attr("transform", `translate(0,${i * 34 + 10})`)
      .style("cursor", "pointer")
      .on("click", () => {
        state.isolated = state.isolated === grp.key ? null : grp.key;
        render();
      });

    row.append("rect").attr("x", -4).attr("y", -10).attr("width", LM.right - 18)
      .attr("height", 30)
      .attr("fill", state.isolated === grp.key ? "#EEF2F3" : "transparent");
    row.append("line").attr("x1", 0).attr("x2", 16).attr("y1", 0).attr("y2", 0)
      .attr("stroke", grp.color).attr("stroke-width", 3)
      .attr("stroke-opacity", dim ? 0.25 : 1);
    row.append("text").attr("x", 22).attr("y", 3.5)
      .attr("font-size", 11).attr("fill", dim ? "#9AABB1" : "#17313D")
      .text(grp.label);
    if (last) {
      row.append("text").attr("x", 22).attr("y", 16)
        .attr("font-family", "IBM Plex Mono, monospace")
        .attr("font-size", 10).attr("fill", "#8A9AA1")
        .text(`leg ${lastLeg}: ${metric.fmt(last[metric.key])}`);
    }
  });
}

/* One guide line and one tooltip for the whole leg: the comparison a reader
   wants here is across the four groups at the same leg. */
function drawLineHover(svg, x, y, legs, byGroup, metric) {
  const guide = svg.append("line")
    .attr("y1", LM.top).attr("y2", H_LINE - LM.bottom)
    .attr("stroke", "#17313D").attr("stroke-width", 1)
    .attr("stroke-dasharray", "3 3").attr("opacity", 0);

  svg.append("rect")
    .attr("x", LM.left).attr("y", LM.top)
    .attr("width", W - LM.right - LM.left).attr("height", H_LINE - LM.bottom - LM.top)
    .attr("fill", "transparent")
    .style("cursor", "crosshair")
    .on("mousemove", function (e) {
      const mx = d3.pointer(e, this)[0];
      const leg = legs.reduce((best, l) =>
        Math.abs(x(l) - mx) < Math.abs(x(best) - mx) ? l : best, legs[0]);
      guide.attr("x1", x(leg)).attr("x2", x(leg)).attr("opacity", 0.5);

      const lines = GROUPS.map((g) => {
        const row = (byGroup.get(g.key) || []).find((d) => d.leg === leg);
        if (!row) return "";
        return `<span style="color:${g.color}">■</span> ${g.label}
                <b>${metric.fmt(row[metric.key])}</b>
                <span class="d">n=${fmtInt(row.n)}</span>`;
      }).filter(Boolean).join("<br>");

      showTip(e, `<span class="k">leg ${leg}</span><br>${lines}`);
    })
    .on("mouseleave", () => { guide.attr("opacity", 0); hideTip(); });
}