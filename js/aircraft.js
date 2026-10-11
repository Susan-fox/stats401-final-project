import {
  showTip,
  moveTip,
  hideTip,
  fmtMin,
  fail
} from "./shared.js";

const W = 960;
const H = 470;

const M = {
  top: 80,
  right: 40,
  bottom: 70,
  left: 95
};

function hhmmToMinutes(v) {
  if (v === null || v === undefined || Number.isNaN(+v)) {
    return null;
  }

  let n = +v;

  if (n === 2400) {
    return 24 * 60;
  }

  const h = Math.floor(n / 100);
  const m = n % 100;

  return h * 60 + m;
}

function minutesToClock(v) {
  let minutes = Math.round(v);

  while (minutes < 0) {
    minutes += 24 * 60;
  }

  const days = Math.floor(minutes / (24 * 60));
  const within = minutes % (24 * 60);

  const h = Math.floor(within / 60);
  const m = within % 60;

  const base = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  return days > 0
    ? `${base} +${days}d`
    : base;
}

function delayLabel(v) {
  if (v === null || v === undefined || Number.isNaN(+v)) {
    return "—";
  }

  const n = +v;

  if (n > 0) {
    return `+${n.toFixed(0)} min`;
  }

  if (n < 0) {
    return `${n.toFixed(0)} min`;
  }

  return "on time";
}

function normalizeLegTimes(legs) {
  let previousScheduledDeparture = null;
  let dayOffset = 0;

  return legs.map((leg, i) => {
    let schedDep = hhmmToMinutes(leg.scheduled_departure);
    let schedArr = hhmmToMinutes(leg.scheduled_arrival);

    if (schedDep === null || schedArr === null) {
      return null;
    }

    if (
      previousScheduledDeparture !== null &&
      schedDep + dayOffset < previousScheduledDeparture
    ) {
      dayOffset += 24 * 60;
    }

    schedDep += dayOffset;
    schedArr += dayOffset;

    if (schedArr < schedDep) {
      schedArr += 24 * 60;
    }

    const depDelay = Number.isFinite(+leg.departure_delay)
      ? +leg.departure_delay
      : 0;

    const arrDelay = Number.isFinite(+leg.arrival_delay)
      ? +leg.arrival_delay
      : 0;

    const actualDep = schedDep + depDelay;
    const actualArr = schedArr + arrDelay;

    previousScheduledDeparture = schedDep;

    return {
      ...leg,
      legIndex: i,
      schedDep,
      schedArr,
      actualDep,
      actualArr
    };
  }).filter(Boolean);
}

export async function drawAircraft() {
  const mount = document.querySelector("#viz-aircraft");

  try {
    const payload = await d3.json("data/processed/aircraft_chains.json");

    const chains = payload.chains || [];

    if (!chains.length) {
      mount.innerHTML = `
        <div class="loading">
          No aircraft-chain data available.
        </div>
      `;
      return;
    }

    mount.innerHTML = "";

    // ============================================================
    // Controls
    // ============================================================

    const controls = d3.select(mount)
      .append("div")
      .style("display", "flex")
      .style("gap", "12px")
      .style("align-items", "center")
      .style("flex-wrap", "wrap")
      .style("margin", "0 0 14px 0");

    controls.append("label")
      .attr("for", "aircraft-chain-select")
      .style("font-size", "13px")
      .style("font-weight", "600")
      .text("Aircraft-day:");

    const select = controls.append("select")
      .attr("id", "aircraft-chain-select")
      .style("padding", "6px 8px")
      .style("font-size", "13px")
      .style("border", "1px solid #CBD5D9")
      .style("border-radius", "4px")
      .style("background", "#fff");

    select.selectAll("option")
      .data(chains)
      .join("option")
      .attr("value", d => d.chain_id)
      .text(d =>
        `${d.date} · ${d.tail} · ${d.carrier_name} · ${d.n_legs} legs`
      );

    const note = controls.append("span")
      .style("font-size", "12px")
      .style("color", "#657983");

    if (payload.selection_rule) {
      note.text("Selected reproducibly from high-activity aircraft-days.");
    }

    // ============================================================
    // SVG
    // ============================================================

    const svg = d3.select(mount)
      .append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img")
      .attr(
        "aria-label",
        "Aircraft daily flight chain showing scheduled and actual flight times and arrival delay across sequential legs"
      );

    const root = svg.append("g");

    function render(chain) {
      root.selectAll("*").remove();

      const legs = normalizeLegTimes(chain.legs || []);

      if (!legs.length) {
        return;
      }

      const minTime = d3.min(
        legs,
        d => Math.min(d.schedDep, d.actualDep)
      );

      const maxTime = d3.max(
        legs,
        d => Math.max(d.schedArr, d.actualArr)
      );

      const x = d3.scaleLinear()
        .domain([
          Math.floor((minTime - 20) / 60) * 60,
          Math.ceil((maxTime + 20) / 60) * 60
        ])
        .range([
          M.left,
          W - M.right
        ]);

      const rowHeight = 42;

      const y = d3.scaleBand()
        .domain(legs.map(d => d.legIndex))
        .range([
          M.top,
          Math.min(
            H - M.bottom,
            M.top + legs.length * rowHeight
          )
        ])
        .padding(0.28);

      // ========================================================
      // Title
      // ========================================================

      root.append("text")
        .attr("x", M.left)
        .attr("y", 22)
        .attr("font-size", 15)
        .attr("font-weight", 700)
        .attr("fill", "#17313D")
        .text(
          `${chain.carrier_name} · Tail ${chain.tail} · ${chain.date}`
        );

      root.append("text")
        .attr("x", M.left)
        .attr("y", 43)
        .attr("font-size", 11.5)
        .attr("fill", "#657983")
        .text(
          `${chain.n_legs} legs · ${chain.start_airport} → ${chain.end_airport} · max arrival delay ${delayLabel(chain.max_arrival_delay)}`
        );

      // ========================================================
      // Vertical time grid
      // ========================================================

      const hourTicks = d3.range(
        Math.ceil(x.domain()[0] / 60) * 60,
        x.domain()[1] + 1,
        60
      );

      root.append("g")
        .selectAll("line")
        .data(hourTicks)
        .join("line")
        .attr("x1", d => x(d))
        .attr("x2", d => x(d))
        .attr("y1", M.top - 10)
        .attr("y2", H - M.bottom)
        .attr("stroke", "#E5E9E7")
        .attr("stroke-width", 1);

      root.append("g")
        .selectAll("text")
        .data(hourTicks)
        .join("text")
        .attr("x", d => x(d))
        .attr("y", H - M.bottom + 25)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#6C7E86")
        .text(d => minutesToClock(d));

      // ========================================================
      // Airport labels / leg labels
      // ========================================================

      root.append("g")
        .selectAll("text")
        .data(legs)
        .join("text")
        .attr("x", M.left - 12)
        .attr("y", d =>
          y(d.legIndex) + y.bandwidth() / 2 + 4
        )
        .attr("text-anchor", "end")
        .attr("font-size", 11)
        .attr("font-weight", 600)
        .attr("fill", "#314A55")
        .text(d =>
          `${d.origin} → ${d.dest}`
        );

      // ========================================================
      // Row baselines
      // ========================================================

      root.append("g")
        .selectAll("line")
        .data(legs)
        .join("line")
        .attr("x1", M.left)
        .attr("x2", W - M.right)
        .attr("y1", d =>
          y(d.legIndex) + y.bandwidth() / 2
        )
        .attr("y2", d =>
          y(d.legIndex) + y.bandwidth() / 2
        )
        .attr("stroke", "#F0F2F1")
        .attr("stroke-width", 1);

      // ========================================================
      // Scheduled flight bars
      // ========================================================

      root.append("g")
        .selectAll("rect.scheduled")
        .data(legs)
        .join("rect")
        .attr("class", "scheduled")
        .attr("x", d => x(d.schedDep))
        .attr("y", d =>
          y(d.legIndex) + y.bandwidth() * 0.12
        )
        .attr("width", d =>
          Math.max(
            2,
            x(d.schedArr) - x(d.schedDep)
          )
        )
        .attr("height", y.bandwidth() * 0.28)
        .attr("rx", 2)
        .attr("fill", "#BBC6CB");

      // ========================================================
      // Actual flight bars
      // ========================================================

      root.append("g")
        .selectAll("rect.actual")
        .data(legs)
        .join("rect")
        .attr("class", "actual")
        .attr("x", d => x(d.actualDep))
        .attr("y", d =>
          y(d.legIndex) + y.bandwidth() * 0.58
        )
        .attr("width", d =>
          Math.max(
            2,
            x(d.actualArr) - x(d.actualDep)
          )
        )
        .attr("height", y.bandwidth() * 0.28)
        .attr("rx", 2)
        .attr("fill", d => {
          if (+d.arrival_delay >= 30) {
            return "#B4006E";
          }

          if (+d.arrival_delay >= 15) {
            return "#D76A9D";
          }

          if (+d.arrival_delay > 0) {
            return "#E6A9C4";
          }

          return "#5E8A76";
        })
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
          d3.select(this)
            .attr("stroke", "#17313D")
            .attr("stroke-width", 1.5);

          showTip(event, `
            <span class="k">${d.origin} → ${d.dest}</span><br>
            <span class="d">leg</span> ${d.leg_order}<br>
            <span class="d">scheduled</span>
            ${minutesToClock(d.schedDep)}–${minutesToClock(d.schedArr)}<br>
            <span class="d">actual</span>
            ${minutesToClock(d.actualDep)}–${minutesToClock(d.actualArr)}<br>
            <span class="d">departure delay</span>
            ${delayLabel(d.departure_delay)}<br>
            <span class="d">arrival delay</span>
            ${delayLabel(d.arrival_delay)}<br>
            <span class="d">distance</span>
            ${Math.round(+d.distance || 0).toLocaleString()} miles
          `);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", function() {
          d3.select(this)
            .attr("stroke", "none");

          hideTip();
        });

      // ========================================================
      // Arrival delay markers
      // ========================================================

      root.append("g")
        .selectAll("circle.delay")
        .data(legs)
        .join("circle")
        .attr("class", "delay")
        .attr("cx", d => x(d.actualArr))
        .attr("cy", d =>
          y(d.legIndex) + y.bandwidth() * 0.72
        )
        .attr("r", 4)
        .attr("fill", d =>
          +d.arrival_delay >= 15
            ? "#B4006E"
            : "#5E8A76"
        )
        .attr("stroke", "#fff")
        .attr("stroke-width", 1);

      // ========================================================
      // Delay text at right
      // ========================================================

      root.append("g")
        .selectAll("text.delay-label")
        .data(legs)
        .join("text")
        .attr("class", "delay-label")
        .attr("x", W - M.right)
        .attr("y", d =>
          y(d.legIndex) + y.bandwidth() / 2 + 4
        )
        .attr("text-anchor", "end")
        .attr("font-size", 10.5)
        .attr("font-family", "IBM Plex Mono, monospace")
        .attr("fill", d =>
          +d.arrival_delay >= 15
            ? "#B4006E"
            : "#5E6F77"
        )
        .text(d =>
          delayLabel(d.arrival_delay)
        );

      // ========================================================
      // Sequence connector
      // ========================================================

      for (let i = 0; i < legs.length - 1; i++) {
        const a = legs[i];
        const b = legs[i + 1];

        const x1 = x(a.actualArr);
        const y1 =
          y(a.legIndex) + y.bandwidth() * 0.72;

        const x2 = x(b.actualDep);
        const y2 =
          y(b.legIndex) + y.bandwidth() * 0.72;

        root.append("path")
          .attr(
            "d",
            `M${x1},${y1}
             C${x1 + 18},${y1}
              ${x2 - 18},${y2}
              ${x2},${y2}`
          )
          .attr("fill", "none")
          .attr("stroke", "#A7B4BA")
          .attr("stroke-width", 1.25)
          .attr("stroke-dasharray", "3,3");
      }

      // ========================================================
      // Legend
      // ========================================================

      const legend = root.append("g")
        .attr(
          "transform",
          `translate(${W - 360}, 24)`
        );

      legend.append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", 34)
        .attr("height", 6)
        .attr("fill", "#BBC6CB");

      legend.append("text")
        .attr("x", 42)
        .attr("y", 7)
        .attr("font-size", 10.5)
        .attr("fill", "#657983")
        .text("scheduled");

      legend.append("rect")
        .attr("x", 110)
        .attr("y", 0)
        .attr("width", 34)
        .attr("height", 6)
        .attr("fill", "#B4006E");

      legend.append("text")
        .attr("x", 152)
        .attr("y", 7)
        .attr("font-size", 10.5)
        .attr("fill", "#657983")
        .text("actual, 15+ min late");

      legend.append("rect")
        .attr("x", 270)
        .attr("y", 0)
        .attr("width", 34)
        .attr("height", 6)
        .attr("fill", "#5E8A76");

      legend.append("text")
        .attr("x", 312)
        .attr("y", 7)
        .attr("font-size", 10.5)
        .attr("fill", "#657983")
        .text("actual, near/on time");
    }

    // ============================================================
    // Initial chain
    // ============================================================

    render(chains[0]);

    // ============================================================
    // Dropdown interaction
    // ============================================================

    select.on("change", function() {
      const id = this.value;

      const chain = chains.find(
        d => d.chain_id === id
      );

      if (chain) {
        render(chain);
      }
    });

  } catch (err) {
    fail("#viz-aircraft", err);
  }
}
