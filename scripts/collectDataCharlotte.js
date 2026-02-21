#!/usr/bin/env node
/**
 * Charlotte CATS Light Rail - Data Collector
 * 
 * Polls Charlotte CATS GTFS-RT API every 90 seconds and saves vehicle positions to Supabase.
 * Speed is calculated from consecutive GPS readings.
 * 
 * Charlotte has two rail lines:
 * - 501: LYNX Blue Line (light rail from UNCC to I-485/South Blvd)
 * - 510: CityLYNX Gold Line (streetcar)
 * 
 * GTFS-RT Vehicle Positions: https://gtfsrealtime.ridetransit.org/GTFSRealTime/Vehicle/VehiclePositions.pb
 * 
 * Run with: node scripts/collectDataCharlotte.js
 */

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import fetch, { Headers, Request, Response } from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from "dotenv";

dotenv.config();

// Polyfill for Node.js 16 (required by newer Supabase client)
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

// Charlotte GTFS-RT Vehicle Positions feed (protobuf format)
const VEHICLE_POSITIONS_URL = 'https://gtfsrealtime.ridetransit.org/GTFSRealTime/Vehicle/VehiclePositions.pb';

// Light Rail route IDs
// 501 = LYNX Blue Line, 510 = CityLYNX Gold Line
const LIGHT_RAIL_ROUTES = ['501', '510'];

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
  
  // Sanity check: light rail shouldn't exceed 65 mph
  if (speedMph > 70) {
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
    
    // Filter for light rail vehicles only
    const railVehicles = (feed.entity || [])
      .filter(entity => entity.vehicle && 
              entity.vehicle.trip && 
              LIGHT_RAIL_ROUTES.includes(entity.vehicle.trip.routeId))
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
        
        // Use reported speed if available, otherwise use calculated speed
        const speed = reportedSpeed !== null ? reportedSpeed : calculatedSpeed;
        
        return {
          vehicle_id: vehicleId,
          route_id: v.trip.routeId,  // Keep original route ID (501 or 510)
          direction_id: String(v.trip.directionId || ''),
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: speed,
          recorded_at: new Date(timestamp).toISOString(),
          city: 'Charlotte',
          headsign: v.vehicle?.label || null,
        };
      })
      .filter(v => v !== null && v.lat && v.lon && v.vehicle_id);
    
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
    console.log(`[${new Date().toISOString()}] No light rail vehicles found`);
    return;
  }
  
  // Count by route
  const blueLine = vehicles.filter(v => v.route_id === '501').length;
  const goldLine = vehicles.filter(v => v.route_id === '510').length;
  
  // Count vehicles with speed data
  const withSpeed = vehicles.filter(v => v.speed_calculated !== null);
  
  // Save to database
  const { count, error } = await savePositions(vehicles);
  
  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  if (error) {
    console.log(`[${timestamp} ET] Error: ${error.message}`);
  } else {
    console.log(
      `[${timestamp} ET] Saved ${count} Charlotte LYNX positions ` +
      `(Blue: ${blueLine}, Gold: ${goldLine}, ${withSpeed.length} with speed) in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log('🚃 Charlotte CATS Light Rail - Data Collector');
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
  console.log('\n\n👋 Shutting down Charlotte collector...');
  process.exit(0);
});

// Start the collector
runCollector();
