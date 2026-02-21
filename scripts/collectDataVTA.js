#!/usr/bin/env node
/**
 * VTA (San Jose) Light Rail Data Collector
 *
 * Polls 511.org GTFS-RT VehiclePositions for VTA (agency=SC) and saves
 * VTA Light Rail vehicle positions to Supabase.
 *
 * Uses the same 511.org API key as SF Muni.
 *
 * Run with: npm run collect:vta
 */

import fetch, { Headers, Request, Response } from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
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
const API_KEY_511 = process.env.API_511_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

if (!API_KEY_511) {
  console.error("❌ Error: API_511_KEY environment variable is required");
  process.exit(1);
}

// 511 GTFS-RT VehiclePositions for VTA (agency code: SC)
const VEHICLE_POSITIONS_URL = `https://api.511.org/Transit/VehiclePositions?api_key=${API_KEY_511}&agency=SC`;

// VTA Light Rail route IDs from 511.org GTFS-RT
const LIGHT_RAIL_ROUTES = new Set(["Blue Line", "Green Line", "Orange Line"]);

const POLL_INTERVAL_MS = 90000; // 90 seconds
const CITY = "San Jose";

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Store previous positions for speed calculation
const previousPositions = new Map();

// Haversine distance between two points in meters
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

// Calculate speed from previous position
function calculateSpeed(vehicleId, lat, lon, timestamp) {
  const prev = previousPositions.get(vehicleId);
  previousPositions.set(vehicleId, { lat, lon, timestamp });

  if (!prev) return null;

  const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
  if (timeDiffSeconds < 5 || timeDiffSeconds > 300) return null;

  const distanceMeters = haversineDistance(prev.lat, prev.lon, lat, lon);
  if (distanceMeters < 1) return 0;

  const speedMph = (distanceMeters / timeDiffSeconds) * 2.237;
  if (speedMph > 80) return null; // Sanity check

  return Math.round(speedMph * 10) / 10;
}

// Normalize route ID to display name (strip " Line" suffix)
function normalizeRouteId(routeId) {
  if (!routeId) return null;

  // Remove " Line" suffix to get just "Blue", "Green", "Orange"
  return routeId.replace(" Line", "");
}

// Fetch vehicle positions from 511.org
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: { Accept: "application/x-protobuf" },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    // Filter for light rail vehicles
    const lightRailVehicles = feed.entity
      .filter((entity) => {
        const routeId = entity.vehicle?.trip?.routeId;
        return routeId && LIGHT_RAIL_ROUTES.has(routeId);
      })
      .map((entity) => {
        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id || entity.id;
        const lat = v.position?.latitude;
        const lon = v.position?.longitude;
        const timestamp =
          (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
        const routeId = normalizeRouteId(v.trip?.routeId);

        const speed = calculateSpeed(vehicleId, lat, lon, timestamp);

        return {
          vehicle_id: vehicleId,
          route_id: routeId,
          direction_id: String(v.trip?.directionId || ""),
          lat,
          lon,
          heading: v.position?.bearing || null,
          speed_calculated: speed,
          recorded_at: new Date(timestamp).toISOString(),
          city: CITY,
          headsign: null,
        };
      })
      .filter((v) => v.lat && v.lon && v.route_id);

    return lightRailVehicles;
  } catch (error) {
    console.error("Error fetching vehicle positions:", error.message);
    return [];
  }
}

// Save positions to Supabase
async function savePositions(positions) {
  if (positions.length === 0) return { count: 0 };

  const { error } = await supabase.from("vehicle_positions").insert(positions);

  if (error) {
    console.error("Error saving positions:", error.message);
    return { count: 0, error };
  }

  return { count: positions.length };
}

// Format timestamp for logging
function formatTime(date) {
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Main collection loop
async function collectOnce() {
  const startTime = Date.now();

  const vehicles = await fetchVehiclePositions();

  if (vehicles.length === 0) {
    console.log(
      `[${formatTime(new Date())} PT] No VTA light rail vehicles found`
    );
    return;
  }

  const withSpeed = vehicles.filter((v) => v.speed_calculated !== null);
  const { count, error } = await savePositions(vehicles);

  const elapsed = Date.now() - startTime;

  // Count by line
  const byLine = {};
  vehicles.forEach((v) => {
    byLine[v.route_id] = (byLine[v.route_id] || 0) + 1;
  });
  const lineBreakdown = Object.entries(byLine)
    .map(([line, count]) => `${line}:${count}`)
    .join(" ");

  if (error) {
    console.log(`[${formatTime(new Date())} PT] Error: ${error.message}`);
  } else {
    console.log(
      `[${formatTime(new Date())} PT] Saved ${count} VTA positions ` +
        `(${withSpeed.length} with speed) [${lineBreakdown}] in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log("🚊 VTA Light Rail (San Jose) - Data Collector");
  console.log(
    `   Polling 511.org API every ${POLL_INTERVAL_MS / 1000} seconds`
  );
  console.log(`   Tracking lines: Blue, Green, Orange`);
  console.log("   Press Ctrl+C to stop\n");

  // Initial collection
  await collectOnce();

  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down VTA collector...");
  process.exit(0);
});

// Start the collector
runCollector();
