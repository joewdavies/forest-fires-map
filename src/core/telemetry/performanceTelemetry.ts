import type { FeatureCollection } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";

/** Reports MapLibre render-frame intervals for each interaction in
 * development without adding telemetry or sampling work to production. */
export function installDevelopmentPerformanceTelemetry(
  map: MaplibreMap,
): void {
  if (!import.meta.env.DEV) return;

  let measuring = false;
  let frameTimes: number[] = [];

  map.on("movestart", () => {
    if (measuring) return;
    measuring = true;
    frameTimes = [];
  });

  map.on("render", () => {
    if (measuring) frameTimes.push(performance.now());
  });

  map.on("moveend", () => {
    if (!measuring) return;
    measuring = false;

    const intervals = frameTimes
      .slice(1)
      .map((time, index) => time - frameTimes[index])
      .sort((a, b) => a - b);
    if (intervals.length === 0) return;

    const averageMs =
      intervals.reduce((total, interval) => total + interval, 0) /
      intervals.length;
    const percentile95Ms =
      intervals[
        Math.min(intervals.length - 1, Math.floor(intervals.length * 0.95))
      ];

    console.table({
      "Map interaction": {
        zoom: map.getZoom().toFixed(2),
        frames: intervals.length,
        "average frame (ms)": averageMs.toFixed(1),
        "p95 frame (ms)": percentile95Ms.toFixed(1),
        "estimated FPS": (1000 / averageMs).toFixed(1),
      },
    });
  });
}

export function logFirmsFeatureCounts(
  data: FeatureCollection,
  daysRange: number,
): void {
  if (!import.meta.env.DEV) return;

  const bySource: Record<string, number> = {};
  for (const feature of data.features) {
    const source = String(feature.properties?.source ?? "unknown");
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  console.info(
    `[FIRMS] Loaded ${data.features.length.toLocaleString()} detections for ${daysRange} day(s).`,
  );
  console.table(bySource);
}
