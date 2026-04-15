require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  // Check total B Line records
  const { count: total } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802");
  console.log("Total route 802 rows:", total);

  // Check mapping versions
  const { data: mapped } = await supabase
    .from("vehicle_positions")
    .select("mapping_version, segment_id_200")
    .eq("route_id", "802")
    .not("segment_id_200", "is", null)
    .limit(10);
  console.log("\nSample mapped rows:");
  if (mapped) mapped.forEach((r) => console.log("  version:", r.mapping_version, "seg:", r.segment_id_200));

  // Check unmapped rows
  const { count: unmappedCount } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .is("segment_id_200", null);
  console.log("\nUnmapped rows (null segment_id_200):", unmappedCount);

  // Check recent rows (last 6 hours)
  const since = new Date(Date.now() - 6 * 3600000).toISOString();
  const { data: recent, count: recentCount } = await supabase
    .from("vehicle_positions")
    .select("segment_id_200, mapping_version, recorded_at, speed_calculated", { count: "exact" })
    .eq("route_id", "802")
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(10);
  console.log("\nRecent 6h B Line rows:", recentCount);
  if (recent) recent.forEach((r) => console.log("  seg:", r.segment_id_200, "ver:", r.mapping_version, "speed:", r.speed_calculated?.toFixed(1), "at:", r.recorded_at));

  // Check segment_speeds table
  const { data: segSpeeds, count: segSpeedCount } = await supabase
    .from("segment_speeds")
    .select("*", { count: "exact" })
    .eq("route_id", "802")
    .limit(5);
  console.log("\nSegment_speeds table for route 802:", segSpeedCount, "rows");
  if (segSpeeds) segSpeeds.forEach((r) => console.log("  seg:", r.segment_id, "dir:", r.direction, "avg:", r.avg_speed?.toFixed(1)));

  // Distinct segment IDs to see the range
  const { data: segRange } = await supabase
    .from("vehicle_positions")
    .select("segment_id_200")
    .eq("route_id", "802")
    .not("segment_id_200", "is", null)
    .order("segment_id_200")
    .limit(1000);
  if (segRange) {
    const ids = [...new Set(segRange.map((r) => r.segment_id_200))].sort();
    console.log("\nDistinct segment IDs in DB:", ids.length);
    console.log("First 5:", ids.slice(0, 5));
    console.log("Last 5:", ids.slice(-5));
  }
}

check().catch(console.error);
