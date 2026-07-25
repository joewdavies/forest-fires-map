import type shp from "shpjs";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// EFFIS (European Forest Fire Information System) burnt-area/fire layers.
// Docs: https://forest-fire.emergency.copernicus.eu/applications/data-and-services
//
// EFFIS exposes this data multiple ways, with wildly different reliability.
// Its WFS interface (vector polygons, used below for "Past fires") has been
// observed hanging or erroring on *any* request — even EFFIS's own
// documented example with zero extra parameters — regardless of query
// shape. Current fires ("Burnt areas" / "Active fires", in map.ts) instead
// use its WMTS interface (raster tiles, at a separate `/effist/wmts`
// upstream mount — see api/wmts.ts), confirmed via a HAR capture of EFFIS's
// own production viewer (forest-fire.emergency.copernicus.eu/apps/effis.csv)
// to be what it actually uses for the current-situation view — see the
// "Current fires: WMTS raster tiles" section below for exactly which
// layers and why (notably: WMS, tried first, hangs on these same layers).
// Past fires still go through WFS below, since there's no per-year WMTS/WMS
// layer confirmed working for historical dates (`modis.ba.<year>` WMTS and
// `TIME`-filtered WMS both hung in testing) — only the *current*-week WMTS
// layers have been confirmed to accept a `time=` range successfully.
const EFFIS_PROXY = "/api/effis";
const LAYER = "ms:modis.ba.poly";

// EFFIS's schema has varied historically; we don't hard-fail on a specific
// casing, we probe a handful of known candidates instead.
const DATE_KEYS = ["FIREDATE", "FireDate", "firedate", "LASTUPDATE", "LastUpdate", "lastupdate"];
const AREA_KEYS = ["AREA_HA", "AreaHa", "area_ha", "AREA", "area"];
const COUNTRY_KEYS = ["COUNTRY", "Country", "country", "COUNTRY_A", "iso2"];
const PROVINCE_KEYS = ["PROVINCE", "Province", "province"];

export class EffisError extends Error {}

function wfsUrl(cqlFilter?: string): string {
  const params = new URLSearchParams({
    service: "WFS",
    request: "getfeature",
    typename: LAYER,
    version: "1.1.0",
    outputformat: "SHAPEZIP",
    srsname: "EPSG:4326",
  });
  if (cqlFilter) params.set("cql_filter", cqlFilter);
  // shpjs resolves the .shp/.dbf/.prj members of the zip against this URL,
  // which requires an absolute URL — a path-only string makes it throw.
  return `${window.location.origin}${EFFIS_PROXY}?${params.toString()}`;
}

function normalize(result: Awaited<ReturnType<typeof shp>>): FeatureCollection {
  if (Array.isArray(result)) {
    return {
      type: "FeatureCollection",
      features: result.flatMap((fc) => fc.features as Feature<Geometry>[]),
    };
  }
  return result;
}

const REQUEST_TIMEOUT_MS = 20_000;

async function requestBurntAreas(cqlFilter?: string): Promise<FeatureCollection> {
  const url = wfsUrl(cqlFilter);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new EffisError(
      timedOut
        ? "EFFIS did not respond in time. The service may be overloaded — try again shortly."
        : `Could not reach EFFIS (${err instanceof Error ? err.message : String(err)}). ` +
          "The service may be temporarily unavailable — try again shortly.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || contentType.includes("xml") || contentType.includes("html")) {
    // WFS servers report errors as an XML ServiceExceptionReport with a 200
    // or as a plain HTTP error — surface whichever this is directly.
    const detail = await response.text().catch(() => "");
    throw new EffisError(
      `EFFIS returned an error (HTTP ${response.status}). The service may be temporarily unavailable — try again shortly.` +
        (detail ? ` Details: ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""),
    );
  }

  // Pass the fetched buffer directly (rather than the URL) so shpjs treats
  // it as zip binary instead of trying to guess .shp/.dbf/.prj sibling URLs
  // from a path that doesn't end in `.zip`.
  const buffer = await response.arrayBuffer();
  try {
    // Dynamically imported so shpjs (and its JSZip dependency) only load
    // once fire data is actually requested, keeping the initial bundle lean.
    const { default: parseShapefile } = await import("shpjs");
    return normalize(await parseShapefile(buffer));
  } catch (err) {
    throw new EffisError(
      `Received a response from EFFIS but couldn't parse it as shapefile data ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}

/** Fetch burnt-area polygons, trying a server-side date filter first and
 * falling back to an unfiltered request (then filtering client-side) if the
 * server rejects the filter — keeps us working even if EFFIS's exact field
 * naming differs from what we guessed. */
async function fetchAndFilter(cqlFilter: string, matchesDate: (iso: string) => boolean) {
  try {
    return await requestBurntAreas(cqlFilter);
  } catch {
    console.warn("EFFIS server-side date filter failed, falling back to client-side filtering");
    const all = await requestBurntAreas();
    return {
      type: "FeatureCollection" as const,
      features: all.features.filter((f) => {
        const date = getFireDateIso(f);
        return date != null && matchesDate(date);
      }),
    };
  }
}

export function fetchHistoricalFires(year: number): Promise<FeatureCollection> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return fetchAndFilter(
    `FIREDATE >= '${from}' AND FIREDATE <= '${to}'`,
    (iso) => iso >= from && iso <= to,
  );
}

// --- Current fires: WMTS raster tiles --------------------------------
//
// Two independent overlays, each toggleable in the UI, matching EFFIS's own
// "Current Situation Viewer" (found by reading its live URL — it encodes
// its active layers as `?tiles=hsl,modis.hs.week,viirs.all.week,s3.hs.week,
// modis.ba.week,severity_time.week,nrt.ba.week`):
//   - "Burnt areas": the fire perimeter/severity polygons.
//   - "Active fires": hotspot detections (rendered as points/triangles by
//     the tile server itself), from three independent satellite sources —
//     shown together as one "Active fires" toggle, same as EFFIS's default.
//
// This used to go through WMS GetMap (see git history) on the assumption —
// stated in EFFIS's own layer list above — that every `.week`-suffixed
// layer hangs on any request, WMS or otherwise. That turned out to be only
// half true: it's specifically the *WMS* path that hangs on these layers.
// Capturing a HAR of EFFIS's own viewer while it was successfully
// rendering showed it never calls WMS for current fires at all — every
// tile request goes to a *WMTS* endpoint at `/effist/wmts` (note: "effist",
// not "effis" — a distinct upstream mount, proxied separately in
// api/wmts.ts), using `Service=WMTS&Request=GetTile` with an explicit
// `time=<from>/<to>` range, not WMS's `BBOX`. Replaying that exact
// request shape confirmed every layer below returns real image data
// reliably. `viirs.hs.week` (not `viirs.all.week`, despite that being the
// name in the viewer's own URL bar) is what its actual network calls use —
// the URL's `tiles=` param and its real requests disagree, and the real
// requests are what's been verified working.
//
// "Burnt areas" stacks *two* layers, not one — `severity_time.week` (the
// single layer originally used, both here and in the older WMS version)
// turned out to return a fully blank/transparent tile at every coordinate
// tested, even ones with clearly active nearby fires (confirmed by fetching
// and visually inspecting the raw PNG, not just checking the HTTP status —
// it was always a 683-byte "empty tile", not an error). `modis.ba.week` and
// `nrt.ba.week` both returned real polygon data at the same coordinates, so
// those two are used instead, matching how EFFIS's own viewer stacks all
// three together (its blank contribution from `severity_time.week` would
// just be invisible on top of the other two, which is presumably why the
// official viewer never noticed it wasn't contributing anything for this
// time range). If burnt areas ever go blank again, check whether it's
// specifically `severity_time.week` regressing back into the mix, or
// whether `modis.ba.week`/`nrt.ba.week` themselves have stopped returning
// data.
export type WmtsLayerKind =
  | "burnt-areas-modis"
  | "burnt-areas-nrt"
  | "active-fires-modis"
  | "active-fires-viirs"
  | "active-fires-s3";

const WMTS_LAYERS: Record<WmtsLayerKind, string> = {
  "burnt-areas-modis": "modis.ba.week",
  "burnt-areas-nrt": "nrt.ba.week",
  "active-fires-modis": "modis.hs.week",
  "active-fires-viirs": "viirs.hs.week",
  "active-fires-s3": "s3.hs.week",
};

const EFFIS_WMTS_PROXY = "/api/wmts";
const WMTS_TIME_WINDOW_DAYS = 7;

/** EFFIS's `.week` WMTS layers aren't declared with a time Dimension in
 * their own WMTSCapabilities (no server-advertised default), but the real
 * viewer still sends an explicit rolling `time=<from>/<to>` range on every
 * request — mirrored here as "today back 6 days" since that's the only
 * value confirmed (via the HAR capture) to return current data. */
function currentTimeRange(): string {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (WMTS_TIME_WINDOW_DAYS - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return `${iso(from)}/${iso(to)}`;
}

/**
 * Builds a MapLibre raster tile URL template for one current-fires layer.
 * MapLibre substitutes {z}/{x}/{y} into raster tile templates natively, so
 * — unlike the old WMS/BBOX approach — no transformRequest hook is needed:
 * EFFIS's WMTS TileMatrix/TileCol/TileRow line up directly with MapLibre's
 * z/x/y, because its EPSG3857 TileMatrixSet uses the same top-left-origin,
 * power-of-two grid as any XYZ scheme, just with 1024px tiles instead of
 * 256px — hence `addWmtsRasterLayer` in map.ts sets the raster source's
 * `tileSize: 1024` to match (that's what makes MapLibre request the same
 * z as EFFIS's TileMatrix identifier for a given view; get that mismatched
 * and tiles would fetch the wrong area, not error).
 */
export function tileTemplate(kind: WmtsLayerKind): string {
  const params = new URLSearchParams({
    layer: WMTS_LAYERS[kind],
    tilematrixset: "EPSG3857",
    Service: "WMTS",
    Request: "GetTile",
    Version: "1.0.0",
    Format: "image/png",
    time: currentTimeRange(),
  });
  // {z}/{x}/{y} must stay literal (not URL-encoded) for MapLibre to find
  // and substitute them, so they're appended after URLSearchParams rather
  // than passed through it.
  return `${EFFIS_WMTS_PROXY}?${params.toString()}&TileMatrix={z}&TileCol={x}&TileRow={y}`;
}

/** Minimal shape both geojson.Feature and MapLibre's MapGeoJSONFeature satisfy. */
type HasProperties = { properties?: Record<string, unknown> | null };

function getProp(feature: HasProperties, keys: string[]): unknown {
  const props = feature.properties ?? {};
  for (const key of keys) {
    if (props[key] != null && props[key] !== "") return props[key];
  }
  return undefined;
}

/** Best-effort parse of whatever date format the feature carries into
 * an ISO `YYYY-MM-DD` string, so filtering/sorting is consistent. */
export function getFireDateIso(feature: HasProperties): string | undefined {
  const raw = getProp(feature, DATE_KEYS);
  if (raw == null) return undefined;
  const str = String(raw);
  // Handles ISO-ish strings directly, and compact YYYYMMDD.
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function getBurntAreaHa(feature: HasProperties): number | undefined {
  const raw = getProp(feature, AREA_KEYS);
  if (raw == null) return undefined;
  const num = Number(raw);
  return Number.isNaN(num) ? undefined : num;
}

export function getCountry(feature: HasProperties): string | undefined {
  const raw = getProp(feature, COUNTRY_KEYS);
  return raw == null ? undefined : String(raw);
}

export function getProvince(feature: HasProperties): string | undefined {
  const raw = getProp(feature, PROVINCE_KEYS);
  return raw == null ? undefined : String(raw);
}
