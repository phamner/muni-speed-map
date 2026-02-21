#!/usr/bin/env node
/**
 * Portland Streetcar - Data Collector
 * 
 * Polls UMO IQ (NextBus) API every 90 seconds and saves vehicle positions to Supabase.
 * The API provides speed directly in km/h.
 * 
 * Portland Streetcar has three lines:
 * - 193: NS Line (North-South, Green color #72A130)
 * - 194: A Loop (Orange color #D91965)
 * - 195: B Loop (Blue color #4650BE)
 * 
 * UMO IQ API (no key required):
 * https://retro.umoiq.com/service/publicXMLFeed?command=vehicleLocations&a=portland-sc&t=0
 * 
 * Run with: node scripts/collectDataPortlandStreetcar.js
 */

import fetch, { Headers, Request, Response } from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { parseStringPromise } from "xml2js";
import dotenv from "dotenv";

dotenv.config();

// Polyfill for Node.js 18 (required by newer Supabase client)
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

// UMO IQ (NextBus) API for Portland Streetcar
const VEHICLE_POSITIONS_URL =
  "https://retro.umoiq.com/service/publicXMLFeed?command=vehicleLocations&a=portland-sc&t=0";

// Streetcar route IDs (same as TriMet GTFS)
const STREETCAR_ROUTES = ["193", "194", "195"];

const POLL_INTERVAL_MS = 90000; // 90 seconds

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Convert km/h to mph
function kmhToMph(kmh) {
  return Math.round(kmh * 0.621371 * 10) / 10;
}

// Fetch vehicle positions from UMO IQ API
async function fetchVehiclePositions() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: {
        Accept: "application/xml",
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const result = await parseStringPromise(xmlText);

    const vehicles = result?.body?.vehicle || [];
    
    if (!Array.isArray(vehicles)) {
      return [];
    }

    // Map to our format
    const streetcarVehicles = vehicles
      .map((v) => {
        const attrs = v.$ || v;
        const routeTag = attrs.routeTag;
        
        // Filter for known streetcar routes
        if (!STREETCAR_ROUTES.includes(routeTag)) {
          return null;
        }

        const lat = parseFloat(attrs.lat);
        const lon = parseFloat(attrs.lon);
        const speedKmh = parseFloat(attrs.speedKmHr) || 0;
        const speedMph = kmhToMph(speedKmh);
        const vehicleId = attrs.id;
        const heading = parseFloat(attrs.heading) || null;
        const secsSinceReport = parseInt(attrs.secsSinceReport) || 0;

        // Filter out invalid coordinates
        if (!lat || !lon || lat === 0 || lon === 0) {
          return null;
        }

        // Calculate timestamp from secsSinceReport
        const timestamp = new Date(Date.now() - secsSinceReport * 1000);

        return {
          vehicle_id: vehicleId,
          route_id: routeTag,
          direction_id: attrs.dirTag || "",
          lat: lat,
          lon: lon,
          heading: heading,
          speed_calculated: speedMph,
          recorded_at: timestamp.toISOString(),
          city: "Portland",
          headsign: null,
        };
      })
      .filter((v) => v !== null && v.lat && v.lon && v.vehicle_id);

    return streetcarVehicles;
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
    console.log(`[${new Date().toISOString()}] No streetcar vehicles found`);
    return;
  }

  // Count by route
  const nsLine = vehicles.filter((v) => v.route_id === "193").length;
  const aLoop = vehicles.filter((v) => v.route_id === "194").length;
  const bLoop = vehicles.filter((v) => v.route_id === "195").length;

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
      `[${timestamp} PT] Saved ${count} Portland Streetcar positions ` +
        `(NS: ${nsLine}, A: ${aLoop}, B: ${bLoop}, ${withSpeed.length} with speed) in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log("🚃 Portland Streetcar - Data Collector");
  console.log(`   Polling UMO IQ API every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Tracking routes: ${STREETCAR_ROUTES.join(", ")} (NS Line, A Loop, B Loop)`);
  console.log("   Press Ctrl+C to stop\n");

  // Initial collection
  await collectOnce();

  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down Portland Streetcar collector...");
  process.exit(0);
});

// Start the collector
runCollector();
