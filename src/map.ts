import {
  AttributionControl,
  Map,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchCountryBorders } from "./borders";
import { tileTemplate, type WmtsLayerKind } from "./effis";

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

export const BURNT_AREAS_LAYER_IDS = ["burnt-areas-modis", "burnt-areas-nrt"] as const;
export const ACTIVE_FIRES_LAYER_IDS = [
  "active-fires-modis",
  "active-fires-viirs",
  "active-fires-s3",
] as const;

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
  const attribution = container.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
  if (!attribution) return;

  const collapse = () => {
    attribution.removeAttribute("open");
    attribution.classList.remove("maplibregl-compact-show");
  };
  collapse();

  const observer = new MutationObserver(collapse);
  observer.observe(attribution, { attributes: true, attributeFilter: ["open"] });
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
  let style: Style;
  try {
    style = (await (await fetch(OPENFREEMAP_STYLE)).json()) as Style;
  } catch (err) {
    console.warn(
      "Failed to pre-fetch basemap style, falling back to default load path:",
      err,
    );
    return OPENFREEMAP_STYLE;
  }

  style.projection = { type: "globe" };
  stripToPlaceLabelsOnly(style);
  return style;
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
  "label_village",
  "label_town",
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
export function setPlaceLabelsVisible(map: Map, visible: boolean): void {
  const ids = map
    .getStyle()
    .layers.filter(
      (layer) =>
        layer.type === "symbol" &&
        layer["source-layer"] === "place" &&
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
