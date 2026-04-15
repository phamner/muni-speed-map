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
  yards?: any | null;
  maxspeed: any | null;
  tunnelsBridges: any | null;
  separation: any | null;
  trafficLights: any | null;
  railContextHeavy?: any | null;
  railContextCommuter?: any | null;
  busRoutesOverlay?: any | null;
  ferryRoutesOverlay?: any | null;
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
  "Washington DC": "washington",
};

const cityToCommuterRailContextFilename: Partial<Record<City, string>> = {
  SF: "bayAreaRailContextCommuter.json",
  "San Jose": "bayAreaRailContextCommuter.json",
};

const railContextModules = import.meta.glob("./rail-context/*RailContext*.json");

type Coordinate = [number, number];
type LineStringCoordinates = Coordinate[];
type MultiLineStringCoordinates = LineStringCoordinates[];

function markAsHeritageLocalCirculator(routes: any): any {
  if (!routes?.features) return routes;
  return {
    ...routes,
    features: routes.features.map((feature: any) => ({
      ...feature,
      properties: {
        ...feature.properties,
        overlay_category: "heritage_local_circulator",
      },
    })),
  };
}

function mergeRouteCollections(...collections: Array<any | null | undefined>): any {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) => collection?.features || []),
  };
}

function coordinateKey(coord: [number, number]): string {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}

function mergeLineSegmentsIntoChains(
  lineStrings: Array<Array<[number, number]>>,
): Array<Array<[number, number]>> {
  const chains = lineStrings
    .filter((line) => Array.isArray(line) && line.length >= 2)
    .map((line) => [...line]);

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length; i += 1) {
      if (!chains[i]) continue;
      for (let j = i + 1; j < chains.length; j += 1) {
        if (!chains[j]) continue;

        const a = chains[i];
        const b = chains[j];
        const aStart = coordinateKey(a[0]);
        const aEnd = coordinateKey(a[a.length - 1]);
        const bStart = coordinateKey(b[0]);
        const bEnd = coordinateKey(b[b.length - 1]);

        let combined: Array<[number, number]> | null = null;

        if (aEnd === bStart) {
          combined = [...a, ...b.slice(1)];
        } else if (aEnd === bEnd) {
          combined = [...a, ...[...b].reverse().slice(1)];
        } else if (aStart === bEnd) {
          combined = [...b, ...a.slice(1)];
        } else if (aStart === bStart) {
          combined = [...[...b].reverse(), ...a.slice(1)];
        }

        if (combined) {
          chains[i] = combined;
          chains[j] = null as unknown as Array<[number, number]>;
          merged = true;
        }
      }
    }
  }

  return chains.filter(Boolean).sort((a, b) => b.length - a.length);
}

function orientWestToEast(line: Array<[number, number]>): Array<[number, number]> {
  if (line.length < 2) return line;
  return line[0][0] <= line[line.length - 1][0] ? line : [...line].reverse();
}

function maxLon(line: Array<[number, number]>): number {
  return Math.max(...line.map((coord) => coord[0]));
}

function minLon(line: Array<[number, number]>): number {
  return Math.min(...line.map((coord) => coord[0]));
}

function splitSfRouteAtExtremum(
  routes: any,
  routeId: string,
  selector: (coord: Coordinate) => number,
): any {
  if (!routes?.features) return routes;

  const features = routes.features.flatMap((feature: any) => {
    if (
      feature?.properties?.route_id !== routeId ||
      feature?.geometry?.type !== "MultiLineString" ||
      feature.geometry.coordinates.length !== 1
    ) {
      return [feature];
    }

    const coordinates: LineStringCoordinates = feature.geometry.coordinates[0];
    if (coordinates.length < 4) return [feature];

    let splitIndex = 0;
    let bestScore = Infinity;
    for (let i = 0; i < coordinates.length; i += 1) {
      const score = selector(coordinates[i]);
      if (score < bestScore) {
        bestScore = score;
        splitIndex = i;
      }
    }

    if (splitIndex <= 0 || splitIndex >= coordinates.length - 1) {
      return [feature];
    }

    const firstTrack = coordinates.slice(0, splitIndex + 1);
    const secondTrack = coordinates.slice(splitIndex);

    return [
      {
        ...feature,
        properties: {
          ...feature.properties,
          split_track_index: 0,
          split_track_anchor: coordinates[splitIndex],
        },
        geometry: {
          type: "LineString",
          coordinates: firstTrack,
        },
      },
      {
        ...feature,
        properties: {
          ...feature.properties,
          split_track_index: 1,
          split_track_anchor: coordinates[splitIndex],
        },
        geometry: {
          type: "LineString",
          coordinates: secondTrack,
        },
      },
    ];
  });

  return {
    ...routes,
    features,
  };
}

function splitSfRouteAtNearestPoint(
  routes: any,
  routeId: string,
  target: Coordinate,
): any {
  return splitSfRouteAtExtremum(
    routes,
    routeId,
    (coord) => Math.hypot(coord[0] - target[0], coord[1] - target[1]),
  );
}

function splitSfRouteAtNearestPoints(
  routes: any,
  routeId: string,
  targets: Coordinate[],
): any {
  if (!routes?.features) return routes;

  const features = routes.features.flatMap((feature: any) => {
    if (
      feature?.properties?.route_id !== routeId ||
      feature?.geometry?.type !== "MultiLineString" ||
      feature.geometry.coordinates.length !== 1
    ) {
      return [feature];
    }

    const coordinates: LineStringCoordinates = feature.geometry.coordinates[0];
    if (coordinates.length < 6) return [feature];

    const splitIndices = Array.from(
      new Set(
        targets
          .map((target) => {
            let bestIndex = 0;
            let bestDistance = Infinity;
            for (let i = 0; i < coordinates.length; i += 1) {
              const candidate = coordinates[i];
              const distance = Math.hypot(
                candidate[0] - target[0],
                candidate[1] - target[1],
              );
              if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
              }
            }
            return bestIndex;
          })
          .filter((index) => index > 0 && index < coordinates.length - 1),
      ),
    ).sort((a, b) => a - b);

    if (splitIndices.length !== 2) {
      return [feature];
    }

    const [firstIndex, secondIndex] = splitIndices.sort((a, b) => a - b);
    const anchors = [
      coordinates[firstIndex],
      coordinates[secondIndex],
    ];

    const firstTrack = coordinates.slice(firstIndex, secondIndex + 1);
    const secondTrack = coordinates
      .slice(secondIndex)
      .concat(coordinates.slice(0, firstIndex + 1));

    if (firstTrack.length < 2 || secondTrack.length < 2) {
      return [feature];
    }

    return [
      {
        ...feature,
        properties: {
          ...feature.properties,
          split_track_index: 0,
          split_track_anchors: anchors,
        },
        geometry: {
          type: "LineString",
          coordinates: firstTrack,
        },
      },
      {
        ...feature,
        properties: {
          ...feature.properties,
          split_track_index: 1,
          split_track_anchors: anchors,
        },
        geometry: {
          type: "LineString",
          coordinates: secondTrack,
        },
      },
    ];
  });

  return {
    ...routes,
    features,
  };
}

function splitSfSpecialTerminalRoutes(routes: any): any {
  const withNSplit = splitSfRouteAtExtremum(
    routes,
    "N",
    (coord) => coord[0],
  );
  return splitSfRouteAtExtremum(
    splitSfRouteAtNearestPoint(
      splitSfRouteAtNearestPoints(withNSplit, "F", [
        [-122.43518991583765, 37.762458195794686],
        [-122.41753648746798, 37.807537125931184],
      ]),
      "M",
      [-122.44531991339838, 37.72022653991381],
    ),
    "L",
    (coord) => coord[0] + coord[1],
  );
}

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
  "Washington DC": { center: [-77.0369, 38.9072], zoom: 11 },
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
        cableCarRoutes,
        stops,
        crossings,
        switches,
        yards,
        maxspeed,
        tunnelsBridges,
        separation,
        separationOverrides,
        trafficLights,
        busRoutesOverlay,
        ferryRoutesOverlay,
      ] = await Promise.all([
        import("./routes/sfMuniOsmRoutes.json"),
        import("./routes/sfCableCarRoutes.json"),
        import("./stops/muniMetroStops.json"),
        import("./crossings/sfGradeCrossings.json"),
        import("./switches/sfSwitches.json"),
        import("./yards/sfYards.json").catch(() => ({ default: null })),
        import("./maxspeed/sfMaxspeed.json"),
        import("./tunnels-bridges/sfTunnelsBridges.json").catch(() => ({ default: null })),
        import("./separation/sfSeparation.json").catch(() => ({ default: null })),
        import("./separation/sfSeparationOverrides.json").catch(() => ({ default: null })),
        import("./traffic-lights/sfTrafficLightsConsolidated.json").catch(() => ({
          default: null,
        })),
        import("./bus-routes/sfBusRoutesTest.json").catch(() => ({ default: null })),
        import("./rail-context/sfBayFerryRoutesOverlay.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);

      const sfRoutes = splitSfSpecialTerminalRoutes(routes.default);

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
        routes: mergeRouteCollections(
          sfRoutes,
          markAsHeritageLocalCirculator(cableCarRoutes.default),
        ),
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        yards: yards.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: mergedSeparation,
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
        ferryRoutesOverlay: ferryRoutesOverlay.default,
      };
    }

    case "LA": {
      const [
        routes,
        heritageRoutes,
        dLineExtension,
        bLineOsm,
        stops,
        crossings,
        switches,
        yards,
        maxspeed,
        tunnelsBridges,
        separation,
        separationOverrides,
        trafficLights,
        busRoutesOverlay,
      ] = await Promise.all([
        import("./routes/laMetroRoutes.json"),
        import("./routes/laHeritageLocalCirculatorRoutes.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./routes/laDLineOsm.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./routes/laBLineOsm.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./stops/laMetroStops.json"),
        import("./crossings/laGradeCrossings.json"),
        import("./switches/laSwitches.json"),
        import("./yards/laYards.json").catch(() => ({ default: null })),
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

      // Replace D Line (route 805) GTFS geometry with full ORM data so we get
      // two clean parallel tracks from VA Hospital → Union Station.
      // After changing this, run:  npm run backfill:segments -- --city LA --route 805 --force
      const baseLaRoutes = routes.default;
      const dLineOsmFeatures = dLineExtension.default?.features || [];
      const dLineOsmSegments: Array<Array<[number, number]>> =
        dLineOsmFeatures
          .map((feature: any) => feature?.geometry?.coordinates)
          .filter((coords: any) => Array.isArray(coords) && coords.length >= 2);

      const dLineOsmChains = mergeLineSegmentsIntoChains(dLineOsmSegments);

      let rebuiltLaRoutes = baseLaRoutes;
      if (dLineOsmChains.length >= 2) {
        const baseFeatures = baseLaRoutes?.features || [];

        // Pick the two longest chains that span the full corridor
        const westReachingChains = dLineOsmChains
          .filter((chain) => minLon(chain) < -118.40)
          .map(orientWestToEast)
          .sort((a, b) => b.length - a.length);

        let primary = westReachingChains[0] || [];
        let secondary = westReachingChains[1] || [];

        // If secondary is shorter (OSM gap), bridge it with eastern fragments
        // using the primary's geometry offset by the track separation so the
        // bridge follows the curve instead of cutting across.
        if (
          secondary.length >= 2 &&
          maxLon(secondary) < maxLon(primary) - 0.005
        ) {
          const eastFragments = dLineOsmChains
            .filter((chain) => chain.length >= 2 && minLon(chain) >= -118.40)
            .map(orientWestToEast)
            .sort((a, b) => b.length - a.length);

          for (const frag of eastFragments) {
            const secEnd = secondary[secondary.length - 1];
            const gap = Math.abs(frag[0][0] - secEnd[0]);
            if (gap < 0.04) {
              // Interpolate the primary's latitude at a given longitude
              const interpPrimaryLat = (lon: number): number => {
                for (let k = 1; k < primary.length; k++) {
                  const prev = primary[k - 1];
                  const cur = primary[k];
                  if ((prev[0] <= lon && cur[0] >= lon) || (cur[0] <= lon && prev[0] >= lon)) {
                    const span = cur[0] - prev[0];
                    if (Math.abs(span) < 1e-10) return prev[1];
                    const t = (lon - prev[0]) / span;
                    return prev[1] + t * (cur[1] - prev[1]);
                  }
                }
                return lon; // fallback (shouldn't happen)
              };

              // Measure the lat offset (secondary − primary) at both gap endpoints
              const startOffset = secEnd[1] - interpPrimaryLat(secEnd[0]);
              const endOffset = frag[0][1] - interpPrimaryLat(frag[0][0]);

              // Build bridge points by offsetting the primary's coords in the gap
              const bridgePoints: Array<[number, number]> = primary
                .filter((p) => p[0] > secEnd[0] && p[0] < frag[0][0])
                .map((p) => {
                  const t = (p[0] - secEnd[0]) / (frag[0][0] - secEnd[0]);
                  const offset = startOffset + t * (endOffset - startOffset);
                  return [p[0], p[1] + offset] as [number, number];
                });

              secondary = [...secondary, ...bridgePoints, ...frag];
              break;
            }
          }
        }

        if (primary.length >= 2 && secondary.length >= 2) {
          // Get base D Line feature for property templates
          const dLineBase = baseFeatures.find(
            (feature: any) => String(feature?.properties?.route_id) === "805",
          );
          const baseProps = dLineBase?.properties || {
            route_id: "805",
            route_name: "D Line (Purple)",
            route_color: "#A05DA5",
          };

          const nonDLineFeatures = baseFeatures.filter(
            (feature: any) => String(feature?.properties?.route_id) !== "805",
          );

          // Primary is outbound (west→east), secondary reversed is inbound (east→west)
          rebuiltLaRoutes = {
            ...baseLaRoutes,
            features: [
              ...nonDLineFeatures,
              {
                type: "Feature",
                properties: {
                  ...baseProps,
                  shape_id: "805OSM_FULL_EASTBOUND",
                  direction_id: "0",
                  direction: "outbound",
                  source: "OpenStreetMap/OpenRailwayMap",
                },
                geometry: {
                  type: "LineString",
                  coordinates: primary,
                },
              },
              {
                type: "Feature",
                properties: {
                  ...baseProps,
                  shape_id: "805OSM_FULL_WESTBOUND",
                  direction_id: "1",
                  direction: "inbound",
                  source: "OpenStreetMap/OpenRailwayMap",
                },
                geometry: {
                  type: "LineString",
                  coordinates: [...secondary].reverse(),
                },
              },
            ],
          };
        }
      }

      // --- B Line (Red) ORM replacement ---
      // Replace GTFS route 802 geometry with OpenRailwayMap data for accurate
      // two-track geometry from North Hollywood → Union Station.
      // After changing this, run:  npm run backfill:segments -- --city LA --route 802 --force
      const bLineOsmFeatures = bLineOsm.default?.features || [];
      const bLineOsmSegments: Array<Array<[number, number]>> =
        bLineOsmFeatures
          .map((feature: any) => feature?.geometry?.coordinates)
          .filter((coords: any) => Array.isArray(coords) && coords.length >= 2);

      const bLineOsmChains = mergeLineSegmentsIntoChains(bLineOsmSegments);

      if (bLineOsmChains.length >= 2) {
        const baseFeatures = rebuiltLaRoutes?.features || [];

        // Pick the two longest chains (full-route), orient NW→SE (decreasing lat)
        const sortedBChains = [...bLineOsmChains]
          .sort((a, b) => b.length - a.length)
          .slice(0, 2)
          .map(orientWestToEast); // NW end has smaller lon → orients NW→SE

        const bPrimary = sortedBChains[0] || [];
        const bSecondary = sortedBChains[1] || [];

        if (bPrimary.length >= 2 && bSecondary.length >= 2) {
          const bLineBase = baseFeatures.find(
            (feature: any) => String(feature?.properties?.route_id) === "802",
          );
          const bBaseProps = bLineBase?.properties || {
            route_id: "802",
            route_name: "B Line (Red)",
            route_color: "#E3131B",
          };

          const nonBLineFeatures = baseFeatures.filter(
            (feature: any) => String(feature?.properties?.route_id) !== "802",
          );

          // Primary NW→SE = outbound (direction 0), reversed = inbound (direction 1)
          rebuiltLaRoutes = {
            ...rebuiltLaRoutes,
            features: [
              ...nonBLineFeatures,
              {
                type: "Feature",
                properties: {
                  ...bBaseProps,
                  shape_id: "802OSM_FULL_OUTBOUND",
                  direction_id: "0",
                  direction: "outbound",
                  source: "OpenStreetMap/OpenRailwayMap",
                },
                geometry: {
                  type: "LineString",
                  coordinates: bPrimary,
                },
              },
              {
                type: "Feature",
                properties: {
                  ...bBaseProps,
                  shape_id: "802OSM_FULL_INBOUND",
                  direction_id: "1",
                  direction: "inbound",
                  source: "OpenStreetMap/OpenRailwayMap",
                },
                geometry: {
                  type: "LineString",
                  coordinates: [...bSecondary].reverse(),
                },
              },
            ],
          };
        }
      }

      return {
        routes: mergeRouteCollections(
          rebuiltLaRoutes,
          heritageRoutes.default,
        ),
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        yards: yards.default,
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
        heritageRoutes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
        trafficLights,
        busRoutesOverlay,
        ferryRoutesOverlay,
      ] = await Promise.all([
        import("./routes/seattleLinkRoutes.json"),
        import("./routes/seattleHeritageLocalCirculatorRoutes.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
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
        import("./rail-context/seattleFerryRoutesOverlay.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: mergeRouteCollections(routes.default, heritageRoutes.default),
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
        ferryRoutesOverlay: ferryRoutesOverlay.default,
      };
    }

    case "Boston": {
      const [
        routes,
        heritageRoutes,
        stops,
        crossings,
        switches,
        maxspeed,
        tunnelsBridges,
        separation,
        trafficLights,
        busRoutesOverlay,
        ferryRoutesOverlay,
      ] = await Promise.all([
        import("./routes/bostonGreenLineRoutes.json"),
        import("./routes/bostonHeritageLocalCirculatorRoutes.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
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
        import("./rail-context/bostonFerryRoutesOverlay.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      return {
        routes: mergeRouteCollections(routes.default, heritageRoutes.default),
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: maxspeed.default,
        tunnelsBridges: tunnelsBridges.default,
        separation: separation.default,
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
        ferryRoutesOverlay: ferryRoutesOverlay.default,
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
        ferryRoutesOverlay,
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
        import("./rail-context/sanDiegoFerryRoutesOverlay.json").catch(() => ({
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
        ferryRoutesOverlay: ferryRoutesOverlay.default,
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
        ferryRoutesOverlay,
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
        import("./rail-context/torontoFerryRoutesOverlay.json").catch(() => ({
          default: null,
        })),
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
        ferryRoutesOverlay: ferryRoutesOverlay.default,
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
        ferryRoutesOverlay,
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
        import("./rail-context/phillyFerryRoutesOverlay.json").catch(() => ({
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
        trafficLights: trafficLights.default,
        busRoutesOverlay: busRoutesOverlay.default,
        ferryRoutesOverlay: ferryRoutesOverlay.default,
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
        heritageRoutes,
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
        import("./routes/phoenixHeritageLocalCirculatorRoutes.json").catch(
          () => ({
            default: { type: "FeatureCollection", features: [] },
          }),
        ),
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
        routes: mergeRouteCollections(routes.default, heritageRoutes.default),
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
        ferryRoutesOverlay,
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
        import("./rail-context/baltimoreFerryRoutesOverlay.json").catch(() => ({
          default: null,
        })),
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
        ferryRoutesOverlay: ferryRoutesOverlay.default,
      };
    }

    case "Washington DC": {
      const [previewRoutes, stops, crossings, switches, trafficLights, ferryRoutesOverlay] = await Promise.all([
        import("./routes/washingtonPreviewRoutes.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./stops/washingtonPurpleLineStops.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./crossings/washingtonPurpleLineGradeCrossings.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./switches/washingtonPurpleLineSwitches.json").catch(() => ({
          default: { type: "FeatureCollection", features: [] },
        })),
        import("./traffic-lights/washingtonPurpleLineTrafficLightsConsolidated.json").catch(
          () => ({
            default: { type: "FeatureCollection", features: [] },
          }),
        ),
        import("./rail-context/washingtonFerryRoutesOverlay.json").catch(() => ({
          default: null,
        })),
      ]);
      console.timeEnd(`Loading ${city} static data`);
      const normalizedPreviewRoutes = {
        type: "FeatureCollection",
        features: (previewRoutes.default?.features || []).map((feature: any) => ({
          ...feature,
          properties: {
            ...feature.properties,
            under_construction: false,
            overlay_category: undefined,
          },
        })),
      };
      return {
        routes: normalizedPreviewRoutes,
        stops: stops.default,
        crossings: crossings.default,
        switches: switches.default,
        maxspeed: null,
        tunnelsBridges: null,
        separation: null,
        trafficLights: trafficLights.default,
        busRoutesOverlay: null,
        ferryRoutesOverlay: ferryRoutesOverlay.default,
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
        ferryRoutesOverlay: null,
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
