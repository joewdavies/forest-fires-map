export type Language = "en" | "es";

const translations: Record<Language, Record<string, string>> = {
  en: {
    app_title: "Forest Fires Map",
    header_title: "Forest Fires Map",
    aria_map_layers: "Map layers",
    layers_title: "Layers",
    aria_close: "Close",
    basemap: "Basemap",
    aria_bg_map: "Background map",
    basemap_plain: "Plain",
    basemap_positron: "Positron",
    basemap_osm: "OSM",
    basemap_satellite: "Satellite",
    map_details: "Map details",
    aria_fire_time_range: "Fire time range",
    current_fires: "Current fires",
    past_fires: "Past fires",
    aria_fire_layers: "Fire layers",
    active_fires: "Active fires",
    burnt_areas: "Burnt areas",
    place_names: "Place names",
    loading_style: "Loading map style…",
    error_basemap: "Failed to load that basemap.",
    live_fires_status: "Showing live active fires and burnt areas from EFFIS.",
    loading_year_fires: "Loading {year} fires…",
    no_burnt_areas: "No burnt areas recorded for {year}.",
    fires_shown_singular: "{count} fire shown.",
    fires_shown_plural: "{count} fires shown.",
    popup_date: "Date",
    popup_burnt_area: "Burnt area",
    popup_country: "Country",
    unknown: "Unknown",
    error_timeout: "EFFIS did not respond in time. The service may be overloaded — try again shortly.",
    error_reachability: "Could not reach EFFIS ({error}). The service may be temporarily unavailable — try again shortly.",
    error_http: "EFFIS returned an error (HTTP {status}). The service may be temporarily unavailable — try again shortly.{detail}",
    error_parse: "Received a response from EFFIS but couldn't parse it as shapefile data ({error}).",
    error_load_failed: "Failed to load fire data.",
    aria_compass: "Reset orientation to North",
    search_placeholder: "Search for a place...",
    aria_search: "Search",
    aria_change_language: "Change language"
  },
  es: {
    app_title: "Mapa de incendios forestales",
    header_title: "Mapa de incendios forestales",
    aria_map_layers: "Capas del mapa",
    layers_title: "Capas",
    aria_close: "Cerrar",
    basemap: "Mapa base",
    aria_bg_map: "Mapa de fondo",
    basemap_plain: "Sencillo",
    basemap_positron: "Positron",
    basemap_osm: "OSM",
    basemap_satellite: "Satélite",
    map_details: "Detalles del mapa",
    aria_fire_time_range: "Rango de tiempo de los incendios",
    current_fires: "Incendios actuales",
    past_fires: "Incendios pasados",
    aria_fire_layers: "Capas de incendios",
    active_fires: "Incendios activos",
    burnt_areas: "Áreas quemadas",
    place_names: "Nombres de lugares",
    loading_style: "Cargando estilo del mapa…",
    error_basemap: "Error al cargar ese mapa base.",
    live_fires_status: "Mostrando incendios activos y áreas quemadas en tiempo real de EFFIS.",
    loading_year_fires: "Cargando incendios de {year}…",
    no_burnt_areas: "No se registraron áreas quemadas para {year}.",
    fires_shown_singular: "Se muestra {count} incendio.",
    fires_shown_plural: "Se muestran {count} incendios.",
    popup_date: "Fecha",
    popup_burnt_area: "Área quemada",
    popup_country: "País",
    unknown: "Desconocido",
    error_timeout: "EFFIS no respondió a tiempo. El servicio puede estar sobrecargado; inténtelo de nuevo en breve.",
    error_reachability: "No se pudo conectar con EFFIS ({error}). El servicio puede estar temporalmente no disponible; inténtelo de nuevo en breve.",
    error_http: "EFFIS devolvió un error (HTTP {status}). El servicio puede estar temporalmente no disponible; inténtelo de nuevo en breve.{detail}",
    error_parse: "Se recibió una respuesta de EFFIS pero no se pudo analizar como datos de shapefile ({error}).",
    error_load_failed: "Error al cargar los datos de los incendios.",
    aria_compass: "Restablecer orientación al Norte",
    search_placeholder: "Buscar un lugar...",
    aria_search: "Buscar",
    aria_change_language: "Cambiar idioma"
  }
};

let currentLanguage: Language = "en";

// Detect browser/device language
const userLang = navigator.language || (navigator as any).userLanguage || "";
if (userLang.toLowerCase().startsWith("es")) {
  currentLanguage = "es";
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
  initTranslations();
}

export function t(key: string, variables?: Record<string, string | number>): string {
  const dictionary = translations[currentLanguage] || translations.en;
  let message = dictionary[key] || translations.en[key] || key;

  if (variables) {
    Object.entries(variables).forEach(([k, v]) => {
      message = message.replace(`{${k}}`, String(v));
    });
  }

  return message;
}

export function initTranslations(): void {
  // Update document language attribute
  document.documentElement.lang = currentLanguage;

  // Find all elements with data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key);
    }
  });

  // Find all elements with data-i18n-aria-label attribute
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    if (key) {
      el.setAttribute("aria-label", t(key));
    }
  });

  // Find all elements with data-i18n-placeholder attribute
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) {
      el.setAttribute("placeholder", t(key));
    }
  });

  // Specifically update the page title
  document.title = t("app_title");
}
