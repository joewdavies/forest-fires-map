export const config = { runtime: "edge" };

// Forwards NASA FIRMS area/csv requests server-side, injecting the FIRMS
// MAP_KEY (from the FIRMS_MAP_KEY env var) into the outbound URL. Unlike
// api/effis.ts and api/wmts.ts, this is NOT a "forward the query string
// verbatim" passthrough — FIRMS embeds MAP_KEY as a URL *path segment*
// (`/api/area/csv/{MAP_KEY}/{SOURCE}/{bbox}/{days}`), not a query param, so
// it can never be something the client supplies or sees. The client instead
// sends plain params (source/bbox/days) and this handler builds the real
// FIRMS URL from them. See src/firms.ts for why the response is returned as
// raw CSV rather than converted to GeoJSON here — parsing happens
// client-side, matching this app's existing WFS/shpjs precedent, and keeps
// this proxy's dev (vite.config.ts) and prod (this file) behavior trivially
// equivalent.
const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

// See api/effis.ts for why this exists — EFFIS has been observed to hang
// indefinitely on requests proxied through Vercel specifically; FIRMS gets
// the same defensive treatment on general principle, not because it's been
// observed doing the same thing.
const REQUEST_TIMEOUT_MS = 15_000;

const VALID_SOURCES = new Set([
  "MODIS_NRT",
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
]);

// west,south,east,north — four plain numbers, nothing else. Validated here
// (not just trusted from the client) since it goes straight into the
// upstream URL path.
const BBOX_PATTERN =
  /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

export default async function handler(request: Request): Promise<Response> {
  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey) {
    return new Response("FIRMS_MAP_KEY not configured", { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "";
  const bbox = searchParams.get("bbox") ?? "";
  const days = Math.min(10, Math.max(1, Number(searchParams.get("days")) || 1));

  if (!VALID_SOURCES.has(source) || !BBOX_PATTERN.test(bbox)) {
    return new Response("Invalid source or bbox", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FIRMS_BASE}/${mapKey}/${source}/${bbox}/${days}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return new Response("FIRMS request timed out or failed", { status: 504 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/csv",
      // Roughly matches the client's refresh interval (see
      // FIRMS_REFRESH_INTERVAL_MS in main.ts) — FIRMS sees about one
      // request per cache window regardless of visitor volume.
      "Cache-Control": "public, max-age=900",
    },
  });
}
