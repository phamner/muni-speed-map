const MAX_DISTANCE_FROM_ROUTE_METERS = 100;

const ROUTE_DISTANCE_OVERRIDES: Record<string, number> = {
  "802": 200, // LA B Line (subway)
};

function getMaxDistanceForRoute(routeId?: string | null): number {
  if (routeId && routeId in ROUTE_DISTANCE_OVERRIDES) {
    return ROUTE_DISTANCE_OVERRIDES[routeId];
  }
  return MAX_DISTANCE_FROM_ROUTE_METERS;
}
const SEGMENT_SIZE_METERS = 200;
const SEGMENT_SIZE_500_METERS = 500;
const SEGMENT_SIZE_1000_METERS = 1000;

const CITIES_WITH_PARALLEL_TRACKS = [
  "SF",
  "LA",
  "Boston",
  "Toronto",
  "Philadelphia",
  "Denver",
  "Salt Lake City",
  "San Diego",
  "Phoenix",
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

function getLineStringLength(coordinates: number[][]): number {
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    total += haversineDistance(y1, x1, y2, x2);
  }
  return total;
}

function getEndpointAlignmentScore(
  coordinates: number[][],
  referenceCoordinates: number[][],
): { sameDirection: number; reverseDirection: number } {
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const refStart = referenceCoordinates[0];
  const refEnd = referenceCoordinates[referenceCoordinates.length - 1];

  if (!start || !end || !refStart || !refEnd) {
    return {
      sameDirection: Number.POSITIVE_INFINITY,
      reverseDirection: Number.POSITIVE_INFINITY,
    };
  }

  return {
    sameDirection:
      haversineDistance(start[1], start[0], refStart[1], refStart[0]) +
      haversineDistance(end[1], end[0], refEnd[1], refEnd[0]),
    reverseDirection:
      haversineDistance(start[1], start[0], refEnd[1], refEnd[0]) +
      haversineDistance(end[1], end[0], refStart[1], refStart[0]),
  };
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

function normalizeDistanceAlongReference(
  distanceAlong: number,
  lineTotalLength: number,
  coordinates: number[][],
  referenceCoordinates: number[][],
  useOverlapAnchors: boolean = false,
): number {
  if (
    coordinates.length < 2 ||
    referenceCoordinates.length < 2 ||
    lineTotalLength <= 0
  ) {
    return distanceAlong;
  }

  const referenceLength = getLineStringLength(referenceCoordinates);
  if (referenceLength <= 0) {
    return distanceAlong;
  }

  const { sameDirection, reverseDirection } = getEndpointAlignmentScore(
    coordinates,
    referenceCoordinates,
  );

  let lineAnchorStart = 0;
  let lineAnchorEnd = lineTotalLength;
  let referenceAnchorStart = 0;
  let referenceAnchorEnd = referenceLength;

  if (useOverlapAnchors) {
    const lineStart = coordinates[0];
    const lineEnd = coordinates[coordinates.length - 1];
    const refStart = referenceCoordinates[0];
    const refEnd = referenceCoordinates[referenceCoordinates.length - 1];

    const lineStartOnReference =
      lineStart &&
      findNearestPointOnLine(lineStart[1], lineStart[0], referenceCoordinates);
    const lineEndOnReference =
      lineEnd && findNearestPointOnLine(lineEnd[1], lineEnd[0], referenceCoordinates);
    const refStartOnLine =
      refStart && findNearestPointOnLine(refStart[1], refStart[0], coordinates);
    const refEndOnLine =
      refEnd && findNearestPointOnLine(refEnd[1], refEnd[0], coordinates);

    if (
      lineStartOnReference &&
      lineEndOnReference &&
      refStartOnLine &&
      refEndOnLine
    ) {
      lineAnchorStart = Math.min(
        refStartOnLine.distanceAlong,
        refEndOnLine.distanceAlong,
      );
      lineAnchorEnd = Math.max(
        refStartOnLine.distanceAlong,
        refEndOnLine.distanceAlong,
      );
      referenceAnchorStart = Math.min(
        lineStartOnReference.distanceAlong,
        lineEndOnReference.distanceAlong,
      );
      referenceAnchorEnd = Math.max(
        lineStartOnReference.distanceAlong,
        lineEndOnReference.distanceAlong,
      );
    }
  }

  const anchorLineLength = Math.max(1, lineAnchorEnd - lineAnchorStart);
  const anchorReferenceLength = Math.max(
    1,
    referenceAnchorEnd - referenceAnchorStart,
  );
  const clampedDistanceAlong = Math.max(
    lineAnchorStart,
    Math.min(lineAnchorEnd, distanceAlong),
  );
  const distanceWithinAnchor = clampedDistanceAlong - lineAnchorStart;
  const lengthRatio = anchorReferenceLength / anchorLineLength;
  const scaledDistance = Math.max(
    referenceAnchorStart,
    Math.min(
      referenceAnchorEnd,
      referenceAnchorStart + distanceWithinAnchor * lengthRatio,
    ),
  );

  if (reverseDirection < sameDirection) {
    return Math.max(
      referenceAnchorStart,
      referenceAnchorEnd - (scaledDistance - referenceAnchorStart),
    );
  }

  return scaledDistance;
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

function shouldUseParallelTrackMerge(city: string, routeId: string): boolean {
  if (!CITIES_WITH_PARALLEL_TRACKS.includes(city)) {
    return false;
  }

  if (city === "SF" && routeId === "F") {
    return false;
  }

  return true;
}

function shouldUsePairedArcMerge(city: string, routeId: string): boolean {
  return city === "SF" && routeId === "F";
}

function findSegmentsForVehicle(
  lat: number,
  lon: number,
  routeId: string,
  routeFeatureMap: Map<string, any[]>,
  city: string,
): {
  segmentId: string | null;
  segmentId500: string | null;
  segmentId1000: string | null;
  minDistance: number;
} {
  const directRouteFeatures = routeFeatureMap.get(routeId) || [];
  const candidateRouteEntries: Array<[string, any[]]> =
    directRouteFeatures.length > 0
      ? [[routeId, directRouteFeatures]]
      : Array.from(routeFeatureMap.entries());

  let bestSegmentIndex200: number | null = null;
  let bestSegmentIndex500: number | null = null;
  let bestSegmentIndex1000: number | null = null;
  let bestSegmentRouteId: string | null = null;
  let minDistance = Infinity;

  for (const [candidateRouteId, routeFeatures] of candidateRouteEntries) {
    let cumulativeOffset200 = 0;
    let cumulativeOffset500 = 0;
    let cumulativeOffset1000 = 0;

    const usesParallelMerge = shouldUseParallelTrackMerge(
      city,
      candidateRouteId,
    );
    const usesPairedArcMerge = shouldUsePairedArcMerge(
      city,
      candidateRouteId,
    );
    const featuresToProcess = usesParallelMerge
      ? pickLongestRouteFeature(routeFeatures)
      : routeFeatures;
    const usesSharedSegmentSpace = usesParallelMerge || usesPairedArcMerge;
    const referenceLineCoords = usesSharedSegmentSpace
      ? routeFeatures
          .flatMap((feature: any) =>
            feature.geometry.type === "MultiLineString"
              ? feature.geometry.coordinates
              : [feature.geometry.coordinates],
          )
          .reduce((longest: number[][] | null, current: number[][]) => {
            if (!longest) return current;
            return getLineStringLength(current) > getLineStringLength(longest)
              ? current
              : longest;
          }, null)
      : null;

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
        const distanceAlong = referenceLineCoords
          ? normalizeDistanceAlongReference(
              result.distanceAlong,
              result.totalLength,
              coordinates,
              referenceLineCoords,
              usesPairedArcMerge,
            )
          : result.distanceAlong;

        const maxDist = getMaxDistanceForRoute(candidateRouteId);
        if (
          result.distance < minDistance &&
          result.distance <= maxDist
        ) {
          minDistance = result.distance;
          bestSegmentIndex200 =
            (referenceLineCoords ? 0 : cumulativeOffset200) +
            Math.floor(distanceAlong / SEGMENT_SIZE_METERS);
          bestSegmentIndex500 =
            (referenceLineCoords ? 0 : cumulativeOffset500) +
            Math.floor(distanceAlong / SEGMENT_SIZE_500_METERS);
          bestSegmentIndex1000 =
            (referenceLineCoords ? 0 : cumulativeOffset1000) +
            Math.floor(distanceAlong / SEGMENT_SIZE_1000_METERS);
          bestSegmentRouteId = candidateRouteId;
        }

        const lineLength = result.totalLength;
        if (!referenceLineCoords) {
          cumulativeOffset200 += Math.floor(lineLength / SEGMENT_SIZE_METERS) + 1;
          cumulativeOffset500 +=
            Math.floor(lineLength / SEGMENT_SIZE_500_METERS) + 1;
          cumulativeOffset1000 +=
            Math.floor(lineLength / SEGMENT_SIZE_1000_METERS) + 1;
        }
      }
    }
  }

  if (bestSegmentRouteId && minDistance <= getMaxDistanceForRoute(bestSegmentRouteId)) {
    return {
      segmentId: bestSegmentIndex200 !== null ? `${bestSegmentRouteId}_${bestSegmentIndex200}` : null,
      segmentId500: bestSegmentIndex500 !== null ? `${bestSegmentRouteId}_${bestSegmentIndex500}` : null,
      segmentId1000: bestSegmentIndex1000 !== null ? `${bestSegmentRouteId}_${bestSegmentIndex1000}` : null,
      minDistance,
    };
  }

  return {
    segmentId: null,
    segmentId500: null,
    segmentId1000: null,
    minDistance: Infinity,
  };
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
    segment_id: string | null;
    segment_id_200: string | null;
    segment_id_500: string | null;
    segment_id_1000: string | null;
    on_route: boolean | null;
    mapping_version: number | null;
  }>;
  routes: any;
  city: string;
  requestId: number;
  mappingVersion: number;
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
    segmentId1000: string | null;
    headsign: string | null;
    onRoute: boolean;
  }>;
  requestId: number;
}

self.onmessage = (e: MessageEvent<SegmentWorkerInput>) => {
  const { rows, routes, city, requestId, mappingVersion } = e.data;

  const routeFeatureMap = buildRouteFeatureMap(routes);

  const vehicles = rows.map((row) => {
    const hasPrecomputedSegments =
      city !== "SF" &&
      row.mapping_version === mappingVersion &&
      typeof row.on_route === "boolean" &&
      row.segment_id_200 != null &&
      row.segment_id_500 != null &&
      row.segment_id_1000 != null;

    if (hasPrecomputedSegments) {
      return {
        id: `${row.vehicle_id}-${row.id}`,
        lat: row.lat,
        lon: row.lon,
        routeId: row.route_id,
        direction: getDirection(row.direction_id),
        speed: row.speed_calculated ?? undefined,
        recordedAt: row.recorded_at,
        segmentId: row.segment_id_200 ?? row.segment_id ?? null,
        segmentId500: row.segment_id_500,
        segmentId1000: row.segment_id_1000,
        headsign: row.headsign,
        onRoute: row.on_route === true,
      };
    }

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
      segmentId1000: segments.segmentId1000,
      headsign: row.headsign,
      onRoute: segments.minDistance <= getMaxDistanceForRoute(row.route_id),
    };
  });

  const output: SegmentWorkerOutput = { vehicles, requestId };
  self.postMessage(output);
};
