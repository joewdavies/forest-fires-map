# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A MapLibre GL viewer showing forest fires in Europe: current active-fire
hotspots and burnt-area perimeters by default (each independently
toggleable), with a mode switch to browse historical burnt areas by year
instead. Vanilla TypeScript + Vite, no UI framework — the whole app is a
map plus a handful of controls.

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
on demand, but "Current fires" and "Past fires" are structurally different
pipelines feeding independent, always-present map layers (toggled via
`visibility`, not swapped in place — see `applyModeVisibility()` in
`main.ts`):

- **Current fires** split into two separately-toggleable **WMTS raster tile
  overlays**, matching EFFIS's own "Current Situation Viewer" (its default
  layer set is visible directly in its URL —
  `?tiles=hsl,modis.hs.week,viirs.all.week,s3.hs.week,modis.ba.week,
  severity_time.week,nrt.ba.week`):
  - **"Burnt areas"** (`BURNT_AREAS_LAYER_IDS`, two raster sources
    stacked) — fire perimeter polygons from two independent products
    (MODIS + near-real-time).
  - **"Active fires"** (`ACTIVE_FIRES_LAYER_IDS`, three raster sources
    stacked) — hotspot detections from three independent satellite
    sources, rendered as points/triangles by the tile server itself.

  Both are added in `map.ts`'s `addBurntAreasLayers()` /
  `addActiveFiresLayers()`. No fetch/parsing code of ours is involved for
  either — MapLibre requests tiles on demand like any raster source, and
  needs no custom adapter here: `effis.ts`'s `tileTemplate()` builds a
  standard `{z}/{x}/{y}` MapLibre raster tile template pointed at EFFIS's
  WMTS `GetTile` endpoint, and MapLibre substitutes those natively (see the
  "EFFIS WFS vs WMS vs WMTS" note below for why WMTS specifically, and for
  the `tileSize: 1024` detail that makes `{z}/{x}/{y}` line up with EFFIS's
  tile matrix). The two toggle checkboxes in the toolbar just flip
  `visibility` on the corresponding layer(s); see `applyModeVisibility()`
  in `main.ts`.
- **Past fires** (by year) render as *two* layers at once, deliberately —
  see "Past fires: WFS *and* WMTS, on purpose" below for why:
  - The original **WFS vector** pipeline: `fetchHistoricalFires(year)` in
    `effis.ts` returns GeoJSON, which `main.ts` puts on a `geojson` source
    (`fires`) rendered as a fill + outline layer, clickable for a details
    popup (date/area/country/province). This is the only source of
    per-fire click details, but has never once succeeded in any testing —
    it's kept wired up on the chance EFFIS's WFS reliability improves, not
    because it currently works.
  - A **WMTS raster** layer (`PAST_FIRES_LAYER_ID`, added in map.ts's
    `addPastFiresLayer()`), using `modis.ba.<year>` — confirmed reliably
    working, but only for 2016 onward (`EARLIEST_WMTS_YEAR` in effis.ts)
    and with no per-fire click data available (see below). `main.ts`'s
    `setPastFiresYear()` repoints this layer's tiles whenever the selected
    year changes, via MapLibre's `RasterTileSource.setTiles()`.

  There's no historical equivalent of "active fires" (hotspots) — hotspot
  detections are inherently a *current* concept.

**EFFIS WFS vs WMS vs WMTS: WFS doesn't work, and neither does WMS for
current-fires tiles — WMTS is the one that actually does.** EFFIS exposes
this data three ways, and the three-way choice is *not* interchangeable
protocol trivia — it's the difference between the map rendering fires and
rendering nothing. WFS (vector features) — what this app originally used
for *all* fire data — hung or errored on **every single request** during
development, including EFFIS's own documented zero-parameter example,
independent of query shape, filters, or field names; it's not a "we got the
call wrong" problem, so "Past fires" still uses it only for lack of a
working alternative (see below). Current fires first moved to WMS
(`GetMap`, raster tiles, same upstream host as WFS) on the strength of one
confirmed-working layer — but WMS turned out to reliably **hang** on every
`.week`-suffixed layer, which is every hotspot layer and (at the time) the
only working burnt-areas layer, so "Active fires" never actually rendered
anything in production despite being wired up.

The fix (found 2026-07-25, diagnosing a "Current fires shows nothing"
report) came from capturing a HAR of EFFIS's own production viewer
(`forest-fire.emergency.copernicus.eu/apps/effis.csv`) while it was
successfully rendering, and reading its actual network requests rather than
its URL bar. It never calls WMS for current-fires tiles at all — every
single tile request goes to a **WMTS** `GetTile` endpoint at a *different*
upstream mount, `/effist/wmts` (note: "effist", not "effis" — easy to miss,
and the reason an earlier attempt at a WMTS pattern for past years,
`modis.ba.<year>`, never worked: it was likely sent to the wrong mount).
Replaying that exact request shape — `Service=WMTS&Request=GetTile` with
`TileMatrix`/`TileCol`/`TileRow` and an explicit `time=<from>/<to>` range,
not WMS's `BBOX` — against every `.week` layer returned real image data
reliably, live, on the first try. So the earlier "every `.week`-suffixed
layer hangs on every request" conclusion was real but incomplete: it's
specific to *WMS*. WMTS, at the right mount, doesn't have this problem.
Current fires now use WMTS exclusively (`src/effis.ts`'s `tileTemplate()`,
proxied via `api/wmts.ts` — see below); WMS is no longer used anywhere in
this codebase.

**Past fires: WFS *and* WMTS, on purpose — not a migration, a deliberate
pairing.** Once WMTS proved reliable for *current* fires, the obvious next
question was whether `modis.ba.<year>` (the per-year layer EFFIS's own
viewer uses for past years, and the one this file long assumed hung like
everything else time-scoped) would work too if requested against the
*correct* mount (`/effist/wmts`) instead of wherever it was tested before.
It does: `modis.ba.2016` through `modis.ba.2025` (2015 and earlier 400 —
that's the actual lower bound, not a guess) each return genuinely different
image data, confirmed by decoding and comparing tiles across several years
side by side, not just checking that requests succeed. So "Past fires"
could have simply *replaced* WFS with this — except WMTS has no working
per-feature query here either (`GetFeatureInfo` against a `modis.ba.<year>`
layer returns the exact same "LayerNotDefined" WMS-style error the old
current-fires `GetFeatureInfo` attempt got — confirmed, not assumed), so a
pure WMTS replacement would mean losing the click-for-details popup
(exact date/area/country/province) entirely, forever, even if EFFIS's WFS
reliability someday improves. Given that tradeoff, both are wired up
side by side instead (see the data-flow bullets above): WMTS gives a
reliably-visible layer for 2016+, WFS keeps driving `fetchHistoricalFires`
and the click popup underneath, dormant more often than not, but ready to
start working the moment EFFIS's WFS does, with no further code changes
needed. Years before 2016 look exactly as broken as they always have —
this didn't regress anything, it only extended coverage where EFFIS
actually has data.

**Which WMTS layer, specifically, matters a lot.** `WMTS_LAYERS` in
`src/effis.ts` maps each layer "kind" to its EFFIS WMTS layer identifier —
all five now confirmed live and working, each verified by actually
decoding the returned PNG and looking at it, not just checking the HTTP
status (a *reachable* layer can still silently return a blank tile — see
`burnt-areas-modis`/`burnt-areas-nrt` below, which is exactly that bug):

- `burnt-areas-modis` / `burnt-areas-nrt` → `modis.ba.week` / `nrt.ba.week`,
  stacked together (mirroring how `active-fires-*` stacks three sources)
  under one "Burnt areas" toggle. The *original* choice here —
  `severity_time.week` ("FIRE SEVERITY, weekly updated"), and before that
  `severity_time` over WMS, and before *that* `modis.ba` over WMS ("MODIS/
  SENTINEL2 (supervised)", a full land-cover classification that rendered
  solid green almost everywhere instead of highlighting fires) — turned out
  to be a dead end for a subtler reason than any of those: it's reachable
  and returns HTTP 200, but the PNG it returns is *fully blank/transparent*
  at every coordinate tested, including ones with clearly active nearby
  fires. An HTTP-status-only check would never catch this; it was only
  caught by fetching the tile and opening it as an image. `modis.ba.week`
  and `nrt.ba.week` both returned real polygon data at the same
  coordinates and are used instead. If burnt areas ever go blank again,
  don't trust a "the requests are succeeding" check alone — decode a tile
  and look at it, the same way this bug was found.
- `active-fires-modis` / `active-fires-viirs` / `active-fires-s3` →
  `modis.hs.week` / `viirs.hs.week` / `s3.hs.week`. Note `viirs.hs.week`,
  *not* `viirs.all.week` — the app's own URL bar advertises `viirs.all.week`
  in its `tiles=` param, but its actual `GetTile` network calls request
  `viirs.hs.week`; the two disagree, and the real network calls are what's
  confirmed working. All three hotspot layers were previously believed
  possibly-broken-or-possibly-wrong-name; they're now confirmed working
  correctly-named, just over the wrong protocol before.

**Why the app never fetches EFFIS directly — and why there are *two*
proxies, not one.** Nothing ever calls `maps.effis.emergency.copernicus.eu`
straight from the browser; everything goes through a same-origin relative
path first. There are two such paths, because EFFIS serves WFS and WMTS
from two *different* upstream mounts and both need proxying separately:
- `/api/effis` (WFS calls for "Past fires") → upstream `/effis`. In dev,
  `vite.config.ts` proxies this to
  `https://maps.effis.emergency.copernicus.eu/effis`. In production,
  `api/effis.ts` is a Vercel Edge Function that forwards it server-side —
  its path (`api/effis.ts`) maps directly to the `/api/effis` route Vercel
  serves, no rewrite rule needed.
- `/api/wmts` (WMTS `GetTile` calls for current fires) → upstream
  `/effist/wmts` (note the different path *and* the "effist" vs "effis"
  spelling — see the WFS/WMS/WMTS note above). Same dev/prod split:
  `vite.config.ts`'s second proxy entry, and `api/wmts.ts` in production.

Both exist because EFFIS's CORS support isn't guaranteed to stay open (it
happens to be open today on both interfaces, confirmed by inspecting
response headers, but going through a same-origin proxy sidesteps depending
on that continuing to be true). All four proxy definitions (two files, two
`vite.config.ts` entries) must stay in sync if either upstream URL or query
shape changes — they're deliberately *not* merged into one generic
"forward whatever path suffix arrives" proxy, since `/api/effis` and
`/api/wmts` sharing a naming prefix as literal path prefixes would risk one
swallowing the other in Vite's prefix-matching proxy config depending on
declaration order; keeping them as fully separate, non-overlapping route
names sidesteps that footgun entirely.

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

**Map styling is deliberately monochrome + red — and applied before the map
is ever constructed, not after.** `loadStrippedStyle()` in `src/map.ts`
`fetch()`es OpenFreeMap's Liberty style JSON directly (rather than passing
the style *URL* to `new Map()` and letting MapLibre fetch it), then
`stripToPlaceLabelsOnly()` mutates that plain object down to a white
background plus black place-name labels — everything else (roads, water,
buildings, POI icons, the shaded-relief raster) gets `visibility: 'none'`
— and `style.projection = { type: "globe" }` is set on the same object,
all before that finished style object is handed to `new Map({ style,
... })`. This ordering is the whole point: mutating a *live* map's paint/
layout/projection only after its `load` event (the previous approach) means
the original full-colour Mercator Liberty style renders for at least one
frame first, then visibly snaps to white/globe — a flash. Pre-transforming
the style object means the very first frame already looks right. The
functions still walk `layers` structurally (by `type` /
`source-layer === 'place'`) rather than by hardcoded layer id, so they keep
working if Liberty's ~110-layer list changes upstream — that part is
unchanged, only *when* it runs moved earlier. If this fetch fails,
`loadStrippedStyle()` falls back to passing the plain style URL to
`new Map()` (reintroducing the flash, but at least the map still loads).

Past-fires polygons (added separately in `main.ts`) are red, by our own
choice. The two current-fires WMTS raster overlays are *not* controlled by
us the same way — their colours (burn severity gradient, hotspot markers)
are whatever EFFIS's server renders, so the map is no longer strictly
monochrome-plus-red once "Active fires"/"Burnt areas" are showing real
data; that's an accepted tradeoff of using EFFIS's own rendered tiles
rather than vector data we could restyle ourselves. If you need to
reintroduce any basemap colour (e.g. water), add a case to
`stripToPlaceLabelsOnly` rather than switching to a different base style —
Liberty was chosen specifically so place-label layout/hierarchy could be
kept as-is while everything else is stripped.

**`vite.config.ts` sets `build.target: "es2022"`.** `main.ts` does a
top-level `await createMap(...)` (needed because `createMap` is now async —
see above), and Vite/esbuild's default production target predates
top-level-await support, so the plain default build fails with "Top-level
await is not available in the configured target environment." es2022 is
the first target with it. `npm run dev` was never affected (dev mode uses
native ESM in the browser directly, no target-restricted transpilation).

**EFFIS health warning: closes the "no error UI for raster tiles" gap, on
purpose, without per-tile precision.** Both current-fires WMTS overlays and
the past-fires WMTS overlay are plain MapLibre raster sources — no fetch/
parsing code of ours is in the loop (see the data-flow bullets above), so
until `src/effisHealth.ts` existed, a failing tile just silently didn't
render, with zero visibility to the user or to us. `watchEffisHealth(map,
onChange)` fixes that at the *aggregate* level (not per-tile — see "Known
unknowns" below for why per-tile still isn't diagnosable) via two
independent, rolling-window signals. `onChange` receives an
`EffisHealthReport` (`{ overall, activeFires, burntAreas, pastFires }`,
each a `"ok" | "slow" | "down"` value) rather than one flat health value —
`overall` drives the warning banner below, unchanged in behavior from
before this had per-group tracking, while the three per-group fields exist
so a consumer can react to e.g. "Active fires specifically is down" without
also tripping on a Burnt-areas-only problem it has no fallback for (see
"NASA FIRMS fallback for Active fires" below, the reason this split exists
at all):
- **Tile failures** — `map.on('error', ...)`, filtered to our own raster
  source ids (`TRACKED_SOURCE_IDS`: `BURNT_AREAS_LAYER_IDS` +
  `ACTIVE_FIRES_LAYER_IDS` + `PAST_FIRES_LAYER_ID`) so basemap/border tile
  failures don't count; `groupForSourceId()` attributes each failure to
  exactly one group (source ids don't overlap between groups). This relies
  on an undocumented-but-real runtime
  behavior: MapLibre's public types don't declare `sourceId` on
  `ErrorEvent`, but every tile source forwards its own 'error' events up
  through the style to the map with `sourceId` mixed in regardless
  (confirmed by reading maplibre-gl's bundled source, not assumed) — hence
  the local type cast in `effisHealth.ts`. MapLibre already filters out 404s
  before firing (an expected "no tile here" response), so anything that
  reaches this handler is a genuine failure (500/504/network error). 4+
  failures within 20s (not a single one — see "Known unknowns" on why a
  handful of 500s is routine) escalates to `"down"`.
- **Slow proxy responses** — a `PerformanceObserver` on `resource` timing
  entries, filtered to URLs under `/api/wmts` and `/api/effis`. This catches
  degradation *earlier* than tile failures do, since it counts requests that
  are merely slow (≥4s), including ones that eventually succeed — both
  proxies already hard-timeout their upstream fetch at 15s (see
  `REQUEST_TIMEOUT_MS` in `api/effis.ts`/`api/wmts.ts`), so this threshold
  sits well under that ceiling. 3+ slow responses within 30s escalates to
  `"slow"` (unless already `"down"`). Group attribution here
  (`groupsForResourceUrl()`) stops at *mount* granularity, not per-tile-layer
  — `/api/wmts` counts toward both `activeFires` and `burntAreas` (it serves
  both), `/api/effis` toward `pastFires` only — since that's the real fault
  boundary this section already documents (the two mounts behave
  differently from each other; individual layers sharing one mount don't).
  The observer calls
  `performance.clearResourceTimings()` after each batch — the browser's
  resource-timing buffer silently *stops recording new entries* once full
  (default cap 250, shared with every other same-origin request the page
  makes), which would otherwise make this go quiet after the first few
  minutes of a session.

Both signals use rolling windows (pruned on every check, plus a 5s recheck
interval to catch pruning-driven recovery even with no new events), so
health genuinely recovers once EFFIS does — no page reload needed. `main.ts`
renders the result as a dismissible banner (`#effis-warning`, a normal flex
child between the toolbar and the map, not an absolutely-positioned overlay
— deliberately, so it doesn't need to fight the many *other* floating panels
for z-index). Dismissing suppresses that exact level (`dismissedEffisHealth`
in `main.ts`) without suppressing forever: a later escalation (e.g.
`"slow"` → `"down"`) or a recovery-then-relapse re-arms it, so it can warn
again without nagging on every additional failure at the same severity.
Verified 2026-07-26 by both synthetic `map.fire('error', ...)` injection
(confirms the threshold/dismiss/re-arm logic deterministically) and,
unplanned but useful, a genuinely live EFFIS outage at the time of testing
(confirms the real event actually reaches the watcher end to end — see
"Known unknowns" below).

The word "EFFIS" in both messages (`effis_status_slow`/`effis_status_down`
in `src/i18n.ts`) links to `EFFIS_EXAMPLE_REQUEST_URL` in `main.ts` — a
direct `GetTile` request against EFFIS's real upstream host
(`maps.effis.emergency.copernicus.eu/effist/wmts`), deliberately
*bypassing* our own `/api/wmts` proxy, so a user (or a developer chasing a
report) can tell whether it's genuinely EFFIS struggling or just our proxy
path — the same distinction "Requests through either production proxy have
been observed hanging even when EFFIS itself is fine" (below) otherwise
requires comparing a direct `curl` against the proxied request by hand. It
isn't one of our own real `tileTemplate()` layers/tilematrixset — it's a
generic, illustrative `GetTile` call so the link means the same thing
regardless of which of our actual layers is the one currently struggling.
The translation strings carry `{effisLinkOpen}`/`{effisLinkClose}`
placeholders rather than raw `<a>` markup, so the link itself lives in one
place (`main.ts`'s `effisWarningHtml()`) instead of being duplicated across
every language; `effisWarningText.innerHTML` is safe here since both the
message template and the injected link markup come from our own static
sources, never from user input.

**NASA FIRMS fallback for Active fires — engages automatically at most once,
EFFIS stays the default, and a manual EFFIS/FIRMS toggle sits in the layers
sheet.** EFFIS's own active-fire detection is itself built on NASA FIRMS
(confirmed in `docs/firms-migration-plan.md`). The *only* automatic trigger
is the cold-start check below, which runs once per page load; after that,
"Active fires" only changes source via the manual toggle in the layers sheet
— `watchEffisHealth`'s ongoing health reports (see above) drive the warning
banner but deliberately do not re-engage or disengage FIRMS for the rest of
the session (an earlier version did exactly that, and a flapping EFFIS
backend made the active layer flip back and forth automatically — see "The
manual override" below for why this was simplified to a one-time decision
plus a plain toggle). Scoped deliberately narrow: "Burnt areas" and "Past
fires" have no FIRMS equivalent (FIRMS is point-hotspot data only, no
burned-area/burn-scar product — see `docs/firms-migration-plan.md` for the
full research) and are untouched by this regardless of their own health.
- `src/firms.ts` fetches NASA's authenticated `area/csv` endpoint (`MODIS_NRT`
  + all three separate VIIRS `SOURCE` values — FIRMS has no single
  combined-VIIRS source the way EFFIS's `viirs.hs.week` covers SNPP +
  NOAA-20/21 together) via `api/firms.ts`, in parallel, merging results
  client-side. **Accepted coverage gap**: FIRMS has no Sentinel-3 equivalent
  (EFFIS's third active-fires source, `active-fires-s3`), so a fire visible
  only to Sentinel-3 won't appear during a fallback.
- `api/firms.ts` is **not** a passthrough like `api/effis.ts`/`api/wmts.ts`
  — FIRMS's `MAP_KEY` is a URL *path segment*
  (`/api/area/csv/{MAP_KEY}/{SOURCE}/{bbox}/{days}`), not a query param, so
  it can never be something the client supplies or sees. The client sends
  plain params (`source`/`bbox`/`days`); the handler builds the real FIRMS
  URL server-side, reading `FIRMS_MAP_KEY` from `process.env` (a Vercel
  Edge Function env var, configured per-environment in the Vercel
  dashboard; locally via a git-ignored `.env.local` — see `*.local` in
  `.gitignore`). `vite.config.ts`'s dev-mode equivalent needs the
  functional `defineConfig(({mode}) => ...)` form plus `loadEnv(mode,
  process.cwd(), "")` to read the var inside the config file itself — Vite's
  automatic `.env`→`import.meta.env` exposure only reaches client code, and
  the var deliberately has no `VITE_` prefix (a `VITE_`-prefixed var *would*
  get inlined into the shipped client bundle, leaking the key).
- Response stays raw CSV — hand-rolled parsing (`parseCsv` in `firms.ts`;
  no dependency, FIRMS's schema has no embedded delimiters in any field used
  here) happens client-side, same "dumb proxy, parsing in the browser"
  precedent as the WFS/`shpjs` flow above.
- Recency can't be computed by a MapLibre expression (no relative-to-now
  date math), so `recencyTierFor()` stamps a `recencyTier` property onto
  each feature right after parsing, reusing `legend-config.json`'s own
  `activeFires.colors[].labelKey` strings as the tier values — one string is
  both "the tier" and "the legend-row lookup key," so editing
  `legend-config.json`'s tiers/colors updates the real `circle-color`
  paint expression (`recencyColorExpression()` in `main.ts`) and the
  legend swatches together, with no separate mapping table. Rendered
  shape-by-sensor to match the legend (MODIS -> triangle, VIIRS -> circle):
  `addFirmsActiveFiresLayer()` in `main.ts` splits FIRMS features into two
  layers on each feature's `source` property (`"MODIS_NRT"` vs the three
  VIIRS sources) — a `circle` layer for VIIRS, and a `symbol` layer for
  MODIS using a small triangle registered via `map.addImage(..., { sdf:
  true })` (`ensureFirmsModisIcon()`) so `icon-color` can recolor it by
  recency tier the same way `circle-color` does for VIIRS. Both shapes use
  zoom-interpolated sizing from `FIRMS_POINT_RADIUS_STOPS`: compact at
  continent scale and progressively larger when zoomed in. A heatmap layer
  (`active-fires-firms-glow`) sits beneath both crisp marker layers and uses
  accumulated `heatmap-density` to progress from transparent orange through
  amber to a pale-yellow hot core, so overlapping detections shine brighter
  and carry more visual weight without losing the sensor-specific shapes.
  All three layers are
  re-added on every basemap switch alongside the source itself (see below),
  since `setStyle()` drops registered images too. The "VIIRS / SENTINEL3"
  legend label that's accurate for EFFIS's own three-sensor coverage is
  wrong for FIRMS specifically (no Sentinel-3 data here — see the
  coverage-gap note above), so
  `legend-config.json`'s `activeFires.shapes[].firmsLabel` gives the VIIRS
  row a FIRMS-only override ("VIIRS") that `renderActiveFiresFallback()` in
  `main.ts` picks when `activeFiresProvider === "firms"`.
- Query covers all of Europe (`EUROPE_BBOX` in `firms.ts`, matching the
  bbox FIRMS's own `kml_fire_footprints` endpoint uses for its predefined
  "europe" region), not just `map.ts`'s Spain-scoped `DEFAULT_BOUNDS` — a
  Spain-only fallback would silently show nothing for fires elsewhere in
  Europe during an outage, undermining the point of having one.
- Refreshes every 15 minutes while engaged (`FIRMS_REFRESH_INTERVAL_MS`),
  and once after every basemap switch alongside the existing `loadFires()`
  call — `setStyle()` drops every custom source/layer including FIRMS's, so
  the freshly re-added source starts empty and needs repopulating, exactly
  like the WFS `fires` source already does.
- UI signal that FIRMS is currently showing: a small muted note under the
  "Active Fires" legend heading (`#legend-active-fires-provider`, hidden
  unless engaged) — deliberately not a second warning banner, since
  `#effis-warning` already covers "something's wrong" and a second alert
  for "and we've compensated" would be redundant noise for the system
  working as designed. Real attribution lives in the About modal's
  `about_content_html` (see the "no AttributionControl" note below), not
  the GeoJSON source's inert `attribution` property.

**The cold-start check is the only automatic trigger, and it fires exactly
once, because the failure counter has a real blind spot: it needs an actual
`error` event to count anything, and a request that just hangs forever —
never resolving, never erroring — produces none.** In dev specifically,
`/api/wmts` is a raw Vite proxy passthrough with no `AbortSignal.timeout`
(unlike production's `api/wmts.ts`, which has one at 15s), so a genuinely
unresponsive EFFIS backend can hang indefinitely there with zero error
events ever firing — confirmed live during testing, not just a theoretical
gap. `watchWmtsActivity()` in `main.ts` makes one representative tile probe
for each of the five current-fire WMTS products and accepts only an HTTP
successful response; a MapLibre source lifecycle event or HTTP 503/504 does
not satisfy it. The first successful probe cancels the others. A one-shot
5s timer (`INITIAL_LOAD_TIMEOUT_MS`) engages the FIRMS fallback if no probe
has succeeded by then and the provider is still EFFIS. Engaging FIRMS removes
all EFFIS WMTS layers and sources, rather than merely hiding them, so
MapLibre cannot retain or retry WMTS tile work in the background. This means
burnt-area and historical WMTS rasters are unavailable in FIRMS mode (FIRMS
has no equivalent); manually selecting EFFIS recreates the complete WMTS
stack. Basemap changes also skip recreating that stack while FIRMS remains
selected. During the automatic handoff, `#provider-fallback-status` shows a
localized, non-blocking popup explaining that EFFIS is down and NASA FIRMS
is being queried; it is hidden in a `finally` block when that request
settles. That popup has its own inline spinner, so `setMapLoading()` suppresses
the larger centered fire-data spinner while the popup is visible to prevent
the two indicators overlapping. This timer only ever runs
once, at page load, and there is no automatic path back to EFFIS — an
earlier version tried to auto-revert once `watchEffisHealth` next reported
`activeFires` as not-`"down"`, but that reverted the cold-start-triggered
switch within moments of it happening (confirmed live): a cold-start switch
has zero recorded failures by definition — nothing ever errored — so the
very next health recheck reads `activeFires: "ok"` simply because nothing
was ever proven broken, not because EFFIS recovered. Rather than add more
machinery to distinguish "actually recovered" from "never proven broken,"
the automatic-disengage path was removed entirely: after the one-time
cold-start decision, "Active fires" only changes source via the manual
toggle described next.

**The manual override** (`#active-fires-source` in `index.html`, styled via
`.segmented-sm` — a smaller variant of the existing `.segmented` control
used for the Current/Past fires toggle) is a plain 2-way EFFIS/FIRMS choice
— there is no "Auto" option. `activeFiresProvider` (`"effis" | "firms"`) is
the single source of truth for which data is showing; the cold-start check
above can set it once automatically, and either toggle button
(`activeFiresSourceEffisBtn`/`activeFiresSourceFirmsBtn`) can set it
manually at any time thereafter, but nothing ever overrides a manual choice
— there's no ongoing automatic logic left to conflict with it. Disabled
(`updateActiveFiresSourceControlState()`, called from `applyModeVisibility`)
whenever "Active fires" itself is off or the app is in "Past fires" mode,
since the choice is meaningless in either case.

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

**The centered loading spinner represents fire data only, never background
map work.** `main.ts` filters MapLibre `dataloading`/`sourcedata`/`error`
events to the EFFIS WMTS source IDs, while the WFS historical-fire and FIRMS
fetch functions explicitly increment/decrement `fireFetchesInFlight`.
Basemap styles, place-label tiles, borders, geocoding, and other requests do
not activate it; the HTML no longer seeds the indicator with `active`
either, so the initial basemap load is silent. `loadingWmtsSources` tracks
the fire raster sources still loading, and a 150ms hide debounce prevents
flashing between adjacent fire tiles.

The 15s `MAX_LOADING_INDICATOR_MS` safety ceiling remains necessary because
an EFFIS raster source can enter a sustained error/retry loop without a
clean completion event. The timer is armed only on the first event in a
loading streak; retries cannot push the ceiling back indefinitely. This is
the same "don't trust EFFIS's lifecycle to behave, always have a timeout"
principle used by the EFFIS request paths.

## Key files

- `src/map.ts` — MapLibre init, OpenFreeMap basemap reduced to white +
  black-labels-only, globe projection, default bounds, GISCO country
  borders, the burnt-areas/active-fires WMTS raster layers
  (`addWmtsRasterLayer`, `tileSize: 1024` to match EFFIS's tile matrix),
  and the past-fires WMTS raster layer (`addPastFiresLayer`,
  `setPastFiresYear`).
- `src/effis.ts` — EFFIS fetch/parse/filter logic, the `WMTS_LAYERS`
  config + `tileTemplate()` (current fires) and `pastFiresTileTemplate()`
  (past fires, 2016+), the WFS pipeline (`fetchHistoricalFires`), and
  property accessors.
- `src/borders.ts` — fetches + converts the GISCO country-borders topojson.
- `src/effisHealth.ts` — `watchEffisHealth()`, the "EFFIS is slow/down"
  detector described above (tile-failure + slow-proxy-response signals),
  reported both as one `overall` value and per-group
  (`activeFires`/`burntAreas`/`pastFires`). Has no UI of its own; `main.ts`
  renders its output.
- `src/firms.ts` — the NASA FIRMS fallback for "Active fires": CSV fetch +
  parsing, GeoJSON conversion, recency-tier bucketing. No map/UI code of
  its own, same split as `effis.ts`.
- `src/main.ts` — wires the map, the current/past mode toggle, the
  active-fires/burnt-areas checkboxes, year `<select>`, click-to-popup
  behavior, the EFFIS health warning banner (`handleEffisHealthChange`),
  and the NASA FIRMS fallback orchestration (`engageFirmsFallback`/
  `disengageFirmsFallback`/`refreshFirmsData`, the `watchWmtsActivity`
  cold-start check, and the manual EFFIS/FIRMS toggle) together.
- `index.html` / `src/style.css` — toolbar markup/styling. **No
  `AttributionControl`** — `map.ts` constructs the `Map` with
  `attributionControl: false`, so despite each source's `attribution`
  property still being set (EFFIS's, GISCO's, FIRMS's), none of it is
  actually visible anywhere in the UI; that property is inert today, kept
  set only in case `attributionControl` is ever re-enabled. The real,
  user-visible attribution mechanism is the About modal's
  `about_content_html` i18n string, which lists EFFIS/NASA
  FIRMS/OpenFreeMap/GISCO/Esri credits by hand. `#status` is deliberately
  single-line (`white-space: nowrap` + `text-overflow: ellipsis`) so a long
  fetch-result/error message can't wrap and inflate the toolbar's height,
  especially on narrow viewports; `#toolbar` uses `flex-wrap: wrap` so its
  growing control count still degrades gracefully on mobile instead of
  overflowing horizontally. `#map-loading-indicator` is centered on `#map`
  itself (a direct child, not nested in `.search-container` — it used to be,
  tucked into a toolbar corner, easy to miss) — `top/left: 50%` plus
  `transform: translate(-50%, -50%) rotate(...)`, where the base rule's
  `rotate(0deg)` isn't decorative: it keeps the transform's function-list
  shape identical to the `@keyframes` rule's `translate(...) rotate(360deg)`,
  so the animation interpolates the rotation smoothly instead of the
  centering offset itself jumping every cycle. The two legend `<img>` tags
  (`#legend-img-active-fires`/`#legend-img-burnt-areas`) deliberately have
  **no `src` attribute in the HTML** — a static `src` is fetched by the
  browser the instant it's parsed, regardless of any JS/config check
  afterward, so it would hit EFFIS's `GetLegendGraphic` endpoint
  unconditionally even though `config.json`'s `"legendType": "custom"` means
  the image is never actually shown; `main.ts`'s `updateLegend()` only
  assigns `.src` inside the `!useCustomLegend` branch. Confirmed this wasn't
  just wasteful but actively harmful: two permanently-pending requests to a
  hanging EFFIS endpoint were enough on their own to reproduce the
  `'idle'`-never-fires spinner bug above, plausibly by exhausting the
  browser's small per-origin connection pool (everything in this app is
  same-origin by design, see the proxy note below) — removing them didn't
  fully fix that bug alone, but it's a real contributing factor worth
  knowing about independent of the safety-timeout fix.
- `api/firms.ts` — the NASA FIRMS proxy, alongside `api/effis.ts`/
  `api/wmts.ts` but structurally different from both (see the "NASA FIRMS
  fallback" section above for why) — not a passthrough, since FIRMS's
  `MAP_KEY` is a URL path segment that must be injected server-side, never
  client-visible.
- `api/effis.ts` + `api/wmts.ts` (Vercel Edge Functions) + `vite.config.ts`
  (`server.proxy`, three entries now including `/api/firms`) — the WFS and
  WMTS proxy implementations; each dev/prod pair must stay behaviorally
  equivalent. `vite.config.ts` switched to the functional
  `defineConfig(({mode}) => ...)` form + `loadEnv()` specifically to give
  the `/api/firms` entry access to `FIRMS_MAP_KEY` — the two older entries
  don't need any env var, so this only mattered once FIRMS was added.
- `scripts/copy-maplibre-worker.mjs` + `public/` — see the Web Worker
  gotcha above.

## Known unknowns

EFFIS's backend is generally under real strain (plausibly load from peak
Mediterranean fire season) — even WMTS, now confirmed dramatically more
reliable than WMS ever was for current fires, is not 100% solid (a handful
of tiles 500'd during live testing on 2026-07-25 even while most of the
same layer's tiles succeeded). Expect occasional gaps in tile coverage
rather than a hard error, since a single failed raster tile just doesn't
render on its own (no per-tile error UI, matching how the basemap's own
raster layers already behave — see "EFFIS health warning" above for the
*aggregate*-level warning that does now exist). If current fires look
sparse without the health banner showing, that may just be an accurate
reflection of the fire situation rather than a loading failure — there's
still no way from the client side to distinguish "no fires at this one
tile" from "this one tile failed to load" (the health banner is deliberately
threshold-based, not per-tile, precisely because a single failure like this
is routine and not worth surfacing on its own).

This same real-world strain is what both validated and complicated testing
the EFFIS health warning above: EFFIS's `/effis` (WFS/legend) mount was
genuinely returning `503 Service Temporarily Unavailable` from its own AWS
load balancer while this was being built (2026-07-26), confirmed via a
direct `curl` (fast, ~0.2s, real ELB response — not a hang), while
`/effist/wmts` — a *different* upstream mount, see the WFS/WMS/WMTS note
above — stayed up but slow (~15-25s for a single tile through the dev
proxy). That inconsistency between the two mounts is exactly why the health
watcher treats them as two independent signals (tile failures vs. slow
responses) rather than one.

**WMTS's per-year `modis.ba.<year>` layers are confirmed working for "Past
fires" (2016+)** — see "Past fires: WFS *and* WMTS, on purpose" above for
the full story. This resolves what used to be an open question right here
about whether EFFIS's WMTS honors arbitrary `time=` ranges: it turned out
the year-layers don't use `time=` at all (the year's baked into the layer
name, e.g. `modis.ba.2023`), so that specific question — does `time=`
really filter, or does the server ignore it and always serve latest — is
still unresolved for the `.week` layers specifically, just no longer
relevant to how past fires got fixed.

`GetFeatureInfo` doesn't work against WMTS either — tried against both a
`.week` layer and a `modis.ba.<year>` layer, both returned the identical
"LayerNotDefined" WMS-style error the old current-fires WMS attempt got.
So there's now confirmation across three attempts (WMS GetFeatureInfo,
WMTS GetFeatureInfo on a `.week` layer, WMTS GetFeatureInfo on a year
layer) that this backend has no working per-feature query path at all,
raster or otherwise — not just an unlucky parameter combination. If EFFIS
ever adds one, it'd remove the whole reason WFS is still kept wired up
for "Past fires" (see above).

EFFIS's WFS field names/casing (used for "Past fires") were taken from
EFFIS's own published documentation, not guessed, but have never been
confirmed against a live successful response — every WFS request made
during development hung or errored, including EFFIS's own documented
zero-parameter example, and a fresh unfiltered-fallback request tested
2026-07-25 still hung for the full 25s with no response. If you're
debugging a "Past fires" data issue, check the network tab for the actual
`feature.properties` shape before assuming the code is wrong — assuming
WFS ever actually returns something to check in the first place.

**Requests through either production proxy have been observed hanging even
when EFFIS itself is fine.** Diagnosing a spell of all-layers-503/504 in
production (2026-07-25, before the WMS→WMTS migration above): the exact
same request that hung through `api/effis.ts` until Vercel killed the
function (~25s, `FUNCTION_INVOCATION_TIMEOUT`) succeeded in 2-6s when sent
directly to `maps.effis.emergency.copernicus.eu`, repeatably, for both a
normally-working layer and a bare `GetCapabilities` call. So this failure
mode is distinct from EFFIS's general backend strain described above — it's
specific to requests routed through the Vercel Edge Function's network
path, not EFFIS being slow or down for everyone. The likely cause is
EFFIS's AWS-fronted WAF/rate-limiter reacting to Vercel's shared edge
egress IPs (plausibly tripped by the burst of parallel tile requests a
single pan/zoom generates, all from the same source IP), rather than a
permanent block, since the WAF is already known to react defensively to
other traffic shapes (see the `cql_filter` note above). There's no reason
to expect `/api/wmts` is immune from this same class of problem just
because it hits a different upstream mount — both `api/effis.ts` and
`api/wmts.ts` apply their own `AbortSignal.timeout` (15s) to their
upstream fetch for exactly this reason, so a hang fails fast with a clean
504 instead of silently eating Vercel's full function timeout. That makes
failures faster and cleaner, not less frequent. If current fires are down
in production but a direct `curl` to EFFIS's WMTS endpoint succeeds, this
is almost certainly what's happening; there's no client-side fix for it,
since it's about which network the request originates from.

**FIRMS's exact `day_range` maximum for the `area/csv` endpoint is
unconfirmed** — different NASA docs showed 1–5 in some places and 1–10 in
others during research (see `docs/firms-migration-plan.md`). `firms.ts`'s
`DEFAULT_DAY_RANGE` stays at 3, safely under either, so this doesn't block
anything today; worth confirming live before raising it toward 7 to better
match the "last 7 days" legend tier.

**The NASA FIRMS fallback covers 2 of EFFIS's 3 active-fire sources'
sensors, not all 3.** FIRMS has no Sentinel-3 equivalent at all (EFFIS's
`active-fires-s3` / `s3.hs.week`) — a fire visible only to Sentinel-3 won't
appear on the map during a fallback. Accepted and documented, not a bug;
see the "NASA FIRMS fallback for Active fires" section above.
