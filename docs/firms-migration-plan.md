# Plan: replace "Active fires" with NASA FIRMS, direct

**Status: implemented (2026-07-26).** Built as an automatic fallback rather
than a full replacement: EFFIS stays the default provider for "Active
fires," and NASA FIRMS engages only when EFFIS's active-fires pipeline
specifically is detected as down (via `watchEffisHealth`'s per-group
health report — see CLAUDE.md's "NASA FIRMS fallback for Active fires"
section for the full implementation writeup: `api/firms.ts`, `src/firms.ts`,
the `effis-health.ts` per-group refactor, and the orchestration in
`main.ts`). This doc's research and Option A recommendation below are what
that was built from; kept as-is for the reasoning trail rather than folded
into CLAUDE.md, which now has the implementation-level detail.

## Motivation

EFFIS's "Active fires" WMTS layers are both unreliable (see CLAUDE.md's
"Known unknowns" — occasional tile 500s, a whole WMS→WMTS migration saga,
proxy-hang issues distinct from EFFIS itself) and give us zero control over
rendering: they're opaque raster tiles styled server-side by EFFIS, not
data we can restyle, filter, or make clickable. The question: can we cut
EFFIS out as a middleman for this one layer and pull hotspot data straight
from NASA?

## Confirmed: EFFIS's active-fire detection *is* NASA FIRMS

EFFIS's own technical-background page states it directly: *"EFFIS uses the
active fire detection provided by the NASA FIRMS."* Sensors are MODIS
(Terra/Aqua, 1km resolution) and VIIRS (Suomi NPP + NOAA-20/21, 375m) — no
Sentinel-3 involved for hotspots, despite what EFFIS's own current-fires
URL bar implies (`viirs.all.week`; see CLAUDE.md on that specific
naming mismatch). So going direct to FIRMS is a legitimate simplification,
not a data-quality downgrade — same underlying detections, one hop closer
to the source, with the round-trip through EFFIS's own flaky WMTS mount
removed entirely.

## What FIRMS does *not* give us: no cumulative burnt-area product

This was wrong in an earlier draft of this research and is worth stating
precisely, since it's easy to get half-right: FIRMS **does** have polygon
geometry (see below), but it is not a burnt-area/burn-scar product. Every
polygon FIRMS returns is the ~1km (MODIS) or ~375m (VIIRS) sensor-pixel
footprint of one individual hotspot *detection* — confirmed by pulling and
unzipping a real sample (`kml_fire_footprints/europe/24h/c6.1`, MODIS,
2026-07-26): 510 detections became 1020 KML placemarks, a `<Point>` (pixel
centroid) plus a matching `<Polygon>` (pixel footprint) for each one. The
KML's own embedded description says so outright: *"Each 1km MODIS fire
detection is depicted as a point representing the centroid of the approx.
1km pixel where the fire is detected. The 1km footprint of the MODIS pixel
for each detection is also displayed."*

That's a real, useful upgrade for rendering "Active fires" (a
sensor-accurate shape instead of a dot) — but it says nothing about
*cumulative burned extent* over days or weeks, which is what EFFIS's
`modis.ba.week` / `nrt.ba.week` "Burnt areas" layer actually shows. NASA's
real burned-area product is MCD64A1, a completely different and much
heavier pipeline (LP DAAC / AppEEARS, monthly cadence, 500m raster
HDF/GeoTIFF, separate Earthdata login) — not a simple API swap, and out of
scope for this plan.

**Bottom line on scope: this migration can only replace the "Active fires"
toggle. "Burnt areas" stays on EFFIS's existing WMTS pipeline, unchanged,
regardless of which option below is chosen.**

## Two FIRMS endpoints, two very different integration stories

### 1. `api/area/csv` — authenticated, precise, point data only

```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{day_range}[/{YYYY-MM-DD}]
```

- **Auth**: free `MAP_KEY` registration required. Rate limit: **5,000
  transactions per 10-minute window** (resets automatically) — generous
  for this app's traffic.
- **`SOURCE`**: `MODIS_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`,
  `VIIRS_NOAA21_NRT` (also `LANDSAT_NRT`, US/Canada only — irrelevant here).
- **Area**: arbitrary bounding box (`west,south,east,north`), so it can be
  scoped tightly (e.g. to match `DEFAULT_BOUNDS` in `map.ts`) rather than
  pulling all of Europe.
- **`day_range`**: NASA's own docs disagree with each other on the max (saw
  both "1–5" and "1–10" across different pages) — confirm at
  implementation time. Doesn't block anything either way, since polling
  every couple of hours (as originally proposed) stays well inside both.
- **Fields**: lat/lon, brightness, FRP (fire radiative power, MW),
  `acq_date`/`acq_time`, satellite, instrument, and **confidence** —
  numeric 0–100 for MODIS, `low`/`nominal`/`high` for VIIRS.
- **No CORS headers** (confirmed via `curl -D -`) and the key must stay
  secret — **a server-side proxy is mandatory** for this endpoint, no way
  around it.

### 2. `api/kml_fire_footprints` — public, pre-styled, region-only

```
https://firms.modaps.eosdis.nasa.gov/api/kml_fire_footprints/{region}/{date_span}/{sensor}
```

- **Auth: none.** Confirmed live — a plain unauthenticated `curl` returned
  `200 OK` with a real `.kmz` file, no `MAP_KEY` anywhere in the request.
- **CORS: open.** Response header `Access-Control-Allow-Origin: *`,
  confirmed via `curl -D -`. This is the one FIRMS endpoint that could
  plausibly be called **straight from the browser**, no proxy needed at
  all — a materially different (and simpler) integration story than the
  CSV endpoint.
- **`region`**: one of 12 fixed continent-scale regions — `canada`,
  `alaska`, `usa_contiguous_and_hawaii`, `central_america`,
  `south_america`, `europe`, `northern_and_central_africa`,
  `southern_africa`, `russia_asia`, `south_asia`, `southeast_asia`,
  `australia_newzealand`. No arbitrary bounding box — `europe` is the only
  option that fits us, and it's continent-wide (confirmed bbox from a real
  response: north 82°, south 34°, east 35°, west -26° — all of Europe plus
  a chunk of the Middle East/Central Asia, notably *more* area than this
  app's current default Spain-only view).
- **`date_span`**: `24h`, `48h`, `72h`, or `7d`.
- **`sensor`**: `c6.1` (MODIS collection 6.1), `landsat`,
  `suomi-npp-viirs-c2`, `noaa-20-viirs-c2`, `noaa-21-viirs-c2`.
- **Format: KMZ only** (a zipped KML). Contains, per detection: a `<Point>`
  styled by an icon matching a recency tier (`fire_0`/`fire_6`/`fire_12`/
  `fire_24` = 0–6h / 6–12h / 12–24h / 24–100h) *and* a `<Polygon>` for that
  detection's pixel footprint, styled to match
  (`fire_area_0`/`fire_area_6`/etc, translucent fill + outline, colour keyed
  to the same age tiers). **These recency tiers line up almost exactly
  with the color scheme already defined in `src/legend-config.json`**
  (`legend_up_to_6_hours` / `legend_6_to_12_hours` / `legend_12_to_24_hours`
  / `legend_last_7_days`) — today only used for a *fallback* legend
  graphic when EFFIS's own `GetLegendGraphic` image fails to load. Real
  FIRMS data would let that scheme drive actual rendering instead.
- Real sample size: MODIS + `europe` + `24h` alone was **~1.07MB
  uncompressed** (1020 placemarks). Four sensors × a longer `date_span`
  (e.g. `7d`, to match the existing "last 7 days" legend tier) would be
  meaningfully larger — worth measuring all four sensors × the date spans
  we'd actually want before committing to fetching this client-side on
  every page load; parsing KML also isn't free (needs a KML→GeoJSON step,
  e.g. `@tmcw/togeojson`, client- or server-side — this codebase already
  has precedent for "fetch a non-GeoJSON format and convert it" in
  `borders.ts`'s topojson handling).

## Attribution

Required regardless of which endpoint: *"NASA FIRMS"* credit plus a link —
same shape as the EFFIS attribution already wired up via each source's
`attribution` property in `map.ts`.

## Architecture options

**A — thin proxy + HTTP edge caching (recommended starting point).**
For the CSV endpoint: a new `api/firms.ts` Edge Function, structurally
identical to `api/effis.ts`/`api/wmts.ts` — calls FIRMS server-side with
`MAP_KEY` from an env var, converts CSV→GeoJSON, returns it with
`Cache-Control: public, max-age=1800` so Vercel's CDN serves the cached
response to every visitor for ~30 min. For the footprints endpoint, given
the open CORS and no-auth, a proxy may not even be necessary — a direct
client-side fetch (with the browser's own HTTP cache, or a light
`Cache-Control`-respecting wrapper) could work, though some server-side
step is still probably worth it just to convert KML→GeoJSON once instead
of re-parsing a multi-hundred-KB file in every visitor's browser. Either
way: **no database, no cron job**, consistent with this app's current
"there is no backend/database" design principle (CLAUDE.md's first
architecture line).

**B — scheduled ingestion into Supabase/Postgres.** A cron job fetches
FIRMS every 1–3h and upserts into a table; the frontend queries that
instead of FIRMS at all. Buys real resilience (serves last-known-good if
FIRMS has an outage — directly answers the "unreliable" half of the
original complaint) and a foundation for history/trend features later.
Costs a real architecture change: introduces this app's first database, a
scheduler, a schema, and new credentials to provision and keep alive.

**Recommendation unchanged from initial research: start with A.** It fixes
both the reliability and the visualization complaints with a small change
that reuses patterns already in this codebase, without front-loading new
standing infrastructure before validating that real vector rendering
(points + pixel-footprint polygons, styled per `legend-config.json`)
actually looks and feels better in practice. B remains a reasonable
upgrade later if real traffic/usage justifies it.

**Decided: Option A (2026-07-26).** The rate-limit numbers came up during
the decision and are worth recording precisely, since the reasoning
generalizes beyond just this choice:

- FIRMS's 5,000-transactions/10-min `MAP_KEY` limit only matters if every
  visitor request round-trips to FIRMS directly, uncached. Vercel's own
  "edge requests" metric (raised as a concern: ~6k/5min) is *not* a proxy
  for that — it counts every asset (JS/CSS bundles, images, and every
  individual raster tile fetch through the existing `/api/wmts`, which a
  single pan/zoom multiplies across 5 stacked sources) — not hits on any
  one fire-data endpoint specifically. A cached proxy (`Cache-Control:
  public, max-age=1800` or similar) means FIRMS sees roughly one request
  per cache-refresh window, completely decoupled from visitor volume,
  whether that's 10 or 10,000 requests/min on the site itself.
- Checked whether Supabase would sidestep this differently: it has no
  FIRMS-style fixed "N requests per M minutes" cap on the data-serving
  PostgREST API (the 120 req/min figure that turns up in search results is
  for Supabase's *Management* API — project administration — not data
  reads). Instead it's bounded by free-tier **egress bandwidth (5GB/month)**
  and connection/compute limits. That's arguably a *tighter* constraint if
  queried uncached — a few hundred KB of hotspot GeoJSON × thousands of
  direct requests exhausts 5GB in minutes, not months.
- Conclusion: a caching layer in front is mandatory regardless of which
  backend sits behind it, and once it's there, both options are equally
  insulated from traffic volume. So the choice between A and B should rest
  entirely on the reasons that don't have a caching workaround — FIRMS
  outage resilience and future history/trend features (arguments for B) vs.
  minimal new infrastructure (the case for A) — not on rate limits either
  way.

## Open questions / next steps

- Confirm the actual `day_range` max for `api/area/csv` (docs disagreed:
  1–5 vs 1–10) if that endpoint ends up used.
- Measure real payload size across all 4 sensors × the date spans we'd
  want from `kml_fire_footprints` before deciding client-side-fetch vs.
  server-converted.
- Decide whether `region=europe` (fixed, continent-wide) from the
  footprints endpoint is an acceptable scope, or whether the flexibility
  of a custom bounding box (only available via the authenticated CSV
  endpoint) is worth the extra proxy complexity.
- Prototype KML→GeoJSON conversion (`@tmcw/togeojson` or similar) against a
  real footprints response before committing to either data path.
- "Burnt areas" stays out of scope for this plan entirely — no FIRMS
  equivalent exists; would need a separate, heavier investigation into
  MCD64A1 or another burned-area source if that's ever revisited.
- **Blocker before implementation can start on the `area/csv` path**: a
  `MAP_KEY` has to be registered by hand at
  https://firms.modaps.eosdis.nasa.gov/api/map_key/ (personal NASA
  Earthdata registration — not something that can be done on the project's
  behalf) and set as an env var (Vercel project settings + local `.env` for
  dev, same shape as this app has no precedent for yet since neither
  existing proxy needs a secret key). Not a blocker for the
  `kml_fire_footprints` path, which needs no key at all.
