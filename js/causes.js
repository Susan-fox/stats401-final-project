import { showTip, moveTip, hideTip, fmtInt, fmtPct, CAUSE_KEYS, fail } from "./shared.js";

const W = 960;
const M = { top: 34, right: 22, bottom: 24, left: 96 };
const ROW = 27;

export async function drawCauses() {
  const mount = document.querySelector("#viz-causes");
  try {
    const data = (await d3.json("data/processed/causes.json"))
      .sort((a, b) => b.late_aircraft_share - a.late_aircraft_share);

    const H = M.top + M.bottom + data.length * ROW;
    mount.innerHTML = "";
    const svg = d3.select(mount).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img")
      .attr("aria-label", "Normalized stacked bars showing the share of delay minutes by reported cause for each carrier");

    const x = d3.scaleLinear().domain([0, 1]).range([M.left, W - M.right]);
    const y = d3.scaleBand().domain(data.map(d => d.name))
      .range([M.top, H - M.bottom]).padding(0.24);

    const series = d3.stack()
      .keys(CAUSE_KEYS.map(c => c.key + "_share"))(data);

    svg.append("g").selectAll("g")
      .data(series)
      .join("g")
      .attr("fill", (d, i) => CAUSE_KEYS[i].color)
      .selectAll("rect")
      .data((d, i) => d.map(v => ({ ...v, idx: i, cause: CAUSE_KEYS[i] })))
      .join("rect")
      .attr("x", d => x(d[0]))
      .attr("y", d => y(d.data.name))
      // a wider gap after the second segment marks where the airline's own
      // operation ends and outside conditions begin
      .attr("width", d => Math.max(0, x(d[1]) - x(d[0]) - (d.idx === 1 ? 4 : 1)))
      .attr("height", y.bandwidth())
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => {
        const internal = (d.data.late_aircraft_share || 0) + (d.data.carrier_share || 0);
        showTip(e, `
          <span class="k">${d.data.name}</span><br>
          <span class="d">${d.cause.label}</span> ${fmtPct(d[1] - d[0])}<br>
          <span class="d">airline's own operation</span> ${fmtPct(internal)}<br>
          <span class="d">delayed flights</span> ${fmtInt(d.data.delayed_flights)}`);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);

    svg.append("g")
      .attr("transform", `translate(${M.left},0)`)
      .call(d3.axisLeft(y).tickSize(0).tickPadding(8))
      .call(g => g.select(".domain").remove());

    svg.append("g")
      .attr("transform", `translate(0,${M.top - 10})`)
      .call(d3.axisTop(x).ticks(5, "%").tickSize(0).tickPadding(4))
      .call(g => g.select(".domain").remove());

    svg.selectAll("text").attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 11).attr("fill", "#5A6E78");

    renderLegend("#legend-causes");
  } catch (err) {
    fail("#viz-causes", err);
  }
}

/* The hero ribbon: one normalized bar for the whole year. */
export async function drawRibbon(summary) {
  const svg = d3.select("#cause-ribbon");
  const node = svg.node();
  if (!node) return;
  const w = node.clientWidth || 800, h = 76;
  svg.attr("viewBox", `0 0 ${w} ${h}`);

  const shares = CAUSE_KEYS.map(c => ({ ...c, v: summary.cause_share[c.key] || 0 }));
  let acc = 0;
  const laid = shares.map((s, i) => {
    const o = { ...s, i, x0: acc, x1: acc + s.v };
    acc = o.x1;
    return o;
  });
  const x = d3.scaleLinear().domain([0, 1]).range([0, w]);

  svg.selectAll("rect.seg").data(laid).join("rect")
    .attr("class", "seg")
    .attr("x", d => x(d.x0)).attr("y", 18)
    .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - (d.i === 1 ? 5 : 1)))
    .attr("height", 30)
    .attr("fill", d => d.color)
    .on("mouseenter", (e, d) => showTip(e, `<span class="k">${d.label}</span><br>${fmtPct(d.v)} of delay minutes`))
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip);

  const internal = laid[0].v + laid[1].v;
  svg.append("text")
    .attr("x", 0).attr("y", 12)
    .attr("font-family", "IBM Plex Mono, monospace").attr("font-size", 10.5).attr("fill", "#5A6E78")
    .text(`the airline's own operation — ${d3.format(".1%")(internal)}`);
  svg.append("text")
    .attr("x", x(internal) + 6).attr("y", 12)
    .attr("font-family", "IBM Plex Mono, monospace").attr("font-size", 10.5).attr("fill", "#5A6E78")
    .text(`outside it — ${d3.format(".1%")(1 - internal)}`);

  svg.selectAll("text.lbl").data(laid.filter(d => d.v > 0.07)).join("text")
    .attr("class", "lbl")
    .attr("x", d => x(d.x0) + 6).attr("y", 66)
    .attr("font-family", "IBM Plex Mono, monospace").attr("font-size", 10.5).attr("fill", "#5A6E78")
    .text(d => `${d.label} ${fmtPct(d.v)}`);
}

export function renderLegend(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  const swatch = c =>
    `<span><i style="background:${c.color}"></i>${c.label}</span>`;
  el.innerHTML =
    `<span style="color:#17313D">Airline's own operation</span>` +
    CAUSE_KEYS.filter(c => c.group === "internal").map(swatch).join("") +
    `<span style="color:#17313D;margin-left:0.6rem">Outside it</span>` +
    CAUSE_KEYS.filter(c => c.group !== "internal").map(swatch).join("");
}