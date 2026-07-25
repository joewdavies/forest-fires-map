export type Language = "en" | "es" | "de" | "fr";

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
  },
  de: {
    app_title: "Waldbrandkarte",
    header_title: "Waldbrandkarte",
    aria_map_layers: "Kartenebenen",
    layers_title: "Ebenen",
    aria_close: "Schließen",
    basemap: "Grundkarte",
    aria_bg_map: "Hintergrundkarte",
    basemap_plain: "Einfach",
    basemap_positron: "Positron",
    basemap_osm: "OSM",
    basemap_satellite: "Satellit",
    map_details: "Kartendetails",
    aria_fire_time_range: "Zeitraum der Brände",
    current_fires: "Aktuelle Brände",
    past_fires: "Historische Brände",
    aria_fire_layers: "Feuerebenen",
    active_fires: "Aktive Brände",
    burnt_areas: "Verbrannte Flächen",
    place_names: "Ortsnamen",
    loading_style: "Kartenstil wird geladen…",
    error_basemap: "Grundkarte konnte nicht geladen werden.",
    live_fires_status: "Zeigt aktuelle aktive Brände und verbrannte Flächen von EFFIS.",
    loading_year_fires: "Brände für {year} werden geladen…",
    no_burnt_areas: "Keine verbrannten Flächen für {year} aufgezeichnet.",
    fires_shown_singular: "{count} Brand angezeigt.",
    fires_shown_plural: "{count} Brände angezeigt.",
    popup_date: "Datum",
    popup_burnt_area: "Verbrannte Fläche",
    popup_country: "Land",
    unknown: "Unbekannt",
    error_timeout: "EFFIS hat nicht rechtzeitig geantwortet. Der Dienst ist möglicherweise überlastet – versuchen Sie es bald noch einmal.",
    error_reachability: "EFFIS konnte nicht erreicht werden ({error}). Der Dienst ist möglicherweise vorübergehend nicht verfügbar – versuchen Sie es bald noch einmal.",
    error_http: "EFFIS hat einen Fehler zurückgegeben (HTTP {status}). Der Dienst ist möglicherweise vorübergehend nicht verfügbar – versuchen Sie es bald noch einmal.{detail}",
    error_parse: "Antwort von EFFIS empfangen, konnte aber nicht als Shapefile-Daten analysiert werden ({error}).",
    error_load_failed: "Feuerdaten konnten nicht geladen werden.",
    aria_compass: "Ausrichtung nach Norden zurücksetzen",
    search_placeholder: "Nach einem Ort suchen...",
    aria_search: "Suche",
    aria_change_language: "Sprache ändern"
  },
  fr: {
    app_title: "Carte des incendies de forêt",
    header_title: "Carte des incendies de forêt",
    aria_map_layers: "Couches de la carte",
    layers_title: "Couches",
    aria_close: "Fermer",
    basemap: "Carte de base",
    aria_bg_map: "Carte de fond",
    basemap_plain: "Simple",
    basemap_positron: "Positron",
    basemap_osm: "OSM",
    basemap_satellite: "Satellite",
    map_details: "Détails de la carte",
    aria_fire_time_range: "Plage horaire des incendies",
    current_fires: "Incendies actuels",
    past_fires: "Incendies passés",
    aria_fire_layers: "Couches d'incendies",
    active_fires: "Incendies actifs",
    burnt_areas: "Zones brûlées",
    place_names: "Noms de lieux",
    loading_style: "Chargement du style de carte…",
    error_basemap: "Échec du chargement de cette carte de base.",
    live_fires_status: "Affichage des incendies actifs et des zones brûlées en temps réel d'EFFIS.",
    loading_year_fires: "Chargement des incendies de {year}…",
    no_burnt_areas: "Aucune zone brûlée enregistrée pour {year}.",
    fires_shown_singular: "{count} incendie affiché.",
    fires_shown_plural: "{count} incendies affichés.",
    popup_date: "Date",
    popup_burnt_area: "Zone brûlée",
    popup_country: "Pays",
    unknown: "Inconnu",
    error_timeout: "EFFIS n'a pas répondu à temps. Le service est peut-être surchargé – réessayez bientôt.",
    error_reachability: "Impossible de joindre EFFIS ({error}). Le service est peut-être temporairement indisponible – réessayez bientôt.",
    error_http: "EFFIS a renvoyé une erreur (HTTP {status}). Le service est peut-être temporairement indisponible – réessayez bientôt.{detail}",
    error_parse: "Réponse d'EFFIS reçue mais impossible de l'analyser comme des données shapefile ({error}).",
    error_load_failed: "Échec du chargement des données sur les incendies.",
    aria_compass: "Réinitialiser l'orientation vers le Nord",
    search_placeholder: "Rechercher un lieu...",
    aria_search: "Recherche",
    aria_change_language: "Changer de langue"
  }
};

let currentLanguage: Language = "en";

// Detect browser/device language
const userLang = navigator.language || (navigator as any).userLanguage || "";
const code = userLang.toLowerCase().slice(0, 2);
if (["es", "de", "fr"].includes(code)) {
  currentLanguage = code as Language;
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
