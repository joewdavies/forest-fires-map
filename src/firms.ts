import type { Feature, FeatureCollection, Point } from "geojson";
import legendConfig from "./legend-config.json";

// NASA FIRMS (Fire Information for Resource Management System) — the
// fallback data source for "Active fires" when EFFIS's own WMTS pipeline is
// detected as down (see effis-health.ts's per-group health tracking and
// main.ts's engageFirmsFallback()). EFFIS's own active-fire detection is
// itself built on FIRMS (confirmed in docs/firms-migration-plan.md), so this
// isn't a data-quality downgrade — it's the same underlying satellite
// detections, one hop closer to the source, used only when the EFFIS hop
// itself is the thing that's broken.
//
// Coverage gap, accepted: FIRMS has no Sentinel-3 equivalent (EFFIS's third
// active-fires source, `active-fires-s3` / `s3.hs.week`), and no single
// combined-VIIRS source the way EFFIS's `viirs.hs.week` covers SNPP +
// NOAA-20/21 together — FIRMS only offers those three as separate `SOURCE`
// values. FIRMS_SOURCES below fetches all four available sources in
// parallel to get as close to EFFIS's real coverage as possible, but a
// fire visible only to Sentinel-3 won't appear here during a fallback.
//
// Rendered shape-by-sensor to match the legend (MODIS -> triangle, VIIRS ->
// circle) — see main.ts's addFirmsActiveFiresLayer, which splits features on
// the `source` property set below ("MODIS_NRT" vs the three VIIRS sources)
// across a circle layer and a symbol layer using a small SDF triangle icon.

export type FirmsSource =
  | "MODIS_NRT"
  | "VIIRS_SNPP_NRT"
  | "VIIRS_NOAA20_NRT"
  | "VIIRS_NOAA21_NRT";

const FIRMS_SOURCES: readonly FirmsSource[] = [
  "MODIS_NRT",
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
];

// west, south, east, north — matches the bounding box FIRMS's own
// `kml_fire_footprints` endpoint uses for its predefined "europe" region
// (found during prior research, docs/firms-migration-plan.md).
export const EUROPE_BBOX: [number, number, number, number] = [-26, 34, 35, 82];

export const FIRMS_ATTRIBUTION =
  '<a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a>';

const FIRMS_PROXY = "/api/firms";
const REQUEST_TIMEOUT_MS = 15_000;

// FIRMS's own docs disagree on the max day_range across different pages
// (seen both 1-5 and 1-10) — 3 stays safely under either, without needing
// to confirm the true limit before this can be used at all. Revisit if
// wanting to match the "last 7 days" legend tier more closely.
const DEFAULT_DAY_RANGE = 7;

// MODIS and VIIRS use different field names for the same concepts
// (brightness temperature, confidence scale) — probed the same
// multi-key way effis.ts's getProp() handles EFFIS's own inconsistent
// field naming, rather than assuming one exact schema.
const BRIGHTNESS_KEYS = ["brightness", "bright_ti4"];

/** Hand-rolled rather than a dependency: FIRMS's CSV is a fixed,
 * single-header-row schema with no embedded delimiters in any field used
 * here, so a full RFC 4180 parser would be unused complexity. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

/** `acq_date` (YYYY-MM-DD) + `acq_time` (UTC, HHMM, zero-padded) -> Date. */
function parseAcquisition(date: string, time: string): Date | undefined {
  const paddedTime = time.padStart(4, "0");
  const iso = `${date}T${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}:00Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Buckets a detection's age into one of legend-config.json's own
 * `activeFires.colors[].labelKey` values — reusing that string as both the
 * bucket identifier and the legend-row lookup key means editing
 * legend-config.json's tiers/colors updates the real map styling and the
 * legend swatches together, with no separate mapping table to keep in
 * sync. The last (oldest) tier is also the catch-all for anything past the
 * three named age brackets, so it never falls through to "no color". */
function recencyTierFor(acquiredAt: Date, now: Date): string {
  const hours = (now.getTime() - acquiredAt.getTime()) / 3_600_000;
  const tiers = legendConfig.activeFires.colors;
  if (hours <= 6) return tiers[0].labelKey;
  if (hours <= 12) return tiers[1].labelKey;
  if (hours <= 24) return tiers[2].labelKey;
  return tiers[3].labelKey;
}

function rowsToFeatures(
  rows: Record<string, string>[],
  source: FirmsSource,
): Feature<Point>[] {
  const now = new Date();
  const features: Feature<Point>[] = [];

  for (const row of rows) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const acquiredAt = parseAcquisition(row.acq_date, row.acq_time);
    const brightnessKey = BRIGHTNESS_KEYS.find((key) => row[key] != null && row[key] !== "");

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        source,
        satellite: row.satellite,
        instrument: row.instrument,
        confidence: row.confidence,
        brightness: brightnessKey ? Number(row[brightnessKey]) : undefined,
        frp: row.frp ? Number(row.frp) : undefined,
        acquiredAtIso: acquiredAt?.toISOString(),
        recencyTier: recencyTierFor(acquiredAt ?? now, now),
      },
    });
  }

  return features;
}

async function fetchOneSource(
  source: FirmsSource,
  bboxStr: string,
  days: number,
): Promise<Feature<Point>[]> {
  const requests: { url: string; daysRequested: number }[] = [];
  let daysRemaining = days;
  let offsetDays = 0;

  while (daysRemaining > 0) {
    const chunkDays = Math.min(5, daysRemaining);
    if (offsetDays === 0) {
      requests.push({
        url: `${FIRMS_PROXY}?source=${source}&bbox=${bboxStr}&days=${chunkDays}`,
        daysRequested: chunkDays,
      });
    } else {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offsetDays);
      const dateStr = d.toISOString().split("T")[0];
      requests.push({
        url: `${FIRMS_PROXY}?source=${source}&bbox=${bboxStr}&days=${chunkDays}&date=${dateStr}`,
        daysRequested: chunkDays,
      });
    }
    daysRemaining -= chunkDays;
    offsetDays += chunkDays;
  }

  const fetches = requests.map(async (req, index) => {
    const response = await fetch(req.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`FIRMS ${source} request ${index + 1} failed (HTTP ${response.status})`);
    }
    const text = await response.text();
    return rowsToFeatures(parseCsv(text), source);
  });

  const allFeatures = await Promise.all(fetches);
  return allFeatures.flat();
}

/** Fetches all four available FIRMS sources in parallel and merges them
 * into one collection. Never throws — a failure on one source (network
 * error, one satellite's feed temporarily down) is logged and simply
 * excluded rather than blanking the whole result, matching this app's
 * established "degrade gracefully" pattern elsewhere (e.g.
 * fetchAndFilter's cql_filter fallback in effis.ts). */
export async function fetchActiveFiresFallback(
  bbox: [number, number, number, number] = EUROPE_BBOX,
  days: number = DEFAULT_DAY_RANGE,
): Promise<FeatureCollection<Point>> {
  const bboxStr = bbox.join(",");
  const results = await Promise.allSettled(
    FIRMS_SOURCES.map((source) => fetchOneSource(source, bboxStr, days)),
  );

  const features: Feature<Point>[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      features.push(...result.value);
    } else {
      console.warn("FIRMS fallback: one source failed:", result.reason);
    }
  }

  return { type: "FeatureCollection", features };
}
