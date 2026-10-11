import { drawMap } from "./map.js";
import { drawHeatmap } from "./heatmap.js";
import { drawCauses, drawRibbon } from "./causes.js";
import { drawDistance } from "./distance.js";
import { drawAircraft } from "./aircraft.js";

import {
  fmtInt,
  fmtPct,
  fmtMin,
  CAUSE_KEYS
} from "./shared.js";


function put(id, text) {
  const el = document.getElementById(id);

  if (el) {
    el.textContent = text;
  }
}


async function main() {

  // ============================================================
  // Headline summary
  // ============================================================

  try {

    const s = await d3.json(
      "data/processed/summary.json"
    );


    const label = Object.fromEntries(
      CAUSE_KEYS.map(
        c => [
          c.key,
          c.label.toLowerCase()
        ]
      )
    );


    const top = s.largest_cause;


    put(
      "n-rows",
      fmtInt(s.total_rows)
    );


    put(
      "n-rows-2",
      fmtInt(s.total_rows)
    );


    put(
      "n-operated",
      fmtInt(s.operated)
    );


    put(
      "n-airports",
      fmtInt(s.n_airports)
    );


    put(
      "n-carriers",
      fmtInt(s.n_carriers)
    );


    put(
      "rate-delay",
      fmtPct(s.delay15_rate)
    );


    put(
      "rate-cancel",
      fmtPct(s.cancel_rate)
    );


    put(
      "median-delay",
      fmtMin(s.median_delay)
    );


    put(
      "mean-delay",
      fmtMin(s.mean_delay)
    );


    put(
      "top-cause",
      label[top] || top
    );


    put(
      "top-cause-share",
      fmtPct(
        s.cause_share[top]
      )
    );


    drawRibbon(s);

  } catch (err) {

    console.error(
      "summary.json did not load",
      err
    );

  }


  // ============================================================
  // Visualization 1 — airport map
  // ============================================================

  drawMap();


  // ============================================================
  // Visualization 2 — hour × weekday heatmap
  // ============================================================

  drawHeatmap();


  // ============================================================
  // Visualization 3 — delay cause composition
  // ============================================================

  drawCauses();


  // ============================================================
  // Visualization 4 — route length vs delay
  // ============================================================

  drawDistance();


  // ============================================================
  // Visualization 5 — single-aircraft daily chain
  // ============================================================

  drawAircraft();

}


main();
