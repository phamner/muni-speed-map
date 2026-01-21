#!/usr/bin/env node
/**
 * Baltimore MTA Light Rail - Data Collector
 * 
 * Polls Baltimore MTA GTFS-RT API every 90 seconds and saves vehicle positions to Supabase.
 * Speed is calculated from consecutive GPS readings.
 * 
 * Baltimore Light Rail is a single route with branches:
 * - Route ID: 11693 (LIGHT RAILLINK)
 * - Branches: Hunt Valley, BWI Airport, Glen Burnie, Penn-Camden
 * 
 * GTFS-RT is provided via Swiftly API - requires SWIFTLY_KEY environment variable
 * Vehicle Positions: https://api.goswift.ly/real-time/mta-maryland-light-rail/gtfs-rt-vehicle-positions
 * 
 * Run with: npm run collect:baltimore
 */

import 'dotenv/config';
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

// Swiftly API key for Baltimore MTA
const SWIFTLY_KEY = process.env.SWIFTLY_KEY;
if (!SWIFTLY_KEY) {
  console.error('❌ Error: SWIFTLY_KEY environment variable is required');
  console.error('   Get an API key from https://www.goswift.ly/ (MTA Maryland partner)');
  console.error('   Run with: SWIFTLY_KEY=your_key node scripts/collectDataBaltimore.js');
  process.exit(1);
}

// Baltimore MTA GTFS-RT Vehicle Positions feed (via Swiftly)
const VEHICLE_POSITIONS_URL = 'https://api.goswift.ly/real-time/mta-maryland-light-rail/gtfs-rt-vehicle-positions';

// Light Rail route ID (from GTFS routes.txt)
// 11693 = LIGHT RAILLINK
const LIGHT_RAIL_ROUTES = ['11693', 'LIGHT RAILLINK', 'Light Rail'];

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
  
  // Sanity check: light rail shouldn't exceed 65 mph
  if (speedMph > 70) {
    return null; // Likely GPS glitch
  }
  
  return Math.round(speedMph * 10) / 10;
}

// Check if a route ID is Light Rail
function isLightRail(routeId) {
  if (!routeId) return false;
  const id = String(routeId).toUpperCase();
  return LIGHT_RAIL_ROUTES.some(r => id.includes(r.toUpperCase()) || r.toUpperCase().includes(id));
}

// Fetch vehicle positions from GTFS-RT protobuf feed
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: {
        'Authorization': SWIFTLY_KEY,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    
    // Get all vehicles first to see what routes are available
    const allVehicles = (feed.entity || [])
      .filter(entity => entity.vehicle)
      .map(entity => {
        const v = entity.vehicle;
        return {
          id: entity.id,
          routeId: v.trip?.routeId,
          lat: v.position?.latitude,
          lon: v.position?.longitude,
        };
      });
    
    // Log all unique route IDs on first run (for debugging)
    if (previousPositions.size === 0 && allVehicles.length > 0) {
      const uniqueRoutes = [...new Set(allVehicles.map(v => v.routeId))].filter(Boolean);
      console.log(`   Found route IDs in feed: ${uniqueRoutes.join(', ') || '(none)'}`);
    }
    
    // Filter for light rail vehicles only
    const railVehicles = (feed.entity || [])
      .filter(entity => entity.vehicle && 
              entity.vehicle.trip && 
              isLightRail(entity.vehicle.trip.routeId))
      .map(entity => {
        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id || entity.id;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;
        
        // Filter out invalid coordinates
        if (!lat || !lon || lat === 0 || lon === 0) {
          return null;
        }
        
        // Baltimore Light Rail bbox check
        if (lat < 39.1 || lat > 39.6 || lon < -76.8 || lon > -76.5) {
          return null; // Outside Baltimore area
        }
        
        const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
        
        // Calculate speed from consecutive GPS readings
        // NOTE: API-reported speed from Swiftly is unreliable (often 2-14x higher than actual)
        // GPS-calculated speed is verified accurate by comparing distance traveled over time
        const calculatedSpeed = calculateSpeed(vehicleId, lat, lon, timestamp);
        
        // Use GPS-calculated speed only (API speed is unreliable for Baltimore)
        const speed = calculatedSpeed;
        
        return {
          vehicle_id: vehicleId,
          route_id: 'Light Rail',  // Normalize to our route ID
          direction_id: String(v.trip.directionId || ''),
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: speed,
          recorded_at: new Date(timestamp).toISOString(),
          city: 'Baltimore',
          headsign: v.trip?.tripHeadsign || v.vehicle?.label || null,
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
    console.log(`[${new Date().toISOString()}] No Light Rail vehicles found`);
    return;
  }
  
  // Count vehicles with speed data
  const withSpeed = vehicles.filter(v => v.speed_calculated !== null);
  
  // Count by headsign/direction
  const headsigns = [...new Set(vehicles.map(v => v.headsign).filter(Boolean))];
  
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
      `[${timestamp} ET] Saved ${count} Baltimore Light Rail positions ` +
      `(${withSpeed.length} with speed${headsigns.length > 0 ? ', headsigns: ' + headsigns.join(', ') : ''}) in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log('🦀 Baltimore MTA Light Rail - Data Collector');
  console.log(`   Polling GTFS-RT API every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Looking for route IDs: ${LIGHT_RAIL_ROUTES.join(', ')}`);
  console.log('   Press Ctrl+C to stop\n');
  
  // Initial collection
  await collectOnce();
  
  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down Baltimore collector...');
  process.exit(0);
});

// Start the collector
runCollector();
