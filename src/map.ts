import {
  AttributionControl,
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ErrorEvent,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type RasterTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchCountryBorders } from "./borders";
import { pastFiresTileTemplate, tileTemplate, type WmtsLayerKind } from "./effis";

// maplibre-gl v6 builds its tile-parsing Web Worker URL dynamically at
// runtime, which Vite can't statically analyze to bundle as an asset (the
// worker 404s otherwise, in both dev and production builds — the map then
// never fires 'load' since no vector tile can be parsed). Point it at our
// own static copy instead; see the `copy-maplibre-worker` npm script, which
// keeps public/maplibre-gl-worker.mjs in sync with the installed version.
setWorkerUrl("/maplibre-gl-worker.mjs");

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const BORDERS_SOURCE_ID = "country-borders";
const BORDERS_LAYER_ID = "country-borders-line";
const EFFIS_ATTRIBUTION =
  '<a href="https://forest-fire.emergency.copernicus.eu/" target="_blank" rel="noopener">EFFIS / Copernicus Emergency Management Service</a>';

export const BURNT_AREAS_LAYER_IDS = [
  "burnt-areas-modis",
  "burnt-areas-nrt",
] as const;
export const ACTIVE_FIRES_LAYER_IDS = [
  "active-fires-modis",
  "active-fires-viirs",
  "active-fires-s3",
] as const;
export const PAST_FIRES_LAYER_ID = "past-fires-raster";

// Default map view — mainland Spain plus the Balearic Islands.
const DEFAULT_BOUNDS: LngLatBoundsLike = [
  [-9.5, 35.8],
  [4.5, 43.8],
];

type Style = ReturnType<Map["getStyle"]>;

export async function createMap(container: HTMLElement): Promise<Map> {
  const map = new Map({
    container,
    style: await loadStrippedStyle(),
    bounds: DEFAULT_BOUNDS,
    fitBoundsOptions: { padding: 20 },
    // The default auto-added attribution control is always expanded
    // regardless of map width; disable it and add our own compact one
    // instead (collapsed to a small "i" icon, expanding on click/hover).
    attributionControl: false,
  });

  map.on("load", () => {
    addCountryBorders(map);
    addBurntAreasLayers(map);
    addActiveFiresLayers(map);
    addPastFiresLayer(map);
  });

  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new ScaleControl(), "bottom-left");
  map.addControl(new AttributionControl({ compact: true }));
  collapseAttributionControl(container);

  return map;
}

/**
 * `compact: true` doesn't actually start collapsed — MapLibre's own
 * AttributionControl deliberately shows itself expanded once on the very
 * first render (so users see the attribution at least once), then only
 * auto-collapses the first time the user drags the map. There's no public
 * option to skip that initial reveal. Worse, it re-opens itself *again*
 * every time the computed attribution text changes — which happens once
 * per attributed source we add (GISCO, EFFIS), all added later inside the
 * `load` handler above — so a single one-off cleanup right after
 * `addControl` gets silently undone once those sources register.
 *
 * This reaches into the control's DOM output directly (it's a native
 * `<details>` element) and force-collapses it — clearing the `open`
 * attribute and the `maplibregl-compact-show` class MapLibre's own CSS
 * keys off of — then keeps re-collapsing it via MutationObserver every
 * time MapLibre flips `open` back on its own, until the user actually
 * clicks the control themselves, at which point the observer steps aside
 * and lets normal click-to-expand behaviour take over.
 */
function collapseAttributionControl(container: HTMLElement): void {
  const attribution = container.querySelector<HTMLElement>(
    ".maplibregl-ctrl-attrib",
  );
  if (!attribution) return;

  const collapse = () => {
    attribution.removeAttribute("open");
    attribution.classList.remove("maplibregl-compact-show");
  };
  collapse();

  const observer = new MutationObserver(collapse);
  observer.observe(attribution, {
    attributes: true,
    attributeFilter: ["open"],
  });
  attribution
    .querySelector(".maplibregl-ctrl-attrib-button")
    ?.addEventListener("click", () => observer.disconnect(), { once: true });
}

/**
 * Fetches OpenFreeMap's Liberty style and reduces it to a white background
 * plus black place-name labels — with globe projection baked in — before
 * the Map is ever constructed, so the first frame already looks right.
 * Doing this at runtime instead (setPaintProperty/setLayoutProperty/
 * setProjection inside a `load` handler, as this used to work) requires the
 * style to render at least once first, which flashes the original
 * full-colour Mercator Liberty style before snapping to white/globe.
 *
 * Falls back to the plain style URL (letting MapLibre fetch it itself, with
 * that flash reintroduced) if this fetch fails — better than the map not
 * loading at all over a transient network hiccup.
 */
async function loadStrippedStyle(): Promise<Style | string> {
  let raw: Style;
  try {
    raw = await fetchLibertyStyle();
  } catch (err) {
    console.warn(
      "Failed to pre-fetch basemap style, falling back to default load path:",
      err,
    );
    return OPENFREEMAP_STYLE;
  }

  raw.projection = { type: "globe" };
  stripToPlaceLabelsOnly(raw);
  return raw;
}

// Cached so switching the basemap back to "plain" (see setBasemap below)
// doesn't re-fetch the ~1MB style JSON from OpenFreeMap every time — only
// the very first load (or first switch to "plain") pays the network cost.
// Callers get a fresh clone each time since stripToPlaceLabelsOnly mutates
// its argument in place and the cached copy must stay pristine.
let cachedLibertyStyle: Style | null = null;

async function fetchLibertyStyle(): Promise<Style> {
  cachedLibertyStyle ??= (await (await fetch(OPENFREEMAP_STYLE)).json()) as Style;
  return structuredClone(cachedLibertyStyle);
}

export type BasemapKind = "plain" | "positron" | "bright" | "liberty" | "dark" | "fiord" | "3d";

async function styleForBasemap(kind: BasemapKind): Promise<Style | string> {
  if (kind === "plain") {
    return loadStrippedStyle();
  }
  return `https://tiles.openfreemap.org/styles/${kind}`;
}

/**
 * Swaps the base map style, then re-adds everything this app layers on top
 * of it — country borders, burnt areas, active fires, and the past-fires
 * WMTS raster layer. (The past-fires *GeoJSON* layer isn't re-added here
 * since main.ts owns that source; it does the same thing on its own after
 * awaiting this — main.ts also re-applies the currently-selected year to
 * the WMTS layer re-added here, since a freshly re-added source always
 * starts back at its default year otherwise.)
 *
 * setStyle() replaces the whole style, which silently drops any source or
 * layer that isn't part of the new style JSON — including all of ours — so
 * everything has to be rebuilt from scratch once the new style has finished
 * loading rather than only once at startup. Globe projection is likewise a
 * property of the old style object, not a persistent map setting, so it's
 * reapplied via setProjection() here instead of requiring every style
 * variant to bake it in itself.
 *
 * Waits for whichever of "style.load" (success) or "error" (e.g. the new
 * style's URL failed to fetch) fires first, so a failed switch rejects
 * instead of leaving the caller awaiting forever.
 */
export function setBasemap(map: Map, kind: BasemapKind, placeLabelsEnabled: boolean): Promise<void> {
  return styleForBasemap(kind).then(
    (style) =>
      new Promise<void>((resolve, reject) => {
        const onLoad = async () => {
          map.off("error", onError);
          map.setProjection({ type: "globe" });
          addCountryBorders(map);
          addBurntAreasLayers(map);
          addActiveFiresLayers(map);
          addPastFiresLayer(map);
          await setPlaceLabelsVisible(map, placeLabelsEnabled);
          resolve();
        };
        const onError = (e: ErrorEvent) => {
          map.off("style.load", onLoad);
          reject(e.error);
        };
        map.once("style.load", onLoad);
        map.once("error", onError);
        map.setStyle(style);
      }),
  );
}

// Liberty's "place" source-layer covers 9 symbol layers, one per place
// class (country/state/city/town/village, plus a "label_other" catch-all
// for hamlets/neighbourhoods/suburbs/quarters). Town/village/other are by
// far the densest across Europe at a continent-wide zoom, so they're the
// ones dropped to keep labels from competing with the fire data for
// attention — country/state/city labels stay for geographic context. This
// is keyed by id (unlike the type/source-layer checks below) because
// distinguishing place *classes* structurally isn't possible without
// relying on each layer's filter expression; if Liberty renames these ids
// upstream, the affected layers just fall back to being shown.
const HIDDEN_PLACE_LABEL_IDS = new Set([
  //"label_village",
  //"label_town",
  "label_other",
]);

/**
 * Reduces a Liberty style object to a white background plus black
 * place-name labels (country/state/city only, see HIDDEN_PLACE_LABEL_IDS),
 * so the fire polygons/tiles drawn on top (see main.ts and the WMS raster
 * layers below) are the loudest thing on the map. Works structurally (by
 * layer type / source-layer) rather than by layer id, so it isn't tied to
 * Liberty's exact ~110-layer list and keeps working if that list changes
 * upstream. Mutates `style.layers` in place.
 */
function stripToPlaceLabelsOnly(style: Style): void {
  for (const layer of style.layers) {
    if (layer.type === "background") {
      layer.paint = { ...layer.paint, "background-color": "#ffffff" };
    } else if (
      layer.type === "symbol" &&
      layer["source-layer"] === "place" &&
      !HIDDEN_PLACE_LABEL_IDS.has(layer.id)
    ) {
      // Surviving place labels (country/state/city) — keep their existing
      // layout/hierarchy/halo as-is, just force the text black.
      layer.paint = { ...layer.paint, "text-color": "#000000" };
    } else {
      // Everything else — roads, water, buildings, parks, POI icons, the
      // shaded-relief raster, town/village/other labels, non-place labels —
      // is hidden.
      layer.layout = { ...layer.layout, visibility: "none" };
    }
  }
}

/** Toggles the surviving place labels (country/state/city — see
 * HIDDEN_PLACE_LABEL_IDS) on or off, without touching anything else.
 * Queries the live style rather than caching ids from `stripToPlaceLabelsOnly`
 * so it stays correct if that function's set of kept layers ever changes. */
export async function setPlaceLabelsVisible(map: Map, visible: boolean): Promise<void> {
  const currentStyle = map.getStyle();
  if (!currentStyle) return;

  const isRaster = currentStyle.layers.some(
    (l) => l.id === "osm-raster" || l.id === "satellite-raster",
  );

  if (visible && isRaster && !map.getSource("openmaptiles")) {
    try {
      const liberty = await fetchLibertyStyle();
      if (!map.getSource("openmaptiles")) {
        map.addSource("openmaptiles", liberty.sources.openmaptiles);
      }
      const placeLayers = liberty.layers.filter(
        (layer) =>
          layer.type === "symbol" &&
          layer["source-layer"] === "place" &&
          !HIDDEN_PLACE_LABEL_IDS.has(layer.id),
      );
      const isSatellite = currentStyle.layers.some((l) => l.id === "satellite-raster");
      for (const layer of placeLayers) {
        if (!map.getLayer(layer.id)) {
          const cloned = structuredClone(layer);
          if (isSatellite) {
            cloned.paint = {
              ...cloned.paint,
              "text-color": "#ffffff",
              "text-halo-color": "#000000",
              "text-halo-width": 1.5,
            };
          } else {
            cloned.paint = {
              ...cloned.paint,
              "text-color": "#000000",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.5,
            };
          }
          map.addLayer(cloned);
        }
      }
    } catch (e) {
      console.warn("Failed to dynamically inject place labels:", e);
    }
  }

  const ids = map
    .getStyle()
    .layers.filter(
      (layer) =>
        layer.type === "symbol" &&
        (layer["source-layer"] === "place" || layer["source-layer"] === "place_label") &&
        !HIDDEN_PLACE_LABEL_IDS.has(layer.id),
    )
    .map((layer) => layer.id);

  for (const id of ids) {
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

/** Adds GISCO country border/coastline lines, in black, below the place
 * labels (so text stays legible) but above the (invisible) fill layers. */
function addCountryBorders(map: Map): void {
  const firstSymbolLayer = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol");

  map.addSource(BORDERS_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    attribution:
      '<a href="https://gisco-services.ec.europa.eu/" target="_blank" rel="noopener">GISCO</a>',
  });
  map.addLayer(
    {
      id: BORDERS_LAYER_ID,
      type: "line",
      source: BORDERS_SOURCE_ID,
      // Kept thin and light-grey rather than solid black — this is
      // background context, not the thing the map is trying to show, and
      // shouldn't compete with the fire layers for visual attention.
      paint: {
        "line-color": "#5e5e5e",
        "line-width": 0.5,
        "line-opacity": 0.9,
      },
    },
    firstSymbolLayer?.id,
  );

  fetchCountryBorders()
    .then((data) =>
      (map.getSource(BORDERS_SOURCE_ID) as GeoJSONSource).setData(data),
    )
    .catch((err) => console.warn("Failed to load country borders:", err));
}

function addWmtsRasterLayer(
  map: Map,
  id: string,
  kind: WmtsLayerKind,
  beforeId: string | undefined,
): void {
  map.addSource(id, {
    type: "raster",
    tiles: [tileTemplate(kind)],
    // Must match EFFIS's WMTS EPSG3857 TileMatrixSet's tile pixel size —
    // it's what makes MapLibre request the same z/x/y as that matrix set's
    // TileMatrix/TileCol/TileRow identifiers (see tileTemplate in effis.ts).
    tileSize: 1024,
    attribution: EFFIS_ATTRIBUTION,
  });
  map.addLayer({ id, type: "raster", source: id }, beforeId);
}

/** Adds the burnt-area WMTS raster overlays (fire perimeter polygons), one
 * per source — MODIS and near-real-time — stacked together, visible by
 * default, below the place labels but above the country borders. Both are
 * toggled together by main.ts's "Burnt areas" control. Two sources, not
 * one, because the layer originally used here alone (`severity_time.week`)
 * turned out to render nothing — see the comment on `WmtsLayerKind` in
 * effis.ts. */
function addBurntAreasLayers(map: Map): void {
  const firstSymbolLayer = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol");
  for (const id of BURNT_AREAS_LAYER_IDS) {
    addWmtsRasterLayer(map, id, id, firstSymbolLayer?.id);
  }
}

/** Adds the active-fires WMTS raster overlays (hotspot points, rendered as
 * triangles by the tile server), one per satellite source — MODIS, VIIRS,
 * and Sentinel-3 — stacked above the burnt-area polygons so hotspots stay
 * visible where they overlap. All three are toggled together by main.ts's
 * "Active fires" control, matching EFFIS's own default view. */
function addActiveFiresLayers(map: Map): void {
  const firstSymbolLayer = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol");
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    addWmtsRasterLayer(map, id, id, firstSymbolLayer?.id);
  }
}

/** Adds the past-fires WMTS raster overlay (`modis.ba.<year>`, 2016+ only —
 * see EARLIEST_WMTS_YEAR in effis.ts), below the place labels but above
 * country borders, same as the current-fires WMTS layers. Starts on last
 * year as a reasonable default; main.ts immediately re-points it at
 * whichever year is actually selected via `setPastFiresYear` once the map
 * finishes loading (and again after every basemap switch, since setStyle()
 * drops this source along with everything else — see setBasemap above).
 * This sits alongside, not instead of, main.ts's WFS-backed vector fill/
 * outline layer — see the comment on `pastFiresTileTemplate` in effis.ts
 * for why both exist. */
function addPastFiresLayer(map: Map): void {
  const firstSymbolLayer = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol");
  map.addSource(PAST_FIRES_LAYER_ID, {
    type: "raster",
    tiles: [pastFiresTileTemplate(new Date().getFullYear() - 1)],
    tileSize: 1024,
    attribution: EFFIS_ATTRIBUTION,
  });
  map.addLayer(
    { id: PAST_FIRES_LAYER_ID, type: "raster", source: PAST_FIRES_LAYER_ID },
    firstSymbolLayer?.id,
  );
}

/** Repoints the past-fires raster layer at a different year's tiles —
 * called whenever the year `<select>` changes, and once right after this
 * layer is (re-)created, since it always starts on a hardcoded default
 * year (see addPastFiresLayer). */
export function setPastFiresYear(map: Map, year: number): void {
  (map.getSource(PAST_FIRES_LAYER_ID) as RasterTileSource).setTiles([
    pastFiresTileTemplate(year),
  ]);
}
