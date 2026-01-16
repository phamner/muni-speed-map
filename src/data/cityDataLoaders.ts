/**
 * Lazy loaders for city data - enables code splitting
 * Each city's data is loaded on-demand when the user clicks that city
 * This dramatically reduces initial bundle size and page load time
 */

import type { City } from "../types";

// Type for city static data (routes, stops, crossings, switches, maxspeed)
export interface CityStaticData {
  routes: any;
  stops: any;
  crossings: any;
  switches: any;
  maxspeed: any | null;
}

// City coordinates/zoom - these are tiny so we keep them bundled
export const CITY_COORDS: Record<
  City,
  { center: [number, number]; zoom: number }
> = {
  SF: { center: [-122.433, 37.767], zoom: 11 },
  LA: { center: [-118.25, 34.05], zoom: 11 },
  Seattle: { center: [-122.33, 47.6], zoom: 11 },
  Boston: { center: [-71.08, 42.35], zoom: 11 },
  Portland: { center: [-122.68, 45.52], zoom: 11 },
  "San Diego": { center: [-117.15, 32.72], zoom: 11 },
  Toronto: { center: [-79.38, 43.65], zoom: 11 },
  Philadelphia: { center: [-75.16, 39.95], zoom: 11 },
  Sacramento: { center: [-121.49, 38.58], zoom: 11 },
  Pittsburgh: { center: [-79.99, 40.43], zoom: 11 },
  Dallas: { center: [-96.8, 32.78], zoom: 11 },
  Minneapolis: { center: [-93.27, 44.98], zoom: 11 },
  Denver: { center: [-104.9, 39.75], zoom: 11 },
  "Salt Lake City": { center: [-111.89, 40.76], zoom: 11 },
  "San Jose": { center: [-121.89, 37.34], zoom: 11 },
  Phoenix: { center: [-112.0, 33.47], zoom: 11 },
  // Placeholder cities (no data yet)
  "Jersey City": { center: [-74.05, 40.73], zoom: 11 },
  Calgary: { center: [-114.07, 51.05], zoom: 11 },
  Edmonton: { center: [-113.5, 53.55], zoom: 11 },
  Cleveland: { center: [-81.69, 41.5], zoom: 11 },
  Charlotte: { center: [-80.84, 35.23], zoom: 11 },
};

// Cache for loaded city data - persists across component remounts
const cityStaticDataCache = new Map<City, CityStaticData>();

// Loading promises to prevent duplicate loads
const loadingPromises = new Map<City, Promise<CityStaticData>>();

/**
 * Lazy load city data - returns cached data if available, otherwise loads dynamically
 */
export async function loadCityData(city: City): Promise<CityStaticData> {
  // Return cached data immediately if available
  if (cityStaticDataCache.has(city)) {
    return cityStaticDataCache.get(city)!;
  }

  // If already loading, return the existing promise
  if (loadingPromises.has(city)) {
    return loadingPromises.get(city)!;
  }

  // Start loading
  const loadPromise = doLoadCityData(city);
  loadingPromises.set(city, loadPromise);

  try {
    const data = await loadPromise;
    cityStaticDataCache.set(city, data);
    return data;
  } finally {
    loadingPromises.delete(city);
  }
}

/**
 * Check if city data is already cached (instant access)
 */
export function isCityDataCached(city: City): boolean {
  return cityStaticDataCache.has(city);
}

/**
 * Get cached city data (returns undefined if not cached)
 */
export function getCachedCityData(city: City): CityStaticData | undefined {
  return cityStaticDataCache.get(city);
}

/**
 * Preload city data in the background (doesn't block UI)
 */
export function preloadCityStaticData(city: City): void {
  if (cityStaticDataCache.has(city) || loadingPromises.has(city)) return;
  loadCityData(city).catch(() => {
    /* ignore preload errors */
  });
}

/**
 * Actually load the city data using dynamic imports
 */
async function doLoadCityData(city: City): Promise<CityStaticData> {
  console.time(`Loading ${city} static data`);

  switch (city) {
    case "SF": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./muniMetroRoutes.json"),
        import("./muniMetroStops.json"),
        import("./sfGradeCrossings.json"),
        import("./sfSwitches.json"),
        import("./sfMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "LA": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./laMetroRoutes.json"),
        import("./laMetroStops.json"),
        import("./laGradeCrossings.json"),
        import("./laSwitches.json"),
        import("./laMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Seattle": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./seattleLinkRoutes.json"),
        import("./seattleLinkStops.json"),
        import("./seattleGradeCrossings.json"),
        import("./seattleSwitches.json"),
        import("./seattleMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Boston": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./bostonGreenLineRoutes.json"),
        import("./bostonGreenLineStops.json"),
        import("./bostonGradeCrossings.json"),
        import("./bostonSwitches.json"),
        import("./bostonMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Portland": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./portlandMaxRoutes.json"),
        import("./portlandMaxStops.json"),
        import("./portlandGradeCrossings.json"),
        import("./portlandSwitches.json"),
        import("./portlandMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "San Diego": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./sanDiegoTrolleyRoutes.json"),
        import("./sanDiegoTrolleyStops.json"),
        import("./sanDiegoGradeCrossings.json"),
        import("./sanDiegoSwitches.json"),
        import("./sanDiegoMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Toronto": {
      const [
        streetcarRoutes,
        lrtRoutes,
        stops,
        crossings,
        switches,
      ] = await Promise.all([
        import("./torontoStreetcarRoutes.json"),
        import("./torontoLrtRoutes.json"),
        import("./torontoStreetcarStops.json"),
        import("./torontoGradeCrossings.json"),
        import("./torontoSwitches.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      // Merge streetcar and LRT routes
      return {
        routes: {
          type: "FeatureCollection",
          features: [
            ...(streetcarRoutes.default as any).features,
            ...(lrtRoutes.default as any).features,
          ],
        },
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null,
      };
    }

    case "Philadelphia": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./phillyTrolleyRoutes.json"),
        import("./phillyTrolleyStops.json"),
        import("./phillyGradeCrossings.json"),
        import("./phillySwitches.json"),
        import("./phillyMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Sacramento": {
      const [routes, stops, crossings, switches] = await Promise.all([
        import("./sacramentoLightRailRoutes.json"),
        import("./sacramentoLightRailStops.json"),
        import("./sacramentoGradeCrossings.json"),
        import("./sacramentoSwitches.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null,
      };
    }

    case "Pittsburgh": {
      const [routes, stops, crossings, switches] = await Promise.all([
        import("./pittsburghTRoutes.json"),
        import("./pittsburghTStops.json"),
        import("./pittsburghGradeCrossings.json"),
        import("./pittsburghSwitches.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null,
      };
    }

    case "Dallas": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./dallasDartRoutes.json"),
        import("./dallasDartStops.json"),
        import("./dallasGradeCrossings.json"),
        import("./dallasSwitches.json"),
        import("./dallasMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Minneapolis": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./minneapolisMetroRoutes.json"),
        import("./minneapolisMetroStops.json"),
        import("./minneapolisGradeCrossings.json"),
        import("./minneapolisSwitches.json"),
        import("./minneapolisMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Denver": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./denverRtdRoutes.json"),
        import("./denverRtdStops.json"),
        import("./denverGradeCrossings.json"),
        import("./denverSwitches.json"),
        import("./denverMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Salt Lake City": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./slcTraxRoutes.json"),
        import("./slcTraxStops.json"),
        import("./slcGradeCrossings.json"),
        import("./slcSwitches.json"),
        import("./slcMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "San Jose": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./vtaLightRailRoutes.json"),
        import("./vtaLightRailStops.json"),
        import("./sanJoseGradeCrossings.json"),
        import("./sanJoseSwitches.json"),
        import("./vtaMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Phoenix": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./phoenixLightRailRoutes.json"),
        import("./phoenixLightRailStops.json"),
        import("./phoenixGradeCrossings.json"),
        import("./phoenixSwitches.json"),
        import("./phoenixMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    case "Charlotte": {
      const [routes, stops, crossings, switches, maxspeed] = await Promise.all([
        import("./charlotteLightRailRoutes.json"),
        import("./charlotteLightRailStops.json"),
        import("./charlotteGradeCrossings.json"),
        import("./charlotteSwitches.json"),
        import("./charlotteMaxspeed.json"),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
      };
    }

    // Placeholder cities - return empty data
    case "Jersey City":
    case "Calgary":
    case "Edmonton":
    case "Cleveland": {
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: { type: "FeatureCollection", features: [] },
        stops: { type: "FeatureCollection", features: [] },
        crossings: { type: "FeatureCollection", features: [] },
        switches: { type: "FeatureCollection", features: [] },
        maxspeed: null,
      };
    }

    default: {
      console.warn(`Unknown city: ${city}`);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: { type: "FeatureCollection", features: [] },
        stops: { type: "FeatureCollection", features: [] },
        crossings: { type: "FeatureCollection", features: [] },
        switches: { type: "FeatureCollection", features: [] },
        maxspeed: null,
      };
    }
  }
}

/**
 * Start background preloading for popular cities (called after initial city loads)
 */
export function startBackgroundStaticPreload(currentCity: City): void {
  // Prioritize the most popular cities
  const popularCities: City[] = ["LA", "Seattle", "Boston", "Portland", "Toronto"];

  // Filter out current city and already cached cities
  const citiesToPreload = popularCities.filter(
    (c) => c !== currentCity && !cityStaticDataCache.has(c)
  );

  // Stagger preloading by 300ms each to avoid blocking UI
  citiesToPreload.forEach((city, index) => {
    setTimeout(() => {
      preloadCityStaticData(city);
    }, (index + 1) * 300);
  });
}
