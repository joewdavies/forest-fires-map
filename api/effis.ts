export const config = { runtime: "edge" };

// Forwards WFS requests to EFFIS server-side, since EFFIS's WFS endpoint is
// not guaranteed to send CORS headers for direct browser access. The
// frontend never calls EFFIS directly — see /api/effis in src/effis.ts and
// the matching dev-time proxy in vite.config.ts. Placing this file at
// api/effis.ts maps it straight to the /api/effis route Vercel serves, so
// no rewrite rule is needed.
const EFFIS_BASE = "https://maps.effis.emergency.copernicus.eu/effis";

export default async function handler(request: Request): Promise<Response> {
  const { search } = new URL(request.url);
  const upstream = await fetch(`${EFFIS_BASE}${search}`);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=300",
    },
  });
}
