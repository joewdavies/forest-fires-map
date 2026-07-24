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

**Data flow**: `src/effis.ts` fetches burnt-area polygons from EFFIS
(European Forest Fire Information System) and hands GeoJSON to `src/main.ts`,
which puts it on a single MapLibre `geojson` source (`fires`) rendered as a
fill + outline layer. There is no backend/database — everything is
client-fetched on demand.

**One EFFIS layer serves both modes.** EFFIS's `ms:modis.ba.poly` WFS layer
is a single, continuously-updated burnt-area database covering the current
fire season *and* the full historical archive back to 2000. "Current fires"
vs. "Past fires" is purely a date filter over the same layer — there's no
separate "active fires" API. See `fetchCurrentFires()` (last 30 days) and
`fetchHistoricalFires(year)` in `src/effis.ts`.

**Why the app never fetches EFFIS directly.** The frontend only ever calls
the relative path `/api/effis`. In dev, `vite.config.ts` proxies that to
`https://maps.effis.emergency.copernicus.eu/effis`. In production, `api/effis.ts`
is a Vercel Edge Function that forwards the request server-side — its path
(`api/effis.ts`) maps directly to the `/api/effis` route Vercel serves, no
rewrite rule needed. This exists because EFFIS's CORS support isn't
guaranteed — going through a same-origin proxy sidesteps the question
entirely rather than depending on it. Both proxy implementations must stay
in sync if the upstream URL or query shape changes.

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

## Key files

- `src/map.ts` — MapLibre init, OpenFreeMap basemap, Europe bounds.
- `src/effis.ts` — EFFIS fetch/parse/filter logic and property accessors.
- `src/main.ts` — wires the map, the current/past toggle, year `<select>`,
  and click-to-popup behavior together.
- `api/effis.ts` (Vercel Edge Function) + `vite.config.ts` (`server.proxy`)
  — the two proxy implementations that must stay behaviorally equivalent.

## Known unknowns

Live verification against EFFIS's real API was inconclusive during initial
development — its backend was intermittently returning 500/502/503/403 or
hanging outright across many independent tests (plausibly load-related,
since this was tested during peak Mediterranean fire season). The WFS
endpoint, layer name (`ms:modis.ba.poly`), and output format (`SHAPEZIP`)
are taken from EFFIS's own published documentation, not guessed — but exact
attribute field names/casing have not been confirmed against a live
successful response. If you're debugging a data issue, check the network
tab for the actual `feature.properties` shape before assuming the code is
wrong.
