/* shared helpers used by all charts */


/* ============================================================
   GLOBAL EVENTS
============================================================ */

export const AIRPORT_SELECT_EVENT = "stats401:airport-select";


/* ============================================================
   CAUSE PALETTE
============================================================ */

export const CAUSE_KEYS = [
  {
    key: "late_aircraft",
    label: "Late inbound aircraft",
    color: "#5C7C92",
    group: "internal"
  },
  {
    key: "carrier",
    label: "Carrier",
    color: "#9FB6C4",
    group: "internal"
  },
  {
    key: "nas",
    label: "National airspace",
    color: "#B08D8A",
    group: "external"
  },
  {
    key: "weather",
    label: "Weather",
    color: "#D9C3B8",
    group: "external"
  },
  {
    key: "security",
    label: "Security",
    color: "#C8C6BE",
    group: "other"
  }
];


/* ============================================================
   COLOR SCALE
============================================================ */

export const RAMP_BLUE = [
  "#EAF2F8",
  "#AECBE2",
  "#6295C0",
  "#4d83b0"
];


export const DOW = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun"
];


/* ============================================================
   TOOLTIP
============================================================ */

const tip = document.getElementById("tip");


export function showTip(event, html) {

  tip.innerHTML = html;

  tip.style.opacity = 1;

  moveTip(event);
}


export function moveTip(event) {

  const pad = 14;

  let x = event.pageX + pad;

  let y = event.pageY + pad;


  const w = tip.offsetWidth;

  const h = tip.offsetHeight;


  if (
    x + w >
    window.scrollX +
      document.documentElement.clientWidth -
      8
  ) {

    x =
      event.pageX -
      w -
      pad;
  }


  if (
    y + h >
    window.scrollY +
      document.documentElement.clientHeight -
      8
  ) {

    y =
      event.pageY -
      h -
      pad;
  }


  tip.style.left =
    x + "px";

  tip.style.top =
    y + "px";
}


export function hideTip() {

  tip.style.opacity = 0;
}


/* ============================================================
   FORMATTERS
============================================================ */

export const fmtInt =
  d3.format(",d");


export const fmtPct =
  d3.format(".1%");


export const fmtMin = (v) => {

  if (
    v === null ||
    v === undefined ||
    Number.isNaN(+v)
  ) {
    return "—";
  }

  return (
    (+v > 0 ? "+" : "") +
    d3.format(".1f")(+v) +
    " min"
  );
};


/* ============================================================
   SEQUENTIAL SCALE
============================================================ */

export function sequentialScale(
  values,
  palette = RAMP_BLUE
) {

  const sorted = values
    .filter(
      v =>
        v != null &&
        !isNaN(v)
    )
    .sort(d3.ascending);


  let lo =
    d3.quantile(
      sorted,
      0.02
    );


  let hi =
    d3.quantile(
      sorted,
      0.98
    );


  if (!(hi > lo)) {

    lo =
      d3.min(sorted) ??
      0;

    hi =
      lo + 1;
  }


  const n =
    palette.length;


  const domain =
    d3.range(n)
      .map(
        i =>
          lo +
          (hi - lo) *
            i /
            (n - 1)
      );


  const scale =
    d3.scaleLinear()
      .domain(domain)
      .range(palette)
      .interpolate(
        d3.interpolateHcl
      )
      .clamp(true);


  scale.lo = lo;

  scale.hi = hi;


  return scale;
}


export const delayScale = (
  values
) =>
  sequentialScale(
    values,
    RAMP_BLUE
  );


/* ============================================================
   RAMP LEGEND
============================================================ */

export function rampLegend(
  g,
  scale,
  opts = {}
) {

  const {

    width = 150,

    height = 9,

    title = "",

    sub = "",

    format = d =>
      (d > 0 ? "+" : "") +
      d3.format(".0f")(d)

  } = opts;


  const id =
    "ramp-" +
    Math.random()
      .toString(36)
      .slice(2, 8);


  const grad =
    g.append("defs")
      .append(
        "linearGradient"
      )
      .attr(
        "id",
        id
      );


  d3.range(
    0,
    1.001,
    0.05
  ).forEach(s => {

    grad.append(
      "stop"
    )
      .attr(
        "offset",
        `${s * 100}%`
      )
      .attr(
        "stop-color",
        scale(
          scale.lo +
          s *
            (
              scale.hi -
              scale.lo
            )
        )
      );
  });


  if (title) {

    g.append("text")
      .attr("y", -6)
      .text(title);
  }


  g.append("rect")
    .attr("y", 6)
    .attr(
      "width",
      width
    )
    .attr(
      "height",
      height
    )
    .attr(
      "fill",
      `url(#${id})`
    )
    .attr(
      "stroke",
      "#CBD5DC"
    )
    .attr(
      "stroke-width",
      0.5
    );


  const ticks =
    d3.scaleLinear()
      .domain([
        scale.lo,
        scale.hi
      ])
      .ticks(4);


  const pos =
    d3.scaleLinear()
      .domain([
        scale.lo,
        scale.hi
      ])
      .range([
        0,
        width
      ]);


  g.append("g")
    .selectAll("text")
    .data(ticks)
    .join("text")
    .attr(
      "x",
      d => pos(d)
    )
    .attr(
      "y",
      28
    )
    .attr(
      "text-anchor",
      (d, i) =>
        i === 0
          ? "start"
          : (
              i ===
              ticks.length - 1
                ? "end"
                : "middle"
            )
    )
    .text(format);


  if (sub) {

    g.append("text")
      .attr(
        "x",
        0
      )
      .attr(
        "y",
        42
      )
      .attr(
        "font-size",
        9.5
      )
      .attr(
        "fill",
        "#93999A"
      )
      .text(sub);
  }


  return g;
}


/* ============================================================
   ERROR HANDLER
============================================================ */

export function fail(
  selector,
  err
) {

  const el =
    document.querySelector(
      selector
    );


  if (el) {

    el.innerHTML = `
      <div class="error">

        Could not load this view:
        ${err.message}.

        <br>

        Run
        <span class="mono">
          python scripts/build_data.py
        </span>,

        then serve the folder with

        <span class="mono">
          python -m http.server
        </span>.

      </div>
    `;
  }


  console.error(err);
}
