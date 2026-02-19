/**
 * Lazy loaders for city data - enables code splitting
 * Each city's data is loaded on-demand when the user clicks that city
 * This dramatically reduces initial bundle size and page load time
 */

import type { City } from "../types";
import slcRailContextHeavy from "./slcRailContextHeavy.json";
import slcRailContextCommuter from "./slcRailContextCommuter.json";

// Type for city static data (routes, stops, crossings, switches, maxspeed, tunnelsBridges, separation, trafficLights)
export interface CityStaticData {
  routes: any;
  stops: any;
  crossings: any;
  switches: any;
  maxspeed: any | null;
  tunnelsBridges: any | null;
  separation: any | null;
  trafficLights: any | null;
  railContextHeavy?: any | null;
  railContextCommuter?: any | null;
}

const cityToRailContextPrefix: Partial<Record<City, string>> = {
  SF: "sf",
  LA: "la",
  Seattle: "seattle",
  Boston: "boston",
  Portland: "portland",
  "San Diego": "sanDiego",
  Toronto: "toronto",
  Philadelphia: "philly",
  Sacramento: "sacramento",
  Pittsburgh: "pittsburgh",
  Dallas: "dallas",
  Minneapolis: "minneapolis",
  Denver: "denver",
  "Salt Lake City": "slc",
  "San Jose": "vta",
  Phoenix: "phoenix",
  "Jersey City": "hblr",
  Calgary: "calgary",
  Edmonton: "edmonton",
  Cleveland: "cleveland",
  Charlotte: "charlotte",
  Baltimore: "baltimore",
  Washington: "washington",
};

const railContextModules = import.meta.glob("./*RailContext*.json");
let railContextDebugLogged = false;

async function loadRailContextData(city: City): Promise<{
  railContextHeavy: any | null;
  railContextCommuter: any | null;
}> {
  // Deterministic fallback for SLC to avoid any glob-indexing edge cases.
  if (city === "Salt Lake City") {
    console.log(
      `SLC rail context static import: heavy=${slcRailContextHeavy?.features?.length || 0}, commuter=${slcRailContextCommuter?.features?.length || 0}`,
    );
    return {
      railContextHeavy: (slcRailContextHeavy as any) || null,
      railContextCommuter: (slcRailContextCommuter as any) || null,
    };
  }

  const prefix = cityToRailContextPrefix[city];
  if (!prefix) {
    return { railContextHeavy: null, railContextCommuter: null };
  }

  const heavyFilename = `${prefix}RailContextHeavy.json`;
  const commuterFilename = `${prefix}RailContextCommuter.json`;

  const getFilename = (key: string) => {
    const noQuery = key.split("?")[0];
    const parts = noQuery.split("/");
    return parts[parts.length - 1];
  };

  if (!railContextDebugLogged) {
    railContextDebugLogged = true;
    console.log(
      "Rail context module keys:",
      Object.keys(railContextModules).map(getFilename),
    );
  }

  // Vite glob keys can vary by format; resolve by filename suffix for robustness.
  const heavyLoader = Object.entries(railContextModules).find(
    ([key]) => getFilename(key) === heavyFilename,
  )?.[1];
  const commuterLoader = Object.entries(railContextModules).find(
    ([key]) => getFilename(key) === commuterFilename,
  )?.[1];

  const [heavy, commuter] = await Promise.all([
    heavyLoader ? heavyLoader() : Promise.resolve(null),
    commuterLoader ? commuterLoader() : Promise.resolve(null),
  ]);

  if (!heavyLoader && !commuterLoader) {
    console.warn(
      `Rail context files not found for ${city} (expected ${heavyFilename} / ${commuterFilename})`,
    );
  }

  return {
    railContextHeavy: (heavy as any)?.default || null,
    railContextCommuter: (commuter as any)?.default || null,
  };
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
  "San Diego": { center: [-117.16338943173511, 32.76334066930366], zoom: 11 },
  Toronto: { center: [-79.38, 43.65], zoom: 11 },
  Philadelphia: { center: [-75.2495383789954, 39.9514002426764], zoom: 11 },
  Sacramento: { center: [-121.49, 38.58], zoom: 11 },
  Pittsburgh: { center: [-80.01941337992724, 40.38898236744643], zoom: 11 },
  Dallas: { center: [-96.8, 32.78], zoom: 11 },
  Minneapolis: { center: [-93.2023633249224, 44.9483201926178], zoom: 11 },
  Denver: { center: [-104.98772423634054, 39.68748990782979], zoom: 11 },
  "Salt Lake City": {
    center: [-111.90206770747481, 40.67840883957848],
    zoom: 11,
  },
  "San Jose": { center: [-121.89, 37.34], zoom: 11 },
  Phoenix: { center: [-112.0, 33.47], zoom: 11 },
  // Placeholder cities (no data yet)
  "Jersey City": { center: [-74.05, 40.73], zoom: 11 },
  Calgary: { center: [-114.07, 51.05], zoom: 11 },
  Edmonton: { center: [-113.5, 53.55], zoom: 11 },
  Cleveland: { center: [-81.69, 41.5], zoom: 11 },
  Charlotte: { center: [-80.84, 35.23], zoom: 11 },
  Baltimore: { center: [-76.62, 39.32], zoom: 11 },
  Washington: { center: [-77.03, 38.91], zoom: 11 },
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
    const railContext = await loadRailContextData(city);
    const dataWithRailContext: CityStaticData = { ...data, ...railContext };
    cityStaticDataCache.set(city, dataWithRailContext);
    return dataWithRailContext;
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
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
        separationOverrides,
        trafficLights,
      ] = await Promise.all([
        import("./muniMetroRoutes.json"),
        import("./muniMetroStops.json"),
        import("./sfGradeCrossings.json"),
        import("./sfSwitches.json"),
        import("./sfMaxspeed.json"),
        import("./sfTunnelsBridges.json").catch(() => ({ default: null })),
        import("./sfSeparation.json").catch(() => ({ default: null })),
        import("./sfSeparationOverrides.json").catch(() => ({ default: null })),
        import("./sfTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);

      // Merge separation data with manual overrides (overrides take precedence)
      let mergedSeparation: any = separation.default;
      if (separationOverrides.default?.features?.length) {
        const osmFeatures = separation.default?.features || [];
        const overrideFeatures = separationOverrides.default.features;
        mergedSeparation = {
          type: "FeatureCollection",
          features: [...overrideFeatures, ...osmFeatures], // Overrides first so they render on top
        };
      }

      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: mergedSeparation,
        trafficLights: trafficLights.default,
      };
    }

    case "LA": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
        separationOverrides,
      ] = await Promise.all([
        import("./laMetroRoutes.json"),
        import("./laMetroStops.json"),
        import("./laGradeCrossings.json"),
        import("./laSwitches.json"),
        import("./laMaxspeed.json"),
        import("./laTunnelsBridges.json").catch(() => ({ default: null })),
        import("./laSeparation.json").catch(() => ({ default: null })),
        import("./laSeparationOverrides.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);

      // Merge separation data with manual overrides (OSM data takes precedence for elevated/tunnel sections)
      // Override features come FIRST so OSM features render on top and show elevated sections
      let mergedSeparation: any = separation.default;
      if (separationOverrides.default?.features?.length) {
        const osmFeatures = separation.default?.features || [];
        const overrideFeatures = separationOverrides.default.features;
        mergedSeparation = {
          type: "FeatureCollection",
          features: [...overrideFeatures, ...osmFeatures], // Overrides first, OSM on top
        };
      }

      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: mergedSeparation,
        trafficLights: null,
      };
    }

    case "Seattle": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./seattleLinkRoutes.json"),
        import("./seattleLinkStops.json"),
        import("./seattleGradeCrossings.json"),
        import("./seattleSwitches.json"),
        import("./seattleMaxspeed.json"),
        import("./seattleTunnelsBridges.json").catch(() => ({ default: null })),
        import("./seattleSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Boston": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./bostonGreenLineRoutes.json"),
        import("./bostonGreenLineStops.json"),
        import("./bostonGradeCrossings.json"),
        import("./bostonSwitches.json"),
        import("./bostonMaxspeed.json"),
        import("./bostonTunnelsBridges.json").catch(() => ({ default: null })),
        import("./bostonSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Portland": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
        overrides,
      ] = await Promise.all([
        import("./portlandMaxRoutes.json"),
        import("./portlandMaxStops.json"),
        import("./portlandGradeCrossings.json"),
        import("./portlandSwitches.json"),
        import("./portlandMaxspeed.json"),
        import("./portlandTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./portlandSeparation.json").catch(() => ({ default: null })),
        import("./portlandSeparationOverrides.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);

      // Merge OSM separation data with manual overrides
      const mergedSeparationFeatures = [
        ...(separation.default?.features || []),
        ...(overrides.default?.features || []),
      ];

      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: {
          type: "FeatureCollection",
          features: mergedSeparationFeatures,
        },
        trafficLights: null,
      };
    }

    case "San Diego": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./sanDiegoTrolleyRoutes.json"),
        import("./sanDiegoTrolleyStops.json"),
        import("./sanDiegoGradeCrossings.json"),
        import("./sanDiegoSwitches.json"),
        import("./sanDiegoMaxspeed.json"),
        import("./sanDiegoTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./sanDiegoSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Toronto": {
      const [
        streetcarRoutes,
        lrtRoutes,
        stops,
        crossings,
        switches,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./torontoStreetcarRoutes.json"),
        import("./torontoLrtRoutes.json"),
        import("./torontoStreetcarStops.json"),
        import("./torontoGradeCrossings.json"),
        import("./torontoSwitches.json"),
        import("./torontoTunnelsBridges.json").catch(() => ({ default: null })),
        import("./torontoSeparation.json").catch(() => ({ default: null })),
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
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Philadelphia": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
        overrides,
      ] = await Promise.all([
        import("./phillyTrolleyRoutes.json"),
        import("./phillyTrolleyStops.json"),
        import("./phillyGradeCrossings.json"),
        import("./phillySwitches.json"),
        import("./phillyMaxspeed.json"),
        import("./phillyTunnelsBridges.json").catch(() => ({ default: null })),
        import("./phillySeparation.json").catch(() => ({ default: null })),
        import("./phillySeparationOverrides.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);

      // Merge OSM separation data with manual overrides
      const mergedSeparationFeatures = [
        ...(separation.default?.features || []),
        ...(overrides.default?.features || []),
      ];

      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: {
          type: "FeatureCollection",
          features: mergedSeparationFeatures,
        },
        trafficLights: null,
      };
    }

    case "Sacramento": {
      const [routes, stops, crossings, switches, tunnelsBridges, separation] =
        await Promise.all([
          import("./sacramentoLightRailRoutes.json"),
          import("./sacramentoLightRailStops.json"),
          import("./sacramentoGradeCrossings.json"),
          import("./sacramentoSwitches.json"),
          import("./sacramentoTunnelsBridges.json").catch(() => ({
            default: null,
          })),
          import("./sacramentoSeparation.json").catch(() => ({
            default: null,
          })),
        ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Pittsburgh": {
      const [routes, stops, crossings, switches, tunnelsBridges, separation] =
        await Promise.all([
          import("./pittsburghTRoutes.json"),
          import("./pittsburghTStops.json"),
          import("./pittsburghGradeCrossings.json"),
          import("./pittsburghSwitches.json"),
          import("./pittsburghTunnelsBridges.json").catch(() => ({
            default: null,
          })),
          import("./pittsburghSeparation.json").catch(() => ({
            default: null,
          })),
        ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Dallas": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./dallasDartRoutes.json"),
        import("./dallasDartStops.json"),
        import("./dallasGradeCrossings.json"),
        import("./dallasSwitches.json"),
        import("./dallasMaxspeed.json"),
        import("./dallasTunnelsBridges.json").catch(() => ({ default: null })),
        import("./dallasSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Minneapolis": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./minneapolisMetroRoutes.json"),
        import("./minneapolisMetroStops.json"),
        import("./minneapolisGradeCrossings.json"),
        import("./minneapolisSwitches.json"),
        import("./minneapolisMaxspeed.json"),
        import("./minneapolisTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./minneapolisSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Denver": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./denverRtdRoutes.json"),
        import("./denverRtdStops.json"),
        import("./denverGradeCrossings.json"),
        import("./denverSwitches.json"),
        import("./denverMaxspeed.json"),
        import("./denverTunnelsBridges.json").catch(() => ({ default: null })),
        import("./denverSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Salt Lake City": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./slcTraxRoutes.json"),
        import("./slcTraxStops.json"),
        import("./slcGradeCrossings.json"),
        import("./slcSwitches.json"),
        import("./slcMaxspeed.json"),
        import("./slcTunnelsBridges.json").catch(() => ({ default: null })),
        import("./slcSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "San Jose": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./vtaLightRailRoutes.json"),
        import("./vtaLightRailStops.json"),
        import("./sanJoseGradeCrossings.json"),
        import("./sanJoseSwitches.json"),
        import("./vtaMaxspeed.json"),
        import("./vtaTunnelsBridges.json").catch(() => ({ default: null })),
        import("./vtaSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Phoenix": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./phoenixLightRailRoutes.json"),
        import("./phoenixLightRailStops.json"),
        import("./phoenixGradeCrossings.json"),
        import("./phoenixSwitches.json"),
        import("./phoenixMaxspeed.json"),
        import("./phoenixTunnelsBridges.json").catch(() => ({ default: null })),
        import("./phoenixSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Charlotte": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./charlotteLightRailRoutes.json"),
        import("./charlotteLightRailStops.json"),
        import("./charlotteGradeCrossings.json"),
        import("./charlotteSwitches.json"),
        import("./charlotteMaxspeed.json"),
        import("./charlotteTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./charlotteSeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Calgary": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
      ] = await Promise.all([
        import("./calgaryLightRailRoutes.json"),
        import("./calgaryLightRailStops.json"),
        import("./calgaryGradeCrossings.json"),
        import("./calgarySwitches.json"),
        import("./calgaryMaxspeed.json"),
        import("./calgaryTunnelsBridges.json").catch(() => ({ default: null })),
        import("./calgarySeparation.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Baltimore": {
      const [routes, stops, crossings, switches, tunnelsBridges, separation] =
        await Promise.all([
          import("./baltimoreLightRailRoutes.json"),
          import("./baltimoreLightRailStops.json"),
          import("./baltimoreGradeCrossings.json"),
          import("./baltimoreSwitches.json"),
          import("./baltimoreTunnelsBridges.json").catch(() => ({
            default: null,
          })),
          import("./baltimoreSeparation.json").catch(() => ({ default: null })),
        ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null, // No maxspeed data in OSM for Baltimore
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: null,
      };
    }

    case "Cleveland": {
      const [routes, stops, crossings, switches, maxspeed, separation] =
        await Promise.all([
          import("./clevelandRtaRoutes.json"),
          import("./clevelandRtaStops.json"),
          import("./clevelandGradeCrossings.json"),
          import("./clevelandSwitches.json"),
          import("./clevelandMaxspeed.json").catch(() => ({ default: null })),
          import("./clevelandSeparation.json").catch(() => ({ default: null })),
        ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: routes.default,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed?.default || null,
        tunnelsBridges: null, // No tunnels/bridges data yet
        separation: separation?.default || null,
        trafficLights: null,
      };
    }

    // Placeholder cities - return empty data
    case "Jersey City":
    case "Edmonton": {
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: { type: "FeatureCollection", features: [] },
        stops: { type: "FeatureCollection", features: [] },
        crossings: { type: "FeatureCollection", features: [] },
        switches: { type: "FeatureCollection", features: [] },
        maxspeed: null,
        tunnelsBridges: null,
        separation: null,
        trafficLights: null,
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
        tunnelsBridges: null,
        separation: null,
        trafficLights: null,
      };
    }
  }
}

/**
 * Start background preloading for popular cities (called after initial city loads)
 */
export function startBackgroundStaticPreload(currentCity: City): void {
  // Prioritize the most popular cities
  const popularCities: City[] = [
    "LA",
    "Seattle",
    "Boston",
    "Portland",
    "Toronto",
  ];

  // Filter out current city and already cached cities
  const citiesToPreload = popularCities.filter(
    (c) => c !== currentCity && !cityStaticDataCache.has(c),
  );

  // Stagger preloading by 300ms each to avoid blocking UI
  citiesToPreload.forEach((city, index) => {
    setTimeout(
      () => {
        preloadCityStaticData(city);
      },
      (index + 1) * 300,
    );
  });
}
