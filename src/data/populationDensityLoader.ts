import type { City } from "../types";

const densityModules = import.meta.glob("./*PopulationDensity.json");

const cityToPrefix: Record<string, string> = {
  SF: "sf",
  LA: "la",
  Boston: "boston",
  Philadelphia: "philly",
  Seattle: "seattle",
  Portland: "portland",
  "San Diego": "sanDiego",
  "San Jose": "sanJose",
  Pittsburgh: "pittsburgh",
  Minneapolis: "minneapolis",
  Denver: "denver",
  "Salt Lake City": "saltLakeCity",
  Phoenix: "phoenix",
  Cleveland: "cleveland",
  Charlotte: "charlotte",
  Baltimore: "baltimore",
  Toronto: "toronto",
};

const cache = new Map<City, any>();

function getFilename(key: string): string {
  const noQuery = key.split("?")[0];
  const parts = noQuery.split("/");
  return parts[parts.length - 1];
}

export async function loadPopulationDensity(city: City): Promise<any | null> {
  if (cache.has(city)) return cache.get(city);

  const prefix = cityToPrefix[city];
  if (!prefix) return null;

  const filename = `${prefix}PopulationDensity.json`;
  const loader = Object.entries(densityModules).find(
    ([key]) => getFilename(key) === filename,
  )?.[1];

  if (!loader) {
    console.warn(
      `Population density data not found for ${city} (expected ${filename})`,
    );
    return null;
  }

  const mod = (await loader()) as any;
  const data = mod?.default || null;
  if (data) cache.set(city, data);
  return data;
}
