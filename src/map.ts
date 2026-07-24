import { Map, NavigationControl, ScaleControl, type LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

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
  });

  map.on("load", () => {
    map.setProjection({ type: "globe" });
    stripToPlaceLabelsOnly(map);
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
