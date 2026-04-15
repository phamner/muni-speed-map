require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  // How many empty-string segment IDs?
  const { count: emptyCount } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("segment_id_200", "");
  console.log("Empty string segment_id_200:", emptyCount);

  // What on_route value do they have?
  const { data: emptySample } = await supabase
    .from("vehicle_positions")
    .select("id, lat, lon, on_route, segment_id_200, speed_calculated, direction_id")
    .eq("route_id", "802")
    .eq("segment_id_200", "")
    .limit(10);
  console.log("\nSample empty-segment rows:");
  if (emptySample) emptySample.forEach((r) => console.log(
    "  id:", r.id, "lat:", r.lat, "lon:", r.lon, "dir:", r.direction_id,
    "on_route:", r.on_route, "speed:", r.speed_calculated?.toFixed(1)
  ));

  // Distribution of on_route for all B Line
  const { count: onTrue } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("on_route", true);
  const { count: onFalse } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("on_route", false);
  console.log("\non_route=true:", onTrue, "on_route=false:", onFalse);

  // Check segment coverage — which segments have data?
  const { data: allSegs } = await supabase
    .from("vehicle_positions")
    .select("segment_id_200")
    .eq("route_id", "802")
    .not("segment_id_200", "is", null)
    .neq("segment_id_200", "")
    .limit(5000);
  if (allSegs) {
    const counts = {};
    allSegs.forEach((r) => { counts[r.segment_id_200] = (counts[r.segment_id_200] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => {
      const numA = parseInt(a[0].split("_")[1]);
      const numB = parseInt(b[0].split("_")[1]);
      return numA - numB;
    });
    console.log("\nSegment distribution (index: count):");
    sorted.forEach(([seg, count]) => console.log("  " + seg + ": " + count));

    // The B Line has 124 segments (0-123). Which are missing?
    const present = new Set(sorted.map(([seg]) => parseInt(seg.split("_")[1])));
    const missing = [];
    for (let i = 0; i <= 124; i++) {
      if (!present.has(i)) missing.push(i);
    }
    console.log("\nMissing segments (no data):", missing.length);
    if (missing.length <= 30) console.log("  ", missing.join(", "));
  }
}

check().catch(console.error);
