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
    basemap_bright: "Bright",
    basemap_liberty: "Liberty",
    basemap_dark: "Dark",
    basemap_fiord: "Fiord",
    basemap_satellite: "Satellite",
    basemap_3d: "3D",
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
    error_timeout:
      "EFFIS did not respond in time. The service may be overloaded — try again shortly.",
    error_reachability:
      "Could not reach EFFIS ({error}). The service may be temporarily unavailable — try again shortly.",
    error_http:
      "EFFIS returned an error (HTTP {status}). The service may be temporarily unavailable — try again shortly.{detail}",
    error_parse:
      "Received a response from EFFIS but couldn't parse it as shapefile data ({error}).",
    error_load_failed: "Failed to load fire data.",
    aria_compass: "Reset orientation to North",
    aria_measure_distance: "Measure distance",
    measure_choose_start: "Click the map to choose a starting point",
    measure_choose_end: "Click a second point",
    measure_distance: "Distance: {distance}",
    search_placeholder: "Search for a place...",
    aria_search: "Search",
    aria_change_language: "Change language",
    aria_about: "About",
    about_title: "About Forest Fires Map",
    about_content_html:
      '<p>This application visualizes forest fire data across Europe in real-time and historically, using data from the European Forest Fire Information System (EFFIS).</p><p><strong>Sources:</strong></p><ul><li>Active Fires & Burnt Areas: <a href="https://effis.jrc.ec.europa.eu" target="_blank" rel="noopener">EFFIS</a> (Copernicus Emergency Management Service)</li><li>Active Fires fallback: <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener">NASA FIRMS</a> (used automatically if EFFIS is temporarily unavailable)</li><li>Background maps: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, OpenStreetMap contributors, and <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> World Imagery</li></ul><p class="about-dedication">Dedicated to the memory of those who lost their lives in wildfires</p>',
    aria_legend: "Map Legend",
    legend_title: "Legend",
    legend_age: "Age",
    legend_satellite: "Satellite",
    legend_up_to_6_hours: "≤6 h",
    legend_6_to_12_hours: "6–12 h",
    legend_12_to_24_hours: "12–24 h",
    legend_last_1_day: "Last day",
    legend_last_7_days: "Last 7 days",
    legend_borders: "Country Borders",
    legend_active_fires_via_firms: "via NASA FIRMS",
    aria_active_fires_source: "Active fires data source",
    active_fires_source_label: "Active fires data source",
    active_fires_source_effis: "EFFIS (EU)",
    active_fires_source_firms: "FIRMS (NASA)",
    provider_fallback_status:
      "EFFIS servers are down. Attempting to retrieve data from an alternative source (NASA FIRMS)…",
    effis_status_slow:
      "{effisLinkOpen}EFFIS{effisLinkClose} is responding slowly right now — some fire data may take longer to load.",
    effis_status_down:
      "{effisLinkOpen}EFFIS{effisLinkClose} appears to be down or unreachable right now — fire data may be missing or outdated.",
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
    basemap_bright: "Brillante",
    basemap_liberty: "Liberty",
    basemap_dark: "Oscuro",
    basemap_fiord: "Fiordo",
    basemap_satellite: "Satélite",
    basemap_3d: "3D",
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
    live_fires_status:
      "Mostrando incendios activos y áreas quemadas en tiempo real de EFFIS.",
    loading_year_fires: "Cargando incendios de {year}…",
    no_burnt_areas: "No se registraron áreas quemadas para {year}.",
    fires_shown_singular: "Se muestra {count} incendio.",
    fires_shown_plural: "Se muestran {count} incendios.",
    popup_date: "Fecha",
    popup_burnt_area: "Área quemada",
    popup_country: "País",
    unknown: "Desconocido",
    error_timeout:
      "EFFIS no respondió a tiempo. El servicio puede estar sobrecargado; inténtelo de nuevo en breve.",
    error_reachability:
      "No se pudo conectar con EFFIS ({error}). El servicio puede estar temporalmente no disponible; inténtelo de nuevo en breve.",
    error_http:
      "EFFIS devolvió un error (HTTP {status}). El servicio puede estar temporalmente no disponible; inténtelo de nuevo en breve.{detail}",
    error_parse:
      "Se recibió una respuesta de EFFIS pero no se pudo analizar como datos de shapefile ({error}).",
    error_load_failed: "Error al cargar los datos de los incendios.",
    aria_compass: "Restablecer orientación al Norte",
    aria_measure_distance: "Medir distancia",
    measure_choose_start: "Haz clic en el mapa para elegir un punto de inicio",
    measure_choose_end: "Haz clic en un segundo punto",
    measure_distance: "Distancia: {distance}",
    search_placeholder: "Buscar un lugar...",
    aria_search: "Buscar",
    aria_change_language: "Cambiar idioma",
    aria_about: "Acerca de",
    about_title: "Acerca de Mapa de incendios forestales",
    about_content_html:
      '<p>Esta aplicación visualiza datos de incendios forestales en Europa en tiempo real e históricos, utilizando datos del Sistema Europeo de Información sobre Incendios Forestales (EFFIS).</p><p><strong>Fuentes:</strong></p><ul><li>Incendios activos y áreas quemadas: <a href="https://effis.jrc.ec.europa.eu" target="_blank" rel="noopener">EFFIS</a> (Copernicus Emergency Management Service)</li><li>Alternativa para incendios activos: <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener">NASA FIRMS</a> (se usa automáticamente si EFFIS no está disponible temporalmente)</li><li>Mapas de fondo: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, colaboradores de OpenStreetMap y <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> World Imagery</li></ul><p class="about-dedication">Dedicado a la memoria de quienes perdieron la vida en incendios forestales</p>',
    aria_legend: "Leyenda del mapa",
    legend_title: "Leyenda",
    legend_age: "Antigüedad",
    legend_satellite: "Satélite",
    legend_up_to_6_hours: "≤6 h",
    legend_6_to_12_hours: "6–12 h",
    legend_12_to_24_hours: "12–24 h",
    legend_last_1_day: "Último día",
    legend_last_7_days: "Últimos 7 días",
    legend_borders: "Límites nacionales",
    legend_active_fires_via_firms: "vía NASA FIRMS",
    aria_active_fires_source: "Fuente de datos de incendios activos",
    active_fires_source_label: "Fuente de datos de incendios activos",
    active_fires_source_effis: "EFFIS",
    active_fires_source_firms: "FIRMS",
    provider_fallback_status:
      "Los servidores de EFFIS no están disponibles. Intentando obtener datos de una fuente alternativa (NASA FIRMS)…",
    effis_status_slow:
      "{effisLinkOpen}EFFIS{effisLinkClose} está respondiendo lentamente en este momento — algunos datos de incendios pueden tardar más en cargarse.",
    effis_status_down:
      "{effisLinkOpen}EFFIS{effisLinkClose} parece estar caído o inaccesible en este momento — los datos de incendios pueden faltar o estar desactualizados.",
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
    basemap_bright: "Hell",
    basemap_liberty: "Liberty",
    basemap_dark: "Dunkel",
    basemap_fiord: "Fjord",
    basemap_satellite: "Satellit",
    basemap_3d: "3D",
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
    live_fires_status:
      "Zeigt aktuelle aktive Brände und verbrannte Flächen von EFFIS.",
    loading_year_fires: "Brände für {year} werden geladen…",
    no_burnt_areas: "Keine verbrannten Flächen für {year} aufgezeichnet.",
    fires_shown_singular: "{count} Brand angezeigt.",
    fires_shown_plural: "{count} Brände angezeigt.",
    popup_date: "Datum",
    popup_burnt_area: "Verbrannte Fläche",
    popup_country: "Land",
    unknown: "Unbekannt",
    error_timeout:
      "EFFIS hat nicht rechtzeitig geantwortet. Der Dienst ist möglicherweise überlastet – versuchen Sie es bald noch einmal.",
    error_reachability:
      "EFFIS konnte nicht erreicht werden ({error}). Der Dienst ist möglicherweise vorübergehend nicht verfügbar – versuchen Sie es bald noch einmal.",
    error_http:
      "EFFIS hat einen Fehler zurückgegeben (HTTP {status}). Der Dienst ist möglicherweise vorübergehend nicht verfügbar – versuchen Sie es bald noch einmal.{detail}",
    error_parse:
      "Antwort von EFFIS empfangen, konnte aber nicht als Shapefile-Daten analysiert werden ({error}).",
    error_load_failed: "Feuerdaten konnten nicht geladen werden.",
    aria_compass: "Ausrichtung nach Norden zurücksetzen",
    aria_measure_distance: "Entfernung messen",
    measure_choose_start:
      "Klicken Sie auf die Karte, um einen Startpunkt zu wählen",
    measure_choose_end: "Klicken Sie auf einen zweiten Punkt",
    measure_distance: "Entfernung: {distance}",
    search_placeholder: "Nach einem Ort suchen...",
    aria_search: "Suche",
    aria_change_language: "Sprache ändern",
    aria_about: "Über uns",
    about_title: "Über Waldbrandkarte",
    about_content_html:
      '<p>Diese Anwendung visualisiert Echtzeit- und historische Waldbranddaten in ganz Europa unter Verwendung von Daten des Europäischen Waldbrandinformationssystems (EFFIS).</p><p><strong>Quellen:</strong></p><ul><li>Aktive Brände & Verbrannte Flächen: <a href="https://effis.jrc.ec.europa.eu" target="_blank" rel="noopener">EFFIS</a> (Copernicus Emergency Management Service)</li><li>Ausweichquelle für aktive Brände: <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener">NASA FIRMS</a> (wird automatisch verwendet, wenn EFFIS vorübergehend nicht verfügbar ist)</li><li>Hintergrundkarten: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, OpenStreetMap-Mitwirkende und <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> World Imagery</li></ul><p class="about-dedication">Gewidmet dem Gedenken an diejenigen, die bei Waldbränden ihr Leben verloren haben</p>',
    aria_legend: "Legende",
    legend_title: "Legende",
    legend_age: "Alter",
    legend_satellite: "Satellit",
    legend_up_to_6_hours: "≤6 Std.",
    legend_6_to_12_hours: "6–12 Std.",
    legend_12_to_24_hours: "12–24 Std.",
    legend_last_1_day: "Letzter Tag",
    legend_last_7_days: "Letzte 7 Tage",
    legend_borders: "Landesgrenzen",
    legend_active_fires_via_firms: "über NASA FIRMS",
    aria_active_fires_source: "Datenquelle für aktive Brände",
    active_fires_source_label: "Datenquelle für aktive Brände",
    active_fires_source_effis: "EFFIS",
    active_fires_source_firms: "FIRMS",
    provider_fallback_status:
      "Die EFFIS-Server sind nicht erreichbar. Daten werden von einer alternativen Quelle (NASA FIRMS) abgerufen…",
    effis_status_slow:
      "{effisLinkOpen}EFFIS{effisLinkClose} reagiert derzeit langsam — einige Brandinformationen können länger zum Laden benötigen.",
    effis_status_down:
      "{effisLinkOpen}EFFIS{effisLinkClose} scheint derzeit nicht erreichbar zu sein — Brandinformationen können fehlen oder veraltet sein.",
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
    basemap_bright: "Clair",
    basemap_liberty: "Liberty",
    basemap_dark: "Sombre",
    basemap_fiord: "Fjord",
    basemap_satellite: "Satellite",
    basemap_3d: "3D",
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
    live_fires_status:
      "Affichage des incendies actifs et des zones brûlées en temps réel d'EFFIS.",
    loading_year_fires: "Chargement des incendies de {year}…",
    no_burnt_areas: "Aucune zone brûlée enregistrée pour {year}.",
    fires_shown_singular: "{count} incendie affiché.",
    fires_shown_plural: "{count} incendies affichés.",
    popup_date: "Date",
    popup_burnt_area: "Zone brûlée",
    popup_country: "Pays",
    unknown: "Inconnu",
    error_timeout:
      "EFFIS n'a pas répondu à temps. Le service est peut-être surchargé – réessayez bientôt.",
    error_reachability:
      "Impossible de joindre EFFIS ({error}). Le service est peut-être temporairement indisponible – réessayez bientôt.",
    error_http:
      "EFFIS a renvoyé une erreur (HTTP {status}). Le service est peut-être temporairement indisponible – réessayez bientôt.{detail}",
    error_parse:
      "Réponse d'EFFIS reçue mais impossible de l'analyser comme des données shapefile ({error}).",
    error_load_failed: "Échec du chargement des données sur les incendies.",
    aria_compass: "Réinitialiser l'orientation vers le Nord",
    aria_measure_distance: "Mesurer une distance",
    measure_choose_start:
      "Cliquez sur la carte pour choisir un point de départ",
    measure_choose_end: "Cliquez sur un deuxième point",
    measure_distance: "Distance : {distance}",
    search_placeholder: "Rechercher un lieu...",
    aria_search: "Recherche",
    aria_change_language: "Changer de langue",
    aria_about: "À propos",
    about_title: "À propos de la Carte des incendies de forêt",
    about_content_html:
      '<p>Cette application visualise les données sur les incendies de forêt en Europe en temps réel et historiquement, à l\'aide des données du Système européen d\'information sur les incendies de forêt (EFFIS).</p><p><strong>Sources :</strong></p><ul><li>Incendies actifs et zones brûlées : <a href="https://effis.jrc.ec.europa.eu" target="_blank" rel="noopener">EFFIS</a> (Copernicus Emergency Management Service)</li><li>Solution de repli pour les incendies actifs : <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener">NASA FIRMS</a> (utilisée automatiquement si EFFIS est temporairement indisponible)</li><li>Cartes de fond : <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, contributeurs d\'OpenStreetMap et <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> World Imagery</li></ul><p class="about-dedication">Dédié à la mémoire de celles et ceux qui ont perdu la vie dans des incendies de forêt</p>',
    aria_legend: "Légende",
    legend_title: "Légende",
    legend_age: "Âge",
    legend_satellite: "Satellite",
    legend_up_to_6_hours: "≤6 h",
    legend_6_to_12_hours: "6–12 h",
    legend_12_to_24_hours: "12–24 h",
    legend_last_1_day: "Dernier jour",
    legend_last_7_days: "7 derniers jours",
    legend_borders: "Frontières nationales",
    legend_active_fires_via_firms: "via NASA FIRMS",
    aria_active_fires_source: "Source de données des incendies actifs",
    active_fires_source_label: "Source de données des incendies actifs",
    active_fires_source_effis: "EFFIS",
    active_fires_source_firms: "FIRMS",
    provider_fallback_status:
      "Les serveurs EFFIS sont indisponibles. Tentative de récupération des données depuis une source alternative (NASA FIRMS)…",
    effis_status_slow:
      "{effisLinkOpen}EFFIS{effisLinkClose} répond actuellement lentement — certaines données sur les incendies peuvent mettre plus de temps à se charger.",
    effis_status_down:
      "{effisLinkOpen}EFFIS{effisLinkClose} semble actuellement hors service ou inaccessible — les données sur les incendies peuvent être manquantes ou obsolètes.",
  },
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

export function t(
  key: string,
  variables?: Record<string, string | number>,
): string {
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
      if (key.endsWith("_html")) {
        el.innerHTML = t(key);
      } else {
        el.textContent = t(key);
      }
    }
  });

  const aboutContent = document.querySelector(
    '[data-i18n="about_content_html"]',
  );
  const dedication = aboutContent?.querySelector(".about-dedication");
  if (aboutContent && dedication) {
    const projectLink = document.createElement("p");
    projectLink.className = "about-project-link";
    projectLink.innerHTML =
      '<a href="https://github.com/joewdavies/forest-fires-map" target="_blank" rel="noopener noreferrer">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.93 10.93 0 0 1 5.75 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>' +
      "View on GitHub</a>";
    aboutContent.insertBefore(projectLink, dedication);
  }

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
