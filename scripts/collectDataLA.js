#!/usr/bin/env node
/**
 * LA Metro Speed Map - Data Collector
 *
 * Connects to LA Metro WebSocket API and saves vehicle positions to Supabase.
 * LA Metro provides real-time speed data directly in the feed.
 *
 * Run with: node scripts/collectDataLA.js
 */

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

// Configuration from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}
const LA_METRO_WS_URL = "wss://api.metro.net/ws/LACMTA_Rail/vehicle_positions";

// LA Metro Rail lines (route codes)
// 801 = A Line (Blue), 802 = B Line (Red), 803 = C Line (Green)
// 804 = E Line (Expo), 805 = D Line (Purple), 806 = L Line (Gold), 807 = K Line (Crenshaw)
const METRO_LINES = ["801", "802", "803", "804", "805", "806", "807"];

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Collection interval - save all positions every 90 seconds (like SF)
const COLLECTION_INTERVAL_MS = 90000;

// Stale connection timeout - if no messages for 60 seconds, reconnect
const STALE_TIMEOUT_MS = 60000;

// Track the latest position for each vehicle in the current window
// We only keep the most recent position per vehicle
const currentWindowPositions = new Map();

// Track when we last received a message
let lastMessageTime = Date.now();
let staleChecker = null;
let currentWs = null;

// Convert meters per second to miles per hour
function mpsToMph(mps) {
  return mps * 2.237;
}

// Process a vehicle position message
function processVehicleMessage(data) {
  try {
    const vehicleData = data.vehicle;
    if (!vehicleData) return null;

    const trip = vehicleData.trip;
    const position = vehicleData.position;
    const vehicle = vehicleData.vehicle;

    if (!position || !position.latitude || !position.longitude) return null;

    const routeId = trip?.routeId || data.route_code;
    if (!METRO_LINES.includes(routeId)) return null;

    // LA Metro provides speed directly in m/s
    const speedMps = position.speed;
    const speedMph = speedMps != null ? mpsToMph(speedMps) : null;

    // Convert unix timestamp to ISO string
    const timestamp = vehicleData.timestamp
      ? new Date(parseInt(vehicleData.timestamp) * 1000).toISOString()
      : new Date().toISOString();

    return {
      vehicle_id: vehicle?.id || data.id,
      route_id: routeId,
      direction_id: String(trip?.directionId ?? ""),
      lat: position.latitude,
      lon: position.longitude,
      heading: position.bearing || null,
      speed_reported: speedMph,
      speed_calculated: speedMph, // LA Metro provides speed directly
      recorded_at: timestamp,
      city: "LA", // Distinguish from SF data
    };
  } catch (error) {
    console.error("Error processing message:", error.message);
    return null;
  }
}

// Save all positions from the current collection window
async function saveCollectionWindow() {
  // Get all positions from the current window
  const positions = Array.from(currentWindowPositions.values());
  currentWindowPositions.clear(); // Reset for next window

  if (positions.length === 0) {
    console.log("[" + getTimestamp() + " PT] No positions to save this window");
    return;
  }

  try {
    // Insert in batches of 50 to avoid hitting Supabase limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < positions.length; i += BATCH_SIZE) {
      const batch = positions.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("vehicle_positions").insert(batch);

      if (error) {
        console.error("Error saving positions:", error.message);
        return;
      }
    }

    const withSpeed = positions.filter(
      (v) => v.speed_calculated != null,
    ).length;
    console.log(
      `[${getTimestamp()} PT] Saved ${positions.length} LA Metro positions ` +
        `(${withSpeed} with speed)`,
    );
  } catch (error) {
    console.error("Error saving positions:", error.message);
  }
}

function getTimestamp() {
  return new Date().toLocaleString("en-US", {
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

// Connect to LA Metro WebSocket
function connectWebSocket() {
  console.log("🚊 Connecting to LA Metro WebSocket...");

  // Clear any existing stale checker
  if (staleChecker) {
    clearInterval(staleChecker);
    staleChecker = null;
  }

  const ws = new WebSocket(LA_METRO_WS_URL);
  currentWs = ws;

  ws.on("open", () => {
    console.log("✅ Connected to LA Metro WebSocket");
    console.log(`   Tracking lines: ${METRO_LINES.join(", ")}`);
    console.log("   Press Ctrl+C to stop\n");

    // Reset message timer on connect
    lastMessageTime = Date.now();

    // Start stale connection checker
    staleChecker = setInterval(() => {
      const timeSinceLastMessage = Date.now() - lastMessageTime;
      if (timeSinceLastMessage > STALE_TIMEOUT_MS) {
        console.log(
          `⚠️ No messages for ${STALE_TIMEOUT_MS / 1000}s, forcing reconnection...`,
        );
        clearInterval(staleChecker);
        staleChecker = null;
        ws.terminate(); // Force close the stale connection
        connectWebSocket();
      }
    }, 30000); // Check every 30 seconds
  });

  ws.on("message", (data) => {
    // Update last message time on every message
    lastMessageTime = Date.now();

    try {
      const message = JSON.parse(data.toString());
      const position = processVehicleMessage(message);

      if (position) {
        // Store the latest position for this vehicle in the current window
        // This overwrites any previous position for the same vehicle
        currentWindowPositions.set(position.vehicle_id, position);
      }
    } catch (error) {
      // Some messages may not be valid JSON, skip them
    }
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket disconnected. Reconnecting in 5 seconds...");
    if (staleChecker) {
      clearInterval(staleChecker);
      staleChecker = null;
    }
    setTimeout(connectWebSocket, 5000);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });
}

// Main function
async function runCollector() {
  console.log("🚊 LA Metro Speed Map - Data Collector");
  console.log("   Using WebSocket for real-time vehicle positions");
  console.log(
    `   Saving all positions every ${COLLECTION_INTERVAL_MS / 1000} seconds`,
  );

  // Start WebSocket connection
  connectWebSocket();

  // Save all collected positions every 90 seconds (like SF)
  setInterval(saveCollectionWindow, COLLECTION_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on("SIGINT", async () => {
  console.log("\n\n👋 Shutting down LA Metro collector...");
  await saveCollectionWindow(); // Save any remaining positions
  process.exit(0);
});

// Start the collector
runCollector();
