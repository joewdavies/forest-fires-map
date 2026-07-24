import type shp from "shpjs";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// EFFIS (European Forest Fire Information System) burnt-area WFS layer.
// This single layer is continuously updated, so it covers both the current
// fire season and the full historical archive — we distinguish "current"
// vs "past" purely by filtering on fire date.
// Docs: https://forest-fire.emergency.copernicus.eu/applications/data-and-services
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

export function fetchCurrentFires(daysBack = 30): Promise<FeatureCollection> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceIso = since.toISOString().slice(0, 10);
  return fetchAndFilter(`FIREDATE >= '${sinceIso}'`, (iso) => iso >= sinceIso);
}

export function fetchHistoricalFires(year: number): Promise<FeatureCollection> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return fetchAndFilter(
    `FIREDATE >= '${from}' AND FIREDATE <= '${to}'`,
    (iso) => iso >= from && iso <= to,
  );
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
