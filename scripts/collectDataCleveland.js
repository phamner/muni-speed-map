#!/usr/bin/env node
/**
 * Cleveland RTA Rapid Transit - Data Collector
 * 
 * Polls Cleveland RTA GTFS-RT API every 90 seconds and saves vehicle positions to Supabase.
 * Speed is calculated from consecutive GPS readings.
 * 
 * Cleveland has three rail lines:
 * - 66: Red Line (heavy rail rapid transit - Airport to Windermere)
 * - 67: Blue Line (shares downtown subway with Red, branches to Van Aken)
 * - 68: Green Line (shares downtown subway with Red, branches to Green Road)
 * 
 * GTFS-RT Vehicle Positions: https://gtfs-rt.gcrta.vontascloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb
 * No API key required - publicly accessible
 * 
 * Run with: node scripts/collectDataCleveland.js
 */

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import fetch, { Headers, Request, Response } from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// Polyfill for Node.js 16 (required by newer Supabase client)
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Configuration
const SUPABASE_URL = 'https://REDACTED_SUPABASE_REF.supabase.co';
const SUPABASE_ANON_KEY = 'REDACTED_SUPABASE_KEY';

// Cleveland GTFS-RT Vehicle Positions feed (protobuf format) - no API key needed
const VEHICLE_POSITIONS_URL = 'https://gtfs-rt.gcrta.vontascloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb';

// Rail route IDs
// 66 = Red Line, 67 = Blue Line, 68 = Green Line
const RAIL_ROUTES = ['66', '67', '68'];

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Store previous positions for speed calculation
const previousPositions = new Map();

// Haversine distance between two points in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate speed from previous position
function calculateSpeed(vehicleId, lat, lon, timestamp) {
  const prev = previousPositions.get(vehicleId);
  
  // Store current position for next calculation
  previousPositions.set(vehicleId, { lat, lon, timestamp });
  
  if (!prev) {
    return null; // No previous position to compare
  }
  
  const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
  
  // Only calculate speed if time gap is reasonable (30-300 seconds)
  if (timeDiffSeconds < 30 || timeDiffSeconds > 300) {
    return null;
  }
  
  const distanceMeters = haversineDistance(prev.lat, prev.lon, lat, lon);
  
  // If distance is very small, vehicle is stationary
  if (distanceMeters < 5) {
    return 0;
  }
  
  // Convert to mph
  const speedMps = distanceMeters / timeDiffSeconds;
  const speedMph = speedMps * 2.237;
  
  // Sanity check: Cleveland rapid transit max around 50 mph
  if (speedMph > 60) {
    return null; // Likely GPS glitch
  }
  
  return Math.round(speedMph * 10) / 10;
}

// Fetch vehicle positions from GTFS-RT protobuf feed
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    
    // Filter for rail vehicles only
    const railVehicles = (feed.entity || [])
      .filter(entity => entity.vehicle && 
              entity.vehicle.trip && 
              RAIL_ROUTES.includes(entity.vehicle.trip.routeId))
      .map(entity => {
        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id || entity.id;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;
        
        // Filter out invalid coordinates
        if (!lat || !lon || lat === 0 || lon === 0) {
          return null;
        }
        
        const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
        
        // Check if feed provides speed directly (in m/s)
        let reportedSpeed = null;
        if (v.position?.speed && v.position.speed > 0) {
          // Convert m/s to mph
          reportedSpeed = Math.round(v.position.speed * 2.237 * 10) / 10;
        }
        
        // Calculate speed from consecutive GPS readings
        const calculatedSpeed = calculateSpeed(vehicleId, lat, lon, timestamp);
        
        // Prefer calculated speed (more reliable) unless we don't have one yet
        const speed = calculatedSpeed !== null ? calculatedSpeed : reportedSpeed;
        
        return {
          vehicle_id: vehicleId,
          route_id: v.trip.routeId,  // Keep original route ID (66, 67, 68)
          direction_id: String(v.trip.directionId || ''),
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: speed,
          recorded_at: new Date(timestamp).toISOString(),
          city: 'Cleveland',
          headsign: v.vehicle?.label || null,
        };
      })
      .filter(Boolean);
    
    return railVehicles;
  } catch (error) {
    console.error('Error fetching vehicle positions:', error.message);
    return [];
  }
}

// Save positions to Supabase
async function savePositions(vehicles) {
  if (vehicles.length === 0) {
    return { saved: 0 };
  }
  
  const startTime = Date.now();
  const { error } = await supabase
    .from('vehicle_positions')
    .insert(vehicles);
  
  if (error) {
    console.error('Supabase insert error:', error.message);
    return { saved: 0, error };
  }
  
  const duration = Date.now() - startTime;
  return { saved: vehicles.length, duration };
}

// Main polling function
async function poll() {
  const vehicles = await fetchVehiclePositions();
  
  if (vehicles.length === 0) {
    console.log(`[${new Date().toLocaleString()}] No Cleveland rail vehicles found`);
    return;
  }
  
  const result = await savePositions(vehicles);
  
  // Count vehicles by line
  const lineCounts = {};
  const lineNames = { '66': 'Red', '67': 'Blue', '68': 'Green' };
  vehicles.forEach(v => {
    const name = lineNames[v.route_id] || v.route_id;
    lineCounts[name] = (lineCounts[name] || 0) + 1;
  });
  
  const lineInfo = Object.entries(lineCounts).map(([k, v]) => `${k}:${v}`).join(' ');
  const speedCount = vehicles.filter(v => v.speed_calculated !== null).length;
  
  console.log(
    `[${new Date().toLocaleString()}] Saved ${result.saved} Cleveland RTA positions ` +
    `(${speedCount} with speed) [${lineInfo}] in ${result.duration}ms`
  );
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down Cleveland collector...');
  process.exit(0);
});

// Start polling
console.log('🚇 Cleveland RTA Rapid Transit Data Collector');
console.log('   Feed URL: gtfs-rt.gcrta.vontascloud.com');
console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
console.log('   Tracking: Red (66), Blue (67), Green (68)');
console.log('   Press Ctrl+C to stop\n');

// Initial poll
poll();

// Continue polling
setInterval(poll, POLL_INTERVAL_MS);
