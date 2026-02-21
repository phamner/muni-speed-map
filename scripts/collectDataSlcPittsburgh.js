#!/usr/bin/env node
/**
 * Combined Data Collector: Salt Lake City (TRAX) + Pittsburgh (The T)
 *
 * Runs both collectors in parallel, polling every 90 seconds.
 *
 * Run with: node scripts/collectDataSlcPittsburgh.js
 * Or: npm run collect:slc-pit
 */

import { createClient } from "@supabase/supabase-js";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import fetch, { Headers } from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

// Polyfill fetch and Headers for older Node.js versions
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
}
if (!globalThis.Headers) {
  globalThis.Headers = Headers;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============= SALT LAKE CITY (TRAX) =============

// TRAX route IDs from UTA GTFS
const TRAX_ROUTE_IDS = {
  5907: "Blue", // 701 Blue Line
  8246: "Red", // 703 Red Line
  39020: "Green", // 704 Green Line
  45389: "S-Line", // 720 S-Line
};

// Map of tripId -> routeId (loaded from GTFS)
let tripToRouteMap = new Map();

function loadSlcTripsFromGtfs() {
  const tripsPath = path.join(__dirname, "../gtfs_slc/trips.txt");

  if (!fs.existsSync(tripsPath)) {
    console.error("⚠️  SLC trips.txt not found");
    return false;
  }

  const content = fs.readFileSync(tripsPath, "utf8");
  const lines = content.split("\n");
  const header = lines[0].split(",");

  const routeIdIdx = header.indexOf("route_id");
  const tripIdIdx = header.indexOf("trip_id");
  const headsignIdx = header.indexOf("trip_headsign");
  const directionIdx = header.indexOf("direction_id");

  let traxTripCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 3) continue;

    const routeId = cols[routeIdIdx];
    const tripId = cols[tripIdIdx];
    const headsign = cols[headsignIdx] || "";
    const directionId = cols[directionIdx] || "0";

    if (TRAX_ROUTE_IDS[routeId]) {
      tripToRouteMap.set(tripId, {
        lineName: TRAX_ROUTE_IDS[routeId],
        headsign: headsign,
        directionId: directionId,
      });
      traxTripCount++;
    }
  }

  console.log(`   Salt Lake City: Loaded ${traxTripCount} TRAX trips`);
  return true;
}

async function fetchSlcVehicles() {
  try {
    const response = await fetch("https://apps.rideuta.com/tms/gtfs/Vehicle", {
      headers: { Accept: "application/x-protobuf" },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (!/protobuf|octet/i.test(contentType)) {
      console.error("[SLC] Unexpected content-type:", contentType);
      return [];
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const vehicles = [];

    for (const entity of feed.entity) {
      if (!entity.vehicle || !entity.vehicle.trip) continue;

      const tripId = entity.vehicle.trip.tripId;
      const tripInfo = tripToRouteMap.get(tripId);
      if (!tripInfo) continue;

      const v = entity.vehicle;
      const vehicleId = v.vehicle?.id || entity.id;
      const lat = v.position?.latitude;
      const lon = v.position?.longitude;
      const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
      const speedMs = v.position?.speed;
      const speedMph =
        speedMs != null ? Math.round(speedMs * 2.237 * 10) / 10 : null;

      if (lat && lon && vehicleId) {
        vehicles.push({
          vehicle_id: vehicleId,
          route_id: tripInfo.lineName,
          direction_id: tripInfo.directionId,
          lat,
          lon,
          heading: v.position?.bearing || null,
          speed_calculated: speedMph,
          recorded_at: new Date(timestamp).toISOString(),
          city: "Salt Lake City",
          headsign: tripInfo.headsign || null,
        });
      }
    }

    return vehicles;
  } catch (error) {
    console.error("[SLC] Error:", error.message);
    return [];
  }
}

// ============= PITTSBURGH (The T) =============

const PITTSBURGH_ROUTES = ["RED", "BLUE", "SLV", "SLVR", "SILVER"];

function isPittsburghRailRoute(routeId) {
  if (!routeId) return false;
  const upper = routeId.toUpperCase();
  return PITTSBURGH_ROUTES.some((r) => upper.includes(r));
}

function normalizePittsburghRoute(routeId) {
  const upper = (routeId || "").toUpperCase();
  if (upper.includes("RED")) return "RED";
  if (upper.includes("BLUE")) return "BLUE";
  if (upper.includes("SLV") || upper.includes("SILVER")) return "SLVR";
  return routeId;
}

// Store previous positions for Pittsburgh speed calculation
const pittsburghPrevPositions = new Map();

function calculatePittsburghSpeed(vehicleId, lat, lon, timestamp) {
  const prev = pittsburghPrevPositions.get(vehicleId);
  pittsburghPrevPositions.set(vehicleId, { lat, lon, timestamp });

  if (!prev) return null;

  const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
  if (timeDiffSeconds < 30 || timeDiffSeconds > 300) return null;

  const R = 6371000;
  const dLat = ((lat - prev.lat) * Math.PI) / 180;
  const dLon = ((lon - prev.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((prev.lat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const distanceMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (distanceMeters < 5) return 0;

  const speedMph = (distanceMeters / timeDiffSeconds) * 2.237;
  if (speedMph > 60) return null;

  return Math.round(speedMph * 10) / 10;
}

async function fetchPittsburghVehicles() {
  try {
    const response = await fetch(
      "https://truetime.portauthority.org/gtfsrt-train/vehicles",
      {
        headers: { Accept: "application/x-protobuf" },
      }
    );

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (!/protobuf|octet/i.test(contentType)) {
      console.error("[Pittsburgh] Unexpected content-type:", contentType);
      return [];
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const vehicles = [];

    for (const entity of feed.entity) {
      if (!entity.vehicle) continue;

      const v = entity.vehicle;
      const routeId = v.trip?.routeId;

      if (!isPittsburghRailRoute(routeId)) continue;

      const vehicleId = v.vehicle?.id || entity.id;
      const lat = v.position?.latitude;
      const lon = v.position?.longitude;
      const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();

      // Pittsburgh provides speed in the feed
      let speedMph = null;
      if (v.position?.speed != null) {
        speedMph = Math.round(v.position.speed * 2.237 * 10) / 10;
      } else {
        speedMph = calculatePittsburghSpeed(vehicleId, lat, lon, timestamp);
      }

      if (lat && lon && vehicleId) {
        vehicles.push({
          vehicle_id: vehicleId,
          route_id: normalizePittsburghRoute(routeId),
          direction_id: String(v.trip?.directionId || ""),
          lat,
          lon,
          heading: v.position?.bearing || null,
          speed_calculated: speedMph,
          recorded_at: new Date(timestamp).toISOString(),
          city: "Pittsburgh",
          headsign: null,
        });
      }
    }

    return vehicles;
  } catch (error) {
    console.error("[Pittsburgh] Error:", error.message);
    return [];
  }
}

// ============= MAIN =============

async function savePositions(positions) {
  if (positions.length === 0) return { count: 0 };

  const { error } = await supabase.from("vehicle_positions").insert(positions);

  if (error) {
    console.error("Error saving positions:", error.message);
    return { count: 0, error };
  }

  return { count: positions.length };
}

async function collectOnce() {
  const [slcVehicles, pittsburghVehicles] = await Promise.all([
    fetchSlcVehicles(),
    fetchPittsburghVehicles(),
  ]);

  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Salt Lake City
  if (slcVehicles.length > 0) {
    const { count, error } = await savePositions(slcVehicles);
    const withSpeed = slcVehicles.filter(
      (v) => v.speed_calculated !== null
    ).length;
    const byLine = {};
    slcVehicles.forEach(
      (v) => (byLine[v.route_id] = (byLine[v.route_id] || 0) + 1)
    );
    const lineStr = Object.entries(byLine)
      .map(([l, c]) => `${l}:${c}`)
      .join(" ");

    if (error) {
      console.log(`[${timestamp}] 🏔️ SLC: Error - ${error.message}`);
    } else {
      console.log(
        `[${timestamp}] 🏔️ SLC: ${count} positions (${withSpeed} speed) [${lineStr}]`
      );
    }
  } else {
    console.log(`[${timestamp}] 🏔️ SLC: No TRAX vehicles found`);
  }

  // Pittsburgh
  if (pittsburghVehicles.length > 0) {
    const { count, error } = await savePositions(pittsburghVehicles);
    const withSpeed = pittsburghVehicles.filter(
      (v) => v.speed_calculated !== null
    ).length;
    const byLine = {};
    pittsburghVehicles.forEach(
      (v) => (byLine[v.route_id] = (byLine[v.route_id] || 0) + 1)
    );
    const lineStr = Object.entries(byLine)
      .map(([l, c]) => `${l}:${c}`)
      .join(" ");

    if (error) {
      console.log(`[${timestamp}] 🏗️ PIT: Error - ${error.message}`);
    } else {
      console.log(
        `[${timestamp}] 🏗️ PIT: ${count} positions (${withSpeed} speed) [${lineStr}]`
      );
    }
  } else {
    console.log(`[${timestamp}] 🏗️ PIT: No T vehicles found`);
  }
}

async function runCollector() {
  console.log("🚊 Combined Data Collector: Salt Lake City + Pittsburgh");
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log("   Salt Lake City (TRAX): Blue, Red, Green, S-Line");
  console.log("   Pittsburgh (The T): RED, BLUE, SLVR");

  if (!loadSlcTripsFromGtfs()) {
    console.error("⚠️  SLC GTFS not loaded - SLC collection will not work");
  }

  console.log("   Press Ctrl+C to stop\n");

  await collectOnce();
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down combined collector...");
  process.exit(0);
});

runCollector();
