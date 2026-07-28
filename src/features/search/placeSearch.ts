import type { Map as MaplibreMap } from "maplibre-gl";

interface PlaceSearchElements {
  container: HTMLElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
  results: HTMLUListElement;
}

interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
}

const SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";

export function installPlaceSearch(
  map: MaplibreMap,
  elements: PlaceSearchElements,
): void {
  const { container, input, button, results } = elements;
  let timeoutId: number | undefined;
  let currentResults: GeocodeResult[] = [];

  const selectPlace = (place: GeocodeResult): void => {
    const latitude = Number.parseFloat(place.lat);
    const longitude = Number.parseFloat(place.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    map.flyTo({ center: [longitude, latitude], zoom: 10 });
    input.value = place.display_name;
    results.hidden = true;
    input.blur();
    container.classList.remove("expanded");
  };

  const renderResults = (places: GeocodeResult[]): void => {
    results.replaceChildren();
    for (const place of places) {
      const item = document.createElement("li");
      item.textContent = place.display_name;
      item.addEventListener("click", () => selectPlace(place));
      results.appendChild(item);
    }
    results.hidden = places.length === 0;
  };

  const search = async (query: string, limit: number): Promise<GeocodeResult[]> => {
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set("format", "json");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    const response = await fetch(url, {
      headers: { "User-Agent": "European-Forest-Fires-Map-App" },
    });
    if (!response.ok) throw new Error(`Search failed (HTTP ${response.status})`);
    return (await response.json()) as GeocodeResult[];
  };

  const performInstantSearch = async (): Promise<void> => {
    const query = input.value.trim();
    if (!query) return;
    if (currentResults.length > 0) {
      selectPlace(currentResults[0]);
      return;
    }

    try {
      const places = await search(query, 1);
      if (places[0]) selectPlace(places[0]);
    } catch (error) {
      console.warn("Instant search failed:", error);
    }
  };

  input.addEventListener("input", () => {
    window.clearTimeout(timeoutId);
    const query = input.value.trim();
    if (query.length < 2) {
      currentResults = [];
      results.hidden = true;
      return;
    }

    timeoutId = window.setTimeout(async () => {
      try {
        currentResults = await search(query, 5);
        renderResults(currentResults);
      } catch (error) {
        console.warn("Geocoding search failed:", error);
      }
    }, 300);
  });

  button.addEventListener("click", (event) => {
    const collapsedOnMobile =
      window.innerWidth <= 768 && !container.classList.contains("expanded");
    if (collapsedOnMobile) {
      event.stopPropagation();
      container.classList.add("expanded");
      input.focus();
    } else {
      void performInstantSearch();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void performInstantSearch();
  });

  document.addEventListener("click", (event) => {
    if (container.contains(event.target as Node)) return;
    results.hidden = true;
    container.classList.remove("expanded");
  });
}
