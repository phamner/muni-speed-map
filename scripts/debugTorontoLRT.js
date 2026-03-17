#!/usr/bin/env node
/**
 * Toronto LRT Debug Script
 *
 * Diagnostic tool for Lines 5 (Eglinton) and 6 (Finch West).
 * Does NOT write to Supabase — read-only, logging only.
 *
 * Fetches the TTC GTFS-RT vehicle positions feed and reports:
 *   - Whether the feed is reachable and parseable
 *   - Every unique route_id in the feed (to find LRT route IDs)
 *   - Whether routes 805 / 806 appear
 *   - Full vehicle details for any LRT matches
 *   - Sample raw entity for inspection
 *
 * Usage: node scripts/debugTorontoLRT.js
 */

import fetch from "node-fetch";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const GTFS_RT_URL = "https://bustime.ttc.ca/gtfsrt/vehicles";
const TARGET_ROUTES = ["805", "806"];
const ROUTE_NAMES = {
  805: "Line 5 Eglinton",
  806: "Line 6 Finch West",
};

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

async function debugFetch() {
  console.log("=".repeat(70));
  console.log("🔍 Toronto LRT Debug — Lines 5 & 6");
  console.log(`   Time: ${formatTime(new Date())}`);
  console.log(`   Feed: ${GTFS_RT_URL}`);
  console.log(`   Looking for route IDs: ${TARGET_ROUTES.join(", ")}`);
  console.log("=".repeat(70));
  console.log();

  // Step 1: Fetch the feed
  console.log("Step 1: Fetching GTFS-RT feed...");
  let response;
  try {
    response = await fetch(GTFS_RT_URL);
  } catch (err) {
    console.error("❌ NETWORK ERROR: Could not reach the feed URL");
    console.error(`   ${err.message}`);
    return;
  }

  console.log(`   HTTP status: ${response.status} ${response.statusText}`);
  console.log(
    `   Content-Type: ${response.headers.get("content-type") || "(none)"}`,
  );
  console.log(
    `   Content-Length: ${response.headers.get("content-length") || "(unknown)"} bytes`,
  );

  if (!response.ok) {
    console.error(`❌ Feed returned non-200 status: ${response.status}`);
    const text = await response.text().catch(() => "(unreadable)");
    console.error(`   Response body: ${text.substring(0, 500)}`);
    return;
  }
  console.log("   ✅ Feed is reachable\n");

  // Step 2: Parse protobuf
  console.log("Step 2: Parsing GTFS-RT protobuf...");
  let feed;
  try {
    const buffer = await response.arrayBuffer();
    console.log(`   Raw buffer size: ${buffer.byteLength} bytes`);
    feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer),
    );
  } catch (err) {
    console.error("❌ PARSE ERROR: Could not decode protobuf");
    console.error(`   ${err.message}`);
    return;
  }

  const feedTimestamp = feed.header?.timestamp
    ? new Date(Number(feed.header.timestamp) * 1000)
    : null;
  console.log(
    `   Feed version: ${feed.header?.gtfsRealtimeVersion || "unknown"}`,
  );
  console.log(
    `   Feed timestamp: ${feedTimestamp ? formatTime(feedTimestamp) : "unknown"}`,
  );
  console.log(`   Total entities: ${feed.entity.length}`);
  console.log("   ✅ Feed parsed successfully\n");

  // Step 3: Catalog all route IDs in the feed
  console.log("Step 3: Scanning all route IDs in feed...");
  const routeCounts = {};
  let noRouteCount = 0;
  let noVehicleCount = 0;

  for (const entity of feed.entity) {
    if (!entity.vehicle) {
      noVehicleCount++;
      continue;
    }
    const routeId = entity.vehicle.trip?.routeId;
    if (!routeId) {
      noRouteCount++;
      continue;
    }
    routeCounts[routeId] = (routeCounts[routeId] || 0) + 1;
  }

  const sortedRoutes = Object.entries(routeCounts).sort((a, b) => b[1] - a[1]);
  const uniqueRouteCount = sortedRoutes.length;

  console.log(`   Entities without vehicle data: ${noVehicleCount}`);
  console.log(`   Vehicles without route_id: ${noRouteCount}`);
  console.log(`   Unique route IDs found: ${uniqueRouteCount}`);
  console.log();

  // Highlight LRT-related routes
  const lrtHits = sortedRoutes.filter(([id]) => TARGET_ROUTES.includes(id));
  const possibleLrt = sortedRoutes.filter(
    ([id]) =>
      id.includes("805") ||
      id.includes("806") ||
      id.toLowerCase().includes("eglinton") ||
      id.toLowerCase().includes("finch") ||
      id.toLowerCase().includes("lrt") ||
      id.toLowerCase().includes("line"),
  );

  if (lrtHits.length > 0) {
    console.log("   🎯 TARGET ROUTES FOUND:");
    for (const [id, count] of lrtHits) {
      console.log(
        `      ✅ Route ${id} (${ROUTE_NAMES[id] || "unknown"}): ${count} vehicle(s)`,
      );
    }
  } else {
    console.log("   ⚠️  TARGET ROUTES NOT FOUND (805 and 806 are absent)");
    if (possibleLrt.length > 0) {
      console.log("   Possible LRT-related routes:");
      for (const [id, count] of possibleLrt) {
        console.log(`      ? Route "${id}": ${count} vehicle(s)`);
      }
    }
  }
  console.log();

  // Show all routes for full visibility
  console.log(
    `   All ${uniqueRouteCount} routes in feed (sorted by vehicle count):`,
  );
  for (const [id, count] of sortedRoutes) {
    const marker = TARGET_ROUTES.includes(id) ? " ◀ TARGET" : "";
    console.log(`      ${id}: ${count} vehicle(s)${marker}`);
  }
  console.log();

  // Step 4: Dump full details for any LRT vehicles found
  console.log("Step 4: LRT vehicle details...");
  const lrtEntities = feed.entity.filter((e) => {
    const routeId = e.vehicle?.trip?.routeId;
    return routeId && TARGET_ROUTES.includes(routeId);
  });

  if (lrtEntities.length === 0) {
    console.log("   No LRT vehicles found in feed.");
    console.log();
    console.log("   Possible explanations:");
    console.log("   1. TTC uses different route IDs than 805/806");
    console.log("   2. LRT vehicles are on a separate feed URL");
    console.log(
      "   3. Service is not running right now (check time of day / service hours)",
    );
    console.log(
      "   4. TTC has not added LRT vehicles to this GTFS-RT feed yet",
    );
  } else {
    console.log(`   Found ${lrtEntities.length} LRT vehicle(s):\n`);
    for (const entity of lrtEntities) {
      const v = entity.vehicle;
      const pos = v.position;
      const ts = v.timestamp
        ? formatTime(new Date(Number(v.timestamp) * 1000))
        : "unknown";
      console.log(`   --- Vehicle ---`);
      console.log(`   Entity ID:    ${entity.id}`);
      console.log(`   Vehicle ID:   ${v.vehicle?.id || "unknown"}`);
      console.log(`   Route ID:     ${v.trip?.routeId}`);
      console.log(`   Trip ID:      ${v.trip?.tripId || "none"}`);
      console.log(`   Direction:    ${v.trip?.directionId ?? "unknown"}`);
      console.log(`   Latitude:     ${pos?.latitude}`);
      console.log(`   Longitude:    ${pos?.longitude}`);
      console.log(`   Speed (m/s):  ${pos?.speed ?? "not reported"}`);
      console.log(`   Bearing:      ${pos?.bearing ?? "not reported"}`);
      console.log(`   Timestamp:    ${ts}`);
      console.log(`   Stop status:  ${v.currentStatus ?? "unknown"}`);
      console.log(`   Stop ID:      ${v.stopId || "none"}`);
      console.log();
    }
  }

  // Step 5: Show a sample raw entity for inspection
  console.log(
    "\nStep 5: Sample raw entity (first entity with vehicle data)...",
  );
  const sampleEntity = feed.entity.find((e) => e.vehicle);
  if (sampleEntity) {
    console.log(JSON.stringify(sampleEntity.toJSON(), null, 2));
  } else {
    console.log("   No entities with vehicle data found at all!");
  }

  console.log("\n" + "=".repeat(70));
  console.log("Debug complete.");
  console.log("=".repeat(70));
}

debugFetch().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
