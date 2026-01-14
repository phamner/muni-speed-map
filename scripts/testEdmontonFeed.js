#!/usr/bin/env node
/**
 * Test Edmonton GTFS-RT feed to check for LRT data
 */

import fetch from "node-fetch";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

async function check() {
  console.log("🚊 Checking Edmonton GTFS-RT feed...\n");
  
  const response = await fetch(
    "https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb"
  );
  
  if (!response.ok) {
    console.error("Failed to fetch:", response.status);
    return;
  }
  
  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );

  console.log("Total entities:", feed.entity.length);

  // Count by route
  const routeCounts = {};
  const routeExamples = {};
  
  for (const entity of feed.entity) {
    if (entity.vehicle?.trip?.routeId) {
      const routeId = entity.vehicle.trip.routeId;
      routeCounts[routeId] = (routeCounts[routeId] || 0) + 1;
      if (!routeExamples[routeId]) {
        routeExamples[routeId] = {
          lat: entity.vehicle.position?.latitude,
          lon: entity.vehicle.position?.longitude,
          vehicleId: entity.vehicle.vehicle?.id,
        };
      }
    }
  }

  // Sort by route ID
  const sorted = Object.entries(routeCounts).sort((a, b) => a[0].localeCompare(b[0]));
  
  console.log("\nAll routes with vehicles:");
  for (const [route, count] of sorted) {
    const ex = routeExamples[route];
    console.log(`  Route ${route}: ${count} vehicle(s) - example: ${ex.lat?.toFixed(4)}, ${ex.lon?.toFixed(4)}`);
  }

  // Look for LRT-related routes
  // Edmonton LRT route IDs from static GTFS:
  // - Capital Line: 021R (blue)
  // - Metro Line: 022R (red)
  // - Valley Line: 023R (green)
  console.log("\n🔍 Looking for LRT routes...");
  const lrtPatterns = ["021R", "022R", "023R", "capital", "metro", "valley", "lrt"];
  let foundLrt = false;
  
  for (const [route, count] of sorted) {
    const lower = route.toLowerCase();
    if (lrtPatterns.some((p) => lower.includes(p))) {
      console.log(`  ✅ LRT Route ${route}: ${count} vehicle(s)`);
      foundLrt = true;
    }
  }
  
  if (!foundLrt) {
    console.log("  ⚠️ No obvious LRT routes found");
    console.log("  Checking if any routes might be LRT by location...");
    
    // Edmonton LRT runs roughly:
    // Capital Line: ~53.5°N, near downtown
    // Valley Line: ~53.5°N, east side
    for (const [route, count] of sorted) {
      const ex = routeExamples[route];
      if (ex.lat > 53.4 && ex.lat < 53.7 && ex.lon > -113.7 && ex.lon < -113.3) {
        console.log(`    Route ${route} is in Edmonton area (${ex.lat?.toFixed(4)}, ${ex.lon?.toFixed(4)})`);
      }
    }
  }
}

check().catch(console.error);
