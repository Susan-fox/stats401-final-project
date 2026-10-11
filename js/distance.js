import {
  showTip,
  moveTip,
  hideTip,
  fmtInt,
  fmtPct,
  fmtMin,
  fail
} from "./shared.js";

const W = 960;
const H = 410;

const M = {
  top: 34,
  right: 32,
  bottom: 74,
  left: 68
};

export async function drawDistance() {
  const mount = document.querySelector("#viz-distance");

  try {
    const data = (await d3.json("data/processed/distance_delay.json"))
      .sort((a, b) => a.ord - b.ord);

    mount.innerHTML = "";

    const svg = d3.select(mount)
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img")
      .attr(
        "aria-label",
        "Arrival delay distribution by flight distance, showing median, interquartile range, 90th percentile, and flight volume"
      );

    const x = d3.scaleBand()
      .domain(data.map(d => d.bin))
      .range([M.left, W - M.right])
      .padding(0.34);

    const yMin = Math.min(-25, d3.min(data, d => d.q25) - 5);
    const yMax = Math.max(55, d3.max(data, d => d.p90) + 5);

    const y = d3.scaleLinear()
      .domain([yMin, yMax])
      .nice()
      .range([H - M.bottom, M.top]);

    const size = d3.scaleSqrt()
      .domain([0, d3.max(data, d => d.n)])
      .range([4, 11]);

    // Horizontal reference line at zero delay.
    svg.append("line")
      .attr("x1", M.left)
      .attr("x2", W - M.right)
      .attr("y1", y(0))
      .attr("y2", y(0))
      .attr("stroke", "#8FA0A8")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,4");

    svg.append("text")
      .attr("x", W - M.right)
      .attr("y", y(0) - 6)
      .attr("text-anchor", "end")
      .attr("font-family", "IBM Plex Mono, monospace")
      .attr("font-size", 10)
      .attr("fill", "#7C8C94")
      .text("on time");

    // Light grid lines.
    svg.append("g")
      .attr("transform", `translate(${M.left},0)`)
      .call(
        d3.axisLeft(y)
          .ticks(7)
          .tickSize(-(W - M.left - M.right))
          .tickFormat("")
      )
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line")
        .attr("stroke", "#E1E6E3")
        .attr("stroke-width", 1));

    // 90th-percentile extension.
    svg.append("g")
      .selectAll("line.p90")
      .data(data)
      .join("line")
      .attr("class", "p90")
      .attr("x1", d => x(d.bin) + x.bandwidth() / 2)
      .attr("x2", d => x(d.bin) + x.bandwidth() / 2)
      .attr("y1", d => y(d.q75))
      .attr("y2", d => y(d.p90))
      .attr("stroke", "#B8C1C5")
      .attr("stroke-width", 2);

    // Interquartile range: Q25 to Q75.
    svg.append("g")
      .selectAll("line.iqr")
      .data(data)
      .join("line")
      .attr("class", "iqr")
      .attr("x1", d => x(d.bin) + x.bandwidth() / 2)
      .attr("x2", d => x(d.bin) + x.bandwidth() / 2)
      .attr("y1", d => y(d.q25))
      .attr("y2", d => y(d.q75))
      .attr("stroke", "#5C7C92")
      .attr("stroke-width", 8)
      .attr("stroke-linecap", "round");

    // Median points.
    svg.append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", d => x(d.bin) + x.bandwidth() / 2)
      .attr("cy", d => y(d.median))
      .attr("r", d => size(d.n))
      .attr("fill", "#B4006E")
      .attr("stroke", "#FFFFFF")
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", function(event, d) {
        d3.select(this)
          .attr("stroke", "#17313D")
          .attr("stroke-width", 2);

        showTip(event, `
          <span class="k">${d.bin} miles</span><br>
          <span class="d">flights</span> ${fmtInt(d.n)}<br>
          <span class="d">median arrival delay</span> ${fmtMin(d.median)}<br>
          <span class="d">middle 50%</span> ${fmtMin(d.q25)} to ${fmtMin(d.q75)}<br>
          <span class="d">90th percentile</span> ${fmtMin(d.p90)}<br>
          <span class="d">delayed 15+ min</span> ${fmtPct(d.delay15_rate)}<br>
          <span class="d">late-aircraft share</span> ${fmtPct(d.late_aircraft_share)}
        `);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", function() {
        d3.select(this)
          .attr("stroke", "#FFFFFF")
          .attr("stroke-width", 1.5);

        hideTip();
      });

    // X axis.
    svg.append("g")
      .attr("transform", `translate(0,${H - M.bottom})`)
      .call(
        d3.axisBottom(x)
          .tickSize(0)
          .tickPadding(10)
      )
      .call(g => g.select(".domain").remove());

    // Y axis.
    svg.append("g")
      .attr("transform", `translate(${M.left},0)`)
      .call(
        d3.axisLeft(y)
          .ticks(7)
          .tickSize(0)
          .tickPadding(8)
      )
      .call(g => g.select(".domain").remove());

    svg.selectAll("text")
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("fill", "#5A6E78");

    // Axis labels.
    svg.append("text")
      .attr("x", M.left)
      .attr("y", 18)
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 10.5)
      .attr("fill", "#5A6E78")
      .text("Arrival delay, minutes");

    svg.append("text")
      .attr("x", (M.left + W - M.right) / 2)
      .attr("y", H - 22)
      .attr("text-anchor", "middle")
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 10.5)
      .attr("fill", "#5A6E78")
      .text("Flight distance, miles");

    // Legend.
    const legend = svg.append("g")
      .attr("transform", `translate(${W - 330}, 20)`)
      .attr("font-family", "IBM Plex Sans, sans-serif")
      .attr("font-size", 10.5)
      .attr("fill", "#5A6E78");

    legend.append("line")
      .attr("x1", 0)
      .attr("x2", 0)
      .attr("y1", 0)
      .attr("y2", 24)
      .attr("stroke", "#5C7C92")
      .attr("stroke-width", 8)
      .attr("stroke-linecap", "round");

    legend.append("text")
      .attr("x", 12)
      .attr("y", 15)
      .text("middle 50% of flights");

    legend.append("circle")
      .attr("cx", 150)
      .attr("cy", 12)
      .attr("r", 6)
      .attr("fill", "#B4006E");

    legend.append("text")
      .attr("x", 162)
      .attr("y", 15)
      .text("median");

    legend.append("line")
      .attr("x1", 232)
      .attr("x2", 232)
      .attr("y1", 0)
      .attr("y2", 24)
      .attr("stroke", "#B8C1C5")
      .attr("stroke-width", 2);

    legend.append("text")
      .attr("x", 244)
      .attr("y", 15)
      .text("to 90th percentile");

  } catch (err) {
    fail("#viz-distance", err);
  }
}
