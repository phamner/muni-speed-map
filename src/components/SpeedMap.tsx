import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { City, LAMetroLine } from "../types";
import { getLinesForCity, LA_METRO_LINE_INFO } from "../types";
import { supabase } from "../lib/supabase";
import {
  loadCityData,
  isCityDataCached,
  getCachedCityData,
  CITY_COORDS,
  type CityStaticData,
} from "../data/cityDataLoaders";
import slcRailContextHeavy from "../data/rail-context/slcRailContextHeavy.json";
import slcRailContextCommuter from "../data/rail-context/slcRailContextCommuter.json";
import { loadPopulationDensity } from "../data/populationDensityLoader";
import type { SpeedFilter, ViewMode, LineStats } from "../App";
import {
  debounce,
  waitForNoLongTasks,
  EMPTY_CITY_DATA,
  escapeHtml,
  distanceToLineString,
  distanceToSegment,
  MAX_DISTANCE_FROM_ROUTE_METERS,
} from "./speedMap/geoUtils";
import { filterSeparationByRoutes } from "./speedMap/separationUtils";
import {
  buildRouteGeometryMap,
  isOnRoute,
  shouldShowRoute,
} from "./speedMap/routeUtils";
import {
  buildAllSegments,
  CITIES_WITH_PARALLEL_TRACKS,
  SEGMENT_SIZE_500_METERS,
} from "./speedMap/segmentUtils";
import {
  type Vehicle,
  cityDataCache,
  POSITION_COLUMNS,
  fetchPagesParallel,
  getRouteFeatureMap,
  findSegmentsForVehicle,
  getDirection,
  SF_TERMINUS,
  LA_TERMINUS,
  BOSTON_BRANCH_NAMES,
} from "./speedMap/vehicleData";
import {
  SpeedLegend,
  SeparationLegend,
  DensityLegend,
  DynamicLegends,
} from "./speedMap/MapLegends";
import { LayerSelector } from "./speedMap/LayerSelector";

function buildImpossibleFilter(
  propertyName: string,
): maplibregl.FilterSpecification {
  return [
    "==",
    ["to-string", ["get", propertyName]],
    "__never_matches__",
  ] as maplibregl.FilterSpecification;
}

function buildSelectedLineFilter(
  selectedLines: readonly string[],
  city: string,
  routeProperty: string,
  linesProperty?: string,
): maplibregl.FilterSpecification {
  if (selectedLines.length === 0) {
    return buildImpossibleFilter(routeProperty);
  }

  const selected = selectedLines.map(String);
  const conditions: maplibregl.ExpressionSpecification[] = [
    ["in", ["to-string", ["get", routeProperty]], ["literal", selected]],
  ];

  if (
    city === "Pittsburgh" &&
    selected.some((line) => ["RED", "BLUE", "SLVR"].includes(line))
  ) {
    conditions.push(["==", ["to-string", ["get", routeProperty]], "shared"]);
  }

  if (linesProperty) {
    for (const line of selected) {
      conditions.push([
        "in",
        line,
        ["coalesce", ["get", linesProperty], ["literal", []]],
      ]);
    }
  }

  return (
    conditions.length === 1 ? conditions[0] : ["any", ...conditions]
  ) as maplibregl.FilterSpecification;
}

const MAXSPEED_ROUTE_MATCH_METERS = 75;
const MAXSPEED_BEARING_TOLERANCE_DEG = 35;

function getFeatureLineStrings(feature: any): number[][][] {
  if (!feature?.geometry) return [];
  if (feature.geometry.type === "LineString") {
    return [feature.geometry.coordinates];
  }
  if (feature.geometry.type === "MultiLineString") {
    return feature.geometry.coordinates;
  }
  return [];
}

function bearing(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y1 = (lat1 * Math.PI) / 180;
  const y2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(y2);
  const x =
    Math.cos(y1) * Math.sin(y2) - Math.sin(y1) * Math.cos(y2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bearingsAligned(b1: number, b2: number, tolerance: number): boolean {
  let diff = Math.abs(b1 - b2) % 360;
  if (diff > 180) diff = 360 - diff;
  if (diff > 90) diff = 180 - diff;
  return diff <= tolerance;
}

function lineBearing(coords: number[][]): number | null {
  if (coords.length < 2) return null;
  return bearing(
    coords[0][0],
    coords[0][1],
    coords[coords.length - 1][0],
    coords[coords.length - 1][1],
  );
}

function nearestSegmentBearing(
  lat: number,
  lon: number,
  coordinates: number[][],
): number | null {
  let minDist = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const dist = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const [x1, y1] = coordinates[bestIdx];
  const [x2, y2] = coordinates[bestIdx + 1];
  return bearing(x1, y1, x2, y2);
}

function annotateMaxspeedRoutes(maxspeed: any, routes: any, city: string): any {
  if (!maxspeed?.features?.length) return maxspeed;

  const routeLines = routes.features.flatMap((feature: any) => {
    const routeId = feature.properties?.route_id;
    if (!routeId) return [];
    if (city === "SF" && String(routeId) === "F") return [];
    return getFeatureLineStrings(feature).map((coordinates) => ({
      routeId: String(routeId),
      coordinates,
    }));
  });

  const features = maxspeed.features.map((feature: any) => {
    const existingRoutes = Array.isArray(feature.properties?.routes)
      ? feature.properties.routes.map(String)
      : [];

    if (existingRoutes.length > 0) {
      return feature;
    }

    const matchedRoutes = new Set<string>();
    const lineStrings = getFeatureLineStrings(feature);

    for (const coords of lineStrings) {
      const featureBearing = lineBearing(coords);

      for (const routeLine of routeLines) {
        if (matchedRoutes.has(routeLine.routeId)) continue;

        let pointsNear = 0;
        let pointsAligned = 0;

        for (const [lon, lat] of coords) {
          const distance = distanceToLineString(
            lat,
            lon,
            routeLine.coordinates,
          );
          if (distance <= MAXSPEED_ROUTE_MATCH_METERS) {
            pointsNear++;
            const routeBearing = nearestSegmentBearing(
              lat,
              lon,
              routeLine.coordinates,
            );
            if (
              featureBearing != null &&
              routeBearing != null &&
              bearingsAligned(
                featureBearing,
                routeBearing,
                MAXSPEED_BEARING_TOLERANCE_DEG,
              )
            ) {
              pointsAligned++;
            }
          }
        }

        if (pointsNear > 0 && (featureBearing == null || pointsAligned > 0)) {
          matchedRoutes.add(routeLine.routeId);
        }
      }
    }

    return {
      ...feature,
      properties: {
        ...feature.properties,
        routes: Array.from(matchedRoutes),
      },
    };
  });

  return { ...maxspeed, features };
}

interface SpeedMapProps {
  city: City;
  selectedLines: string[];
  speedFilter: SpeedFilter;
  showRouteLines: boolean;
  routeLineMode: "byLine" | "bySpeedLimit" | "bySeparation";
  showStops: boolean;
  showCrossings: boolean;
  showTrafficLights: boolean;
  showSwitches: boolean;
  showRailContextHeavy: boolean;
  showRailContextCommuter: boolean;
  showBusRoutesOverlay: boolean;
  hideStoppedTrains: boolean;
  hideAllTrains: boolean;
  viewMode: ViewMode;
  showSatellite: boolean;
  onSatelliteToggle?: (show: boolean) => void;
  showPopulationDensity?: boolean;
  onPopulationDensityToggle?: (show: boolean) => void;
  speedUnit: "mph" | "kmh";
  onMapReady?: () => void;
  onVehicleUpdate?: (
    count: number,
    time: Date,
    lineStats?: LineStats[],
    dataAgeMinutes?: number,
  ) => void;
  onRailContextUpdate?: (
    heavyCount: number,
    commuterCount: number,
    busCount: number,
  ) => void;
}

const POPULATION_DENSITY_COUNTIES_BY_CITY: Partial<
  Record<City, Record<string, string>>
> = {
  SF: {
    "001": "Alameda County",
    "013": "Contra Costa County",
    "041": "Marin County",
    "075": "San Francisco County",
    "081": "San Mateo County",
    "085": "Santa Clara County",
  },
  LA: {
    "037": "Los Angeles County",
    "059": "Orange County",
    "065": "Riverside County",
    "071": "San Bernardino County",
    "111": "Ventura County",
  },
  Boston: {
    "009": "Essex County",
    "017": "Middlesex County",
    "021": "Norfolk County",
    "025": "Suffolk County",
  },
  Philadelphia: {
    "005": "Burlington County",
    "007": "Camden County",
    "015": "Gloucester County",
    "017": "Bucks County",
    "021": "Mercer County",
    "029": "Chester County",
    "045": "Delaware County",
    "091": "Montgomery County",
    "101": "Philadelphia County",
  },
  Seattle: {
    "033": "King County",
    "053": "Pierce County",
    "061": "Snohomish County",
  },
  Portland: {
    "005": "Clackamas County",
    "011": "Clark County",
    "051": "Multnomah County",
    "067": "Washington County",
  },
  "San Diego": {
    "073": "San Diego County",
  },
  "San Jose": {
    "001": "Alameda County",
    "013": "Contra Costa County",
    "075": "San Francisco County",
    "081": "San Mateo County",
    "085": "Santa Clara County",
  },
  Pittsburgh: {
    "003": "Allegheny County",
    "125": "Washington County",
  },
  Minneapolis: {
    "037": "Dakota County",
    "053": "Hennepin County",
    "123": "Ramsey County",
  },
  Denver: {
    "001": "Adams County",
    "005": "Arapahoe County",
    "013": "Boulder County",
    "031": "Denver County",
    "035": "Douglas County",
    "059": "Jefferson County",
  },
  "Salt Lake City": {
    "003": "Box Elder County",
    "011": "Davis County",
    "035": "Salt Lake County",
    "049": "Utah County",
    "057": "Weber County",
  },
  Phoenix: {
    "013": "Maricopa County",
  },
  Cleveland: {
    "035": "Cuyahoga County",
    "085": "Lake County",
    "093": "Lorain County",
  },
  Charlotte: {
    "071": "Gaston County",
    "119": "Mecklenburg County",
    "179": "Union County",
  },
  Baltimore: {
    "003": "Anne Arundel County",
    "005": "Baltimore County",
    "027": "Howard County",
    "510": "Baltimore City",
  },
};

const TORONTO_POPULATION_DENSITY_AREAS: Record<string, string> = {
  "532": "Oshawa CMA",
  "535": "Toronto CMA",
  "537": "Hamilton CMA",
  "541": "Kitchener-Cambridge-Waterloo CMA",
  "550": "Guelph CMA",
  "568": "Barrie CMA",
};

function formatUsTractLabel(geoid: string): string | null {
  if (!/^\d{11}$/.test(geoid)) return null;
  const tractCode = geoid.slice(5);
  const whole = `${parseInt(tractCode.slice(0, 4), 10)}`;
  const fractional = tractCode.slice(4);
  return fractional === "00" ? whole : `${whole}.${fractional}`;
}

function formatCanadianTractLabel(geoid: string): string | null {
  const match = geoid.match(/^(\d{3})(.+)$/);
  if (!match) return null;
  const tract = match[2].replace(/^0+/, "");
  return tract || match[2];
}

function getPopulationDensityAreaLabel(
  city: City,
  geoid: string,
): string | null {
  if (city === "Toronto") {
    return TORONTO_POPULATION_DENSITY_AREAS[geoid.slice(0, 3)] || null;
  }

  const counties = POPULATION_DENSITY_COUNTIES_BY_CITY[city];
  if (!counties || !/^\d{11}$/.test(geoid)) return null;
  return counties[geoid.slice(2, 5)] || null;
}

function getPopulationDensityTractLabel(
  city: City,
  geoid: string,
): string | null {
  return city === "Toronto"
    ? formatCanadianTractLabel(geoid)
    : formatUsTractLabel(geoid);
}

export function SpeedMap({
  city,
  selectedLines,
  speedFilter,
  showRouteLines,
  routeLineMode,
  showStops,
  showCrossings,
  showTrafficLights,
  showSwitches,
  showRailContextHeavy,
  showRailContextCommuter,
  showBusRoutesOverlay,
  hideStoppedTrains,
  hideAllTrains,
  viewMode,
  showSatellite,
  onSatelliteToggle,
  showPopulationDensity,
  onPopulationDensityToggle,
  speedUnit,
  onMapReady,
  onVehicleUpdate,
  onRailContextUpdate,
}: SpeedMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const crossingPopupPinned = useRef(false);
  const touchPopupPinned = useRef(false);
  const hoveredTractId = useRef<string | null>(null);
  const crossingHandlersRegistered = useRef(false);
  const suppressNextMapClickUnpin = useRef(false);
  const prevViewMode = useRef<ViewMode>(viewMode);
  const routeLineModeRef = useRef(routeLineMode);
  routeLineModeRef.current = routeLineMode;
  const showRouteLinesRef = useRef(showRouteLines);
  showRouteLinesRef.current = showRouteLines;
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showMobileLegends, setShowMobileLegends] = useState(false);
  const [expandedStopCluster, setExpandedStopCluster] = useState<string | null>(
    null,
  );
  // Reset expanded cluster when city changes
  useEffect(() => {
    setExpandedStopCluster(null);
  }, [city]);
  const segmentWorker = useRef<Worker | null>(null);
  const segmentRequestId = useRef(0);

  useEffect(() => {
    try {
      const worker = new Worker(
        new URL("./speedMap/segmentWorker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onerror = (e) => {
        console.warn("Segment worker error, falling back to main thread:", e);
        segmentWorker.current = null;
      };
      segmentWorker.current = worker;
    } catch (e) {
      console.warn("Failed to create segment worker, using main thread:", e);
      segmentWorker.current = null;
    }
    return () => {
      segmentWorker.current?.terminate();
      segmentWorker.current = null;
    };
  }, []);

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

  const isTouchInteractionMode = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;

  // Ref to avoid re-render loops with the callback
  const onVehicleUpdateRef = useRef(onVehicleUpdate);
  onVehicleUpdateRef.current = onVehicleUpdate;

  // Single source of truth: whenever vehicles changes, compute and propagate count/stats
  useEffect(() => {
    if (vehicles.length === 0) {
      onVehicleUpdateRef.current?.(0, new Date(), [], undefined);
      return;
    }

    // Calculate timestamps and data age
    const timestamps = vehicles.map((v) => new Date(v.recordedAt).getTime());
    const latestTime = new Date(Math.max(...timestamps));
    const dataAgeMinutes = (Date.now() - latestTime.getTime()) / (1000 * 60);

    // Calculate line stats (exclude 0 mph readings from averages)
    const lineSpeedMap = new Map<string, number[]>();
    vehicles.forEach((v) => {
      if (v.speed == null || v.speed < 0.5) return;
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
      vehicles.length,
      latestTime,
      stats,
      dataAgeMinutes,
    );
  }, [vehicles]);

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
      trafficLights: cityStaticData?.trafficLights || null,
      railContextHeavy: cityStaticData?.railContextHeavy || null,
      railContextCommuter: cityStaticData?.railContextCommuter || null,
      busRoutesOverlay: cityStaticData?.busRoutesOverlay || null,
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

  const railContextCounts = useMemo(() => {
    const busFeatures = cityConfig.busRoutesOverlay?.features || [];
    const uniqueBusRoutes = new Set<string>();
    for (const feature of busFeatures as any[]) {
      const props = feature?.properties || {};
      const routeKey = String(
        props.route_short_name || props.route_id || props.route_name || "",
      ).trim();
      if (routeKey) uniqueBusRoutes.add(routeKey);
    }

    return {
      heavy: effectiveRailContext.heavy?.features?.length || 0,
      commuter: effectiveRailContext.commuter?.features?.length || 0,
      bus: uniqueBusRoutes.size,
    };
  }, [effectiveRailContext, cityConfig.busRoutesOverlay]);

  useEffect(() => {
    onRailContextUpdate?.(
      railContextCounts.heavy,
      railContextCounts.commuter,
      railContextCounts.bus,
    );
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

      // Agency abbreviation map
      const agencyAbbrev: Record<string, string> = {
        "Bay Area Rapid Transit": "BART",
        "Regional Transportation District": "RTD",
        "Massachusetts Bay Transportation Authority": "MBTA",
        "Cape Cod Regional Transit Authority": "CCRTA",
        "Southeastern Pennsylvania Transportation Authority": "SEPTA",
        "New Jersey Transit Corporation": "NJ Transit",
        "New Jersey Transit": "NJ Transit",
        "Metropolitan Transportation Authority": "MTA",
        "Los Angeles County Metropolitan Transportation Authority": "LA Metro",
        "Southern California Regional Rail Authority": "Metrolink",
        "Sound Transit": "Sound Transit",
        TriMet: "TriMet",
        "Utah Transit Authority": "UTA",
        "Denver Regional Transportation District": "RTD",
        "Capitol Corridor Joint Powers Authority": "Capitol Corridor",
        "Altamont Corridor Express": "ACE",
        "Sonoma Marin Area Rail Transit": "SMART",
        Caltrain: "Caltrain",
        "Port Authority Trans-Hudson Corporation": "PATH",
        "Maryland Transit Administration": "MTA Maryland",
        "Greater Cleveland Regional Transit Authority": "RTA",
        "Metro Transit": "Metro Transit",
        "Valley Metro": "Valley Metro",
        "Charlotte Area Transit System": "CATS",
        "San Diego Metropolitan Transit System": "MTS",
        "Toronto Transit Commission": "TTC",
        "GO Transit": "GO Transit",
      };

      const getAbbrev = (agency: string) => agencyAbbrev[agency] || agency;

      // Clean up service name: prefer short name, strip direction suffixes
      const cleanServiceName = (
        shortName: string,
        longName: string,
        routeId: string,
      ) => {
        const stripDirectionalSuffix = (value: string) =>
          value.length > 1 ? value.replace(/[-\s]?[NSEW]$/, "") : value;

        // For BART-style names with direction suffixes, just use the color
        let name = shortName || longName || routeId;
        // Strip -N, -S, -E, -W suffixes
        name = stripDirectionalSuffix(name);
        // If we have a long name that's more descriptive (like "Fairmount Line"), prefer it
        if (!shortName && longName) {
          name = longName;
        } else if (shortName && longName && !longName.includes(" to ")) {
          // If long name doesn't have "X to Y" format, it might be better (e.g., "Fairmount Line")
          name = longName;
        } else if (shortName) {
          name = stripDirectionalSuffix(shortName);
        }
        return name;
      };

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

        const serviceName = cleanServiceName(shortName, longName, routeId);
        const abbrevAgency = getAbbrev(agencyName);
        const key = `${serviceClass}|${serviceName}|${abbrevAgency}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);

        if (serviceClass === "heavy") {
          heavy.push({ service: serviceName, agency: abbrevAgency });
        } else {
          commuter.push({ service: serviceName, agency: abbrevAgency });
        }
      }

      // Group items by agency for cleaner display
      const groupByAgency = (
        items: Array<{ service: string; agency: string }>,
      ) => {
        const grouped: Record<string, string[]> = {};
        for (const item of items) {
          if (!grouped[item.agency]) grouped[item.agency] = [];
          grouped[item.agency].push(item.service);
        }
        return grouped;
      };

      const renderGroupedHtml = (
        items: Array<{ service: string; agency: string }>,
      ) => {
        const grouped = groupByAgency(items);
        const agencies = Object.keys(grouped).sort();

        return (
          `<div style="text-align:left;padding-left:8px">` +
          agencies
            .map((agency) => {
              const lines = grouped[agency].sort();
              // Always show agency header with bulleted lines underneath
              const lineList = lines
                .map(
                  (l) =>
                    `<div style="padding-left:12px;color:#e5e7eb">• ${escapeHtml(l)}</div>`,
                )
                .join("");
              return `<div style="margin:6px 0"><span style="color:#9ca3af;font-weight:500">${escapeHtml(agency)}:</span>${lineList}</div>`;
            })
            .join("") +
          `</div>`
        );
      };

      popup.current
        ?.setLngLat(e.lngLat)
        .setHTML(
          `<div class="popup-content">
            ${
              heavy.length
                ? `<div class="popup-title" style="margin-top:4px;color:#d1d5db">Metro / Subway</div>${renderGroupedHtml(heavy)}`
                : ""
            }
            ${
              commuter.length
                ? `<div class="popup-title" style="margin-top:4px;color:#d1d5db">Regional / Commuter rail</div>${renderGroupedHtml(commuter)}`
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
    const rawFeatures = cityConfig.stops?.features || [];

    // Normalize stop feature schemas across city data sources.
    // Some cities (e.g. Minneapolis) use OSM-style `name` instead of `stop_name`.
    const features = rawFeatures
      .map((f: any) => {
        const props = f?.properties || {};
        const stopName = props.stop_name || props.name || props.station_name;
        if (!stopName || !f?.geometry?.coordinates) return null;

        return {
          ...f,
          properties: {
            ...props,
            stop_name: stopName,
            routes: Array.isArray(props.routes)
              ? props.routes
              : props.routes
                ? [props.routes]
                : [],
          },
        };
      })
      .filter(Boolean);

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
    () => buildAllSegments(cityConfig.routes, city),
    [cityConfig.routes, city],
  );
  const allRouteSegments500 = useMemo(
    () => buildAllSegments(cityConfig.routes, city, SEGMENT_SIZE_500_METERS),
    [cityConfig.routes, city],
  );
  const allCityLines = useMemo(() => Array.from(getLinesForCity(city)), [city]);
  const annotatedMaxspeed = useMemo(
    () => annotateMaxspeedRoutes(cityConfig.maxspeed, cityConfig.routes, city),
    [cityConfig.maxspeed, cityConfig.routes, city],
  );
  const routeLayerFilter = useMemo(
    () => buildSelectedLineFilter(selectedLines, city, "route_id", "lines"),
    [selectedLines, city],
  );
  const speedLimitLayerFilter = useMemo(
    () => buildSelectedLineFilter(selectedLines, city, "__route__", "routes"),
    [selectedLines, city],
  );
  const segmentLayerFilter = useMemo(
    () => buildSelectedLineFilter(selectedLines, city, "routeId"),
    [selectedLines, city],
  );
  const vehicleRouteFilter = useMemo(() => {
    if (selectedLines.length === 0) {
      return buildImpossibleFilter("routeId");
    }
    return buildSelectedLineFilter(selectedLines, city, "routeId");
  }, [selectedLines, city]);

  // Pre-computed GeoJSON for vehicle layers — avoids expensive rebuilds on mode switches
  const cachedVehicleGeoJSON = useMemo(() => {
    const filtered = vehicles.filter(
      (v) =>
        shouldShowRoute(v.routeId, allCityLines, city) &&
        isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city),
    );
    return {
      type: "FeatureCollection" as const,
      features: filtered.map((v) => ({
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
  }, [vehicles, city, routeGeometryMap, allCityLines]);

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

  const cachedLiveVehicleGeoJSON = useMemo(() => {
    const filtered = liveVehicles.filter(
      (v) =>
        shouldShowRoute(v.routeId, allCityLines, city) &&
        isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap, city),
    );
    return {
      type: "FeatureCollection" as const,
      features: filtered.map((v) => ({
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
  }, [liveVehicles, city, routeGeometryMap, allCityLines]);

  const computeOnMainThread = useCallback((rows: any[], routes: any, cityName: string): Vehicle[] => {
    const routeFeatureMap = getRouteFeatureMap(routes);
    return rows.map((row: any) => {
      const segments = findSegmentsForVehicle(
        row.lat, row.lon, row.route_id,
        routes, routeFeatureMap, cityName,
      );
      return {
        id: `${row.vehicle_id}-${row.id}`,
        lat: row.lat, lon: row.lon, routeId: row.route_id,
        direction: getDirection(row.direction_id),
        speed: row.speed_calculated,
        recordedAt: row.recorded_at,
        segmentId: segments.segmentId,
        segmentId500: segments.segmentId500,
        headsign: row.headsign,
        onRoute: segments.minDistance <= MAX_DISTANCE_FROM_ROUTE_METERS,
      };
    });
  }, []);

  // Fetch vehicle positions from Supabase filtered by city
  const fetchVehiclesFromSupabase = useCallback(async () => {
    if (!supabase) {
      setDataSource("none");
      return;
    }

    // Check cache first - instant city switching!
    // The vehicles useEffect will automatically update count/stats
    const cached = cityDataCache.get(city);
    if (cached && cached.length > 0) {
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

      // Filter to only valid lines for this city
      const validLines = getLinesForCity(city);
      const filteredData = allData.filter((row: any) => {
        return validLines.includes(row.route_id);
      });

      setLoadingProgress(
        `Mapping ${filteredData.length.toLocaleString()} positions to track...`,
      );
      setIsProcessing(true);

      console.time("Pre-computing segments");
      const thisRequestId = ++segmentRequestId.current;

      const allPositions: Vehicle[] = await new Promise((resolve) => {
        const worker = segmentWorker.current;
        if (!worker) {
          resolve(computeOnMainThread(filteredData, cityConfig.routes, city));
          return;
        }

        const cleanup = () => {
          worker.removeEventListener("message", handler);
          worker.removeEventListener("error", errorHandler);
        };
        const handler = (e: MessageEvent) => {
          if (e.data.requestId !== thisRequestId) return;
          cleanup();
          resolve(e.data.vehicles);
        };
        const errorHandler = () => {
          cleanup();
          console.warn("Worker error during computation, falling back to main thread");
          segmentWorker.current = null;
          resolve(computeOnMainThread(filteredData, cityConfig.routes, city));
        };
        worker.addEventListener("message", handler);
        worker.addEventListener("error", errorHandler);

        worker.postMessage({
          rows: filteredData,
          routes: cityConfig.routes,
          city,
          requestId: thisRequestId,
        });
      });

      console.timeEnd("Pre-computing segments");

      if (thisRequestId !== segmentRequestId.current) {
        return;
      }

      // Cache the results for instant switching
      cityDataCache.set(city, allPositions);

      setLoadingProgress(
        `Rendering ${allPositions.length.toLocaleString()} data points...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      setVehicles(allPositions);
      setDataSource("supabase");
      // The vehicles useEffect will automatically update count/stats

      // Show rendering phase - will be cleared by idle event listener
      // after MapLibre finishes rendering all the data
      setLoadingProgress("Rendering...");
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      setDataSource("none");
      setLoadingProgress("");
      setIsProcessing(false);
    }
  }, [city, cityConfig.routes, computeOnMainThread]);

  // Fetch data when city changes (but only after static data is loaded)
  useEffect(() => {
    // Don't fetch if static data isn't loaded yet
    if (cityDataLoading || !cityStaticData) {
      return;
    }

    // Check cache first - if cached, don't show loading state
    // The vehicles useEffect will automatically update count/stats
    const cached = cityDataCache.get(city);
    if (cached && cached.length > 0) {
      // Instant switch - use cached data
      setVehicles(cached);
      setDataSource("supabase");
      setLoadingProgress("Rendering...");
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

      const allRoutes = cityConfig.routes;

      // Separate under-construction routes (like Line 5 Eglinton) for dashed styling
      const constructionRoutes = {
        type: "FeatureCollection",
        features: allRoutes.features.filter(
          (f: any) => f.properties.under_construction,
        ),
      };
      const regularRoutes = {
        type: "FeatureCollection",
        features: allRoutes.features.filter(
          (f: any) => !f.properties.under_construction,
        ),
      };
      const tunnelRoutes = { type: "FeatureCollection", features: [] };

      const emptyFC = { type: "FeatureCollection", features: [] } as any;

      // UPDATE PATH: sources already exist, just swap GeoJSON data in-place.
      // This avoids the remove-and-recreate cycle that causes visual flicker.
      if (map.current.getSource("routes")) {
        try {
          (map.current.getSource("routes") as any).setData(regularRoutes);
          (map.current.getSource("routes-tunnel") as any).setData(tunnelRoutes);
          (map.current.getSource("routes-construction") as any).setData(
            constructionRoutes,
          );
          (map.current.getSource("rail-context-heavy-src") as any).setData(
            effectiveRailContext.heavy || emptyFC,
          );
          (map.current.getSource("rail-context-commuter-src") as any).setData(
            effectiveRailContext.commuter || emptyFC,
          );
          (map.current.getSource("bus-routes-overlay-src") as any).setData(
            cityConfig.busRoutesOverlay || emptyFC,
          );
          if (map.current.getSource("speed-limit")) {
            (map.current.getSource("speed-limit") as any).setData(
              annotatedMaxspeed || emptyFC,
            );
          }
        } catch {
          // Source might have been removed externally
        }
        return;
      }

      // CREATE PATH: first time — build all sources, layers, and event handlers.
      // Safety: remove any stale layers/sources (e.g., after style reload)
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
        if (map.current.getLayer("bus-routes-overlay"))
          map.current.removeLayer("bus-routes-overlay");
        if (map.current.getLayer("bus-routes-overlay-labels"))
          map.current.removeLayer("bus-routes-overlay-labels");
        if (map.current.getSource("routes")) map.current.removeSource("routes");
        if (map.current.getSource("routes-construction"))
          map.current.removeSource("routes-construction");
        if (map.current.getSource("routes-tunnel"))
          map.current.removeSource("routes-tunnel");
        if (map.current.getSource("rail-context-heavy-src"))
          map.current.removeSource("rail-context-heavy-src");
        if (map.current.getSource("rail-context-commuter-src"))
          map.current.removeSource("rail-context-commuter-src");
        if (map.current.getSource("bus-routes-overlay-src"))
          map.current.removeSource("bus-routes-overlay-src");
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

      map.current.addSource("bus-routes-overlay-src", {
        type: "geojson",
        data: cityConfig.busRoutesOverlay
          ? cityConfig.busRoutesOverlay
          : {
              type: "FeatureCollection",
              features: [],
            },
      });

      map.current.addLayer({
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
      });

      map.current.addLayer({
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
      });

      map.current.addLayer({
        id: "bus-routes-overlay",
        type: "line",
        source: "bus-routes-overlay-src",
        layout: {
          "line-join": "round",
          "line-cap": "round",
          visibility: showBusRoutesOverlay ? "visible" : "none",
        },
        paint: {
          "line-color": "#ffd34d",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.6,
            12,
            1.0,
            14,
            1.6,
          ],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            0.0,
            10,
            0.18,
            12,
            0.28,
            14,
            0.36,
          ],
        },
      });

      map.current.addLayer({
        id: "bus-routes-overlay-labels",
        type: "symbol",
        source: "bus-routes-overlay-src",
        minzoom: 14.0,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14.0,
            520,
            15,
            420,
            17,
            320,
          ],
          "text-field": [
            "coalesce",
            ["get", "route_short_name"],
            ["get", "route_id"],
          ],
          "text-font": ["Open Sans Semibold"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14.0,
            9.5,
            14.5,
            10.5,
            16,
            12,
            18,
            13,
          ],
          "text-letter-spacing": 0.03,
          "text-max-angle": 25,
          "text-keep-upright": true,
          "text-rotation-alignment": "map",
          visibility: showBusRoutesOverlay ? "visible" : "none",
        },
        paint: {
          "text-color": "#ffe28a",
          "text-opacity": 0.88,
          "text-halo-color": "rgba(7, 10, 18, 0.96)",
          "text-halo-width": 1.5,
          "text-halo-blur": 0.6,
        },
      });

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
      map.current.addLayer({
        id: "routes-outline",
        type: "line",
        source: "routes",
        filter: routeLayerFilter,
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
      });

      map.current.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        filter: routeLayerFilter,
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
      });

      // Under-construction route layers (dashed lines to indicate not yet operational)
      map.current.addLayer({
        id: "routes-construction-outline",
        type: "line",
        source: "routes-construction",
        filter: routeLayerFilter,
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
      });

      map.current.addLayer({
        id: "routes-construction",
        type: "line",
        source: "routes-construction",
        filter: routeLayerFilter,
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
      });

      // Tunnel route layers (reduced opacity like OpenRailwayMap - faded appearance)
      map.current.addLayer({
        id: "routes-tunnel-outline",
        type: "line",
        source: "routes-tunnel",
        filter: routeLayerFilter,
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
      });

      map.current.addLayer({
        id: "routes-tunnel",
        type: "line",
        source: "routes-tunnel",
        filter: routeLayerFilter,
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
      });

      // Speed limit layers (colored by maxspeed)
      map.current.addSource("speed-limit", {
        type: "geojson",
        data: (annotatedMaxspeed?.features?.length > 0
          ? annotatedMaxspeed
          : emptyFC) as any,
      });

      {
        map.current.addLayer({
          id: "speed-limit-outline",
          type: "line",
          source: "speed-limit",
          filter: speedLimitLayerFilter,
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
        });

        map.current.addLayer({
          id: "speed-limit",
          type: "line",
          source: "speed-limit",
          filter: speedLimitLayerFilter,
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
        });

        // Speed limit labels (visible at high zoom)
        map.current.addLayer({
          id: "speed-limit-labels",
          type: "symbol",
          source: "speed-limit",
          filter: speedLimitLayerFilter,
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
      map.current.addSource("separation", {
        type: "geojson",
        data: emptyFC,
      });

      {
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
          "separated_at_grade",
          "#eab308", // Yellow
          "#6b7280", // Grey fallback for unknown
        ];

        map.current.addLayer({
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
        });

        map.current.addLayer({
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
        });

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

        // Read current mode from refs to avoid stale closure captures
        const isSpeedMode =
          showRouteLinesRef.current &&
          routeLineModeRef.current === "bySpeedLimit";
        const isSepMode =
          showRouteLinesRef.current &&
          routeLineModeRef.current === "bySeparation";
        if (isSpeedMode || isSepMode) return;

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

      // Ensure symbol layers (stops, traffic-lights, crossings, switches, vehicles)
      // stay above route layers by moving them to the top after route layers are added
      const symbolLayers = [
        "stops",
        "stops-label",
        "traffic-lights",
        "crossings",
        "switches",
        "vehicles-glow",
        "vehicles",
      ];
      for (const layerId of symbolLayers) {
        if (map.current.getLayer(layerId)) {
          map.current.moveLayer(layerId);
        }
      }
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
    city,
    cityConfig.routes,
    cityConfig.maxspeed,
    cityConfig.separation,
    cityConfig.busRoutesOverlay,
    annotatedMaxspeed,
    effectiveRailContext,
    // Used only in CREATE path (first run); stable across renders:
    maxspeedColorExpression,
    handleRailContextMouseEnter,
    handleRailContextMouseLeave,
    handleRailContextMouseMove,
    showRouteLines,
    routeLineMode,
    showRailContextHeavy,
    showRailContextCommuter,
    showBusRoutesOverlay,
  ]);

  // Keep route-line visibility and paint in sync with mode / toggle state
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const showBySpeed = showRouteLines && routeLineMode === "bySpeedLimit";
    const showBySeparation = showRouteLines && routeLineMode === "bySeparation";
    const routeVis: "visible" | "none" = showRouteLines ? "visible" : "none";
    const routeColor: any =
      showBySpeed || showBySeparation ? "#6b7280" : ["get", "route_color"];

    try {
      for (const id of [
        "routes-outline",
        "routes",
        "routes-construction-outline",
        "routes-construction",
        "routes-tunnel-outline",
        "routes-tunnel",
      ]) {
        if (map.current.getLayer(id)) {
          map.current.setLayoutProperty(id, "visibility", routeVis);
        }
      }

      for (const id of ["routes", "routes-construction", "routes-tunnel"]) {
        if (map.current.getLayer(id)) {
          map.current.setPaintProperty(id, "line-color", routeColor);
        }
      }

      for (const id of [
        "speed-limit-outline",
        "speed-limit",
        "speed-limit-labels",
      ]) {
        if (map.current.getLayer(id)) {
          map.current.setLayoutProperty(
            id,
            "visibility",
            showBySpeed ? "visible" : "none",
          );
        }
      }

      for (const id of ["separation-outline", "separation"]) {
        if (map.current.getLayer(id)) {
          map.current.setLayoutProperty(
            id,
            "visibility",
            showBySeparation ? "visible" : "none",
          );
        }
      }
    } catch {
      // Layers might not exist yet
    }
  }, [mapLoaded, showRouteLines, routeLineMode]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    try {
      for (const id of [
        "routes-outline",
        "routes",
        "routes-construction-outline",
        "routes-construction",
        "routes-tunnel-outline",
        "routes-tunnel",
      ]) {
        if (map.current.getLayer(id)) {
          map.current.setFilter(id, routeLayerFilter);
        }
      }
    } catch {
      // Layers might not exist yet
    }
  }, [mapLoaded, routeLayerFilter]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    try {
      for (const id of [
        "speed-limit-outline",
        "speed-limit",
        "speed-limit-labels",
      ]) {
        if (map.current.getLayer(id)) {
          map.current.setFilter(id, speedLimitLayerFilter);
        }
      }
    } catch {
      // Layers might not exist yet
    }
  }, [mapLoaded, speedLimitLayerFilter]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getSource("separation")) return;
    if (routeLineMode !== "bySeparation") return;

    const selectedRoutes = {
      ...cityConfig.routes,
      features: cityConfig.routes.features.filter((feature: any) => {
        const routeId = String(feature.properties?.route_id ?? "");
        if (selectedLines.includes(routeId)) return true;
        if (
          city === "Pittsburgh" &&
          routeId === "shared" &&
          selectedLines.some((line) => ["RED", "BLUE", "SLVR"].includes(line))
        ) {
          return true;
        }
        if (
          feature.properties?.lines &&
          Array.isArray(feature.properties.lines) &&
          feature.properties.lines.some((line: string) =>
            selectedLines.includes(line),
          )
        ) {
          return true;
        }
        return false;
      }),
    };

    const filteredSeparation = filterSeparationByRoutes(
      cityConfig.separation,
      selectedRoutes,
      city,
    );

    try {
      (map.current.getSource("separation") as any).setData(
        filteredSeparation?.features?.length > 0
          ? filteredSeparation
          : { type: "FeatureCollection", features: [] },
      );
    } catch {
      // Source might have been removed externally
    }
  }, [
    mapLoaded,
    routeLineMode,
    city,
    cityConfig.routes,
    cityConfig.separation,
    selectedLines,
  ]);

  // Keep rail-context / bus-overlay layer visibility in sync with toggle state
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
      if (map.current.getLayer("bus-routes-overlay")) {
        map.current.setLayoutProperty(
          "bus-routes-overlay",
          "visibility",
          showBusRoutesOverlay ? "visible" : "none",
        );
      }
      if (map.current.getLayer("bus-routes-overlay-labels")) {
        map.current.setLayoutProperty(
          "bus-routes-overlay-labels",
          "visibility",
          showBusRoutesOverlay ? "visible" : "none",
        );
      }
    } catch {
      // Layers might not exist yet
    }
  }, [
    mapLoaded,
    showRailContextHeavy,
    showRailContextCommuter,
    showBusRoutesOverlay,
  ]);

  // Traffic lights filtering
  const filteredTrafficLights = useMemo(() => {
    if (!cityConfig.trafficLights?.features) {
      return { type: "FeatureCollection" as const, features: [] };
    }

    const filtered = cityConfig.trafficLights.features.filter(
      (feature: any) => {
        const routes = feature.properties?.routes || [];
        return routes.some((route: string) => selectedLines.includes(route));
      },
    );

    return {
      type: "FeatureCollection" as const,
      features: filtered,
    };
  }, [cityConfig.trafficLights, selectedLines]);

  // Add/update stops layer with clustering by name
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const addStopsAndTrafficLightsLayers = () => {
      if (!map.current) return;

      // === STOPS LAYER ===
      // Filter clustered stops to selected lines
      const filterByLines = (features: any[]) => {
        if (selectedLines.length === 0) return [];
        return features.filter((f: any) => {
          const routes = f.properties?.routes;
          if (!routes || !Array.isArray(routes) || routes.length === 0)
            return true;
          if (city === "LA") {
            // LA stops may use GTFS route codes while user-facing line logic can reference letters.
            const laAliases = new Set<string>();
            for (const route of routes) {
              const routeId = String(route);
              laAliases.add(routeId);
              const lineInfo =
                LA_METRO_LINE_INFO[routeId as keyof typeof LA_METRO_LINE_INFO];
              if (lineInfo?.letter) laAliases.add(lineInfo.letter);
            }
            return selectedLines.some((line) => laAliases.has(String(line)));
          }
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
          if (isTouchInteractionMode()) return;
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

      // === TRAFFIC LIGHTS LAYER ===
      // Add traffic lights layer right after stops to ensure same z-order level
      const existingTrafficLightsSource = map.current.getSource(
        "traffic-lights",
      ) as maplibregl.GeoJSONSource;

      if (existingTrafficLightsSource) {
        existingTrafficLightsSource.setData(filteredTrafficLights as any);
        map.current.setLayoutProperty(
          "traffic-lights",
          "visibility",
          showTrafficLights ? "visible" : "none",
        );
      } else {
        map.current.addSource("traffic-lights", {
          type: "geojson",
          data: filteredTrafficLights as any,
        });

        if (!map.current.hasImage("traffic-light-emoji")) {
          const size = 128;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { alpha: true });
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.font = `${size - 20}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
            ctx.fillText("🚦", size / 2, size * 0.75);
            map.current.addImage("traffic-light-emoji", {
              width: size,
              height: size,
              data: ctx.getImageData(0, 0, size, size).data,
            });
          }
        }

        map.current.addLayer({
          id: "traffic-lights",
          type: "symbol",
          source: "traffic-lights",
          layout: {
            visibility: showTrafficLights ? "visible" : "none",
            "icon-image": "traffic-light-emoji",
            "icon-size": 0.18,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });

        map.current.on("mouseenter", "traffic-lights", () => {
          if (map.current) map.current.getCanvas().style.cursor = "pointer";
        });

        map.current.on("mouseleave", "traffic-lights", () => {
          if (map.current) map.current.getCanvas().style.cursor = "";
          if (!crossingPopupPinned.current) {
            popup.current?.remove();
          }
        });

        map.current.on("mousemove", "traffic-lights", (e) => {
          if (crossingPopupPinned.current) return;
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
                <div class="popup-title">Traffic Light 🚦</div>
                <div class="popup-coords">${lat}, ${lon}</div>
              </div>`,
            )
            .addTo(map.current);
        });

        map.current.on("click", "traffic-lights", (e) => {
          if (isTouchInteractionMode()) return;
          if (!e.features?.length || !map.current) return;

          const feature = e.features[0];
          const coords =
            feature.geometry.type === "Point"
              ? (feature.geometry as GeoJSON.Point).coordinates
              : null;
          const lon = coords ? coords[0].toFixed(6) : "N/A";
          const lat = coords ? coords[1].toFixed(6) : "N/A";

          crossingPopupPinned.current = true;
          suppressNextMapClickUnpin.current = true;

          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content popup-pinned">
                <div class="popup-title">Traffic Light 🚦 📌</div>
                <div class="popup-coords">${lat}, ${lon}</div>
                <div class="popup-hint">Click elsewhere to close</div>
              </div>`,
            )
            .addTo(map.current);

          e.originalEvent.stopPropagation();
        });
      }
    };

    // If style is already loaded, add layers immediately
    // Otherwise, wait for it with a small delay
    if (map.current.isStyleLoaded()) {
      addStopsAndTrafficLightsLayers();
    } else {
      const waitForStyle = () => {
        if (!map.current) return;
        if (map.current.isStyleLoaded()) {
          addStopsAndTrafficLightsLayers();
        } else {
          setTimeout(waitForStyle, 50);
        }
      };
      setTimeout(waitForStyle, 50);
    }
  }, [
    mapLoaded,
    showStops,
    showTrafficLights,
    selectedLines,
    clusteredStops,
    expandedStopCluster,
    filteredTrafficLights,
  ]);

  // Show all grade crossings regardless of selected lines
  // Filter grade crossings by selected lines
  // Note: F-line only crossings are already filtered out during the fetch script
  const filteredCrossings = useMemo(() => {
    if (!showCrossings) {
      return { ...cityConfig.crossings, features: [] };
    }
    // Each crossing has a 'routes' property listing which transit lines it's near
    // For OSM-sourced cities without routes property, filter by proximity to route lines
    const nearbyFeatures = cityConfig.crossings.features.filter(
      (crossing: any) => {
        const nearRoutes: string[] = crossing.properties.routes;
        // If has routes property, check if any of those routes are selected
        // Skip "default" routes - fall through to proximity-based filtering
        if (nearRoutes && !nearRoutes.includes("default")) {
          return nearRoutes.some((route: string) =>
            selectedLines.includes(route),
          );
        }

        // For OSM-sourced cities, check if crossing is within 50m of any selected route line
        const [lon, lat] = crossing.geometry.coordinates;
        const maxDistanceMeters = 50;

        for (const feature of cityConfig.routes.features) {
          const routeId = feature.properties?.route_id;
          // Only check routes that are selected
          if (!selectedLines.includes(routeId)) continue;

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
  }, [cityConfig.crossings, cityConfig.routes, selectedLines, showCrossings]);

  // Add/update crossings layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // All crossings use orange (gated vs non-gated distinction disabled - data too inconsistent)
    const crossingColor = "#ff9500";

    // Check if source already exists - if so, just update data (fast path)
    const existingSource = map.current.getSource(
      "crossings",
    ) as maplibregl.GeoJSONSource;

    if (existingSource) {
      // Fast path: source exists, just update data immediately
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
      return; // Exit early - no need to check style or create layers
    }

    // Slow path: first time setup - need to create source and layer
    const addCrossingsLayer = () => {
      if (!map.current) return;
      if (map.current.getSource("crossings")) return;

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
              ? ""
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
          if (isTouchInteractionMode()) return;
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
              ? ""
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
          if (suppressNextMapClickUnpin.current) {
            suppressNextMapClickUnpin.current = false;
            return;
          }

          if (isTouchInteractionMode()) {
            const vehicleFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["vehicles"],
              },
            );
            if (vehicleFeatures && vehicleFeatures.length > 0) return;

            const segmentFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["speed-segments"],
              },
            );
            if (segmentFeatures && segmentFeatures.length > 0) return;

            const densityFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["population-density-fill"],
              },
            );
            if (densityFeatures && densityFeatures.length > 0) return;
          } else {
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

            // Check if click was on a traffic light (handled in traffic lights layer)
            const trafficLightFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["traffic-lights"],
              },
            );
            if (trafficLightFeatures && trafficLightFeatures.length > 0) return;

            // Check if click was on a switch (handled in switches layer)
            const switchFeatures = map.current?.queryRenderedFeatures(e.point, {
              layers: ["switches"],
            });
            if (switchFeatures && switchFeatures.length > 0) return;

            const vehicleFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["vehicles"],
              },
            );
            if (vehicleFeatures && vehicleFeatures.length > 0) return;

            const segmentFeatures = map.current?.queryRenderedFeatures(
              e.point,
              {
                layers: ["speed-segments"],
              },
            );
            if (segmentFeatures && segmentFeatures.length > 0) return;
          }

          // Unpin and remove popup
          crossingPopupPinned.current = false;
          touchPopupPinned.current = false;
          popup.current?.remove();

          // Collapse any expanded stop cluster
          setExpandedStopCluster(null);
        });
      }
    };

    // Only wait for style on first setup
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

  // Get switches and signals data for current city, filtered by selected lines
  const switchesData = useMemo(() => {
    const rawSwitches = cityConfig.switches || {
      type: "FeatureCollection",
      features: [],
    };

    if (!showSwitches) {
      return { ...rawSwitches, features: [] };
    }

    // Filter switches to only those near selected route lines
    const filteredFeatures = rawSwitches.features.filter((sw: any) => {
      // If switch has pre-computed routes property, use it for fast filtering
      const switchRoutes = sw.properties?.routes;
      if (
        switchRoutes &&
        Array.isArray(switchRoutes) &&
        switchRoutes.length > 0
      ) {
        // Fast path: use pre-computed routes
        return switchRoutes.some((route: string) =>
          selectedLines.includes(route),
        );
      }

      // Fallback: check proximity to selected route lines (only for switches without routes property)
      const [lon, lat] = sw.geometry.coordinates;
      const maxDistanceMeters = 50;

      for (const feature of cityConfig.routes.features) {
        const routeId = feature.properties?.route_id;
        // Only check routes that are selected
        if (!selectedLines.includes(routeId)) continue;

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
  }, [cityConfig.switches, selectedLines, showSwitches]);

  // Add/update switches layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Check if source already exists - if so, just update data (fast path)
    const existingSource = map.current.getSource(
      "switches",
    ) as maplibregl.GeoJSONSource;

    if (existingSource) {
      // Fast path: source exists, just update data immediately
      existingSource.setData(switchesData as any);
      map.current.setLayoutProperty(
        "switches",
        "visibility",
        showSwitches ? "visible" : "none",
      );
      return; // Exit early - no need to check style or create layers
    }

    // Slow path: first time setup - need to create source and layer
    const addSwitchesLayer = () => {
      if (!map.current) return;
      if (map.current.getSource("switches")) return;

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
        // Don't update popup if it's pinned
        if (crossingPopupPinned.current) return;
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

      // Click to pin the popup
      map.current.on("click", "switches", (e) => {
        if (isTouchInteractionMode()) return;
        if (!e.features?.length || !map.current) return;

        const feature = e.features[0];
        const coords =
          feature.geometry.type === "Point"
            ? (feature.geometry as GeoJSON.Point).coordinates
            : null;
        const lon = coords ? coords[0].toFixed(6) : "N/A";
        const lat = coords ? coords[1].toFixed(6) : "N/A";

        crossingPopupPinned.current = true;

        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content popup-pinned">
                <div class="popup-title">⚡ Track Switch 📌</div>
                <div class="popup-coords">${lat}, ${lon}</div>
                <div class="popup-hint">Click elsewhere to close</div>
              </div>`,
          )
          .addTo(map.current);

        // Prevent the click from propagating to the map
        e.originalEvent.stopPropagation();
      });
    };

    // Only wait for style on first setup
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

      const vehicleGeoJSON =
        viewMode === "live" ? cachedLiveVehicleGeoJSON : cachedVehicleGeoJSON;

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

        // If hideAllTrains is enabled, hide everything
        if (hideAllTrains) {
          initialFilters.push(["==", ["get", "speed"], -9999]); // Impossible condition to hide all
        } else {
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
        }
        const initialFilter = [
          "all",
          vehicleRouteFilter as maplibregl.ExpressionSpecification,
          ...initialFilters,
        ] as maplibregl.FilterSpecification;

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
          if (!crossingPopupPinned.current && !touchPopupPinned.current) {
            popup.current?.remove();
          }
        });

        const showVehiclePopup = (
          e: maplibregl.MapLayerMouseEvent,
          pinned = false,
        ) => {
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
              `<div class="popup-content${pinned ? " popup-pinned" : ""}">
                <div class="popup-title">${titleLine}</div>
                <div class="popup-detail">${detailLine}</div>
                <div class="popup-speed">${speed}</div>
                <div class="popup-time">${dateTime}</div>
                ${
                  pinned
                    ? '<div class="popup-hint">Tap elsewhere to close</div>'
                    : ""
                }
              </div>`,
            )
            .addTo(map.current);
        };

        map.current.on("mousemove", "vehicles", (e) => {
          if (isTouchInteractionMode() && touchPopupPinned.current) return;
          showVehiclePopup(e);
        });

        map.current.on("click", "vehicles", (e) => {
          if (!e.features?.length) return;
          if (!isTouchInteractionMode()) return;
          touchPopupPinned.current = true;
          showVehiclePopup(e, true);
          e.originalEvent.stopPropagation();
        });
      }
    };

    // Function to wait for map to finish rendering (both CPU and GPU)
    const waitForIdle = () => {
      if (!map.current) return;

      let longTasksDone = false;
      let mapIdle = false;
      let finished = false;

      // EXPERIMENTAL: Monitor render events to detect when rendering truly stops
      let lastRenderTime = performance.now();
      let renderStopped = false;
      const onRender = () => {
        lastRenderTime = performance.now();
      };
      map.current.on("render", onRender);

      const renderCheckInterval = setInterval(() => {
        const timeSinceLastRender = performance.now() - lastRenderTime;
        if (timeSinceLastRender > 1000 && !renderStopped) {
          renderStopped = true;
          clearInterval(renderCheckInterval);
          map.current?.off("render", onRender);
        }
      }, 500);

      const tryFinish = () => {
        if (finished) return;
        if (longTasksDone && mapIdle) {
          finished = true;
          setLoadingProgress("");
          setIsProcessing(false);
          // Notify parent that map is ready
          onMapReady?.();
        }
      };

      // Wait for JS long tasks to finish (CPU work)
      waitForNoLongTasks(2000).then(() => {
        longTasksDone = true;
        tryFinish();
      });

      // Wait for MapLibre to finish rendering (GPU work)
      map.current.once("idle", () => {
        mapIdle = true;
        tryFinish();
      });

      // Safety fallback timeout (60s) in case something goes wrong
      setTimeout(() => {
        if (!finished) {
          finished = true;
          setLoadingProgress("");
          setIsProcessing(false);
        }
        // Clean up render monitoring
        clearInterval(renderCheckInterval);
        map.current?.off("render", onRender);
      }, 60000);
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
    cachedVehicleGeoJSON,
    cachedLiveVehicleGeoJSON,
    viewMode,
    mapLoaded,
    isProcessing,
  ]);

  // Update speed filter
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getLayer("vehicles")) return;

    const filters: maplibregl.ExpressionSpecification[] = [];

    // If hideAllTrains is enabled, hide everything
    if (hideAllTrains) {
      filters.push(["==", ["get", "speed"], -9999]); // Impossible condition to hide all
    } else {
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
    }

    const filterExpression = [
      "all",
      vehicleRouteFilter as maplibregl.ExpressionSpecification,
      ...filters,
    ] as maplibregl.FilterSpecification;

    map.current.setFilter("vehicles", filterExpression);
    map.current.setFilter("vehicles-glow", filterExpression);
  }, [
    speedFilter,
    hideStoppedTrains,
    hideAllTrains,
    mapLoaded,
    vehicleRouteFilter,
  ]);

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
      "traffic-lights",
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

    // Swap vehicle source data only when transitioning to/from live mode
    const source = map.current.getSource(
      "vehicles",
    ) as maplibregl.GeoJSONSource;
    if (source) {
      if (viewMode === "live") {
        source.setData(cachedLiveVehicleGeoJSON);
      } else if (prevViewMode.current === "live") {
        source.setData(cachedVehicleGeoJSON);
      }
    }
    prevViewMode.current = viewMode;

    const showSegments = viewMode === "segments" || viewMode === "segments-500";
    if (showSegments) {
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
  }, [viewMode, cachedVehicleGeoJSON, cachedLiveVehicleGeoJSON, mapLoaded]);

  // Memoized segment averages — computed from ALL readings (no speed filter).
  // Speed filtering happens in the display effect, which hides whole segments by average.
  const cachedSegmentAverages = useMemo(() => {
    if (hideAllTrains) {
      return new Map();
    }

    const segmentSpeeds: Map<string, number[]> = new Map();

    vehicles.forEach((v) => {
      if (v.speed == null) return;
      if (hideStoppedTrains && v.speed < 0.5) return;
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

    if (city && CITIES_WITH_PARALLEL_TRACKS.includes(city)) {
      allRouteSegments.forEach((seg) => {
        if (!seg.referenceSegmentId) return;
        const refAverage = segmentAverages.get(seg.referenceSegmentId);
        if (refAverage) {
          segmentAverages.set(seg.segmentId, refAverage);
        }
      });
    }

    return segmentAverages;
  }, [vehicles, hideStoppedTrains, hideAllTrains, city, allRouteSegments]);

  const cachedSegmentAverages500 = useMemo(() => {
    if (hideAllTrains) {
      return new Map();
    }

    const segmentSpeeds: Map<string, number[]> = new Map();

    vehicles.forEach((v) => {
      if (v.speed == null) return;
      if (hideStoppedTrains && v.speed < 0.5) return;
      if (!v.segmentId500) return;

      if (!segmentSpeeds.has(v.segmentId500)) {
        segmentSpeeds.set(v.segmentId500, []);
      }
      segmentSpeeds.get(v.segmentId500)!.push(v.speed);
    });

    const segmentAverages: Map<string, { avg: number; count: number }> =
      new Map();
    segmentSpeeds.forEach((speeds, segmentId) => {
      const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      segmentAverages.set(segmentId, { avg, count: speeds.length });
    });

    if (city && CITIES_WITH_PARALLEL_TRACKS.includes(city)) {
      allRouteSegments500.forEach((seg) => {
        if (!seg.referenceSegmentId) return;
        const refAverage = segmentAverages.get(seg.referenceSegmentId);
        if (refAverage) {
          segmentAverages.set(seg.segmentId, refAverage);
        }
      });
    }

    return segmentAverages;
  }, [vehicles, hideStoppedTrains, hideAllTrains, city, allRouteSegments500]);

  // Display effect for segments - uses cached averages, only re-runs when selectedLines changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (viewMode !== "segments" && viewMode !== "segments-500") return;

    const activeSegments =
      viewMode === "segments-500" ? allRouteSegments500 : allRouteSegments;
    const activeAverages =
      viewMode === "segments-500"
        ? cachedSegmentAverages500
        : cachedSegmentAverages;

    const segmentFeatures = activeSegments
      .filter((seg) => activeAverages.has(seg.segmentId))
      .filter((seg) => {
        if (hideStoppedTrains) {
          const data = activeAverages.get(seg.segmentId);
          if (!data || data.avg < 0.5) return false;
        }
        const data = activeAverages.get(seg.segmentId);
        if (!data) return false;
        if (data.avg < speedFilter.minSpeed) return false;
        if (speedFilter.maxSpeed < 50 && data.avg > speedFilter.maxSpeed)
          return false;
        return true;
      })
      .map((seg) => {
        const data = activeAverages.get(seg.segmentId)!;
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
          filter: segmentLayerFilter,
          layout: {
            "line-join": "round",
            "line-cap": ["step", ["zoom"], "round", 11, "butt"],
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
        if (!crossingPopupPinned.current && !touchPopupPinned.current) {
          popup.current?.remove();
        }
      });

      const showSegmentPopup = (
        e: maplibregl.MapLayerMouseEvent,
        pinned = false,
      ) => {
        if (!e.features?.length || !map.current) return;
        const props = e.features[0].properties;

        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content${pinned ? " popup-pinned" : ""}">
              <div class="popup-title">${props.routeId} Segment</div>
              <div class="popup-speed">${formatAvgSpeedFromRef(props.avgSpeed)} avg</div>
              <div class="popup-detail">${props.sampleCount} readings</div>
              ${
                pinned
                  ? '<div class="popup-hint">Tap elsewhere to close</div>'
                  : ""
              }
            </div>`,
          )
          .addTo(map.current);
      };

      map.current.on("mousemove", "speed-segments", (e) => {
        if (isTouchInteractionMode() && touchPopupPinned.current) return;
        showSegmentPopup(e);
      });

      map.current.on("click", "speed-segments", (e) => {
        if (!isTouchInteractionMode() || !e.features?.length) return;
        touchPopupPinned.current = true;
        showSegmentPopup(e, true);
        e.originalEvent.stopPropagation();
      });
    }
  }, [
    cachedSegmentAverages,
    cachedSegmentAverages500,
    speedFilter,
    hideStoppedTrains,
    viewMode,
    mapLoaded,
    allRouteSegments,
    allRouteSegments500,
    city,
  ]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getLayer("speed-segments")) return;

    try {
      map.current.setFilter("speed-segments", segmentLayerFilter);
    } catch {
      // Layer might not exist yet
    }
  }, [mapLoaded, segmentLayerFilter]);

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

  // Toggle population density layer (using US Census tract data)
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const hideDensityLayers = () => {
      if (!map.current) return;
      if (map.current.getLayer("population-density-fill")) {
        map.current.setLayoutProperty(
          "population-density-fill",
          "visibility",
          "none",
        );
      }
      if (map.current.getLayer("population-density-outline")) {
        map.current.setLayoutProperty(
          "population-density-outline",
          "visibility",
          "none",
        );
      }
      if (map.current.getLayer("population-density-hover")) {
        map.current.setLayoutProperty(
          "population-density-hover",
          "visibility",
          "none",
        );
      }
    };

    if (!showPopulationDensity) {
      hideDensityLayers();
      return;
    }

    let cancelled = false;

    loadPopulationDensity(city).then((rawData) => {
      if (cancelled || !map.current || !rawData) return;

      try {
        const processedData = {
          ...rawData,
          features: rawData.features.map((f: any) => ({
            ...f,
            properties: {
              ...f.properties,
              density:
                f.properties.AREALAND > 0
                  ? Math.round(
                      f.properties.POP100 / (f.properties.AREALAND / 1000000),
                    )
                  : 0,
            },
          })),
        };

        const existingSource = map.current.getSource(
          "census-tracts",
        ) as maplibregl.GeoJSONSource;
        if (existingSource) {
          existingSource.setData(processedData as any);
        } else {
          // Create source and layers for the first time
          map.current.addSource("census-tracts", {
            type: "geojson",
            data: processedData as any,
            promoteId: "GEOID", // Use GEOID as feature ID for fast feature-state updates
          });

          // Add fill layer with density-based coloring
          map.current.addLayer(
            {
              id: "population-density-fill",
              type: "fill",
              source: "census-tracts",
              paint: {
                "fill-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "density"],
                  0,
                  "#0f1724", // Very dark slate - still visibly covered at near-zero density
                  250,
                  "#132434", // Sparse rural coverage
                  1000,
                  "#1a3a4a", // Dark blue-grey - rural/industrial
                  2500,
                  "#2a5a5a", // Teal-grey - low density suburban
                  5000,
                  "#3a7a6a", // Muted teal - suburban
                  8000,
                  "#5a9a5a", // Green - light urban
                  12000,
                  "#aacc44", // Lime - urban
                  18000,
                  "#ffcc00", // Bright yellow - dense urban
                  28000,
                  "#ff6600", // Bright orange - very dense
                  45000,
                  "#ff0066", // Hot pink - extremely dense
                ],
                "fill-opacity": [
                  "interpolate",
                  ["linear"],
                  ["get", "density"],
                  0,
                  0.82,
                  1000,
                  0.76,
                  5000,
                  0.68,
                  12000,
                  0.62,
                  45000,
                  0.58,
                ],
              },
              layout: {
                visibility: "none",
              },
            },
            "routes", // Insert below routes layer
          );

          // Add subtle outline for tract boundaries
          map.current.addLayer(
            {
              id: "population-density-outline",
              type: "line",
              source: "census-tracts",
              paint: {
                "line-color": "rgba(255, 255, 255, 0.15)",
                "line-width": 0.5,
              },
              layout: {
                visibility: "none",
              },
            },
            "routes",
          );

          // Add hover highlight layer (uses feature-state for fast O(1) updates)
          map.current.addLayer(
            {
              id: "population-density-hover",
              type: "line",
              source: "census-tracts",
              paint: {
                "line-color": "#ffffff",
                "line-width": [
                  "case",
                  ["boolean", ["feature-state", "hover"], false],
                  2,
                  0,
                ],
                "line-opacity": 0.8,
              },
              layout: {
                visibility: "none",
              },
            },
            "routes",
          );

          // Hover handlers for density layer
          map.current.on("mouseenter", "population-density-fill", () => {
            if (map.current) map.current.getCanvas().style.cursor = "pointer";
          });

          map.current.on("mouseleave", "population-density-fill", () => {
            if (map.current) {
              map.current.getCanvas().style.cursor = "";
              // Clear hover state on previous tract
              if (hoveredTractId.current) {
                map.current.setFeatureState(
                  { source: "census-tracts", id: hoveredTractId.current },
                  { hover: false },
                );
                hoveredTractId.current = null;
              }
            }
            popup.current?.remove();
          });

          const showDensityPopup = (e: maplibregl.MapLayerMouseEvent) => {
            if (!e.features?.length || !map.current) return;
            const props = e.features[0].properties;
            const geoid = String(props.GEOID || "");
            const newTractId = geoid;

            if (newTractId !== hoveredTractId.current) {
              if (hoveredTractId.current) {
                map.current.setFeatureState(
                  { source: "census-tracts", id: hoveredTractId.current },
                  { hover: false },
                );
              }
              hoveredTractId.current = newTractId;
              map.current.setFeatureState(
                { source: "census-tracts", id: newTractId },
                { hover: true },
              );
            }

            const density = props.density || 0;
            const population = props.POP100 || 0;
            const areaLabel = getPopulationDensityAreaLabel(city, geoid);
            const tractLabel = getPopulationDensityTractLabel(city, geoid);
            const placeLine = areaLabel
              ? `<div class="popup-meta-line">${escapeHtml(areaLabel)}</div>`
              : "";
            const tractLine = tractLabel
              ? `<div class="popup-meta-line">Tract: ${escapeHtml(tractLabel)}</div>`
              : "";

            const getDensityColor = (d: number): string => {
              if (d >= 45000) return "#ff0066";
              if (d >= 28000) return "#ff6600";
              if (d >= 18000) return "#ffcc00";
              if (d >= 12000) return "#aacc44";
              if (d >= 8000) return "#5a9a5a";
              if (d >= 5000) return "#3a7a6a";
              return "#2a5a5a";
            };
            const densityColor = getDensityColor(density);

            popup.current
              ?.setLngLat(e.lngLat)
              .setHTML(
                `<div class="popup-content density-popup">
                <div class="popup-density">
                  <span class="density-value" style="color: ${densityColor}">${density.toLocaleString()}</span>
                  <span class="density-unit">people/km²</span>
                </div>
                <div class="popup-population">Population: ${population.toLocaleString()}</div>
                <div class="popup-meta">
                  ${placeLine}
                  ${tractLine}
                </div>
              </div>`,
              )
              .addTo(map.current);
          };

          map.current.on(
            "mousemove",
            "population-density-fill",
            showDensityPopup,
          );
          map.current.on("click", "population-density-fill", showDensityPopup);
        } // end of else block (first-time layer creation)

        // Toggle visibility and adjust opacity for satellite overlay
        const isVisible = showPopulationDensity ? "visible" : "none";
        const fillOpacityMultiplier = showSatellite ? 0.7 : 1;

        if (map.current.getLayer("population-density-fill")) {
          map.current.setLayoutProperty(
            "population-density-fill",
            "visibility",
            isVisible,
          );
          map.current.setPaintProperty(
            "population-density-fill",
            "fill-opacity",
            [
              "interpolate",
              ["linear"],
              ["get", "density"],
              0,
              0.82 * fillOpacityMultiplier,
              1000,
              0.76 * fillOpacityMultiplier,
              5000,
              0.68 * fillOpacityMultiplier,
              12000,
              0.62 * fillOpacityMultiplier,
              45000,
              0.58 * fillOpacityMultiplier,
            ],
          );
        }
        if (map.current.getLayer("population-density-outline")) {
          map.current.setLayoutProperty(
            "population-density-outline",
            "visibility",
            isVisible,
          );
        }
        if (map.current.getLayer("population-density-hover")) {
          map.current.setLayoutProperty(
            "population-density-hover",
            "visibility",
            isVisible,
          );
        }
      } catch (e) {
        console.error("Error setting up population density layer:", e);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mapLoaded, showPopulationDensity, showSatellite, city]);

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

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />

      <div
        className={`map-legends-group ${showMobileLegends ? "mobile-expanded" : ""}`}
      >
        <SpeedLegend speedUnit={speedUnit} />

        {showRouteLines && routeLineMode === "bySeparation" && (
          <SeparationLegend />
        )}

        {showPopulationDensity && <DensityLegend />}

        <DynamicLegends
          city={city}
          showCrossings={showCrossings}
          showRailContextHeavy={showRailContextHeavy}
          showRailContextCommuter={showRailContextCommuter}
          showBusRoutesOverlay={showBusRoutesOverlay}
        />
      </div>

      <button
        className="mobile-legend-toggle"
        onClick={() => setShowMobileLegends(!showMobileLegends)}
        aria-label={showMobileLegends ? "Hide legend" : "Show legend"}
      >
        {showMobileLegends ? "▾ Legend" : "▴ Legend"}
      </button>

      <LayerSelector
        showSatellite={showSatellite}
        showPopulationDensity={showPopulationDensity ?? false}
        onSatelliteToggle={onSatelliteToggle}
        onPopulationDensityToggle={onPopulationDensityToggle}
      />

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
