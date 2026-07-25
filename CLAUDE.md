# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A MapLibre GL viewer showing forest fires in Europe: currently active fire
perimeters by default, with a toggle to browse historical burnt areas by
year. Vanilla TypeScript + Vite, no UI framework — the whole app is a map
plus a couple of controls.

## Commands

```sh
npm install
npm run dev      # dev server with EFFIS proxy at /api/effis
npm run build    # tsc -b type-check, then vite build to dist/
npm run preview  # serve the production build locally
```

There is no test suite or linter configured. Type-check with `npx tsc -b`
(no `--noEmit` needed to re-check; `tsconfig.json` already sets `noEmit`).

## Architecture

**Data flow**: there is no backend/database — everything is client-fetched
on demand, but "Current fires" and "Past fires" are two structurally
different pipelines feeding two independent, always-present map layers
(toggled via `visibility`, not swapped in place — see
`applyModeVisibility()` in `main.ts`):

- **Current fires** render as a **WMS raster tile overlay** (`modis.ba`
  layer, added in `map.ts`'s `addCurrentFiresLayer()`). No fetch/parsing
  code of ours is involved — MapLibre requests tiles on demand like any
  raster source. `effis.ts`'s `resolveEffisTileRequest()` + `map.ts`'s
  `transformRequest` adapt MapLibre's `{z}/{x}/{y}` tile grid into WMS
  `GetMap` calls (MapLibre has no native WMS support, so this is the
  standard adapter pattern — see the "EFFIS WFS vs WMS" note below for why
  WMS specifically).
- **Past fires** (by year) still use the original **WFS vector** pipeline:
  `fetchHistoricalFires(year)` in `effis.ts` returns GeoJSON, which
  `main.ts` puts on a `geojson` source (`fires`) rendered as a fill +
  outline layer, clickable for a details popup.

**EFFIS WFS vs WMS: WFS does not work, in practice.** EFFIS exposes this
burnt-area data through both a WFS interface (vector features) and a WMS/WMTS
interface (raster tiles). Across extensive testing, EFFIS's WFS endpoint —
what this app originally used for *all* fire data — hung or errored on
**every single request**, including EFFIS's own documented zero-parameter
example, independent of query shape, filters, or field names; it is not a
"we got the call wrong" problem. Its WMS endpoint (`GetMap` on the `modis.ba`
layer), by contrast, responds successfully most of the time in 1-3 seconds —
this is confirmed to be what EFFIS's *own* production viewer
(`forest-fire.emergency.copernicus.eu/apps/effis.csv`) actually uses for the
current-situation view, found by inspecting that app's own bundled JS. WMS
still isn't perfectly reliable (EFFIS's backend overall seems to be under
real strain, plausibly load from peak Mediterranean fire season), but it's
dramatically better than WFS, which is why current fires moved to it. Past
fires stay on WFS because no historical/date-filtered access path has been
found to work reliably: neither `modis.ba.<year>` (WMTS, the pattern
EFFIS's own viewer uses for past years) nor a `TIME=`-filtered WMS `GetMap`
on `modis.ba` returned anything but a hang in testing — historical/temporal
queries specifically seem to be the broken code path on EFFIS's backend,
regardless of protocol. If EFFIS's WFS reliability ever improves, or a
working historical WMS/WMTS pattern is found, `fetchHistoricalFires` is the
place to swap it in.

**Why the app never fetches EFFIS directly.** Both the WFS calls (past
fires) and the WMS tile calls (current fires) go through the relative path
`/api/effis` — never straight to `maps.effis.emergency.copernicus.eu`. In
dev, `vite.config.ts` proxies that to
`https://maps.effis.emergency.copernicus.eu/effis`. In production, `api/effis.ts`
is a Vercel Edge Function that forwards the request server-side — its path
(`api/effis.ts`) maps directly to the `/api/effis` route Vercel serves, no
rewrite rule needed. This exists because EFFIS's CORS support isn't
guaranteed to stay open (it happens to be open today on both interfaces,
confirmed by inspecting response headers, but going through a same-origin
proxy sidesteps depending on that continuing to be true). Both proxy
implementations must stay in sync if the upstream URL or query shape
changes.

**EFFIS's WFS response is a zipped shapefile, not GeoJSON**, and it must be
requested as a raw buffer, not a URL string. `shpjs`'s `shp()` function only
treats a *URL* as a zip if the path literally ends in `.zip`; for anything
else it guesses `.shp`/`.dbf`/`.prj` sibling URLs, which breaks for a
query-string-driven WFS request. `requestBurntAreas()` in `src/effis.ts`
therefore always `fetch()`s the URL itself and passes the resulting
`ArrayBuffer` to `shp()`. `shpjs` is dynamically `import()`ed (not a static
import) so its `JSZip` dependency — the majority of the production bundle
size — only loads once a fire-data request actually happens, not on initial
page load.

**Field names are probed, not hardcoded.** EFFIS's attribute schema/casing
isn't authoritatively pinned down in this codebase (the live service was
unstable during initial development, and their casing has changed
historically). `getFireDateIso()`, `getBurntAreaHa()`, `getCountry()`, and
`getProvince()` in `src/effis.ts` each try a list of candidate property keys
(`DATE_KEYS`, `AREA_KEYS`, etc.) rather than assuming one exact name. If a
popup ever shows "Unknown" where real data exists, check the actual
`feature.properties` keys coming back from EFFIS and add the real key to the
relevant candidate list.

**Server-side date filtering degrades gracefully.** `fetchAndFilter()` tries
a `cql_filter` query param first (fast — EFFIS only returns matching
features). If that request fails for *any* reason (wrong field name, server
rejection, WAF block — EFFIS's AWS-fronted endpoint has been observed
403'ing requests whose `cql_filter` contains a quoted `AND` comparison,
which looks like a SQL-injection signature to its WAF), it falls back to an
unfiltered request and filters client-side using the same flexible date
parsing. Every request also has a 20s client-side abort timeout
(`REQUEST_TIMEOUT_MS`) — the upstream service has been observed hanging
without ever returning a response, and without this the UI would spin on
"Loading…" indefinitely.

**Stale-response guarding.** `loadFires()` in `src/main.ts` tags each
request with an incrementing `requestId` and discards the result if a newer
request has since started (e.g. rapidly toggling Current/Past or changing
the year). Don't remove this without another way to prevent race conditions
between overlapping fetches.

**Map styling is deliberately monochrome + red.** `stripToPlaceLabelsOnly()`
in `src/map.ts` takes OpenFreeMap's full-colour Liberty style and, on every
`load`, programmatically forces it down to a white background plus black
place-name labels — everything else (roads, water, buildings, POI icons, the
shaded-relief raster) gets `visibility: 'none'`. It walks `map.getStyle().layers`
structurally (by `type` / `source-layer === 'place'`) rather than by hardcoded
layer id, so it keeps working if Liberty's ~110-layer list changes upstream.
Fire polygons (added separately in `main.ts`) are the only other colour, in
red. If you need to reintroduce any basemap colour (e.g. water), add a case
to that function rather than switching to a different base style — Liberty
was chosen specifically so place-label layout/hierarchy could be kept as-is
while everything else is stripped.

**Globe projection requires the style to be loaded.** `map.setProjection({ type: "globe" })`
throws ("Style is not done loading.") if called before the map's `load`
event — hence it lives inside the same `load` handler as the style-stripping
call, not immediately after `new Map(...)`.

**Country borders are a separate GISCO overlay, not part of the basemap.**
`addCountryBorders()` in `src/map.ts` fetches Eurostat GISCO's
`CNTR_BN_20M_2024_4326` topojson (country borders + coastlines as
LineStrings — combined they trace each country's full outline), converts it
to GeoJSON client-side with `topojson-client`, and adds it as a black line
layer positioned *below* the first symbol layer (so place-name text stays
legible on top of border lines, via the `beforeId` argument to
`addLayer`). CORS is wide open on that endpoint, so no proxy is needed.

## Gotchas

**maplibre-gl v6's Web Worker breaks under Vite in both dev *and*
production — this is the one that will bite you hardest.** The map gets
stuck permanently: `map.on('load', ...)` never fires, the basemap looks like
unstyled Liberty (coloured, no place labels, no white background), and no
fires ever render — with **zero console errors**, because the failure
happens inside the worker, not the main thread. `src/map.ts` calls
`setWorkerUrl("/maplibre-gl-worker.mjs")` at module load, pointing at a
static copy served from `public/` (kept in sync by
`scripts/copy-maplibre-worker.mjs`, run via the `predev`/`prebuild` npm
scripts) — **both `maplibre-gl-worker.mjs` and its sibling
`maplibre-gl-shared.mjs` must be copied together**, since the worker
`import`s the shared chunk by a relative path resolved against wherever the
worker script is served from. Copying only the worker file looks like it
works (the worker *is* created — check via `page.on('worker', ...)` in a
Playwright script) but it 404s on the shared-chunk import and the worker
dies silently within milliseconds of creation.

Root cause: maplibre-gl v6 builds its worker URL dynamically at runtime
(`new URL(`./${name}`, import.meta.url)` with a runtime-computed `name`),
which bundlers can only special-case for a *static* string literal — so
Vite never knows to bundle the worker (or its shared chunk) as assets in
`vite build`, and separately mishandles it in dev's dependency pre-bundler
(`node_modules/.vite/deps/maplibre-gl-worker.mjs` 404s; harmless-looking
console warning, easy to miss). `vite.config.ts`'s
`optimizeDeps.exclude: ["maplibre-gl"]` fixes the dev-only symptom but does
nothing for production — the `setWorkerUrl` + static-copy fix above is the
one that actually matters and covers both.

If you ever bump `maplibre-gl`, rerun `npm run copy-maplibre-worker` (or
just `npm run build`/`npm run dev`, which do it automatically) — the copied
files aren't tracked by npm's dependency resolution, so an upgrade won't
update them on its own until the pre-scripts rerun.

**`maplibre-gl` v6 has no default export.** `import maplibregl from
"maplibre-gl"` (the v4-era pattern) fails to compile — use named imports
(`import { Map, NavigationControl, Popup, ... } from "maplibre-gl"`).

## Key files

- `src/map.ts` — MapLibre init, OpenFreeMap basemap reduced to white +
  black-labels-only, globe projection, Europe bounds, GISCO country borders,
  current-fires WMS raster layer + the `transformRequest` that powers it.
- `src/effis.ts` — EFFIS fetch/parse/filter logic and property accessors.
- `src/borders.ts` — fetches + converts the GISCO country-borders topojson.
- `src/main.ts` — wires the map, the current/past toggle, year `<select>`,
  and click-to-popup behavior together.
- `api/effis.ts` (Vercel Edge Function) + `vite.config.ts` (`server.proxy`)
  — the two proxy implementations that must stay behaviorally equivalent.
- `scripts/copy-maplibre-worker.mjs` + `public/` — see the Web Worker
  gotcha above.

## Known unknowns

EFFIS's backend is generally under real strain (plausibly load from peak
Mediterranean fire season) — even the WMS path used for current fires,
while dramatically more reliable than WFS, is not 100% solid; expect
occasional gaps in tile coverage rather than a hard error, since a single
failed raster tile just doesn't render (no error UI, matching how the
basemap's own raster layers already behave). If "Current fires" looks
sparse, that may just be an accurate reflection of the fire situation
rather than a loading failure — there's no easy way from the client side to
distinguish "no fires here" from "this tile failed to load" for a raster
overlay.

WMS `GetFeatureInfo` (which would let users click a current-fire tile for
details, mirroring the popup that already works for "Past fires") was
tested and found unreliable — every `INFO_FORMAT` tried either hung or
returned an "unsupported format" error, with no format found that actually
returns data. It's not wired up for that reason; if EFFIS's service
stabilizes, `resolveEffisTileRequest`'s WMS parameter pattern in
`src/effis.ts` is the place to add a `GetFeatureInfo` variant.

EFFIS's WFS field names/casing (used for "Past fires") were taken from
EFFIS's own published documentation, not guessed, but have never been
confirmed against a live successful response — every WFS request made
during development hung or errored, including EFFIS's own documented
zero-parameter example. If you're debugging a "Past fires" data issue,
check the network tab for the actual `feature.properties` shape before
assuming the code is wrong.
