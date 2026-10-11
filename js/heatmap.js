import {
  showTip,
  moveTip,
  hideTip,
  fmtInt,
  fmtMin,
  fmtPct,
  delayScale,
  rampLegend,
  DOW,
  AIRPORT_SELECT_EVENT,
  fail
} from "./shared.js";


const W = 960;

const H = 360;


const M = {
  top: 42,
  right: 18,
  bottom: 56,
  left: 46
};


export async function drawHeatmap() {

  const mount =
    document.querySelector(
      "#viz-heatmap"
    );


  try {

    const allRows =
      await d3.json(
        "data/processed/hour_dow.json"
      );


    let currentAirport =
      "ALL";


    mount.innerHTML = "";


    /* ============================================================
       STATUS
    ============================================================ */

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
          "10px"
        )
        .style(
          "margin-bottom",
          "4px"
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
        "Current view:"
      );


    const status =
      controls
        .append("span")
        .style(
          "font-size",
          "12px"
        )
        .style(
          "padding",
          "4px 8px"
        )
        .style(
          "background",
          "#EEF3F6"
        )
        .style(
          "border-radius",
          "4px"
        )
        .style(
          "color",
          "#17313D"
        )
        .text(
          "National"
        );


    const reset =
      controls
        .append("button")
        .style(
          "margin-left",
          "auto"
        )
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
        .text(
          "Reset to National"
        );


    /* ============================================================
       SVG
    ============================================================ */

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
        );


    const hours =
      d3.range(
        0,
        24
      );


    const x =
      d3.scaleBand()
        .domain(
          hours
        )
        .range([
          M.left,
          W - M.right
        ])
        .padding(0.06);


    const y =
      d3.scaleBand()
        .domain(
          d3.range(
            1,
            8
          )
        )
        .range([
          M.top,
          H - M.bottom
        ])
        .padding(0.06);


    /*
      Use one global color scale so that changing airports
      does not redefine what each shade means.
    */

    const color =
      delayScale(
        allRows.map(
          d =>
            d.median_delay
        )
      );


    /* ============================================================
       AXES
    ============================================================ */

    svg.append("g")
      .attr(
        "transform",
        `translate(0,${
          H - M.bottom
        })`
      )
      .call(
        d3.axisBottom(x)
          .tickValues(
            hours.filter(
              h =>
                h % 3 ===
                0
            )
          )
          .tickFormat(
            h =>
              String(h)
                .padStart(
                  2,
                  "0"
                )
          )
          .tickSize(0)
          .tickPadding(7)
      )
      .call(
        g =>
          g.select(
            ".domain"
          ).remove()
      );


    svg.append("g")
      .attr(
        "transform",
        `translate(${M.left},0)`
      )
      .call(
        d3.axisLeft(y)
          .tickFormat(
            d =>
              DOW[
                d - 1
              ]
          )
          .tickSize(0)
          .tickPadding(7)
      )
      .call(
        g =>
          g.select(
            ".domain"
          ).remove()
      );


    svg.selectAll(
      "text"
    )
      .attr(
        "font-family",
        "IBM Plex Sans, sans-serif"
      )
      .attr(
        "font-size",
        10.5
      )
      .attr(
        "fill",
        "#5A6E78"
      );


    svg.append("text")
      .attr(
        "x",
        M.left
      )
      .attr(
        "y",
        18
      )
      .attr(
        "font-family",
        "IBM Plex Sans, sans-serif"
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
        "Scheduled departure hour, local time"
      );


    /* ============================================================
       CELLS
    ============================================================ */

    const cellLayer =
      svg.append("g");


    function rowsForAirport(
      airport
    ) {

      const target =
        airport ||
        "ALL";


      const rows =
        allRows.filter(
          d =>
            d.airport ===
            target
        );


      /*
        Some small airports are not included in the
        preaggregated heatmap file.
      */

      if (
        !rows.length &&
        target !==
        "ALL"
      ) {

        return allRows.filter(
          d =>
            d.airport ===
            "ALL"
        );
      }


      return rows;
    }


    function update(
      airport
    ) {

      currentAirport =
        airport ||
        "ALL";


      let rows =
        rowsForAirport(
          currentAirport
        );


      const actualAirport =
        rows.length &&
        rows[0].airport ===
        currentAirport
          ? currentAirport
          : "ALL";


      if (
        actualAirport ===
        "ALL"
      ) {

        status.text(
          currentAirport ===
          "ALL"
            ? "National"
            : `National — ${currentAirport} not available in top-airport aggregation`
        );

      } else {

        status.text(
          actualAirport
        );
      }


      const cells =
        cellLayer
          .selectAll(
            "rect"
          )
          .data(
            rows,
            d =>
              `${d.dow}-${d.hour}`
          );


      cells
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
                    d.hour
                  )
              )
              .attr(
                "y",
                d =>
                  y(
                    d.dow
                  )
              )
              .attr(
                "width",
                x.bandwidth()
              )
              .attr(
                "height",
                y.bandwidth()
              )
              .attr(
                "fill",
                d =>
                  color(
                    d.median_delay
                  )
              )
              .attr(
                "opacity",
                0
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
                      400
                    )
                    .attr(
                      "opacity",
                      1
                    )
              ),

          update =>
            update,

          exit =>
            exit
              .transition()
              .duration(250)
              .attr(
                "opacity",
                0
              )
              .remove()
        )
        .on(
          "mouseenter",
          (
            e,
            d
          ) => {

            showTip(
              e,
              `
              <span class="k">
                ${
                  d.airport ===
                  "ALL"
                    ? "National"
                    : d.airport
                }
                ·
                ${DOW[
                  d.dow -
                  1
                ]}
                ${String(
                  d.hour
                ).padStart(
                  2,
                  "0"
                )}:00
              </span>
              <br>

              <span class="d">
                median arrival delay
              </span>
              ${fmtMin(
                d.median_delay
              )}
              <br>

              <span class="d">
                delayed 15+ min
              </span>
              ${fmtPct(
                d.delay15_rate
              )}
              <br>

              <span class="d">
                flights
              </span>
              ${fmtInt(
                d.n
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
          hideTip
        )
        .transition()
        .duration(
          500
        )
        .attr(
          "x",
          d =>
            x(
              d.hour
            )
        )
        .attr(
          "y",
          d =>
            y(
              d.dow
            )
        )
        .attr(
          "width",
          x.bandwidth()
        )
        .attr(
          "height",
          y.bandwidth()
        )
        .attr(
          "fill",
          d =>
            color(
              d.median_delay
            )
        )
        .attr(
          "opacity",
          1
        );
    }


    /* ============================================================
       COLOR LEGEND
    ============================================================ */

    rampLegend(

      svg.append("g")
        .attr(
          "transform",
          `translate(
            ${M.left},
            ${H - 34}
          )`
        )
        .attr(
          "font-family",
          "IBM Plex Sans, sans-serif"
        )
        .attr(
          "font-size",
          10
        )
        .attr(
          "fill",
          "#5A6E78"
        ),

      color,

      {
        width:
          170,

        height:
          8
      }
    );


    /* ============================================================
       MAP → HEATMAP EVENT
    ============================================================ */

    window.addEventListener(
      AIRPORT_SELECT_EVENT,
      event => {

        update(
          event.detail
            ?.airport ||
          "ALL"
        );
      }
    );


    /* ============================================================
       RESET
    ============================================================ */

    reset.on(
      "click",
      () => {

        update(
          "ALL"
        );


        window.dispatchEvent(

          new CustomEvent(
            AIRPORT_SELECT_EVENT,
            {
              detail: {
                airport:
                  null
              }
            }
          )
        );
      }
    );


    update(
      "ALL"
    );

  } catch (err) {

    fail(
      "#viz-heatmap",
      err
    );
  }
}
