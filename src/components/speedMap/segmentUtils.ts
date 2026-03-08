import { haversineDistance, distanceToSegment } from "./geoUtils";

export const SEGMENT_SIZE_METERS = 200;

export const CITIES_WITH_PARALLEL_TRACKS = [
  "SF",
  "LA",
  "Denver",
  "Boston",
  "Phoenix",
  "Cleveland",
  "Toronto",
];

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

function createSegments(
  coordinates: number[][],
  routeId: string,
  direction: string,
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
      (segmentIndex + 1) * SEGMENT_SIZE_METERS
    ) {
      const boundaryDistance = (segmentIndex + 1) * SEGMENT_SIZE_METERS;
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

export function buildAllSegments(routes: any, city?: string): SegmentData[] {
  const allSegments: SegmentData[] = [];
  const routeSegmentOffsets = new Map<string, number>();

  const referenceSegmentsByRoute = new Map<string, SegmentData[]>();
  const processedRoutes = new Set<string>();

  routes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const geometry = feature.geometry;
    const geomType = geometry.type;

    let lineStrings: number[][][];
    if (geomType === "MultiLineString") {
      lineStrings = geometry.coordinates;
    } else {
      lineStrings = [geometry.coordinates];
    }

    const usesParallelMerge =
      city && CITIES_WITH_PARALLEL_TRACKS.includes(city);
    const isParallelTrack = usesParallelMerge && processedRoutes.has(routeId);

    if (usesParallelMerge && !processedRoutes.has(routeId)) {
      processedRoutes.add(routeId);
      const routeRefSegments: SegmentData[] = [];

      for (const coordinates of lineStrings) {
        const segments = createSegments(coordinates, routeId, "combined");

        segments.forEach((seg) => {
          const originalIndex = parseInt(seg.segmentId.split("_").pop() || "0");
          const segmentId = `${routeId}_${originalIndex}`;
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
      }

      referenceSegmentsByRoute.set(routeId, routeRefSegments);
    } else if (isParallelTrack) {
      const refSegments = referenceSegmentsByRoute.get(routeId) || [];

      for (const coordinates of lineStrings) {
        refSegments.forEach((refSeg, idx) => {
          const refStart = refSeg.coordinates[0];
          const refEnd = refSeg.coordinates[refSeg.coordinates.length - 1];

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

          if (!startProjection || !endProjection) {
            return;
          }

          const startDist = Math.min(
            startProjection.distanceAlong,
            endProjection.distanceAlong,
          );
          const endDist = Math.max(
            startProjection.distanceAlong,
            endProjection.distanceAlong,
          );

          const parallelCoords = extractLineSubsection(
            coordinates,
            startDist,
            endDist,
          );

          if (parallelCoords.length < 2) {
            return;
          }

          const parallelSegmentId = `${routeId}_p_${idx}`;
          allSegments.push({
            segmentId: parallelSegmentId,
            routeId,
            coordinates: parallelCoords,
            startDistance: startDist,
            endDistance: endDist,
            referenceSegmentId: refSeg.segmentId,
          });
        });
      }
    } else {
      let cumulativeSegmentOffset = routeSegmentOffsets.get(routeId) || 0;

      for (const coordinates of lineStrings) {
        const segments = createSegments(coordinates, routeId, "combined");

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
