/**
 * Seattle Sound Transit Link Light Rail Data Collector
 *
 * Fetches real-time vehicle positions from Sound Transit's OneBusAway API,
 * calculates speeds between consecutive readings, and stores in Supabase.
 *
 * Prerequisites:
 * - API key from Sound Transit (request at https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-terms-of-use)
 *
 * Usage: npm run collect:seattle
 */

import fetch, { Headers, Request, Response } from 'node-fetch';
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

dotenv.config();

// Polyfill for Node.js 16 (required by newer Supabase client)
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OBA_API_KEY = process.env.OBA_API_KEY;
const DEBUG_LOGGING = process.env.SEATTLE_COLLECTOR_DEBUG === "1";
const SAVED_POINTS_LOG_FILE =
  process.env.SEATTLE_SAVED_POINTS_LOG_FILE || "logs/seattle-saved-points.ndjson";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

if (!OBA_API_KEY) {
  console.error("❌ Error: OBA_API_KEY environment variable is required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const OBA_BASE_URL = "https://api.pugetsound.onebusaway.org/api/where";

// Sound Transit Link Light Rail agency ID
const AGENCY_ID = "40";

// Polling interval in milliseconds (90 seconds to match SF)
const POLL_INTERVAL_MS = 90 * 1000;

// Link Light Rail line IDs and display names
const LINK_LINES = {
  "100479": "1 Line",   // 1 Line (Lynnwood to Federal Way)
  "2LINE": "2 Line",    // 2 Line (Seattle to Redmond)
  "TLINE": "T Line",    // T Line (Tacoma Link)
};

// Store previous positions for speed calculation
const previousPositions = new Map();
// Store last raw observation to skip stale duplicate API snapshots
const lastRawObservations = new Map();

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
    timeZone: "America/Los_Angeles",
  });
}

// Extract route ID from tripId (e.g., "40_LLR_2026-01-13_Jan5_Link_20260113_Tuesday_100479_2098" -> "100479")
function extractRouteIdFromTripId(tripId) {
  if (!tripId) return null;
  
  // Check for each known line ID in the tripId
  for (const lineId of Object.keys(LINK_LINES)) {
    if (tripId.includes(lineId)) {
      return lineId;
    }
  }
  return null;
}

// Fetch vehicles for an agency from OneBusAway API
async function fetchVehicles() {
  const url = `${OBA_BASE_URL}/vehicles-for-agency/${AGENCY_ID}.json?key=${OBA_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== 200) {
    throw new Error(`API returned error code: ${data.code} - ${data.text}`);
  }

  return data.data?.list || [];
}

// Calculate speed from previous position
function calculateSpeed(vehicleId, lat, lon, timestamp) {
  const prev = previousPositions.get(vehicleId);

  if (!prev) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return null;
  }

  const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;

  // Only calculate speed if time gap is reasonable (5-180 seconds)
  if (timeDiffSeconds < 5 || timeDiffSeconds > 180) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return null;
  }

  const distanceMeters = haversineDistance(prev.lat, prev.lon, lat, lon);

  // Sanity check: if distance is too small, treat as 0 speed (stationary)
  if (distanceMeters < 1) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return 0;
  }

  // Convert to mph
  const speedMps = distanceMeters / timeDiffSeconds;
  const speedMph = speedMps * 2.237;

  // Sanity check: if calculated speed seems unreasonable (>100 mph), ignore
  if (speedMph > 100) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return null;
  }

  previousPositions.set(vehicleId, { lat, lon, timestamp });
  return speedMph;
}

function isStaleObservation(vehicleId, lat, lon, timestamp) {
  const prev = lastRawObservations.get(vehicleId);
  if (!prev) return false;
  return prev.lat === lat && prev.lon === lon && prev.timestamp === timestamp;
}

function rememberObservation(vehicleId, lat, lon, timestamp) {
  lastRawObservations.set(vehicleId, { lat, lon, timestamp });
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx];
}

async function appendSavedPointsLog(positions, pollTimeMs) {
  // if (!positions.length) return;
  // const absolutePath = path.resolve(process.cwd(), SAVED_POINTS_LOG_FILE);
  // await mkdir(path.dirname(absolutePath), { recursive: true });
  // const insertedAt = new Date(pollTimeMs).toISOString();
  // const lines = positions
  //   .map((position) =>
  //     JSON.stringify({
  //       inserted_at: insertedAt,
  //       vehicle_id: position.vehicle_id,
  //       route_id: position.route_id,
  //       lat: position.lat,
  //       lon: position.lon,
  //       recorded_at: position.recorded_at,
  //       speed_calculated: position.speed_calculated,
  //     }),
  //   )
  //   .join("\n");
  // await appendFile(absolutePath, `${lines}\n`, "utf8");
  console.log('fake save append seattle data')
}

// Main collection loop
async function collectData() {
  console.log(
    `[${formatTime(new Date())}] Fetching Sound Transit vehicle positions...`,
  );

  try {
    const vehicles = await fetchVehicles();

    // Filter to only Link Light Rail (route ID is embedded in tripId)
    const linkVehicles = vehicles.filter((v) => {
      const routeId = extractRouteIdFromTripId(v.tripId);
      return routeId !== null;
    });

    console.log(
      `   Found ${linkVehicles.length} Link vehicles (agency total: ${vehicles.length})`,
    );

    if (linkVehicles.length === 0) {
      console.log("   No Link vehicles found, skipping...");
      return;
    }

    const nowMs = Date.now();
    const positionsToInsert = [];
    let speedCount = 0;
    let staleSkipped = 0;
    let missingFieldSkipped = 0;
    let sameCoordsNewTimestamp = 0;
    let sameTimestampMoved = 0;
    const staleByVehicle = new Map();
    const ageSeconds = [];
    const perRouteFreshCounts = {
      "100479": 0,
      "2LINE": 0,
      "TLINE": 0,
    };

    for (const vehicle of linkVehicles) {
      const vehicleId =
        vehicle.vehicleId?.split("_").pop() || vehicle.vehicleId;
      const routeId = extractRouteIdFromTripId(vehicle.tripId);
      const lat = vehicle.location?.lat;
      const lon = vehicle.location?.lon;
      const directionId = null; // Not directly available in this API
      const timestamp = vehicle.lastLocationUpdateTime || Date.now();

      if (!lat || !lon || !routeId) {
        missingFieldSkipped++;
        continue;
      }
      const prevRaw = lastRawObservations.get(vehicleId);
      if (prevRaw) {
        const sameCoords = prevRaw.lat === lat && prevRaw.lon === lon;
        const sameTimestamp = prevRaw.timestamp === timestamp;
        if (sameCoords && !sameTimestamp) sameCoordsNewTimestamp++;
        if (!sameCoords && sameTimestamp) sameTimestampMoved++;
      }
      if (isStaleObservation(vehicleId, lat, lon, timestamp)) {
        staleSkipped++;
        staleByVehicle.set(vehicleId, (staleByVehicle.get(vehicleId) || 0) + 1);
        continue;
      }
      rememberObservation(vehicleId, lat, lon, timestamp);

      // Calculate speed from consecutive readings
      const speed = calculateSpeed(vehicleId, lat, lon, timestamp);
      if (speed !== null) speedCount++;
      ageSeconds.push(Math.max(0, (nowMs - timestamp) / 1000));
      perRouteFreshCounts[routeId] = (perRouteFreshCounts[routeId] || 0) + 1;

      positionsToInsert.push({
        vehicle_id: vehicleId,
        route_id: routeId,
        direction_id: String(directionId),
        lat: lat,
        lon: lon,
        speed_calculated: speed,
        recorded_at: new Date(timestamp).toISOString(),
        city: "Seattle",
      });
    }

    const avgAge =
      ageSeconds.length > 0
        ? ageSeconds.reduce((a, b) => a + b, 0) / ageSeconds.length
        : null;
    const p50Age = percentile(ageSeconds, 50);
    const p90Age = percentile(ageSeconds, 90);
    const maxAge = ageSeconds.length > 0 ? Math.max(...ageSeconds) : null;

    if (positionsToInsert.length > 0) {
      const startTime = Date.now();
      const { error } = await supabase
        .from("vehicle_positions")
        .insert(positionsToInsert);

      if (error) {
        console.error("   Error saving to Supabase:", error.message);
      } else {
        try {
          await appendSavedPointsLog(positionsToInsert, nowMs);
        } catch (logError) {
          console.error("   Warning: failed to write local saved-points log:", logError.message);
        }
        const duration = Date.now() - startTime;
        console.log(
          `[${formatTime(new Date())}] Saved ${positionsToInsert.length} positions (${speedCount} with speed, skipped ${staleSkipped} stale) in ${duration}ms`,
        );
        console.log(
          `   Logged saved coordinates to ${path.resolve(process.cwd(), SAVED_POINTS_LOG_FILE)}`,
        );
        console.log(
          `   Fresh by route: 1=${perRouteFreshCounts["100479"]}, 2=${perRouteFreshCounts["2LINE"]}, T=${perRouteFreshCounts["TLINE"]}`,
        );
        console.log(
          `   Diagnostics: missing=${missingFieldSkipped}, sameCoords+newTs=${sameCoordsNewTimestamp}, sameTs+moved=${sameTimestampMoved}`,
        );
        if (avgAge != null) {
          console.log(
            `   OBA location age (sec): avg=${avgAge.toFixed(1)} p50=${p50Age?.toFixed(1)} p90=${p90Age?.toFixed(1)} max=${maxAge?.toFixed(1)}`,
          );
        }
        if (DEBUG_LOGGING && staleByVehicle.size > 0) {
          const topStale = Array.from(staleByVehicle.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, c]) => `${id}:${c}`)
            .join(", ");
          console.log(`   Debug stale top vehicles: ${topStale}`);
        }
      }
    } else if (staleSkipped > 0) {
      console.log(`   Skipped ${staleSkipped} stale duplicate observations`);
    }
  } catch (error) {
    console.error(`[${formatTime(new Date())}] Error:`, error.message);

    if (error.message.includes("401")) {
      console.error(
        "   ⚠️  Invalid API key. Please set SOUND_TRANSIT_API_KEY in your .env file.",
      );
      console.error(
        "   Request an API key at: https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-terms-of-use",
      );
    }
  }
}

// Main entry point
async function main() {
  console.log("🚃 Seattle Sound Transit Link Light Rail Collector");
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Tracking lines: ${Object.values(LINK_LINES).join(", ")}`);
  console.log(
    `   Logging saved coordinates to ${path.resolve(process.cwd(), SAVED_POINTS_LOG_FILE)}`,
  );
  console.log("");

  if (OBA_API_KEY === "YOUR_API_KEY_HERE" || !OBA_API_KEY) {
    console.log("⚠️  WARNING: No API key configured!");
    console.log("   Set SOUND_TRANSIT_API_KEY in your .env file");
    console.log(
      "   Request a key at: https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-terms-of-use",
    );
    console.log("");
    console.log("❌ Cannot run without API key. Exiting.");
    console.log("   Once you have a key, update OBA_API_KEY in this file.");
    process.exit(1);
  }

  // Run immediately
  await collectData();

  // Then poll at interval
  setInterval(collectData, POLL_INTERVAL_MS);
}

main();
