const MAX_DISTANCE_FROM_ROUTE_METERS = 100;
const SEGMENT_SIZE_METERS = 200;
const SEGMENT_SIZE_500_METERS = 500;

const CITIES_WITH_PARALLEL_TRACKS = [
  "LA",
  "Boston",
  "Toronto",
  "Philadelphia",
  "Denver",
  "Salt Lake City",
  "Cleveland",
  "Charlotte",
  "Portland",
  "Pittsburgh",
  "Seattle",
];

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return haversineDistance(py, px, y1, x1);
  }
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)),
  );
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return haversineDistance(py, px, nearestY, nearestX);
}

function getFeatureLineLength(feature: any): number {
  const geometry = feature?.geometry;
  if (!geometry) return 0;
  const lineStrings =
    geometry.type === "MultiLineString"
      ? geometry.coordinates
      : [geometry.coordinates];
  let total = 0;
  for (const coords of lineStrings) {
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      total += haversineDistance(y1, x1, y2, x2);
    }
  }
  return total;
}

function pickLongestRouteFeature(features: any[]): any[] {
  if (features.length <= 1) return features;
  let longest = features[0];
  let maxLen = getFeatureLineLength(longest);
  for (let i = 1; i < features.length; i++) {
    const len = getFeatureLineLength(features[i]);
    if (len > maxLen) {
      maxLen = len;
      longest = features[i];
    }
  }
  return [longest];
}

function findNearestPointOnLine(
  lat: number,
  lon: number,
  coordinates: number[][],
): {
  distance: number;
  distanceAlong: number;
  totalLength: number;
} {
  let minDistance = Infinity;
  let distanceAlong = 0;
  let bestDistanceAlong = 0;
  let totalLength = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const segmentLength = haversineDistance(y1, x1, y2, x2);

    const dist = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (dist < minDistance) {
      minDistance = dist;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t =
        dx === 0 && dy === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy),
              ),
            );
      bestDistanceAlong = distanceAlong + t * segmentLength;
    }

    distanceAlong += segmentLength;
  }

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    totalLength += haversineDistance(y1, x1, y2, x2);
  }

  return {
    distance: minDistance,
    distanceAlong: bestDistanceAlong,
    totalLength,
  };
}

function buildRouteFeatureMap(routes: any): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const feature of routes.features || []) {
    const routeId = feature.properties?.route_id;
    if (!routeId) continue;
    if (!map.has(routeId)) {
      map.set(routeId, []);
    }
    map.get(routeId)!.push(feature);
  }
  return map;
}

function findSegmentsForVehicle(
  lat: number,
  lon: number,
  routeId: string,
  routeFeatureMap: Map<string, any[]>,
  city: string,
): { segmentId: string | null; segmentId500: string | null; minDistance: number } {
  const directRouteFeatures = routeFeatureMap.get(routeId) || [];
  const candidateRouteEntries: Array<[string, any[]]> =
    directRouteFeatures.length > 0
      ? [[routeId, directRouteFeatures]]
      : Array.from(routeFeatureMap.entries());

  let bestSegmentIndex200: number | null = null;
  let bestSegmentIndex500: number | null = null;
  let bestSegmentRouteId: string | null = null;
  let minDistance = Infinity;

  for (const [candidateRouteId, routeFeatures] of candidateRouteEntries) {
    let cumulativeOffset200 = 0;
    let cumulativeOffset500 = 0;

    const usesParallelMerge = CITIES_WITH_PARALLEL_TRACKS.includes(city);
    const featuresToProcess = usesParallelMerge
      ? pickLongestRouteFeature(routeFeatures)
      : routeFeatures;

    for (const feature of featuresToProcess) {
      const geometry = feature.geometry;
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

function getDirection(directionId: any): string | undefined {
  if (directionId == null || directionId === "") return undefined;
  const dir = String(directionId).toLowerCase();
  if (dir === "0" || dir === "ob" || dir === "outbound") return "Outbound";
  if (dir === "1" || dir === "ib" || dir === "inbound") return "Inbound";
  return undefined;
}

export interface SegmentWorkerInput {
  rows: Array<{
    id: number;
    vehicle_id: string;
    lat: number;
    lon: number;
    route_id: string;
    direction_id: any;
    speed_calculated: number | null;
    recorded_at: string;
    headsign: string | null;
  }>;
  routes: any;
  city: string;
  requestId: number;
}

export interface SegmentWorkerOutput {
  vehicles: Array<{
    id: string;
    lat: number;
    lon: number;
    routeId: string;
    direction?: string;
    speed?: number;
    recordedAt: string;
    segmentId: string | null;
    segmentId500: string | null;
    headsign: string | null;
    onRoute: boolean;
  }>;
  requestId: number;
}

self.onmessage = (e: MessageEvent<SegmentWorkerInput>) => {
  const { rows, routes, city, requestId } = e.data;

  const routeFeatureMap = buildRouteFeatureMap(routes);

  const vehicles = rows.map((row) => {
    const segments = findSegmentsForVehicle(
      row.lat,
      row.lon,
      row.route_id,
      routeFeatureMap,
      city,
    );
    return {
      id: `${row.vehicle_id}-${row.id}`,
      lat: row.lat,
      lon: row.lon,
      routeId: row.route_id,
      direction: getDirection(row.direction_id),
      speed: row.speed_calculated ?? undefined,
      recordedAt: row.recorded_at,
      segmentId: segments.segmentId,
      segmentId500: segments.segmentId500,
      headsign: row.headsign,
      onRoute: segments.minDistance <= MAX_DISTANCE_FROM_ROUTE_METERS,
    };
  });

  const output: SegmentWorkerOutput = { vehicles, requestId };
  self.postMessage(output);
};
