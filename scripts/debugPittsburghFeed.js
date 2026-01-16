import fetch, { Headers, Request, Response } from "node-fetch";
global.fetch = fetch;
global.Headers = Headers;
global.Request = Request;
global.Response = Response;

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const VEHICLE_POSITIONS_URL = "https://truetime.portauthority.org/gtfsrt-train/vehicles";

async function debugFeed() {
  try {
    const response = await fetch(VEHICLE_POSITIONS_URL, {
      headers: { Accept: "application/x-protobuf" }
    });
    
    if (!response.ok) {
      console.error("API error:", response.status);
      return;
    }
    
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    
    console.log(`\n=== Pittsburgh GTFS-RT Live Feed (${feed.entity.length} vehicles) ===\n`);
    
    // Group by routeId
    const byRoute = {};
    
    feed.entity.forEach(entity => {
      if (!entity.vehicle || !entity.vehicle.trip) return;
      
      const v = entity.vehicle;
      const routeId = v.trip.routeId;
      const vehicleId = v.vehicle?.id || entity.id;
      const lat = v.position?.latitude;
      const lon = v.position?.longitude;
      
      if (!byRoute[routeId]) byRoute[routeId] = [];
      byRoute[routeId].push({ vehicleId, lat, lon });
    });
    
    console.log("Route IDs found in feed:");
    for (const [routeId, vehicles] of Object.entries(byRoute)) {
      console.log(`  ${routeId}: ${vehicles.length} vehicles`);
    }
    
    console.log("\n=== Vehicle Details ===");
    for (const [routeId, vehicles] of Object.entries(byRoute)) {
      console.log(`\n${routeId}:`);
      vehicles.forEach(v => {
        const zone = v.lat >= 40.356 ? "SHARED" : "EXCLUSIVE";
        console.log(`  ${v.vehicleId}: ${v.lat?.toFixed(5)}, ${v.lon?.toFixed(5)} [${zone}]`);
      });
    }
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

debugFeed();
