export const config = { runtime: "edge" };

// Forwards WFS requests to EFFIS server-side, since EFFIS's WFS endpoint is
// not guaranteed to send CORS headers for direct browser access. The
// frontend never calls EFFIS directly — see /api/effis in src/effis.ts and
// the matching dev-time proxy in vite.config.ts. Placing this file at
// api/effis.ts maps it straight to the /api/effis route Vercel serves, so
// no rewrite rule is needed.
const EFFIS_BASE = "https://maps.effis.emergency.copernicus.eu/effis";

// EFFIS has been observed to hang indefinitely on requests proxied through
// this function specifically (while the same request succeeds in a few
// seconds when sent directly, outside Vercel's network) — plausibly EFFIS's
// WAF/rate-limiter reacting to Vercel's shared egress IPs, especially under
// the burst of parallel tile requests a single map pan/zoom generates. Left
// unbounded, that hang runs out the clock on Vercel's own function timeout
// (~25s) and surfaces as an opaque platform error page instead of a normal
// HTTP error, which is worse for MapLibre's tile loader than a fast failure.
const REQUEST_TIMEOUT_MS = 15_000;

export default async function handler(request: Request): Promise<Response> {
  const { search } = new URL(request.url);
  let upstream: Response;
  try {
    upstream = await fetch(`${EFFIS_BASE}${search}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return new Response("EFFIS request timed out or failed", { status: 504 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=300",
    },
  });
}
