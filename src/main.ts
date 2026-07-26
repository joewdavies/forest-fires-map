import {
  initTranslations,
  t,
  getLanguage,
  setLanguage,
  type Language,
} from "./i18n";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import "./style.css";
import legendConfig from "./legend-config.json";
import config from "../config.json";
import {
  Popup,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLat,
  type Map as MaplibreMap,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  addEffisWmtsLayers,
  createMap,
  removeEffisWmtsLayers,
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
  tileTemplate,
  type WmtsLayerKind,
} from "./effis";
import {
  watchEffisHealth,
  type EffisHealth,
  type EffisHealthReport,
} from "./effisHealth";
import {
  fetchActiveFiresFallback,
  EUROPE_BBOX,
  FIRMS_ATTRIBUTION,
} from "./firms";

inject();
injectSpeedInsights();

const FIRE_SOURCE_ID = "fires";
const FIRE_FILL_LAYER = "fires-fill";
const FIRE_OUTLINE_LAYER = "fires-outline";
const MEASURE_SOURCE_ID = "distance-measurement";
const MEASURE_LINE_LAYER_ID = "distance-measurement-line";
const MEASURE_POINT_LAYER_ID = "distance-measurement-points";
const EARLIEST_YEAR = 2000;
const FIRMS_SOURCE_ID = "active-fires-firms";
const FIRMS_LAYER_ID = "active-fires-firms-circles";
const FIRMS_MODIS_LAYER_ID = "active-fires-firms-modis";
const FIRMS_MODIS_ICON_ID = "firms-modis-triangle";
// Smoothly scale FIRMS markers with zoom. Each pair is [zoom, radius in px];
// both VIIRS circles and MODIS triangles derive their size from these stops.
const FIRMS_POINT_RADIUS_STOPS = [
  [3, 2],
  [6, 3],
  [10, 5],
  [14, 8],
] as const;
const FIRMS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
// The rolling-window "down" threshold in effisHealth.ts (4 failures/20s) is
// tuned for detecting sustained degradation, and needs an actual error
// event to count anything — a request that just hangs forever without ever
// erroring wouldn't trip it for a long time, if ever. This is a separate,
// much blunter one-shot check specifically for a cold, silent start: if
// nothing at all has come back from EFFIS's WMTS mount within 5s of the
// page loading, don't wait around for the failure counter to catch up.
const INITIAL_LOAD_TIMEOUT_MS = 5_000;

// Linked from the word "EFFIS" in the health warning banner (see
// effis_status_slow/effis_status_down below) — deliberately a *direct*
// request to EFFIS's real upstream host, bypassing our own /api/wmts proxy
// entirely, so a user (or a developer debugging a report) can tell whether
// it's genuinely EFFIS that's struggling or just our proxy path, the same
// distinction CLAUDE.md's "Known unknowns" documents as otherwise only
// diagnosable by comparing a direct curl against the proxied request by
// hand. Not one of our own real tileTemplate() layers/tilematrixset —
// deliberately a plain, illustrative GetTile call so it means the same
// thing regardless of which of our layers is actually the one struggling.
const EFFIS_EXAMPLE_REQUEST_URL =
  "https://maps.effis.emergency.copernicus.eu/effist/wmts?layer=ghsl&tilematrixset=ECMWF3857&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=5&TileCol=17&TileRow=12";

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
const measureBtn = document.getElementById("measure-btn") as HTMLButtonElement;
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

const activeFiresSourceEffisBtn = document.getElementById(
  "active-fires-source-effis",
) as HTMLButtonElement;
const activeFiresSourceFirmsBtn = document.getElementById(
  "active-fires-source-firms",
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
let activeFiresProvider: "effis" | "firms" = "effis";
let firmsRefreshTimer: number | undefined;
let firmsRequestId = 0;

populateYearSelect();

initTranslations();

const map = await createMap(mapContainer, currentBasemap, getLanguage());
const popup = new Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "280px",
});

let loadingIndicatorHideTimer: number | undefined;
let loadingIndicatorSafetyTimer: number | undefined;
// MapLibre's 'idle' event can get stuck indefinitely once a raster tile
// source enters a sustained error/retry loop against a flaky backend —
// confirmed live: a repeatedly-erroring EFFIS WMTS tile source (see
// CLAUDE.md's "Known unknowns" on EFFIS's backend strain) can mean 'idle'
// never fires again for the rest of the session, since MapLibre keeps
// retrying the failing tile and re-entering a loading state faster than it
// ever lands on a clean "everything settled" snapshot. Without a ceiling,
// the indicator would then spin forever even though nothing is actually
// happening — same "don't trust EFFIS to behave, always have a timeout"
// principle already applied everywhere else EFFIS is involved (see
// REQUEST_TIMEOUT_MS in effis.ts and both api/*.ts proxies).
const MAX_LOADING_INDICATOR_MS = 15_000;

function setMapLoading(loading: boolean): void {
  window.clearTimeout(loadingIndicatorHideTimer);
  if (loading) {
    mapLoadingIndicator.classList.add("active");
    // Only arm the safety timer on the *first* 'dataloading' of a new
    // loading streak (guarded by the undefined check) — re-arming it on
    // every subsequent 'dataloading' would measure "time since the most
    // recent event" instead of "how long this streak has run", which is
    // exactly the retry-loop pattern this exists to catch: a source that
    // keeps re-entering 'dataloading' forever would just keep pushing the
    // ceiling back out and never actually hit it.
    if (loadingIndicatorSafetyTimer === undefined) {
      loadingIndicatorSafetyTimer = window.setTimeout(() => {
        loadingIndicatorSafetyTimer = undefined;
        mapLoadingIndicator.classList.remove("active");
      }, MAX_LOADING_INDICATOR_MS);
    }
    return;
  }

  window.clearTimeout(loadingIndicatorSafetyTimer);
  loadingIndicatorSafetyTimer = undefined;

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
  addFirmsActiveFiresLayer(map);
  addMeasurementLayers();
  watchEffisHealth(map, handleEffisHealthChange);
  watchWmtsActivity();

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

// EFFIS's name in the banner links out to a real, direct example request —
// see the comment on EFFIS_EXAMPLE_REQUEST_URL above. The translation
// strings carry {effisLinkOpen}/{effisLinkClose} placeholders (see i18n.ts)
// rather than raw HTML, so the anchor markup lives in one place instead of
// being duplicated across every language. Safe as innerHTML: both the
// message template and the injected link markup come from our own static
// sources, never from user input.
function effisWarningHtml(health: EffisHealth): string {
  return t(health === "down" ? "effis_status_down" : "effis_status_slow", {
    effisLinkOpen: `<a href="${EFFIS_EXAMPLE_REQUEST_URL}" target="_blank" rel="noopener noreferrer">`,
    effisLinkClose: "</a>",
  });
}

// Drives only the "EFFIS is slow/down" warning banner. Deliberately does
// *not* touch activeFiresProvider — the Active-fires source is decided once,
// at cold start (see watchWmtsActivity below), and afterward only changes via
// the manual EFFIS/FIRMS toggle. An earlier version re-ran this engage/
// disengage decision on every health report for the whole session, which
// meant a flapping EFFIS backend could flip the active layer back and forth
// automatically; the one-time cold-start check plus a plain manual toggle
// avoids that.
function handleEffisHealthChange(report: EffisHealthReport): void {
  currentEffisHealth = report.overall;
  if (report.overall === "ok") {
    dismissedEffisHealth = null;
    effisWarning.hidden = true;
  } else if (report.overall !== dismissedEffisHealth) {
    effisWarningText.innerHTML = effisWarningHtml(report.overall);
    effisWarning.hidden = false;
  }
}

effisWarningClose.addEventListener("click", () => {
  dismissedEffisHealth = currentEffisHealth;
  effisWarning.hidden = true;
});

function refreshEffisWarningText(): void {
  if (effisWarning.hidden) return;
  effisWarningText.innerHTML = effisWarningHtml(currentEffisHealth);
}

// --- NASA FIRMS fallback for Active fires ---------------------------
//
// EFFIS's own active-fire detection is itself built on NASA FIRMS (see
// docs/firms-migration-plan.md). EFFIS stays the default; FIRMS is only
// ever engaged automatically once, by the cold-start check in
// watchWmtsActivity below — after that, the provider only changes via the
// manual EFFIS/FIRMS toggle in the layers sheet. Only "Active fires" has a
// fallback at all — "Burnt areas" and "Past fires" have no FIRMS equivalent
// and are untouched by this.

async function engageFirmsFallback(): Promise<void> {
  activeFiresProvider = "firms";
  updateActiveFiresSourceUi();
  removeEffisWmtsLayers(map);
  applyModeVisibility();
  updateLegend();
  await refreshFirmsData();
  firmsRefreshTimer = window.setInterval(
    refreshFirmsData,
    FIRMS_REFRESH_INTERVAL_MS,
  );
}

function disengageFirmsFallback(): void {
  activeFiresProvider = "effis";
  updateActiveFiresSourceUi();
  window.clearInterval(firmsRefreshTimer);
  firmsRefreshTimer = undefined;
  ++firmsRequestId; // invalidate any in-flight refresh so a late response can't overwrite state after we've moved on
  (map.getSource(FIRMS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
    emptyCollection(),
  );
  addEffisWmtsLayers(map);
  setPastFiresYear(map, Number(yearSelect.value));
  applyModeVisibility();
  updateLegend();
}

async function refreshFirmsData(): Promise<void> {
  const thisRequest = ++firmsRequestId;
  const data = await fetchActiveFiresFallback(EUROPE_BBOX);
  if (thisRequest !== firmsRequestId) return; // stale-response guard, same pattern as loadFires()
  (map.getSource(FIRMS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);
}

function updateActiveFiresSourceUi(): void {
  const effisActive = activeFiresProvider === "effis";
  activeFiresSourceEffisBtn.classList.toggle("active", effisActive);
  activeFiresSourceEffisBtn.setAttribute("aria-pressed", String(effisActive));
  activeFiresSourceFirmsBtn.classList.toggle("active", !effisActive);
  activeFiresSourceFirmsBtn.setAttribute("aria-pressed", String(!effisActive));
}

function updateActiveFiresSourceControlState(): void {
  const enabled = mode === "current" && activeFiresCheckbox.checked;
  activeFiresSourceEffisBtn.disabled = !enabled;
  activeFiresSourceFirmsBtn.disabled = !enabled;
}

activeFiresSourceEffisBtn.addEventListener("click", () => {
  if (activeFiresProvider === "firms") disengageFirmsFallback();
});
activeFiresSourceFirmsBtn.addEventListener("click", () => {
  if (activeFiresProvider === "effis") engageFirmsFallback();
});

const WMTS_PROBE_LAYERS: readonly WmtsLayerKind[] = [
  "burnt-areas-modis",
  "burnt-areas-nrt",
  "active-fires-modis",
  "active-fires-viirs",
  "active-fires-s3",
];

// Probe one representative Spain tile from every current-fire product.
// Failed responses keep the five-second observation window open; the first
// HTTP-successful response proves WMTS is available and cancels the rest.
function watchWmtsActivity(): void {
  const controller = new AbortController();
  let settled = false;

  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    controller.abort();
    if (activeFiresProvider === "effis") void engageFirmsFallback();
  }, INITIAL_LOAD_TIMEOUT_MS);

  for (const kind of WMTS_PROBE_LAYERS) {
    const url = tileTemplate(kind)
      .replace("{z}", "5")
      .replace("{x}", "15")
      .replace("{y}", "11");
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (settled || !response.ok) return;
        settled = true;
        window.clearTimeout(timeoutId);
        controller.abort();
      })
      .catch(() => {
        // A failed probe is expected during an outage. Keep waiting for
        // another layer to succeed or for the shared five-second deadline.
      });
  }
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
        "circle-radius": 4,
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

/** The NASA FIRMS fallback layer for "Active fires" — see the "NASA FIRMS
 * fallback" section above for when this actually gets populated/shown.
 * Seeded empty here, same as addFireLayer's FIRE_SOURCE_ID, relying on a
 * later fetch (refreshFirmsData) to populate it rather than a cached
 * variable — consistent with how past-fires WFS data is handled. */
function addFirmsActiveFiresLayer(map: MaplibreMap): void {
  map.addSource(FIRMS_SOURCE_ID, {
    type: "geojson",
    data: emptyCollection(),
    attribution: FIRMS_ATTRIBUTION,
  });

  // VIIRS -> circles, MODIS -> triangles — the same shape-per-sensor split
  // EFFIS's own legend depicts (legend-config.json's activeFires.shapes),
  // now that each feature carries a `source` property to split on (see
  // firms.ts's rowsToFeatures; "MODIS_NRT" is MODIS, everything else is one
  // of the three VIIRS sources).
  map.addLayer({
    id: FIRMS_LAYER_ID,
    type: "circle",
    source: FIRMS_SOURCE_ID,
    filter: ["!=", ["get", "source"], "MODIS_NRT"],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": firmsPointRadiusExpression(),
      "circle-color": recencyColorExpression(),
      "circle-opacity": 0.9,
    },
  });

  ensureFirmsModisIcon(map);
  map.addLayer({
    id: FIRMS_MODIS_LAYER_ID,
    type: "symbol",
    source: FIRMS_SOURCE_ID,
    filter: ["==", ["get", "source"], "MODIS_NRT"],
    layout: {
      visibility: "none",
      "icon-image": FIRMS_MODIS_ICON_ID,
      "icon-size": firmsIconSizeExpression(),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": recencyColorExpression(),
      "icon-opacity": 0.9,
    },
  });
}

/** Draws a small filled triangle and registers it as an SDF icon so the
 * MODIS points layer can recolor it per-feature via icon-color, the same
 * way the VIIRS circle layer recolors via circle-color — MapLibre only
 * supports that for images registered with sdf: true. Re-run on every
 * basemap switch via addFirmsActiveFiresLayer, since setStyle() drops
 * registered images along with every other custom source/layer/image. */
function ensureFirmsModisIcon(map: MaplibreMap): void {
  if (map.hasImage(FIRMS_MODIS_ICON_ID)) return;
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(size / 2, 1);
  ctx.lineTo(size - 1, size - 1);
  ctx.lineTo(1, size - 1);
  ctx.closePath();
  ctx.fill();
  map.addImage(FIRMS_MODIS_ICON_ID, ctx.getImageData(0, 0, size, size), {
    sdf: true,
  });
}

/** Colors each FIRMS point by the same recency-tier scheme legend-config.json
 * already defines for the "Active fires" legend (see recencyTierFor in
 * firms.ts) — reusing legendConfig.activeFires.colors directly means the
 * legend swatches and the real map styling can never drift out of sync. */
function recencyColorExpression(): ExpressionSpecification {
  const stops = legendConfig.activeFires.colors.flatMap((c) => [
    c.labelKey,
    c.color,
  ]);
  return [
    "match",
    ["get", "recencyTier"],
    ...stops,
    "#999999",
  ] as unknown as ExpressionSpecification;
}

function firmsPointRadiusExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...FIRMS_POINT_RADIUS_STOPS.flat(),
  ] as ExpressionSpecification;
}

function firmsIconSizeExpression(): ExpressionSpecification {
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

async function handleBasemapChange(kind: BasemapKind) {
  setMapLoading(true);
  setStatus(t("loading_style"));
  try {
    await setBasemap(
      map,
      kind,
      placeLabelsCheckbox.checked,
      getLanguage(),
      activeFiresProvider === "effis",
    );
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
  addFirmsActiveFiresLayer(map);
  addMeasurementLayers();
  updateMeasurementData();
  setPastFiresYear(map, Number(yearSelect.value));
  applyModeVisibility();
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked, getLanguage());
  loadFires();
  // setStyle() drops every custom source/layer, including FIRMS's — the
  // freshly re-added source above starts empty and needs repopulating,
  // same as "fires" does via the loadFires() call just above.
  if (activeFiresProvider === "firms") refreshFirmsData();
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
    if (map.getLayer(id)) {
      map.setLayoutProperty(
        id,
        "visibility",
        burntAreasVisible ? "visible" : "none",
      );
    }
  }

  const activeFiresVisible = mode === "current" && activeFiresCheckbox.checked;
  const showEffisActiveFires =
    activeFiresVisible && activeFiresProvider === "effis";
  const showFirmsActiveFires =
    activeFiresVisible && activeFiresProvider === "firms";
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(
        id,
        "visibility",
        showEffisActiveFires ? "visible" : "none",
      );
    }
  }
  map.setLayoutProperty(
    FIRMS_LAYER_ID,
    "visibility",
    showFirmsActiveFires ? "visible" : "none",
  );
  map.setLayoutProperty(
    FIRMS_MODIS_LAYER_ID,
    "visibility",
    showFirmsActiveFires ? "visible" : "none",
  );
  updateActiveFiresSourceControlState();

  const pastVisibility = mode === "past" ? "visible" : "none";
  map.setLayoutProperty(FIRE_FILL_LAYER, "visibility", pastVisibility);
  map.setLayoutProperty(FIRE_OUTLINE_LAYER, "visibility", pastVisibility);

  const pastRasterVisible =
    mode === "past" && Number(yearSelect.value) >= EARLIEST_WMTS_YEAR;
  if (map.getLayer(PAST_FIRES_LAYER_ID)) {
    map.setLayoutProperty(
      PAST_FIRES_LAYER_ID,
      "visibility",
      pastRasterVisible ? "visible" : "none",
    );
  }
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
      // Use WMS PNG — src is only ever assigned here, never in the HTML
      // itself: an <img src="..."> attribute is fetched by the browser the
      // moment it's parsed, regardless of any JS/config check afterward, so
      // a static src would hit EFFIS's legend endpoint unconditionally even
      // when useCustomLegend is true and the image is never shown at all.
      if (activeFiresImg) {
        activeFiresImg.style.display = "";
        activeFiresImg.src =
          "/api/effis?service=WMS&request=GetLegendGraphic&layer=modis.hs.week&format=image/png";
      }
      if (activeFiresFallback) {
        activeFiresFallback.hidden = true;
      }
    }

    const providerNote = document.getElementById(
      "legend-active-fires-provider",
    );
    if (providerNote) providerNote.hidden = activeFiresProvider !== "firms";
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
    // FIRMS has no Sentinel-3 equivalent (see the "NASA FIRMS fallback"
    // section in CLAUDE.md), so its VIIRS row drops the "/ SENTINEL3" half
    // of the label that's accurate for EFFIS's own three-source coverage.
    const label =
      activeFiresProvider === "firms" ? item.firmsLabel : item.label;
    html += `
      <div class="legend-fallback-row">
        ${shapeSvg}
        <span class="legend-fallback-label">${label}</span>
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
