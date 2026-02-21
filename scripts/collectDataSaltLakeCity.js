#!/usr/bin/env node
/**
 * Salt Lake City TRAX Light Rail - Data Collector
 *
 * Polls Utah Transit Authority (UTA) GTFS-RT API every 90 seconds and saves vehicle positions to Supabase.
 *
 * UTA's GTFS-RT feed doesn't include routeId, only tripId.
 * We load the static GTFS trips.txt to map tripId -> routeId, then filter for TRAX routes.
 *
 * Speed is provided directly in the GTFS-RT feed.
 *
 * Run with: node scripts/collectDataSaltLakeCity.js
 */

import { createClient } from "@supabase/supabase-js";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import fetch, { Headers } from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Polyfill fetch and Headers for older Node.js versions
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
}
if (!globalThis.Headers) {
  globalThis.Headers = Headers;
}
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

// GTFS-RT feed URLs
const VEHICLE_POSITIONS_URL = "https://apps.rideuta.com/tms/gtfs/Vehicle";

// TRAX Light Rail route IDs (from UTA GTFS routes.txt)
// These are internal route_id values, not the public route numbers
const TRAX_ROUTE_IDS = {
  "5907": "Blue",    // 701 Blue Line
  "8246": "Red",     // 703 Red Line
  "39020": "Green",  // 704 Green Line
  "45389": "S-Line", // 720 S-Line (Sugar House Streetcar)
};

// Fallback aliases observed in some GTFS-RT trip descriptors
// (public-facing route IDs/codes instead of internal GTFS route_id values).
const TRAX_ROUTE_ALIASES = {
  ...TRAX_ROUTE_IDS,
  "701": "Blue",
  "703": "Red",
  "704": "Green",
  "720": "S-Line",
  Blue: "Blue",
  Red: "Red",
  Green: "Green",
  "S-Line": "S-Line",
  "S Line": "S-Line",
  SLINE: "S-Line",
};

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Map of tripId -> routeId (loaded from GTFS)
let tripToRouteMap = new Map();

// Load trips.txt from GTFS and build tripId -> routeId map
function loadTripsFromGtfs() {
  const tripsPath = path.join(__dirname, "../gtfs_slc/trips.txt");
  
  if (!fs.existsSync(tripsPath)) {
    console.error("⚠️  trips.txt not found at", tripsPath);
    console.error("   Run: cd gtfs_slc && curl -L -o gtfs.zip 'https://apps.rideuta.com/tms/gtfs/Static' && unzip -o gtfs.zip");
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
    
    // Only store TRAX trips
    if (TRAX_ROUTE_IDS[routeId]) {
      tripToRouteMap.set(tripId, {
        routeId: routeId,
        lineName: TRAX_ROUTE_IDS[routeId],
        headsign: headsign,
        directionId: directionId,
      });
      traxTripCount++;
    }
  }

  console.log(`   Loaded ${traxTripCount} TRAX trips from GTFS`);
  return true;
}

// Fetch vehicle positions from GTFS-RT feed
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: { Accept: "application/x-protobuf" },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/protobuf|octet/i.test(contentType)) {
      const bodyText = await response.text();
      console.error("Unexpected content-type:", contentType);
      console.error("Response (truncated):\n", bodyText.substring(0, 500));
      return [];
    }

    const buffer = await response.arrayBuffer();
    let feed;
    try {
      feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
      );
    } catch (err) {
      console.error("Failed to decode GTFS-RT:", err.message);
      return [];
    }

    // Filter for TRAX vehicles using tripId lookup with routeId fallback.
    const railVehicles = [];
    let totalVehicles = 0;
    let withTrip = 0;
    let tripMapped = 0;
    let routeFallbackMapped = 0;
    
    for (const entity of feed.entity) {
      if (!entity.vehicle) continue;
      totalVehicles++;
      if (!entity.vehicle.trip) continue;
      withTrip++;
      
      const tripId = entity.vehicle.trip.tripId;
      let tripInfo = tripToRouteMap.get(tripId);
      if (tripInfo) {
        tripMapped++;
      } else {
        // Fallback: some UTA feeds publish routeId values that don't align
        // with local trips.txt trip_ids; use routeId aliases when available.
        const rawRouteId = entity.vehicle.trip.routeId?.toString()?.trim();
        const lineName = rawRouteId ? TRAX_ROUTE_ALIASES[rawRouteId] : null;
        if (lineName) {
          tripInfo = {
            routeId: rawRouteId,
            lineName,
            headsign: entity.vehicle.trip.tripHeadsign || "",
            directionId: entity.vehicle.trip.directionId?.toString() || "0",
          };
          routeFallbackMapped++;
        }
      }

      if (!tripInfo) continue; // Not a TRAX trip
      
      const v = entity.vehicle;
      const vehicleId = v.vehicle?.id || entity.id;
      const lat = v.position?.latitude;
      const lon = v.position?.longitude;
      const timestamp = (v.timestamp?.low || v.timestamp) * 1000 || Date.now();
      
      // Speed is provided in m/s, convert to mph
      const speedMs = v.position?.speed;
      const speedMph = speedMs != null ? Math.round(speedMs * 2.237 * 10) / 10 : null;

      if (lat && lon && vehicleId) {
        railVehicles.push({
          vehicle_id: vehicleId,
          route_id: tripInfo.lineName,
          direction_id: tripInfo.directionId,
          lat: lat,
          lon: lon,
          heading: v.position?.bearing || null,
          speed_calculated: speedMph, // API-provided speed (stored in speed_calculated column)
          recorded_at: new Date(timestamp).toISOString(),
          city: "Salt Lake City",
          headsign: tripInfo.headsign || null,
        });
      }
    }

    if (totalVehicles > 0) {
      console.log(
        `   UTA feed diagnostics: total=${totalVehicles}, withTrip=${withTrip}, tripMapped=${tripMapped}, routeFallbackMapped=${routeFallbackMapped}`,
      );
    }

    return railVehicles;
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

// Main collection loop
async function collectOnce() {
  const startTime = Date.now();
  const vehicles = await fetchVehiclePositions();

  if (vehicles.length === 0) {
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "America/Denver",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    console.log(`[${timestamp} MT] No TRAX vehicles found (may be outside service hours)`);
    return;
  }

  // Count vehicles with speed data
  const withSpeed = vehicles.filter((v) => v.speed_calculated !== null).length;
  
  // Group by line
  const byLine = {};
  for (const v of vehicles) {
    byLine[v.route_id] = (byLine[v.route_id] || 0) + 1;
  }

  const { count, error } = await savePositions(vehicles);

  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/Denver",
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
    const lineBreakdown = Object.entries(byLine)
      .map(([line, count]) => `${line}:${count}`)
      .join(" ");
    console.log(
      `[${timestamp} MT] Saved ${count} TRAX positions (${withSpeed} with speed) [${lineBreakdown}] in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log("🏔️ Salt Lake City TRAX Light Rail - Data Collector");
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log("   Tracking: Blue (701), Red (703), Green (704), S-Line (720)");
  
  // Load GTFS data
  if (!loadTripsFromGtfs()) {
    console.error("\n❌ Failed to load GTFS data. Exiting.");
    process.exit(1);
  }
  
  console.log("   Press Ctrl+C to stop\n");

  await collectOnce();
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down Salt Lake City collector...");
  process.exit(0);
});

runCollector();
