import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// Roughly covers continental Europe, the Nordics, and the western Mediterranean.
const EUROPE_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-25, 34],
  [45, 72],
];

export function createMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: OPENFREEMAP_STYLE,
    bounds: EUROPE_BOUNDS,
    fitBoundsOptions: { padding: 20 },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl(), "bottom-left");

  return map;
}
