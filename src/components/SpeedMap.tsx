import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MuniLine } from '../types';
import { supabase } from '../lib/supabase';
import muniRoutes from '../data/muniMetroRoutes.json';

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
  onVehicleUpdate?: (count: number, time: Date) => void;
}

export function SpeedMap({ selectedLines, onVehicleUpdate }: SpeedMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dataSource, setDataSource] = useState<'loading' | 'supabase' | 'none'>('loading');

  // Ref to avoid re-render loops with the callback
  const onVehicleUpdateRef = useRef(onVehicleUpdate);
  onVehicleUpdateRef.current = onVehicleUpdate;

  // Fetch vehicle positions from Supabase (data collected by the collector)
  const fetchVehiclesFromSupabase = useCallback(async () => {
    if (!supabase) {
      setDataSource('none');
      return;
    }

    try {
      // Get ALL collected positions (for visualization/debugging)
      const { data, error } = await supabase
        .from('vehicle_positions')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(5000); // Limit to prevent browser overload

      if (error) {
        console.error('Error fetching from Supabase:', error);
        setDataSource('none');
        return;
      }

      // Show ALL positions as individual points (not just latest per vehicle)
      const allPositions: Vehicle[] = (data || []).map((row: any) => ({
        id: `${row.vehicle_id}-${row.id}`, // Unique ID for each position
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

    // Route outline
    map.current.addLayer({
      id: 'routes-outline',
      type: 'line',
      source: 'routes',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#000',
        'line-width': 7,
        'line-opacity': 0.6,
      },
    });

    // Route lines with their official colors
    map.current.addLayer({
      id: 'routes',
      type: 'line',
      source: 'routes',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': ['get', 'route_color'],
        'line-width': 4,
        'line-opacity': 0.9,
      },
    });

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
  }, [mapLoaded, selectedLines]);

  // Update vehicle markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Filter vehicles based on selection (empty = show nothing)
    const filteredVehicles = vehicles.filter(
      (v) => selectedLines.includes(v.routeId as MuniLine)
    );

    // Create GeoJSON for vehicles
    const vehicleGeoJSON = {
      type: 'FeatureCollection' as const,
      features: filteredVehicles.map((v) => ({
        type: 'Feature' as const,
        properties: {
          id: v.id,
          routeId: v.routeId,
          speed: v.speed,
          recordedAt: v.recordedAt,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [v.lon, v.lat],
        },
      })),
    };

    // Remove existing vehicle layers
    if (map.current.getLayer('vehicles-glow')) map.current.removeLayer('vehicles-glow');
    if (map.current.getLayer('vehicles')) map.current.removeLayer('vehicles');
    if (map.current.getSource('vehicles')) map.current.removeSource('vehicles');

    // Add vehicles source
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
        'circle-radius': 5,
        'circle-color': '#00ff88',
        'circle-opacity': 0.4,
        'circle-blur': 0.5,
      },
    });

    // Vehicle dots
    map.current.addLayer({
      id: 'vehicles',
      type: 'circle',
      source: 'vehicles',
      paint: {
        'circle-radius': 3,
        'circle-color': '#00ff88',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff',
      },
    });

    // Vehicle hover
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
  }, [vehicles, mapLoaded, selectedLines]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-container" />
      {dataSource === 'none' && (
        <div className="data-status">
          No data yet. Run <code>npm run collect</code> to start collecting.
        </div>
      )}
    </div>
  );
}
