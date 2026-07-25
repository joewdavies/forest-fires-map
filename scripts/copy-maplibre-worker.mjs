// maplibre-gl's tile-parsing Web Worker is loaded via a runtime `new
// Worker(url)` call that Vite can't statically bundle (see src/map.ts), so
// we serve it — and its sibling chunk it imports at runtime — as static
// assets instead. Both files must be copied together: the worker's own
// `import ... from "./maplibre-gl-shared.mjs"` is resolved relative to
// wherever the worker script is served from.
import { copyFileSync } from "node:fs";

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

for (const file of files) {
  copyFileSync(`node_modules/maplibre-gl/dist/${file}`, `public/${file}`);
}
