#!/usr/bin/env node
// Quick test: fetch Metro Transit vehicle positions and print Blue/Green line vehicles.

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const VEHICLE_POSITIONS_URL =
  "https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb";

async function fetchAndPrint() {
  try {
    const res = await fetch(VEHICLE_POSITIONS_URL, {
      // Metro Transit's server rejects strict Accept types; allow any
      headers: { Accept: "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buf)
    );

    const LIGHT_RAIL = new Set(["901", "902"]); // Blue = 901, Green = 902

    const vehicles = feed.entity
      .filter(
        (e) =>
          e.vehicle && e.vehicle.trip && LIGHT_RAIL.has(e.vehicle.trip.routeId)
      )
      .map((e) => {
        const v = e.vehicle;
        return {
          id: v.vehicle?.id || e.id,
          routeId: v.trip.routeId,
          routeName:
            v.trip.routeId === "901"
              ? "Blue"
              : v.trip.routeId === "902"
              ? "Green"
              : v.trip.routeId,
          lat: v.position?.latitude,
          lon: v.position?.longitude,
          speed: v.position?.speed ?? null,
          heading: v.position?.bearing ?? null,
          timestamp: v.timestamp
            ? new Date((v.timestamp.low || v.timestamp) * 1000).toISOString()
            : null,
        };
      });

    console.log(`Found ${vehicles.length} light rail vehicles:`);
    vehicles.forEach((veh) => console.log(JSON.stringify(veh)));
  } catch (err) {
    console.error("Error fetching/parsing feed:", err);
    process.exit(1);
  }
}

fetchAndPrint();
