import fetch, { Headers, Request, Response } from "node-fetch";
global.fetch = fetch;
global.Headers = Headers;
global.Request = Request;
global.Response = Response;

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://REDACTED_SUPABASE_REF.supabase.co",
  "REDACTED_SUPABASE_KEY"
);

// Library Junction is around 40.356 (shared area ends)
// South Hills Village (Red terminus) is around 40.354
// Library (Blue terminus) is around 40.286
// Downtown is around 40.43-40.44

const SHARED_AREA_MIN_LAT = 40.356; // North of Library Junction = shared

async function check() {
  const { data, error } = await supabase
    .from("vehicle_positions")
    .select("route_id, vehicle_id, lat, lon, speed_calculated")
    .eq("city", "Pittsburgh")
    .order("recorded_at", { ascending: false })
    .limit(500);
  
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log("\n=== Pittsburgh Location Analysis ===");
  console.log("Shared area (downtown to Library Junction): lat >= 40.356");
  console.log("Exclusive area (south of Library Junction): lat < 40.356");
  console.log("");
  
  const stats = {
    RED: { shared: 0, exclusive: 0 },
    BLUE: { shared: 0, exclusive: 0 },
    SLVR: { shared: 0, exclusive: 0 }
  };
  
  data.forEach(row => {
    if (!stats[row.route_id]) return;
    if (row.lat >= SHARED_AREA_MIN_LAT) {
      stats[row.route_id].shared++;
    } else {
      stats[row.route_id].exclusive++;
    }
  });
  
  console.log("Route  | In Shared Area | In Exclusive Area");
  console.log("-------|----------------|------------------");
  for (const [route, s] of Object.entries(stats)) {
    console.log(`${route.padEnd(6)} | ${String(s.shared).padEnd(14)} | ${s.exclusive}`);
  }
  
  // Check for SLVR in shared area (should be 0 according to user's observation)
  const slvrInShared = data.filter(r => r.route_id === 'SLVR' && r.lat >= SHARED_AREA_MIN_LAT);
  console.log(`\nSLVR records in shared area: ${slvrInShared.length}`);
  if (slvrInShared.length > 0) {
    console.log("Sample SLVR in shared area:");
    slvrInShared.slice(0, 3).forEach(s => 
      console.log(`  Vehicle ${s.vehicle_id}: ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`)
    );
  }
}

check();
