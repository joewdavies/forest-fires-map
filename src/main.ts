import "./style.css";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { createMap } from "./map";
import {
  EffisError,
  fetchCurrentFires,
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

let mode: Mode = "current";
let requestId = 0;

populateYearSelect();

const map = createMap(mapContainer);
const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });

map.on("load", () => {
  map.addSource(FIRE_SOURCE_ID, { type: "geojson", data: emptyCollection() });

  map.addLayer({
    id: FIRE_FILL_LAYER,
    type: "fill",
    source: FIRE_SOURCE_ID,
    paint: { "fill-color": "#e25822", "fill-opacity": 0.55 },
  });

  map.addLayer({
    id: FIRE_OUTLINE_LAYER,
    type: "line",
    source: FIRE_SOURCE_ID,
    paint: { "line-color": "#ff3d00", "line-width": 1 },
  });

  map.on("mouseenter", FIRE_FILL_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", FIRE_FILL_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", FIRE_FILL_LAYER, (e) => {
    const feature = e.features?.[0];
    if (feature) showFirePopup(feature, e.lngLat);
  });

  loadFires();
});

currentBtn.addEventListener("click", () => setMode("current"));
pastBtn.addEventListener("click", () => setMode("past"));
yearSelect.addEventListener("change", () => {
  if (mode === "past") loadFires();
});

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
  loadFires();
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
  const thisRequest = ++requestId;
  const source = map.getSource(FIRE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;

  const year = yearSelect.value;
  setStatus(mode === "current" ? "Loading current fires…" : `Loading ${year} fires…`);

  try {
    const data = mode === "current" ? await fetchCurrentFires() : await fetchHistoricalFires(Number(year));
    if (thisRequest !== requestId) return; // superseded by a newer request

    source.setData(data);
    setStatus(describeResult(data.features.length, year));
  } catch (err) {
    if (thisRequest !== requestId) return;
    source.setData(emptyCollection());
    setStatus(err instanceof EffisError ? err.message : "Failed to load fire data.", "error");
  }
}

function describeResult(count: number, year: string): string {
  if (count === 0) {
    return mode === "current"
      ? "No active fire perimeters reported in the last 30 days."
      : `No burnt areas recorded for ${year}.`;
  }
  return `${count.toLocaleString()} fire${count === 1 ? "" : "s"} shown.`;
}

function showFirePopup(feature: maplibregl.MapGeoJSONFeature, lngLat: maplibregl.LngLat) {
  const date = getFireDateIso(feature) ?? "Unknown";
  const areaHa = getBurntAreaHa(feature);
  const country = getCountry(feature) ?? "Unknown";
  const province = getProvince(feature);

  const html = `
    <dl class="fire-popup">
      <dt>Date</dt><dd>${date}</dd>
      <dt>Burnt area</dt><dd>${areaHa != null ? `${areaHa.toLocaleString()} ha` : "Unknown"}</dd>
      <dt>Country</dt><dd>${country}${province ? `, ${province}` : ""}</dd>
    </dl>
  `;
  popup.setLngLat(lngLat).setHTML(html).addTo(map);
}
