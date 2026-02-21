#!/usr/bin/env node
/**
 * Portland MAX Speed Map - Data Collector
 *
 * Polls TriMet Vehicles API every 90 seconds and saves vehicle positions to Supabase.
 * Speed is calculated from consecutive GPS readings since TriMet doesn't provide it.
 *
 * Run with: node scripts/collectDataPortland.js
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRIMET_APP_ID = process.env.TRIMET_APP_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

if (!TRIMET_APP_ID) {
  console.error("❌ Error: TRIMET_APP_ID environment variable is required");
  process.exit(1);
}

// MAX Light Rail lines (route IDs)
// 90 = MAX Red, 100 = MAX Blue, 190 = MAX Yellow, 200 = MAX Green, 290 = MAX Orange
const MAX_LINES = ["90", "100", "190", "200", "290"];

// Portland Streetcar lines (route IDs)
// 193 = NS Line, 194 = A Loop, 195 = B Loop
const STREETCAR_LINES = ["193", "194", "195"];

// All rail lines (MAX + Streetcar)
const RAIL_LINES = [...MAX_LINES, ...STREETCAR_LINES];
const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
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

  // Sanity check: light rail shouldn't exceed 60 mph
  if (speedMph > 70) {
    return null; // Likely GPS glitch
  }

  return Math.round(speedMph * 10) / 10;
}

// Fetch vehicle positions from TriMet Vehicles API
async function fetchVehiclePositions() {
  try {
    // TriMet Vehicles API returns all vehicles
    const response = await fetch(
      `https://developer.trimet.org/ws/v2/vehicles?appID=${TRIMET_APP_ID}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const vehicles = data?.resultSet?.vehicle || [];

    // Filter for MAX and Streetcar lines
    const railVehicles = vehicles
      .filter((v) => RAIL_LINES.includes(String(v.routeNumber)))
      .map((v) => {
        const vehicleId = String(v.vehicleID);
        const lat = parseFloat(v.latitude);
        const lon = parseFloat(v.longitude);
        const timestamp = v.time || Date.now();

        // Calculate speed from consecutive GPS readings
        const calculatedSpeed = calculateSpeed(vehicleId, lat, lon, timestamp);

        return {
          vehicle_id: vehicleId,
          route_id: String(v.routeNumber),
          direction_id: String(v.direction || ""),
          lat: lat,
          lon: lon,
          heading: v.bearing ? parseFloat(v.bearing) : null,
          speed_calculated: calculatedSpeed,
          recorded_at: v.time
            ? new Date(v.time).toISOString()
            : new Date().toISOString(),
          city: "Portland",
          headsign: v.signMessage || null, // Destination shown on train
        };
      })
      .filter((v) => v.lat !== 0 && v.lon !== 0 && v.vehicle_id);

    return railVehicles;
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
  const vehicles = await fetchVehiclePositions();

  if (vehicles.length === 0) {
    console.log(`[${new Date().toISOString()}] No vehicles found`);
    return;
  }

  // Count vehicles with speed data
  const withSpeed = vehicles.filter((v) => v.speed_calculated !== null);

  // Save to database
  const { count, error } = await savePositions(vehicles);

  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  if (error) {
    console.log(`[${timestamp} PT] Error: ${error.message}`);
  } else {
    console.log(
      `[${timestamp} PT] Saved ${count} Portland rail positions ` +
        `(${withSpeed.length} with speed) in ${elapsed}ms`,
    );
  }
}

// Run continuously
async function runCollector() {
  // Check for API key
  if (TRIMET_APP_ID === "YOUR_TRIMET_APP_ID_HERE") {
    console.error("❌ ERROR: Please set your TriMet AppID in this file!");
    console.error("   Register for free at: https://developer.trimet.org/");
    console.error("   Then replace YOUR_TRIMET_APP_ID_HERE with your AppID");
    process.exit(1);
  }

  console.log("🌲 Portland MAX & Streetcar Speed Map - Data Collector");
  console.log(`   Polling TriMet API every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Tracking MAX routes: ${MAX_LINES.join(", ")}`);
  console.log(`   Tracking Streetcar routes: ${STREETCAR_LINES.join(", ")}`);
  console.log("   Press Ctrl+C to stop\n");

  // Initial collection
  await collectOnce();

  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down Portland collector...");
  process.exit(0);
});

// Start the collector
runCollector();
