import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MuniLine } from '../types';
import { supabase } from '../lib/supabase';
import muniRoutes from '../data/muniMetroRoutes.json';
import muniStops from '../data/muniMetroStops.json';
import type { SpeedFilter, ViewMode } from '../App';

// Maximum distance in meters from route line to be considered "on route"
const MAX_DISTANCE_FROM_ROUTE_METERS = 100;

// Haversine distance between two points in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate minimum distance from a point to a line segment
function distanceToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  if (dx === 0 && dy === 0) {
    // Segment is a point
    return haversineDistance(py, px, y1, x1);
  }
  
  // Project point onto line segment
  const t = Math.max(0, Math.min(1, 
    ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
  ));
  
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  
  return haversineDistance(py, px, nearestY, nearestX);
}

// Calculate minimum distance from a point to a LineString (array of coordinates)
function distanceToLineString(lat: number, lon: number, coordinates: number[][]): number {
  let minDistance = Infinity;
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];     // [lon, lat]
    const [x2, y2] = coordinates[i + 1]; // [lon, lat]
    
    const dist = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  
  return minDistance;
}

// Build a map of route_id -> array of LineString coordinates (both directions)
function buildRouteGeometryMap(): Map<string, number[][][]> {
  const routeMap = new Map<string, number[][][]>();
  
  muniRoutes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const coordinates = feature.geometry.coordinates;
    
    if (!routeMap.has(routeId)) {
      routeMap.set(routeId, []);
    }
    routeMap.get(routeId)!.push(coordinates);
  });
  
  return routeMap;
}

// Check if a point is within the threshold distance of its route
function isOnRoute(
  lat: number, 
  lon: number, 
  routeId: string, 
  routeGeometryMap: Map<string, number[][][]>
): boolean {
  const routeLines = routeGeometryMap.get(routeId);
  if (!routeLines) return true; // If no route geometry, include by default
  
  // Check distance to both directions of the route
  for (const lineCoords of routeLines) {
    const distance = distanceToLineString(lat, lon, lineCoords);
    if (distance <= MAX_DISTANCE_FROM_ROUTE_METERS) {
      return true;
    }
  }
  
  return false;
}

// Pre-build the route geometry map (done once at module load)
const routeGeometryMap = buildRouteGeometryMap();

// Segment size in meters
const SEGMENT_SIZE_METERS = 100;

// Calculate distance along a LineString to the nearest point
function findNearestPointOnLine(lat: number, lon: number, coordinates: number[][]): { 
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
      // Approximate position along segment
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = (dx === 0 && dy === 0) ? 0 : 
        Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
      bestDistanceAlong = distanceAlong + t * segmentLength;
    }
    
    distanceAlong += segmentLength;
  }
  
  // Calculate total length
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    totalLength += haversineDistance(y1, x1, y2, x2);
  }
  
  return { distance: minDistance, distanceAlong: bestDistanceAlong, totalLength };
}

// Create segments along a LineString, preserving all intermediate coordinates
function createSegments(coordinates: number[][], routeId: string, direction: string): {
  segmentId: string;
  coords: number[][];  // All coordinates for this segment (preserves curves)
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
    
    let edgeStart = 0;
    
    // Check if we cross one or more segment boundaries on this edge
    while (distanceAlong + edgeLength >= (segmentIndex + 1) * SEGMENT_SIZE_METERS) {
      // Calculate the point where we cross the boundary
      const boundaryDistance = (segmentIndex + 1) * SEGMENT_SIZE_METERS;
      const distanceIntoBoundary = boundaryDistance - distanceAlong;
      const t = distanceIntoBoundary / edgeLength;
      const crossX = x1 + t * (x2 - x1);
      const crossY = y1 + t * (y2 - y1);
      
      // Complete this segment
      currentSegmentCoords.push([crossX, crossY]);
      
      segments.push({
        segmentId: `${routeId}_${direction}_${segmentIndex}`,
        coords: [...currentSegmentCoords],
        startDistance: segmentStartDistance,
        endDistance: boundaryDistance,
      });
      
      // Start new segment
      currentSegmentCoords = [[crossX, crossY]];
      segmentStartDistance = boundaryDistance;
      segmentIndex++;
      edgeStart = t;
    }
    
    // Add the end point of this edge to current segment (if not already there)
    if (i < coordinates.length - 2) {
      currentSegmentCoords.push(coordinates[i + 1]);
    }
    
    distanceAlong += edgeLength;
  }
  
  // Add final point and segment
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

// Build segment data from all routes
interface SegmentData {
  segmentId: string;
  routeId: string;
  direction: string;
  coordinates: number[][];  // Full geometry preserving curves
  startDistance: number;
  endDistance: number;
}

function buildAllSegments(): SegmentData[] {
  const allSegments: SegmentData[] = [];
  
  muniRoutes.features.forEach((feature: any) => {
    const routeId = feature.properties.route_id;
    const direction = feature.properties.direction_id === '0' ? 'outbound' : 'inbound';
    const coordinates = feature.geometry.coordinates;
    
    const segments = createSegments(coordinates, routeId, direction);
    
    segments.forEach(seg => {
      allSegments.push({
        segmentId: seg.segmentId,
        routeId,
        direction,
        coordinates: seg.coords,  // Use full coords array
        startDistance: seg.startDistance,
        endDistance: seg.endDistance,
      });
    });
  });
  
  return allSegments;
}

// Pre-build all segments
const allRouteSegments = buildAllSegments();

// Assign a vehicle to its segment
function findSegmentForVehicle(lat: number, lon: number, routeId: string): string | null {
  const routeFeatures = muniRoutes.features.filter(
    (f: any) => f.properties.route_id === routeId
  );
  
  let bestSegment: string | null = null;
  let minDistance = Infinity;
  
  for (const feature of routeFeatures) {
    const direction = (feature as any).properties.direction_id === '0' ? 'outbound' : 'inbound';
    const coordinates = (feature as any).geometry.coordinates;
    
    const result = findNearestPointOnLine(lat, lon, coordinates);
    
    if (result.distance < minDistance && result.distance <= MAX_DISTANCE_FROM_ROUTE_METERS) {
      minDistance = result.distance;
      const segmentIndex = Math.floor(result.distanceAlong / SEGMENT_SIZE_METERS);
      bestSegment = `${routeId}_${direction}_${segmentIndex}`;
    }
  }
  
  return bestSegment;
}

// Convert direction_id to human-readable direction
// Handles various formats: 0/1, "0"/"1", "IB"/"OB", "Inbound"/"Outbound"
function getDirection(directionId: any): string | undefined {
  if (directionId == null || directionId === '') return undefined;
  
  const dir = String(directionId).toLowerCase();
  
  if (dir === '0' || dir === 'ob' || dir === 'outbound') return 'Outbound';
  if (dir === '1' || dir === 'ib' || dir === 'inbound') return 'Inbound';
  
  // Log unexpected values for debugging
  console.log('Unknown direction_id:', directionId);
  return undefined;
}

interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  routeId: string;
  direction?: string;
  speed?: number;
  recordedAt: string;
  segmentId?: string;  // Pre-computed segment assignment
}

interface SpeedMapProps {
  selectedLines: MuniLine[];
  speedFilter: SpeedFilter;
  showRouteLines: boolean;
  showStops: boolean;
  viewMode: ViewMode;
  onVehicleUpdate?: (count: number, time: Date) => void;
}

export function SpeedMap({ selectedLines, speedFilter, showRouteLines, showStops, viewMode, onVehicleUpdate }: SpeedMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dataSource, setDataSource] = useState<'loading' | 'supabase' | 'none'>('loading');
  const [loadingProgress, setLoadingProgress] = useState<string>('');

  // Ref to avoid re-render loops with the callback
  const onVehicleUpdateRef = useRef(onVehicleUpdate);
  onVehicleUpdateRef.current = onVehicleUpdate;

  // Fetch vehicle positions from Supabase with pagination (data collected by the collector)
  const fetchVehiclesFromSupabase = useCallback(async () => {
    if (!supabase) {
      setDataSource('none');
      return;
    }

    try {
      // Fetch all data using pagination (Supabase default limit is 1000)
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;
      let hasMore = true;

      setLoadingProgress('Loading positions...');
      
      while (hasMore) {
        const { data, error } = await supabase
          .from('vehicle_positions')
          .select('*')
          .order('recorded_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (error) {
          console.error('Error fetching from Supabase:', error);
          break;
        }

        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
          setLoadingProgress(`Loading... ${allData.length.toLocaleString()} positions`);
        } else {
          hasMore = false;
        }

        // Safety limit to prevent infinite loops / browser overload
        if (allData.length >= 50000) {
          console.log('Reached 50k position limit');
          hasMore = false;
        }
      }

      setLoadingProgress('');
      console.log(`Fetched ${allData.length} positions from Supabase`);

      // Show ALL positions as individual points
      // Pre-compute segment assignments for performance
      console.time('Pre-computing segments');
      const allPositions: Vehicle[] = allData.map((row: any) => {
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
          segmentId: findSegmentForVehicle(lat, lon, routeId),  // Pre-compute once
        };
      });
      console.timeEnd('Pre-computing segments');

      setVehicles(allPositions);
      setDataSource('supabase');
      
      if (allPositions.length > 0) {
        const latestTime = new Date(allPositions[0].recordedAt);
        onVehicleUpdateRef.current?.(allPositions.length, latestTime);
      } else {
        onVehicleUpdateRef.current?.(0, new Date());
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      setDataSource('none');
    }
  }, []); // No dependencies - uses ref for callback

  // Fetch once on mount (no auto-refresh for historical data view)
  useEffect(() => {
    fetchVehiclesFromSupabase();
  }, [fetchVehiclesFromSupabase]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap &copy; CARTO',
          },
        },
        layers: [
          {
            id: 'carto-dark-layer',
            type: 'raster',
            source: 'carto-dark',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [-122.433, 37.767],
      zoom: 12.5,
      minZoom: 11,
      maxZoom: 18,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    popup.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Add routes layer when map loads
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Filter routes based on selection (empty = show nothing)
    const filteredRoutes = {
      ...muniRoutes,
      features: muniRoutes.features.filter(
        (f: any) => selectedLines.includes(f.properties.route_id)
      ),
    };

    // Remove existing layers
    if (map.current.getLayer('routes-outline')) map.current.removeLayer('routes-outline');
    if (map.current.getLayer('routes')) map.current.removeLayer('routes');
    if (map.current.getSource('routes')) map.current.removeSource('routes');

    // Add routes source
    map.current.addSource('routes', {
      type: 'geojson',
      data: filteredRoutes as any,
    });

    // Find the first data layer to insert routes below (routes should always be at bottom)
    // Priority: vehicles-glow (if exists), otherwise stops (if exists), otherwise top
    const firstDataLayer = map.current.getLayer('vehicles-glow') 
      ? 'vehicles-glow' 
      : map.current.getLayer('stops') 
        ? 'stops' 
        : undefined;

    // Route outline
    map.current.addLayer({
      id: 'routes-outline',
      type: 'line',
      source: 'routes',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
        'visibility': showRouteLines ? 'visible' : 'none',
      },
      paint: {
        'line-color': '#000',
        'line-width': 7,
        'line-opacity': 0.6,
      },
    }, firstDataLayer);

    // Route lines with their official colors
    map.current.addLayer({
      id: 'routes',
      type: 'line',
      source: 'routes',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
        'visibility': showRouteLines ? 'visible' : 'none',
      },
      paint: {
        'line-color': ['get', 'route_color'],
        'line-width': 4,
        'line-opacity': 0.9,
      },
    }, firstDataLayer);

    // Route hover
    map.current.on('mouseenter', 'routes', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mouseleave', 'routes', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
      popup.current?.remove();
    });

    map.current.on('mousemove', 'routes', (e) => {
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
  }, [mapLoaded, selectedLines, showRouteLines]);

  // Add/update stops layer (filtered by selected lines, always on top)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Filter stops to only show those serving selected lines
    // A stop is shown if ANY of its routes are in the selected lines
    const filteredStops = {
      ...muniStops,
      features: muniStops.features.filter((f: any) =>
        f.properties.routes.some((r: string) => selectedLines.includes(r as MuniLine))
      ),
    };

    // Check if stops source already exists
    const existingSource = map.current.getSource('stops') as maplibregl.GeoJSONSource;

    if (existingSource) {
      // Update data and visibility
      existingSource.setData(filteredStops as any);
      map.current.setLayoutProperty('stops', 'visibility', showStops ? 'visible' : 'none');
      map.current.setLayoutProperty('stops-label', 'visibility', showStops ? 'visible' : 'none');
    } else {
      // First time: create source and layers
      map.current.addSource('stops', {
        type: 'geojson',
        data: filteredStops as any,
      });

      // Stop markers (diamond shape) - added WITHOUT beforeId so they render ON TOP of everything
      map.current.addLayer({
        id: 'stops',
        type: 'symbol',
        source: 'stops',
        layout: {
          'visibility': showStops ? 'visible' : 'none',
          'text-field': '◆',
          'text-size': 20,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#333333',
          'text-halo-width': 2.5,
        },
      });

      // Stop labels (visible on zoom) - also on top
      map.current.addLayer({
        id: 'stops-label',
        type: 'symbol',
        source: 'stops',
        layout: {
          'visibility': showStops ? 'visible' : 'none',
          'text-field': ['get', 'stop_name'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
        minzoom: 14, // Only show labels when zoomed in
      });

      // Stop hover
      map.current.on('mouseenter', 'stops', () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', 'stops', () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
        popup.current?.remove();
      });

      map.current.on('mousemove', 'stops', (e) => {
        if (!e.features?.length || !map.current) return;
        const props = e.features[0].properties;
        const routes = JSON.parse(props.routes || '[]');
        
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title">${props.stop_name}</div>
              <div class="popup-detail">Lines: ${routes.join(', ')}</div>
            </div>`
          )
          .addTo(map.current);
      });
    }
  }, [mapLoaded, showStops, selectedLines]);

  // Speed-based color scale (defined once, used in layers)
  const speedColorExpression: maplibregl.ExpressionSpecification = [
    'case',
    ['==', ['get', 'speed'], null], '#666666',  // No speed data - gray
    ['<', ['get', 'speed'], 5], '#ff3333',      // Very slow - red
    ['<', ['get', 'speed'], 10], '#ff9933',     // Slow - orange
    ['<', ['get', 'speed'], 15], '#ffdd33',     // Moderate - yellow
    ['<', ['get', 'speed'], 25], '#88ff33',     // Good - lime green
    '#33ffff'                                    // Fast - cyan
  ];

  // Update vehicle data source when vehicles or selected lines change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Filter vehicles by selected lines and on-route check (speed filtering is done via layer filter)
    const filteredVehicles = vehicles.filter((v) => 
      selectedLines.includes(v.routeId as MuniLine) &&
      isOnRoute(v.lat, v.lon, v.routeId, routeGeometryMap)
    );

    // Create GeoJSON for vehicles
    const vehicleGeoJSON = {
      type: 'FeatureCollection' as const,
      features: filteredVehicles.map((v) => ({
        type: 'Feature' as const,
        properties: {
          id: v.id,
          routeId: v.routeId,
          direction: v.direction ?? null,
          speed: v.speed ?? null,  // Ensure null for no data
          recordedAt: v.recordedAt,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [v.lon, v.lat],
        },
      })),
    };

    // Check if source already exists
    const existingSource = map.current.getSource('vehicles') as maplibregl.GeoJSONSource;
    
    if (existingSource) {
      // Just update the data, don't recreate layers
      existingSource.setData(vehicleGeoJSON);
    } else {
      // First time: create source and layers
      map.current.addSource('vehicles', {
        type: 'geojson',
        data: vehicleGeoJSON,
      });

      // Vehicle glow
      map.current.addLayer({
        id: 'vehicles-glow',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': 6,
          'circle-color': speedColorExpression,
          'circle-opacity': 0.3,
          'circle-blur': 0.5,
        },
      });

      // Vehicle dots
      map.current.addLayer({
        id: 'vehicles',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': 4,
          'circle-color': speedColorExpression,
        },
      });

      // Vehicle hover (only set up once)
      map.current.on('mouseenter', 'vehicles', () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', 'vehicles', () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
        popup.current?.remove();
      });

      map.current.on('mousemove', 'vehicles', (e) => {
        if (!e.features?.length || !map.current) return;
        const props = e.features[0].properties;
        const speed = props.speed != null ? `${Math.round(props.speed)} mph` : 'Speed unknown';
        const dateTime = new Date(props.recordedAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
        const direction = props.direction || '';
        
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title">${props.routeId} Train${direction ? ` · ${direction}` : ''}</div>
              <div class="popup-detail">Vehicle #${props.id}</div>
              <div class="popup-speed">${speed}</div>
              <div class="popup-time">${dateTime}</div>
            </div>`
          )
          .addTo(map.current);
      });
    }
  }, [vehicles, mapLoaded, selectedLines]);

  // Update speed filter on layers (GPU-side filtering, no flicker)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    if (!map.current.getLayer('vehicles')) return;

    // Build filter expression for speed
    // Only show points with valid speed data within the min/max range
    const filterExpression: maplibregl.FilterSpecification = [
      'all',
      ['!=', ['get', 'speed'], null],
      ['>=', ['get', 'speed'], speedFilter.minSpeed],
      ['<=', ['get', 'speed'], speedFilter.maxSpeed]
    ];

    map.current.setFilter('vehicles', filterExpression);
    map.current.setFilter('vehicles-glow', filterExpression);
  }, [speedFilter, mapLoaded]);

  // Handle view mode toggle - show/hide raw dots and segment layer
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Show/hide raw dots based on view mode
    if (map.current.getLayer('vehicles')) {
      map.current.setLayoutProperty('vehicles', 'visibility', viewMode === 'raw' ? 'visible' : 'none');
    }
    if (map.current.getLayer('vehicles-glow')) {
      map.current.setLayoutProperty('vehicles-glow', 'visibility', viewMode === 'raw' ? 'visible' : 'none');
    }

    // Handle segment view
    if (viewMode === 'segments') {
      // Calculate segment averages from vehicles (using pre-computed segmentId)
      const segmentSpeeds: Map<string, number[]> = new Map();
      
      vehicles.forEach(v => {
        if (v.speed == null) return;
        if (!selectedLines.includes(v.routeId as MuniLine)) return;
        if (v.speed < speedFilter.minSpeed || v.speed > speedFilter.maxSpeed) return;
        if (!v.segmentId) return;  // Use pre-computed segment
        
        if (!segmentSpeeds.has(v.segmentId)) {
          segmentSpeeds.set(v.segmentId, []);
        }
        segmentSpeeds.get(v.segmentId)!.push(v.speed);
      });

      // Calculate averages
      const segmentAverages: Map<string, { avg: number; count: number }> = new Map();
      segmentSpeeds.forEach((speeds, segmentId) => {
        const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        segmentAverages.set(segmentId, { avg, count: speeds.length });
      });

      // Build GeoJSON for segments with data
      const segmentFeatures = allRouteSegments
        .filter(seg => selectedLines.includes(seg.routeId as MuniLine))
        .filter(seg => segmentAverages.has(seg.segmentId))
        .map(seg => {
          const data = segmentAverages.get(seg.segmentId)!;
          return {
            type: 'Feature' as const,
            properties: {
              segmentId: seg.segmentId,
              routeId: seg.routeId,
              avgSpeed: data.avg,
              sampleCount: data.count,
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: seg.coordinates,
            },
          };
        });

      const segmentGeoJSON = {
        type: 'FeatureCollection' as const,
        features: segmentFeatures,
      };

      // Update or create segment layer
      const existingSource = map.current.getSource('speed-segments') as maplibregl.GeoJSONSource;
      
      if (existingSource) {
        existingSource.setData(segmentGeoJSON);
        map.current.setLayoutProperty('speed-segments', 'visibility', 'visible');
      } else {
        map.current.addSource('speed-segments', {
          type: 'geojson',
          data: segmentGeoJSON,
        });

        // Add segment layer with speed-based coloring
        map.current.addLayer({
          id: 'speed-segments',
          type: 'line',
          source: 'speed-segments',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-width': 6,
            'line-color': [
              'case',
              ['<', ['get', 'avgSpeed'], 5], '#ff3333',
              ['<', ['get', 'avgSpeed'], 10], '#ff9933',
              ['<', ['get', 'avgSpeed'], 15], '#ffdd33',
              ['<', ['get', 'avgSpeed'], 25], '#88ff33',
              '#33ffff'
            ],
            'line-opacity': 0.9,
          },
        });

        // Add hover for segments
        map.current.on('mouseenter', 'speed-segments', () => {
          if (map.current) map.current.getCanvas().style.cursor = 'pointer';
        });

        map.current.on('mouseleave', 'speed-segments', () => {
          if (map.current) map.current.getCanvas().style.cursor = '';
          popup.current?.remove();
        });

        map.current.on('mousemove', 'speed-segments', (e) => {
          if (!e.features?.length || !map.current) return;
          const props = e.features[0].properties;
          
          popup.current
            ?.setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-content">
                <div class="popup-title">${props.routeId} Segment</div>
                <div class="popup-speed">${Math.round(props.avgSpeed)} mph avg</div>
                <div class="popup-detail">${props.sampleCount} readings</div>
              </div>`
            )
            .addTo(map.current);
        });
      }
    } else {
      // Hide segment layer when in raw mode
      if (map.current.getLayer('speed-segments')) {
        map.current.setLayoutProperty('speed-segments', 'visibility', 'none');
      }
    }
  }, [viewMode, vehicles, mapLoaded, selectedLines, speedFilter]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {dataSource === 'none' && (
        <div className="data-status">
          No data yet. Run <code>npm run collect</code> to start collecting.
        </div>
      )}
      {loadingProgress && (
        <div className="loading-indicator">
          {loadingProgress}
        </div>
      )}
    </div>
  );
}
