#!/usr/bin/env node
/**
 * Boston Green Line Speed Map - Data Collector
 *
 * Polls MBTA V3 API every 90 seconds and saves vehicle positions to Supabase.
 * Also calculates speed from consecutive positions.
 *
 * Run with: node scripts/collectDataBoston.js
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MBTA_API_KEY = process.env.MBTA_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

if (!MBTA_API_KEY) {
  console.error("❌ Error: MBTA_API_KEY environment variable is required");
  process.exit(1);
}

// Green Line branches
const GREEN_LINE_ROUTES = ["Green-B", "Green-C", "Green-D", "Green-E"];
const POLL_INTERVAL_MS = 90000; // 90 seconds (matching SF collector rate)

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Store last known positions for speed calculation
const lastPositions = new Map();

// Calculate distance between two points in meters (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
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

// Fetch vehicle positions from MBTA V3 API
async function fetchVehiclePositions() {
  try {
    // Query vehicles for all Green Line routes
    const routeFilter = GREEN_LINE_ROUTES.join(",");
    const response = await fetch(
      `https://api-v3.mbta.com/vehicles?filter[route]=${routeFilter}&api_key=${MBTA_API_KEY}`,
      {
        headers: {
          Accept: "application/vnd.api+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const vehicles = data?.data || [];

    // Map MBTA API response to our format
    const metroVehicles = vehicles
      .map((v) => {
        const attrs = v.attributes || {};
        const lat = attrs.latitude;
        const lon = attrs.longitude;
        const routeId = v.relationships?.route?.data?.id;

        // Skip vehicles without valid position data
        if (!lat || !lon || !routeId) return null;

        return {
          vehicle_id: v.id || "",
          route_id: routeId,
          direction_id: String(attrs.direction_id || ""),
          lat: parseFloat(lat),
          lon: parseFloat(lon),
          heading: attrs.bearing ? parseFloat(attrs.bearing) : null,
          speed_reported: attrs.speed ? parseFloat(attrs.speed) : null,
          recorded_at: attrs.updated_at || new Date().toISOString(),
          city: "Boston",
        };
      })
      .filter((v) => v !== null && v.lat !== 0 && v.lon !== 0 && v.vehicle_id);

    return metroVehicles;
  } catch (error) {
    console.error("Error fetching vehicle positions:", error.message);
    return [];
  }
}

// Calculate speed from last known position
function calculateSpeed(vehicle) {
  const key = vehicle.vehicle_id;
  const lastPos = lastPositions.get(key);

  if (lastPos) {
    const timeDiffSeconds =
      (new Date(vehicle.recorded_at) - new Date(lastPos.recorded_at)) / 1000;

    // Only calculate if reasonable time gap (5-180 seconds)
    // 90s polling interval means most gaps will be ~90s
    if (timeDiffSeconds > 5 && timeDiffSeconds < 180) {
      const distanceMeters = haversineDistance(
        lastPos.lat,
        lastPos.lon,
        vehicle.lat,
        vehicle.lon,
      );

      // Filter out GPS jumps (unrealistic speeds > 80 mph)
      const speedMps = distanceMeters / timeDiffSeconds;
      const speedMph = mpsToMph(speedMps);

      if (speedMph >= 0 && speedMph <= 80) {
        vehicle.speed_calculated = Math.round(speedMph * 10) / 10;
      }
    }
  }

  // Update last known position
  lastPositions.set(key, {
    lat: vehicle.lat,
    lon: vehicle.lon,
    recorded_at: vehicle.recorded_at,
  });

  return vehicle;
}

// Save positions to Supabase
async function savePositions(positions) {
  if (positions.length === 0) return { count: 0 };

  const { data, error } = await supabase
    .from("vehicle_positions")
    .insert(positions);

  if (error) {
    console.error("Error saving positions:", error.message);
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

  // Calculate speeds
  const vehiclesWithSpeed = vehicles.map(calculateSpeed);

  // Count vehicles with calculated speeds
  const withSpeed = vehiclesWithSpeed.filter(
    (v) => v.speed_calculated !== undefined,
  );

  // Save to database
  const { count, error } = await savePositions(vehiclesWithSpeed);

  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  if (error) {
    console.log(`[${timestamp} ET] Error: ${error.message}`);
  } else {
    console.log(
      `[${timestamp} ET] Saved ${count} Boston Green Line positions ` +
        `(${withSpeed.length} with speed) in ${elapsed}ms`,
    );
  }
}

// Run continuously
async function runCollector() {
  console.log("🦞 Boston Green Line Speed Map - Data Collector");
  console.log(
    `   Polling MBTA V3 API every ${POLL_INTERVAL_MS / 1000} seconds`,
  );
  console.log(`   Tracking routes: ${GREEN_LINE_ROUTES.join(", ")}`);
  console.log("   Press Ctrl+C to stop\n");

  // Initial collection
  await collectOnce();

  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down Boston collector...");
  process.exit(0);
});

// Start the collector
runCollector();
