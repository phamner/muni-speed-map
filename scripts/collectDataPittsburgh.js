#!/usr/bin/env node
/**
 * Pittsburgh "The T" Light Rail - Data Collector
 *
 * Polls Pittsburgh Regional Transit GTFS-RT API every 90 seconds and saves vehicle positions to Supabase.
 * Speed is calculated from consecutive GPS readings.
 *
 * Pittsburgh Regional Transit (PRT) provides GTFS-RT feeds:
 * Check https://www.rideprt.org/ for developer resources
 * Or search Transitland: https://www.transit.land/feeds
 *
 * Run with: node scripts/collectDataPittsburgh.js
 */

import { createClient } from "@supabase/supabase-js";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import dotenv from "dotenv";

dotenv.config();

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

// PRT GTFS-RT Vehicle Positions feed (train-specific feed)
// No API key needed - direct access
const VEHICLE_POSITIONS_URL =
  process.env.VEHICLE_POSITIONS_URL ||
  "https://truetime.portauthority.org/gtfsrt-train/vehicles";

// Light Rail route IDs
// Red Line (South Hills Village), Blue Line (Library), Silver Line (special service)
const LIGHT_RAIL_ROUTES = ["RED", "BLUE", "SLVR"];

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

  // Sanity check: Pittsburgh T max speed is around 50 mph
  if (speedMph > 60) {
    return null; // Likely GPS glitch
  }

  return Math.round(speedMph * 10) / 10;
}

// Check if route ID is a rail line
function isRailRoute(routeId) {
  return LIGHT_RAIL_ROUTES.some((r) => routeId.toUpperCase().includes(r));
}

// Normalize route ID to our format
function normalizeRouteId(routeId) {
  const upper = routeId.toUpperCase();
  for (const route of LIGHT_RAIL_ROUTES) {
    if (upper.includes(route)) {
      return route;
    }
  }
  return routeId;
}

// Fetch vehicle positions from GTFS-RT feed
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: {
        Accept: "application/x-protobuf",
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    // Check content-type before attempting protobuf decode
    const contentType = response.headers.get("content-type") || "";
    if (
      !/protobuf|octet|application\/x-protobuf|application\/proto/i.test(
        contentType
      )
    ) {
      const bodyText = await response.text();
      console.error(
        "GTFS-RT endpoint returned unexpected content-type:",
        contentType
      );
      console.error(
        "Response body (truncated):\n",
        bodyText.substring(0, 2000)
      );
      return [];
    }

    const buffer = await response.arrayBuffer();
    let feed;
    try {
      feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
      );
    } catch (err) {
      const asText = Buffer.from(buffer).toString("utf8");
      console.error(
        "Failed to decode GTFS-RT protobuf. First 2000 chars of response:\n",
        asText.substring(0, 2000)
      );
      console.error("Decode error:", err && err.message ? err.message : err);
      return [];
    }

    // Filter for light rail vehicles
    const railVehicles = feed.entity
      .filter(
        (entity) =>
          entity.vehicle &&
          entity.vehicle.trip &&
          isRailRoute(entity.vehicle.trip.routeId)
      )
      .map((entity) => {
        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id || entity.id;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;
        const timestamp =
          (v.timestamp?.low || v.timestamp) * 1000 || Date.now();

        // Calculate speed from consecutive GPS readings
        const calculatedSpeed = calculateSpeed(vehicleId, lat, lon, timestamp);

        return {
          vehicle_id: vehicleId,
          route_id: normalizeRouteId(v.trip.routeId),
          direction_id: String(v.trip.directionId || ""),
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: calculatedSpeed,
          recorded_at: new Date(timestamp).toISOString(),
          city: "Pittsburgh",
          headsign: null,
        };
      })
      .filter((v) => v.lat && v.lon && v.vehicle_id);

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
      `[${timestamp} ET] Saved ${count} Pittsburgh T rail positions ` +
        `(${withSpeed.length} with speed) in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log('🏗️ Pittsburgh "The T" Light Rail - Data Collector');
  console.log(
    `   Polling GTFS-RT API every ${POLL_INTERVAL_MS / 1000} seconds`
  );
  console.log(`   Tracking routes: ${LIGHT_RAIL_ROUTES.join(", ")}`);
  console.log("   Press Ctrl+C to stop\n");

  // Initial collection
  await collectOnce();

  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down Pittsburgh collector...");
  process.exit(0);
});

// Start the collector
runCollector();
