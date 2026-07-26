import type { ErrorEvent as MaplibreErrorEvent, Map as MaplibreMap } from "maplibre-gl";
import {
  ACTIVE_FIRES_LAYER_IDS,
  BURNT_AREAS_LAYER_IDS,
  PAST_FIRES_LAYER_ID,
} from "./map";

export type EffisHealth = "ok" | "slow" | "down";

// The WFS-backed past-fires vector fetch (fetchHistoricalFires in effis.ts)
// already surfaces its own failures via the #status line — this only covers
// the raster WMTS pipeline (current fires + the past-fires raster overlay),
// which had no error visibility at all before this: MapLibre requests those
// tiles itself, with no fetch/parsing code of ours in the loop to catch a
// failure in.
const TRACKED_SOURCE_IDS = new Set<string>([
  ...ACTIVE_FIRES_LAYER_IDS,
  ...BURNT_AREAS_LAYER_IDS,
  PAST_FIRES_LAYER_ID,
]);

// A handful of tile 500s during normal operation is expected under EFFIS's
// usual backend strain (see CLAUDE.md's "Known unknowns" — a handful of
// tiles have been observed 500ing even while most of the same layer's tiles
// succeeded) — only a burst within a short window indicates a real outage
// worth surfacing, not routine noise.
const FAILURE_WINDOW_MS = 20_000;
const FAILURE_THRESHOLD = 4;

// Our own proxies (api/effis.ts, api/wmts.ts) already time out their
// upstream fetch at 15s; a run of requests taking multiple seconds to
// resolve — even successfully — is a much earlier, softer sign of EFFIS
// strain than waiting for outright tile failures.
const SLOW_RESOURCE_MS = 4_000;
const SLOW_WINDOW_MS = 30_000;
const SLOW_THRESHOLD = 3;

const RECHECK_INTERVAL_MS = 5_000;
const PROXY_PATH_PATTERN = /\/api\/(wmts|effis)(\?|$)/;

type TrackedErrorEvent = MaplibreErrorEvent & { sourceId?: string };

/**
 * Watches for signs that EFFIS itself — not just this one request — is down
 * or struggling, and calls `onChange` whenever the assessed level changes.
 * Two independent, rolling-window signals feed it, so health recovers again
 * once EFFIS does rather than latching on the first problem seen:
 *
 *  - Raster tile load failures on our own EFFIS-backed sources (`map`'s
 *    'error' event, filtered to `TRACKED_SOURCE_IDS` so basemap/border tile
 *    failures don't count) — a burst of these means requests are actively
 *    failing.
 *  - Slow responses through our own proxy endpoints (Resource Timing API,
 *    filtered to /api/wmts and /api/effis) — catches high latency even on
 *    requests that do eventually succeed.
 *
 * Returns a cleanup function that stops watching (removes the map listener,
 * disconnects the PerformanceObserver, clears the recheck interval).
 */
export function watchEffisHealth(
  map: MaplibreMap,
  onChange: (health: EffisHealth) => void,
): () => void {
  const failures: number[] = [];
  const slowResponses: number[] = [];
  let lastHealth: EffisHealth = "ok";

  function prune(timestamps: number[], windowMs: number): void {
    const cutoff = Date.now() - windowMs;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
  }

  function recompute(): void {
    prune(failures, FAILURE_WINDOW_MS);
    prune(slowResponses, SLOW_WINDOW_MS);

    const health: EffisHealth =
      failures.length >= FAILURE_THRESHOLD
        ? "down"
        : slowResponses.length >= SLOW_THRESHOLD
          ? "slow"
          : "ok";

    if (health !== lastHealth) {
      lastHealth = health;
      onChange(health);
    }
  }

  // MapLibre's public types don't declare `sourceId` on ErrorEvent, but
  // it's genuinely there at runtime: every tile source forwards its own
  // 'error' events up through the style to the map with `sourceId` mixed
  // in (TileManager.setEventedParent in maplibre-gl's source). Only
  // non-404 tile failures reach here — maplibre already swallows 404s (an
  // expected "no data at this tile" response) before firing.
  const onMapError = (event: TrackedErrorEvent) => {
    if (!event.sourceId || !TRACKED_SOURCE_IDS.has(event.sourceId)) return;
    failures.push(Date.now());
    recompute();
  };
  map.on("error", onMapError);

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (
        PROXY_PATH_PATTERN.test(entry.name) &&
        entry.duration >= SLOW_RESOURCE_MS
      ) {
        slowResponses.push(Date.now());
      }
    }
    recompute();
    // The resource timing buffer silently stops recording new entries once
    // full (default cap: 250, shared with every other same-origin request
    // the page makes) — clearing it after each batch keeps this working for
    // the lifetime of a long-running map session instead of just the first
    // few minutes.
    performance.clearResourceTimings();
  });
  observer.observe({ type: "resource", buffered: true });

  const intervalId = window.setInterval(recompute, RECHECK_INTERVAL_MS);

  return () => {
    map.off("error", onMapError);
    observer.disconnect();
    window.clearInterval(intervalId);
  };
}
