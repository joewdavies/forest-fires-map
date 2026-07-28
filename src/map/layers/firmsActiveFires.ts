import type { ExpressionSpecification, Map as MaplibreMap } from "maplibre-gl";
import legendConfig from "../../legend-config.json";
import { FIRMS_ATTRIBUTION } from "../../firms";

export const FIRMS_SOURCE_ID = "active-fires-firms";
export const FIRMS_GLOW_LAYER_ID = "active-fires-firms-glow";
export const FIRMS_LAYER_ID = "active-fires-firms-circles";
export const FIRMS_MODIS_LAYER_ID = "active-fires-firms-modis";

const FIRMS_MODIS_ICON_ID = "firms-modis-triangle";
const FIRMS_DETAIL_MIN_ZOOM = 7;
const FIRMS_POINT_RADIUS_STOPS = [
  [3, 1],
  [6, 2],
  [10, 2],
  [14, 3],
] as const;

export function addFirmsActiveFiresLayer(map: MaplibreMap): void {
  map.addSource(FIRMS_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    attribution: FIRMS_ATTRIBUTION,
  });

  const firstSymbolLayer = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol");

  map.addLayer(
    {
      id: FIRMS_GLOW_LAYER_ID,
      type: "heatmap",
      source: FIRMS_SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": 1,
        // prettier-ignore
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3, 0.08,
          6, 0.12,
          10, 0.2,
          14, 0.3,
        ],
        "heatmap-radius": glowRadiusExpression(),
        // prettier-ignore
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,    "rgba(255, 214, 64, 0)",
          0.15, "rgba(255, 214, 64, 0)",
          0.3,  "rgba(255, 214, 64, 0.5)",
          0.5,  "rgba(255, 153, 32, 0.75)",
          0.75, "rgba(239, 68, 35, 0.9)",
          1,    "rgba(92, 10, 18, 0.98)",
        ],
      },
    },
    firstSymbolLayer?.id,
  );

  map.addLayer(
    {
      id: FIRMS_LAYER_ID,
      type: "circle",
      source: FIRMS_SOURCE_ID,
      minzoom: FIRMS_DETAIL_MIN_ZOOM,
      filter: ["!=", ["get", "source"], "MODIS_NRT"],
      layout: { visibility: "none" },
      paint: {
        "circle-radius": pointRadiusExpression(),
        "circle-color": recencyColorExpression(),
        "circle-opacity": 0.9,
      },
    },
    firstSymbolLayer?.id,
  );

  ensureModisIcon(map);
  map.addLayer(
    {
      id: FIRMS_MODIS_LAYER_ID,
      type: "symbol",
      source: FIRMS_SOURCE_ID,
      minzoom: FIRMS_DETAIL_MIN_ZOOM,
      filter: ["==", ["get", "source"], "MODIS_NRT"],
      layout: {
        visibility: "none",
        "icon-image": FIRMS_MODIS_ICON_ID,
        "icon-size": iconSizeExpression(),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": recencyColorExpression(),
        "icon-opacity": 0.9,
      },
    },
    firstSymbolLayer?.id,
  );
}

function ensureModisIcon(map: MaplibreMap): void {
  if (map.hasImage(FIRMS_MODIS_ICON_ID)) return;
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#fff";
  context.beginPath();
  context.moveTo(size / 2, 1);
  context.lineTo(size - 1, size - 1);
  context.lineTo(1, size - 1);
  context.closePath();
  context.fill();
  map.addImage(
    FIRMS_MODIS_ICON_ID,
    context.getImageData(0, 0, size, size),
    { sdf: true },
  );
}

function recencyColorExpression(): ExpressionSpecification {
  const stops = legendConfig.activeFires.colors.flatMap((color) => [
    color.labelKey,
    color.color,
  ]);
  return [
    "match",
    ["get", "recencyTier"],
    ...stops,
    "#999999",
  ] as unknown as ExpressionSpecification;
}

function pointRadiusExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...FIRMS_POINT_RADIUS_STOPS.flat(),
  ] as ExpressionSpecification;
}

function iconSizeExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...FIRMS_POINT_RADIUS_STOPS.flatMap(([zoom, radius]) => [
      zoom,
      (radius * 2) / 24,
    ]),
  ] as ExpressionSpecification;
}

function glowRadiusExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    4,
    5,
    6,
    7,
    10,
    10,
    16,
    14,
    20,
  ] as ExpressionSpecification;
}
