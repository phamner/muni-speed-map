#!/usr/bin/env node

/**
 * San Diego MTS Trolley - GTFS-RT Collector
 *
 * Fetches GTFS-RT feed from MTS every 90 seconds and stores in Supabase.
 */

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import gtfs from "gtfs-realtime-bindings";
import dotenv from "dotenv";

dotenv.config();

const { transit_realtime } = gtfs;

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MTS_API_KEY = process.env.MTS_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

if (!MTS_API_KEY) {
  console.error("❌ Error: MTS_API_KEY environment variable is required");
  process.exit(1);
}

// Config
const URL = `https://realtime.sdmts.com/api/api/gtfs_realtime/vehicle-positions-for-agency/MTS.pb?key=${MTS_API_KEY}`;
const POLL_INTERVAL_MS = 90_000;
const TARGET_ROUTE_IDS = new Set(["510", "520", "530", "535"]); // Blue, Orange, Green, Silver lines

// Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Last positions for speed calculation
const lastPositions = new Map();

// Haversine distance
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compute speed in mph
function calculateSpeed(vehicle) {
  const id = vehicle.vehicle?.id; // Fixed: removed extra .vehicle
  const now = vehicle.timestamp * 1000;

  if (!id || !vehicle.position?.latitude || !vehicle.position?.longitude)
    return null;

  const lat = vehicle.position.latitude;
  const lon = vehicle.position.longitude;

  if (!lastPositions.has(id)) {
    lastPositions.set(id, { lat, lon, timestamp: now });
    return null;
  }

  const prev = lastPositions.get(id);
  const dt = (now - prev.timestamp) / 1000;
  const dist = haversine(prev.lat, prev.lon, lat, lon);

  lastPositions.set(id, { lat, lon, timestamp: now });

  if (dt < 5 || dt > 180 || dist < 1) return null;

  const speedMps = dist / dt;
  return Math.round(speedMps * 2.237 * 10) / 10;
}

// Fetch GTFS-RT
async function fetchTrolleyData() {
  console.log(
    `[${new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
    })}] Fetching San Diego trolley data…`,
  );

  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`GTFS-RT HTTP error: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const feed = gtfs.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer),
    );

    const trolleyVehicles = feed.entity
      .filter((e) => {
        const routeId = e.vehicle?.trip?.routeId;
        return routeId && TARGET_ROUTE_IDS.has(routeId);
      })
      .map((e) => {
        const v = e.vehicle;
        const routeId = v.trip?.routeId || null;
        const directionId = v.trip?.directionId?.toString() || null;
        const lat = v.position?.latitude || 0;
        const lon = v.position?.longitude || 0;
        const heading = v.position?.bearing || null;
        const timestamp = v.timestamp
          ? new Date(v.timestamp * 1000).toISOString()
          : new Date().toISOString();
        const speed = calculateSpeed(v);

        return {
          vehicle_id: v.vehicle?.id || null,
          route_id: routeId,
          direction_id: directionId,
          lat,
          lon,
          heading,
          speed_calculated: speed,
          recorded_at: timestamp,
          city: "San Diego",
        };
      })
      .filter((v) => v.lat && v.lon && v.vehicle_id);

    return trolleyVehicles;
  } catch (err) {
    console.error("❌ Error fetching San Diego GTFS-RT:", err.message);
    return [];
  }
}

// Save to Supabase
async function saveToDatabase(positions) {
  if (positions.length === 0) return;

  const { error } = await supabase.from("vehicle_positions").insert(positions);

  if (error) {
    console.error("❌ Error saving to Supabase:", error.message);
  } else {
    console.log(`✅ Saved ${positions.length} vehicle positions.`);
  }
}

// Main loop
async function collectOnce() {
  const positions = await fetchTrolleyData();
  await saveToDatabase(positions);
}

console.log("🌊 San Diego MTS Trolley Collector");
console.log(`   Polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`   Routes: ${[...TARGET_ROUTE_IDS].join(", ")}`);

await collectOnce();
setInterval(collectOnce, POLL_INTERVAL_MS);
