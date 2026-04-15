require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  // When are the B Line rows from?
  const { data: oldest } = await supabase
    .from("vehicle_positions")
    .select("recorded_at")
    .eq("route_id", "802")
    .order("recorded_at", { ascending: true })
    .limit(1);
  const { data: newest } = await supabase
    .from("vehicle_positions")
    .select("recorded_at")
    .eq("route_id", "802")
    .order("recorded_at", { ascending: false })
    .limit(1);
  console.log("B Line (802) data range:");
  console.log("  Oldest:", oldest?.[0]?.recorded_at);
  console.log("  Newest:", newest?.[0]?.recorded_at);

  // Is there recent data for OTHER LA routes?
  const since1h = new Date(Date.now() - 3600000).toISOString();
  const since24h = new Date(Date.now() - 24 * 3600000).toISOString();
  
  const { data: recentLA } = await supabase
    .from("vehicle_positions")
    .select("route_id")
    .eq("city", "LA")
    .gte("recorded_at", since24h)
    .limit(5000);
  
  if (recentLA) {
    const routeCounts = {};
    recentLA.forEach((r) => {
      routeCounts[r.route_id] = (routeCounts[r.route_id] || 0) + 1;
    });
    console.log("\nLA routes in last 24h (sample of 5000 rows):");
    Object.entries(routeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([route, count]) => console.log("  Route", route, ":", count, "rows"));
  }

  // Check what time window the frontend fetches
  const { data: recentAll } = await supabase
    .from("vehicle_positions")
    .select("route_id, recorded_at")
    .eq("city", "LA")
    .gte("recorded_at", since1h)
    .limit(10);
  console.log("\nLA rows in last 1h:", recentAll?.length || 0);

  // Check D Line (805) recent data for comparison
  const { data: dRecent, count: dCount } = await supabase
    .from("vehicle_positions")
    .select("recorded_at", { count: "exact" })
    .eq("route_id", "805")
    .gte("recorded_at", since24h)
    .limit(1);
  console.log("\nD Line (805) rows in last 24h:", dCount);

  // Check how many empty segment IDs exist
  const { count: emptyCount } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("segment_id_200", "");
  console.log("\nB Line rows with EMPTY string segment_id_200:", emptyCount);

  // Check on_route distribution
  const { data: onRouteTrue } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("on_route", true);
  const { data: onRouteFalse } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("on_route", false);
  // Actually need count
  const { count: onTrueCount } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("on_route", true);
  const { count: onFalseCount } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("route_id", "802")
    .eq("on_route", false);
  console.log("B Line on_route=true:", onTrueCount, ", on_route=false:", onFalseCount);
}

check().catch(console.error);
