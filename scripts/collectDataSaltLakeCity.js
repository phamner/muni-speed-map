#!/usr/bin/env node
/**
 * Salt Lake City TRAX Light Rail - Data Collector
 * 
 * Polls Utah Transit Authority (UTA) GTFS-RT API every 90 seconds and saves vehicle positions to Supabase.
 * Speed is calculated from consecutive GPS readings.
 * 
 * UTA provides GTFS-RT feeds:
 * Check https://www.rideuta.com/Developer-Resources for developer resources
 * 
 * ⚠️ NOTE: UTA GTFS-RT feed URLs need to be obtained from their developer resources.
 * 
 * Run with: node scripts/collectDataSaltLakeCity.js
 */

import { createClient } from '@supabase/supabase-js';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// Configuration
const SUPABASE_URL = 'https://REDACTED_SUPABASE_REF.supabase.co';
const SUPABASE_ANON_KEY = 'REDACTED_SUPABASE_KEY';

// ⚠️ UPDATE THIS URL - UTA GTFS-RT Vehicle Positions feed
// Check https://www.rideuta.com/Developer-Resources for current URL
const VEHICLE_POSITIONS_URL = 'https://api.rideuta.com/gtfs-realtime/vehiclepositions';

// TRAX Light Rail route IDs
// Blue Line, Red Line, Green Line, S-Line (Sugar House Streetcar)
const LIGHT_RAIL_ROUTES = ['Blue', 'Red', 'Green', 'S-Line'];

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
  
  // Sanity check: TRAX max speed is around 55 mph
  if (speedMph > 65) {
    return null; // Likely GPS glitch
  }
  
  return Math.round(speedMph * 10) / 10;
}

// Check if route ID is a rail line
function isRailRoute(routeId) {
  // Check for TRAX lines or S-Line
  const upperRouteId = routeId.toUpperCase();
  return LIGHT_RAIL_ROUTES.some(r => upperRouteId.includes(r.toUpperCase()));
}

// Normalize route ID to our format
function normalizeRouteId(routeId) {
  const upper = routeId.toUpperCase();
  if (upper.includes('BLUE')) return 'Blue';
  if (upper.includes('RED')) return 'Red';
  if (upper.includes('GREEN')) return 'Green';
  if (upper.includes('S-LINE') || upper.includes('SLINE')) return 'S-Line';
  return routeId;
}

// Fetch vehicle positions from GTFS-RT feed
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: {
        'Accept': 'application/x-protobuf'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    
    // Filter for light rail vehicles
    const railVehicles = feed.entity
      .filter(entity => entity.vehicle && entity.vehicle.trip && 
              isRailRoute(entity.vehicle.trip.routeId))
      .map(entity => {
        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id || entity.id;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;
        const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
        
        // Calculate speed from consecutive GPS readings
        const calculatedSpeed = calculateSpeed(vehicleId, lat, lon, timestamp);
        
        return {
          vehicle_id: vehicleId,
          route_id: normalizeRouteId(v.trip.routeId),
          direction_id: String(v.trip.directionId || ''),
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: calculatedSpeed,
          recorded_at: new Date(timestamp).toISOString(),
          city: 'Salt Lake City',
          headsign: null,
        };
      })
      .filter(v => v.lat && v.lon && v.vehicle_id);
    
    return railVehicles;
  } catch (error) {
    console.error('Error fetching vehicle positions:', error.message);
    return [];
  }
}

// Save positions to Supabase
async function savePositions(positions) {
  if (positions.length === 0) return { count: 0 };
  
  const { data, error } = await supabase
    .from('vehicle_positions')
    .insert(positions);
  
  if (error) {
    console.error('Error saving positions:', error.message);
    return { count: 0, error };
  }
  
  return { count: positions.length };
}

// Main collection loop
async function collectOnce() {
  const startTime = Date.now();
  
  // Fetch current positions
  const vehicles = await fetchVehiclePositions();
  
  if (vehicles.length === 0) {
    console.log(`[${new Date().toISOString()}] No vehicles found`);
    return;
  }
  
  // Count vehicles with speed data
  const withSpeed = vehicles.filter(v => v.speed_calculated !== null);
  
  // Save to database
  const { count, error } = await savePositions(vehicles);
  
  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  if (error) {
    console.log(`[${timestamp} MT] Error: ${error.message}`);
  } else {
    console.log(
      `[${timestamp} MT] Saved ${count} Salt Lake City TRAX positions ` +
      `(${withSpeed.length} with speed) in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log('🏔️ Salt Lake City TRAX Light Rail - Data Collector');
  console.log(`   Polling GTFS-RT API every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Tracking routes: ${LIGHT_RAIL_ROUTES.join(', ')}`);
  console.log('   Press Ctrl+C to stop\n');
  
  // Initial collection
  await collectOnce();
  
  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down Salt Lake City collector...');
  process.exit(0);
});

// Start the collector
runCollector();

