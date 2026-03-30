import { haversineDistance, distanceToSegment } from "./geoUtils";

export const SEGMENT_SIZE_METERS = 200;

export function getLineStringLength(coordinates: number[][]): number {
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

/** For parallel-track cities: pick the feature with the longest geometry (most complete coverage). */
export function pickLongestRouteFeature(features: any[]): any[] {
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
export const SEGMENT_SIZE_500_METERS = 500;

export const CITIES_WITH_PARALLEL_TRACKS = [
  "SF",
  "LA", //yes
  "Boston", 
  "Toronto",
  "Philadelphia",
  "Denver", //yes
  "Salt Lake City",
  "Cleveland",
  "Charlotte",
  "Portland", //yes
  "Pittsburgh", //yes
  "Seattle", //the 2 line has parallel tracks.
];

export function shouldUseParallelTrackMerge(
  city?: string,
  routeId?: string,
): boolean {
  if (!city || !CITIES_WITH_PARALLEL_TRACKS.includes(city)) {
    return false;
  }

  // F in SF is a loop we intentionally cut into two arcs for display/segmenting.
  // It should be segmented directly on both halves, not mirrored as a parallel pair.
  if (city === "SF" && routeId === "F") {
    return false;
  }

  return true;
}

export interface SegmentData {
  segmentId: string;
  routeId: string;
  coordinates: number[][];
  startDistance: number;
  endDistance: number;
  referenceSegmentId?: string;
}

export function findNearestPointOnLine(
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

export function normalizeDistanceAlongReference(
  distanceAlong: number,
  lineTotalLength: number,
  coordinates: number[][],
  referenceCoordinates: number[][],
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
  const lengthRatio = referenceLength / lineTotalLength;
  const scaledDistance = Math.max(
    0,
    Math.min(referenceLength, distanceAlong * lengthRatio),
  );

  if (reverseDirection < sameDirection) {
    return Math.max(0, referenceLength - scaledDistance);
  }

  return scaledDistance;
}

function createSegments(
  coordinates: number[][],
  routeId: string,
  direction: string,
  segmentSizeMeters: number = SEGMENT_SIZE_METERS,
): {
  segmentId: string;
  coords: number[][];
  startDistance: number;
  endDistance: number;
}[] {
  const segments: {
    segmentId: string;
    coords: number[][];
    startDistance: number;
    endDistance: number;
  }[] = [];

  let distanceAlong = 0;
  let segmentIndex = 0;
  let currentSegmentCoords: number[][] = [coordinates[0]];
  let segmentStartDistance = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const edgeLength = haversineDistance(y1, x1, y2, x2);

    while (
      distanceAlong + edgeLength >=
      (segmentIndex + 1) * segmentSizeMeters
    ) {
      const boundaryDistance = (segmentIndex + 1) * segmentSizeMeters;
      const distanceIntoBoundary = boundaryDistance - distanceAlong;
      const t = distanceIntoBoundary / edgeLength;
      const crossX = x1 + t * (x2 - x1);
      const crossY = y1 + t * (y2 - y1);

      currentSegmentCoords.push([crossX, crossY]);

      segments.push({
        segmentId: `${routeId}_${direction}_${segmentIndex}`,
        coords: [...currentSegmentCoords],
        startDistance: segmentStartDistance,
        endDistance: boundaryDistance,
      });

      currentSegmentCoords = [[crossX, crossY]];
      segmentStartDistance = boundaryDistance;
      segmentIndex++;
    }

    if (i < coordinates.length - 2) {
      currentSegmentCoords.push(coordinates[i + 1]);
    }

    distanceAlong += edgeLength;
  }

  currentSegmentCoords.push(coordinates[coordinates.length - 1]);
  if (currentSegmentCoords.length >= 2) {
    segments.push({
      segmentId: `${routeId}_${direction}_${segmentIndex}`,
      coords: currentSegmentCoords,
      startDistance: segmentStartDistance,
      endDistance: distanceAlong,
    });
  }

  return segments;
}

function extractLineSubsection(
  coordinates: number[][],
  startDist: number,
  endDist: number,
): number[][] {
  const result: number[][] = [];
  let distanceAlong = 0;
  let started = false;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const segmentLength = haversineDistance(y1, x1, y2, x2);
    const nextDistance = distanceAlong + segmentLength;

    if (!started && nextDistance >= startDist) {
      const t =
        segmentLength > 0 ? (startDist - distanceAlong) / segmentLength : 0;
      const startX = x1 + t * (x2 - x1);
      const startY = y1 + t * (y2 - y1);
      result.push([startX, startY]);
      started = true;
    }

    if (started && distanceAlong >= startDist && distanceAlong < endDist) {
      if (
        result.length === 0 ||
        result[result.length - 1][0] !== x1 ||
        result[result.length - 1][1] !== y1
      ) {
        result.push([x1, y1]);
      }
    }

    if (started && nextDistance >= endDist) {
      const t =
        segmentLength > 0 ? (endDist - distanceAlong) / segmentLength : 0;
      const endX = x1 + t * (x2 - x1);
      const endY = y1 + t * (y2 - y1);
      result.push([endX, endY]);
      break;
    }

    if (started && nextDistance < endDist) {
      result.push([x2, y2]);
    }

    distanceAlong = nextDistance;
  }

  if (result.length < 2) {
    return [];
  }

  return result;
}

function projectPointOntoLine(
  lat: number,
  lon: number,
  coordinates: number[][],
): { distanceAlong: number; projectedPoint: [number, number] } | null {
  let minDistance = Infinity;
  let bestDistanceAlong = 0;
  let bestProjectedPoint: [number, number] = [0, 0];
  let distanceAlong = 0;

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
      bestProjectedPoint = [x1 + t * dx, y1 + t * dy];
    }

    distanceAlong += segmentLength;
  }

  if (minDistance > 200) {
    return null;
  }

  return {
    distanceAlong: bestDistanceAlong,
    projectedPoint: bestProjectedPoint,
  };
}

function getParallelSegmentSubsection(
  coordinates: number[][],
  refSeg: SegmentData,
  idx: number,
  totalRefSegments: number,
  segmentSizeMeters: number,
): { coords: number[][]; startDistance: number; endDistance: number } | null {
  const refStart = refSeg.coordinates[0];
  const refEnd = refSeg.coordinates[refSeg.coordinates.length - 1];
  if (!refStart || !refEnd) return null;

  const startProjection = projectPointOntoLine(
    refStart[1],
    refStart[0],
    coordinates,
  );
  const endProjection = projectPointOntoLine(
    refEnd[1],
    refEnd[0],
    coordinates,
  );
  if (!startProjection || !endProjection) return null;

  const startOffset = haversineDistance(
    refStart[1],
    refStart[0],
    startProjection.projectedPoint[1],
    startProjection.projectedPoint[0],
  );
  const endOffset = haversineDistance(
    refEnd[1],
    refEnd[0],
    endProjection.projectedPoint[1],
    endProjection.projectedPoint[0],
  );
  const PARALLEL_MATCH_MAX_DISTANCE_METERS = 70;
  if (
    startOffset > PARALLEL_MATCH_MAX_DISTANCE_METERS ||
    endOffset > PARALLEL_MATCH_MAX_DISTANCE_METERS
  ) {
    return null;
  }

  const lineLength = getLineStringLength(coordinates);
  let startDist = Math.min(
    startProjection.distanceAlong,
    endProjection.distanceAlong,
  );
  let endDist = Math.max(
    startProjection.distanceAlong,
    endProjection.distanceAlong,
  );

  if (idx === 0 && startDist > 0 && startDist < segmentSizeMeters) {
    startDist = 0;
  }
  if (
    idx === totalRefSegments - 1 &&
    lineLength - endDist > 0 &&
    lineLength - endDist < segmentSizeMeters
  ) {
    endDist = lineLength;
  }

  const coords = extractLineSubsection(coordinates, startDist, endDist);
  if (coords.length < 2) return null;

  return { coords, startDistance: startDist, endDistance: endDist };
}

export function buildAllSegments(
  routes: any,
  city?: string,
  segmentSizeMeters: number = SEGMENT_SIZE_METERS,
): SegmentData[] {
  const allSegments: SegmentData[] = [];
  const routeSegmentOffsets = new Map<string, number>();

  const referenceSegmentsByRoute = new Map<string, SegmentData[]>();
  const processedRoutes = new Set<string>();

  const usesParallelMerge = !!city && CITIES_WITH_PARALLEL_TRACKS.includes(city);
  const featuresToProcess =
    usesParallelMerge
      ? (() => {
          const byRoute = new Map<string, any[]>();
          const routeOrder: string[] = [];
          for (const f of routes.features || []) {
            const rid = f.properties?.route_id;
            if (!rid) continue;
            if (!byRoute.has(rid)) {
              byRoute.set(rid, []);
              routeOrder.push(rid);
            }
            byRoute.get(rid)!.push(f);
          }
          const ordered: any[] = [];
          for (const rid of routeOrder) {
            const group = byRoute.get(rid)!;
            group.sort((a, b) => getFeatureLineLength(b) - getFeatureLineLength(a));
            ordered.push(...group);
          }
          return ordered;
        })()
      : routes.features || [];

  featuresToProcess.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const geometry = feature.geometry;
    const geomType = geometry.type;

    let lineStrings: number[][][];
    if (geomType === "MultiLineString") {
      lineStrings = geometry.coordinates;
    } else {
      lineStrings = [geometry.coordinates];
    }

    const useRouteParallelMerge = shouldUseParallelTrackMerge(city, routeId);
    const isParallelTrack = useRouteParallelMerge && processedRoutes.has(routeId);

    if (useRouteParallelMerge && !processedRoutes.has(routeId)) {
      processedRoutes.add(routeId);
      let cumulativeSegmentOffset = routeSegmentOffsets.get(routeId) || 0;
      const lineLengths = lineStrings.map((coordinates) =>
        coordinates.reduce((sum, _, i) => {
          if (i === 0) return sum;
          const [x1, y1] = coordinates[i - 1];
          const [x2, y2] = coordinates[i];
          return sum + haversineDistance(y1, x1, y2, x2);
        }, 0),
      );
      const referenceLineIndex = lineLengths.reduce(
        (bestIdx, len, idx, arr) => (len > arr[bestIdx] ? idx : bestIdx),
        0,
      );
      const referenceLineCoords = lineStrings[referenceLineIndex] || [];

      const refSegmentsRaw = createSegments(
        referenceLineCoords,
        routeId,
        "combined",
        segmentSizeMeters,
      );
      const routeRefSegments: SegmentData[] = [];
      refSegmentsRaw.forEach((seg) => {
        const originalIndex = parseInt(seg.segmentId.split("_").pop() || "0");
        const adjustedIndex = cumulativeSegmentOffset + originalIndex;
        const segmentId = `${routeId}_${adjustedIndex}`;
        const segmentData: SegmentData = {
          segmentId,
          routeId,
          coordinates: seg.coords,
          startDistance: seg.startDistance,
          endDistance: seg.endDistance,
        };
        allSegments.push(segmentData);
        routeRefSegments.push(segmentData);
      });
      if (refSegmentsRaw.length > 0) {
        const lastIndex = parseInt(
          refSegmentsRaw[refSegmentsRaw.length - 1].segmentId.split("_").pop() || "0",
        );
        cumulativeSegmentOffset += lastIndex + 1;
      }

      // Create parallel-track display segments by projecting each reference boundary
      // onto the parallel line so segment boundaries stay aligned visually.
      let parallelLineCounter = 0;
      lineStrings.forEach((coordinates, lineIndex) => {
        if (lineIndex === referenceLineIndex) return;
        routeRefSegments.forEach((refSeg, idx) => {
          const parallelSegment = getParallelSegmentSubsection(
            coordinates,
            refSeg,
            idx,
            routeRefSegments.length,
            segmentSizeMeters,
          );
          if (!parallelSegment) return;

          allSegments.push({
            segmentId: `${routeId}_p_${parallelLineCounter}_${idx}`,
            routeId,
            coordinates: parallelSegment.coords,
            startDistance: parallelSegment.startDistance,
            endDistance: parallelSegment.endDistance,
            referenceSegmentId: refSeg.segmentId,
          });
        });
        parallelLineCounter++;
      });

      routeSegmentOffsets.set(routeId, cumulativeSegmentOffset);
      referenceSegmentsByRoute.set(routeId, routeRefSegments);
    } else if (isParallelTrack) {
      const refSegments = referenceSegmentsByRoute.get(routeId) || [];

      for (const coordinates of lineStrings) {
        refSegments.forEach((refSeg, idx) => {
          const parallelSegment = getParallelSegmentSubsection(
            coordinates,
            refSeg,
            idx,
            refSegments.length,
            segmentSizeMeters,
          );
          if (!parallelSegment) {
            return;
          }

          const parallelSegmentId = `${routeId}_p_${idx}`;
          allSegments.push({
            segmentId: parallelSegmentId,
            routeId,
            coordinates: parallelSegment.coords,
            startDistance: parallelSegment.startDistance,
            endDistance: parallelSegment.endDistance,
            referenceSegmentId: refSeg.segmentId,
          });
        });
      }
    } else {
      let cumulativeSegmentOffset = routeSegmentOffsets.get(routeId) || 0;

      for (const coordinates of lineStrings) {
        const segments = createSegments(
          coordinates,
          routeId,
          "combined",
          segmentSizeMeters,
        );

        segments.forEach((seg) => {
          const originalIndex = parseInt(seg.segmentId.split("_").pop() || "0");
          const adjustedIndex = cumulativeSegmentOffset + originalIndex;
          const segmentId = `${routeId}_${adjustedIndex}`;
          allSegments.push({
            segmentId,
            routeId,
            coordinates: seg.coords,
            startDistance: seg.startDistance,
            endDistance: seg.endDistance,
          });
        });

        if (segments.length > 0) {
          const lastIndex = parseInt(
            segments[segments.length - 1].segmentId.split("_").pop() || "0",
          );
          cumulativeSegmentOffset += lastIndex + 1;
        }
      }

      routeSegmentOffsets.set(routeId, cumulativeSegmentOffset);
    }
  });

  return allSegments;
}
