import type { Map as MaplibreMap } from "maplibre-gl";
import legendConfig from "../../legend-config.json";
import { BURNT_AREAS_LAYER_IDS } from "../../map";

interface LegendState {
  mode: "current" | "past";
  year: string;
  daysRange: number;
  activeFiresVisible: boolean;
  burntAreasVisible: boolean;
  activeFiresProvider: "effis" | "firms";
}

interface LegendElements {
  button: HTMLButtonElement;
  card: HTMLElement;
  closeButton: HTMLButtonElement;
  mapContainer: HTMLElement;
  loadingIndicator: HTMLElement;
}

interface LegendOptions {
  map: MaplibreMap;
  elements: LegendElements;
  useCustomLegend: boolean;
  getState: () => LegendState;
  translate: (key: string) => string;
}

export interface LegendController {
  update: () => void;
}

const CLEARANCE_GAP_PX = 16;

export function createLegendController(
  options: LegendOptions,
): LegendController {
  const { elements, getState, translate } = options;
  const mobileMedia = window.matchMedia("(max-width: 768px)");
  const activeImage = byId<HTMLImageElement>("legend-img-active-fires");
  const activeFallback = byId("legend-fallback-active-fires");
  const activeShapes = byId("legend-item-active-fires-shapes");
  const burntImage = byId<HTMLImageElement>("legend-img-burnt-areas");
  const burntFallback = byId("legend-fallback-burnt-areas");

  const renderActiveColors = (): void => {
    if (!activeFallback) return;
    const { daysRange } = getState();
    let html = `
      <div class="legend-fallback-section legend-fallback-section-colors">
        <h5 class="legend-fallback-heading">${translate("legend_age")}</h5>`;
    for (const item of legendConfig.activeFires.colors) {
      if (item.labelKey === "legend_last_7_days") {
        if (daysRange === 1) continue;
        const key =
          daysRange === 30 ? "legend_last_30_days" : "legend_last_7_days";
        html += colorRow(item.color, translate(key));
      } else {
        html += colorRow(item.color, translate(item.labelKey));
      }
    }
    activeFallback.innerHTML = `${html}</div>`;
  };

  const renderActiveShapes = (): void => {
    if (!activeShapes) return;
    const { activeFiresProvider } = getState();
    const rows = legendConfig.activeFires.shapes
      .map((item) => {
        const svg =
          item.shape === "triangle"
            ? '<svg width="12" height="12" viewBox="0 0 24 24" class="legend-fallback-shape" aria-hidden="true" focusable="false"><polygon points="12 2, 22 22, 2 22" fill="#fff" /></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" class="legend-fallback-shape" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="#fff" /></svg>';
        const label =
          activeFiresProvider === "firms" ? item.firmsLabel : item.label;
        return `<div class="legend-fallback-row">${svg}<span class="legend-fallback-label">${label}</span></div>`;
      })
      .join("");
    activeShapes.innerHTML = `
      <div class="legend-fallback-section legend-fallback-section-shapes">
        <h5 class="legend-fallback-heading">${translate("legend_satellite")}</h5>
        <div class="legend-fallback-shapes-row">${rows}</div>
      </div>`;
  };

  const renderBurntAreas = (): void => {
    if (!burntFallback) return;
    const { mode, daysRange } = getState();
    const colors =
      mode === "past"
        ? legendConfig.pastFires.colors
        : legendConfig.burntAreas.colors;
    const rows = colors
      .filter(
        (item) =>
          mode === "past" ||
          (item.labelKey !== "legend_last_7_days" || daysRange >= 7) &&
            (item.labelKey !== "legend_last_30_days" || daysRange >= 30),
      )
      .map(
        (item) => `
          <div class="legend-fallback-row">
            <span class="legend-fallback-swatch" style="background-color: ${item.color}; border: 1.5px solid ${item.borderColor};"></span>
            <span class="legend-fallback-label">${translate(item.labelKey)}</span>
          </div>`,
      )
      .join("");
    burntFallback.innerHTML = `<div class="legend-fallback-section">${rows}</div>`;
  };

  const updateClearance = (): void => {
    const { loadingIndicator, mapContainer } = elements;
    loadingIndicator.style.removeProperty("--map-loading-indicator-right");
    loadingIndicator.style.removeProperty("--map-loading-indicator-bottom");
    if (elements.card.hidden) return;

    const cardStyle = window.getComputedStyle(elements.card);
    if (mobileMedia.matches) {
      const inset = Number.parseFloat(cardStyle.bottom) || 0;
      const desired = elements.card.offsetHeight + inset + CLEARANCE_GAP_PX;
      const maximum = Math.max(
        0,
        mapContainer.clientHeight -
          loadingIndicator.offsetHeight -
          CLEARANCE_GAP_PX,
      );
      loadingIndicator.style.setProperty(
        "--map-loading-indicator-bottom",
        `${Math.min(desired, maximum)}px`,
      );
    } else {
      const inset = Number.parseFloat(cardStyle.right) || 0;
      const desired = elements.card.offsetWidth + inset + CLEARANCE_GAP_PX;
      const maximum = Math.max(
        0,
        mapContainer.clientWidth -
          loadingIndicator.offsetWidth -
          CLEARANCE_GAP_PX,
      );
      loadingIndicator.style.setProperty(
        "--map-loading-indicator-right",
        `${Math.min(desired, maximum)}px`,
      );
    }
  };

  const update = (): void => {
    const state = getState();
    const current = state.mode === "current";
    const activeItem = byId("legend-item-active-fires");
    if (activeItem) {
      activeItem.style.display =
        current && state.activeFiresVisible ? "flex" : "none";
    }

    if (options.useCustomLegend) {
      if (activeImage) activeImage.hidden = true;
      if (activeFallback) activeFallback.hidden = false;
      renderActiveColors();
    } else {
      if (activeImage) {
        activeImage.hidden = false;
        activeImage.src =
          "/api/effis?service=WMS&request=GetLegendGraphic&layer=modis.hs.week&format=image/png";
      }
      if (activeFallback) activeFallback.hidden = true;
    }

    const providerNote = byId("legend-active-fires-provider");
    if (providerNote) {
      const key =
        state.activeFiresProvider === "firms"
          ? "legend_active_fires_via_firms"
          : "legend_active_fires_via_effis";
      providerNote.hidden = false;
      providerNote.dataset.i18n = key;
      providerNote.textContent = translate(key);
    }

    if (activeShapes) {
      const visible =
        current && state.activeFiresVisible && options.useCustomLegend;
      activeShapes.hidden = !visible;
      if (visible) renderActiveShapes();
    }

    updateBurntAreaLegend(state, options, {
      burntImage,
      burntFallback,
      renderBurntAreas,
    });
  };

  const close = (): void => {
    elements.card.classList.remove("open");
    elements.card.addEventListener(
      "transitionend",
      () => {
        if (elements.card.classList.contains("open")) return;
        elements.card.hidden = true;
        updateClearance();
      },
      { once: true },
    );
  };

  elements.button.addEventListener("click", () => {
    if (elements.card.classList.contains("open")) {
      close();
      return;
    }
    elements.card.hidden = false;
    updateClearance();
    update();
    requestAnimationFrame(() => elements.card.classList.add("open"));
  });
  elements.closeButton.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.card.hidden) close();
  });

  const observer = new ResizeObserver(updateClearance);
  observer.observe(elements.card);
  observer.observe(elements.mapContainer);
  mobileMedia.addEventListener("change", updateClearance);
  updateClearance();

  activeImage?.addEventListener("error", () => {
    activeImage.hidden = true;
    if (activeFallback) activeFallback.hidden = false;
    renderActiveColors();
  });
  burntImage?.addEventListener("error", () => {
    burntImage.hidden = true;
    if (burntFallback) burntFallback.hidden = false;
    renderBurntAreas();
  });

  return { update };
}

function updateBurntAreaLegend(
  state: LegendState,
  options: LegendOptions,
  view: {
    burntImage: HTMLImageElement | null;
    burntFallback: HTMLElement | null;
    renderBurntAreas: () => void;
  },
): void {
  const item = byId("legend-item-burnt-areas");
  if (!item) return;

  if (options.useCustomLegend) {
    if (view.burntImage) view.burntImage.hidden = true;
    if (view.burntFallback) view.burntFallback.hidden = false;
    view.renderBurntAreas();
  } else {
    if (view.burntImage) view.burntImage.hidden = false;
    if (view.burntFallback) view.burntFallback.hidden = true;
  }

  const title = byId("legend-title-burnt-areas");
  if (state.mode === "current") {
    const available = BURNT_AREAS_LAYER_IDS.some((id) =>
      Boolean(options.map.getLayer(id)),
    );
    item.style.display =
      state.burntAreasVisible && available ? "flex" : "none";
    if (title) {
      title.dataset.i18n = "burnt_areas";
      title.textContent = options.translate("burnt_areas");
    }
    if (view.burntImage && !options.useCustomLegend) {
      view.burntImage.src =
        "/api/effis?service=WMS&request=GetLegendGraphic&layer=modis.ba.week&format=image/png";
    }
  } else {
    item.style.display = "flex";
    if (title) {
      delete title.dataset.i18n;
      title.textContent = `${options.translate("burnt_areas")} (${state.year})`;
    }
    if (view.burntImage && !options.useCustomLegend) {
      view.burntImage.src =
        "/api/effis?service=WMS&request=GetLegendGraphic&layer=ms:modis.ba.poly&format=image/png";
    }
  }

  const activeShown = state.mode === "current" && state.activeFiresVisible;
  const burntShown =
    state.mode === "past" ||
    (state.burntAreasVisible &&
      BURNT_AREAS_LAYER_IDS.some((id) => Boolean(options.map.getLayer(id))));
  document
    .querySelector(".legend-body")
    ?.classList.toggle("both-active", activeShown && burntShown);
}

function colorRow(color: string, label: string): string {
  return `
    <div class="legend-fallback-row">
      <span class="legend-fallback-color" style="background-color: ${color};"></span>
      <span class="legend-fallback-label">${label}</span>
    </div>`;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
