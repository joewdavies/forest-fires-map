import { defineConfig } from "vite";

// EFFIS's WFS endpoint is proxied under /api/effis both in dev (here) and in
// production (via the Netlify redirect + function in netlify.toml), so the
// browser always requests same-origin and never has to deal with EFFIS's
// CORS policy directly.
export default defineConfig({
  server: {
    proxy: {
      "/api/effis": {
        target: "https://maps.effis.emergency.copernicus.eu",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/effis/, "/effis"),
      },
    },
  },
});
