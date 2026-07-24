# European Forest Fires

A MapLibre GL viewer for forest fires in Europe. Shows currently active fire
perimeters by default, with a toggle to browse historical burnt areas by
year. Rendered as a globe with a white basemap, black place-name labels, and
red fire polygons — no other colour on the map.

## Data & basemap

- **Fire data**: [EFFIS](https://forest-fire.emergency.copernicus.eu/) (European
  Forest Fire Information System, EU Joint Research Centre / Copernicus
  Emergency Management Service) — `ms:modis.ba.poly` WFS layer, a
  continuously-updated burnt-area perimeter database covering both the
  current fire season and the historical archive back to 2000.
- **Basemap**: [OpenFreeMap](https://openfreemap.org/) (Liberty style) — free
  vector tiles, no API key required.

EFFIS's WFS endpoint is proxied (see `vite.config.ts` for dev, `api/effis.ts`
for production) rather than called directly from the browser, since its
CORS support isn't guaranteed.

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
