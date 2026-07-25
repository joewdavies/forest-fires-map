# European Forest Fires

A MapLibre GL viewer for forest fires in Europe. Shows current active-fire
hotspots and burnt-area perimeters by default (each independently
toggleable), with a mode switch to browse historical burnt areas by year
instead. Rendered as a globe with a white basemap and black place-name
labels.

## Data & basemap

- **Fire data**: [EFFIS](https://forest-fire.emergency.copernicus.eu/) (European
  Forest Fire Information System, EU Joint Research Centre / Copernicus
  Emergency Management Service). Current fires render as WMS raster tiles —
  "Burnt areas" (the `severity_time` layer) and "Active fires" (hotspot
  detections from three satellite sources), matching the layer set EFFIS's
  own production viewer uses by default. Past fires (by year) come from the
  `ms:modis.ba.poly` WFS vector layer. EFFIS's WFS interface has proven very
  unreliable in practice, which is why current fires use WMS instead — see
  CLAUDE.md for the full story.
- **Country borders**: [GISCO](https://gisco-services.ec.europa.eu/) (Eurostat)
  country boundary lines, converted from topojson client-side.
- **Basemap**: [OpenFreeMap](https://openfreemap.org/) (Liberty style) — free
  vector tiles, no API key required.

EFFIS's endpoints are proxied (see `vite.config.ts` for dev, `api/effis.ts`
for production) rather than called directly from the browser, since their
CORS support isn't guaranteed to stay open indefinitely.

## Develop

```sh
npm install
npm run dev
```

## Build

```sh
npm run build   # type-checks then builds to dist/
npm run preview # serve the production build locally
```

## Deploy

Configured for [Vercel](https://vercel.com/): zero-config for the Vite
static build, with the EFFIS proxy as a Vercel Edge Function at
`api/effis.ts` (routes automatically to `/api/effis`, matching what the
frontend and dev proxy call). `vercel --prod` or a connected Git repo both
work out of the box — no `vercel.json` needed.
