import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MuniLine } from '../types';
import { supabase } from '../lib/supabase';
import muniRoutes from '../data/muniMetroRoutes.json';
import muniStops from '../data/muniMetroStops.json';
import type { SpeedFilter } from '../App';

interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  routeId: string;
  speed?: number;
  recordedAt: string;
}

interface SpeedMapProps {
  selectedLines: MuniLine[];
  speedFilter: SpeedFilter;
  showRouteLines: boolean;
  showStops: boolean;
  onVehicleUpdate?: (count: number, time: Date) => void;
}

export function SpeedMap({ selectedLines, speedFilter, showRouteLines, showStops, onVehicleUpdate }: SpeedMapProps) {
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
      const allPositions: Vehicle[] = allData.map((row: any) => ({
        id: `${row.vehicle_id}-${row.id}`,
        lat: row.lat,
        lon: row.lon,
        routeId: row.route_id,
        speed: row.speed_calculated,
        recordedAt: row.recorded_at,
      }));

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
            <div class="popup-direction">${props.direction}</div>
          </div>`
        )
        .addTo(map.current);
    });
  }, [mapLoaded, selectedLines, showRouteLines]);

  // Add/update stops layer (independent of line filter, always on top)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Show ALL stops when enabled (independent of line filter)
    const allStops = muniStops;

    // Check if stops source already exists
    const existingSource = map.current.getSource('stops') as maplibregl.GeoJSONSource;

    if (existingSource) {
      // Just update visibility (data doesn't change)
      map.current.setLayoutProperty('stops', 'visibility', showStops ? 'visible' : 'none');
      map.current.setLayoutProperty('stops-label', 'visibility', showStops ? 'visible' : 'none');
    } else {
      // First time: create source and layers
      map.current.addSource('stops', {
        type: 'geojson',
        data: allStops as any,
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
  }, [mapLoaded, showStops]);

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

    // Filter vehicles by selected lines only (speed filtering is done via layer filter)
    const filteredVehicles = vehicles.filter((v) => 
      selectedLines.includes(v.routeId as MuniLine)
    );

    // Create GeoJSON for vehicles
    const vehicleGeoJSON = {
      type: 'FeatureCollection' as const,
      features: filteredVehicles.map((v) => ({
        type: 'Feature' as const,
        properties: {
          id: v.id,
          routeId: v.routeId,
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
        const speed = props.speed ? `${Math.round(props.speed)} mph` : 'Speed unknown';
        const time = new Date(props.recordedAt).toLocaleTimeString();
        
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="popup-content">
              <div class="popup-title">${props.routeId} Train</div>
              <div class="popup-detail">Vehicle #${props.id}</div>
              <div class="popup-speed">${speed}</div>
              <div class="popup-time">Last seen: ${time}</div>
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
