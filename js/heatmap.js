import { showTip, moveTip, hideTip, fmtInt, fmtMin, fmtPct, delayScale, rampLegend, DOW, fail } from "./shared.js";

const W = 960, H = 340;
const M = { top: 26, right: 18, bottom: 56, left: 46 };

export async function drawHeatmap() {
  const mount = document.querySelector("#viz-heatmap");
  try {
    const rows = (await d3.json("data/processed/hour_dow.json"))
      .filter(d => d.airport === "ALL");

    mount.innerHTML = "";
    const svg = d3.select(mount).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img")
      .attr("aria-label", "Heatmap of median arrival delay by scheduled departure hour and day of week");

    const hours = d3.range(0, 24);
    const x = d3.scaleBand().domain(hours).range([M.left, W - M.right]).padding(0.06);
    const y = d3.scaleBand().domain(d3.range(1, 8)).range([M.top, H - M.bottom]).padding(0.06);
    const color = delayScale(rows.map(d => d.median_delay));

    svg.append("g").selectAll("rect")
      .data(rows)
      .join("rect")
      .attr("x", d => x(d.hour))
      .attr("y", d => y(d.dow))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("fill", d => color(d.median_delay))
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => showTip(e, `
        <span class="k">${DOW[d.dow - 1]} ${String(d.hour).padStart(2, "0")}:00</span><br>
        <span class="d">median arrival delay</span> ${fmtMin(d.median_delay)}<br>
        <span class="d">delayed 15+ min</span> ${fmtPct(d.delay15_rate)}<br>
        <span class="d">flights</span> ${fmtInt(d.n)}`))
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);

    svg.append("g")
      .attr("transform", `translate(0,${H - M.bottom})`)
      .call(d3.axisBottom(x).tickValues(hours.filter(h => h % 3 === 0))
        .tickFormat(h => String(h).padStart(2, "0")).tickSize(0).tickPadding(7))
      .call(g => g.select(".domain").remove());

    svg.append("g")
      .attr("transform", `translate(${M.left},0)`)
      .call(d3.axisLeft(y).tickFormat(d => DOW[d - 1]).tickSize(0).tickPadding(7))
      .call(g => g.select(".domain").remove());

    svg.selectAll("text").attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 10.5).attr("fill", "#5A6E78");

    svg.append("text")
      .attr("x", M.left).attr("y", 14)
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 10.5).attr("fill", "#5A6E78")
      .text("Scheduled departure hour, local time");

    rampLegend(
      svg.append("g")
        .attr("transform", `translate(${M.left}, ${H - 34})`)
        .attr("font-family", "IBM Plex Sans, sans-serif")
        .attr("font-size", 10).attr("fill", "#5A6E78"),
      color, { width: 170, height: 8 });
  } catch (err) {
    fail("#viz-heatmap", err);
  }
}