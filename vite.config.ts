import { defineConfig } from "vite";

// EFFIS's WFS endpoint is proxied under /api/effis both in dev (here) and in
// production (via api/effis.ts, a Vercel Edge Function), so the browser
// always requests same-origin and never has to deal with EFFIS's CORS
// policy directly.
export default defineConfig({
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
});
