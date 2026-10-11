import {
  showTip,
  moveTip,
  hideTip,
  fmtInt,
  fmtMin,
  fmtPct,
  sequentialScale,
  rampLegend,
  RAMP_BLUE,
  AIRPORT_SELECT_EVENT,
  fail
} from "./shared.js";


const W = 960;
const H = 600;
const LABEL_N = 14;
const DOT = "#d4b5c4";
const PAPER = "#FFFFFF";


export async function drawMap() {

  const mount =
    document.querySelector(
      "#viz-map"
    );


  try {

    const [
      airports,
      us
    ] =
      await Promise.all([
        d3.json(
          "data/processed/airports.json"
        ),
        d3.json(
          "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"
        )
      ]);


    mount.innerHTML = "";

    let selectedAirport = null;
    let currentMetric = "delay15";


    /* ============================================================
       CONTROLS
    ============================================================ */

    const controls =
      d3.select(mount)
        .append("div")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "8px")
        .style("margin-bottom", "8px")
        .style("flex-wrap", "wrap");


    controls
      .append("span")
      .style("font-size", "12px")
      .style("font-weight", "600")
      .style("color", "#5A6E78")
      .text("State metric:");


    const metricData = [
      {
        key: "delay15",
        label: "Delay rate"
      },
      {
        key: "cancel",
        label: "Cancellation rate"
      }
    ];


    const buttons =
      controls
        .selectAll("button")
        .data(metricData)
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
          "5px 9px"
        )
        .style(
          "font-size",
          "11px"
        )
        .style(
          "cursor",
          "pointer"
        )
        .text(d => d.label);


    const selectedLabel =
      controls
        .append("span")
        .style(
          "margin-left",
          "auto"
        )
        .style(
          "font-size",
          "12px"
        )
        .style(
          "color",
          "#5A6E78"
        )
        .text(
          "Selected airport: National"
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


    const states =
      topojson.feature(
        us,
        us.objects.states
      );


    const projection =
      d3.geoAlbersUsa()
        .fitExtent(
          [
            [22, 22],
            [
              W - 54,
              H - 108
            ]
          ],
          states
        );


    const path =
      d3.geoPath(
        projection
      );


    const feats =
      states.features;


    airports.forEach(
      a => {

        const f =
          feats.find(
            ft =>
              d3.geoContains(
                ft,
                [
                  a.lon,
                  a.lat
                ]
              )
          );


        a.stateName =
          f
            ? f.properties.name
            : null;
      }
    );


    /* ============================================================
       STATE AGGREGATION
    ============================================================ */

    const byState =
      d3.rollup(

        airports.filter(
          d => d.stateName
        ),

        v => {

          const flights =
            d3.sum(
              v,
              d => d.flights
            );


          const scheduled =
            d3.sum(
              v,
              d =>
                d.scheduled ||
                d.flights
            );


          return {

            flights,

            scheduled,

            delay15:
              d3.sum(
                v,
                d =>
                  d.delay15_rate *
                  d.flights
              ) /
              flights,

            cancel:
              d3.sum(
                v,
                d =>
                  d.cancel_rate *
                  (
                    d.scheduled ||
                    d.flights
                  )
              ) /
              scheduled,

            airports:
              v.length,

            worst:
              v
                .slice()
                .sort(
                  (a, b) =>
                    b.delay15_rate -
                    a.delay15_rate
                )[0]
          };
        },

        d => d.stateName
      );


    function metricValue(state) {

      if (!state) {
        return null;
      }


      return currentMetric ===
        "cancel"
        ? state.cancel
        : state.delay15;
    }


    function metricTitle() {

      return currentMetric ===
        "cancel"
        ? "Cancelled flights, by state"
        : "Flights delayed 15+ min, by state";
    }


    let stateColor =
      sequentialScale(
        [
          ...byState.values()
        ].map(
          metricValue
        ),
        RAMP_BLUE
      );


    /* ============================================================
       STATES
    ============================================================ */

    const stateLayer =
      svg.append("g");


    const statePaths =
      stateLayer
        .selectAll("path")
        .data(feats)
        .join("path")
        .attr("d", path)
        .attr(
          "fill",
          d => {

            const s =
              byState.get(
                d.properties.name
              );


            return s
              ? stateColor(
                  metricValue(s)
                )
              : "#EDF1F4";
          }
        )
        .style(
          "cursor",
          "pointer"
        )
        .on(
          "mouseenter",
          (e, d) => {

            const s =
              byState.get(
                d.properties.name
              );


            if (!s) {

              showTip(
                e,
                `
                <span class="k">
                  ${d.properties.name}
                </span>
                <br>
                <span class="d">
                  no reporting airport
                </span>
                `
              );

              return;
            }


            showTip(
              e,
              `
              <span class="k">
                ${d.properties.name}
              </span>
              <br>

              <span class="d">
                flights delayed 15+ min
              </span>
              ${fmtPct(s.delay15)}
              <br>

              <span class="d">
                cancelled
              </span>
              ${fmtPct(s.cancel)}
              <br>

              <span class="d">
                departures
              </span>
              ${fmtInt(
                Math.round(
                  s.flights
                )
              )}
              <br>

              <span class="d">
                reporting airports
              </span>
              ${s.airports}
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
        );


    svg.append("path")
      .datum(
        topojson.mesh(
          us,
          us.objects.states,
          (a, b) =>
            a !== b
        )
      )
      .attr("d", path)
      .attr("fill", "none")
      .attr(
        "stroke",
        PAPER
      )
      .attr(
        "stroke-width",
        0.9
      );


    /* ============================================================
       AIRPORTS
    ============================================================ */

    const pts =
      airports
        .map(
          d => ({
            ...d,
            xy:
              projection([
                d.lon,
                d.lat
              ])
          })
        )
        .filter(
          d => d.xy
        )
        .sort(
          (a, b) =>
            b.flights -
            a.flights
        );


    const r =
      d3.scaleSqrt()
        .domain([
          0,
          d3.max(
            pts,
            d => d.flights
          )
        ])
        .range([
          0,
          21
        ]);


    const rr =
      d =>
        Math.max(
          1.6,
          r(d.flights)
        );


    const airportLayer =
      svg.append("g");


    const airportCircles =
      airportLayer
        .selectAll("circle")
        .data(pts)
        .join("circle")
        .attr(
          "cx",
          d => d.xy[0]
        )
        .attr(
          "cy",
          d => d.xy[1]
        )
        .attr(
          "r",
          rr
        )
        .attr(
          "fill",
          DOT
        )
        .attr(
          "fill-opacity",
          0.72
        )
        .attr(
          "stroke",
          PAPER
        )
        .attr(
          "stroke-width",
          0.8
        )
        .style(
          "cursor",
          "pointer"
        )
        .on(
          "mouseenter",
          function (
            e,
            d
          ) {

            d3.select(this)
              .attr(
                "fill-opacity",
                1
              );


            showTip(
              e,
              `
              <span class="k">
                ${d.iata}
              </span>
              ${d.city || ""}
              <br>

              <span class="d">
                departures
              </span>
              ${fmtInt(d.flights)}
              <br>

              <span class="d">
                delayed 15+ min
              </span>
              ${fmtPct(
                d.delay15_rate
              )}
              <br>

              <span class="d">
                median arrival delay
              </span>
              ${fmtMin(
                d.median_delay
              )}
              <br>

              <span class="d">
                90th percentile
              </span>
              ${fmtMin(
                d.p90_delay
              )}
              <br>

              <span class="d">
                cancelled
              </span>
              ${fmtPct(
                d.cancel_rate
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
          function (
            e,
            d
          ) {

            d3.select(this)
              .attr(
                "fill-opacity",
                selectedAirport ===
                d.iata
                  ? 1
                  : 0.72
              );


            hideTip();
          }
        )
        .on(
          "click",
          function (
            e,
            d
          ) {

            if (
              selectedAirport ===
              d.iata
            ) {

              selectedAirport =
                null;

            } else {

              selectedAirport =
                d.iata;
            }


            airportCircles
              .attr(
                "stroke",
                a =>
                  a.iata ===
                  selectedAirport
                    ? "#17313D"
                    : PAPER
              )
              .attr(
                "stroke-width",
                a =>
                  a.iata ===
                  selectedAirport
                    ? 3
                    : 0.8
              )
              .attr(
                "fill-opacity",
                a =>
                  a.iata ===
                  selectedAirport
                    ? 1
                    : 0.72
              );


            selectedLabel.text(
              selectedAirport
                ? `Selected airport: ${selectedAirport}`
                : "Selected airport: National"
            );


            window.dispatchEvent(

              new CustomEvent(
                AIRPORT_SELECT_EVENT,
                {
                  detail: {
                    airport:
                      selectedAirport
                  }
                }
              )
            );
          }
        );


    /* ============================================================
       AIRPORT LABELS
    ============================================================ */

    svg.append("g")
      .attr(
        "font-family",
        "IBM Plex Mono, monospace"
      )
      .attr(
        "font-size",
        10
      )
      .attr(
        "fill",
        "#1B3B52"
      )
      .attr(
        "pointer-events",
        "none"
      )
      .selectAll("text")
      .data(
        pts.slice(
          0,
          LABEL_N
        )
      )
      .join("text")
      .attr(
        "x",
        d =>
          Math.min(
            Math.max(
              d.xy[0],
              22
            ),
            W - 22
          )
      )
      .attr(
        "y",
        d =>
          d.xy[1] -
          rr(d) -
          5
      )
      .attr(
        "text-anchor",
        d =>
          d.xy[0] >
          W - 70
            ? "end"
            : (
                d.xy[0] <
                70
                  ? "start"
                  : "middle"
              )
      )
      .attr(
        "paint-order",
        "stroke"
      )
      .attr(
        "stroke",
        PAPER
      )
      .attr(
        "stroke-width",
        3
      )
      .text(
        d => d.iata
      );


    /* ============================================================
       LEGEND
    ============================================================ */

    const legendRoot =
      svg.append("g")
        .attr(
          "transform",
          `translate(32,${
            H - 80
          })`
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


    function drawLegend() {

      legendRoot
        .selectAll("*")
        .remove();


      /* Wider ramp so percentage ticks do not overlap */
      rampLegend(
        legendRoot,
        stateColor,
        {
          width: 290,

          title:
            metricTitle(),

          format:
            d3.format(".0%"),

          sub:
            "flight-weighted across the state's airports"
        }
      );


      /*
        Move the circle-size legend farther right
        because the color legend is now wider.
      */
      const sg =
        legendRoot
          .append("g")
          .attr(
            "transform",
            "translate(370,0)"
          );


      sg.append("text")
        .attr(
          "y",
          -6
        )
        .text(
          `Departures, all ${pts.length} reporting airports`
        );


      const ticks =
        [
          10000,
          100000,
          300000
        ]
          .filter(
            t =>
              t <=
              r.domain()[1]
          );


      let lx = 0;


      ticks.forEach(
        t => {

          const rad =
            Math.max(
              1.6,
              r(t)
            );


          sg.append("circle")
            .attr(
              "cx",
              lx + rad
            )
            .attr(
              "cy",
              30
            )
            .attr(
              "r",
              rad
            )
            .attr(
              "fill",
              DOT
            )
            .attr(
              "fill-opacity",
              0.72
            )
            .attr(
              "stroke",
              PAPER
            )
            .attr(
              "stroke-width",
              0.8
            );


          sg.append("text")
            .attr(
              "x",
              lx + rad
            )
            .attr(
              "y",
              58
            )
            .attr(
              "text-anchor",
              "middle"
            )
            .text(
              d3.format(
                ".0s"
              )(t)
            );


          lx +=
            rad * 2 +
            24;
        }
      );
    }


    drawLegend();


    /* ============================================================
       METRIC SWITCH
    ============================================================ */

    function updateMetric(
      metric
    ) {

      currentMetric =
        metric;


      stateColor =
        sequentialScale(
          [
            ...byState.values()
          ].map(
            metricValue
          ),
          RAMP_BLUE
        );


      statePaths
        .transition()
        .duration(500)
        .attr(
          "fill",
          d => {

            const s =
              byState.get(
                d.properties.name
              );


            return s
              ? stateColor(
                  metricValue(s)
                )
              : "#EDF1F4";
          }
        );


      buttons
        .style(
          "background",
          d =>
            d.key ===
            currentMetric
              ? "#4d83b0"
              : "#fff"
        )
        .style(
          "color",
          d =>
            d.key ===
            currentMetric
              ? "#fff"
              : "#445A65"
        );


      drawLegend();
    }


    buttons.on(
      "click",
      (e, d) => {

        updateMetric(
          d.key
        );
      }
    );


    updateMetric(
      currentMetric
    );

  } catch (err) {

    fail(
      "#viz-map",
      err
    );
  }
}
