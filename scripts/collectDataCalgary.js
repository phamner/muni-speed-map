#!/usr/bin/env node

/**
 * Calgary Transit - All Vehicle Data Collector
 *
 * Collects ALL Calgary Transit vehicle positions (buses, CTrain, etc.)
 * No filtering by route type - shows complete transit picture
 *
 * Run: node scripts/collectDataCalgary.js
 */

import fetch from "node-fetch";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const VEHICLE_POSITIONS_URL =
  "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream";

const POLL_INTERVAL_MS = 90_000;

// Supabase configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Store previous positions for speed calculation
const previousPositions = new Map();

// Haversine distance between two points in meters
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

  // Sanity check: transit shouldn't exceed 80 mph generally
  if (speedMph > 80) {
    return null; // Likely GPS glitch
  }

  return Math.round(speedMph * 10) / 10;
}

// Fetch ALL Calgary Transit vehicle positions (no filtering)
async function fetchAllVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL);

    if (!response.ok) {
      throw new Error(`Vehicle Positions API error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer),
    );

    // Process ALL vehicles (no route filtering)
    const allVehicles = (feed.entity || [])
      .map((entity) => {
        if (!entity.vehicle) return null;

        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id || entity.id;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;

        // Only filter out completely invalid coordinates
        if (!lat || !lon || lat === 0 || lon === 0) {
          return null;
        }

        const timestamp =
          (v.timestamp?.low || v.timestamp) * 1000 || Date.now();

        // Get route info (may be null for some vehicles)
        const routeId = v.trip?.routeId || "unknown";

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
          route_id: routeId,
          direction_id: String(v.trip?.directionId || ""),
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: speed,
          recorded_at: new Date(timestamp).toISOString(),
          city: "Calgary",
          headsign: v.vehicle?.label || null,
        };
      })
      .filter((v) => v !== null && v.lat && v.lon && v.vehicle_id);

    return allVehicles;
  } catch (error) {
    console.error("Error fetching vehicle positions:", error.message);
    return [];
  }
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
  const vehicles = await fetchAllVehiclePositions();

  if (vehicles.length === 0) {
    console.log(
      `[${new Date().toISOString()}] No Calgary Transit vehicles found`,
    );
    return;
  }

  // Count by route type
  const routeCounts = {};
  vehicles.forEach((v) => {
    const route = v.route_id;
    routeCounts[route] = (routeCounts[route] || 0) + 1;
  });

  // Count vehicles with speed data
  const withSpeed = vehicles.filter((v) => v.speed_calculated !== null);

  // Save to database
  const { count, error } = await savePositions(vehicles);

  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/Denver", // Calgary is MST
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  if (error) {
    console.log(`[${timestamp} MT] Error: ${error.message}`);
  } else {
    const routeBreakdown = Object.entries(routeCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10) // Show top 10 routes
      .map(([route, count]) => `${route}:${count}`)
      .join(", ");

    console.log(
      `[${timestamp} MT] Saved ${count} Calgary Transit positions ` +
        `(${withSpeed.length} with speed) in ${elapsed}ms`,
    );
    console.log(
      `   Routes: ${routeBreakdown}${Object.keys(routeCounts).length > 10 ? "..." : ""}`,
    );
  }
}

// Run continuously
async function runCollector() {
  console.log("🚃 Calgary Transit - All Vehicle Data Collector");
  console.log(
    `   Polling GTFS-RT API every ${POLL_INTERVAL_MS / 1000} seconds`,
  );
  console.log(`   Collecting ALL transit vehicles (buses, CTrain, etc.)`);
  console.log("   Press Ctrl+C to stop\n");

  // Initial collection
  await collectOnce();

  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down Calgary collector...");
  process.exit(0);
});

// Start the collector
runCollector();
