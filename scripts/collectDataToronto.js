#!/usr/bin/env node
/**
 * Toronto TTC Streetcar & LRT Data Collector
 *
 * Fetches real-time vehicle positions from:
 * 1. TTC's NextBus/Umo API for streetcars (501-512)
 * 2. TTC's GTFS-RT feed for LRT lines (Line 6 Finch West = route 806)
 *
 * Calculates speeds between consecutive readings and stores in Supabase.
 *
 * No API key required - TTC provides open data feeds.
 *
 * Usage: npm run collect:toronto
 */

// Node.js 16/18 polyfills for fetch and Headers
import fetch, { Headers, Request, Response } from "node-fetch";
global.fetch = fetch;
global.Headers = Headers;
global.Request = Request;
global.Response = Response;

import { createClient } from "@supabase/supabase-js";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

// Configuration
const SUPABASE_URL = "https://REDACTED_SUPABASE_REF.supabase.co";
const SUPABASE_ANON_KEY =
  "REDACTED_SUPABASE_KEY";

// TTC uses NextBus/Umo API for streetcars
const API_BASE_URL = "https://retro.umoiq.com/service/publicJSONFeed";

// TTC GTFS-RT feed for buses and LRT
const GTFS_RT_VEHICLE_POSITIONS_URL =
  "https://bustime.ttc.ca/gtfsrt/vehicles";

// Streetcar route tags (NextBus/Umo API)
const STREETCAR_ROUTES = [
  "501",
  "503",
  "504",
  "505",
  "506",
  "507",
  "508",
  "509",
  "510",
  "511",
  "512",
];

// LRT route IDs (GTFS-RT feed)
// Line 6 Finch West = 806 (opened Dec 7, 2025)
// Line 5 Eglinton = 805 (future, not yet open)
const LRT_ROUTES = ["806", "805"];

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    timeZone: "America/Toronto",
  });
}

// Fetch vehicle positions for a single route
async function fetchRouteVehicles(routeTag) {
  try {
    const url = `${API_BASE_URL}?command=vehicleLocations&a=ttc&r=${routeTag}&t=0`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.vehicle) {
      return [];
    }

    // Handle both single vehicle and array of vehicles
    const vehicles = Array.isArray(data.vehicle)
      ? data.vehicle
      : [data.vehicle];

    return vehicles.map((v) => ({
      vehicle_id: v.id,
      route_id: routeTag,
      direction_id: v.dirTag || "",
      lat: parseFloat(v.lat),
      lon: parseFloat(v.lon),
      speed_reported: v.speedKmHr ? parseFloat(v.speedKmHr) * 0.621371 : null, // Convert km/h to mph
      heading: v.heading ? parseFloat(v.heading) : null,
      recorded_at: v.secsSinceReport
        ? new Date(Date.now() - v.secsSinceReport * 1000).toISOString()
        : new Date().toISOString(),
      city: "Toronto",
    }));
  } catch (error) {
    console.error(`   Error fetching route ${routeTag}:`, error.message);
    return [];
  }
}

// Fetch LRT vehicle positions from GTFS-RT feed
async function fetchLrtVehicles() {
  try {
    const response = await fetch(GTFS_RT_VEHICLE_POSITIONS_URL);

    if (!response.ok) {
      throw new Error(`GTFS-RT API error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const lrtVehicles = [];
    const routeCounts = {};

    for (const entity of feed.entity) {
      if (!entity.vehicle || !entity.vehicle.position) continue;

      const routeId = entity.vehicle.trip?.routeId;
      if (!routeId || !LRT_ROUTES.includes(routeId)) continue;

      // Count vehicles per route for logging
      routeCounts[routeId] = (routeCounts[routeId] || 0) + 1;

      const position = entity.vehicle.position;
      const timestamp = entity.vehicle.timestamp
        ? new Date(Number(entity.vehicle.timestamp) * 1000)
        : new Date();

      lrtVehicles.push({
        vehicle_id: `LRT-${entity.vehicle.vehicle?.id || entity.id}`,
        route_id: routeId,
        direction_id: entity.vehicle.trip?.directionId?.toString() || "",
        lat: position.latitude,
        lon: position.longitude,
        // GTFS-RT speed is in m/s, convert to mph
        speed_reported: position.speed ? position.speed * 2.237 : null,
        heading: position.bearing || null,
        recorded_at: timestamp.toISOString(),
        city: "Toronto",
      });
    }

    // Log LRT route status
    console.log("   🚈 LRT Status:");
    for (const route of LRT_ROUTES) {
      const count = routeCounts[route] || 0;
      if (route === "806") {
        // Line 6 Finch West - special logging
        if (count > 0) {
          console.log(
            `      ✅ Line 6 Finch West (route 806): ${count} vehicle(s) ACTIVE`
          );
        } else {
          console.log(
            `      ⏳ Line 6 Finch West (route 806): No vehicles detected (waiting for data)`
          );
        }
      } else if (route === "805") {
        // Line 5 Eglinton - not yet open
        if (count > 0) {
          console.log(
            `      ✅ Line 5 Eglinton (route 805): ${count} vehicle(s) ACTIVE`
          );
        } else {
          console.log(
            `      ⏳ Line 5 Eglinton (route 805): Not yet operational`
          );
        }
      }
    }

    return lrtVehicles;
  } catch (error) {
    console.error("   Error fetching LRT data from GTFS-RT:", error.message);
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
    `[${formatTime(new Date())}] Fetching Toronto TTC vehicle positions...`
  );

  try {
    // Fetch streetcar data from NextBus/Umo API
    const streetcarVehicles = [];

    for (const routeTag of STREETCAR_ROUTES) {
      const vehicles = await fetchRouteVehicles(routeTag);
      streetcarVehicles.push(...vehicles);
      // Small delay between requests to be polite
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`   🚊 Found ${streetcarVehicles.length} Streetcar vehicles`);

    // Fetch LRT data from GTFS-RT feed
    const lrtVehicles = await fetchLrtVehicles();

    // Combine all vehicles
    const allVehicles = [...streetcarVehicles, ...lrtVehicles];

    if (allVehicles.length === 0) {
      console.log("   No vehicles found, skipping...");
      return;
    }

    const positionsToInsert = [];
    let speedCount = 0;

    for (const vehicle of allVehicles) {
      // Use reported speed if available, otherwise calculate
      let speed = vehicle.speed_reported;
      if (speed === null || speed === 0) {
        const calcSpeed = calculateSpeed(vehicle);
        if (calcSpeed !== null) speed = calcSpeed;
      }
      if (speed !== null) speedCount++;

      positionsToInsert.push({
        vehicle_id: vehicle.vehicle_id,
        route_id: vehicle.route_id,
        direction_id: vehicle.direction_id,
        lat: vehicle.lat,
        lon: vehicle.lon,
        speed_calculated: speed,
        recorded_at: vehicle.recorded_at,
        city: "Toronto",
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
  console.log("🚊 Toronto TTC Streetcar & LRT Collector");
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Streetcar routes: ${STREETCAR_ROUTES.join(", ")}`);
  console.log(`   LRT routes: ${LRT_ROUTES.join(", ")} (Line 6 Finch West, Line 5 Eglinton)`);
  console.log("");

  // Run immediately
  await collectData();

  // Then poll at interval
  setInterval(collectData, POLL_INTERVAL_MS);
}

main();
