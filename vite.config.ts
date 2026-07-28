import { defineConfig, loadEnv } from "vite";

// EFFIS's WFS endpoint is proxied under /api/effis both in dev (here) and in
// production (via api/effis.ts, a Vercel Edge Function), so the browser
// always requests same-origin and never has to deal with EFFIS's CORS
// policy directly.
export default defineConfig(({ mode }) => {
  // "" as the third arg loads every env var, not just VITE_-prefixed ones —
  // deliberate: FIRMS_MAP_KEY must NEVER get a VITE_ prefix, since Vite only
  // inlines VITE_-prefixed vars into the client bundle. Naming it
  // VITE_FIRMS_MAP_KEY would ship the secret in plain text to every visitor.
  // This is also *why* it has to be read here rather than via
  // `import.meta.env` like client code would — vite.config.ts runs in Node,
  // before Vite's usual client-side env exposure applies at all.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // main.ts uses a top-level `await createMap(...)` (see map.ts — the
    // basemap style is fetched and stripped to white/globe *before* the Map
    // is constructed, to avoid a flash of the full-colour Mercator style).
    // Vite/esbuild's default production target predates top-level await
    // support; es2022 is the first target that has it.
    build: { target: "es2022" },
    server: {
      proxy: {
        "/api/effis": {
          target: "https://maps.effis.emergency.copernicus.eu",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/effis/, "/effis"),
        },
        // Current-fires tiles use a separate upstream mount (/effist/wmts,
        // not /effis) — see api/wmts.ts and src/effis.ts's tileTemplate().
        "/api/wmts": {
          target: "https://maps.effis.emergency.copernicus.eu",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/wmts/, "/effist/wmts"),
        },
        // NASA FIRMS's MAP_KEY is a URL *path segment*
        // (/api/area/csv/{MAP_KEY}/{SOURCE}/{bbox}/{days}), not a query
        // param, so this can't be a plain prefix-strip rewrite like the two
        // above — it has to read the client's simple params and construct
        // the real FIRMS path itself, injecting the key from the env var
        // (never sent by, or visible to, the client). Mirrors api/firms.ts's
        // production behavior exactly, per CLAUDE.md's "each dev/prod pair
        // must stay behaviorally equivalent."
        "/api/firms": {
          target: "https://firms.modaps.eosdis.nasa.gov",
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URL(path, "http://localhost");
            const source = url.searchParams.get("source") ?? "";
            const bbox = url.searchParams.get("bbox") ?? "";
            const days = url.searchParams.get("days") ?? "1";
            const date = url.searchParams.get("date") ?? "";
            let targetPath = `/api/area/csv/${env.FIRMS_MAP_KEY ?? ""}/${source}/${bbox}/${days}`;
            if (date) {
              targetPath += `/${date}`;
            }
            return targetPath;
          },
        },
      },
    },
    optimizeDeps: {
      // maplibre-gl loads its own Web Worker as a separate file; Vite's
      // dependency pre-bundler mishandles that extra entry point (the worker
      // 404s from node_modules/.vite/deps, so vector tiles never finish
      // parsing and the style never reaches 'load'). Excluding it serves
      // maplibre-gl as native ESM instead, sidestepping the pre-bundle step.
      exclude: ["maplibre-gl"],
    },
  };
});
