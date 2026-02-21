#!/usr/bin/env node
/**
 * Sacramento SacRT Light Rail Data Collector
 *
 * Fetches real-time vehicle positions from SacRT's GTFS-RT feed,
 * calculates speeds between consecutive readings, and stores in Supabase.
 *
 * Uses precise track matching to identify light rail vehicles since SacRT
 * doesn't tag light rail with route IDs in their GTFS-RT feed.
 *
 * No API key required - SacRT provides open GTFS-RT feeds.
 *
 * Usage: npm run collect:sacramento
 */

import { createClient } from "@supabase/supabase-js";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

dotenv.config();

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

// SacRT GTFS-RT endpoint (no API key needed)
const GTFS_RT_URL = "https://bustime.sacrt.com/gtfsrt/vehicles";

// Maximum distance from track to be considered light rail (in meters)
const MAX_DISTANCE_FROM_TRACK = 50;

// Poll interval in milliseconds (90 seconds)
const POLL_INTERVAL = 90000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Load track geometry
let trackSegments = [];

function loadTrackGeometry() {
  try {
    const routesPath = join(
      __dirname,
      "../src/data/sacramentoLightRailRoutes.json",
    );
    const routesData = JSON.parse(readFileSync(routesPath, "utf8"));

    // Extract all line segments from the route geometry
    trackSegments = [];
    for (const feature of routesData.features) {
      const coords = feature.geometry.coordinates;
      const routeId = feature.properties.route_id;

      for (let i = 0; i < coords.length - 1; i++) {
        trackSegments.push({
          routeId,
          lon1: coords[i][0],
          lat1: coords[i][1],
          lon2: coords[i + 1][0],
          lat2: coords[i + 1][1],
        });
      }
    }

    console.log(`Loaded ${trackSegments.length} track segments`);
  } catch (error) {
    console.error("Error loading track geometry:", error);
    trackSegments = [];
  }
}

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

// Calculate minimum distance from a point to a line segment
function pointToSegmentDistance(lat, lon, seg) {
  const { lat1, lon1, lat2, lon2 } = seg;

  // Vector from segment start to point
  const dx = lon - lon1;
  const dy = lat - lat1;

  // Vector along segment
  const segDx = lon2 - lon1;
  const segDy = lat2 - lat1;

  // Project point onto segment line
  const segLengthSq = segDx * segDx + segDy * segDy;

  if (segLengthSq === 0) {
    // Segment is a point
    return haversineDistance(lat, lon, lat1, lon1);
  }

  // Parameter t indicates where on the segment the closest point is
  let t = (dx * segDx + dy * segDy) / segLengthSq;
  t = Math.max(0, Math.min(1, t)); // Clamp to segment

  // Closest point on segment
  const closestLon = lon1 + t * segDx;
  const closestLat = lat1 + t * segDy;

  return haversineDistance(lat, lon, closestLat, closestLon);
}

// Find the closest track segment and return distance + route
function findNearestTrack(lat, lon) {
  let minDistance = Infinity;
  let nearestRoute = null;

  for (const seg of trackSegments) {
    const dist = pointToSegmentDistance(lat, lon, seg);
    if (dist < minDistance) {
      minDistance = dist;
      nearestRoute = seg.routeId;
    }
  }

  return { distance: minDistance, routeId: nearestRoute };
}

// Check if a vehicle is on the light rail track
function isOnLightRailTrack(lat, lon) {
  if (trackSegments.length === 0) {
    console.warn("No track geometry loaded - using fallback bounds check");
    return isLikelyLightRailFallback(lat, lon);
  }

  const { distance } = findNearestTrack(lat, lon);
  return distance <= MAX_DISTANCE_FROM_TRACK;
}

// Fallback: loose bounding box check (used if geometry fails to load)
function isLikelyLightRailFallback(lat, lon) {
  // Very rough bounds for Sacramento light rail
  if (lat < 38.45 || lat > 38.7 || lon < -121.55 || lon > -121.15) {
    return false;
  }
  return true;
}

// Determine which line based on nearest track
function determineRoute(lat, lon) {
  if (trackSegments.length === 0) {
    return guessLineFromPositionFallback(lat, lon);
  }

  const { distance, routeId } = findNearestTrack(lat, lon);

  if (distance > MAX_DISTANCE_FROM_TRACK) {
    return null;
  }

  // Check if in shared downtown section
  if (lat >= 38.55 && lat <= 38.6 && lon >= -121.51 && lon <= -121.46) {
    return "Shared";
  }

  return routeId;
}

// Fallback route guessing
function guessLineFromPositionFallback(lat, lon) {
  if (lon > -121.4 && lat >= 38.6) return "Gold";
  if (lat < 38.54) return "Blue";
  if (lat >= 38.6 && lon <= -121.32 && lon >= -121.42) return "Blue";
  if (lat >= 38.55 && lat <= 38.6 && lon >= -121.52 && lon <= -121.44)
    return "Shared";
  return "Unknown";
}

// Store for calculating speed between readings
const lastPositions = new Map();

// Calculate speed between two positions
function calculateSpeed(
  prevLat,
  prevLon,
  prevTime,
  currLat,
  currLon,
  currTime,
) {
  const distance = haversineDistance(prevLat, prevLon, currLat, currLon);
  const timeDiff = (currTime - prevTime) / 1000; // Convert to seconds

  if (timeDiff <= 0 || timeDiff > 600) {
    // Ignore if time diff is 0 or > 10 minutes
    return null;
  }

  const speedMps = distance / timeDiff;
  const speedMph = speedMps * 2.237;

  // Sanity check: light rail max speed is about 55 mph
  if (speedMph > 70) {
    return null;
  }

  return speedMph;
}

async function collectData() {
  console.log(
    `[${new Date().toLocaleString()}] Fetching Sacramento SacRT vehicle positions...`,
  );

  try {
    const response = await fetch(GTFS_RT_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer),
    );

    const positions = [];
    let lightRailCount = 0;
    let rejectedCount = 0;

    for (const entity of feed.entity) {
      if (!entity.vehicle) continue;

      const vehicle = entity.vehicle;
      const lat = vehicle.position?.latitude;
      const lon = vehicle.position?.longitude;
      const timestamp = vehicle.timestamp
        ? Number(vehicle.timestamp) * 1000
        : Date.now();
      const vehicleId = vehicle.vehicle?.id || entity.id;
      const reportedSpeed = vehicle.position?.speed; // m/s if available

      if (!lat || !lon) continue;

      // Check if this vehicle is on the light rail track
      if (!isOnLightRailTrack(lat, lon)) {
        rejectedCount++;
        continue;
      }

      lightRailCount++;

      // Determine which line
      const routeId = determineRoute(lat, lon);
      if (!routeId) continue;

      // Calculate speed from previous position
      let calculatedSpeed = null;
      const prevPos = lastPositions.get(vehicleId);

      if (prevPos) {
        calculatedSpeed = calculateSpeed(
          prevPos.lat,
          prevPos.lon,
          prevPos.timestamp,
          lat,
          lon,
          timestamp,
        );
      }

      // Update last position
      lastPositions.set(vehicleId, { lat, lon, timestamp });

      // Convert reported speed from m/s to mph if available
      const speedMph = reportedSpeed != null ? reportedSpeed * 2.237 : null;

      positions.push({
        vehicle_id: vehicleId,
        route_id: routeId,
        direction_id: null,
        lat,
        lon,
        speed_reported: speedMph,
        speed_calculated: calculatedSpeed,
        recorded_at: new Date(timestamp).toISOString(),
        city: "Sacramento",
      });
    }

    console.log(
      `   Found ${lightRailCount} vehicles on track, rejected ${rejectedCount} off-track`,
    );

    if (positions.length === 0) {
      console.log("   No positions to save");
      return;
    }

    // Insert into Supabase
    const startTime = Date.now();
    const { error } = await supabase
      .from("vehicle_positions")
      .insert(positions);

    if (error) {
      console.error("Error saving to Supabase:", error);
    } else {
      const withSpeed = positions.filter(
        (p) => p.speed_calculated != null,
      ).length;
      console.log(
        `[${new Date().toLocaleString()}] Saved ${
          positions.length
        } positions (${withSpeed} with speed) in ${Date.now() - startTime}ms`,
      );
    }
  } catch (error) {
    console.error("Error collecting data:", error);
  }
}

// Main
async function main() {
  console.log("Sacramento SacRT Light Rail Collector");
  console.log("=====================================");
  console.log(`Max distance from track: ${MAX_DISTANCE_FROM_TRACK}m`);
  console.log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log("");

  // Load track geometry
  loadTrackGeometry();
  console.log("");

  // Run immediately
  await collectData();

  // Then poll at interval
  setInterval(collectData, POLL_INTERVAL);
}

main().catch(console.error);
