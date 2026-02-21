/**
 * metrostl_collector.js
 *
 * Roughly matches your San Diego collector style:
 * - Fetch GTFS-RT VehiclePositions protobuf
 * - Decode
 * - Filter to MetroLink (rail) routes using static GTFS routes.txt (route_type)
 * - Compute speed via haversine
 * - Insert into Supabase vehicle_positions
 *
 * Usage:
 *   node metrostl_collector.js
 *
 * Requires:
 *   npm i node-fetch @supabase/supabase-js gtfs-realtime-bindings adm-zip
 */

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import gtfs from "gtfs-realtime-bindings";
import AdmZip from "adm-zip";
import dotenv from "dotenv";

dotenv.config();

const { transit_realtime } = gtfs;

// -----------------------
// Config
// -----------------------
const CITY = "St. Louis";

const VEHICLES_URL =
  "https://www.metrostlouis.org/RealTimeData/StlRealTimeVehicles.pb";

const STATIC_GTFS_ZIP_URL =
  "https://www.metrostlouis.org/Transit/google_transit.zip";

const POLL_INTERVAL_MS = 90_000;

// If true, we fetch + parse static GTFS on boot and filter realtime to rail routes
const FILTER_TO_RAIL_ONLY = false;

// Which route_type values count as "rail-ish" for MetroLink.
// In GTFS: 0=Tram, 1=Subway, 2=Rail, 3=Bus, 4=Ferry, 5=Cable, 6=Gondola, 7=Funicular.
// MetroLink should be 0 or 2 in most feeds.
const RAIL_ROUTE_TYPES = new Set(["0", "2", "1"]);

// Supabase from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// -----------------------
// State
// -----------------------
const lastPositions = new Map(); // vehicleId -> {lat, lon, timestampMs}
let allowedRouteIds = null; // Set<string> of MetroLink route_ids (if FILTER_TO_RAIL_ONLY)

// -----------------------
// Utils: haversine + speed
// -----------------------
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

function calculateSpeedMph({ vehicleId, lat, lon, timestampMs }) {
  if (!vehicleId || !lat || !lon || !timestampMs) return null;

  if (!lastPositions.has(vehicleId)) {
    lastPositions.set(vehicleId, { lat, lon, timestampMs });
    return null;
  }

  const prev = lastPositions.get(vehicleId);
  const dt = (timestampMs - prev.timestampMs) / 1000;
  const dist = haversine(prev.lat, prev.lon, lat, lon);

  lastPositions.set(vehicleId, { lat, lon, timestampMs });

  // Similar sanity filters to your SD script
  if (dt < 5 || dt > 180 || dist < 1) return null;

  const speedMps = dist / dt;
  return Math.round(speedMps * 2.236936 * 10) / 10; // mph, 1 decimal
}

// -----------------------
// Load static GTFS to build a rail route whitelist
// -----------------------
async function loadRailRouteIdsFromStaticGtfs() {
  console.log(
    `[${new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
    })}] Downloading Metro STL static GTFS…`,
  );

  const res = await fetch(STATIC_GTFS_ZIP_URL);
  if (!res.ok) throw new Error(`Static GTFS HTTP error: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);

  const routesEntry = zip.getEntry("routes.txt");
  if (!routesEntry) throw new Error("routes.txt not found in static GTFS zip");

  const routesTxt = routesEntry.getData().toString("utf8");

  // Simple CSV parse: assumes no crazy quoted commas in routes.txt (usually safe)
  const lines = routesTxt.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const idxRouteId = header.indexOf("route_id");
  const idxRouteType = header.indexOf("route_type");

  if (idxRouteId === -1 || idxRouteType === -1) {
    throw new Error("routes.txt missing route_id or route_type columns");
  }

  const railIds = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const routeId = cols[idxRouteId];
    const routeType = cols[idxRouteType];

    if (routeId && routeType && RAIL_ROUTE_TYPES.has(routeType)) {
      railIds.add(routeId);
    }
  }

  console.log(
    `✅ Static GTFS parsed. Found ${railIds.size} rail-ish route_ids (types: ${[
      ...RAIL_ROUTE_TYPES,
    ].join(", ")}).`,
  );

  if (railIds.size > 0) {
    console.log(
      `   Example rail route_ids: ${[...railIds].slice(0, 20).join(", ")}`,
    );
  }

  return railIds;
}

// -----------------------
// Fetch + decode GTFS-RT VehiclePositions
// -----------------------
async function fetchMetroStlVehicles() {
  console.log(
    `[${new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
    })}] Fetching ${CITY} realtime vehicles…`,
  );

  try {
    const res = await fetch(VEHICLES_URL);
    if (!res.ok) throw new Error(`GTFS-RT HTTP error: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    // Map entities -> normalized rows
    const rows = feed.entity
      .filter((e) => e?.vehicle)
      .map((e) => {
        const v = e.vehicle;

        const vehicleId = v.vehicle?.id || null;
        const routeId = v.trip?.routeId || null;

        // Apply rail whitelist if enabled
        if (FILTER_TO_RAIL_ONLY && allowedRouteIds && routeId) {
          if (!allowedRouteIds.has(routeId)) return null;
        }

        const lat = v.position?.latitude || 0;
        const lon = v.position?.longitude || 0;
        const heading = v.position?.bearing || null;

        // GTFS-RT timestamps are seconds
        const tsSec = v.timestamp ?? null;
        const recordedAtIso = tsSec
          ? new Date(tsSec * 1000).toISOString()
          : new Date().toISOString();

        const timestampMs = tsSec ? tsSec * 1000 : Date.now();
        const speed = calculateSpeedMph({
          vehicleId,
          lat,
          lon,
          timestampMs,
        });

        const directionId =
          v.trip?.directionId !== undefined && v.trip?.directionId !== null
            ? String(v.trip.directionId)
            : null;

        return {
          vehicle_id: vehicleId,
          route_id: routeId,
          direction_id: directionId,
          lat,
          lon,
          heading,
          speed_calculated: speed,
          recorded_at: recordedAtIso,
          city: CITY,
        };
      })
      .filter((x) => x && x.lat && x.lon && x.vehicle_id);

    // Helpful debug: show top routeIds in this poll
    const counts = new Map();
    for (const r of rows) {
      counts.set(
        r.route_id ?? "(null)",
        (counts.get(r.route_id ?? "(null)") ?? 0) + 1,
      );
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`   Decoded ${rows.length} rows. Top route_ids:`, top);

    return rows;
  } catch (err) {
    console.error(`❌ Error fetching ${CITY} GTFS-RT:`, err?.message ?? err);
    return [];
  }
}

// -----------------------
// Save to Supabase
// -----------------------
async function saveToDatabase(positions) {
  if (!positions.length) return;

  const { error } = await supabase.from("vehicle_positions").insert(positions);

  if (error) {
    console.error("❌ Error saving to Supabase:", error.message);
  } else {
    console.log(`✅ Saved ${positions.length} vehicle positions.`);
  }
}

// -----------------------
// Main loop
// -----------------------
async function collectOnce() {
  const positions = await fetchMetroStlVehicles();
  await saveToDatabase(positions);
}

console.log("🚈 St. Louis Metro (MetroLink) Collector");
console.log(`   Polling every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`   Realtime: ${VEHICLES_URL}`);
console.log(`   Rail filter: ${FILTER_TO_RAIL_ONLY ? "ON" : "OFF"}`);

if (FILTER_TO_RAIL_ONLY) {
  try {
    allowedRouteIds = await loadRailRouteIdsFromStaticGtfs();
    if (!allowedRouteIds || allowedRouteIds.size === 0) {
      console.warn(
        "⚠️ Rail filter is ON but found 0 rail route_ids in static GTFS. " +
          "Either route_type values differ, or parsing failed. Consider setting FILTER_TO_RAIL_ONLY=false temporarily.",
      );
    }
  } catch (e) {
    console.warn(
      "⚠️ Failed to load static GTFS rail routes; proceeding without whitelist. Error:",
      e?.message ?? e,
    );
    allowedRouteIds = null;
  }
}

await collectOnce();
setInterval(collectOnce, POLL_INTERVAL_MS);
