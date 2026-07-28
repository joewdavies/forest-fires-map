import {
  initTranslations,
  t,
  getLanguage,
  setLanguage,
} from "./i18n";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import "./style.css";
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
  addActiveFiresLayers,
  createMap,
  removeActiveFiresLayers,
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
} from "./firms";
import {
  installAppLifecycle,
  loadPersistedAppState,
  restoreMapCamera,
  type PersistedAppState,
} from "./core/lifecycle/appLifecycle";
import { createBackgroundWorkController } from "./core/lifecycle/backgroundWork";
import {
  installDevelopmentPerformanceTelemetry,
  logFirmsFeatureCounts,
} from "./core/telemetry/performanceTelemetry";
import {
  addFirmsActiveFiresLayer,
  FIRMS_GLOW_LAYER_ID,
  FIRMS_LAYER_ID,
  FIRMS_MODIS_LAYER_ID,
  FIRMS_SOURCE_ID,
} from "./map/layers/firmsActiveFires";
import { installLayersSheet } from "./ui/layersSheet";
import { installPlaceSearch } from "./features/search/placeSearch";
import { createMeasurementTool } from "./features/measurement/measurementTool";
import { createLegendController } from "./features/legend/legendController";
import { installLanguageSwitcher } from "./ui/languageSwitcher";
import { installAboutModal } from "./ui/aboutModal";

inject();
injectSpeedInsights();

const restoredSession = loadPersistedAppState();
const FIRE_SOURCE_ID = "fires";
const FIRE_FILL_LAYER = "fires-fill";
const FIRE_OUTLINE_LAYER = "fires-outline";
const EARLIEST_YEAR = 2000;
const FIRMS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
// The rolling-window "down" threshold in effisHealth.ts (4 failures/20s) is
// tuned for detecting sustained degradation, and needs an actual error
// event to count anything — a request that just hangs forever without ever
// erroring wouldn't trip it for a long time, if ever. This is a separate,
// much blunter one-shot check specifically for a cold, silent start: if
// nothing at all has come back from EFFIS's WMTS mount within 4s of the
// page loading, don't wait around for the failure counter to catch up.
const INITIAL_LOAD_TIMEOUT_MS = 10_000;

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

let currentDaysRange = restoredSession?.daysRange ?? 7;
const currentRangeToggle = document.getElementById(
  "current-range-toggle",
) as HTMLElement;
const currentRangeBtns = currentRangeToggle.querySelectorAll(
  "button",
) as NodeListOf<HTMLButtonElement>;

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
const providerFallbackStatus = document.getElementById(
  "provider-fallback-status",
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

let mode: Mode = restoredSession?.mode ?? "current";
let requestId = 0;
let currentBasemap: BasemapKind =
  restoredSession?.basemap ??
  (config.defaultBasemap as BasemapKind) ??
  "plain";
let currentEffisHealth: EffisHealth = "ok";
let dismissedEffisHealth: EffisHealth | null = null;
let activeFiresProvider: "effis" | "firms" = "effis";
let firmsRequestId = 0;
let stopAppLifecycle: (() => void) | undefined;

populateYearSelect();
restorePersistedControls();

if (restoredSession) setLanguage(restoredSession.language);
else initTranslations();

const map = await createMap(mapContainer, currentBasemap, getLanguage());
map.once("load", () => restoreMapCamera(map, restoredSession));
installDevelopmentPerformanceTelemetry(map);
const backgroundWork = createBackgroundWorkController({
  firmsRefreshIntervalMs: FIRMS_REFRESH_INTERVAL_MS,
  isFirmsActive: () => activeFiresProvider === "firms",
  refreshFirmsData,
  watchEffisHealth: () => watchEffisHealth(map, handleEffisHealthChange),
});
const popup = new Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "280px",
});
const measurementTool = createMeasurementTool({
  map,
  elements: {
    mapContainer,
    button: measureBtn,
    closeButton: measureCloseBtn,
    tooltip: measureTooltip,
    tooltipText: measureTooltipText,
  },
  translate: t,
  getLocale: getLanguage,
  closePopup: () => popup.remove(),
});
const legendController = createLegendController({
  map,
  elements: {
    button: legendBtn,
    card: legendCard,
    closeButton: legendCloseBtn,
    mapContainer,
    loadingIndicator: mapLoadingIndicator,
  },
  useCustomLegend: config.legendType === "custom",
  getState: () => ({
    mode,
    year: yearSelect.value,
    daysRange: currentDaysRange,
    activeFiresVisible: activeFiresCheckbox.checked,
    burntAreasVisible: burntAreasCheckbox.checked,
    activeFiresProvider,
  }),
  translate: t,
});
installLanguageSwitcher(
  { button: langBtn, menu: langMenu, options: langOptions },
  (language) => {
    measurementTool.refreshTooltip();
    refreshEffisWarningText();
    setPlaceLabelsLanguage(map, language);
    loadFires();
    updateLegend();
  },
);
installAboutModal({
  button: aboutBtn,
  modal: aboutModal,
  closeButton: aboutCloseBtn,
  backdrop: sheetBackdrop,
});
installLayersSheet({
  trigger: layersBtn,
  sheet: layersSheet,
  closeButton: sheetCloseBtn,
  backdrop: sheetBackdrop,
});
installPlaceSearch(map, {
  container: searchContainer,
  input: searchInput,
  button: searchBtn,
  results: searchResults,
});

let loadingIndicatorHideTimer: number | undefined;
let loadingIndicatorSafetyTimer: number | undefined;
let fireFetchesInFlight = 0;
const loadingWmtsSources = new Set<string>();
const EFFIS_WMTS_SOURCE_IDS = new Set<string>([
  ...ACTIVE_FIRES_LAYER_IDS,
  ...BURNT_AREAS_LAYER_IDS,
  PAST_FIRES_LAYER_ID,
]);
// EFFIS raster sources can enter a sustained error/retry loop, so even this
// fire-data-only indicator needs a hard ceiling rather than trusting every
// source to eventually emit a clean completion event.
const MAX_LOADING_INDICATOR_MS = 15_000;

function setMapLoading(loading: boolean): void {
  window.clearTimeout(loadingIndicatorHideTimer);
  if (loading) {
    // The provider-handoff popup has its own inline spinner. Suppress the
    // larger centered spinner while that message is visible so the two
    // indicators never overlap.
    if (!providerFallbackStatus.hidden) {
      window.clearTimeout(loadingIndicatorSafetyTimer);
      loadingIndicatorSafetyTimer = undefined;
      mapLoadingIndicator.classList.remove("active");
      return;
    }
    mapLoadingIndicator.classList.add("active");
    // Only arm the safety timer on the first event in a loading streak.
    // Re-arming it for every retry would keep pushing the ceiling back.
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

  // A short delay prevents flashing between adjacent fire-tile requests.
  loadingIndicatorHideTimer = window.setTimeout(() => {
    mapLoadingIndicator.classList.remove("active");
  }, 150);
}

function updateFireLoadingIndicator(): void {
  setMapLoading(fireFetchesInFlight > 0 || loadingWmtsSources.size > 0);
}

function beginFireFetch(): void {
  ++fireFetchesInFlight;
  updateFireLoadingIndicator();
}

function endFireFetch(): void {
  fireFetchesInFlight = Math.max(0, fireFetchesInFlight - 1);
  updateFireLoadingIndicator();
}

map.on("dataloading", (event) => {
  if (event.dataType !== "source") return;
  if (event.sourceId && EFFIS_WMTS_SOURCE_IDS.has(event.sourceId)) {
    loadingWmtsSources.add(event.sourceId);
    updateFireLoadingIndicator();
  }
});
map.on("sourcedata", (event) => {
  if (
    event.sourceId &&
    EFFIS_WMTS_SOURCE_IDS.has(event.sourceId) &&
    (event.isSourceLoaded ||
      (map.getSource(event.sourceId) && map.isSourceLoaded(event.sourceId)))
  ) {
    loadingWmtsSources.delete(event.sourceId);
    updateFireLoadingIndicator();
  }
});
map.on("error", (event) => {
  const sourceId = (event as typeof event & { sourceId?: string }).sourceId;
  if (sourceId && EFFIS_WMTS_SOURCE_IDS.has(sourceId)) {
    loadingWmtsSources.delete(sourceId);
    updateFireLoadingIndicator();
  }
});

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
  measurementTool.addLayers();
  backgroundWork.start();
  watchWmtsActivity();
  stopAppLifecycle ??= installAppLifecycle({
    map,
    captureState: capturePersistedState,
    pauseBackgroundWork: backgroundWork.pause,
    resumeBackgroundWork: backgroundWork.resume,
    reapplyMapState: reapplyLifecycleMapState,
    onWebglRecoveryChange: (recovering) => {
      if (recovering) setMapLoading(true);
      else updateFireLoadingIndicator();
    },
  });

  map.on("mouseenter", FIRE_FILL_LAYER, () => {
    if (!measurementTool.isActive()) map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", FIRE_FILL_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", FIRE_FILL_LAYER, (e: MapLayerMouseEvent) => {
    if (measurementTool.isActive()) return;
    const feature = e.features?.[0];
    if (feature) showFirePopup(feature, e.lngLat);
  });

  setPastFiresYear(map, Number(yearSelect.value));
  updateCurrentFiresDayRange(currentDaysRange);
  applyModeVisibility();
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked, getLanguage());
  loadFires();
  updateLegend();
});

currentBtn.addEventListener("click", () => setMode("current"));
pastBtn.addEventListener("click", () => setMode("past"));
yearSelect.addEventListener("change", () => {
  if (mode === "past") {
    setPastFiresYear(map, Number(yearSelect.value));
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

currentRangeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const days = Number(btn.dataset.days);
    if (days === currentDaysRange) return;

    currentDaysRange = days;

    // Update active state in UI
    currentRangeBtns.forEach((b) => {
      const active = Number(b.dataset.days) === currentDaysRange;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });

    // Update map layer tiles
    updateCurrentFiresDayRange(currentDaysRange);

    // If provider is firms, trigger data refresh
    if (activeFiresProvider === "firms") {
      void refreshFirmsData();
    }

    // Legend might need updating
    updateLegend();
  });
});

function updateCurrentFiresDayRange(days: number): void {
  // Update Burnt Areas
  for (const id of BURNT_AREAS_LAYER_IDS) {
    const source = map.getSource(id) as any;
    if (source && typeof source.setTiles === "function") {
      source.setTiles([tileTemplate(id, days)]);
    }
  }
  // Update Active Fires
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    const source = map.getSource(id) as any;
    if (source && typeof source.setTiles === "function") {
      source.setTiles([tileTemplate(id, days)]);
    }
  }
}

const activeFiresSourceInfoBtn = document.querySelector(
  ".info-btn",
) as HTMLButtonElement | null;
if (activeFiresSourceInfoBtn) {
  activeFiresSourceInfoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = activeFiresSourceInfoBtn.getAttribute("aria-label");
    if (text) {
      alert(text);
    }
  });
}

compassBtn.addEventListener("click", () => {
  map.resetNorthPitch();
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

async function engageFirmsFallback(showStartupStatus = false): Promise<void> {
  activeFiresProvider = "firms";
  updateActiveFiresSourceUi();
  removeActiveFiresLayers(map);
  // Only the active-fires sources are gone — Burnt areas / Past fires keep
  // running on EFFIS, so a real in-flight load for either shouldn't be
  // wiped from the tracker just because Active fires switched providers.
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    loadingWmtsSources.delete(id);
  }
  updateFireLoadingIndicator();
  applyModeVisibility();
  updateLegend();
  if (showStartupStatus) providerFallbackStatus.hidden = false;
  try {
    await refreshFirmsData();
    backgroundWork.syncFirmsPolling();
  } finally {
    providerFallbackStatus.hidden = true;
  }
}

function disengageFirmsFallback(): void {
  activeFiresProvider = "effis";
  updateActiveFiresSourceUi();
  backgroundWork.syncFirmsPolling();
  ++firmsRequestId; // invalidate any in-flight refresh so a late response can't overwrite state after we've moved on
  (map.getSource(FIRMS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
    emptyCollection(),
  );
  addActiveFiresLayers(map);
  applyModeVisibility();
  updateLegend();
}

async function refreshFirmsData(): Promise<void> {
  const thisRequest = ++firmsRequestId;
  beginFireFetch();
  try {
    const data = await fetchActiveFiresFallback(EUROPE_BBOX, currentDaysRange);
    if (thisRequest !== firmsRequestId) return; // stale-response guard, same pattern as loadFires()
    logFirmsFeatureCounts(data, currentDaysRange);
    (map.getSource(FIRMS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
      data,
    );
    backgroundWork.recordFirmsRefresh();
  } finally {
    endFireFetch();
  }
}

function reapplyLifecycleMapState(): void {
  if (!map.isStyleLoaded()) {
    map.once("styledata", reapplyLifecycleMapState);
    return;
  }
  applyModeVisibility();
  setPastFiresYear(map, Number(yearSelect.value));
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked, getLanguage());
  updateLegend();
}

function capturePersistedState(): PersistedAppState {
  const center = map.getCenter();
  return {
    savedAt: Date.now(),
    camera: {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    },
    mode,
    year: yearSelect.value,
    daysRange: currentDaysRange,
    basemap: currentBasemap,
    language: getLanguage(),
    activeFiresVisible: activeFiresCheckbox.checked,
    burntAreasVisible: burntAreasCheckbox.checked,
    placeLabelsVisible: placeLabelsCheckbox.checked,
  };
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
// Failed responses keep the four-second observation window open; the first
// HTTP-successful response proves WMTS is available and cancels the rest.
function watchWmtsActivity(): void {
  const controller = new AbortController();
  let settled = false;

  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    controller.abort();
    if (activeFiresProvider === "effis") void engageFirmsFallback(true);
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

function addFireLayer(map: MaplibreMap): void {
  map.addSource(FIRE_SOURCE_ID, { type: "geojson", data: emptyCollection() });

  const firstSymbolLayer = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol");

  map.addLayer(
    {
      id: FIRE_FILL_LAYER,
      type: "fill",
      source: FIRE_SOURCE_ID,
      paint: { "fill-color": "#ff0000", "fill-opacity": 0.6 },
    },
    firstSymbolLayer?.id,
  );

  map.addLayer(
    {
      id: FIRE_OUTLINE_LAYER,
      type: "line",
      source: FIRE_SOURCE_ID,
      paint: { "line-color": "#ff0000", "line-width": 1 },
    },
    firstSymbolLayer?.id,
  );
}

/** The NASA FIRMS fallback layer for "Active fires" — see the "NASA FIRMS
 * fallback" section above for when this actually gets populated/shown.
 * Seeded empty here, same as addFireLayer's FIRE_SOURCE_ID, relying on a
 * later fetch (refreshFirmsData) to populate it rather than a cached
 * variable — consistent with how past-fires WFS data is handled. */
async function handleBasemapChange(kind: BasemapKind) {
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
  measurementTool.addLayers();
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

function restorePersistedControls(): void {
  if (restoredSession) {
    activeFiresCheckbox.checked = restoredSession.activeFiresVisible;
    burntAreasCheckbox.checked = restoredSession.burntAreasVisible;
    placeLabelsCheckbox.checked = restoredSession.placeLabelsVisible;
    if (
      Array.from(yearSelect.options).some(
        (option) => option.value === restoredSession.year,
      )
    ) {
      yearSelect.value = restoredSession.year;
    }
  }

  for (const button of currentRangeBtns) {
    const active = Number(button.dataset.days) === currentDaysRange;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  syncModeControls();
}

function setMode(next: Mode) {
  if (mode === next) return;
  mode = next;
  syncModeControls();
  applyModeVisibility();
  loadFires();
  updateLegend();
}

function syncModeControls(): void {
  currentBtn.classList.toggle("active", mode === "current");
  currentBtn.setAttribute("aria-pressed", String(mode === "current"));
  pastBtn.classList.toggle("active", mode === "past");
  pastBtn.setAttribute("aria-pressed", String(mode === "past"));
  yearSelect.hidden = mode !== "past";
  layerToggle.hidden = mode !== "current";
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
    FIRMS_GLOW_LAYER_ID,
    "visibility",
    showFirmsActiveFires ? "visible" : "none",
  );
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
    ++requestId;
    setStatus(t("live_fires_status"));
    return;
  }

  const thisRequest = ++requestId;
  const source = map.getSource(FIRE_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;

  const year = yearSelect.value;
  beginFireFetch();
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
  } finally {
    endFireFetch();
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

function updateLegend() {
  legendController.update();
}
