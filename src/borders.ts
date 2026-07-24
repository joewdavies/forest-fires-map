import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { FeatureCollection } from "geojson";

// GISCO (Eurostat) country boundary lines — includes both political borders
// and coastlines as LineStrings, so combined they trace each country's full
// outline. CORS is open (access-control-allow-origin: *), no proxy needed.
const GISCO_BORDERS_URL =
  "https://gisco-services.ec.europa.eu/distribution/v2/countries/topojson/CNTR_BN_20M_2024_4326.json";
const TOPOLOGY_OBJECT = "CNTR_BN_20M_2024_4326";

export async function fetchCountryBorders(): Promise<FeatureCollection> {
  const response = await fetch(GISCO_BORDERS_URL);
  if (!response.ok) throw new Error(`GISCO borders request failed (HTTP ${response.status})`);

  const topology = (await response.json()) as Topology;
  const object = topology.objects[TOPOLOGY_OBJECT];
  return feature(topology, object) as FeatureCollection;
}
