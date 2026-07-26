import type { ErrorEvent as MaplibreErrorEvent, Map as MaplibreMap } from "maplibre-gl";
import {
  ACTIVE_FIRES_LAYER_IDS,
  BURNT_AREAS_LAYER_IDS,
  PAST_FIRES_LAYER_ID,
} from "./map";

export type EffisHealth = "ok" | "slow" | "down";

// Which raster-layer group a tracked source/proxy belongs to. Exists so a
// consumer (main.ts's NASA FIRMS fallback, currently) can react to
// "Active fires specifically is down" without also tripping on a
// Burnt-areas- or Past-fires-only problem it has no fallback for anyway.
export type EffisHealthGroup = "activeFires" | "burntAreas" | "pastFires";

export type EffisHealthReport = {
  overall: EffisHealth;
  activeFires: EffisHealth;
  burntAreas: EffisHealth;
  pastFires: EffisHealth;
};

type TrackedKey = "overall" | EffisHealthGroup;
const TRACKED_KEYS: readonly TrackedKey[] = [
  "overall",
  "activeFires",
  "burntAreas",
  "pastFires",
];

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

function groupForSourceId(sourceId: string): EffisHealthGroup | undefined {
  if ((ACTIVE_FIRES_LAYER_IDS as readonly string[]).includes(sourceId)) return "activeFires";
  if ((BURNT_AREAS_LAYER_IDS as readonly string[]).includes(sourceId)) return "burntAreas";
  if (sourceId === PAST_FIRES_LAYER_ID) return "pastFires";
  return undefined;
}

// Slow-response attribution stops at *mount* granularity (which of our two
// proxies the request went through), not per-tile-layer — matching the real
// observed fault boundary CLAUDE.md's "Known unknowns" documents (the two
// mounts behave differently from each other, not individual layers sharing
// one mount). Per-layer attribution would mean parsing each Resource Timing
// entry's `layer=`/`typename=` query param, which is fragile for no real
// benefit here. /api/wmts serves both current-fires groups, so a slow
// response there counts toward both.
function groupsForResourceUrl(url: string): EffisHealthGroup[] {
  if (/\/api\/wmts(\?|$)/.test(url)) return ["activeFires", "burntAreas"];
  if (/\/api\/effis(\?|$)/.test(url)) return ["pastFires"];
  return [];
}

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
 * or struggling, and calls `onChange` with a full health report whenever any
 * part of it changes. Two independent, rolling-window signals feed it, so
 * health recovers again once EFFIS does rather than latching on the first
 * problem seen:
 *
 *  - Raster tile load failures on our own EFFIS-backed sources (`map`'s
 *    'error' event, filtered to `TRACKED_SOURCE_IDS` so basemap/border tile
 *    failures don't count) — a burst of these means requests are actively
 *    failing. Attributed exactly to a group via `event.sourceId`.
 *  - Slow responses through our own proxy endpoints (Resource Timing API,
 *    filtered to /api/wmts and /api/effis) — catches high latency even on
 *    requests that do eventually succeed. Attributed to a group at mount
 *    granularity (see `groupsForResourceUrl`).
 *
 * `report.overall` is computed from a pooled signal spanning every tracked
 * source/proxy — unchanged in behavior from before this had per-group
 * tracking — while `report.activeFires`/`burntAreas`/`pastFires` are each
 * computed the same way from their own group-scoped signal, so a
 * Burnt-areas-only problem doesn't read as "Active fires is down" or vice
 * versa.
 *
 * Returns a cleanup function that stops watching (removes the map listener,
 * disconnects the PerformanceObserver, clears the recheck interval).
 */
export function watchEffisHealth(
  map: MaplibreMap,
  onChange: (report: EffisHealthReport) => void,
): () => void {
  const failuresByKey: Record<TrackedKey, number[]> = {
    overall: [],
    activeFires: [],
    burntAreas: [],
    pastFires: [],
  };
  const slowByKey: Record<TrackedKey, number[]> = {
    overall: [],
    activeFires: [],
    burntAreas: [],
    pastFires: [],
  };
  let lastReport: EffisHealthReport = {
    overall: "ok",
    activeFires: "ok",
    burntAreas: "ok",
    pastFires: "ok",
  };

  function prune(timestamps: number[], windowMs: number): void {
    const cutoff = Date.now() - windowMs;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
  }

  function levelFor(failures: number[], slow: number[]): EffisHealth {
    prune(failures, FAILURE_WINDOW_MS);
    prune(slow, SLOW_WINDOW_MS);
    if (failures.length >= FAILURE_THRESHOLD) return "down";
    if (slow.length >= SLOW_THRESHOLD) return "slow";
    return "ok";
  }

  function recompute(): void {
    const report: EffisHealthReport = {
      overall: levelFor(failuresByKey.overall, slowByKey.overall),
      activeFires: levelFor(failuresByKey.activeFires, slowByKey.activeFires),
      burntAreas: levelFor(failuresByKey.burntAreas, slowByKey.burntAreas),
      pastFires: levelFor(failuresByKey.pastFires, slowByKey.pastFires),
    };

    const changed = TRACKED_KEYS.some((key) => report[key] !== lastReport[key]);
    if (changed) {
      lastReport = report;
      onChange(report);
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
    const now = Date.now();
    failuresByKey.overall.push(now);
    const group = groupForSourceId(event.sourceId);
    if (group) failuresByKey[group].push(now);
    recompute();
  };
  map.on("error", onMapError);

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (
        PROXY_PATH_PATTERN.test(entry.name) &&
        entry.duration >= SLOW_RESOURCE_MS
      ) {
        const now = Date.now();
        slowByKey.overall.push(now);
        for (const group of groupsForResourceUrl(entry.name)) {
          slowByKey[group].push(now);
        }
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
