import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, LngLat, Map as MaplibreMap } from "maplibre-gl";

const SOURCE_ID = "distance-measurement";
const LINE_LAYER_ID = "distance-measurement-line";
const POINT_LAYER_ID = "distance-measurement-points";

interface MeasurementElements {
  mapContainer: HTMLElement;
  button: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  tooltip: HTMLElement;
  tooltipText: HTMLElement;
}

interface MeasurementOptions {
  map: MaplibreMap;
  elements: MeasurementElements;
  translate: (
    key: string,
    variables?: Record<string, string | number>,
  ) => string;
  getLocale: () => string;
  closePopup: () => void;
}

export interface MeasurementTool {
  addLayers: () => void;
  isActive: () => boolean;
  refreshTooltip: () => void;
}

export function createMeasurementTool(
  options: MeasurementOptions,
): MeasurementTool {
  const { map, elements, translate, getLocale, closePopup } = options;
  let active = false;
  let start: LngLat | null = null;
  let end: LngLat | null = null;
  let preview: LngLat | null = null;

  const collection = (): FeatureCollection => {
    const points = [start, end].filter(
      (point): point is LngLat => point !== null,
    );
    const lineEnd = end ?? preview;
    const features: FeatureCollection["features"] = points.map((point) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    }));

    if (start && lineEnd) {
      features.unshift({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [start.lng, start.lat],
            [lineEnd.lng, lineEnd.lat],
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  };

  const updateData = (): void => {
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(
      collection(),
    );
  };

  const updateDistance = (from: LngLat, to: LngLat): void => {
    elements.tooltipText.textContent = translate("measure_distance", {
      distance: formatDistance(distanceInMetres(from, to), getLocale()),
    });
  };

  const refreshTooltip = (): void => {
    if (!active) return;
    const lineEnd = end ?? preview;
    if (start && lineEnd) updateDistance(start, lineEnd);
    else {
      elements.tooltipText.textContent = translate(
        start ? "measure_choose_end" : "measure_choose_start",
      );
    }
  };

  const stop = (): void => {
    active = false;
    start = null;
    end = null;
    preview = null;
    elements.button.classList.remove("active");
    elements.button.setAttribute("aria-pressed", "false");
    elements.mapContainer.classList.remove("measuring");
    elements.tooltip.hidden = true;
    updateData();
  };

  const begin = (): void => {
    active = true;
    start = null;
    end = null;
    preview = null;
    elements.button.classList.add("active");
    elements.button.setAttribute("aria-pressed", "true");
    elements.mapContainer.classList.add("measuring");
    elements.tooltip.hidden = false;
    elements.tooltipText.textContent = translate("measure_choose_start");
    closePopup();
    updateData();
  };

  elements.button.addEventListener("click", () => {
    if (active) stop();
    else begin();
  });
  elements.closeButton.addEventListener("click", stop);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active) stop();
  });

  map.on("click", (event) => {
    if (!active) return;
    if (!start || end) {
      start = event.lngLat;
      end = null;
      preview = null;
      elements.tooltipText.textContent = translate("measure_choose_end");
    } else {
      end = event.lngLat;
      preview = null;
      updateDistance(start, end);
    }
    updateData();
  });

  map.on("mousemove", (event) => {
    if (!active || !start || end) return;
    preview = event.lngLat;
    updateData();
    updateDistance(start, preview);
  });

  return {
    isActive: () => active,
    refreshTooltip,
    addLayers: () => addMeasurementLayers(map, collection()),
  };
}

function addMeasurementLayers(
  map: MaplibreMap,
  initialData: FeatureCollection,
): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data: initialData });
  }
  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#e25822",
        "line-width": 3,
        "line-dasharray": [2, 1],
      },
    });
  }
  if (!map.getLayer(POINT_LAYER_ID)) {
    map.addLayer({
      id: POINT_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 6,
        "circle-color": "#fff",
        "circle-stroke-color": "#e25822",
        "circle-stroke-width": 3,
      },
    });
  }
}

function distanceInMetres(start: LngLat, end: LngLat): number {
  const radians = Math.PI / 180;
  const lat1 = start.lat * radians;
  const lat2 = end.lat * radians;
  const deltaLat = (end.lat - start.lat) * radians;
  const deltaLng = (end.lng - start.lng) * radians;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(metres: number, locale: string): string {
  if (metres < 1000) {
    const value = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(metres);
    return `${value} m`;
  }
  const kilometres = metres / 1000;
  const digits = kilometres < 10 ? 2 : 1;
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(kilometres);
  return `${value} km`;
}
