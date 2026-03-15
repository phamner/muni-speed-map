import type { City } from "../../types";
import { supabase } from "../../lib/supabase";
import { MAX_DISTANCE_FROM_ROUTE_METERS } from "./geoUtils";
import {
  findNearestPointOnLine,
  SEGMENT_SIZE_METERS,
  SEGMENT_SIZE_500_METERS,
  CITIES_WITH_PARALLEL_TRACKS,
  pickLongestRouteFeature,
} from "./segmentUtils";

const routeFeatureCache = new Map<string, Map<string, any[]>>();

export function getRouteFeatureMap(routes: any): Map<string, any[]> {
  const routeIds = (routes.features || [])
    .slice(0, 5)
    .map((f: any) => f.properties?.route_id || "")
    .join(",");
  const cacheKey = `${routes.features?.length ?? 0}-${routeIds}`;

  if (routeFeatureCache.has(cacheKey)) {
    return routeFeatureCache.get(cacheKey)!;
  }

  const map = new Map<string, any[]>();
  for (const feature of routes.features || []) {
    const routeId = feature.properties?.route_id;
    if (!routeId) continue;
    if (!map.has(routeId)) {
      map.set(routeId, []);
    }
    map.get(routeId)!.push(feature);
  }

  routeFeatureCache.set(cacheKey, map);
  return map;
}

export function findSegmentForVehicle(
  lat: number,
  lon: number,
  routeId: string,
  routes: any,
  routeFeatureMap?: Map<string, any[]>,
  city?: string,
  segmentSizeMeters: number = SEGMENT_SIZE_METERS,
): string | null {
  const featureMap = routeFeatureMap || getRouteFeatureMap(routes);
  const directRouteFeatures = featureMap.get(routeId) || [];
  const candidateRouteEntries: Array<[string, any[]]> =
    directRouteFeatures.length > 0
      ? [[routeId, directRouteFeatures]]
      : Array.from(featureMap.entries());

  let bestSegmentIndex: number | null = null;
  let bestSegmentRouteId: string | null = null;
  let minDistance = Infinity;

  for (const [candidateRouteId, routeFeatures] of candidateRouteEntries) {
    let cumulativeSegmentOffset = 0;

    const usesParallelMerge =
      city && CITIES_WITH_PARALLEL_TRACKS.includes(city);
    const featuresToProcess = usesParallelMerge
      ? pickLongestRouteFeature(routeFeatures)
      : routeFeatures;

    for (const feature of featuresToProcess) {
      const geometry = (feature as any).geometry;
      const geomType = geometry.type;

      let lineStrings: number[][][];
      if (geomType === "MultiLineString") {
        lineStrings = geometry.coordinates;
      } else {
        lineStrings = [geometry.coordinates];
      }

      for (const coordinates of lineStrings) {
        const result = findNearestPointOnLine(lat, lon, coordinates);

        if (
          result.distance < minDistance &&
          result.distance <= MAX_DISTANCE_FROM_ROUTE_METERS
        ) {
          minDistance = result.distance;
          const localSegmentIndex = Math.floor(
            result.distanceAlong / segmentSizeMeters,
          );
          bestSegmentIndex = cumulativeSegmentOffset + localSegmentIndex;
          bestSegmentRouteId = candidateRouteId;
        }

        const lineLength = result.totalLength;
        const segmentsInLine = Math.floor(lineLength / segmentSizeMeters) + 1;
        cumulativeSegmentOffset += segmentsInLine;
      }
    }
  }

  if (
    bestSegmentIndex !== null &&
    bestSegmentRouteId &&
    minDistance <= MAX_DISTANCE_FROM_ROUTE_METERS
  ) {
    return `${bestSegmentRouteId}_${bestSegmentIndex}`;
  }

  return null;
}

export function findSegmentsForVehicle(
  lat: number,
  lon: number,
  routeId: string,
  routes: any,
  routeFeatureMap?: Map<string, any[]>,
  city?: string,
): { segmentId: string | null; segmentId500: string | null; minDistance: number } {
  const featureMap = routeFeatureMap || getRouteFeatureMap(routes);
  const directRouteFeatures = featureMap.get(routeId) || [];
  const candidateRouteEntries: Array<[string, any[]]> =
    directRouteFeatures.length > 0
      ? [[routeId, directRouteFeatures]]
      : Array.from(featureMap.entries());

  let bestSegmentIndex200: number | null = null;
  let bestSegmentIndex500: number | null = null;
  let bestSegmentRouteId: string | null = null;
  let minDistance = Infinity;

  for (const [candidateRouteId, routeFeatures] of candidateRouteEntries) {
    let cumulativeOffset200 = 0;
    let cumulativeOffset500 = 0;

    const usesParallelMerge =
      city && CITIES_WITH_PARALLEL_TRACKS.includes(city);
    const featuresToProcess = usesParallelMerge
      ? pickLongestRouteFeature(routeFeatures)
      : routeFeatures;

    for (const feature of featuresToProcess) {
      const geometry = (feature as any).geometry;
      const geomType = geometry.type;

      let lineStrings: number[][][];
      if (geomType === "MultiLineString") {
        lineStrings = geometry.coordinates;
      } else {
        lineStrings = [geometry.coordinates];
      }

      for (const coordinates of lineStrings) {
        const result = findNearestPointOnLine(lat, lon, coordinates);

        if (
          result.distance < minDistance &&
          result.distance <= MAX_DISTANCE_FROM_ROUTE_METERS
        ) {
          minDistance = result.distance;
          bestSegmentIndex200 = cumulativeOffset200 + Math.floor(result.distanceAlong / SEGMENT_SIZE_METERS);
          bestSegmentIndex500 = cumulativeOffset500 + Math.floor(result.distanceAlong / SEGMENT_SIZE_500_METERS);
          bestSegmentRouteId = candidateRouteId;
        }

        const lineLength = result.totalLength;
        cumulativeOffset200 += Math.floor(lineLength / SEGMENT_SIZE_METERS) + 1;
        cumulativeOffset500 += Math.floor(lineLength / SEGMENT_SIZE_500_METERS) + 1;
      }
    }
  }

  if (bestSegmentRouteId && minDistance <= MAX_DISTANCE_FROM_ROUTE_METERS) {
    return {
      segmentId: bestSegmentIndex200 !== null ? `${bestSegmentRouteId}_${bestSegmentIndex200}` : null,
      segmentId500: bestSegmentIndex500 !== null ? `${bestSegmentRouteId}_${bestSegmentIndex500}` : null,
      minDistance,
    };
  }

  return { segmentId: null, segmentId500: null, minDistance: Infinity };
}

export function getDirection(directionId: any): string | undefined {
  if (directionId == null || directionId === "") return undefined;

  const dir = String(directionId).toLowerCase();

  if (dir === "0" || dir === "ob" || dir === "outbound") return "Outbound";
  if (dir === "1" || dir === "ib" || dir === "inbound") return "Inbound";

  return undefined;
}

export const SF_TERMINUS: Record<
  string,
  { inbound: string; outbound: string }
> = {
  F: { inbound: "to Fisherman's Wharf", outbound: "to Castro" },
  J: { inbound: "to Embarcadero", outbound: "to Balboa Park" },
  K: { inbound: "to Embarcadero", outbound: "to Balboa Park" },
  L: { inbound: "to Embarcadero", outbound: "to SF Zoo" },
  M: { inbound: "to Embarcadero", outbound: "to Balboa Park" },
  N: { inbound: "to Caltrain", outbound: "to Ocean Beach" },
  T: { inbound: "to Chinatown", outbound: "to Sunnydale" },
};

export const LA_TERMINUS: Record<
  string,
  { inbound: string; outbound: string }
> = {
  "801": { inbound: "to Downtown LA", outbound: "to Long Beach" },
  "802": { inbound: "to Union Station", outbound: "to North Hollywood" },
  "803": { inbound: "to Redondo Beach", outbound: "to Norwalk" },
  "804": { inbound: "to Downtown LA", outbound: "to Santa Monica" },
  "805": { inbound: "to Union Station", outbound: "to Wilshire/Western" },
  "806": { inbound: "to East LA", outbound: "to APU/Citrus College" },
  "807": { inbound: "to Expo/Crenshaw", outbound: "to Westchester/Veterans" },
};

export const BOSTON_BRANCH_NAMES: Record<string, string> = {
  "Green-B": "B Branch",
  "Green-C": "C Branch",
  "Green-D": "D Branch",
  "Green-E": "E Branch",
};

export interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  routeId: string;
  direction?: string;
  speed?: number;
  recordedAt: string;
  segmentId?: string | null;
  segmentId500?: string | null;
  headsign?: string | null;
}

export const cityDataCache = new Map<City, Vehicle[]>();

export const POSITION_COLUMNS =
  "id,vehicle_id,lat,lon,route_id,direction_id,speed_calculated,recorded_at,headsign";

export async function fetchPagesParallel(
  targetCity: City,
  startPage: number,
  numPages: number,
  pageSize: number,
): Promise<any[]> {
  if (!supabase) return [];

  const promises = [];
  for (let i = 0; i < numPages; i++) {
    const from = (startPage + i) * pageSize;
    let query;
    if (targetCity === "SF") {
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.SF")
        .order("recorded_at", { ascending: false })
        .range(from, from + pageSize - 1);
    } else if (targetCity === "San Diego") {
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.San Diego")
        .order("recorded_at", { ascending: false })
        .range(from, from + pageSize - 1);
    } else {
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .eq("city", targetCity)
        .order("recorded_at", { ascending: false })
        .range(from, from + pageSize - 1);
    }
    promises.push(query);
  }

  const results = await Promise.all(promises);
  return results.flatMap((r) => r.data || []);
}
