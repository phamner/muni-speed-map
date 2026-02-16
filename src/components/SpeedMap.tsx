import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City, LAMetroLine } from "../types";
import { getLinesForCity, CITIES, LA_METRO_LINE_INFO } from "../types";
import { supabase } from "../lib/supabase";
import {
  loadCityData,
  isCityDataCached,
  getCachedCityData,
  startBackgroundStaticPreload,
  CITY_COORDS,
  type CityStaticData,
} from "../data/cityDataLoaders";
import slcRailContextHeavy from "../data/slcRailContextHeavy.json";
import slcRailContextCommuter from "../data/slcRailContextCommuter.json";
import type { SpeedFilter, ViewMode, LineStats } from "../App";

// Maximum distance in meters from route line to be considered "on route"
const MAX_DISTANCE_FROM_ROUTE_METERS = 100;

// Debounce utility - prevents rapid successive calls
function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };
  return debounced as T & { cancel: () => void };
}

// Empty city data placeholder - used while loading
const EMPTY_CITY_DATA: CityStaticData = {
  routes: { type: "FeatureCollection", features: [] },
  stops: { type: "FeatureCollection", features: [] },
  crossings: { type: "FeatureCollection", features: [] },
  switches: { type: "FeatureCollection", features: [] },
  maxspeed: null,
  tunnelsBridges: null,
  separation: null,
  railContextHeavy: null,
  railContextCommuter: null,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Haversine distance between two points in meters
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth's radius in meters
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

// Calculate minimum distance from a point to a line segment
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

// Calculate minimum distance from a point to a LineString
function distanceToLineString(
  lat: number,
  lon: number,
  coordinates: number[][],
): number {
  let minDistance = Infinity;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const dist = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}

// Distance threshold for separation data filtering
const SEPARATION_PROXIMITY_METERS = 50;

// Philadelphia streetcar routes that default to street-running when no other separation data
const PHILLY_STREET_RUNNING_ROUTES = ["10", "11", "13", "34", "36"];

// Portland streetcar routes (A-Loop, B-Loop, NS Line) that default to street-running
// Route IDs: 193 = NS Line, 194 = A Loop, 195 = B Loop
const PORTLAND_STREETCAR_ROUTES = ["193", "194", "195"];

// Check if a point is covered by any of the separation features
function isPointCoveredBySeparation(
  lat: number,
  lon: number,
  separationFeatures: any[],
): boolean {
  for (const feature of separationFeatures) {
    if (feature.geometry?.type !== "LineString") continue;
    const dist = distanceToLineString(lat, lon, feature.geometry.coordinates);
    if (dist < SEPARATION_PROXIMITY_METERS) {
      return true;
    }
  }
  return false;
}

// Extract uncovered segments from a route geometry
// Returns array of LineString coordinate arrays that are NOT covered by separation data
function getUncoveredSegments(
  coordinates: number[][],
  separationFeatures: any[],
): number[][][] {
  const uncoveredSegments: number[][][] = [];
  let currentSegment: number[][] = [];

  for (const coord of coordinates) {
    const [lon, lat] = coord;
    const isCovered = isPointCoveredBySeparation(lat, lon, separationFeatures);

    if (!isCovered) {
      currentSegment.push(coord);
    } else {
      // Point is covered - save current segment if it has at least 2 points
      if (currentSegment.length >= 2) {
        uncoveredSegments.push(currentSegment);
      }
      currentSegment = [];
    }
  }

  // Don't forget the last segment
  if (currentSegment.length >= 2) {
    uncoveredSegments.push(currentSegment);
  }

  return uncoveredSegments;
}

// Filter separation features to only include those near the selected routes
// For Philadelphia streetcar routes, adds street-running fallback for route geometry
function filterSeparationByRoutes(
  separation: any,
  selectedRoutes: any,
  city?: string,
): any {
  if (!selectedRoutes?.features?.length) {
    return { type: "FeatureCollection", features: [] };
  }

  // Extract selected line IDs from route features
  const selectedLineIds = new Set<string>();
  for (const feature of selectedRoutes.features) {
    const routeId = feature.properties?.route_id;
    if (routeId) selectedLineIds.add(routeId);
  }
  console.log(
    `filterSeparationByRoutes: city=${city}, selectedLineIds=${[...selectedLineIds].join(",")}, separationFeatures=${separation?.features?.length || 0}`,
  );

  // Build a list of all coordinate segments from selected routes
  const routeCoords: number[][][] = [];
  for (const feature of selectedRoutes.features) {
    if (feature.geometry?.type === "LineString") {
      routeCoords.push(feature.geometry.coordinates);
    } else if (feature.geometry?.type === "MultiLineString") {
      routeCoords.push(...feature.geometry.coordinates);
    }
  }

  if (routeCoords.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  // Start with filtered OSM separation features
  const filteredFeatures: any[] = [];

  if (separation?.features) {
    for (const sepFeature of separation.features) {
      if (sepFeature.geometry?.type !== "LineString") continue;

      // If feature has explicit "lines" property, only include if one of those lines is selected
      // Exception: SF tunnels have special logic handled later (e.g., Market St Subway is J/N tagged but used by K/L/M too)
      const featureLines = sepFeature.properties?.lines;
      const sepType = sepFeature.properties?.separationType;
      const isSfTunnel = city === "SF" && sepType === "tunnel";

      if (featureLines && Array.isArray(featureLines) && !isSfTunnel) {
        const matchesSelectedLine = featureLines.some((line: string) =>
          selectedLineIds.has(line),
        );
        if (!matchesSelectedLine) {
          continue; // Skip this feature - it's for a different line
        }
      }

      // SF separation: Handle tunnel filtering based on which lines actually use each tunnel
      const sepName = sepFeature.properties?.name || "";
      const hasExplicitLines =
        featureLines && Array.isArray(featureLines) && featureLines.length > 0;

      if (isSfTunnel) {
        // If this tunnel has explicit line associations (from overrides), check if it applies
        // Special case: Market Street Subway is tagged with J/N but also used by K/L/M
        if (hasExplicitLines) {
          const matchesSelectedLine = featureLines.some((line: string) =>
            selectedLineIds.has(line),
          );
          // For Market Street Subway (J/N tagged), also include if K/L/M is selected
          const isMarketStSubway =
            featureLines.includes("J") && featureLines.includes("N");
          const hasKLM = ["K", "L", "M"].some((line) =>
            selectedLineIds.has(line),
          );
          if (!matchesSelectedLine && !(isMarketStSubway && hasKLM)) {
            continue; // Skip - this tunnel override isn't for any selected line
          }
        }

        // Determine which tunnel this is based on name
        const isCentralSubway = sepName.includes("Central Subway");
        const isSunsetTunnel = sepName.includes("Sunset Tunnel");
        const isTwinPeaksTunnel = sepName.includes("Twin Peaks");
        const isJTunnel = sepName === "Muni J";
        // Market Street tunnel: "Muni Metro", null name, or anything not matching above specific tunnels
        const isMarketStreetTunnel =
          !isCentralSubway &&
          !isSunsetTunnel &&
          !isTwinPeaksTunnel &&
          !isJTunnel;

        // Check which subway lines are selected
        const hasJKLMN = ["J", "K", "L", "M", "N"].some((line) =>
          selectedLineIds.has(line),
        );
        const hasT = selectedLineIds.has("T");
        const hasF = selectedLineIds.has("F");
        const hasL = selectedLineIds.has("L");

        // F line runs entirely on surface - never show ANY tunnel for F-only
        if (hasF && !hasT && !hasJKLMN) {
          continue; // Skip all tunnels when only F is selected
        }

        // T line only uses Central Subway - skip non-Central-Subway tunnels when T is selected without J/K/L/M/N
        if (hasT && !hasJKLMN) {
          if (!isCentralSubway) {
            continue; // Skip Market Street and other tunnels for T line
          }
        }

        // If F + T are selected together (no J/K/L/M/N), only show Central Subway
        if (hasF && hasT && !hasJKLMN) {
          if (!isCentralSubway) {
            continue;
          }
        }

        // If Market Street tunnel and none of J/K/L/M/N selected, skip it
        // (This handles cases like F+T, or just T, where Market St tunnel shouldn't show)
        if (isMarketStreetTunnel && !hasJKLMN) {
          continue;
        }

        // For L line only: skip tunnel segments west of West Portal (longitude < -122.46)
        // The L line's Twin Peaks Tunnel ends at West Portal; west of there is surface level
        if (hasL && !hasExplicitLines) {
          const sepCoords = sepFeature.geometry.coordinates;
          const allPointsWestOfWestPortal = sepCoords.every(
            ([lon]: number[]) => lon < -122.46,
          );
          if (allPointsWestOfWestPortal) {
            continue; // Skip tunnel segments that are entirely west of West Portal for L line
          }
        }
      }

      const sepCoords = sepFeature.geometry.coordinates;

      // Check if any point of the separation feature is near any route segment
      let isNear = false;
      for (const [lon, lat] of sepCoords) {
        for (const coords of routeCoords) {
          const dist = distanceToLineString(lat, lon, coords);
          if (dist < SEPARATION_PROXIMITY_METERS) {
            isNear = true;
            break;
          }
        }
        if (isNear) break;
      }
      if (isNear) {
        filteredFeatures.push(sepFeature);
      } else if (sepFeature.properties?.isManualOverride) {
        // Debug: log when manual overrides are skipped due to proximity check
        console.log(
          `Manual override "${sepFeature.properties?.id}" skipped - not near any selected route`,
        );
      }
    }
  }

  // For Philadelphia streetcar routes (10, 11, 13, 34, 36), add street_running
  // fallback ONLY for segments that don't already have OSM separation data
  if (city === "Philadelphia") {
    const streetRunningFeatures: any[] = [];

    for (const feature of selectedRoutes.features) {
      const routeId = feature.properties?.route_id;
      if (!PHILLY_STREET_RUNNING_ROUTES.includes(routeId)) continue;

      // Get coordinates from the route geometry
      let lineStrings: number[][][] = [];
      if (feature.geometry?.type === "LineString") {
        lineStrings = [feature.geometry.coordinates];
      } else if (feature.geometry?.type === "MultiLineString") {
        lineStrings = feature.geometry.coordinates;
      }

      // For each linestring, find segments NOT covered by OSM separation data
      for (let i = 0; i < lineStrings.length; i++) {
        const uncoveredSegments = getUncoveredSegments(
          lineStrings[i],
          filteredFeatures,
        );

        for (let j = 0; j < uncoveredSegments.length; j++) {
          streetRunningFeatures.push({
            type: "Feature",
            properties: {
              id: `philly-sr-${routeId}-${i}-${j}-${Math.random().toString(36).substr(2, 9)}`,
              separationType: "street_running",
              name: feature.properties?.route_name || `Route ${routeId}`,
              isStreetRunningFallback: true,
            },
            geometry: {
              type: "LineString",
              coordinates: uncoveredSegments[j],
            },
          });
        }
      }
    }

    // Combine street-running fallback with OSM separation data
    return {
      type: "FeatureCollection",
      features: [...streetRunningFeatures, ...filteredFeatures],
    };
  }

  // For Portland streetcar routes (A, B, NS), add street_running
  // fallback ONLY for segments that don't already have OSM separation data
  if (city === "Portland") {
    const streetRunningFeatures: any[] = [];

    for (const feature of selectedRoutes.features) {
      const routeId = feature.properties?.route_id;
      if (!PORTLAND_STREETCAR_ROUTES.includes(routeId)) continue;

      // Get coordinates from the route geometry
      let lineStrings: number[][][] = [];
      if (feature.geometry?.type === "LineString") {
        lineStrings = [feature.geometry.coordinates];
      } else if (feature.geometry?.type === "MultiLineString") {
        lineStrings = feature.geometry.coordinates;
      }

      // For each linestring, find segments NOT covered by OSM separation data
      for (let i = 0; i < lineStrings.length; i++) {
        const uncoveredSegments = getUncoveredSegments(
          lineStrings[i],
          filteredFeatures,
        );

        for (let j = 0; j < uncoveredSegments.length; j++) {
          streetRunningFeatures.push({
            type: "Feature",
            properties: {
              id: `portland-sr-${routeId}-${i}-${j}-${Math.random().toString(36).substr(2, 9)}`,
              separationType: "street_running",
              name: feature.properties?.route_name || `Route ${routeId}`,
              isStreetRunningFallback: true,
            },
            geometry: {
              type: "LineString",
              coordinates: uncoveredSegments[j],
            },
          });
        }
      }
    }

    // Combine street-running fallback with OSM separation data
    return {
      type: "FeatureCollection",
      features: [...streetRunningFeatures, ...filteredFeatures],
    };
  }

  return { type: "FeatureCollection", features: filteredFeatures };
}

// Build route geometry map for a given city's routes
function buildRouteGeometryMap(routes: any): Map<string, number[][][]> {
  const routeMap = new Map<string, number[][][]>();

  routes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const geomType = feature.geometry.type;
    const coordinates = feature.geometry.coordinates;

    if (!routeMap.has(routeId)) {
      routeMap.set(routeId, []);
    }

    // Handle both LineString and MultiLineString geometries
    if (geomType === "MultiLineString") {
      // MultiLineString: coordinates is array of line strings
      for (const lineCoords of coordinates) {
        routeMap.get(routeId)!.push(lineCoords);
      }
    } else {
      // LineString: coordinates is a single line string
      routeMap.get(routeId)!.push(coordinates);
    }
  });

  return routeMap;
}

// Check if a point is within threshold distance of its route
function isOnRoute(
  lat: number,
  lon: number,
  routeId: string,
  routeGeometryMap: Map<string, number[][][]>,
  city?: string,
): boolean {
  // Skip route check for cities where route geometry doesn't fully cover all track
  // or vehicle positions may be slightly off-track
  if (
    city === "Sacramento" ||
    city === "Salt Lake City" ||
    city === "Pittsburgh" ||
    city === "Calgary"
  ) {
    return true;
  }

  // For Sacramento "Shared" vehicles, check against both Gold and Blue routes
  const routeIdsToCheck = routeId === "Shared" ? ["Gold", "Blue"] : [routeId];

  for (const rid of routeIdsToCheck) {
    const routeLines = routeGeometryMap.get(rid);
    if (!routeLines) continue;

    for (const lineCoords of routeLines) {
      const distance = distanceToLineString(lat, lon, lineCoords);
      if (distance <= MAX_DISTANCE_FROM_ROUTE_METERS) {
        return true;
      }
    }
  }

  // If no route geometry found, allow the point
  if (routeIdsToCheck.every((rid) => !routeGeometryMap.has(rid))) {
    return true;
  }

  return false;
}

// Check if a route should be shown based on selected lines
// Handles Sacramento's "Shared" section: show Shared vehicles when either Gold or Blue is selected
function shouldShowRoute(
  routeId: string,
  selectedLines: string[],
  city: string,
): boolean {
  // Calgary special case: show ALL vehicles regardless of route_id or selected lines
  // This allows us to see all Calgary Transit vehicles (buses, CTrain, etc.)
  if (city === "Calgary") {
    return true;
  }

  // Direct match
  if (selectedLines.includes(routeId)) {
    return true;
  }

  // Sacramento special case: "Shared" vehicles should show when either Gold or Blue is selected
  if (
    city === "Sacramento" &&
    routeId === "Shared" &&
    (selectedLines.includes("Gold") || selectedLines.includes("Blue"))
  ) {
    return true;
  }

  return false;
}

// Segment size in meters
const SEGMENT_SIZE_METERS = 200;

// Calculate distance along a LineString to the nearest point
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

// Create segments along a LineString
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

// Build segment data from routes
interface SegmentData {
  segmentId: string;
  routeId: string;
  coordinates: number[][];
  startDistance: number;
  endDistance: number;
}

function buildAllSegments(routes: any): SegmentData[] {
  const allSegments: SegmentData[] = [];
  // Track cumulative segment offset PER ROUTE across all features
  const routeSegmentOffsets = new Map<string, number>();

  routes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const geometry = feature.geometry;
    const geomType = geometry.type;

    // Get current offset for this route (starts at 0)
    let cumulativeSegmentOffset = routeSegmentOffsets.get(routeId) || 0;

    // Handle both LineString and MultiLineString geometries
    let lineStrings: number[][][];
    if (geomType === "MultiLineString") {
      lineStrings = geometry.coordinates;
    } else {
      // LineString - wrap in array to process uniformly
      lineStrings = [geometry.coordinates];
    }

    // Process all line strings with cumulative offset for segment indexing
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

      // Calculate how many segments this linestring produced
      if (segments.length > 0) {
        const lastIndex = parseInt(
          segments[segments.length - 1].segmentId.split("_").pop() || "0",
        );
        cumulativeSegmentOffset += lastIndex + 1;
      }
    }

    // Store the updated offset for this route
    routeSegmentOffsets.set(routeId, cumulativeSegmentOffset);
  });

  return allSegments;
}

// Cache for route features by routeId - avoids filtering on every call
const routeFeatureCache = new Map<string, Map<string, any[]>>();

// Build route features lookup map once per routes object
function getRouteFeatureMap(routes: any): Map<string, any[]> {
  // Generate a unique cache key based on the first few route_ids to distinguish between cities
  // (Different cities will have different route_ids even if same feature count)
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

// Find segment for a vehicle (optimized with cached route lookup)
function findSegmentForVehicle(
  lat: number,
  lon: number,
  routeId: string,
  routes: any,
  routeFeatureMap?: Map<string, any[]>,
): string | null {
  // Use provided map or build one (for backward compatibility)
  const featureMap = routeFeatureMap || getRouteFeatureMap(routes);
  const routeFeatures = featureMap.get(routeId) || [];

  let bestSegmentIndex: number | null = null;
  let minDistance = Infinity;

  // Track cumulative segment offset across ALL features for this route
  // (same logic as buildAllSegments to ensure consistent segment IDs)
  let cumulativeSegmentOffset = 0;

  for (const feature of routeFeatures) {
    const geometry = (feature as any).geometry;
    const geomType = geometry.type;

    // Handle both LineString and MultiLineString geometries
    let lineStrings: number[][][];
    if (geomType === "MultiLineString") {
      lineStrings = geometry.coordinates;
    } else {
      // LineString - wrap in array to process uniformly
      lineStrings = [geometry.coordinates];
    }

    // Process each line string in the geometry
    for (const coordinates of lineStrings) {
      const result = findNearestPointOnLine(lat, lon, coordinates);

      if (
        result.distance < minDistance &&
        result.distance <= MAX_DISTANCE_FROM_ROUTE_METERS
      ) {
        minDistance = result.distance;
        // Calculate segment index within this linestring, then add cumulative offset
        const localSegmentIndex = Math.floor(
          result.distanceAlong / SEGMENT_SIZE_METERS,
        );
        bestSegmentIndex = cumulativeSegmentOffset + localSegmentIndex;
      }

      // Calculate how many segments this linestring has
      // Must match buildAllSegments logic: floor(length / segment_size) + 1 for the partial end segment
      const lineLength = result.totalLength;
      const segmentsInLine = Math.floor(lineLength / SEGMENT_SIZE_METERS) + 1;
      cumulativeSegmentOffset += segmentsInLine;
    }
  }

  if (
    bestSegmentIndex !== null &&
    minDistance <= MAX_DISTANCE_FROM_ROUTE_METERS
  ) {
    return `${routeId}_${bestSegmentIndex}`;
  }

  return null;
}

// Convert direction_id to human-readable direction
function getDirection(directionId: any): string | undefined {
  if (directionId == null || directionId === "") return undefined;

  const dir = String(directionId).toLowerCase();

  if (dir === "0" || dir === "ob" || dir === "outbound") return "Outbound";
  if (dir === "1" || dir === "ib" || dir === "inbound") return "Inbound";

  return undefined;
}

// SF Muni terminus names by line and direction
const SF_TERMINUS: Record<string, { inbound: string; outbound: string }> = {
  F: { inbound: "to Fisherman's Wharf", outbound: "to Castro" },
  J: { inbound: "to Embarcadero", outbound: "to Balboa Park" },
  K: { inbound: "to Embarcadero", outbound: "to Balboa Park" },
  L: { inbound: "to Embarcadero", outbound: "to SF Zoo" },
  M: { inbound: "to Embarcadero", outbound: "to Balboa Park" },
  N: { inbound: "to Caltrain", outbound: "to Ocean Beach" },
  T: { inbound: "to Chinatown", outbound: "to Sunnydale" },
};

// LA Metro terminus names by line and direction
const LA_TERMINUS: Record<string, { inbound: string; outbound: string }> = {
  "801": { inbound: "to Downtown LA", outbound: "to Long Beach" },
  "802": { inbound: "to Union Station", outbound: "to North Hollywood" },
  "803": { inbound: "to Redondo Beach", outbound: "to Norwalk" },
  "804": { inbound: "to Downtown LA", outbound: "to Santa Monica" },
  "805": { inbound: "to Union Station", outbound: "to Wilshire/Western" },
  "806": { inbound: "to East LA", outbound: "to APU/Citrus College" },
  "807": { inbound: "to Expo/Crenshaw", outbound: "to Westchester/Veterans" },
};

// Boston Green Line branch display names
const BOSTON_BRANCH_NAMES: Record<string, string> = {
  "Green-B": "B Branch",
  "Green-C": "C Branch",
  "Green-D": "D Branch",
  "Green-E": "E Branch",
};

interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  routeId: string;
  direction?: string;
  speed?: number;
  recordedAt: string;
  segmentId?: string | null;
  headsign?: string | null;
}

// Module-level cache - persists across component remounts for instant city switching
const cityDataCache = new Map<City, Vehicle[]>();

// Track if we've already started background preloading
let preloadStarted = false;

// Only select columns we actually use (reduces data transfer by ~40%)
const POSITION_COLUMNS =
  "id,vehicle_id,lat,lon,route_id,direction_id,speed_calculated,recorded_at,headsign";

// Parallel fetch helper - fetches multiple pages concurrently
async function fetchPagesParallel(
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
      // Handle San Diego like SF - include both legacy (null) and new data
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.San Diego")
        .order("recorded_at", { ascending: false })
        .range(from, from + pageSize - 1);
    } else if (targetCity === "Calgary") {
      // Handle Calgary like SF/San Diego - include both legacy (null) and new data
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.Calgary")
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

// Background preload function - fetches and caches a city's data without UI updates
async function preloadCityData(targetCity: City): Promise<void> {
  // Skip if already cached or no supabase
  if (cityDataCache.has(targetCity) || !supabase) return;

  try {
    // First ensure static data is loaded for this city
    const staticData = await loadCityData(targetCity);

    const PAGE_SIZE = 1000;
    // Fetch first page to estimate total count
    let query;
    if (targetCity === "SF") {
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.SF")
        .order("recorded_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);
    } else if (targetCity === "San Diego") {
      // Handle San Diego like SF - include both legacy (null) and new data
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.San Diego")
        .order("recorded_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);
    } else if (targetCity === "Calgary") {
      // Handle Calgary like SF/San Diego - include both legacy (null) and new data
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .or("city.is.null,city.eq.Calgary")
        .order("recorded_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);
    } else {
      query = supabase
        .from("vehicle_positions")
        .select(POSITION_COLUMNS)
        .eq("city", targetCity)
        .order("recorded_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);
    }

    const { data: firstPage, error } = await query;
    if (error || !firstPage) return;

    let allData = [...firstPage];

    // If first page is full, fetch remaining pages in parallel
    if (firstPage.length === PAGE_SIZE) {
      const PARALLEL_BATCH = 5;
      let pageNum = 1;
      let hasMore = true;

      while (hasMore) {
        const batchData = await fetchPagesParallel(
          targetCity,
          pageNum,
          PARALLEL_BATCH,
          PAGE_SIZE,
        );
        allData = [...allData, ...batchData];

        hasMore = batchData.length === PARALLEL_BATCH * PAGE_SIZE;
        pageNum += PARALLEL_BATCH;

        // Safety limit: max 30 pages (30k positions)
        if (pageNum > 30) break;
      }
    }

    // Filter to valid lines and transform
    const validLines = getLinesForCity(targetCity);
    const filteredData = allData.filter((row: any) => {
      if (validLines.includes(row.route_id)) return true;
      if (targetCity === "Sacramento" && row.route_id === "Shared") return true;
      // Calgary special case: include ALL vehicles regardless of route_id
      if (targetCity === "Calgary") return true;
      return false;
    });

    // Build route feature map once (optimization: avoids filtering per-vehicle)
    const routeFeatureMap = getRouteFeatureMap(staticData.routes);

    const positions: Vehicle[] = filteredData.map((row: any) => ({
      id: `${row.vehicle_id}-${row.id}`,
      lat: row.lat,
      lon: row.lon,
      routeId: row.route_id,
      direction: getDirection(row.direction_id),
      speed: row.speed_calculated,
      recordedAt: row.recorded_at,
      segmentId: findSegmentForVehicle(
        row.lat,
        row.lon,
        row.route_id,
        staticData.routes,
        routeFeatureMap,
      ),
      headsign: row.headsign,
    }));

    // Store in cache
    cityDataCache.set(targetCity, positions);
    console.log(
      `Background preloaded ${targetCity}: ${positions.length} positions`,
    );
  } catch (error) {
    console.warn(`Failed to preload ${targetCity}:`, error);
  }
}

// Start background preloading for all cities (staggered)
function startBackgroundPreload(currentCity: City) {
  if (preloadStarted) return;
  preloadStarted = true;

  const otherCities = CITIES.filter((c) => c !== currentCity);

  // Stagger requests by 500ms each to avoid hammering the server
  otherCities.forEach((city, index) => {
    setTimeout(
      () => {
        preloadCityData(city);
      },
      (index + 1) * 500,
    );
  });
}

interface SpeedMapProps {
  city: City;
  selectedLines: string[];
  speedFilter: SpeedFilter;
  showRouteLines: boolean;
  routeLineMode: "byLine" | "bySpeedLimit" | "bySeparation";
  showStops: boolean;
  showCrossings: boolean;
  showSwitches: boolean;
  showRailContextHeavy: boolean;
  showRailContextCommuter: boolean;
  hideStoppedTrains: boolean;
  viewMode: ViewMode;
  showSatellite: boolean;
  onSatelliteToggle?: (show: boolean) => void;
  speedUnit: "mph" | "kmh";
  onVehicleUpdate?: (
    count: number,
    time: Date,
    lineStats?: LineStats[],
    dataAgeMinutes?: number,
  ) => void;
  onRailContextUpdate?: (heavyCount: number, commuterCount: number) => void;
}

export function SpeedMap({
  city,
  selectedLines,
  speedFilter,
  showRouteLines,
  routeLineMode,
  showStops,
  showCrossings,
  showSwitches,
  showRailContextHeavy,
  showRailContextCommuter,
  hideStoppedTrains,
  viewMode,
  showSatellite,
  onSatelliteToggle,
  speedUnit,
  onVehicleUpdate,
  onRailContextUpdate,
}: SpeedMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const crossingPopupPinned = useRef(false);
  const crossingHandlersRegistered = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [expandedStopCluster, setExpandedStopCluster] = useState<string | null>(
    null,
  );
  // Reset expanded cluster when city changes
  useEffect(() => {
    setExpandedStopCluster(null);
  }, [city]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "supabase" | "none">(
    "loading",
  );
  const [loadingProgress, setLoadingProgress] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);

  // City static data - loaded lazily on-demand
  const [cityStaticData, setCityStaticData] = useState<CityStaticData | null>(
    () => getCachedCityData(city) || null,
  );
  const [cityDataLoading, setCityDataLoading] = useState(
    !isCityDataCached(city),
  );

  // Ref to avoid re-render loops with the callback
  const onVehicleUpdateRef = useRef(onVehicleUpdate);
  onVehicleUpdateRef.current = onVehicleUpdate;

  // Keep speedUnit in a ref so event handlers can access current value
  const speedUnitRef = useRef(speedUnit);
  speedUnitRef.current = speedUnit;

  // Speed unit conversion helpers (using ref for event handlers)
  const formatSpeedFromRef = (mph: number): string => {
    const unit = speedUnitRef.current;
    const value = unit === "kmh" ? mph * 1.60934 : mph;
    return unit === "kmh"
      ? `${Math.round(value)} km/h`
      : `${Math.round(value)} mph`;
  };

  const formatAvgSpeedFromRef = (mph: number): string => {
    const unit = speedUnitRef.current;
    const value = unit === "kmh" ? mph * 1.60934 : mph;
    return unit === "kmh"
      ? `${value.toFixed(1)} km/h`
      : `${value.toFixed(1)} mph`;
  };

  // Load city static data when city changes
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      // Check if already cached (instant)
      const cached = getCachedCityData(city);
      if (cached) {
        setCityStaticData(cached);
        setCityDataLoading(false);
        return;
      }

      // Show loading state
      setCityDataLoading(true);
      setLoadingProgress("Loading city data...");

      try {
        const data = await loadCityData(city);
        if (!cancelled) {
          setCityStaticData(data);
          setCityDataLoading(false);
          setLoadingProgress("");
          // Start preloading other popular cities in the background
          startBackgroundStaticPreload(city);
        }
      } catch (error) {
        console.error(`Failed to load ${city} data:`, error);
        if (!cancelled) {
          setCityStaticData(EMPTY_CITY_DATA);
          setCityDataLoading(false);
          setLoadingProgress("");
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [city]);

  // Use loaded city data or empty placeholder
  const cityConfig = useMemo(
    () => ({
      ...CITY_COORDS[city],
      routes: cityStaticData?.routes || EMPTY_CITY_DATA.routes,
      stops: cityStaticData?.stops || EMPTY_CITY_DATA.stops,
      crossings: cityStaticData?.crossings || EMPTY_CITY_DATA.crossings,
      switches: cityStaticData?.switches || EMPTY_CITY_DATA.switches,
      maxspeed: cityStaticData?.maxspeed || null,
      tunnelsBridges: cityStaticData?.tunnelsBridges || null,
      separation: cityStaticData?.separation || null,
      railContextHeavy: cityStaticData?.railContextHeavy || null,
      railContextCommuter: cityStaticData?.railContextCommuter || null,
    }),
    [city, cityStaticData],
  );

  const effectiveRailContext = useMemo(() => {
    const heavy = cityConfig.railContextHeavy;
    const commuter = cityConfig.railContextCommuter;

    // Hard fallback: if SLC rail context is empty at runtime, use static JSON imports directly.
    if (
      city === "Salt Lake City" &&
      (!commuter?.features || commuter.features.length === 0) &&
      (slcRailContextCommuter as any)?.features?.length > 0
    ) {
      console.warn(
        "Using SLC rail-context static fallback in SpeedMap (loader returned empty).",
      );
      return {
        heavy:
          (slcRailContextHeavy as any)?.features?.length > 0
            ? (slcRailContextHeavy as any)
            : heavy,
        commuter: slcRailContextCommuter as any,
      };
    }

    return { heavy, commuter };
  }, [city, cityConfig.railContextHeavy, cityConfig.railContextCommuter]);

  const railContextCounts = useMemo(
    () => ({
      heavy: effectiveRailContext.heavy?.features?.length || 0,
      commuter: effectiveRailContext.commuter?.features?.length || 0,
    }),
    [effectiveRailContext],
  );

  useEffect(() => {
    onRailContextUpdate?.(railContextCounts.heavy, railContextCounts.commuter);
  }, [onRailContextUpdate, railContextCounts]);

  const handleRailContextMouseEnter = useCallback(() => {
    if (map.current) map.current.getCanvas().style.cursor = "pointer";
  }, []);

  const handleRailContextMouseLeave = useCallback(() => {
    if (map.current) map.current.getCanvas().style.cursor = "";
    if (!crossingPopupPinned.current) popup.current?.remove();
  }, []);

  const handleRailContextMouseMove = useCallback(
    (e: maplibregl.MapMouseEvent & { point: maplibregl.PointLike }) => {
      if (!map.current) return;
      const features = map.current.queryRenderedFeatures(e.point, {
        layers: ["rail-context-heavy", "rail-context-commuter"],
      });
      if (!features.length) return;

      const dedupe = new Set<string>();
      const heavy: Array<{ service: string; agency: string }> = [];
      const commuter: Array<{ service: string; agency: string }> = [];

      for (const feature of features) {
        const props = (feature.properties || {}) as Record<string, any>;
        const shortName = (props.route_short_name || "").toString().trim();
        const longName = (props.route_long_name || "").toString().trim();
        const routeId = (props.route_id || "Unknown route").toString().trim();
        const agencyName = (props.agency_name || "Unknown agency")
          .toString()
          .trim();
        const serviceClass = (
          props.service_class ||
          (feature.layer.id === "rail-context-heavy" ? "heavy" : "commuter")
        )
          .toString()
          .trim()
          .toLowerCase();

        const serviceName =
          shortName && longName
            ? `${shortName} ${longName}`
            : shortName || longName || routeId;
        const key = `${serviceClass}|${serviceName}|${agencyName}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);

        if (serviceClass === "heavy") {
          heavy.push({ service: serviceName, agency: agencyName });
        } else {
          commuter.push({ service: serviceName, agency: agencyName });
        }
      }

      const groupHtml = (items: Array<{ service: string; agency: string }>) =>
        items
          .sort((a, b) => a.service.localeCompare(b.service))
          .map(
            (item) =>
              `<div class="popup-detail">${escapeHtml(item.service)} <span style="color:#9ca3af">(${escapeHtml(item.agency)})</span></div>`,
          )
          .join("");

      popup.current
        ?.setLngLat(e.lngLat)
        .setHTML(
          `<div class="popup-content">
            <div class="popup-title">Passenger Rail</div>
            ${
              heavy.length
                ? `<div class="popup-detail" style="margin-top:4px;color:#d1d5db">Heavy rail / metro</div>${groupHtml(heavy)}`
                : ""
            }
            ${
              commuter.length
                ? `<div class="popup-detail" style="margin-top:4px;color:#d1d5db">Regional / commuter rail</div>${groupHtml(commuter)}`
                : ""
            }
          </div>`,
        )
        .addTo(map.current);
    },
    [],
  );

  // Cluster stops by exact name - shows single marker for stations with same name
  // Returns { clustered: features for merged markers, individual: all original features keyed by name }
  const clusteredStops = useMemo(() => {
    const features = cityConfig.stops?.features || [];

    // Group stops by name
    const byName: Record<string, any[]> = {};
    for (const f of features) {
      const name = f.properties?.stop_name || "Unknown";
      if (!byName[name]) byName[name] = [];
      byName[name].push(f);
    }

    // Build clustered features (centroid for multi-stop clusters, original for singles)
    const clustered: any[] = [];
    const individualByCluster: Record<string, any[]> = {};

    for (const [name, stops] of Object.entries(byName)) {
      if (stops.length === 1) {
        // Single stop - use as-is, not a cluster
        clustered.push({
          ...stops[0],
          properties: {
            ...stops[0].properties,
            is_cluster: false,
            cluster_size: 1,
            cluster_name: name,
          },
        });
      } else {
        // Multiple stops with same name - compute centroid
        let sumLon = 0,
          sumLat = 0;
        const allRoutes = new Set<string>();
        for (const s of stops) {
          const [lon, lat] = s.geometry.coordinates;
          sumLon += lon;
          sumLat += lat;
          const routes = s.properties?.routes || [];
          routes.forEach((r: string) => allRoutes.add(r));
        }
        const centroid: [number, number] = [
          sumLon / stops.length,
          sumLat / stops.length,
        ];

        clustered.push({
          type: "Feature",
          properties: {
            stop_name: name,
            cluster_name: name,
            is_cluster: true,
            cluster_size: stops.length,
            routes: Array.from(allRoutes),
          },
          geometry: {
            type: "Point",
            coordinates: centroid,
          },
        });

        // Store individual stops for expansion
        individualByCluster[name] = stops.map((s) => ({
          ...s,
          properties: {
            ...s.properties,
            is_cluster: false,
            cluster_name: name,
          },
        }));
      }
    }

    return {
      clustered: { type: "FeatureCollection", features: clustered },
      individualByCluster,
    };
  }, [cityConfig.stops]);

  const routeGeometryMap = useMemo(
    () => buildRouteGeometryMap(cityConfig.routes),
    [cityConfig.routes],
  );
  const allRouteSegments = useMemo(
    () => buildAllSegments(cityConfig.routes),
    [cityConfig.routes],
  );

  // Compute live vehicles - only the latest position for each unique vehicle
  const liveVehicles = useMemo(() => {
    const latestByVehicle = new Map<string, Vehicle>();

    // Vehicles are already sorted by recorded_at desc, so first occurrence is latest
    vehicles.forEach((v) => {
      // Extract the vehicle ID - it's everything except the last segment (which is the DB row id)
      // Format: "${vehicle_id}-${row.id}" e.g. "1234-56789" or "G-10001-56789"
      const parts = v.id.split("-");
      const vehicleId =
        parts.length > 1 ? parts.slice(0, -1).join("-") : parts[0];
      if (!latestByVehicle.has(vehicleId)) {
        latestByVehicle.set(vehicleId, v);
      }
    });

    return Array.from(latestByVehicle.values());
  }, [vehicles]);

  // Fetch vehicle positions from Supabase filtered by city
  const fetchVehiclesFromSupabase = useCallback(async () => {
    if (!supabase) {
      setDataSource("none");
      return;
    }

    // Check cache first - instant city switching!
    const cached = cityDataCache.get(city);
    if (cached && cached.length > 0) {
      console.log(`Using cached ${city} data: ${cached.length} positions`);
      setVehicles(cached);
      setDataSource("supabase");
      return;
    }

    try {
      const PAGE_SIZE = 1000;
      const PARALLEL_BATCH = 5; // Fetch 5 pages at once

      setLoadingProgress("Loading positions...");
      console.time("Fetching data");

      // Fetch first page to check data availability
      let query;
      if (city === "SF") {
        query = supabase
          .from("vehicle_positions")
          .select(POSITION_COLUMNS)
          .or("city.is.null,city.eq.SF")
          .order("recorded_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);
      } else if (city === "San Diego") {
        // Handle San Diego like SF - include both legacy (null) and new data
        query = supabase
          .from("vehicle_positions")
          .select(POSITION_COLUMNS)
          .or("city.is.null,city.eq.San Diego")
          .order("recorded_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);
      } else if (city === "Calgary") {
        // Handle Calgary like SF/San Diego - include both legacy (null) and new data
        query = supabase
          .from("vehicle_positions")
          .select(POSITION_COLUMNS)
          .or("city.is.null,city.eq.Calgary")
          .order("recorded_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);
      } else {
        query = supabase
          .from("vehicle_positions")
          .select(POSITION_COLUMNS)
          .eq("city", city)
          .order("recorded_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);
      }

      let { data: firstPage, error } = await query;

      // Legacy fallback for old schema
      if (error && error.code === "42703") {
        console.log("City column not found, fetching all data (legacy)...");
        const fallbackQuery = supabase
          .from("vehicle_positions")
          .select(POSITION_COLUMNS)
          .order("recorded_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);
        const result = await fallbackQuery;
        firstPage = result.data;
        error = result.error;
      }

      if (error) {
        console.error("Error fetching from Supabase:", error);
        setLoadingProgress("");
        return;
      }

      let allData = firstPage || [];
      setLoadingProgress(
        `Loading... ${allData.length.toLocaleString()} positions`,
      );

      // If first page is full, fetch remaining pages in parallel batches
      if (firstPage && firstPage.length === PAGE_SIZE) {
        let pageNum = 1;
        let hasMore = true;

        while (hasMore) {
          const batchData = await fetchPagesParallel(
            city,
            pageNum,
            PARALLEL_BATCH,
            PAGE_SIZE,
          );
          allData = [...allData, ...batchData];
          setLoadingProgress(
            `Loading... ${allData.length.toLocaleString()} positions`,
          );

          hasMore = batchData.length === PARALLEL_BATCH * PAGE_SIZE;
          pageNum += PARALLEL_BATCH;

          // Safety limit: max 30 pages (30k positions)
          if (pageNum > 30) break;
        }
      }

      console.timeEnd("Fetching data");
      console.log(`Fetched ${allData.length} ${city} positions (all-time)`);

      // Show processing phase
      setLoadingProgress(
        `Processing ${allData.length.toLocaleString()} positions...`,
      );
      setIsProcessing(true);

      // Small delay to let React update UI before heavy processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Filter to only valid lines for this city (removes data for removed lines like Mattapan)
      // For Sacramento, also include "Shared" for downtown shared section vehicles
      const validLines = getLinesForCity(city);
      const filteredData = allData.filter((row: any) => {
        if (validLines.includes(row.route_id)) return true;
        // Sacramento special case: include "Shared" vehicles
        if (city === "Sacramento" && row.route_id === "Shared") return true;
        // Calgary special case: include ALL vehicles regardless of route_id
        if (city === "Calgary") return true;
        return false;
      });
      console.log(
        `Filtered to ${filteredData.length} positions for valid lines`,
      );

      // Pre-compute segment assignments
      setLoadingProgress(
        `Mapping ${filteredData.length.toLocaleString()} positions to track...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      console.time("Pre-computing segments");

      // Build route feature map once (optimization: avoids filtering per-vehicle)
      const routeFeatureMap = getRouteFeatureMap(cityConfig.routes);

      const allPositions: Vehicle[] = filteredData.map((row: any) => {
        const lat = row.lat;
        const lon = row.lon;
        const routeId = row.route_id;
        return {
          id: `${row.vehicle_id}-${row.id}`,
          lat,
          lon,
          routeId,
          direction: getDirection(row.direction_id),
          speed: row.speed_calculated,
          recordedAt: row.recorded_at,
          segmentId: findSegmentForVehicle(
            lat,
            lon,
            routeId,
            cityConfig.routes,
            routeFeatureMap,
          ),
          headsign: row.headsign,
        };
      });
      console.timeEnd("Pre-computing segments");

      // Cache the results for instant switching
      cityDataCache.set(city, allPositions);

      // Start background preloading other cities
      startBackgroundPreload(city);

      // Show rendering phase
      setLoadingProgress(
        `Rendering ${allPositions.length.toLocaleString()} data points...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      setVehicles(allPositions);
      setDataSource("supabase");

      // Calculate line statistics (allPositions already filtered to valid lines)
      // Exclude 0 mph readings (trains in yards, at terminals, etc.) from averages
      const lineSpeedMap = new Map<string, number[]>();
      allPositions.forEach((v) => {
        if (v.speed == null || v.speed < 0.5) return; // Skip null and ~0 mph readings
        if (!lineSpeedMap.has(v.routeId)) {
          lineSpeedMap.set(v.routeId, []);
        }
        lineSpeedMap.get(v.routeId)!.push(v.speed);
      });

      const stats: LineStats[] = [];
      lineSpeedMap.forEach((speeds, line) => {
        // Skip "Shared" from stats display - it's an internal classification for Sacramento
        if (line === "Shared") return;

        const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        const sorted = [...speeds].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median =
          sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
        stats.push({
          line,
          avgSpeed: avg,
          medianSpeed: median,
          count: speeds.length,
        });
      });
      stats.sort((a, b) => b.avgSpeed - a.avgSpeed);

      if (allPositions.length > 0) {
        const latestTime = new Date(allPositions[0].recordedAt);
        // Calculate how many minutes old the latest data is
        const dataAgeMinutes =
          (Date.now() - latestTime.getTime()) / (1000 * 60);
        onVehicleUpdateRef.current?.(
          allPositions.length,
          latestTime,
          stats,
          dataAgeMinutes,
        );
      } else {
        onVehicleUpdateRef.current?.(0, new Date(), [], undefined);
      }

      // Show rendering phase - will be cleared by idle event listener
      // after MapLibre finishes rendering all the data
      setLoadingProgress("Rendering...");
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      setDataSource("none");
      setLoadingProgress("");
      setIsProcessing(false);
    }
  }, [city, cityConfig.routes]);

  // Fetch data when city changes (but only after static data is loaded)
  useEffect(() => {
    // Don't fetch if static data isn't loaded yet
    if (cityDataLoading || !cityStaticData) {
      return;
    }

    // Check cache first - if cached, don't show loading state
    const cached = cityDataCache.get(city);
    if (cached && cached.length > 0) {
      // Instant switch - use cached data
      setVehicles(cached);
      setDataSource("supabase");
      setLoadingProgress("Rendering...");
      // Note: setIsProcessing(false) will be called by the idle listener in vehicles useEffect
      console.log(`Instant cache hit for ${city}: ${cached.length} positions`);

      // Also update parent with cached data stats
      if (cached.length > 0) {
        const timestamps = cached.map((v) => new Date(v.recordedAt).getTime());
        const latestTime = new Date(Math.max(...timestamps));
        const dataAgeMinutes =
          (Date.now() - latestTime.getTime()) / (1000 * 60);

        // Calculate line stats from cached data
        // Exclude 0 mph readings (trains in yards, at terminals, etc.) from averages
        const lineSpeedMap = new Map<string, number[]>();
        cached.forEach((v) => {
          if (v.speed == null || v.speed < 0.5) return; // Skip null and ~0 mph readings
          if (!lineSpeedMap.has(v.routeId)) {
            lineSpeedMap.set(v.routeId, []);
          }
          lineSpeedMap.get(v.routeId)!.push(v.speed);
        });

        const stats: LineStats[] = [];
        lineSpeedMap.forEach((speeds, line) => {
          if (line === "Shared") return;
          const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          const sorted = [...speeds].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const median =
            sorted.length % 2 !== 0
              ? sorted[mid]
              : (sorted[mid - 1] + sorted[mid]) / 2;
          stats.push({
            line,
            avgSpeed: avg,
            medianSpeed: median,
            count: speeds.length,
          });
        });

        onVehicleUpdateRef.current?.(
          cached.length,
          latestTime,
          stats,
          dataAgeMinutes,
        );
      }
      return;
    }
    // No cache - show loading and fetch
    setVehicles([]);
    setDataSource("loading");
    fetchVehiclesFromSupabase();
  }, [city, cityDataLoading, cityStaticData, fetchVehiclesFromSupabase]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    // Remove existing map if any
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    // Reset handler registration flags for new map
    crossingHandlersRegistered.current = false;

    // Reset mapLoaded state for new map
    setMapLoaded(false);

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap &copy; CARTO",
          },
          "esri-satellite": {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "&copy; Esri, Maxar, Earthstar Geographics",
          },
        },
        layers: [
          {
            id: "carto-dark-layer",
            type: "raster",
            source: "carto-dark",
            minzoom: 0,
            maxzoom: 19,
          },
          {
            id: "satellite-layer",
            type: "raster",
            source: "esri-satellite",
            minzoom: 0,
            maxzoom: 19,
            layout: {
              visibility: "none", // Hidden by default
            },
          },
        ],
      },
      center: cityConfig.center,
      zoom: cityConfig.zoom,
      minZoom: 9,
      maxZoom: 18,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");

    // Add scale control showing both miles and kilometers
    map.current.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 150,
        unit: "imperial", // Shows miles
      }),
      "bottom-left",
    );
    map.current.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 150,
        unit: "metric", // Shows kilometers
      }),
      "bottom-left",
    );

    popup.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    map.current.on("load", () => {
      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [city]); // Re-initialize map when city changes

  // Speed-based color scale (memoized to prevent re-renders)
  // Uses same scale as speed limits for consistency
  const speedColorExpression: maplibregl.ExpressionSpecification = useMemo(
    () => [
      "case",
      ["==", ["get", "speed"], null],
      "#666666", // grey - no data
      ["<=", ["get", "speed"], 5],
      "#9b2d6b", // magenta - crawling (≤5 mph)
      ["<", ["get", "speed"], 10],
      "#ff3333", // red - very slow (< 10 mph)
      ["<", ["get", "speed"], 15],
      "#ff9933", // orange - slow (10-15 mph)
      ["<", ["get", "speed"], 25],
      "#ffdd33", // yellow - moderate (15-25 mph)
      ["<", ["get", "speed"], 35],
      "#88ff33", // light green - good (25-35 mph)
      ["<", ["get", "speed"], 50],
      "#33eebb", // teal - fast (35-50 mph)
      "#22ccff", // cyan - very fast (50+ mph)
    ],
    [],
  );

  // Speed limit color scale (extended for higher speeds typical of light rail)
  const maxspeedColorExpression: maplibregl.ExpressionSpecification = useMemo(
    () => [
      "case",
      ["==", ["get", "maxspeed_mph"], null],
      "#666666", // grey - no data
      ["<=", ["get", "maxspeed_mph"], 5],
      "#9b2d6b", // magenta - crawling (≤5 mph)
      ["<", ["get", "maxspeed_mph"], 10],
      "#ff3333", // red - very slow (< 10 mph)
      ["<", ["get", "maxspeed_mph"], 15],
      "#ff9933", // orange - slow (10-15 mph)
      ["<", ["get", "maxspeed_mph"], 25],
      "#ffdd33", // yellow - moderate (15-25 mph)
      ["<", ["get", "maxspeed_mph"], 35],
      "#88ff33", // light green - good (25-35 mph)
      ["<", ["get", "maxspeed_mph"], 50],
      "#33eebb", // teal - fast (35-50 mph) - slightly more green
      "#22ccff", // cyan - very fast (50+ mph) - slightly more blue
    ],
    [],
  );

  // Add routes layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addRouteLayers = () => {
      if (!map.current) return;

      const _showByLine = showRouteLines && routeLineMode === "byLine";
      const showBySpeed = showRouteLines && routeLineMode === "bySpeedLimit";
      const showBySeparation =
        showRouteLines && routeLineMode === "bySeparation";
      void _showByLine; // Silence unused variable warning

      // If no lines selected, show no routes; otherwise filter to selected
      // Skip filtering for cities with OSM-sourced route data that don't have line-specific routes
      // These cities have route_id: "default" for all routes, so line filters won't work
      const osmSourcedCities = ["Dallas", "Denver"];
      const skipRouteFiltering = osmSourcedCities.includes(city);

      const filteredRoutes = {
        ...cityConfig.routes,
        features:
          selectedLines.length === 0
            ? [] // Show nothing when all lines deselected
            : skipRouteFiltering
              ? cityConfig.routes.features
              : cityConfig.routes.features.filter((f: any) => {
                  // Check if route matches any selected line
                  if (selectedLines.includes(f.properties.route_id))
                    return true;
                  // For shared routes (Pittsburgh), show when Red, Blue, or Silver is selected
                  if (
                    f.properties.route_id === "shared" &&
                    city === "Pittsburgh"
                  ) {
                    return (
                      selectedLines.includes("RED") ||
                      selectedLines.includes("BLUE") ||
                      selectedLines.includes("SLVR")
                    );
                  }
                  // For OSM routes with multiple lines, check if any line matches
                  if (f.properties.lines && Array.isArray(f.properties.lines)) {
                    return f.properties.lines.some((line: string) =>
                      selectedLines.includes(line),
                    );
                  }
                  return false;
                }),
      };

      // Tunnel visualization disabled for now - proximity-based matching between GTFS routes
      // and OSM tunnel geometry is too imprecise (20-50m offsets between data sources).
      // This was causing incorrect tunnel sections to appear on some lines (e.g., J Church).
      // TODO: Implement more accurate tunnel detection, possibly using static tunnel portal
      // locations or pre-computed route-to-tunnel mappings per city.

      // Separate under-construction routes (like Line 5 Eglinton) for dashed styling
      const constructionRoutes = {
        type: "FeatureCollection",
        features: filteredRoutes.features.filter(
          (f: any) => f.properties.under_construction,
        ),
      };
      const regularRoutes = {
        type: "FeatureCollection",
        features: filteredRoutes.features.filter(
          (f: any) => !f.properties.under_construction,
        ),
      };
      const tunnelRoutes = { type: "FeatureCollection", features: [] };

      // Remove existing layers and sources - recreate fresh on each update
      try {
        if (map.current.getLayer("routes-outline"))
          map.current.removeLayer("routes-outline");
        if (map.current.getLayer("routes")) map.current.removeLayer("routes");
        if (map.current.getLayer("routes-construction-outline"))
          map.current.removeLayer("routes-construction-outline");
        if (map.current.getLayer("routes-construction"))
          map.current.removeLayer("routes-construction");
        if (map.current.getLayer("routes-tunnel-outline"))
          map.current.removeLayer("routes-tunnel-outline");
        if (map.current.getLayer("routes-tunnel"))
          map.current.removeLayer("routes-tunnel");
        if (map.current.getLayer("rail-context-heavy"))
          map.current.removeLayer("rail-context-heavy");
        if (map.current.getLayer("rail-context-commuter"))
          map.current.removeLayer("rail-context-commuter");
        if (map.current.getSource("routes")) map.current.removeSource("routes");
        if (map.current.getSource("routes-construction"))
          map.current.removeSource("routes-construction");
        if (map.current.getSource("routes-tunnel"))
          map.current.removeSource("routes-tunnel");
        if (map.current.getSource("rail-context-heavy-src"))
          map.current.removeSource("rail-context-heavy-src");
        if (map.current.getSource("rail-context-commuter-src"))
          map.current.removeSource("rail-context-commuter-src");
        // Speed limit layers
        if (map.current.getLayer("speed-limit-outline"))
          map.current.removeLayer("speed-limit-outline");
        if (map.current.getLayer("speed-limit"))
          map.current.removeLayer("speed-limit");
        if (map.current.getLayer("speed-limit-labels"))
          map.current.removeLayer("speed-limit-labels");
        if (map.current.getSource("speed-limit"))
          map.current.removeSource("speed-limit");
        // Separation layers
        if (map.current.getLayer("separation-outline"))
          map.current.removeLayer("separation-outline");
        if (map.current.getLayer("separation"))
          map.current.removeLayer("separation");
        if (map.current.getSource("separation"))
          map.current.removeSource("separation");
      } catch (e) {
        // Layer/source may not exist, ignore
      }

      // Add regular routes (solid lines)
      map.current.addSource("routes", {
        type: "geojson",
        data: regularRoutes as any,
      });

      // Add tunnel routes (will be dashed)
      map.current.addSource("routes-tunnel", {
        type: "geojson",
        data: tunnelRoutes as any,
      });

      // Add under-construction routes (dashed lines with construction pattern)
      map.current.addSource("routes-construction", {
        type: "geojson",
        data: constructionRoutes as any,
      });

      map.current.addSource("rail-context-heavy-src", {
        type: "geojson",
        data: effectiveRailContext.heavy || {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.current.addSource("rail-context-commuter-src", {
        type: "geojson",
        data: effectiveRailContext.commuter || {
          type: "FeatureCollection",
          features: [],
        },
      });
      console.log(
        `Rail context for ${city}: heavy=${effectiveRailContext.heavy?.features?.length || 0}, commuter=${effectiveRailContext.commuter?.features?.length || 0}`,
      );

      const firstDataLayer = map.current.getLayer("vehicles-glow")
        ? "vehicles-glow"
        : map.current.getLayer("stops")
          ? "stops"
          : undefined;

      map.current.addLayer(
        {
          id: "rail-context-heavy",
          type: "line",
          source: "rail-context-heavy-src",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRailContextHeavy ? "visible" : "none",
          },
          paint: {
            "line-color": "#d7dee8",
            "line-width": 3.5,
            "line-opacity": 0.9,
          },
        },
        firstDataLayer,
      );

      map.current.addLayer(
        {
          id: "rail-context-commuter",
          type: "line",
          source: "rail-context-commuter-src",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRailContextCommuter ? "visible" : "none",
          },
          paint: {
            "line-color": "#77c4ff",
            "line-width": 2.1,
            "line-opacity": 0.95,
          },
        },
        firstDataLayer,
      );

      for (const layerId of ["rail-context-heavy", "rail-context-commuter"]) {
        map.current.off("mouseenter", layerId, handleRailContextMouseEnter);
        map.current.off("mouseleave", layerId, handleRailContextMouseLeave);
        map.current.off("mousemove", layerId, handleRailContextMouseMove);
        map.current.on("mouseenter", layerId, handleRailContextMouseEnter);
        map.current.on("mouseleave", layerId, handleRailContextMouseLeave);
        map.current.on("mousemove", layerId, handleRailContextMouseMove);
      }

      // Regular route layers
      // When "byLine" mode: colored by transit line
      // When "bySpeedLimit" mode: grey as fallback for segments without speed data
      map.current.addLayer(
        {
          id: "routes-outline",
          type: "line",
          source: "routes",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRouteLines ? "visible" : "none",
          },
          paint: {
            "line-color": "#000",
            "line-width": 7,
            "line-opacity": 0.6,
          },
        },
        firstDataLayer,
      );

      map.current.addLayer(
        {
          id: "routes",
          type: "line",
          source: "routes",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRouteLines ? "visible" : "none",
          },
          paint: {
            // Grey when in speed limit or separation mode (as fallback for areas without data)
            "line-color":
              showBySpeed || showBySeparation
                ? "#6b7280"
                : ["get", "route_color"],
            "line-width": 4,
            "line-opacity": 0.9,
          },
        },
        firstDataLayer,
      );

      // Under-construction route layers (dashed lines to indicate not yet operational)
      map.current.addLayer(
        {
          id: "routes-construction-outline",
          type: "line",
          source: "routes-construction",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRouteLines ? "visible" : "none",
          },
          paint: {
            "line-color": "#000",
            "line-width": 7,
            "line-opacity": 0.5,
            "line-dasharray": [2, 2], // Dashed pattern for construction
          },
        },
        firstDataLayer,
      );

      map.current.addLayer(
        {
          id: "routes-construction",
          type: "line",
          source: "routes-construction",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRouteLines ? "visible" : "none",
          },
          paint: {
            "line-color":
              showBySpeed || showBySeparation
                ? "#6b7280"
                : ["get", "route_color"],
            "line-width": 4,
            "line-opacity": 0.8,
            "line-dasharray": [2, 2], // Dashed pattern for construction
          },
        },
        firstDataLayer,
      );

      // Tunnel route layers (reduced opacity like OpenRailwayMap - faded appearance)
      map.current.addLayer(
        {
          id: "routes-tunnel-outline",
          type: "line",
          source: "routes-tunnel",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRouteLines ? "visible" : "none",
          },
          paint: {
            "line-color": "#000",
            "line-width": 7,
            "line-opacity": 0.3, // Reduced opacity for faded tunnel look
          },
        },
        firstDataLayer,
      );

      map.current.addLayer(
        {
          id: "routes-tunnel",
          type: "line",
          source: "routes-tunnel",
          layout: {
            "line-join": "round",
            "line-cap": "round",
            visibility: showRouteLines ? "visible" : "none",
          },
          paint: {
            "line-color":
              showBySpeed || showBySeparation
                ? "#6b7280"
                : ["get", "route_color"],
            "line-width": 4,
            "line-opacity": 0.45, // Reduced opacity - faded tunnel appearance like OpenRailwayMap
          },
        },
        firstDataLayer,
      );

      // Speed limit layers (colored by maxspeed)
      if (cityConfig.maxspeed && cityConfig.maxspeed.features?.length > 0) {
        map.current.addSource("speed-limit", {
          type: "geojson",
          data: cityConfig.maxspeed as any,
        });

        map.current.addLayer(
          {
            id: "speed-limit-outline",
            type: "line",
            source: "speed-limit",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: showBySpeed ? "visible" : "none",
            },
            paint: {
              "line-color": "#000",
              "line-width": 7,
              "line-opacity": 1.0, // Fully opaque to completely cover grey routes underneath
            },
          },
          firstDataLayer,
        );

        map.current.addLayer(
          {
            id: "speed-limit",
            type: "line",
            source: "speed-limit",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: showBySpeed ? "visible" : "none",
            },
            paint: {
              "line-color": maxspeedColorExpression,
              "line-width": 4,
              "line-opacity": 1.0, // Fully opaque to completely cover grey routes underneath
            },
          },
          firstDataLayer,
        );

        // Speed limit labels (visible at high zoom)
        map.current.addLayer({
          id: "speed-limit-labels",
          type: "symbol",
          source: "speed-limit",
          layout: {
            "symbol-placement": "line",
            "text-field": ["concat", ["get", "maxspeed_mph"], " mph"],
            "text-size": 11,
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            visibility: showBySpeed ? "visible" : "none",
          },
          minzoom: 14,
          paint: {
            "text-color": "#fff",
            "text-halo-color": "#000",
            "text-halo-width": 1.5,
          },
        });

        // Speed limit hover
        map.current.on("mouseenter", "speed-limit", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "speed-limit", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          if (!crossingPopupPinned.current) popup.current?.remove();
        });

        map.current.on("mousemove", "speed-limit", (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          const speedMph = props.maxspeed_mph;
          // Color matches the extended speed legend
          const speedColor =
            speedMph == null
              ? "#666666"
              : speedMph >= 50
                ? "#22ccff"
                : speedMph >= 35
                  ? "#33eebb"
                  : speedMph >= 25
                    ? "#88ff33"
                    : speedMph >= 15
                      ? "#ffdd33"
                      : speedMph >= 10
                        ? "#ff9933"
                        : "#ff3333";
          const displaySpeed =
            speedMph != null ? formatSpeedFromRef(speedMph) : "Unknown";
          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title" style="color: ${speedColor}">Speed Limit: ${displaySpeed}</div>
                ${
                  props.name
                    ? `<div class="popup-detail">${props.name}</div>`
                    : ""
                }
              </div>`,
            )
            .addTo(map.current);
        });
      }

      // Separation layers (colored by separation type)
      // Filter separation data to only show segments near selected routes
      // For Philadelphia streetcar routes, this also adds street-running fallback
      const filteredSeparation = filterSeparationByRoutes(
        cityConfig.separation,
        filteredRoutes,
        city,
      );
      console.log(
        `Separation filter result: ${filteredSeparation.features?.length || 0} features for ${city}`,
        selectedLines,
      );
      console.log(
        `showBySeparation=${showBySeparation}, routeLineMode=${routeLineMode}`,
      );

      // Debug: log separation types breakdown
      if (filteredSeparation.features?.length > 0) {
        const typeCounts: Record<string, number> = {};
        for (const f of filteredSeparation.features) {
          const t = f.properties?.separationType || "unknown";
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
        console.log(`Separation types breakdown:`, typeCounts);

        // Check for L-Taraval specifically
        const lTaraval = filteredSeparation.features.find(
          (f: any) => f.properties?.id === "manual-l-taraval-mixed-traffic",
        );
        if (lTaraval) {
          console.log(
            `L-Taraval mixed traffic feature INCLUDED:`,
            lTaraval.properties,
          );
        } else {
          console.log(
            `L-Taraval mixed traffic feature NOT in filtered results`,
          );
        }
      }

      if (filteredSeparation.features?.length > 0) {
        console.log(
          `Adding separation source with ${filteredSeparation.features.length} features`,
        );
        map.current.addSource("separation", {
          type: "geojson",
          data: filteredSeparation as any,
        });

        // Color expression for separation types
        const separationColorExpression: any = [
          "match",
          ["get", "separationType"],
          "tunnel",
          "#3b82f6", // Blue
          "elevated",
          "#22c55e", // Green
          "street_running",
          "#ef4444", // Red
          "mixed_traffic",
          "#ef4444", // Red (same as street_running)
          "reserved_lane",
          "#f97316", // Orange
          "separated_at_grade",
          "#eab308", // Yellow
          "#6b7280", // Grey fallback for unknown
        ];

        map.current.addLayer(
          {
            id: "separation-outline",
            type: "line",
            source: "separation",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: showBySeparation ? "visible" : "none",
            },
            paint: {
              "line-color": "#000",
              "line-width": 8, // Slightly wider to fully cover routes underneath
              "line-opacity": 1.0,
            },
          },
          firstDataLayer,
        );

        map.current.addLayer(
          {
            id: "separation",
            type: "line",
            source: "separation",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: showBySeparation ? "visible" : "none",
            },
            paint: {
              "line-color": separationColorExpression,
              "line-width": 5, // Slightly wider to fully cover routes underneath
              "line-opacity": 1.0,
            },
          },
          firstDataLayer,
        );

        // Separation hover
        map.current.on("mouseenter", "separation", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "separation", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          if (!crossingPopupPinned.current) popup.current?.remove();
        });

        map.current.on("mousemove", "separation", (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          const sepType = props.separationType;

          // Get color and label for separation type
          const sepInfo: Record<
            string,
            { color: string; label: string; icon: string }
          > = {
            tunnel: { color: "#3b82f6", label: "Tunnel / Trench", icon: "🔵" },
            elevated: { color: "#22c55e", label: "Elevated", icon: "🟢" },
            street_running: {
              color: "#ef4444",
              label: "Street Running",
              icon: "🔴",
            },
            mixed_traffic: {
              color: "#ef4444",
              label: "Mixed Traffic",
              icon: "🔴",
            },
            reserved_lane: {
              color: "#f97316",
              label: "Reserved Lane",
              icon: "🟠",
            },
            separated_at_grade: {
              color: "#eab308",
              label: "Separated At-Grade",
              icon: "🟡",
            },
            unknown: { color: "#6b7280", label: "Unknown", icon: "⬜" },
          };

          const info = sepInfo[sepType] || sepInfo.unknown;

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title" style="color: ${info.color}">${info.icon} ${info.label}</div>
                ${props.name ? `<div class="popup-detail">${props.name}</div>` : ""}
              </div>`,
            )
            .addTo(map.current);
        });
      }

      // Route hover
      map.current.on("mouseenter", "routes", () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = "pointer";
        }
      });

      map.current.on("mouseleave", "routes", () => {
        if (map.current) map.current.getCanvas().style.cursor = "";
        if (!crossingPopupPinned.current) popup.current?.remove();
      });

      map.current.on("mousemove", "routes", (e) => {
        if (!e.features?.length || !map.current) return;

        // In speed limit or separation mode, don't show popup for grey areas (no data)
        // The speed-limit/separation layers handle popups for areas with data
        if (showBySpeed || showBySeparation) return;

        // In byLine mode, show route name
        const props = e.features[0].properties;
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title" style="color: ${props.route_color}">${props.route_name}</div>
            </div>`,
          )
          .addTo(map.current);
      });
    };

    // If style is already loaded, add layers immediately
    // Otherwise, wait for it with a small delay
    if (map.current.isStyleLoaded()) {
      addRouteLayers();
    } else {
      // Use a small timeout to wait for style to initialize
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addRouteLayers();
        } else {
          setTimeout(waitForStyle, 50);
        }
      };
      setTimeout(waitForStyle, 50);
    }
  }, [
    mapLoaded,
    selectedLines,
    showRouteLines,
    showRailContextHeavy,
    showRailContextCommuter,
    routeLineMode,
    cityConfig.routes,
    cityConfig.maxspeed,
    cityConfig.separation,
    effectiveRailContext,
    maxspeedColorExpression,
    handleRailContextMouseEnter,
    handleRailContextMouseLeave,
    handleRailContextMouseMove,
  ]);

  // Keep rail-context layer visibility in sync with toggle state
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    try {
      if (map.current.getLayer("rail-context-heavy")) {
        map.current.setLayoutProperty(
          "rail-context-heavy",
          "visibility",
          showRailContextHeavy ? "visible" : "none",
        );
      }
      if (map.current.getLayer("rail-context-commuter")) {
        map.current.setLayoutProperty(
          "rail-context-commuter",
          "visibility",
          showRailContextCommuter ? "visible" : "none",
        );
      }
    } catch (e) {
      // Layers might not exist yet
    }
  }, [mapLoaded, showRailContextHeavy, showRailContextCommuter]);

  // Add/update stops layer with clustering by name
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addStopsLayers = () => {
      if (!map.current) return;

      // Filter clustered stops to selected lines
      const filterByLines = (features: any[]) => {
        if (selectedLines.length === 0) return [];
        return features.filter((f: any) => {
          const routes = f.properties?.routes;
          if (!routes || !Array.isArray(routes)) return true;
          return routes.some((r: string) => selectedLines.includes(r));
        });
      };

      // Build the stops to display:
      // - If a cluster is expanded, show individual stops for that cluster + other clustered stops
      // - Otherwise, show all clustered stops
      let displayFeatures: any[] = [];
      const filteredClustered = filterByLines(
        clusteredStops.clustered.features,
      );

      if (
        expandedStopCluster &&
        clusteredStops.individualByCluster[expandedStopCluster]
      ) {
        // Show expanded individual stops for the selected cluster
        const expandedStops = filterByLines(
          clusteredStops.individualByCluster[expandedStopCluster],
        );
        // Mark them as expanded
        const expandedWithFlag = expandedStops.map((f: any) => ({
          ...f,
          properties: { ...f.properties, is_expanded: true },
        }));
        // Show other clusters (not the expanded one)
        const otherClusters = filteredClustered.filter(
          (f: any) => f.properties.cluster_name !== expandedStopCluster,
        );
        displayFeatures = [...otherClusters, ...expandedWithFlag];
      } else {
        displayFeatures = filteredClustered;
      }

      const stopsData = {
        type: "FeatureCollection",
        features: displayFeatures,
      };

      const existingSource = map.current.getSource(
        "stops",
      ) as maplibregl.GeoJSONSource;

      if (existingSource) {
        existingSource.setData(stopsData as any);
        map.current.setLayoutProperty(
          "stops",
          "visibility",
          showStops ? "visible" : "none",
        );
        map.current.setLayoutProperty(
          "stops-label",
          "visibility",
          showStops ? "visible" : "none",
        );
      } else {
        map.current.addSource("stops", {
          type: "geojson",
          data: stopsData as any,
        });

        map.current.addLayer({
          id: "stops",
          type: "symbol",
          source: "stops",
          layout: {
            visibility: showStops ? "visible" : "none",
            "text-field": "◆",
            "text-size": 20,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            // Cluster markers: white, Expanded individual markers: purple
            "text-color": [
              "case",
              ["==", ["get", "is_expanded"], true],
              "#a855f7", // Purple for expanded individual stops
              "#ffffff", // White for clusters and single stops
            ],
            "text-halo-color": "#333333",
            "text-halo-width": 2.5,
          },
        });

        map.current.addLayer({
          id: "stops-label",
          type: "symbol",
          source: "stops",
          layout: {
            visibility: showStops ? "visible" : "none",
            "text-field": ["get", "stop_name"],
            "text-size": 11,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#000000",
            "text-halo-width": 1.5,
          },
          minzoom: 14,
        });

        // Stop hover
        map.current.on("mouseenter", "stops", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "stops", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          if (!crossingPopupPinned.current) popup.current?.remove();
        });

        map.current.on("mousemove", "stops", (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          const routes = JSON.parse(props.routes || "[]");
          const isCluster =
            props.is_cluster === true || props.is_cluster === "true";
          const clusterSize = props.cluster_size || 1;

          const clusterHint =
            isCluster && clusterSize > 1
              ? `<div class="popup-detail" style="color: #a855f7;">Click to show ${clusterSize} platforms</div>`
              : "";

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title">${props.stop_name}</div>
                <div class="popup-detail">Lines: ${routes.join(", ")}</div>
                ${clusterHint}
              </div>`,
            )
            .addTo(map.current);
        });

        // Click to expand/collapse clusters
        map.current.on("click", "stops", (e) => {
          if (!e.features?.length) return;
          const props = e.features[0].properties;
          const clusterName = props.cluster_name;
          const isCluster =
            props.is_cluster === true || props.is_cluster === "true";
          const isExpanded =
            props.is_expanded === true || props.is_expanded === "true";

          if (isCluster && clusterName) {
            // Expand this cluster
            setExpandedStopCluster(clusterName);
          } else if (isExpanded) {
            // Clicking an expanded stop collapses the cluster
            setExpandedStopCluster(null);
          }
        });
      }
    };

    // If style is already loaded, add layers immediately
    // Otherwise, wait for it with a small delay
    if (map.current.isStyleLoaded()) {
      addStopsLayers();
    } else {
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addStopsLayers();
        } else {
          setTimeout(waitForStyle, 50);
        }
      };
      setTimeout(waitForStyle, 50);
    }
  }, [
    mapLoaded,
    showStops,
    selectedLines,
    clusteredStops,
    expandedStopCluster,
  ]);

  // Show all grade crossings regardless of selected lines
  // Note: F-line only crossings are already filtered out during the fetch script
  const filteredCrossings = useMemo(() => {
    // Each crossing has a 'routes' property listing which transit lines it's near
    // For OSM-sourced cities without routes property, filter by proximity to route lines
    const nearbyFeatures = cityConfig.crossings.features.filter(
      (crossing: any) => {
        const nearRoutes: string[] = crossing.properties.routes;
        // If has routes property, use it
        if (nearRoutes) {
          return nearRoutes.length > 0;
        }

        // For OSM-sourced cities, check if crossing is within 50m of any route line
        const [lon, lat] = crossing.geometry.coordinates;
        const maxDistanceMeters = 50;

        for (const feature of cityConfig.routes.features) {
          const coords = feature.geometry.coordinates;
          // Handle both LineString and MultiLineString
          const lineStrings =
            feature.geometry.type === "MultiLineString" ? coords : [coords];

          for (const lineCoords of lineStrings) {
            const distance = distanceToLineString(lat, lon, lineCoords);
            if (distance <= maxDistanceMeters) {
              return true;
            }
          }
        }
        return false;
      },
    );

    return { ...cityConfig.crossings, features: nearbyFeatures };
  }, [cityConfig.crossings, cityConfig.routes]);

  // Add/update crossings layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addCrossingsLayer = () => {
      if (!map.current) return;

      const existingSource = map.current.getSource(
        "crossings",
      ) as maplibregl.GeoJSONSource;

      // Determine crossing color based on city
      // Cities with verified CPUC gate data get green for gated crossings, orange for others
      // All other cities get orange (OSM barrier data unreliable)
      const verifiedGateCities = ["LA", "Charlotte", "San Diego"];
      const crossingColor = verifiedGateCities.includes(city)
        ? [
            "case",
            ["==", ["get", "crossing_barrier"], "yes"],
            "#22c55e", // Green for gated crossings in verified cities
            "#ff9500", // Orange for ungated/unknown
          ]
        : "#ff9500"; // Orange for all other cities

      if (existingSource) {
        // Update data with filtered crossings
        existingSource.setData(filteredCrossings as any);
        map.current.setLayoutProperty(
          "crossings",
          "visibility",
          showCrossings ? "visible" : "none",
        );
        // Update color when city changes
        map.current.setPaintProperty(
          "crossings",
          "text-color",
          crossingColor as any,
        );
      } else {
        map.current.addSource("crossings", {
          type: "geojson",
          data: filteredCrossings as any,
        });

        // Add crossing markers layer
        map.current.addLayer({
          id: "crossings",
          type: "symbol",
          source: "crossings",
          layout: {
            visibility: showCrossings ? "visible" : "none",
            "text-field": "✕",
            "text-size": 14,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": crossingColor as any,
            "text-halo-color": "#000000",
            "text-halo-width": 1.5,
          },
        });

        // Register event handlers only once (they use refs so they work across re-renders)
        if (!crossingHandlersRegistered.current) {
          crossingHandlersRegistered.current = true;

          // Crossing hover popup
          map.current.on("mouseenter", "crossings", () => {
            if (map.current) map.current.getCanvas().style.cursor = "pointer";
          });

          map.current.on("mouseleave", "crossings", () => {
            if (map.current) map.current.getCanvas().style.cursor = "";
            // Only remove popup if not pinned
            if (!crossingPopupPinned.current) {
              popup.current?.remove();
            }
          });

          map.current.on("mousemove", "crossings", (e) => {
            // Don't update popup if it's pinned
            if (crossingPopupPinned.current) return;
            if (!e.features?.length || !map.current) return;

            // Get coordinates from the feature geometry
            const feature = e.features[0];
            const props = feature.properties || {};
            const coords =
              feature.geometry.type === "Point"
                ? (feature.geometry as GeoJSON.Point).coordinates
                : null;
            const lon = coords ? coords[0].toFixed(6) : "N/A";
            const lat = coords ? coords[1].toFixed(6) : "N/A";

            // Build barrier info line
            const barrierStatus =
              props.crossing_barrier === "yes"
                ? "✓ Gated"
                : props.crossing_barrier === "no"
                  ? "✗ No gates"
                  : "";

            popup.current
              ?.setLngLat(e.lngLat)
              .setHTML(
                `<div class="popup-content">
                  <div class="popup-title">Grade Crossing${barrierStatus ? ` <span style="color: ${props.crossing_barrier === "yes" ? "#22c55e" : "#ff9500"}">${barrierStatus}</span>` : ""}</div>
                  <div class="popup-coords">${lat}, ${lon}</div>
                </div>`,
              )
              .addTo(map.current);
          });

          // Click to pin the popup
          map.current.on("click", "crossings", (e) => {
            if (!e.features?.length || !map.current) return;

            // Get coordinates from the feature geometry
            const feature = e.features[0];
            const props = feature.properties || {};
            const coords =
              feature.geometry.type === "Point"
                ? (feature.geometry as GeoJSON.Point).coordinates
                : null;
            const lon = coords ? coords[0].toFixed(6) : "N/A";
            const lat = coords ? coords[1].toFixed(6) : "N/A";

            // Build barrier info line
            const barrierStatus =
              props.crossing_barrier === "yes"
                ? "✓ Gated"
                : props.crossing_barrier === "no"
                  ? "✗ No gates"
                  : "";

            crossingPopupPinned.current = true;

            popup.current
              ?.setLngLat(e.lngLat)
              .setHTML(
                `<div class="popup-content popup-pinned">
                  <div class="popup-title">Grade Crossing${barrierStatus ? ` <span style="color: ${props.crossing_barrier === "yes" ? "#22c55e" : "#ff9500"}">${barrierStatus}</span>` : ""} 📌</div>
                  <div class="popup-coords">${lat}, ${lon}</div>
                  <div class="popup-hint">Click elsewhere to close</div>
                </div>`,
              )
              .addTo(map.current);

            // Prevent the click from propagating to the map
            e.originalEvent.stopPropagation();
          });

          // Click elsewhere on map to unpin crossing popup and collapse stop clusters
          map.current.on("click", (e) => {
            // Check if click was on a crossing (handled above)
            const crossingFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["crossings"],
              },
            );
            if (crossingFeatures && crossingFeatures.length > 0) return;

            // Check if click was on a stop (handled in stops layer)
            const stopFeatures = map.current?.queryRenderedFeatures(e.point, {
              layers: ["stops"],
            });
            if (stopFeatures && stopFeatures.length > 0) return;

            // Unpin and remove popup
            crossingPopupPinned.current = false;
            popup.current?.remove();

            // Collapse any expanded stop cluster
            setExpandedStopCluster(null);
          });
        }
      }
    };

    if (map.current.isStyleLoaded()) {
      addCrossingsLayer();
    } else {
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addCrossingsLayer();
        } else {
          setTimeout(waitForStyle, 50);
        }
      };
      setTimeout(waitForStyle, 50);
    }
  }, [mapLoaded, showCrossings, filteredCrossings, city]);

  // Get switches and signals data for current city, filtered by proximity to routes
  const switchesData = useMemo(() => {
    const rawSwitches = cityConfig.switches || {
      type: "FeatureCollection",
      features: [],
    };

    // Filter switches to only those near route lines
    const filteredFeatures = rawSwitches.features.filter((sw: any) => {
      const [lon, lat] = sw.geometry.coordinates;
      const maxDistanceMeters = 50;

      for (const feature of cityConfig.routes.features) {
        const coords = feature.geometry.coordinates;
        // Handle both LineString and MultiLineString
        const lineStrings =
          feature.geometry.type === "MultiLineString" ? coords : [coords];

        for (const lineCoords of lineStrings) {
          const distance = distanceToLineString(lat, lon, lineCoords);
          if (distance <= maxDistanceMeters) {
            return true;
          }
        }
      }
      return false;
    });

    return { ...rawSwitches, features: filteredFeatures };
  }, [city, cityConfig.routes, cityConfig.switches]);

  // Add/update switches layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addSwitchesLayer = () => {
      if (!map.current) return;

      const existingSource = map.current.getSource(
        "switches",
      ) as maplibregl.GeoJSONSource;

      if (existingSource) {
        existingSource.setData(switchesData as any);
        map.current.setLayoutProperty(
          "switches",
          "visibility",
          showSwitches ? "visible" : "none",
        );
      } else {
        map.current.addSource("switches", {
          type: "geojson",
          data: switchesData as any,
        });

        // Add switch markers - use Y symbol in cyan
        map.current.addLayer({
          id: "switches",
          type: "symbol",
          source: "switches",
          layout: {
            visibility: showSwitches ? "visible" : "none",
            "text-field": "Y",
            "text-size": 14,
            "text-font": ["Open Sans Bold"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#00d4ff",
            "text-halo-color": "#000000",
            "text-halo-width": 2,
          },
        });

        // Switch hover popup
        map.current.on("mouseenter", "switches", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "switches", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          if (!crossingPopupPinned.current) popup.current?.remove();
        });

        map.current.on("mousemove", "switches", (e) => {
          if (!e.features?.length || !map.current) return;

          const feature = e.features[0];
          const coords =
            feature.geometry.type === "Point"
              ? (feature.geometry as GeoJSON.Point).coordinates
              : null;
          const lon = coords ? coords[0].toFixed(6) : "N/A";
          const lat = coords ? coords[1].toFixed(6) : "N/A";

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title">⚡ Track Switch</div>
                <div class="popup-coords">${lat}, ${lon}</div>
              </div>`,
            )
            .addTo(map.current);
        });
      }
    };

    if (map.current.isStyleLoaded()) {
      addSwitchesLayer();
    } else {
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addSwitchesLayer();
        } else {
          setTimeout(waitForStyle, 50);
        }
      };
      setTimeout(waitForStyle, 50);
    }
  }, [mapLoaded, showSwitches, switchesData]);

  // Update vehicle data source
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addVehicleLayers = () => {
      if (!map.current) return;

      // In live mode, show only latest positions; in raw mode, show all
      const sourceVehicles = viewMode === "live" ? liveVehicles : vehicles;
      const filteredVehicles = sourceVehicles.filter(
        (v) =>
          shouldShowRoute(v.routeId, selectedLines, city) &&
          isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city),
      );
      const vehicleGeoJSON = {
        type: "FeatureCollection" as const,
        features: filteredVehicles.map((v) => ({
          type: "Feature" as const,
          properties: {
            id: v.id,
            routeId: v.routeId,
            direction: v.direction ?? null,
            speed: v.speed ?? null,
            recordedAt: v.recordedAt,
            city: city, // Include city for popup display logic
            headsign: v.headsign ?? null,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [v.lon, v.lat],
          },
        })),
      };

      const existingSource = map.current.getSource(
        "vehicles",
      ) as maplibregl.GeoJSONSource;

      if (existingSource) {
        existingSource.setData(vehicleGeoJSON);
      } else {
        map.current.addSource("vehicles", {
          type: "geojson",
          data: vehicleGeoJSON,
        });

        // Filter to hide null speed data points and optionally stopped trains
        const initialFilters: maplibregl.ExpressionSpecification[] = [];

        // For San Diego, allow null speed data since MTS doesn't provide speed in GTFS-RT
        if (city !== "San Diego") {
          initialFilters.push(["!=", ["get", "speed"], null]);
        }

        // Only apply speed filters to vehicles that have speed data
        if (city === "San Diego") {
          // For San Diego: only filter vehicles that have speed data
          initialFilters.push([
            "any",
            ["==", ["get", "speed"], null], // Allow null speed
            [">=", ["get", "speed"], speedFilter.minSpeed], // Or speed >= min
          ]);
        } else {
          // For other cities: normal speed filtering
          initialFilters.push([">=", ["get", "speed"], speedFilter.minSpeed]);
        }
        // Only add max filter if not at 50 (50 means 50+ / no upper limit)
        if (speedFilter.maxSpeed < 50) {
          initialFilters.push(["<=", ["get", "speed"], speedFilter.maxSpeed]);
        }
        // Use 0.5 threshold so speeds that round to 0 (like 0.3 mph) are also hidden
        if (hideStoppedTrains) {
          initialFilters.push([">=", ["get", "speed"], 0.5]);
        }
        const initialFilter: maplibregl.FilterSpecification = [
          "all",
          ...initialFilters,
        ];

        map.current.addLayer({
          id: "vehicles-glow",
          type: "circle",
          source: "vehicles",
          filter: initialFilter,
          layout: {
            visibility:
              viewMode === "raw" || viewMode === "live" ? "visible" : "none",
          },
          paint: {
            "circle-radius": 6,
            "circle-color": speedColorExpression,
            "circle-opacity": 0.3,
            "circle-blur": 0.5,
          },
        });

        map.current.addLayer({
          id: "vehicles",
          type: "circle",
          source: "vehicles",
          filter: initialFilter,
          layout: {
            visibility:
              viewMode === "raw" || viewMode === "live" ? "visible" : "none",
          },
          paint: {
            "circle-radius": 4,
            "circle-color": speedColorExpression,
          },
        });

        // Vehicle hover
        map.current.on("mouseenter", "vehicles", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "vehicles", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          if (!crossingPopupPinned.current) popup.current?.remove();
        });

        map.current.on("mousemove", "vehicles", (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          const speed =
            props.speed != null
              ? formatSpeedFromRef(props.speed)
              : "Speed unknown";
          const dateTime = new Date(props.recordedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });

          // Build popup title based on city
          let titleLine = `${props.routeId} Train`;
          let detailLine = `Vehicle #${props.id}`;

          if (props.city === "Portland" && props.headsign) {
            // Portland: Use headsign directly (e.g., "Yellow Line to City Ctr/Milw")
            titleLine = props.headsign;
            detailLine = `Vehicle #${props.id.split("-")[0]}`;
          } else if (props.city === "SF") {
            // SF: Prefer API headsign if available (e.g., "Fisherman's Wharf")
            // Fall back to hardcoded terminus mapping for older data
            if (props.headsign) {
              titleLine = `${props.routeId} Line to ${props.headsign}`;
            } else {
              const terminus = SF_TERMINUS[props.routeId];
              const dir =
                props.direction === "Inbound"
                  ? terminus?.inbound
                  : terminus?.outbound;
              titleLine = `${props.routeId} Line ${dir || ""}`.trim();
            }
          } else if (props.city === "LA") {
            // LA: Show line letter + terminus based on direction
            // LA GTFS uses: direction 0 = NB/EB (toward downtown), direction 1 = SB/WB (away)
            // But getDirection() maps 0 → "Outbound", 1 → "Inbound", so we swap the lookup
            const lineInfo = LA_METRO_LINE_INFO[props.routeId as LAMetroLine];
            const lineLetter = lineInfo?.letter || props.routeId;
            const terminus = LA_TERMINUS[props.routeId];
            const dir =
              props.direction === "Outbound"
                ? terminus?.inbound
                : terminus?.outbound;
            titleLine = dir
              ? `${lineLetter} Line ${dir}`
              : `${lineLetter} Line`;
          } else if (props.city === "Boston") {
            // Boston: Show branch name (e.g., "B Branch" instead of "Green-B")
            const branchName =
              BOSTON_BRANCH_NAMES[props.routeId] || props.routeId;
            titleLine = `Green Line ${branchName}`;
          }

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title">${titleLine}</div>
                <div class="popup-detail">${detailLine}</div>
                <div class="popup-speed">${speed}</div>
                <div class="popup-time">${dateTime}</div>
              </div>`,
            )
            .addTo(map.current);
        });
      }
    };

    // Function to wait for map to finish rendering
    const waitForIdle = () => {
      if (!map.current) return;

      // Listen for the idle event (fires when map finishes rendering)
      const handleIdle = () => {
        console.log("Map idle - clearing loading indicator");
        setLoadingProgress("");
        setIsProcessing(false);
      };

      // Use once so it only fires once
      map.current.once("idle", handleIdle);

      // Fallback timeout in case idle doesn't fire
      setTimeout(() => {
        if (isProcessing) {
          console.log("Loading fallback timeout - clearing indicator");
          setLoadingProgress("");
          setIsProcessing(false);
        }
      }, 10000);
    };

    // If style is already loaded, add layers immediately
    // Otherwise, wait for it with a small delay
    if (map.current.isStyleLoaded()) {
      addVehicleLayers();
      waitForIdle();
    } else {
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addVehicleLayers();
          waitForIdle();
        } else {
          setTimeout(waitForStyle, 50);
        }
      };
      setTimeout(waitForStyle, 50);
    }
  }, [
    vehicles,
    liveVehicles,
    viewMode,
    mapLoaded,
    selectedLines,
    routeGeometryMap,
    city,
    isProcessing,
  ]);

  // Update speed filter
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getLayer("vehicles")) return;

    const filters: maplibregl.ExpressionSpecification[] = [];

    // For San Diego, allow null speed data since MTS doesn't provide speed in GTFS-RT
    if (city !== "San Diego") {
      filters.push(["!=", ["get", "speed"], null]);
    }

    // Only apply speed filters to vehicles that have speed data
    if (city === "San Diego") {
      // For San Diego: only filter vehicles that have speed data
      filters.push([
        "any",
        ["==", ["get", "speed"], null], // Allow null speed
        [">=", ["get", "speed"], speedFilter.minSpeed], // Or speed >= min
      ]);
    } else {
      // For other cities: normal speed filtering
      filters.push([">=", ["get", "speed"], speedFilter.minSpeed]);
    }
    // Only add max filter if not at 50 (50 means 50+ / no upper limit)
    if (speedFilter.maxSpeed < 50) {
      filters.push(["<=", ["get", "speed"], speedFilter.maxSpeed]);
    }

    // Hide stopped trains (0 mph) if toggle is enabled
    // Use 0.5 threshold so speeds that round to 0 (like 0.3 mph) are also hidden
    if (hideStoppedTrains) {
      filters.push([">=", ["get", "speed"], 0.5]);
    }

    const filterExpression: maplibregl.FilterSpecification = [
      "all",
      ...filters,
    ];

    map.current.setFilter("vehicles", filterExpression);
    map.current.setFilter("vehicles-glow", filterExpression);
  }, [speedFilter, hideStoppedTrains, mapLoaded]);

  // Ensure proper layer ordering: routes at bottom, then data, then infrastructure on top
  // This function can be called anytime to fix layer order
  const reorderLayers = useCallback(() => {
    if (!map.current) return;

    // Order from bottom to top:
    // 1. Route lines at the very bottom (solid for regular, dashed for tunnels)
    // 2. Vehicle data (raw data / segment avg) above routes
    // 3. Infrastructure overlays (crossings, switches) on top of data
    // 4. Stops/labels at the very top for readability
    const layerOrder = [
      "rail-context-heavy",
      "rail-context-commuter",
      "routes-outline",
      "routes",
      "routes-tunnel-outline",
      "routes-tunnel",
      "speed-limit-outline",
      "speed-limit",
      "speed-limit-labels",
      "separation-outline",
      "separation",
      "speed-segments",
      "vehicles-glow",
      "vehicles",
      "crossings",
      "switches",
      "stops",
      "stops-label",
    ];

    // Get existing layers in our order
    const existingLayers = layerOrder.filter((id) => map.current?.getLayer(id));

    if (existingLayers.length < 2) return;

    // Move each layer to top in order, establishing correct z-order
    for (let i = 0; i < existingLayers.length; i++) {
      const currentLayer = existingLayers[i];
      try {
        // moveLayer with no second argument moves to top
        // Processing in order ensures correct stacking
        map.current.moveLayer(currentLayer);
      } catch (e) {
        // Layer might not exist, ignore
      }
    }
  }, []);

  // Reorder layers whenever toggles change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Run immediately and once after a short delay for late-loading layers
    reorderLayers();
    const timeoutId = setTimeout(reorderLayers, 100);

    return () => clearTimeout(timeoutId);
  }, [
    mapLoaded,
    vehicles,
    showStops,
    showCrossings,
    showSwitches,
    showRouteLines,
    showRailContextHeavy,
    showRailContextCommuter,
    viewMode,
    selectedLines,
    city,
    reorderLayers,
  ]);

  // Reorder when source data changes (catches async layer additions)
  // Uses proper debounce to prevent excessive calls
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const debouncedReorder = debounce(reorderLayers, 50);

    map.current.on("sourcedata", debouncedReorder);

    return () => {
      map.current?.off("sourcedata", debouncedReorder);
      debouncedReorder.cancel();
    };
  }, [mapLoaded, reorderLayers]);

  // Handle view mode toggle
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const showVehicles = viewMode === "raw" || viewMode === "live";

    if (map.current.getLayer("vehicles")) {
      map.current.setLayoutProperty(
        "vehicles",
        "visibility",
        showVehicles ? "visible" : "none",
      );
    }
    if (map.current.getLayer("vehicles-glow")) {
      map.current.setLayoutProperty(
        "vehicles-glow",
        "visibility",
        showVehicles ? "visible" : "none",
      );
    }

    // In live mode, update the source with only live vehicles
    if (viewMode === "live") {
      const filteredLiveVehicles = liveVehicles.filter(
        (v) =>
          shouldShowRoute(v.routeId, selectedLines, city) &&
          isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city),
      );

      const liveGeoJSON = {
        type: "FeatureCollection" as const,
        features: filteredLiveVehicles.map((v) => ({
          type: "Feature" as const,
          properties: {
            id: v.id,
            routeId: v.routeId,
            direction: v.direction ?? null,
            speed: v.speed ?? null,
            recordedAt: v.recordedAt,
            city: city,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [v.lon, v.lat],
          },
        })),
      };

      const source = map.current.getSource(
        "vehicles",
      ) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(liveGeoJSON);
      }

      // Hide segments in live mode
      if (map.current.getLayer("speed-segments")) {
        map.current.setLayoutProperty("speed-segments", "visibility", "none");
      }
    } else if (viewMode === "raw") {
      // Restore full vehicle data when switching back to raw mode
      const filteredVehicles = vehicles.filter(
        (v) =>
          shouldShowRoute(v.routeId, selectedLines, city) &&
          isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city),
      );

      const vehicleGeoJSON = {
        type: "FeatureCollection" as const,
        features: filteredVehicles.map((v) => ({
          type: "Feature" as const,
          properties: {
            id: v.id,
            routeId: v.routeId,
            direction: v.direction ?? null,
            speed: v.speed ?? null,
            recordedAt: v.recordedAt,
            city: city,
            headsign: v.headsign ?? null,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [v.lon, v.lat],
          },
        })),
      };

      const source = map.current.getSource(
        "vehicles",
      ) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(vehicleGeoJSON);
      }

      // Hide segments in raw mode
      if (map.current.getLayer("speed-segments")) {
        map.current.setLayoutProperty("speed-segments", "visibility", "none");
      }
    }

    if (viewMode === "segments") {
      // Show segments layer (data is handled by separate effect)
      if (map.current.getLayer("speed-segments")) {
        map.current.setLayoutProperty(
          "speed-segments",
          "visibility",
          "visible",
        );
      }
    } else {
      if (map.current.getLayer("speed-segments")) {
        map.current.setLayoutProperty("speed-segments", "visibility", "none");
      }
    }
  }, [
    viewMode,
    vehicles,
    liveVehicles,
    mapLoaded,
    selectedLines,
    allRouteSegments,
    routeGeometryMap,
    city,
  ]);

  // Separate effect for segment calculations (runs when entering segment mode or when filters change)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (viewMode !== "segments") return;

    // Recalculate segment averages with current speed filter
    const segmentSpeeds: Map<string, number[]> = new Map();

    vehicles.forEach((v) => {
      if (v.speed == null) return;
      if (!shouldShowRoute(v.routeId, selectedLines, city)) return;
      // Skip if below min speed, or above max speed (unless max is 50, which means 50+)
      if (v.speed < speedFilter.minSpeed) return;
      if (speedFilter.maxSpeed < 50 && v.speed > speedFilter.maxSpeed) return;
      if (!v.segmentId) return;

      if (!segmentSpeeds.has(v.segmentId)) {
        segmentSpeeds.set(v.segmentId, []);
      }
      segmentSpeeds.get(v.segmentId)!.push(v.speed);
    });

    const segmentAverages: Map<string, { avg: number; count: number }> =
      new Map();
    segmentSpeeds.forEach((speeds, segmentId) => {
      const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      segmentAverages.set(segmentId, { avg, count: speeds.length });
    });

    const segmentFeatures = allRouteSegments
      .filter((seg) => shouldShowRoute(seg.routeId, selectedLines, city))
      .filter((seg) => segmentAverages.has(seg.segmentId))
      .map((seg) => {
        const data = segmentAverages.get(seg.segmentId)!;
        return {
          type: "Feature" as const,
          properties: {
            segmentId: seg.segmentId,
            routeId: seg.routeId,
            avgSpeed: data.avg,
            sampleCount: data.count,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: seg.coordinates,
          },
        };
      });

    const segmentGeoJSON = {
      type: "FeatureCollection" as const,
      features: segmentFeatures,
    };

    const existingSource = map.current.getSource(
      "speed-segments",
    ) as maplibregl.GeoJSONSource;

    if (existingSource) {
      existingSource.setData(segmentGeoJSON);
      map.current.setLayoutProperty("speed-segments", "visibility", "visible");
    } else {
      map.current.addSource("speed-segments", {
        type: "geojson",
        data: segmentGeoJSON,
      });

      // Find the first layer that should be above segments (stops or vehicles)
      const aboveLayer = map.current.getLayer("stops")
        ? "stops"
        : map.current.getLayer("vehicles-glow")
          ? "vehicles-glow"
          : undefined;

      map.current.addLayer(
        {
          id: "speed-segments",
          type: "line",
          source: "speed-segments",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-width": 6,
            "line-color": [
              "case",
              ["==", ["get", "avgSpeed"], null],
              "#666666", // grey - no data
              ["<=", ["get", "avgSpeed"], 5],
              "#9b2d6b", // magenta - crawling (≤5 mph)
              ["<", ["get", "avgSpeed"], 10],
              "#ff3333", // red - very slow (5-10 mph)
              ["<", ["get", "avgSpeed"], 15],
              "#ff9933", // orange - slow (10-15 mph)
              ["<", ["get", "avgSpeed"], 25],
              "#ffdd33", // yellow - moderate (15-25 mph)
              ["<", ["get", "avgSpeed"], 35],
              "#88ff33", // light green - good (25-35 mph)
              ["<", ["get", "avgSpeed"], 50],
              "#33eebb", // teal - fast (35-50 mph)
              "#22ccff", // cyan - very fast (50+ mph)
            ],
            "line-opacity": 0.9,
          },
        },
        aboveLayer,
      );

      map.current.on("mouseenter", "speed-segments", () => {
        if (map.current) map.current.getCanvas().style.cursor = "pointer";
      });

      map.current.on("mouseleave", "speed-segments", () => {
        if (map.current) map.current.getCanvas().style.cursor = "";
        if (!crossingPopupPinned.current) popup.current?.remove();
      });

      map.current.on("mousemove", "speed-segments", (e) => {
        if (!e.features?.length || !map.current) return;
        const props = e.features[0].properties;

        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title">${props.routeId} Segment</div>
              <div class="popup-speed">${formatAvgSpeedFromRef(props.avgSpeed)} avg</div>
              <div class="popup-detail">${props.sampleCount} readings</div>
            </div>`,
          )
          .addTo(map.current);
      });
    }
  }, [
    speedFilter,
    viewMode,
    mapLoaded,
    vehicles,
    selectedLines,
    allRouteSegments,
  ]);

  // Toggle satellite/dark base map
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    try {
      map.current.setLayoutProperty(
        "carto-dark-layer",
        "visibility",
        showSatellite ? "none" : "visible",
      );
      map.current.setLayoutProperty(
        "satellite-layer",
        "visibility",
        showSatellite ? "visible" : "none",
      );
    } catch (e) {
      // Layers may not exist yet
    }
  }, [mapLoaded, showSatellite]);

  // Update speed limit labels when speed unit changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    try {
      if (map.current.getLayer("speed-limit-labels")) {
        const unitSuffix = speedUnit === "kmh" ? " km/h" : " mph";
        const conversionFactor = speedUnit === "kmh" ? 1.60934 : 1;

        // MapLibre expression to convert and display speed
        map.current.setLayoutProperty("speed-limit-labels", "text-field", [
          "concat",
          [
            "to-string",
            ["round", ["*", ["get", "maxspeed_mph"], conversionFactor]],
          ],
          unitSuffix,
        ]);
      }
    } catch (e) {
      // Layer may not exist
    }
  }, [mapLoaded, speedUnit]);

  // Toggle satellite view from the map layer button
  const toggleSatellite = () => {
    if (onSatelliteToggle) {
      onSatelliteToggle(!showSatellite);
    }
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />

      {/* Crossing gate legend - only for cities with verified gate data */}
      {showCrossings &&
        ["LA", "San Diego", "Salt Lake City", "Charlotte"].includes(city) && (
          <div className="crossing-gate-legend">
            <div className="crossing-legend-item">
              <span className="crossing-x gated">✕</span>
              <span>Gated</span>
            </div>
            <div className="crossing-legend-item">
              <span className="crossing-x other">✕</span>
              <span>Other</span>
            </div>
          </div>
        )}

      {/* Google Maps-style layer toggle button */}
      <div
        className="map-layer-toggle"
        onClick={toggleSatellite}
        title={showSatellite ? "Switch to dark map" : "Switch to satellite"}
      >
        <div
          className="layer-preview"
          style={{
            backgroundImage: showSatellite
              ? "url('https://a.basemaps.cartocdn.com/dark_all/12/656/1582@2x.png')"
              : "url('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1582/656')",
          }}
        />
      </div>

      {/* Regional & Metro Overlay legend */}
      {(showRailContextHeavy || showRailContextCommuter) && (
        <div className="rail-context-legend">
          <div className="rail-context-legend-title">
            Regional & Metro Overlay
          </div>
          <div
            className={`rail-context-legend-item ${
              showRailContextHeavy ? "" : "disabled"
            }`}
          >
            <span className="rail-context-legend-line heavy"></span>
            <span>Heavy rail / metro</span>
          </div>
          <div
            className={`rail-context-legend-item ${
              showRailContextCommuter ? "" : "disabled"
            }`}
          >
            <span className="rail-context-legend-line commuter"></span>
            <span>Regional / commuter</span>
          </div>
        </div>
      )}

      {/* City data loading overlay */}
      {cityDataLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading {city}...</div>
        </div>
      )}

      {/* Data processing overlay - shown during fetch and heavy computation */}
      {!cityDataLoading && (loadingProgress || isProcessing) && (
        <div className="loading-overlay processing">
          <div className="loading-spinner" />
          <div className="loading-text">
            {loadingProgress || "Finishing up..."}
          </div>
        </div>
      )}

      {dataSource === "none" && !cityDataLoading && !isProcessing && (
        <div className="data-status">
          No data yet. Run{" "}
          <code>
            npm run collect:
            {city === "LA"
              ? "la"
              : city === "Seattle"
                ? "seattle"
                : city === "Boston"
                  ? "boston"
                  : city === "Portland"
                    ? "portland"
                    : city === "San Diego"
                      ? "sandiego"
                      : "sf"}
          </code>{" "}
          to start collecting.
        </div>
      )}
    </div>
  );
}
