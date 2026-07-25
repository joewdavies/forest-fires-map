import { initTranslations, t } from "./i18n";
import "./style.css";
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

const FIRE_SOURCE_ID = "fires";
const FIRE_FILL_LAYER = "fires-fill";
const FIRE_OUTLINE_LAYER = "fires-outline";
const EARLIEST_YEAR = 2000;

type Mode = "current" | "past";

const mapContainer = document.getElementById("map") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const currentBtn = document.getElementById("mode-current") as HTMLButtonElement;
const pastBtn = document.getElementById("mode-past") as HTMLButtonElement;
const yearSelect = document.getElementById("year-select") as HTMLSelectElement;
const layerToggle = document.getElementById("layer-toggle") as HTMLElement;
const activeFiresCheckbox = document.getElementById("toggle-active-fires") as HTMLInputElement;
const burntAreasCheckbox = document.getElementById("toggle-burnt-areas") as HTMLInputElement;
const placeLabelsCheckbox = document.getElementById("toggle-place-labels") as HTMLInputElement;

const layersBtn = document.getElementById("layers-btn") as HTMLButtonElement;
const layersSheet = document.getElementById("layers-sheet") as HTMLElement;
const sheetCloseBtn = document.getElementById("sheet-close") as HTMLButtonElement;
const sheetBackdrop = document.getElementById("sheet-backdrop") as HTMLElement;
const basemapOptions = document.querySelectorAll(".basemap-option") as NodeListOf<HTMLButtonElement>;
const compassBtn = document.getElementById("compass-btn") as HTMLButtonElement;
const compassNeedle = document.getElementById("compass-needle") as SVGElement | null;

let mode: Mode = "current";
let requestId = 0;
let currentBasemap: BasemapKind = "plain";

populateYearSelect();

initTranslations();

const map = await createMap(mapContainer);
const popup = new Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });

map.on("load", () => {
  addFireLayer(map);

  map.on("mouseenter", FIRE_FILL_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", FIRE_FILL_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", FIRE_FILL_LAYER, (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (feature) showFirePopup(feature, e.lngLat);
  });

  setPastFiresYear(map, Number(yearSelect.value));
  applyModeVisibility();
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked);
  loadFires();
});

currentBtn.addEventListener("click", () => setMode("current"));
pastBtn.addEventListener("click", () => setMode("past"));
yearSelect.addEventListener("change", () => {
  if (mode === "past") loadFires();
});
activeFiresCheckbox.addEventListener("change", applyModeVisibility);
burntAreasCheckbox.addEventListener("change", applyModeVisibility);
placeLabelsCheckbox.addEventListener("change", () => setPlaceLabelsVisible(map, placeLabelsCheckbox.checked));

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
  setStatus(t("loading_style"));
  try {
    await setBasemap(map, kind, placeLabelsCheckbox.checked);
  } catch (err) {
    console.warn("Failed to switch basemap:", err);
    setStatus(t("error_basemap"), "error");
    return;
  }

  currentBasemap = kind;
  for (const option of basemapOptions) {
    option.setAttribute("aria-checked", String(option.dataset.basemap === kind));
  }

  addFireLayer(map);
  setPastFiresYear(map, Number(yearSelect.value));
  applyModeVisibility();
  setPlaceLabelsVisible(map, placeLabelsCheckbox.checked);
  loadFires();
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
}

function applyModeVisibility() {
  const burntAreasVisible = mode === "current" && burntAreasCheckbox.checked;
  for (const id of BURNT_AREAS_LAYER_IDS) {
    map.setLayoutProperty(id, "visibility", burntAreasVisible ? "visible" : "none");
  }

  const activeFiresVisible = mode === "current" && activeFiresCheckbox.checked;
  for (const id of ACTIVE_FIRES_LAYER_IDS) {
    map.setLayoutProperty(id, "visibility", activeFiresVisible ? "visible" : "none");
  }

  const pastVisibility = mode === "past" ? "visible" : "none";
  map.setLayoutProperty(FIRE_FILL_LAYER, "visibility", pastVisibility);
  map.setLayoutProperty(FIRE_OUTLINE_LAYER, "visibility", pastVisibility);

  const pastRasterVisible = mode === "past" && Number(yearSelect.value) >= EARLIEST_WMTS_YEAR;
  map.setLayoutProperty(PAST_FIRES_LAYER_ID, "visibility", pastRasterVisible ? "visible" : "none");
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
    setStatus(err instanceof EffisError ? err.message : t("error_load_failed"), "error");
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
