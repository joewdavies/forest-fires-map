import {
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ErrorEvent,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type RasterTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchCountryBorders } from "./borders";
import type { Language } from "./i18n";
import {
  pastFiresTileTemplate,
  tileTemplate,
  type WmtsLayerKind,
} from "./effis";

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

export async function createMap(
  container: HTMLElement,
  initialBasemap: BasemapKind = "plain",
  language: Language = "en",
): Promise<Map> {
  const map = new Map({
    container,
    style: await styleForBasemap(initialBasemap, language),
    bounds: DEFAULT_BOUNDS,
    fitBoundsOptions: { padding: 20 },
    // Attribution and data-source links are provided in the app's info modal.
    attributionControl: false,
  });

  map.on("load", () => {
    map.setProjection({ type: "globe" });
    if (initialBasemap === "3d") {
      map.setPitch(60);
      map.setBearing(30);
      map.dragRotate.enable();
    } else {
      map.setPitch(0);
      map.setBearing(0);
      map.dragRotate.disable();
    }
    addCountryBorders(map, initialBasemap);
    addBurntAreasLayers(map);
    addActiveFiresLayers(map);
    addPastFiresLayer(map);
    setPlaceLabelsLanguage(map, language);
  });

  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new ScaleControl(), "bottom-left");

  return map;
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
async function loadStrippedStyle(language: Language): Promise<Style | string> {
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
  localizePlaceLabelLayers(raw.layers, language);
  return raw;
}

// Cached so switching the basemap back to "plain" (see setBasemap below)
// doesn't re-fetch the ~1MB style JSON from OpenFreeMap every time — only
// the very first load (or first switch to "plain") pays the network cost.
// Callers get a fresh clone each time since stripToPlaceLabelsOnly mutates
// its argument in place and the cached copy must stay pristine.
let cachedLibertyStyle: Style | null = null;

async function fetchLibertyStyle(): Promise<Style> {
  cachedLibertyStyle ??= (await (
    await fetch(OPENFREEMAP_STYLE)
  ).json()) as Style;
  return structuredClone(cachedLibertyStyle);
}

export type BasemapKind =
  | "plain"
  | "positron"
  | "bright"
  | "liberty"
  | "dark"
  | "fiord"
  | "satellite"
  | "3d";

// Esri's World Imagery service is the satellite raster basemap previously
// offered by the app. ArcGIS REST tile URLs use z/y/x ordering.
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';

function satelliteStyle(): Style {
  return {
    version: 8,
    sources: {
      "satellite-raster": {
        type: "raster",
        tiles: [SATELLITE_TILE_URL],
        tileSize: 256,
        attribution: SATELLITE_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "satellite-raster",
        type: "raster",
        source: "satellite-raster",
      },
    ],
  };
}

async function styleForBasemap(
  kind: BasemapKind,
  language: Language,
): Promise<Style | string> {
  if (kind === "plain") {
    return loadStrippedStyle(language);
  }
  if (kind === "satellite") {
    return satelliteStyle();
  }
  if (kind === "3d") {
    return "https://tiles.openfreemap.org/styles/liberty";
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
export function setBasemap(
  map: Map,
  kind: BasemapKind,
  placeLabelsEnabled: boolean,
  language: Language,
  effisWmtsEnabled = true,
): Promise<void> {
  return styleForBasemap(kind, language).then(
    (style) =>
      new Promise<void>((resolve, reject) => {
        const onLoad = async () => {
          map.off("error", onError);
          map.setProjection({ type: "globe" });
          if (kind === "3d") {
            map.setPitch(60);
            map.setBearing(30);
            map.dragRotate.enable();
          } else {
            map.setPitch(0);
            map.setBearing(0);
            map.dragRotate.disable();
          }
          addCountryBorders(map, kind);
          if (effisWmtsEnabled) addEffisWmtsLayers(map);
          await setPlaceLabelsVisible(map, placeLabelsEnabled, language);
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
const HIDDEN_PLACE_LABEL_IDS = new Set<string>([
  //"label_village",
  //"label_town",
  //"label_other",
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
      layer["source-layer"] === "place" //&&
      //!HIDDEN_PLACE_LABEL_IDS.has(layer.id)
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
export async function setPlaceLabelsVisible(
  map: Map,
  visible: boolean,
  language: Language = "en",
): Promise<void> {
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
      const isSatellite = currentStyle.layers.some(
        (l) => l.id === "satellite-raster",
      );
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
          localizePlaceLabelLayer(cloned, language);
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
        (layer["source-layer"] === "place" ||
          layer["source-layer"] === "place_label") &&
        !HIDDEN_PLACE_LABEL_IDS.has(layer.id),
    )
    .map((layer) => layer.id);

  for (const id of ids) {
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  setPlaceLabelsLanguage(map, language);
}

/** Uses a translated OpenMapTiles name when present, falling back to the
 * feature's local name. Both current (`name:xx`) and legacy (`name_xx`)
 * field conventions are supported by the public tile source. */
export function setPlaceLabelsLanguage(
  map: Map,
  language: Language,
): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (
      layer.type === "symbol" &&
      (layer["source-layer"] === "place" ||
        layer["source-layer"] === "place_label")
    ) {
      map.setLayoutProperty(layer.id, "text-field", localizedName(language));
    }
  }
}

function localizePlaceLabelLayers(
  layers: Style["layers"],
  language: Language,
): void {
  for (const layer of layers) {
    localizePlaceLabelLayer(layer, language);
  }
}

function localizePlaceLabelLayer(
  layer: Style["layers"][number],
  language: Language,
): void {
  if (
    layer.type === "symbol" &&
    (layer["source-layer"] === "place" ||
      layer["source-layer"] === "place_label")
  ) {
    layer.layout = {
      ...layer.layout,
      "text-field": localizedName(language),
    };
  }
}

function localizedName(language: Language): ExpressionSpecification {
  return [
    "coalesce",
    ["get", `name:${language}`],
    ["get", `name_${language}`],
    ["get", "name"],
  ];
}

/** Adds GISCO country border/coastline lines, in black, below the place
 * labels (so text stays legible) but above the (invisible) fill layers. */
function addCountryBorders(map: Map, kind: BasemapKind): void {
  if (kind !== "plain") return;
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

/** Restores the complete EFFIS WMTS stack after switching back from FIRMS. */
export function addEffisWmtsLayers(map: Map): void {
  addBurntAreasLayers(map);
  addActiveFiresLayers(map);
  addPastFiresLayer(map);
}

/** Removing the layers alone is insufficient: deleting the raster sources
 * also cancels MapLibre's outstanding/retry tile pipeline. */
export function removeEffisWmtsLayers(map: Map): void {
  const ids = [
    ...ACTIVE_FIRES_LAYER_IDS,
    ...BURNT_AREAS_LAYER_IDS,
    PAST_FIRES_LAYER_ID,
  ];
  for (const id of ids) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of ids) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

/** Repoints the past-fires raster layer at a different year's tiles.
 * Safely does nothing while FIRMS mode has removed the WMTS stack. */
export function setPastFiresYear(map: Map, year: number): void {
  const source = map.getSource(PAST_FIRES_LAYER_ID) as
    | RasterTileSource
    | undefined;
  source?.setTiles([pastFiresTileTemplate(year)]);
}
