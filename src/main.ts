import {
  initTranslations,
  t,
  getLanguage,
  setLanguage,
  type Language,
} from "./i18n";
import "./style.css";
import legendConfig from "./legend-config.json";
import config from "../config.json";
import {
  Popup,
  type GeoJSONSource,
  type LngLat,
  type Map as MaplibreMap,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  createMap,
  setBasemap,
  setPastFiresYear,
  setPlaceLabelsLanguage,
  setPlaceLabelsVisible,
  ACTIVE_FIRES_LAYER_IDS,
  BURNT_AREAS_LAYER_IDS,
  PAST_FIRES_LAYER_ID,
  type BasemapKind,
} from "./map";
import {
  EARLIEST_WMTS_YEAR,
  EffisError,
  fetchHistoricalFires,
  getBurntAreaHa,
  getCountry,
  getFireDateIso,
  getProvince,
} from "./effis";
import { watchEffisHealth, type EffisHealth } from "./effisHealth";

const FIRE_SOURCE_ID = "fires";
const FIRE_FILL_LAYER = "fires-fill";
const FIRE_OUTLINE_LAYER = "fires-outline";
const MEASURE_SOURCE_ID = "distance-measurement";
const MEASURE_LINE_LAYER_ID = "distance-measurement-line";
const MEASURE_POINT_LAYER_ID = "distance-measurement-points";
const EARLIEST_YEAR = 2000;

type Mode = "current" | "past";

const mapContainer = document.getElementById("map") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const currentBtn = document.getElementById("mode-current") as HTMLButtonElement;
const pastBtn = document.getElementById("mode-past") as HTMLButtonElement;
const yearSelect = document.getElementById("year-select") as HTMLSelectElement;
const layerToggle = document.getElementById("layer-toggle") as HTMLElement;
const activeFiresCheckbox = document.getElementById(
  "toggle-active-fires",
) as HTMLInputElement;
const burntAreasCheckbox = document.getElementById(
  "toggle-burnt-areas",
) as HTMLInputElement;
const placeLabelsCheckbox = document.getElementById(
  "toggle-place-labels",
) as HTMLInputElement;

const layersBtn = document.getElementById("layers-btn") as HTMLButtonElement;
const layersSheet = document.getElementById("layers-sheet") as HTMLElement;
const sheetCloseBtn = document.getElementById(
  "sheet-close",
) as HTMLButtonElement;
const sheetBackdrop = document.getElementById("sheet-backdrop") as HTMLElement;
const basemapOptions = document.querySelectorAll(
  ".basemap-option",
) as NodeListOf<HTMLButtonElement>;
const compassBtn = document.getElementById("compass-btn") as HTMLButtonElement;
const compassNeedle = document.getElementById(
  "compass-needle",
) as SVGElement | null;
const measureBtn = document.getElementById(
  "measure-btn",
) as HTMLButtonElement;
const measureTooltip = document.getElementById(
  "measure-tooltip",
) as HTMLElement;
const measureTooltipText = document.getElementById(
  "measure-tooltip-text",
) as HTMLElement;
const measureCloseBtn = document.getElementById(
  "measure-close",
) as HTMLButtonElement;

const effisWarning = document.getElementById("effis-warning") as HTMLElement;
const effisWarningText = document.getElementById(
  "effis-warning-text",
) as HTMLElement;
const effisWarningClose = document.getElementById(
  "effis-warning-close",
) as HTMLButtonElement;

const searchContainer = document.getElementById(
  "search-container",
) as HTMLElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
const mapLoadingIndicator = document.getElementById(
  "map-loading-indicator",
) as HTMLElement;
const searchResults = document.getElementById(
  "search-results",
) as HTMLUListElement;

const langBtn = document.getElementById("lang-btn") as HTMLButtonElement;
const langMenu = document.getElementById("lang-menu") as HTMLElement;
const langOptions = document.querySelectorAll(
  ".lang-option",
) as NodeListOf<HTMLButtonElement>;

const aboutBtn = document.getElementById("about-btn") as HTMLButtonElement;
const aboutModal = document.getElementById("about-modal") as HTMLElement;
const aboutCloseBtn = document.getElementById(
  "about-close",
) as HTMLButtonElement;

const legendBtn = document.getElementById("legend-btn") as HTMLButtonElement;
const legendCard = document.getElementById("legend-card") as HTMLElement;
const legendCloseBtn = document.getElementById(
  "legend-close",
) as HTMLButtonElement;

const activeFiresImg = document.getElementById(
  "legend-img-active-fires",
) as HTMLImageElement | null;
const activeFiresFallback = document.getElementById(
  "legend-fallback-active-fires",
) as HTMLElement | null;
const burntAreasImg = document.getElementById(
  "legend-img-burnt-areas",
) as HTMLImageElement | null;
const burntAreasFallback = document.getElementById(
  "legend-fallback-burnt-areas",
) as HTMLElement | null;

let mode: Mode = "current";
let requestId = 0;
let currentBasemap: BasemapKind =
  (config.defaultBasemap as BasemapKind) || "plain";
let measurementActive = false;
let measurementStart: LngLat | null = null;
let measurementEnd: LngLat | null = null;
let measurementPreview: LngLat | null = null;
let currentEffisHealth: EffisHealth = "ok";
let dismissedEffisHealth: EffisHealth | null = null;

populateYearSelect();

initTranslations();

const map = await createMap(mapContainer, currentBasemap, getLanguage());
const popup = new Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "280px",
});

let loadingIndicatorHideTimer: number | undefined;

function setMapLoading(loading: boolean): void {
  window.clearTimeout(loadingIndicatorHideTimer);
  if (loading) {
    mapLoadingIndicator.classList.add("active");
    return;
  }

  // A short delay prevents the indicator flashing between adjacent tile
  // requests while a basemap or WMS/WMTS layer is still filling the view.
  loadingIndicatorHideTimer = window.setTimeout(() => {
    mapLoadingIndicator.classList.remove("active");
  }, 150);
}

map.on("dataloading", () => setMapLoading(true));
map.on("idle", () => setMapLoading(false));

// Set initial basemap selection in UI
for (const option of basemapOptions) {
  option.setAttribute(
    "aria-checked",
    String(option.dataset.basemap === currentBasemap),
  );
}

map.on("load", () => {
  addFireLayer(map);
  addMeasurementLayers();
  watchEffisHealth(map, handleEffisHealthChange);

  map.on("mouseenter", FIRE_FILL_LAYER, () => {
    if (!measurementActive) map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", FIRE_FILL_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", FIRE_FILL_LAYER, (e: MapLayerMouseEvent) => {
    if (measurementActive) return;
    const feature = e.features?.[0];
    if (feature) showFirePopup(feature, e.lngLat);
  });

  setPastFiresYear(map, Number(yearSelect.value));
  applyModeVisibility();
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked, getLanguage());
  loadFires();
  updateLegend();
});

currentBtn.addEventListener("click", () => setMode("current"));
pastBtn.addEventListener("click", () => setMode("past"));
yearSelect.addEventListener("change", () => {
  if (mode === "past") {
    loadFires();
    updateLegend();
  }
});
activeFiresCheckbox.addEventListener("change", () => {
  applyModeVisibility();
  updateLegend();
});
burntAreasCheckbox.addEventListener("change", () => {
  applyModeVisibility();
  updateLegend();
});
placeLabelsCheckbox.addEventListener("change", () => {
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked, getLanguage());
  updateLegend();
});

for (const option of basemapOptions) {
  option.addEventListener("click", () => {
    const kind = option.dataset.basemap as BasemapKind;
    if (kind !== currentBasemap) handleBasemapChange(kind);
  });
}

layersBtn.addEventListener("click", openSheet);
sheetCloseBtn.addEventListener("click", closeSheet);
sheetBackdrop.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !layersSheet.hidden) closeSheet();
});

compassBtn.addEventListener("click", () => {
  map.resetNorthPitch();
});

measureBtn.addEventListener("click", () => {
  if (measurementActive) {
    stopMeasurement();
  } else {
    startMeasurement();
  }
});
measureCloseBtn.addEventListener("click", stopMeasurement);

map.on("click", (e) => {
  if (!measurementActive) return;

  if (!measurementStart || measurementEnd) {
    measurementStart = e.lngLat;
    measurementEnd = null;
    measurementPreview = null;
    measureTooltipText.textContent = t("measure_choose_end");
  } else {
    measurementEnd = e.lngLat;
    measurementPreview = null;
    updateMeasurementTooltip(measurementStart, measurementEnd);
  }
  updateMeasurementData();
});

map.on("mousemove", (e) => {
  if (!measurementActive || !measurementStart || measurementEnd) return;
  measurementPreview = e.lngLat;
  updateMeasurementData();
  updateMeasurementTooltip(measurementStart, measurementPreview);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && measurementActive) stopMeasurement();
});

map.on("rotate", updateCompass);
map.on("load", updateCompass);

function updateCompass() {
  const bearing = map.getBearing();
  if (Math.abs(bearing) > 0.5) {
    compassBtn.classList.add("visible");
    if (compassNeedle) {
      compassNeedle.style.transform = `rotate(${-bearing}deg)`;
    }
  } else {
    compassBtn.classList.remove("visible");
  }
}

// --- EFFIS health warning ---------------------------------------------

function handleEffisHealthChange(health: EffisHealth): void {
  currentEffisHealth = health;
  if (health === "ok") {
    dismissedEffisHealth = null;
    effisWarning.hidden = true;
    return;
  }
  if (health === dismissedEffisHealth) return;
  effisWarningText.textContent = t(
    health === "down" ? "effis_status_down" : "effis_status_slow",
  );
  effisWarning.hidden = false;
}

effisWarningClose.addEventListener("click", () => {
  dismissedEffisHealth = currentEffisHealth;
  effisWarning.hidden = true;
});

function refreshEffisWarningText(): void {
  if (effisWarning.hidden) return;
  effisWarningText.textContent = t(
    currentEffisHealth === "down" ? "effis_status_down" : "effis_status_slow",
  );
}

function startMeasurement(): void {
  measurementActive = true;
  measurementStart = null;
  measurementEnd = null;
  measurementPreview = null;
  measureBtn.classList.add("active");
  measureBtn.setAttribute("aria-pressed", "true");
  mapContainer.classList.add("measuring");
  measureTooltip.hidden = false;
  measureTooltipText.textContent = t("measure_choose_start");
  popup.remove();
  updateMeasurementData();
}

function stopMeasurement(): void {
  measurementActive = false;
  measurementStart = null;
  measurementEnd = null;
  measurementPreview = null;
  measureBtn.classList.remove("active");
  measureBtn.setAttribute("aria-pressed", "false");
  mapContainer.classList.remove("measuring");
  measureTooltip.hidden = true;
  updateMeasurementData();
}

function addMeasurementLayers(): void {
  if (!map.getSource(MEASURE_SOURCE_ID)) {
    map.addSource(MEASURE_SOURCE_ID, {
      type: "geojson",
      data: measurementCollection(),
    });
  }
  if (!map.getLayer(MEASURE_LINE_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_LINE_LAYER_ID,
      type: "line",
      source: MEASURE_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#e25822",
        "line-width": 3,
        "line-dasharray": [2, 1],
      },
    });
  }
  if (!map.getLayer(MEASURE_POINT_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_POINT_LAYER_ID,
      type: "circle",
      source: MEASURE_SOURCE_ID,
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

function measurementCollection(): FeatureCollection {
  const points = [measurementStart, measurementEnd].filter(
    (point): point is LngLat => point !== null,
  );
  const lineEnd = measurementEnd ?? measurementPreview;
  const features: FeatureCollection["features"] = points.map((point) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
  }));

  if (measurementStart && lineEnd) {
    features.unshift({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [measurementStart.lng, measurementStart.lat],
          [lineEnd.lng, lineEnd.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function updateMeasurementData(): void {
  const source = map.getSource(MEASURE_SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData(measurementCollection());
}

function updateMeasurementTooltip(start: LngLat, end: LngLat): void {
  measureTooltipText.textContent = t("measure_distance", {
    distance: formatDistance(distanceInMetres(start, end)),
  });
}

function refreshMeasurementTooltip(): void {
  if (!measurementActive) return;
  const lineEnd = measurementEnd ?? measurementPreview;
  if (measurementStart && lineEnd) {
    updateMeasurementTooltip(measurementStart, lineEnd);
  } else {
    measureTooltipText.textContent = t(
      measurementStart ? "measure_choose_end" : "measure_choose_start",
    );
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

function formatDistance(metres: number): string {
  const locale = getLanguage();
  if (metres < 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(metres)} m`;
  }
  const kilometres = metres / 1000;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: kilometres < 10 ? 2 : 1,
    maximumFractionDigits: kilometres < 10 ? 2 : 1,
  }).format(kilometres)} km`;
}

function openSheet() {
  sheetBackdrop.hidden = false;
  layersSheet.hidden = false;
  layersSheet.removeAttribute("inert");
  requestAnimationFrame(() => {
    sheetBackdrop.classList.add("open");
    layersSheet.classList.add("open");
  });
  layersBtn.setAttribute("aria-expanded", "true");
}

function closeSheet() {
  sheetBackdrop.classList.remove("open");
  layersSheet.classList.remove("open");
  layersSheet.style.transform = "";
  layersSheet.setAttribute("inert", "");
  layersBtn.setAttribute("aria-expanded", "false");
  layersSheet.addEventListener(
    "transitionend",
    () => {
      sheetBackdrop.hidden = true;
      layersSheet.hidden = true;
    },
    { once: true },
  );
}

// --- Mobile Swipe Down Gesture for Layers Sheet --------------------

let sheetStartY = 0;
let sheetCurrentY = 0;
let sheetIsDragging = false;

layersSheet.addEventListener("touchstart", (e) => {
  const touch = e.touches[0];
  const target = e.target as HTMLElement;
  const isHandle =
    target.classList.contains("sheet-handle") ||
    target.closest(".sheet-handle");
  const isHeader =
    target.classList.contains("sheet-header") ||
    target.closest(".sheet-header");
  const contentEl = layersSheet.querySelector(".sheet-content") as HTMLElement;
  const isContentAtTop = contentEl ? contentEl.scrollTop === 0 : true;

  if (isHandle || isHeader || isContentAtTop) {
    sheetStartY = touch.clientY;
    sheetCurrentY = touch.clientY;
    sheetIsDragging = true;
    layersSheet.style.transition = "none";
  }
});

layersSheet.addEventListener(
  "touchmove",
  (e) => {
    if (!sheetIsDragging) return;
    const touch = e.touches[0];
    sheetCurrentY = touch.clientY;
    const deltaY = sheetCurrentY - sheetStartY;

    if (deltaY > 0) {
      // Stop mobile Chrome from interpreting the sheet drag as the
      // viewport's pull-to-refresh gesture.
      e.preventDefault();
      layersSheet.style.transform = `translateY(${deltaY}px)`;
    }
  },
  { passive: false },
);

layersSheet.addEventListener("touchend", () => {
  if (!sheetIsDragging) return;
  sheetIsDragging = false;
  layersSheet.style.transition = "";

  const deltaY = sheetCurrentY - sheetStartY;
  if (deltaY > 80) {
    closeSheet();
  } else {
    layersSheet.style.transform = "";
  }
  sheetStartY = 0;
  sheetCurrentY = 0;
});

function addFireLayer(map: MaplibreMap): void {
  map.addSource(FIRE_SOURCE_ID, { type: "geojson", data: emptyCollection() });

  map.addLayer({
    id: FIRE_FILL_LAYER,
    type: "fill",
    source: FIRE_SOURCE_ID,
    paint: { "fill-color": "#ff0000", "fill-opacity": 0.6 },
  });

  map.addLayer({
    id: FIRE_OUTLINE_LAYER,
    type: "line",
    source: FIRE_SOURCE_ID,
    paint: { "line-color": "#ff0000", "line-width": 1 },
  });
}

async function handleBasemapChange(kind: BasemapKind) {
  setMapLoading(true);
  setStatus(t("loading_style"));
  try {
    await setBasemap(map, kind, placeLabelsCheckbox.checked, getLanguage());
  } catch (err) {
    setMapLoading(false);
    console.warn("Failed to switch basemap:", err);
    setStatus(t("error_basemap"), "error");
    return;
  }

  currentBasemap = kind;
  for (const option of basemapOptions) {
    option.setAttribute(
      "aria-checked",
      String(option.dataset.basemap === kind),
    );
  }

  addFireLayer(map);
  addMeasurementLayers();
  updateMeasurementData();
  setPastFiresYear(map, Number(yearSelect.value));
  applyModeVisibility();
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked, getLanguage());
  loadFires();
  updateLegend();
}

function populateYearSelect() {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= EARLIEST_YEAR; year--) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  }
  // The current year's fires live under "Current fires"; default the picker
  // to the most recently *completed* year.
  yearSelect.value = String(currentYear - 1);
}

function setMode(next: Mode) {
  if (mode === next) return;
  mode = next;
  currentBtn.classList.toggle("active", mode === "current");
  currentBtn.setAttribute("aria-pressed", String(mode === "current"));
  pastBtn.classList.toggle("active", mode === "past");
  pastBtn.setAttribute("aria-pressed", String(mode === "past"));
  yearSelect.hidden = mode !== "past";
  layerToggle.hidden = mode !== "current";
  applyModeVisibility();
  loadFires();
  updateLegend();
}

function applyModeVisibility() {
  const burntAreasVisible = mode === "current" && burntAreasCheckbox.checked;
  for (const id of BURNT_AREAS_LAYER_IDS) {
    map.setLayoutProperty(
      id,
      "visibility",
      burntAreasVisible ? "visible" : "none",
    );
  }

  const activeFiresVisible = mode === "current" && activeFiresCheckbox.checked;
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    map.setLayoutProperty(
      id,
      "visibility",
      activeFiresVisible ? "visible" : "none",
    );
  }

  const pastVisibility = mode === "past" ? "visible" : "none";
  map.setLayoutProperty(FIRE_FILL_LAYER, "visibility", pastVisibility);
  map.setLayoutProperty(FIRE_OUTLINE_LAYER, "visibility", pastVisibility);

  const pastRasterVisible =
    mode === "past" && Number(yearSelect.value) >= EARLIEST_WMTS_YEAR;
  map.setLayoutProperty(
    PAST_FIRES_LAYER_ID,
    "visibility",
    pastRasterVisible ? "visible" : "none",
  );
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function setStatus(message: string, state?: "error") {
  statusEl.textContent = message;
  if (state) statusEl.dataset.state = state;
  else delete statusEl.dataset.state;
}

async function loadFires() {
  if (mode === "current") {
    setStatus(t("live_fires_status"));
    return;
  }

  const thisRequest = ++requestId;
  const source = map.getSource(FIRE_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;

  const year = yearSelect.value;
  setStatus(t("loading_year_fires", { year }));

  try {
    const data = await fetchHistoricalFires(Number(year));
    if (thisRequest !== requestId) return;

    source.setData(data);
    setStatus(describeResult(data.features.length, year));
  } catch (err) {
    if (thisRequest !== requestId) return;
    source.setData(emptyCollection());
    setStatus(
      err instanceof EffisError ? err.message : t("error_load_failed"),
      "error",
    );
  }
}

function describeResult(count: number, year: string): string {
  if (count === 0) return t("no_burnt_areas", { year });
  const key = count === 1 ? "fires_shown_singular" : "fires_shown_plural";
  return t(key, { count: count.toLocaleString() });
}

function showFirePopup(feature: MapGeoJSONFeature, lngLat: LngLat) {
  const date = getFireDateIso(feature) ?? t("unknown");
  const areaHa = getBurntAreaHa(feature);
  const country = getCountry(feature) ?? t("unknown");
  const province = getProvince(feature);

  const html = `
    <dl class="fire-popup">
      <dt>${t("popup_date")}</dt><dd>${date}</dd>
      <dt>${t("popup_burnt_area")}</dt><dd>${areaHa != null ? `${areaHa.toLocaleString()} ha` : t("unknown")}</dd>
      <dt>${t("popup_country")}</dt><dd>${country}${province ? `, ${province}` : ""}</dd>
    </dl>
  `;
  popup.setLngLat(lngLat).setHTML(html).addTo(map);
}

// --- Geocoder Search Logic -----------------------------------------

interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
}

let searchTimeoutId: number | null = null;
let currentResults: GeocodeResult[] = [];

searchInput.addEventListener("input", () => {
  if (searchTimeoutId) {
    clearTimeout(searchTimeoutId);
  }

  const query = searchInput.value.trim();
  if (query.length < 2) {
    searchResults.hidden = true;
    currentResults = [];
    return;
  }

  searchTimeoutId = window.setTimeout(async () => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
        {
          headers: {
            "User-Agent": "European-Forest-Fires-Map-App",
          },
        },
      );
      if (!response.ok) throw new Error("Search failed");
      const data = (await response.json()) as GeocodeResult[];
      currentResults = data;
      renderSearchResults(data);
    } catch (err) {
      console.warn("Geocoding search failed:", err);
    }
  }, 300);
});

function renderSearchResults(results: GeocodeResult[]) {
  searchResults.innerHTML = "";
  if (results.length === 0) {
    searchResults.hidden = true;
    return;
  }

  results.forEach((res) => {
    const li = document.createElement("li");
    li.textContent = res.display_name;
    li.addEventListener("click", () => {
      selectPlace(res);
    });
    searchResults.appendChild(li);
  });
  searchResults.hidden = false;
}

function selectPlace(place: GeocodeResult) {
  const lat = parseFloat(place.lat);
  const lon = parseFloat(place.lon);
  if (!isNaN(lat) && !isNaN(lon)) {
    map.flyTo({ center: [lon, lat], zoom: 10 });
    searchInput.value = place.display_name;
    searchResults.hidden = true;
    searchInput.blur();
    searchContainer.classList.remove("expanded");
  }
}

searchBtn.addEventListener("click", (e) => {
  const isMobile = window.innerWidth <= 768;
  if (isMobile && !searchContainer.classList.contains("expanded")) {
    e.stopPropagation();
    searchContainer.classList.add("expanded");
    searchInput.focus();
  } else {
    performInstantSearch();
  }
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    performInstantSearch();
  }
});

async function performInstantSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  if (currentResults.length > 0) {
    selectPlace(currentResults[0]);
    return;
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      {
        headers: {
          "User-Agent": "European-Forest-Fires-Map-App",
        },
      },
    );
    if (!response.ok) return;
    const data = (await response.json()) as GeocodeResult[];
    if (data.length > 0) {
      selectPlace(data[0]);
    }
  } catch (err) {
    console.warn("Instant search failed:", err);
  }
}

document.addEventListener("click", (e) => {
  if (!searchContainer.contains(e.target as Node)) {
    searchResults.hidden = true;
    searchContainer.classList.remove("expanded");
  }
});

// --- Language Switcher Logic ---------------------------------------

langBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !langMenu.hidden;
  langMenu.hidden = isOpen;
  langBtn.classList.toggle("active", !isOpen);
});

updateActiveLanguageOption();

for (const option of langOptions) {
  option.addEventListener("click", () => {
    const lang = option.dataset.lang as Language;
    if (lang !== getLanguage()) {
      setLanguage(lang);
      updateActiveLanguageOption();
      refreshMeasurementTooltip();
      refreshEffisWarningText();
      setPlaceLabelsLanguage(map, lang);
      loadFires();
      updateLegend();
    }
    langMenu.hidden = true;
    langBtn.classList.remove("active");
  });
}

function updateActiveLanguageOption() {
  const currentLang = getLanguage();
  for (const option of langOptions) {
    const isActive = option.dataset.lang === currentLang;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !langMenu.hidden) {
    langMenu.hidden = true;
    langBtn.classList.remove("active");
  }
});

document.addEventListener("click", (e) => {
  if (
    !langMenu.hidden &&
    !langBtn.contains(e.target as Node) &&
    !langMenu.contains(e.target as Node)
  ) {
    langMenu.hidden = true;
    langBtn.classList.remove("active");
  }
});

// --- About Modal Logic ---------------------------------------------

aboutBtn.addEventListener("click", () => {
  sheetBackdrop.hidden = false;
  aboutModal.hidden = false;
  aboutModal.removeAttribute("inert");
  requestAnimationFrame(() => {
    sheetBackdrop.classList.add("open");
    aboutModal.classList.add("open");
  });
});

function closeAboutModal() {
  sheetBackdrop.classList.remove("open");
  aboutModal.classList.remove("open");
  aboutModal.setAttribute("inert", "");
  aboutModal.addEventListener(
    "transitionend",
    () => {
      sheetBackdrop.hidden = true;
      aboutModal.hidden = true;
    },
    { once: true },
  );
}

aboutCloseBtn.addEventListener("click", closeAboutModal);

sheetBackdrop.addEventListener("click", () => {
  if (!aboutModal.hidden) {
    closeAboutModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !aboutModal.hidden) {
    closeAboutModal();
  }
});

// --- Legend Logic --------------------------------------------------

function updateLegend() {
  const isCurrentMode = mode === "current";
  const useCustomLegend = config.legendType === "custom";

  // 1. Active fires
  const activeFiresItem = document.getElementById("legend-item-active-fires");
  if (activeFiresItem) {
    activeFiresItem.style.display =
      isCurrentMode && activeFiresCheckbox.checked ? "flex" : "none";

    if (useCustomLegend) {
      // Use custom legend
      if (activeFiresImg) {
        activeFiresImg.style.display = "none";
      }
      if (activeFiresFallback) {
        activeFiresFallback.hidden = false;
        renderActiveFiresFallback();
      }
    } else {
      // Use WMS PNG
      if (activeFiresImg) {
        activeFiresImg.style.display = "";
      }
      if (activeFiresFallback) {
        activeFiresFallback.hidden = true;
      }
    }
  }

  // 2. Burnt areas / Past fires
  const burntAreasItem = document.getElementById("legend-item-burnt-areas");
  if (burntAreasItem) {
    if (useCustomLegend) {
      // Use custom legend
      if (burntAreasImg) {
        burntAreasImg.style.display = "none";
      }
      if (burntAreasFallback) {
        burntAreasFallback.hidden = false;
        renderBurntAreasFallback();
      }
    } else {
      // Use WMS PNG
      if (burntAreasImg) {
        burntAreasImg.style.display = "";
      }
      if (burntAreasFallback) {
        burntAreasFallback.hidden = true;
      }
    }

    if (isCurrentMode) {
      burntAreasItem.style.display = burntAreasCheckbox.checked
        ? "flex"
        : "none";
      const labelEl = document.getElementById("legend-title-burnt-areas");
      if (labelEl) {
        labelEl.setAttribute("data-i18n", "burnt_areas");
        labelEl.textContent = t("burnt_areas");
      }
      if (burntAreasImg && !useCustomLegend) {
        burntAreasImg.src =
          "/api/effis?service=WMS&request=GetLegendGraphic&layer=modis.ba.week&format=image/png";
      }
    } else {
      burntAreasItem.style.display = "flex";
      const labelEl = document.getElementById("legend-title-burnt-areas");
      if (labelEl) {
        labelEl.removeAttribute("data-i18n");
        labelEl.textContent = `${t("burnt_areas")} (${yearSelect.value})`;
      }
      if (burntAreasImg && !useCustomLegend) {
        burntAreasImg.src =
          "/api/effis?service=WMS&request=GetLegendGraphic&layer=ms:modis.ba.poly&format=image/png";
      }
    }
  }
}

legendBtn.addEventListener("click", () => {
  const isOpen = !legendCard.classList.contains("open");
  if (isOpen) {
    legendCard.hidden = false;
    updateLegend();
    requestAnimationFrame(() => {
      legendCard.classList.add("open");
    });
  } else {
    closeLegendCard();
  }
});

function closeLegendCard() {
  legendCard.classList.remove("open");
  legendCard.addEventListener(
    "transitionend",
    () => {
      legendCard.hidden = true;
    },
    { once: true },
  );
}

legendCloseBtn.addEventListener("click", closeLegendCard);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !legendCard.hidden) {
    closeLegendCard();
  }
});

// --- Fallback Legend Render Logic -----------------------------------

function renderActiveFiresFallback() {
  if (!activeFiresFallback) return;
  let html = `<div class="legend-fallback-section">`;
  legendConfig.activeFires.colors.forEach((item) => {
    html += `
      <div class="legend-fallback-row">
        <span class="legend-fallback-color" style="background-color: ${item.color};"></span>
        <span class="legend-fallback-label">${t(item.labelKey)}</span>
      </div>`;
  });
  html += `</div><div class="legend-fallback-section">`;
  legendConfig.activeFires.shapes.forEach((item) => {
    let shapeSvg = "";
    if (item.shape === "triangle") {
      shapeSvg = `<svg width="12" height="12" viewBox="0 0 24 24" class="legend-fallback-shape"><polygon points="12 2, 22 22, 2 22" fill="#fff" /></svg>`;
    } else {
      shapeSvg = `<svg width="12" height="12" viewBox="0 0 24 24" class="legend-fallback-shape"><circle cx="12" cy="12" r="10" fill="#fff" /></svg>`;
    }
    html += `
      <div class="legend-fallback-row">
        ${shapeSvg}
        <span class="legend-fallback-label">${item.label}</span>
      </div>`;
  });
  html += `</div>`;
  activeFiresFallback.innerHTML = html;
}

function renderBurntAreasFallback() {
  if (!burntAreasFallback) return;
  let html = `<div class="legend-fallback-section">`;
  legendConfig.burntAreas.colors.forEach((item) => {
    html += `
      <div class="legend-fallback-row">
        <span class="legend-fallback-swatch" style="background-color: ${item.color}; border: 1.5px solid ${item.borderColor};"></span>
        <span class="legend-fallback-label">${t(item.labelKey)}</span>
      </div>`;
  });
  html += `</div>`;
  burntAreasFallback.innerHTML = html;
}

if (activeFiresImg) {
  activeFiresImg.addEventListener("error", () => {
    if (activeFiresImg) activeFiresImg.style.display = "none";
    if (activeFiresFallback) {
      activeFiresFallback.hidden = false;
      renderActiveFiresFallback();
    }
  });
}

if (burntAreasImg) {
  burntAreasImg.addEventListener("error", () => {
    if (burntAreasImg) burntAreasImg.style.display = "none";
    if (burntAreasFallback) {
      burntAreasFallback.hidden = false;
      renderBurntAreasFallback();
    }
  });
}
