#!/usr/bin/env node
/**
 * Combined Seattle & Denver Data Collector
 * 
 * Collects real-time vehicle positions for both cities simultaneously.
 * 
 * Usage: npm run collect:seattle-denver
 */

import fetch, { Headers, Request, Response } from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import dotenv from "dotenv";

dotenv.config();

// Polyfill for Node.js 16
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SEATTLE_OBA_API_KEY = process.env.OBA_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

if (!SEATTLE_OBA_API_KEY) {
  console.error("❌ Error: OBA_API_KEY environment variable is required for Seattle");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Store previous positions for speed calculation (keyed by city-vehicleId)
const previousPositions = new Map();

// ============ SEATTLE CONFIG ============
const SEATTLE_OBA_BASE_URL = "https://api.pugetsound.onebusaway.org/api/where";
const SEATTLE_AGENCY_ID = "40";
const SEATTLE_LINK_LINES = {
  "100479": "1 Line",
  "2LINE": "2 Line",
  "TLINE": "T Line",
};

// ============ DENVER CONFIG ============
const DENVER_VEHICLE_POSITIONS_URL = 'https://www.rtd-denver.com/files/gtfs-rt/VehiclePosition.pb';
const DENVER_RAIL_ROUTE_MAP = {
  'A': 'A',
  '113B': 'B',
  '101D': 'D',
  '101E': 'E',
  '113G': 'G',
  '101H': 'H',
  '109L': 'L',
  '117N': 'N',
  '107R': 'R',
  '101S': 'S',
  '103W': 'W',
};

// ============ SHARED UTILITIES ============

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateSpeed(city, vehicleId, lat, lon, timestamp) {
  const key = `${city}-${vehicleId}`;
  const prev = previousPositions.get(key);
  
  previousPositions.set(key, { lat, lon, timestamp });
  
  if (!prev) return null;
  
  const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
  if (timeDiffSeconds < 5 || timeDiffSeconds > 300) return null;
  
  const distanceMeters = haversineDistance(prev.lat, prev.lon, lat, lon);
  if (distanceMeters < 1) return 0;
  
  const speedMph = (distanceMeters / timeDiffSeconds) * 2.237;
  if (speedMph > 100) return null;
  
  return Math.round(speedMph * 10) / 10;
}

function formatTime(date, timezone) {
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

// ============ SEATTLE COLLECTOR ============

function extractSeattleRouteId(tripId) {
  if (!tripId) return null;
  for (const lineId of Object.keys(SEATTLE_LINK_LINES)) {
    if (tripId.includes(lineId)) return lineId;
  }
  return null;
}

async function collectSeattle() {
  try {
    const url = `${SEATTLE_OBA_BASE_URL}/vehicles-for-agency/${SEATTLE_AGENCY_ID}.json?key=${SEATTLE_OBA_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) throw new Error(`Seattle API error: ${response.status}`);
    
    const data = await response.json();
    if (data.code !== 200) throw new Error(`Seattle API code: ${data.code}`);
    
    const vehicles = data.data?.list || [];
    const linkVehicles = vehicles.filter(v => extractSeattleRouteId(v.tripId) !== null);
    
    const positions = [];
    let speedCount = 0;
    
    for (const vehicle of linkVehicles) {
      const vehicleId = vehicle.vehicleId?.split("_").pop() || vehicle.vehicleId;
      const routeId = extractSeattleRouteId(vehicle.tripId);
      const lat = vehicle.location?.lat;
      const lon = vehicle.location?.lon;
      const timestamp = vehicle.lastLocationUpdateTime || Date.now();
      
      if (!lat || !lon || !routeId) continue;
      
      const speed = calculateSpeed('Seattle', vehicleId, lat, lon, timestamp);
      if (speed !== null) speedCount++;
      
      positions.push({
        vehicle_id: vehicleId,
        route_id: routeId,
        direction_id: '',
        lat,
        lon,
        speed_calculated: speed,
        recorded_at: new Date(timestamp).toISOString(),
        city: 'Seattle',
      });
    }
    
    return { positions, speedCount, vehicleCount: linkVehicles.length };
  } catch (error) {
    console.error(`   ❌ Seattle error: ${error.message}`);
    return { positions: [], speedCount: 0, vehicleCount: 0 };
  }
}

// ============ DENVER COLLECTOR ============

function getDenverDisplayRouteId(gtfsRouteId) {
  return DENVER_RAIL_ROUTE_MAP[gtfsRouteId] || gtfsRouteId;
}

function isDenverRailRoute(routeId) {
  return Object.keys(DENVER_RAIL_ROUTE_MAP).includes(routeId);
}

async function collectDenver() {
  try {
    const response = await fetch(DENVER_VEHICLE_POSITIONS_URL, {
      headers: { 'Accept': 'application/x-protobuf' }
    });
    
    if (!response.ok) throw new Error(`Denver API error: ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    
    const railVehicles = feed.entity.filter(entity => 
      entity.vehicle?.trip && isDenverRailRoute(entity.vehicle.trip.routeId)
    );
    
    const positions = [];
    let speedCount = 0;
    
    for (const entity of railVehicles) {
      const v = entity.vehicle;
      const vehicleId = v.vehicle?.id || entity.id;
      const lat = v.position?.latitude;
      const lon = v.position?.longitude;
      const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
      
      if (!lat || !lon) continue;
      
      const speed = calculateSpeed('Denver', vehicleId, lat, lon, timestamp);
      if (speed !== null) speedCount++;
      
      positions.push({
        vehicle_id: vehicleId,
        route_id: getDenverDisplayRouteId(v.trip.routeId),
        direction_id: String(v.trip.directionId || ''),
        lat,
        lon,
        heading: v.position?.bearing || null,
        speed_calculated: speed,
        recorded_at: new Date(timestamp).toISOString(),
        city: 'Denver',
        headsign: null,
      });
    }
    
    return { positions, speedCount, vehicleCount: railVehicles.length };
  } catch (error) {
    console.error(`   ❌ Denver error: ${error.message}`);
    return { positions: [], speedCount: 0, vehicleCount: 0 };
  }
}

// ============ MAIN COLLECTION LOOP ============

async function collectAll() {
  const startTime = Date.now();
  const now = new Date();
  
  // Collect from both cities in parallel
  const [seattleResult, denverResult] = await Promise.all([
    collectSeattle(),
    collectDenver()
  ]);
  
  // Combine all positions
  const allPositions = [...seattleResult.positions, ...denverResult.positions];
  
  if (allPositions.length === 0) {
    console.log(`[${formatTime(now, 'America/Los_Angeles')}] No vehicles found`);
    return;
  }
  
  // Save to Supabase
  const { error } = await supabase.from('vehicle_positions').insert(allPositions);
  
  const elapsed = Date.now() - startTime;
  const totalSpeed = seattleResult.speedCount + denverResult.speedCount;
  
  if (error) {
    console.error(`[${formatTime(now, 'America/Los_Angeles')}] DB Error: ${error.message}`);
  } else {
    console.log(
      `[${formatTime(now, 'America/Los_Angeles')}] ` +
      `Seattle: ${seattleResult.positions.length} | ` +
      `Denver: ${denverResult.positions.length} | ` +
      `Total: ${allPositions.length} (${totalSpeed} with speed) | ` +
      `${elapsed}ms`
    );
  }
}

// ============ STARTUP ============

async function main() {
  console.log('🚃 Combined Seattle + Denver Collector');
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Seattle: ${Object.values(SEATTLE_LINK_LINES).join(', ')}`);
  console.log(`   Denver: ${Object.values(DENVER_RAIL_ROUTE_MAP).join(', ')}`);
  console.log('   Press Ctrl+C to stop\n');
  
  // Initial collection
  await collectAll();
  
  // Set up interval
  setInterval(collectAll, POLL_INTERVAL_MS);
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down combined collector...');
  process.exit(0);
});

main();
