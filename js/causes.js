import {
  showTip,
  moveTip,
  hideTip,
  fmtInt,
  fmtPct,
  CAUSE_KEYS,
  fail
} from "./shared.js";


const W = 960;

const M = {
  top: 34,
  right: 22,
  bottom: 24,
  left: 96
};

const ROW = 27;


/* ============================================================
   MAIN CAUSE CHART
============================================================ */

export async function drawCauses() {

  const mount =
    document.querySelector(
      "#viz-causes"
    );


  try {

    const raw =
      await d3.json(
        "data/processed/causes.json"
      );


    let currentCause =
      "late_aircraft";


    let data =
      raw.slice();


    /* ----------------------------------------------------------
       CONTROLS
    ---------------------------------------------------------- */

    mount.innerHTML = "";


    const controls =
      d3.select(mount)
        .append("div")
        .style(
          "display",
          "flex"
        )
        .style(
          "align-items",
          "center"
        )
        .style(
          "gap",
          "7px"
        )
        .style(
          "flex-wrap",
          "wrap"
        )
        .style(
          "margin-bottom",
          "12px"
        );


    controls
      .append("span")
      .style(
        "font-size",
        "12px"
      )
      .style(
        "font-weight",
        "600"
      )
      .style(
        "color",
        "#5A6E78"
      )
      .text(
        "Sort carriers by:"
      );


    const buttons =
      controls
        .selectAll("button")
        .data(CAUSE_KEYS)
        .join("button")
        .style(
          "border",
          "1px solid #CBD5DC"
        )
        .style(
          "border-radius",
          "4px"
        )
        .style(
          "padding",
          "5px 8px"
        )
        .style(
          "font-size",
          "11px"
        )
        .style(
          "cursor",
          "pointer"
        )
        .style(
          "background",
          "#fff"
        )
        .style(
          "color",
          "#445A65"
        )
        .text(
          d => d.label
        );


    /* ----------------------------------------------------------
       SVG
    ---------------------------------------------------------- */

    const H =
      M.top +
      M.bottom +
      data.length *
        ROW;


    const svg =
      d3.select(mount)
        .append("svg")
        .attr(
          "viewBox",
          `0 0 ${W} ${H}`
        )
        .attr(
          "role",
          "img"
        )
        .attr(
          "aria-label",
          "Normalized stacked bars showing the share of delay minutes by reported cause for each carrier"
        );


    const x =
      d3.scaleLinear()
        .domain([
          0,
          1
        ])
        .range([
          M.left,
          W - M.right
        ]);


    const y =
      d3.scaleBand()
        .range([
          M.top,
          H - M.bottom
        ])
        .padding(0.24);


    const bars =
      svg.append("g");


    const yAxis =
      svg.append("g")
        .attr(
          "transform",
          `translate(${M.left},0)`
        );


    svg.append("g")
      .attr(
        "transform",
        `translate(0,${
          M.top - 10
        })`
      )
      .call(
        d3.axisTop(x)
          .ticks(
            5,
            "%"
          )
          .tickSize(0)
          .tickPadding(4)
      )
      .call(
        g =>
          g.select(
            ".domain"
          ).remove()
      );


    function sortData(
      causeKey
    ) {

      return raw
        .slice()
        .sort(
          (a, b) =>
            (
              b[
                causeKey +
                  "_share"
              ] || 0
            ) -
            (
              a[
                causeKey +
                  "_share"
              ] || 0
            )
        );
    }


    function highlightCause(
      causeKey
    ) {

      bars
        .selectAll(
          "rect"
        )
        .transition()
        .duration(150)
        .attr(
          "opacity",
          d =>
            d.cause.key ===
            causeKey
              ? 1
              : 0.18
        );
    }


    function clearHighlight() {

      bars
        .selectAll(
          "rect"
        )
        .transition()
        .duration(150)
        .attr(
          "opacity",
          1
        );
    }


    function update(
      causeKey,
      animate = true
    ) {

      currentCause =
        causeKey;


      data =
        sortData(
          causeKey
        );


      y.domain(
        data.map(
          d => d.name
        )
      );


      const series =
        d3.stack()
          .keys(
            CAUSE_KEYS.map(
              c =>
                c.key +
                "_share"
            )
          )(
            data
          );


      const flat =
        series.flatMap(
          (
            s,
            idx
          ) =>
            s.map(
              v => ({
                ...v,
                idx,
                cause:
                  CAUSE_KEYS[idx]
              })
            )
        );


      const rects =
        bars
          .selectAll(
            "rect"
          )
          .data(
            flat,
            d =>
              d.data.name +
              "-" +
              d.cause.key
          );


      rects
        .join(
          enter =>
            enter
              .append(
                "rect"
              )
              .attr(
                "x",
                d =>
                  x(
                    d[0]
                  )
              )
              .attr(
                "y",
                d =>
                  y(
                    d.data.name
                  )
              )
              .attr(
                "height",
                y.bandwidth()
              )
              .attr(
                "width",
                0
              )
              .attr(
                "fill",
                d =>
                  d.cause.color
              )
              .style(
                "cursor",
                "pointer"
              )
              .call(
                enter =>
                  enter
                    .transition()
                    .duration(
                      500
                    )
                    .attr(
                      "width",
                      d =>
                        Math.max(
                          0,
                          x(
                            d[1]
                          ) -
                            x(
                              d[0]
                            ) -
                            (
                              d.idx ===
                              1
                                ? 4
                                : 1
                            )
                        )
                    )
              ),

          update =>
            update,

          exit =>
            exit.remove()
        )
        .on(
          "mouseenter",
          (
            e,
            d
          ) => {

            highlightCause(
              d.cause.key
            );


            const internal =
              (
                d.data
                  .late_aircraft_share ||
                0
              ) +
              (
                d.data
                  .carrier_share ||
                0
              );


            showTip(
              e,
              `
              <span class="k">
                ${d.data.name}
              </span>
              <br>

              <span class="d">
                ${d.cause.label}
              </span>
              ${fmtPct(
                d[1] -
                d[0]
              )}
              <br>

              <span class="d">
                airline's own operation
              </span>
              ${fmtPct(
                internal
              )}
              <br>

              <span class="d">
                delayed flights
              </span>
              ${fmtInt(
                d.data
                  .delayed_flights
              )}
              `
            );
          }
        )
        .on(
          "mousemove",
          moveTip
        )
        .on(
          "mouseleave",
          () => {

            clearHighlight();

            hideTip();
          }
        )
        .transition()
        .duration(
          animate
            ? 600
            : 0
        )
        .attr(
          "x",
          d =>
            x(
              d[0]
            )
        )
        .attr(
          "y",
          d =>
            y(
              d.data.name
            )
        )
        .attr(
          "width",
          d =>
            Math.max(
              0,
              x(
                d[1]
              ) -
                x(
                  d[0]
                ) -
                (
                  d.idx ===
                  1
                    ? 4
                    : 1
                )
            )
        )
        .attr(
          "height",
          y.bandwidth()
        );


      yAxis
        .transition()
        .duration(
          animate
            ? 600
            : 0
        )
        .call(
          d3.axisLeft(y)
            .tickSize(0)
            .tickPadding(8)
        )
        .call(
          g =>
            g.select(
              ".domain"
            ).remove()
        );


      svg
        .selectAll(
          "text"
        )
        .attr(
          "font-family",
          "IBM Plex Sans, sans-serif"
        )
        .attr(
          "font-size",
          11
        )
        .attr(
          "fill",
          "#5A6E78"
        );


      buttons
        .style(
          "background",
          d =>
            d.key ===
            currentCause
              ? d.color
              : "#fff"
        )
        .style(
          "color",
          d =>
            d.key ===
            currentCause
              ? "#fff"
              : "#445A65"
        )
        .style(
          "border-color",
          d =>
            d.key ===
            currentCause
              ? d.color
              : "#CBD5DC"
        );
    }


    buttons
      .on(
        "click",
        (
          e,
          d
        ) => {

          update(
            d.key,
            true
          );
        }
      )
      .on(
        "mouseenter",
        (
          e,
          d
        ) => {

          highlightCause(
            d.key
          );
        }
      )
      .on(
        "mouseleave",
        clearHighlight
      );


    update(
      currentCause,
      false
    );


    renderLegend(
      "#legend-causes"
    );

  } catch (err) {

    fail(
      "#viz-causes",
      err
    );
  }
}


/* ============================================================
   HERO RIBBON
============================================================ */

export async function drawRibbon(
  summary
) {

  const svg =
    d3.select(
      "#cause-ribbon"
    );


  const node =
    svg.node();


  if (!node) return;


  const w =
    node.clientWidth ||
    800;


  const h = 76;


  svg.attr(
    "viewBox",
    `0 0 ${w} ${h}`
  );


  const shares =
    CAUSE_KEYS.map(
      c => ({
        ...c,
        v:
          summary
            .cause_share[
              c.key
            ] ||
          0
      })
    );


  let acc = 0;


  const laid =
    shares.map(
      (
        s,
        i
      ) => {

        const o = {
          ...s,
          i,
          x0: acc,
          x1:
            acc +
            s.v
        };


        acc =
          o.x1;


        return o;
      }
    );


  const x =
    d3.scaleLinear()
      .domain([
        0,
        1
      ])
      .range([
        0,
        w
      ]);


  svg
    .selectAll(
      "rect.seg"
    )
    .data(laid)
    .join("rect")
    .attr(
      "class",
      "seg"
    )
    .attr(
      "x",
      d =>
        x(d.x0)
    )
    .attr(
      "y",
      18
    )
    .attr(
      "width",
      d =>
        Math.max(
          0,
          x(
            d.x1
          ) -
            x(
              d.x0
            ) -
            (
              d.i === 1
                ? 5
                : 1
            )
        )
    )
    .attr(
      "height",
      30
    )
    .attr(
      "fill",
      d =>
        d.color
    )
    .style(
      "cursor",
      "pointer"
    )
    .on(
      "mouseenter",
      (
        e,
        d
      ) => {

        svg
          .selectAll(
            "rect.seg"
          )
          .attr(
            "opacity",
            s =>
              s.key ===
              d.key
                ? 1
                : 0.2
          );


        showTip(
          e,
          `
          <span class="k">
            ${d.label}
          </span>
          <br>
          ${fmtPct(
            d.v
          )}
          of delay minutes
          `
        );
      }
    )
    .on(
      "mousemove",
      moveTip
    )
    .on(
      "mouseleave",
      () => {

        svg
          .selectAll(
            "rect.seg"
          )
          .attr(
            "opacity",
            1
          );


        hideTip();
      }
    );


  const internal =
    laid[0].v +
    laid[1].v;


  svg.append("text")
    .attr(
      "x",
      0
    )
    .attr(
      "y",
      12
    )
    .attr(
      "font-family",
      "IBM Plex Mono, monospace"
    )
    .attr(
      "font-size",
      10.5
    )
    .attr(
      "fill",
      "#5A6E78"
    )
    .text(
      `the airline's own operation — ${d3.format(
        ".1%"
      )(internal)}`
    );


  svg.append("text")
    .attr(
      "x",
      x(
        internal
      ) + 6
    )
    .attr(
      "y",
      12
    )
    .attr(
      "font-family",
      "IBM Plex Mono, monospace"
    )
    .attr(
      "font-size",
      10.5
    )
    .attr(
      "fill",
      "#5A6E78"
    )
    .text(
      `outside it — ${d3.format(
        ".1%"
      )(
        1 -
        internal
      )}`
    );


  svg
    .selectAll(
      "text.lbl"
    )
    .data(
      laid.filter(
        d =>
          d.v >
          0.07
      )
    )
    .join("text")
    .attr(
      "class",
      "lbl"
    )
    .attr(
      "x",
      d =>
        x(
          d.x0
        ) + 6
    )
    .attr(
      "y",
      66
    )
    .attr(
      "font-family",
      "IBM Plex Mono, monospace"
    )
    .attr(
      "font-size",
      10.5
    )
    .attr(
      "fill",
      "#5A6E78"
    )
    .text(
      d =>
        `${d.label} ${fmtPct(
          d.v
        )}`
    );
}


/* ============================================================
   LEGEND
============================================================ */

export function renderLegend(
  sel
) {

  const el =
    document.querySelector(
      sel
    );


  if (!el) return;


  const swatch =
    c =>
      `
      <span>
        <i style="background:${c.color}">
        </i>
        ${c.label}
      </span>
      `;


  el.innerHTML =

    `
    <span style="color:#17313D">
      Airline's own operation
    </span>
    `

    +

    CAUSE_KEYS
      .filter(
        c =>
          c.group ===
          "internal"
      )
      .map(swatch)
      .join("")

    +

    `
    <span style="
      color:#17313D;
      margin-left:0.6rem
    ">
      Outside it
    </span>
    `

    +

    CAUSE_KEYS
      .filter(
        c =>
          c.group !==
          "internal"
      )
      .map(swatch)
      .join("");
}
