import {
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchCountryBorders } from "./borders";
import { resolveEffisTileRequest, tileTemplate, type WmsLayerKind } from "./effis";

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

export const BURNT_AREAS_LAYER_ID = "burnt-areas-raster";
export const ACTIVE_FIRES_LAYER_IDS = ["active-fires-modis", "active-fires-viirs", "active-fires-s3"] as const;

// Roughly covers continental Europe, the Nordics, and the western Mediterranean.
const EUROPE_BOUNDS: LngLatBoundsLike = [
  [-25, 34],
  [45, 72],
];

type Style = ReturnType<Map["getStyle"]>;

export async function createMap(container: HTMLElement): Promise<Map> {
  const map = new Map({
    container,
    style: await loadStrippedStyle(),
    bounds: EUROPE_BOUNDS,
    fitBoundsOptions: { padding: 20 },
    // Rewrites the placeholder tile URLs from tileTemplate() (see effis.ts)
    // into real EFFIS WMS GetMap requests. MapLibre has no native WMS/BBOX
    // tile support, so this is the standard way to adapt a WMS endpoint
    // into a raster tile source.
    transformRequest: (url) => {
      const resolved = resolveEffisTileRequest(url);
      return resolved ? { url: resolved } : { url };
    },
  });

  map.on("load", () => {
    addCountryBorders(map);
    addBurntAreasLayer(map);
    addActiveFiresLayers(map);
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
async function loadStrippedStyle(): Promise<Style | string> {
  let style: Style;
  try {
    style = (await (await fetch(OPENFREEMAP_STYLE)).json()) as Style;
  } catch (err) {
    console.warn("Failed to pre-fetch basemap style, falling back to default load path:", err);
    return OPENFREEMAP_STYLE;
  }

  style.projection = { type: "globe" };
  stripToPlaceLabelsOnly(style);
  return style;
}

/**
 * Reduces a Liberty style object to a white background plus black
 * place-name labels, so the fire polygons/tiles drawn on top (see main.ts
 * and the WMS raster layers below) are the only colour on the map. Works
 * structurally (by layer type / source-layer) rather than by layer id, so
 * it isn't tied to Liberty's exact ~110-layer list and keeps working if
 * that list changes upstream. Mutates `style.layers` in place.
 */
function stripToPlaceLabelsOnly(style: Style): void {
  for (const layer of style.layers) {
    if (layer.type === "background") {
      layer.paint = { ...layer.paint, "background-color": "#ffffff" };
    } else if (layer.type === "symbol" && layer["source-layer"] === "place") {
      // Place-name labels (country/state/city/town/village) — keep their
      // existing layout/hierarchy/halo as-is, just force the text black.
      layer.paint = { ...layer.paint, "text-color": "#000000" };
    } else {
      // Everything else — roads, water, buildings, parks, POI icons, the
      // shaded-relief raster, non-place labels — is hidden.
      layer.layout = { ...layer.layout, visibility: "none" };
    }
  }
}

/** Adds GISCO country border/coastline lines, in black, below the place
 * labels (so text stays legible) but above the (invisible) fill layers. */
function addCountryBorders(map: Map): void {
  const firstSymbolLayer = map.getStyle().layers.find((layer) => layer.type === "symbol");

  map.addSource(BORDERS_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    attribution: '<a href="https://gisco-services.ec.europa.eu/" target="_blank" rel="noopener">GISCO</a>',
  });
  map.addLayer(
    {
      id: BORDERS_LAYER_ID,
      type: "line",
      source: BORDERS_SOURCE_ID,
      paint: { "line-color": "#000000", "line-width": 0.75 },
    },
    firstSymbolLayer?.id,
  );

  fetchCountryBorders()
    .then((data) => (map.getSource(BORDERS_SOURCE_ID) as GeoJSONSource).setData(data))
    .catch((err) => console.warn("Failed to load country borders:", err));
}

function addWmsRasterLayer(map: Map, id: string, kind: WmsLayerKind, beforeId: string | undefined): void {
  map.addSource(id, {
    type: "raster",
    tiles: [tileTemplate(kind)],
    tileSize: 256,
    attribution: EFFIS_ATTRIBUTION,
  });
  map.addLayer({ id, type: "raster", source: id }, beforeId);
}

/** Adds the burnt-area WMS raster overlay (fire perimeter polygons),
 * visible by default, below the place labels but above the country
 * borders. main.ts toggles its visibility via the "Burnt areas" control. */
function addBurntAreasLayer(map: Map): void {
  const firstSymbolLayer = map.getStyle().layers.find((layer) => layer.type === "symbol");
  addWmsRasterLayer(map, BURNT_AREAS_LAYER_ID, "burnt-areas", firstSymbolLayer?.id);
}

/** Adds the active-fires WMS raster overlays (hotspot points, rendered as
 * triangles by the WMS server), one per satellite source — MODIS, VIIRS,
 * and Sentinel-3 — stacked above the burnt-area polygons so hotspots stay
 * visible where they overlap. All three are toggled together by main.ts's
 * "Active fires" control, matching EFFIS's own default view. */
function addActiveFiresLayers(map: Map): void {
  const firstSymbolLayer = map.getStyle().layers.find((layer) => layer.type === "symbol");
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    addWmsRasterLayer(map, id, id, firstSymbolLayer?.id);
  }
}
