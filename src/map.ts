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
import { currentFiresTileTemplate, resolveEffisTileRequest } from "./effis";

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
export const CURRENT_FIRES_LAYER_ID = "current-fires-raster";

// Roughly covers continental Europe, the Nordics, and the western Mediterranean.
const EUROPE_BOUNDS: LngLatBoundsLike = [
  [-25, 34],
  [45, 72],
];

export function createMap(container: HTMLElement): Map {
  const map = new Map({
    container,
    style: OPENFREEMAP_STYLE,
    bounds: EUROPE_BOUNDS,
    fitBoundsOptions: { padding: 20 },
    // Rewrites the placeholder tile URLs from currentFiresTileTemplate()
    // (see effis.ts) into real EFFIS WMS GetMap requests. MapLibre has no
    // native WMS/BBOX tile support, so this is the standard way to adapt a
    // WMS endpoint into a raster tile source.
    transformRequest: (url) => {
      const resolved = resolveEffisTileRequest(url);
      return resolved ? { url: resolved } : { url };
    },
  });

  map.on("load", () => {
    map.setProjection({ type: "globe" });
    stripToPlaceLabelsOnly(map);
    addCountryBorders(map);
    addCurrentFiresLayer(map);
  });

  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new ScaleControl(), "bottom-left");

  return map;
}

/**
 * Reduces OpenFreeMap's Liberty style to a white background plus black
 * place-name labels, so the fire polygons drawn on top (see main.ts) are the
 * only colour on the map. Works structurally (by layer type / source-layer)
 * rather than by layer id, so it isn't tied to Liberty's exact ~110-layer
 * list and keeps working if that list changes upstream.
 */
function stripToPlaceLabelsOnly(map: Map): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-color", "#ffffff");
    } else if (layer.type === "symbol" && layer["source-layer"] === "place") {
      // Place-name labels (country/state/city/town/village) — keep their
      // existing layout/hierarchy/halo as-is, just force the text black.
      map.setPaintProperty(layer.id, "text-color", "#000000");
    } else {
      // Everything else — roads, water, buildings, parks, POI icons, the
      // shaded-relief raster, non-place labels — is hidden.
      map.setLayoutProperty(layer.id, "visibility", "none");
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

/** Adds the current-fires WMS raster overlay, visible by default (matching
 * "Current fires" being the default mode — see main.ts), below the place
 * labels but above the country borders. main.ts toggles its visibility
 * when switching to/from "Past fires". */
function addCurrentFiresLayer(map: Map): void {
  const firstSymbolLayer = map.getStyle().layers.find((layer) => layer.type === "symbol");

  map.addSource(CURRENT_FIRES_LAYER_ID, {
    type: "raster",
    tiles: [currentFiresTileTemplate()],
    tileSize: 256,
  });
  map.addLayer(
    {
      id: CURRENT_FIRES_LAYER_ID,
      type: "raster",
      source: CURRENT_FIRES_LAYER_ID,
    },
    firstSymbolLayer?.id,
  );
}
