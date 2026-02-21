#!/usr/bin/env node
/**
 * Philadelphia SEPTA Trolley Data Collector
 *
 * Fetches real-time vehicle positions from SEPTA's TransitView API,
 * calculates speeds between consecutive readings, and stores in Supabase.
 *
 * No API key required - SEPTA provides open data feeds.
 *
 * Usage: npm run collect:philly
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

// SEPTA TransitView API
const API_BASE_URL = "https://www3.septa.org/api/TransitView/index.php";

// Trolley routes - API uses GTFS route_id, not route numbers!
// T1-T5 = Subway-Surface Trolleys, D1-D2 = Media/Sharon Hill, G1 = Girard Ave
const TROLLEY_ROUTES = ["T1", "T2", "T3", "T4", "T5", "D1", "D2", "G1"];

// Map API route_id to our frontend route_id
const ROUTE_ID_MAP = {
  T1: "10",
  T2: "34",
  T3: "13",
  T4: "11",
  T5: "36",
  D1: "101",
  D2: "102",
  G1: "15",
};

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Store last known positions for speed calculation
const lastPositions = new Map();

// Calculate distance between two points in meters (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
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

// Convert meters per second to miles per hour
function mpsToMph(mps) {
  return mps * 2.237;
}

// Format timestamp for logging
function formatTime(date) {
  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

// Fetch vehicle positions for a single route
async function fetchRouteVehicles(routeNum) {
  try {
    const url = `${API_BASE_URL}?route=${routeNum}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.bus) {
      return [];
    }

    // TransitView returns vehicles in the "bus" array
    // Convert GTFS route_id (T1, T2, etc.) to frontend route_id (10, 11, etc.)
    const frontendRouteId = ROUTE_ID_MAP[routeNum] || routeNum;
    return data.bus
      .filter((v) => v.VehicleID) // Skip entries without vehicle ID
      .map((v) => ({
        vehicle_id: v.VehicleID || v.label,
        route_id: frontendRouteId,
        direction_id: v.Direction || "",
        lat: parseFloat(v.lat),
        lon: parseFloat(v.lng),
        speed_reported: null, // SEPTA doesn't provide speed
        heading: v.heading ? parseFloat(v.heading) : null,
        recorded_at: v.Offset
          ? new Date(Date.now() - Math.abs(v.Offset) * 60 * 1000).toISOString()
          : new Date().toISOString(),
        city: "Philadelphia",
      }));
  } catch (error) {
    console.error(`   Error fetching route ${routeNum}:`, error.message);
    return [];
  }
}

// Calculate speed from last known position
function calculateSpeed(vehicle) {
  const key = vehicle.vehicle_id;
  const prev = lastPositions.get(key);

  const now = new Date(vehicle.recorded_at);

  if (!prev) {
    lastPositions.set(key, { lat: vehicle.lat, lon: vehicle.lon, time: now });
    return null;
  }

  const timeDiffMs = now.getTime() - prev.time.getTime();
  const timeDiffSeconds = timeDiffMs / 1000;

  // Only calculate speed if time gap is reasonable (5-180 seconds)
  if (timeDiffSeconds < 5 || timeDiffSeconds > 180) {
    lastPositions.set(key, { lat: vehicle.lat, lon: vehicle.lon, time: now });
    return null;
  }

  const distanceMeters = haversineDistance(
    prev.lat,
    prev.lon,
    vehicle.lat,
    vehicle.lon,
  );

  if (distanceMeters < 1) {
    lastPositions.set(key, { lat: vehicle.lat, lon: vehicle.lon, time: now });
    return 0;
  }

  const speedMps = distanceMeters / timeDiffSeconds;
  const speedMph = mpsToMph(speedMps);

  if (speedMph > 100) {
    lastPositions.set(key, { lat: vehicle.lat, lon: vehicle.lon, time: now });
    return null;
  }

  lastPositions.set(key, { lat: vehicle.lat, lon: vehicle.lon, time: now });
  return speedMph;
}

// Main collection loop
async function collectData() {
  console.log(
    `[${formatTime(
      new Date(),
    )}] Fetching Philadelphia SEPTA vehicle positions...`,
  );

  try {
    // Fetch all routes in parallel
    const allVehicles = [];

    for (const routeNum of TROLLEY_ROUTES) {
      const vehicles = await fetchRouteVehicles(routeNum);
      allVehicles.push(...vehicles);
      // Small delay between requests to be polite
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`   Found ${allVehicles.length} Trolley vehicles`);

    if (allVehicles.length === 0) {
      console.log("   No Trolley vehicles found, skipping...");
      return;
    }

    const positionsToInsert = [];
    let speedCount = 0;

    for (const vehicle of allVehicles) {
      // Calculate speed from consecutive positions
      const speed = calculateSpeed(vehicle);
      if (speed !== null) speedCount++;

      positionsToInsert.push({
        vehicle_id: vehicle.vehicle_id,
        route_id: vehicle.route_id,
        direction_id: vehicle.direction_id,
        lat: vehicle.lat,
        lon: vehicle.lon,
        speed_calculated: speed,
        recorded_at: vehicle.recorded_at,
        city: "Philadelphia",
      });
    }

    if (positionsToInsert.length > 0) {
      const startTime = Date.now();
      const { error } = await supabase
        .from("vehicle_positions")
        .insert(positionsToInsert);

      if (error) {
        console.error("   Error saving to Supabase:", error.message);
      } else {
        const duration = Date.now() - startTime;
        console.log(
          `[${formatTime(new Date())}] Saved ${
            positionsToInsert.length
          } positions (${speedCount} with speed) in ${duration}ms`,
        );
      }
    }
  } catch (error) {
    console.error(`[${formatTime(new Date())}] Error:`, error.message);
  }
}

// Main entry point
async function main() {
  console.log("🚊 Philadelphia SEPTA Trolley Collector");
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Tracking routes: ${TROLLEY_ROUTES.join(", ")}`);
  console.log("");

  // Run immediately
  await collectData();

  // Then poll at interval
  setInterval(collectData, POLL_INTERVAL_MS);
}

main();
