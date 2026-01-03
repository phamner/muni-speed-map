import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City, LAMetroLine } from "../types";
import { getLinesForCity, CITIES, LA_METRO_LINE_INFO } from "../types";
import { supabase } from "../lib/supabase";
import muniRoutes from "../data/muniMetroRoutes.json";
import muniStops from "../data/muniMetroStops.json";
import sfCrossings from "../data/sfGradeCrossings.json";
import sfSwitches from "../data/sfSwitches.json";
import laMetroRoutes from "../data/laMetroRoutes.json";
import laMetroStops from "../data/laMetroStops.json";
import laCrossings from "../data/laGradeCrossings.json";
import laSwitches from "../data/laSwitches.json";
import seattleLinkRoutes from "../data/seattleLinkRoutes.json";
import seattleLinkStops from "../data/seattleLinkStops.json";
import seattleCrossings from "../data/seattleGradeCrossings.json";
import seattleSwitches from "../data/seattleSwitches.json";
import bostonGreenLineRoutes from "../data/bostonGreenLineRoutes.json";
import bostonGreenLineStops from "../data/bostonGreenLineStops.json";
import bostonCrossings from "../data/bostonGradeCrossings.json";
import bostonSwitches from "../data/bostonSwitches.json";
import portlandMaxRoutes from "../data/portlandMaxRoutes.json";
import portlandMaxStops from "../data/portlandMaxStops.json";
import portlandCrossings from "../data/portlandGradeCrossings.json";
import portlandSwitches from "../data/portlandSwitches.json";
import sanDiegoTrolleyRoutes from "../data/sanDiegoTrolleyRoutes.json";
import sanDiegoTrolleyStops from "../data/sanDiegoTrolleyStops.json";
import sanDiegoCrossings from "../data/sanDiegoGradeCrossings.json";
import sanDiegoSwitches from "../data/sanDiegoSwitches.json";
import torontoStreetcarRoutes from "../data/torontoStreetcarRoutes.json";
import torontoStreetcarStops from "../data/torontoStreetcarStops.json";
import torontoCrossings from "../data/torontoGradeCrossings.json";
import torontoSwitches from "../data/torontoSwitches.json";
import phillyTrolleyRoutes from "../data/phillyTrolleyRoutes.json";
import phillyTrolleyStops from "../data/phillyTrolleyStops.json";
import phillyCrossings from "../data/phillyGradeCrossings.json";
import phillySwitches from "../data/phillySwitches.json";
import sacramentoLightRailRoutes from "../data/sacramentoLightRailRoutes.json";
import sacramentoLightRailStops from "../data/sacramentoLightRailStops.json";
import sacramentoCrossings from "../data/sacramentoGradeCrossings.json";
import sacramentoSwitches from "../data/sacramentoSwitches.json";
import type { SpeedFilter, ViewMode, LineStats } from "../App";

// Maximum distance in meters from route line to be considered "on route"
const MAX_DISTANCE_FROM_ROUTE_METERS = 100;

// City-specific configurations
const CITY_CONFIG = {
  SF: {
    center: [-122.433, 37.767] as [number, number],
    zoom: 12.5,
    routes: muniRoutes,
    stops: muniStops,
    crossings: sfCrossings,
    switches: sfSwitches,
  },
  LA: {
    center: [-118.25, 34.05] as [number, number],
    zoom: 10.5,
    routes: laMetroRoutes,
    stops: laMetroStops,
    crossings: laCrossings,
    switches: laSwitches,
  },
  Seattle: {
    center: [-122.33, 47.6] as [number, number],
    zoom: 10.5,
    routes: seattleLinkRoutes,
    stops: seattleLinkStops,
    crossings: seattleCrossings,
    switches: seattleSwitches,
  },
  Boston: {
    center: [-71.08, 42.35] as [number, number],
    zoom: 12,
    routes: bostonGreenLineRoutes,
    stops: bostonGreenLineStops,
    crossings: bostonCrossings,
    switches: bostonSwitches,
  },
  Portland: {
    center: [-122.68, 45.52] as [number, number],
    zoom: 11.5,
    routes: portlandMaxRoutes,
    stops: portlandMaxStops,
    crossings: portlandCrossings,
    switches: portlandSwitches,
  },
  "San Diego": {
    center: [-117.15, 32.72] as [number, number],
    zoom: 11,
    routes: sanDiegoTrolleyRoutes,
    stops: sanDiegoTrolleyStops,
    crossings: sanDiegoCrossings,
    switches: sanDiegoSwitches,
  },
  Toronto: {
    center: [-79.38, 43.65] as [number, number],
    zoom: 12,
    routes: torontoStreetcarRoutes,
    stops: torontoStreetcarStops,
    crossings: torontoCrossings,
    switches: torontoSwitches,
  },
  Philadelphia: {
    center: [-75.16, 39.95] as [number, number],
    zoom: 12,
    routes: phillyTrolleyRoutes,
    stops: phillyTrolleyStops,
    crossings: phillyCrossings,
    switches: phillySwitches,
  },
  Sacramento: {
    center: [-121.49, 38.58] as [number, number],
    zoom: 11.5,
    routes: sacramentoLightRailRoutes,
    stops: sacramentoLightRailStops,
    crossings: sacramentoCrossings,
    switches: sacramentoSwitches,
  },
};

// Haversine distance between two points in meters
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
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
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return haversineDistance(py, px, y1, x1);
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))
  );

  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;

  return haversineDistance(py, px, nearestY, nearestX);
}

// Calculate minimum distance from a point to a LineString
function distanceToLineString(
  lat: number,
  lon: number,
  coordinates: number[][]
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

// Build route geometry map for a given city's routes
function buildRouteGeometryMap(routes: any): Map<string, number[][][]> {
  const routeMap = new Map<string, number[][][]>();

  routes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const coordinates = feature.geometry.coordinates;

    if (!routeMap.has(routeId)) {
      routeMap.set(routeId, []);
    }
    routeMap.get(routeId)!.push(coordinates);
  });

  return routeMap;
}

// Check if a point is within threshold distance of its route
function isOnRoute(
  lat: number,
  lon: number,
  routeId: string,
  routeGeometryMap: Map<string, number[][][]>,
  city?: string
): boolean {
  // Skip route check for Sacramento - GTFS geometry doesn't match actual train positions
  if (city === "Sacramento") {
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
  city: string
): boolean {
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
const SEGMENT_SIZE_METERS = 100;

// Calculate distance along a LineString to the nearest point
function findNearestPointOnLine(
  lat: number,
  lon: number,
  coordinates: number[][]
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
                ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)
              )
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
  direction: string
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
  const seenRoutes = new Set<string>();

  routes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;

    if (seenRoutes.has(routeId)) return;
    seenRoutes.add(routeId);

    const coordinates = feature.geometry.coordinates;
    const segments = createSegments(coordinates, routeId, "combined");

    segments.forEach((seg) => {
      const segmentId = `${routeId}_${seg.segmentId.split("_").pop()}`;
      allSegments.push({
        segmentId,
        routeId,
        coordinates: seg.coords,
        startDistance: seg.startDistance,
        endDistance: seg.endDistance,
      });
    });
  });

  return allSegments;
}

// Find segment for a vehicle
function findSegmentForVehicle(
  lat: number,
  lon: number,
  routeId: string,
  routes: any
): string | null {
  const routeFeatures = routes.features.filter(
    (f: any) => f.properties.route_id === routeId
  );

  let bestSegmentIndex: number | null = null;
  let minDistance = Infinity;

  for (const feature of routeFeatures) {
    const coordinates = (feature as any).geometry.coordinates;
    const result = findNearestPointOnLine(lat, lon, coordinates);

    if (
      result.distance < minDistance &&
      result.distance <= MAX_DISTANCE_FROM_ROUTE_METERS
    ) {
      minDistance = result.distance;
      bestSegmentIndex = Math.floor(result.distanceAlong / SEGMENT_SIZE_METERS);
    }
  }

  if (bestSegmentIndex !== null) {
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

// Background preload function - fetches and caches a city's data without UI updates
async function preloadCityData(targetCity: City): Promise<void> {
  // Skip if already cached or no supabase
  if (cityDataCache.has(targetCity) || !supabase) return;
  
  try {
    // Supabase has a server-side limit of 1000 rows per request
    const PAGE_SIZE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    while (hasMore) {
      // Build query with city filter first, then range LAST
      let query;
      if (targetCity === "SF") {
        query = supabase
          .from("vehicle_positions")
          .select("*")
          .gte("recorded_at", since)
          .or("city.is.null,city.eq.SF")
          .order("recorded_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
      } else {
        query = supabase
          .from("vehicle_positions")
          .select("*")
          .gte("recorded_at", since)
          .eq("city", targetCity)
          .order("recorded_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
      }

      const { data, error } = await query;
      if (error) break;

      if (data && data.length > 0) {
        allData = [...allData, ...data];
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    // Filter to valid lines and transform
    const validLines = getLinesForCity(targetCity);
    const filteredData = allData.filter((row: any) => {
      if (validLines.includes(row.route_id)) return true;
      if (targetCity === "Sacramento" && row.route_id === "Shared") return true;
      return false;
    });

    // Get city config for segment computation
    const cityConfig = CITY_CONFIG[targetCity];
    
    const positions: Vehicle[] = filteredData.map((row: any) => ({
      id: `${row.vehicle_id}-${row.id}`,
      lat: row.lat,
      lon: row.lon,
      routeId: row.route_id,
      direction: getDirection(row.direction_id),
      speed: row.speed_calculated,
      recordedAt: row.recorded_at,
      segmentId: findSegmentForVehicle(row.lat, row.lon, row.route_id, cityConfig.routes),
      headsign: row.headsign,
    }));

    // Store in cache
    cityDataCache.set(targetCity, positions);
    console.log(`Background preloaded ${targetCity}: ${positions.length} positions`);
  } catch (error) {
    console.warn(`Failed to preload ${targetCity}:`, error);
  }
}

// Start background preloading for all cities (staggered)
function startBackgroundPreload(currentCity: City) {
  if (preloadStarted) return;
  preloadStarted = true;
  
  const otherCities = CITIES.filter(c => c !== currentCity);
  
  // Stagger requests by 500ms each to avoid hammering the server
  otherCities.forEach((city, index) => {
    setTimeout(() => {
      preloadCityData(city);
    }, (index + 1) * 500);
  });
}

interface SpeedMapProps {
  city: City;
  selectedLines: string[];
  speedFilter: SpeedFilter;
  showRouteLines: boolean;
  showStops: boolean;
  showCrossings: boolean;
  showSwitches: boolean;
  hideStoppedTrains: boolean;
  viewMode: ViewMode;
  onVehicleUpdate?: (
    count: number,
    time: Date,
    lineStats?: LineStats[],
    dataAgeMinutes?: number
  ) => void;
}

export function SpeedMap({
  city,
  selectedLines,
  speedFilter,
  showRouteLines,
  showStops,
  showCrossings,
  showSwitches,
  hideStoppedTrains,
  viewMode,
  onVehicleUpdate,
}: SpeedMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "supabase" | "none">(
    "loading"
  );
  const [loadingProgress, setLoadingProgress] = useState<string>("");

  // Ref to avoid re-render loops with the callback
  const onVehicleUpdateRef = useRef(onVehicleUpdate);
  onVehicleUpdateRef.current = onVehicleUpdate;

  // Memoize city-specific data
  const cityConfig = useMemo(() => CITY_CONFIG[city], [city]);
  const routeGeometryMap = useMemo(
    () => buildRouteGeometryMap(cityConfig.routes),
    [cityConfig.routes]
  );
  const allRouteSegments = useMemo(
    () => buildAllSegments(cityConfig.routes),
    [cityConfig.routes]
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
      // Supabase has a server-side limit of 1000 rows per request (PGRST_MAX_ROWS)
      // We must use 1000 to properly paginate through all results
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;
      let hasMore = true;

      const since = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      setLoadingProgress("Loading positions...");

      while (hasMore) {
        // Build query with city filter first, then range LAST
        // (range must be applied after all filters to work correctly)
        let query;
        if (city === "SF") {
          query = supabase
            .from("vehicle_positions")
            .select("*")
            .gte("recorded_at", since)
            .or("city.is.null,city.eq.SF")
            .order("recorded_at", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        } else {
          query = supabase
            .from("vehicle_positions")
            .select("*")
            .gte("recorded_at", since)
            .eq("city", city)
            .order("recorded_at", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        }

        let { data, error } = await query;

        // If city column doesn't exist (old schema), fall back to unfiltered query
        // This is only for backwards compatibility with old data
        if (error && error.code === "42703") {
          console.log("City column not found, fetching all data (legacy)...");
          const fallbackQuery = supabase
            .from("vehicle_positions")
            .select("*")
            .gte("recorded_at", since)
            .order("recorded_at", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

          const result = await fallbackQuery;
          data = result.data;
          error = result.error;
        }

        if (error) {
          console.error("Error fetching from Supabase:", error);
          break;
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
          setLoadingProgress(
            `Loading... ${allData.length.toLocaleString()} positions`
          );
        } else {
          hasMore = false;
        }
      }

      setLoadingProgress("");
      console.log(
        `Fetched ${allData.length} ${city} positions from last 7 days`
      );

      // Filter to only valid lines for this city (removes data for removed lines like Mattapan)
      // For Sacramento, also include "Shared" for downtown shared section vehicles
      const validLines = getLinesForCity(city);
      const filteredData = allData.filter((row: any) => {
        if (validLines.includes(row.route_id)) return true;
        // Sacramento special case: include "Shared" vehicles
        if (city === "Sacramento" && row.route_id === "Shared") return true;
        return false;
      });
      console.log(
        `Filtered to ${filteredData.length} positions for valid lines`
      );

      // Pre-compute segment assignments
      console.time("Pre-computing segments");
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
            cityConfig.routes
          ),
          headsign: row.headsign,
        };
      });
      console.timeEnd("Pre-computing segments");

      // Cache the results for instant switching
      cityDataCache.set(city, allPositions);
      
      // Start background preloading other cities
      startBackgroundPreload(city);
      
      setVehicles(allPositions);
      setDataSource("supabase");

      // Calculate line statistics (allPositions already filtered to valid lines)
      const lineSpeedMap = new Map<string, number[]>();
      allPositions.forEach((v) => {
        if (v.speed == null) return;
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
          dataAgeMinutes
        );
      } else {
        onVehicleUpdateRef.current?.(0, new Date(), [], undefined);
      }
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      setDataSource("none");
    }
  }, [city, cityConfig.routes]);

  // Fetch data when city changes
  useEffect(() => {
    // Check cache first - if cached, don't show loading state
    const cached = cityDataCache.get(city);
    if (cached && cached.length > 0) {
      // Instant switch - use cached data
      setVehicles(cached);
      setDataSource("supabase");
      console.log(`Instant cache hit for ${city}: ${cached.length} positions`);
      
      // Also update parent with cached data stats
      if (cached.length > 0) {
        const timestamps = cached.map((v) => new Date(v.recordedAt).getTime());
        const latestTime = new Date(Math.max(...timestamps));
        const dataAgeMinutes = (Date.now() - latestTime.getTime()) / (1000 * 60);
        
        // Calculate line stats from cached data
        const lineSpeedMap = new Map<string, number[]>();
        cached.forEach((v) => {
          if (v.speed == null) return;
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
          const median = sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
          stats.push({ line, avgSpeed: avg, medianSpeed: median, count: speeds.length });
        });
        
        onVehicleUpdateRef.current?.(cached.length, latestTime, stats, dataAgeMinutes);
      }
      return;
    }
    // No cache - show loading and fetch
    setVehicles([]);
    setDataSource("loading");
    fetchVehiclesFromSupabase();
  }, [city, fetchVehiclesFromSupabase]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    // Remove existing map if any
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

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
        },
        layers: [
          {
            id: "carto-dark-layer",
            type: "raster",
            source: "carto-dark",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: cityConfig.center,
      zoom: cityConfig.zoom,
      minZoom: 9,
      maxZoom: 18,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "bottom-right");

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

  // Add routes layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addRouteLayers = () => {
      if (!map.current) return;

      // If no lines selected, show all routes; otherwise filter to selected
      const filteredRoutes = {
        ...cityConfig.routes,
        features:
          selectedLines.length === 0
            ? cityConfig.routes.features
            : cityConfig.routes.features.filter((f: any) =>
                selectedLines.includes(f.properties.route_id)
              ),
      };

      // Remove existing layers
      try {
        if (map.current.getLayer("routes-outline"))
          map.current.removeLayer("routes-outline");
        if (map.current.getLayer("routes")) map.current.removeLayer("routes");
        if (map.current.getSource("routes")) map.current.removeSource("routes");
      } catch (e) {
        // Layer/source may not exist, ignore
      }

      map.current.addSource("routes", {
        type: "geojson",
        data: filteredRoutes as any,
      });

      const firstDataLayer = map.current.getLayer("vehicles-glow")
        ? "vehicles-glow"
        : map.current.getLayer("stops")
        ? "stops"
        : undefined;

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
        firstDataLayer
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
            "line-color": ["get", "route_color"],
            "line-width": 4,
            "line-opacity": 0.9,
          },
        },
        firstDataLayer
      );

      // Route hover
      map.current.on("mouseenter", "routes", () => {
        if (map.current) map.current.getCanvas().style.cursor = "pointer";
      });

      map.current.on("mouseleave", "routes", () => {
        if (map.current) map.current.getCanvas().style.cursor = "";
        popup.current?.remove();
      });

      map.current.on("mousemove", "routes", (e) => {
        if (!e.features?.length || !map.current) return;
        const props = e.features[0].properties;
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title" style="color: ${props.route_color}">${props.route_name}</div>
            </div>`
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
  }, [mapLoaded, selectedLines, showRouteLines, cityConfig.routes]);

  // Add/update stops layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addStopsLayers = () => {
      if (!map.current) return;

      // If no lines selected, show all stops; otherwise filter to selected
      const filteredStops = {
        ...cityConfig.stops,
        features:
          selectedLines.length === 0
            ? cityConfig.stops.features
            : cityConfig.stops.features.filter((f: any) =>
                f.properties.routes.some((r: string) =>
                  selectedLines.includes(r)
                )
              ),
      };

      const existingSource = map.current.getSource(
        "stops"
      ) as maplibregl.GeoJSONSource;

      if (existingSource) {
        existingSource.setData(filteredStops as any);
        map.current.setLayoutProperty(
          "stops",
          "visibility",
          showStops ? "visible" : "none"
        );
        map.current.setLayoutProperty(
          "stops-label",
          "visibility",
          showStops ? "visible" : "none"
        );
      } else {
        map.current.addSource("stops", {
          type: "geojson",
          data: filteredStops as any,
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
            "text-color": "#ffffff",
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
          popup.current?.remove();
        });

        map.current.on("mousemove", "stops", (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          const routes = JSON.parse(props.routes || "[]");

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title">${props.stop_name}</div>
                <div class="popup-detail">Lines: ${routes.join(", ")}</div>
              </div>`
            )
            .addTo(map.current);
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
  }, [mapLoaded, showStops, selectedLines, cityConfig.stops]);

  // Show all grade crossings regardless of selected lines
  // Note: F-line only crossings are already filtered out during the fetch script
  const filteredCrossings = useMemo(() => {
    // Each crossing has a 'routes' property listing which transit lines it's near
    // Show all crossings that have at least one route
    const nearbyFeatures = cityConfig.crossings.features.filter(
      (crossing: any) => {
        const nearRoutes: string[] = crossing.properties.routes;
        return nearRoutes && nearRoutes.length > 0;
      }
    );

    return { ...cityConfig.crossings, features: nearbyFeatures };
  }, [cityConfig.crossings]);

  // Add/update crossings layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addCrossingsLayer = () => {
      if (!map.current) return;

      const existingSource = map.current.getSource(
        "crossings"
      ) as maplibregl.GeoJSONSource;

      if (existingSource) {
        // Update data with filtered crossings
        existingSource.setData(filteredCrossings as any);
        map.current.setLayoutProperty(
          "crossings",
          "visibility",
          showCrossings ? "visible" : "none"
        );
      } else {
        map.current.addSource("crossings", {
          type: "geojson",
          data: filteredCrossings as any,
        });

        // Add crossing markers - use ✕ symbol in orange/yellow
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
            "text-color": "#ff9500",
            "text-halo-color": "#000000",
            "text-halo-width": 1.5,
          },
        });

        // Track if crossing popup is pinned (clicked)
        let crossingPopupPinned = false;
        
        // Crossing hover popup
        map.current.on("mouseenter", "crossings", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "crossings", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          // Only remove popup if not pinned
          if (!crossingPopupPinned) {
            popup.current?.remove();
          }
        });

        map.current.on("mousemove", "crossings", (e) => {
          // Don't update popup if it's pinned
          if (crossingPopupPinned) return;
          if (!e.features?.length || !map.current) return;
          
          // Get coordinates from the feature geometry
          const feature = e.features[0];
          const coords = feature.geometry.type === "Point" 
            ? (feature.geometry as GeoJSON.Point).coordinates 
            : null;
          const lon = coords ? coords[0].toFixed(6) : "N/A";
          const lat = coords ? coords[1].toFixed(6) : "N/A";

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title">Grade Crossing</div>
                <div class="popup-coords">${lat}, ${lon}</div>
              </div>`
            )
            .addTo(map.current);
        });
        
        // Click to pin the popup
        map.current.on("click", "crossings", (e) => {
          if (!e.features?.length || !map.current) return;
          
          // Get coordinates from the feature geometry
          const feature = e.features[0];
          const coords = feature.geometry.type === "Point" 
            ? (feature.geometry as GeoJSON.Point).coordinates 
            : null;
          const lon = coords ? coords[0].toFixed(6) : "N/A";
          const lat = coords ? coords[1].toFixed(6) : "N/A";
          
          crossingPopupPinned = true;

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content popup-pinned">
                <div class="popup-title">Grade Crossing 📌</div>
                <div class="popup-coords">${lat}, ${lon}</div>
                <div class="popup-hint">Click elsewhere to close</div>
              </div>`
            )
            .addTo(map.current);
          
          // Prevent the click from propagating to the map
          e.originalEvent.stopPropagation();
        });
        
        // Click elsewhere on map to unpin
        map.current.on("click", (e) => {
          // Check if click was on a crossing (handled above)
          const features = map.current?.queryRenderedFeatures(e.point, { layers: ["crossings"] });
          if (features && features.length > 0) return;
          
          // Unpin and remove popup
          crossingPopupPinned = false;
          popup.current?.remove();
        });
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
  }, [mapLoaded, showCrossings, filteredCrossings]);

  // Get switches and signals data for current city
  const switchesData = useMemo(() => {
    const config = CITY_CONFIG[city];
    return config.switches || { type: "FeatureCollection", features: [] };
  }, [city]);

  // Add/update switches layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addSwitchesLayer = () => {
      if (!map.current) return;

      const existingSource = map.current.getSource("switches") as maplibregl.GeoJSONSource;

      if (existingSource) {
        existingSource.setData(switchesData as any);
        map.current.setLayoutProperty(
          "switches",
          "visibility",
          showSwitches ? "visible" : "none"
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
          popup.current?.remove();
        });

        map.current.on("mousemove", "switches", (e) => {
          if (!e.features?.length || !map.current) return;
          
          const feature = e.features[0];
          const coords = feature.geometry.type === "Point" 
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
              </div>`
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

  // Speed-based color scale (memoized to prevent re-renders)
  const speedColorExpression: maplibregl.ExpressionSpecification = useMemo(
    () => [
      "case",
      ["==", ["get", "speed"], null],
      "#666666",
      ["<", ["get", "speed"], 5],
      "#ff3333",
      ["<", ["get", "speed"], 10],
      "#ff9933",
      ["<", ["get", "speed"], 15],
      "#ffdd33",
      ["<", ["get", "speed"], 25],
      "#88ff33",
      "#33ffff",
    ],
    []
  );

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
          isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city)
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
        "vehicles"
      ) as maplibregl.GeoJSONSource;

      if (existingSource) {
        existingSource.setData(vehicleGeoJSON);
      } else {
        map.current.addSource("vehicles", {
          type: "geojson",
          data: vehicleGeoJSON,
        });

        // Filter to hide null speed data points and optionally stopped trains
        const initialFilters: maplibregl.ExpressionSpecification[] = [
          ["!=", ["get", "speed"], null],
          [">=", ["get", "speed"], speedFilter.minSpeed],
          ["<=", ["get", "speed"], speedFilter.maxSpeed],
        ];
        if (hideStoppedTrains) {
          initialFilters.push([">", ["get", "speed"], 0]);
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
          popup.current?.remove();
        });

        map.current.on("mousemove", "vehicles", (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          const speed =
            props.speed != null
              ? `${Math.round(props.speed)} mph`
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
            detailLine = `Vehicle #${props.id.split('-')[0]}`;
          } else if (props.city === "SF") {
            // SF: Prefer API headsign if available (e.g., "Fisherman's Wharf")
            // Fall back to hardcoded terminus mapping for older data
            if (props.headsign) {
              titleLine = `${props.routeId} Line to ${props.headsign}`;
            } else {
              const terminus = SF_TERMINUS[props.routeId];
              const dir = props.direction === "Inbound" ? terminus?.inbound : terminus?.outbound;
              titleLine = `${props.routeId} Line ${dir || ""}`.trim();
            }
          } else if (props.city === "LA") {
            // LA: Show line letter + terminus based on direction
            // LA GTFS uses: direction 0 = NB/EB (toward downtown), direction 1 = SB/WB (away)
            // But getDirection() maps 0 → "Outbound", 1 → "Inbound", so we swap the lookup
            const lineInfo = LA_METRO_LINE_INFO[props.routeId as LAMetroLine];
            const lineLetter = lineInfo?.letter || props.routeId;
            const terminus = LA_TERMINUS[props.routeId];
            const dir = props.direction === "Outbound" ? terminus?.inbound : terminus?.outbound;
            titleLine = dir ? `${lineLetter} Line ${dir}` : `${lineLetter} Line`;
          } else if (props.city === "Boston") {
            // Boston: Show branch name (e.g., "B Branch" instead of "Green-B")
            const branchName = BOSTON_BRANCH_NAMES[props.routeId] || props.routeId;
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
              </div>`
            )
            .addTo(map.current);
        });
      }
    };

    // If style is already loaded, add layers immediately
    // Otherwise, wait for it with a small delay
    if (map.current.isStyleLoaded()) {
      addVehicleLayers();
    } else {
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addVehicleLayers();
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
  ]);

  // Update speed filter
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getLayer("vehicles")) return;

    const filters: maplibregl.ExpressionSpecification[] = [
      ["!=", ["get", "speed"], null],
      [">=", ["get", "speed"], speedFilter.minSpeed],
      ["<=", ["get", "speed"], speedFilter.maxSpeed],
    ];

    // Hide stopped trains (0 mph) if toggle is enabled
    if (hideStoppedTrains) {
      filters.push([">", ["get", "speed"], 0]);
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
    // 1. Route lines at the very bottom
    // 2. Vehicle data (raw data / segment avg) above routes
    // 3. Infrastructure overlays (crossings, switches) on top of data
    // 4. Stops/labels at the very top for readability
    const layerOrder = [
      "routes-outline",
      "routes",
      "speed-segments",
      "vehicles-glow",
      "vehicles",
      "crossings",
      "switches",
      "stops",
      "stops-label",
    ];

    // Get existing layers in our order
    const existingLayers = layerOrder.filter((id) =>
      map.current?.getLayer(id)
    );

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

    // Run immediately and after multiple delays to catch late-loading layers
    reorderLayers();
    const timeoutId1 = setTimeout(reorderLayers, 50);
    const timeoutId2 = setTimeout(reorderLayers, 150);
    const timeoutId3 = setTimeout(reorderLayers, 300);
    const timeoutId4 = setTimeout(reorderLayers, 500);

    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      clearTimeout(timeoutId3);
      clearTimeout(timeoutId4);
    };
  }, [
    mapLoaded,
    vehicles,
    showStops,
    showCrossings,
    showSwitches,
    showRouteLines,
    viewMode,
    selectedLines,
    city,
    reorderLayers,
  ]);

  // Also reorder when any source data changes (catches async layer additions)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const handleSourceData = () => {
      // Debounce reordering to avoid excessive calls
      setTimeout(reorderLayers, 10);
    };

    map.current.on("sourcedata", handleSourceData);

    return () => {
      map.current?.off("sourcedata", handleSourceData);
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
        showVehicles ? "visible" : "none"
      );
    }
    if (map.current.getLayer("vehicles-glow")) {
      map.current.setLayoutProperty(
        "vehicles-glow",
        "visibility",
        showVehicles ? "visible" : "none"
      );
    }

    // In live mode, update the source with only live vehicles
    if (viewMode === "live") {
      const filteredLiveVehicles = liveVehicles.filter(
        (v) =>
          shouldShowRoute(v.routeId, selectedLines, city) &&
          isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city)
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
        "vehicles"
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
          isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city)
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
        "vehicles"
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
          "visible"
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
      if (v.speed < speedFilter.minSpeed || v.speed > speedFilter.maxSpeed)
        return;
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
      "speed-segments"
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
              ["<", ["get", "avgSpeed"], 5],
              "#ff3333",
              ["<", ["get", "avgSpeed"], 10],
              "#ff9933",
              ["<", ["get", "avgSpeed"], 15],
              "#ffdd33",
              ["<", ["get", "avgSpeed"], 25],
              "#88ff33",
              "#33ffff",
            ],
            "line-opacity": 0.9,
          },
        },
        aboveLayer
      );

      map.current.on("mouseenter", "speed-segments", () => {
        if (map.current) map.current.getCanvas().style.cursor = "pointer";
      });

      map.current.on("mouseleave", "speed-segments", () => {
        if (map.current) map.current.getCanvas().style.cursor = "";
        popup.current?.remove();
      });

      map.current.on("mousemove", "speed-segments", (e) => {
        if (!e.features?.length || !map.current) return;
        const props = e.features[0].properties;

        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title">${props.routeId} Segment</div>
              <div class="popup-speed">${Math.round(
                props.avgSpeed
              )} mph avg</div>
              <div class="popup-detail">${props.sampleCount} readings</div>
            </div>`
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

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {dataSource === "none" && (
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
      {loadingProgress && (
        <div className="loading-indicator">{loadingProgress}</div>
      )}
    </div>
  );
}
