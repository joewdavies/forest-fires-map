export const config = { runtime: "edge" };

// Forwards current-fires WMTS tile requests to EFFIS server-side. This is a
// *different* upstream path than api/effis.ts's WFS/WMS proxy
// (/effist/wmts vs /effis) — EFFIS hosts its tile-matrix service on a
// separate mount point, confirmed by capturing a HAR of EFFIS's own
// "Current Situation Viewer" in the browser network tab. See
// src/effis.ts's tileTemplate() for why current fires use WMTS here
// instead of the WMS GetMap approach api/effis.ts still serves for "Past
// fires" (WFS) and any WMS fallback.
const EFFIS_WMTS_BASE = "https://maps.effis.emergency.copernicus.eu/effist/wmts";

// See api/effis.ts for why this exists — EFFIS has been observed to hang
// indefinitely on requests proxied through Vercel specifically.
const REQUEST_TIMEOUT_MS = 15_000;

export default async function handler(request: Request): Promise<Response> {
  const { search } = new URL(request.url);
  let upstream: Response;
  try {
    upstream = await fetch(`${EFFIS_WMTS_BASE}${search}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return new Response("EFFIS WMTS request timed out or failed", { status: 504 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=900, s-maxage=1800, stale-while-revalidate=600",
    },
  });
}
