/**
 * Lazy loaders for city data - enables code splitting
 * Each city's data is loaded on-demand when the user clicks that city
 * This dramatically reduces initial bundle size and page load time
 */

import type { City } from "../types";
import slcRailContextHeavy from "./rail-context/slcRailContextHeavy.json";
import slcRailContextCommuter from "./rail-context/slcRailContextCommuter.json";

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
  busRoutesOverlay?: any | null;
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
  Pittsburgh: "pittsburgh",
  Minneapolis: "minneapolis",
  Denver: "denver",
  "Salt Lake City": "slc",
  "San Jose": "vta",
  Phoenix: "phoenix",
  Cleveland: "cleveland",
  Charlotte: "charlotte",
  Baltimore: "baltimore",
};

const cityToCommuterRailContextFilename: Partial<Record<City, string>> = {
  SF: "bayAreaRailContextCommuter.json",
  "San Jose": "bayAreaRailContextCommuter.json",
};

const railContextModules = import.meta.glob("./rail-context/*RailContext*.json");

type Coordinate = [number, number];
type LineStringCoordinates = Coordinate[];
type MultiLineStringCoordinates = LineStringCoordinates[];

function endpointDistance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function stitchNorthboundSegments(
  segments: MultiLineStringCoordinates,
): LineStringCoordinates {
  if (segments.length === 0) return [];
  if (segments.length === 1) return segments[0];

  const remaining = segments.map((segment) => [...segment]);
  let startIndex = 0;
  let startLat = Infinity;

  for (let i = 0; i < remaining.length; i++) {
    const segment = remaining[i];
    const firstLat = segment[0]?.[1] ?? Infinity;
    const lastLat = segment[segment.length - 1]?.[1] ?? Infinity;
    const minLat = Math.min(firstLat, lastLat);
    if (minLat < startLat) {
      startLat = minLat;
      startIndex = i;
    }
  }

  const initial = remaining.splice(startIndex, 1)[0];
  let merged =
    initial[0][1] <= initial[initial.length - 1][1]
      ? [...initial]
      : [...initial].reverse();

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestSegment = remaining[0];
    let bestDistance = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const segment = remaining[i];
      const forwardDistance = endpointDistance(
        merged[merged.length - 1],
        segment[0],
      );
      const reversedDistance = endpointDistance(
        merged[merged.length - 1],
        segment[segment.length - 1],
      );

      if (forwardDistance < bestDistance) {
        bestDistance = forwardDistance;
        bestIndex = i;
        bestSegment = [...segment];
      }

      if (reversedDistance < bestDistance) {
        bestDistance = reversedDistance;
        bestIndex = i;
        bestSegment = [...segment].reverse();
      }
    }

    remaining.splice(bestIndex, 1);
    const last = merged[merged.length - 1];
    const first = bestSegment[0];
    merged = merged.concat(
      last[0] === first[0] && last[1] === first[1]
        ? bestSegment.slice(1)
        : bestSegment,
    );
  }

  return merged;
}

function normalizeTorontoCommuterRailContext(data: any | null): any | null {
  if (!data?.features) return data;

  return {
    ...data,
    features: data.features.map((feature: any) => {
      if (
        feature?.properties?.route_id !== "01260426-ST" ||
        feature?.geometry?.type !== "MultiLineString"
      ) {
        return feature;
      }

      return {
        ...feature,
        geometry: {
          type: "LineString",
          coordinates: stitchNorthboundSegments(feature.geometry.coordinates),
        },
      };
    }),
  };
}

async function loadRailContextData(city: City): Promise<{
  railContextHeavy: any | null;
  railContextCommuter: any | null;
}> {
  // Deterministic fallback for SLC to avoid any glob-indexing edge cases.
  if (city === "Salt Lake City") {
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
  const commuterFilename =
    cityToCommuterRailContextFilename[city] ||
    `${prefix}RailContextCommuter.json`;

  const getFilename = (key: string) => {
    const noQuery = key.split("?")[0];
    const parts = noQuery.split("/");
    return parts[parts.length - 1];
  };

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
    railContextCommuter:
      city === "Toronto"
        ? normalizeTorontoCommuterRailContext((commuter as any)?.default || null)
        : (commuter as any)?.default || null,
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
  Pittsburgh: { center: [-80.01941337992724, 40.38898236744643], zoom: 11 },
  Minneapolis: { center: [-93.2023633249224, 44.9483201926178], zoom: 11 },
  Denver: { center: [-104.98772423634054, 39.68748990782979], zoom: 11 },
  "Salt Lake City": {
    center: [-111.90206770747481, 40.67840883957848],
    zoom: 11,
  },
  "San Jose": { center: [-121.89, 37.34], zoom: 11 },
  Phoenix: { center: [-112.0, 33.47], zoom: 11 },
  Cleveland: { center: [-81.69, 41.5], zoom: 11 },
  Charlotte: { center: [-80.84, 35.23], zoom: 11 },
  Baltimore: { center: [-76.62, 39.32], zoom: 11 },
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
export function preloadCityStaticData(city: City): Promise<void> {
  if (cityStaticDataCache.has(city) || loadingPromises.has(city)) {
    return Promise.resolve();
  }
  return loadCityData(city)
    .then(() => {})
    .catch(() => {
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
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/muniMetroRoutes.json"),
        import("./stops/muniMetroStops.json"),
        import("./crossings/sfGradeCrossings.json"),
        import("./switches/sfSwitches.json"),
        import("./maxspeed/sfMaxspeed.json"),
        import("./tunnels-bridges/sfTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/sfSeparation.json").catch(() => ({ default: null })),
        import("./separation/sfSeparationOverrides.json").catch(() => ({ default: null })),
        import("./traffic-lights/sfTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/sfBusRoutesTest.json").catch(() => ({ default: null })),
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
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/laMetroRoutes.json"),
        import("./stops/laMetroStops.json"),
        import("./crossings/laGradeCrossings.json"),
        import("./switches/laSwitches.json"),
        import("./maxspeed/laMaxspeed.json"),
        import("./tunnels-bridges/laTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/laSeparation.json").catch(() => ({ default: null })),
        import("./separation/laSeparationOverrides.json").catch(() => ({ default: null })),
        import("./traffic-lights/laTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/laBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/seattleLinkRoutes.json"),
        import("./stops/seattleLinkStops.json"),
        import("./crossings/seattleGradeCrossings.json"),
        import("./switches/seattleSwitches.json"),
        import("./maxspeed/seattleMaxspeed.json"),
        import("./tunnels-bridges/seattleTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/seattleSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/seattleTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/seattleBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/bostonGreenLineRoutes.json"),
        import("./stops/bostonGreenLineStops.json"),
        import("./crossings/bostonGradeCrossings.json"),
        import("./switches/bostonSwitches.json"),
        import("./maxspeed/bostonMaxspeed.json"),
        import("./tunnels-bridges/bostonTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/bostonSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/bostonTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/bostonBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/portlandMaxRoutes.json"),
        import("./stops/portlandMaxStops.json"),
        import("./crossings/portlandGradeCrossings.json"),
        import("./switches/portlandSwitches.json"),
        import("./maxspeed/portlandMaxspeed.json"),
        import("./tunnels-bridges/portlandTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./separation/portlandSeparation.json").catch(() => ({ default: null })),
        import("./separation/portlandSeparationOverrides.json").catch(() => ({
          default: null,
        })),
        import("./traffic-lights/portlandTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/portlandBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/sanDiegoTrolleyRoutes.json"),
        import("./stops/sanDiegoTrolleyStops.json"),
        import("./crossings/sanDiegoGradeCrossings.json"),
        import("./switches/sanDiegoSwitches.json"),
        import("./maxspeed/sanDiegoMaxspeed.json"),
        import("./tunnels-bridges/sanDiegoTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./separation/sanDiegoSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/sanDiegoTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/sanDiegoBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/torontoStreetcarRoutes.json"),
        import("./routes/torontoLrtRoutes.json"),
        import("./stops/torontoStreetcarStops.json"),
        import("./crossings/torontoGradeCrossings.json"),
        import("./switches/torontoSwitches.json"),
        import("./tunnels-bridges/torontoTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/torontoSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/torontoTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/torontoBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/phillyTrolleyRoutes.json"),
        import("./stops/phillyTrolleyStops.json"),
        import("./crossings/phillyGradeCrossings.json"),
        import("./switches/phillySwitches.json"),
        import("./maxspeed/phillyMaxspeed.json"),
        import("./tunnels-bridges/phillyTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/phillySeparation.json").catch(() => ({ default: null })),
        import("./separation/phillySeparationOverrides.json").catch(() => ({
          default: null,
        })),
        import("./traffic-lights/phillyTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/phillyBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
      };
    }

    case "Pittsburgh": {
      const [
        routes,
        stops,
        crossings,
        switches,
        tunnelsBridges,
        separation,
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/pittsburghTRoutes.json"),
        import("./stops/pittsburghTStops.json"),
        import("./crossings/pittsburghGradeCrossings.json"),
        import("./switches/pittsburghSwitches.json"),
        import("./tunnels-bridges/pittsburghTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./separation/pittsburghSeparation.json").catch(() => ({
          default: null,
        })),
        import("./traffic-lights/pittsburghTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/pittsburghBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/minneapolisMetroRoutes.json"),
        import("./stops/minneapolisMetroStops.json"),
        import("./crossings/minneapolisGradeCrossings.json"),
        import("./switches/minneapolisSwitches.json"),
        import("./maxspeed/minneapolisMaxspeed.json"),
        import("./tunnels-bridges/minneapolisTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./separation/minneapolisSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/minneapolisTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/minneapolisBusRoutesTest.json").catch(() => ({
          default: null,
        })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/denverRtdRoutes.json"),
        import("./stops/denverRtdStops.json"),
        import("./crossings/denverGradeCrossings.json"),
        import("./switches/denverSwitches.json"),
        import("./maxspeed/denverMaxspeed.json"),
        import("./tunnels-bridges/denverTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/denverSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/denverTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/denverBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/slcTraxRoutes.json"),
        import("./stops/slcTraxStops.json"),
        import("./crossings/slcGradeCrossings.json"),
        import("./switches/slcSwitches.json"),
        import("./maxspeed/slcMaxspeed.json"),
        import("./tunnels-bridges/slcTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/slcSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/slcTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/slcBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/vtaLightRailRoutes.json"),
        import("./stops/vtaLightRailStops.json"),
        import("./crossings/sanJoseGradeCrossings.json"),
        import("./switches/sanJoseSwitches.json"),
        import("./maxspeed/vtaMaxspeed.json"),
        import("./tunnels-bridges/vtaTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/vtaSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/sanJoseTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/vtaBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
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
        separationOverrides,
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/phoenixLightRailRoutes.json"),
        import("./stops/phoenixLightRailStops.json"),
        import("./crossings/phoenixGradeCrossings.json"),
        import("./switches/phoenixSwitches.json"),
        import("./maxspeed/phoenixMaxspeed.json"),
        import("./tunnels-bridges/phoenixTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/phoenixSeparation.json").catch(() => ({ default: null })),
        import("./separation/phoenixSeparationOverrides.json").catch(() => ({
          default: null,
        })),
        import("./traffic-lights/phoenixTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/phoenixBusRoutesTest.json").catch(() => ({ default: null })),
      ]);
      console.timeEnd(`Loading ${city} static data`);

      // Merge separation data with manual overrides (overrides render on top)
      let mergedSeparation: any = separation.default;
      if (separationOverrides.default?.features?.length) {
        const osmFeatures = separation.default?.features || [];
        const overrideFeatures = separationOverrides.default.features;
        mergedSeparation = {
          type: "FeatureCollection",
          features: [...overrideFeatures, ...osmFeatures],
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
        busRoutesOverlay: busRoutesOverlay.default,
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
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/charlotteLightRailRoutes.json"),
        import("./stops/charlotteLightRailStops.json"),
        import("./crossings/charlotteGradeCrossings.json"),
        import("./switches/charlotteSwitches.json"),
        import("./maxspeed/charlotteMaxspeed.json"),
        import("./tunnels-bridges/charlotteTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./separation/charlotteSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/charlotteTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/charlotteBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
      };
    }

    case "Baltimore": {
      const [
        routes,
        stops,
        crossings,
        switches,
        tunnelsBridges,
        separation,
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/baltimoreLightRailRoutes.json"),
        import("./stops/baltimoreLightRailStops.json"),
        import("./crossings/baltimoreGradeCrossings.json"),
        import("./switches/baltimoreSwitches.json"),
        import("./tunnels-bridges/baltimoreTunnelsBridges.json").catch(() => ({
          default: null,
        })),
        import("./separation/baltimoreSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/baltimoreTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/baltimoreBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
      };
    }

    case "Cleveland": {
      const [
        routes,
        stops,
        crossings,
        switches,
        maxspeed,
        separation,
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/clevelandRtaRoutes.json"),
        import("./stops/clevelandRtaStops.json"),
        import("./crossings/clevelandGradeCrossings.json"),
        import("./switches/clevelandSwitches.json"),
        import("./maxspeed/clevelandMaxspeed.json").catch(() => ({ default: null })),
        import("./separation/clevelandSeparation.json").catch(() => ({ default: null })),
        import("./traffic-lights/clevelandTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/clevelandBusRoutesTest.json").catch(() => ({ default: null })),
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
        trafficLights: trafficLights?.default || null,
        busRoutesOverlay: busRoutesOverlay?.default || null,
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
export function startBackgroundStaticPreload(
  currentCity: City,
  onComplete?: () => void,
): void {
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

  if (citiesToPreload.length === 0) {
    // Nothing to preload, call completion immediately
    onComplete?.();
    return;
  }

  let completedCount = 0;

  // Stagger preloading by 300ms each to avoid blocking UI
  citiesToPreload.forEach((city, index) => {
    setTimeout(
      () => {
        preloadCityStaticData(city)
          .then(() => {
            completedCount++;
            if (completedCount === citiesToPreload.length) {
              // All cities preloaded
              onComplete?.();
            }
          })
          .catch(() => {
            // Count failed preloads as complete to avoid hanging
            completedCount++;
            if (completedCount === citiesToPreload.length) {
              onComplete?.();
            }
          });
      },
      (index + 1) * 300,
    );
  });
}
