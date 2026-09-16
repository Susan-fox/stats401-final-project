import {
  showTip, moveTip, hideTip, fmtInt, fmtMin, fmtPct,
  sequentialScale, rampLegend, RAMP_BLUE, fail,
} from "./shared.js";

const W = 960, H = 600;
const LABEL_N = 14;          // how many airports get a text label
const DOT = "#d4b5c4";       // pink, for the airport circles
const PAPER = "#FFFFFF";

export async function drawMap() {
  const mount = document.querySelector("#viz-map");
  try {
    const [airports, us] = await Promise.all([
      d3.json("data/processed/airports.json"),
      d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"),
    ]);

    mount.innerHTML = "";
    const svg = d3.select(mount).append("svg")
      .attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img")
      .attr("aria-label", "US states shaded by the share of flights arriving 15 or more minutes late, with every reporting airport overlaid as a circle sized by departures");

    const states = topojson.feature(us, us.objects.states);
    const projection = d3.geoAlbersUsa().fitExtent([[22, 22], [W - 54, H - 108]], states);
    const path = d3.geoPath(projection);

    /* Which state is each airport in?
       Derived here from the state polygons rather than from a column in the
       data, so there is no state-name spelling to match and no pipeline change
       to keep in sync. Airports outside the 50 states (PR, USVI) simply find
       no containing polygon and drop out of the state totals. */
    const feats = states.features;
    airports.forEach(a => {
      const f = feats.find(ft => d3.geoContains(ft, [a.lon, a.lat]));
      a.stateName = f ? f.properties.name : null;
    });

    /* ---- layer 1: states carry the delay measure ----
       Circles used to carry volume and delay at once, which made the busy
       corridors unreadable and left the land area blank. Each mark now has one
       job. State values are flight-weighted, so a state is not swung by one
       small airport. */
    const byState = d3.rollup(
      airports.filter(d => d.stateName),
      v => {
        const f = d3.sum(v, d => d.flights);
        return {
          flights: f,
          delay15: d3.sum(v, d => d.delay15_rate * d.flights) / f,
          airports: v.length,
          worst: v.slice().sort((a, b) => b.delay15_rate - a.delay15_rate)[0],
        };
      },
      d => d.stateName
    );

    if (!byState.size) console.warn("no airport matched a state polygon — check lat/lon in airports.json");

    const stateColor = sequentialScale([...byState.values()].map(d => d.delay15), RAMP_BLUE);

    svg.append("g")
      .selectAll("path")
      .data(feats)
      .join("path")
      .attr("d", path)
      .attr("fill", d => {
        const s = byState.get(d.properties.name);
        return s ? stateColor(s.delay15) : "#EDF1F4";
      })
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => {
        const s = byState.get(d.properties.name);
        if (!s) return showTip(e, `<span class="k">${d.properties.name}</span><br><span class="d">no reporting airport</span>`);
        showTip(e, `
          <span class="k">${d.properties.name}</span><br>
          <span class="d">flights delayed 15+ min</span> ${fmtPct(s.delay15)}<br>
          <span class="d">departures</span> ${fmtInt(s.flights)}<br>
          <span class="d">reporting airports</span> ${s.airports}<br>
          <span class="d">worst in state</span> ${s.worst.iata} ${fmtPct(s.worst.delay15_rate)}`);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);

    svg.append("path")
      .datum(topojson.mesh(us, us.objects.states, (a, b) => a !== b))
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", PAPER)
      .attr("stroke-width", 0.9)
      .attr("stroke-linejoin", "round");

    /* ---- layer 2: every reporting airport, sized by volume only ----
       All of them, not just the big ones — the small fields are part of the
       picture. A floor on the radius keeps the smallest from vanishing, and
       the big ones are drawn first so small circles stay visible on top. */
    const pts = airports
      .map(d => ({ ...d, xy: projection([d.lon, d.lat]) }))
      .filter(d => d.xy)
      .sort((a, b) => b.flights - a.flights);

    const r = d3.scaleSqrt().domain([0, d3.max(pts, d => d.flights)]).range([0, 21]);
    const rr = d => Math.max(1.6, r(d.flights));

    svg.append("g")
      .selectAll("circle")
      .data(pts)
      .join("circle")
      .attr("cx", d => d.xy[0])
      .attr("cy", d => d.xy[1])
      .attr("r", rr)
      .attr("fill", DOT)
      .attr("fill-opacity", 0.72)
      .attr("stroke", PAPER)
      .attr("stroke-width", 0.8)
      .style("cursor", "pointer")
      .on("mouseenter", function (e, d) {
        d3.select(this).attr("fill-opacity", 1);
        showTip(e, `
          <span class="k">${d.iata}</span> ${d.city || ""}<br>
          <span class="d">departures</span> ${fmtInt(d.flights)}<br>
          <span class="d">delayed 15+ min</span> ${fmtPct(d.delay15_rate)}<br>
          <span class="d">median arrival delay</span> ${fmtMin(d.median_delay)}<br>
          <span class="d">90th percentile</span> ${fmtMin(d.p90_delay)}<br>
          <span class="d">cancelled</span> ${fmtPct(d.cancel_rate)}<br>
          <span class="d">late-aircraft share</span> ${fmtPct(d.late_aircraft_share)}`);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", function () {
        d3.select(this).attr("fill-opacity", 0.72);
        hideTip();
      });

    svg.append("g")
      .attr("font-family", "IBM Plex Mono, monospace")
      .attr("font-size", 10)
      .attr("fill", "#1B3B52")
      .attr("pointer-events", "none")
      .selectAll("text")
      .data(pts.slice(0, LABEL_N))
      .join("text")
      .attr("x", d => Math.min(Math.max(d.xy[0], 22), W - 22))
      .attr("y", d => d.xy[1] - rr(d) - 5)
      .attr("text-anchor", d => d.xy[0] > W - 70 ? "end" : (d.xy[0] < 70 ? "start" : "middle"))
      .attr("paint-order", "stroke")
      .attr("stroke", PAPER)
      .attr("stroke-width", 3)
      .text(d => d.iata);

    drawLegend(svg, r, stateColor, pts.length);
  } catch (err) {
    fail("#viz-map", err);
  }
}

function drawLegend(svg, r, stateColor, n) {
  const g = svg.append("g")
    .attr("transform", `translate(32, ${H - 80})`)
    .attr("font-family", "IBM Plex Sans, sans-serif")
    .attr("font-size", 10.5)
    .attr("fill", "#5A6E78");

  rampLegend(g, stateColor, {
    width: 185,
    title: "Flights delayed 15+ min, by state",
    format: d3.format(".0%"),
    sub: "flight-weighted across the state's airports",
  });

  const sg = g.append("g").attr("transform", "translate(248, 0)");
  sg.append("text").attr("y", -6).text(`Departures, all ${n} reporting airports`);
  const ticks = [10000, 100000, 300000].filter(t => t <= r.domain()[1]);
  let x = 0;
  ticks.forEach(t => {
    const rad = Math.max(1.6, r(t));
    sg.append("circle").attr("cx", x + rad).attr("cy", 30).attr("r", rad)
      .attr("fill", DOT).attr("fill-opacity", 0.72)
      .attr("stroke", PAPER).attr("stroke-width", 0.8);
    sg.append("text").attr("x", x + rad).attr("y", 58).attr("text-anchor", "middle")
      .text(d3.format(".0s")(t));
    x += rad * 2 + 24;
  });
}