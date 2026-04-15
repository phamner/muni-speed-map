// Reset B Line (802) segment mappings to null so both deployed (GTFS)
// and local (ORM) frontends compute segment IDs client-side.
// Re-run backfill AFTER deploying the ORM code.

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function resetBLineSegments() {
  const PAGE = 500;
  let totalReset = 0;
  let lastId = 0;

  while (true) {
    // Fetch a batch of B Line rows that have precomputed segments
    const { data: rows, error } = await supabase
      .from("vehicle_positions")
      .select("id")
      .eq("route_id", "802")
      .gt("id", lastId)
      .not("segment_id_200", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE);

    if (error) {
      console.error("Fetch error:", error.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    lastId = ids[ids.length - 1];

    // Clear segment mappings
    const { error: updateError } = await supabase
      .from("vehicle_positions")
      .update({
        segment_id: null,
        segment_id_200: null,
        segment_id_500: null,
        segment_id_1000: null,
        on_route: null,
        mapping_version: null,
        mapped_at: null,
      })
      .in("id", ids);

    if (updateError) {
      console.error("Update error:", updateError.message);
      break;
    }

    totalReset += ids.length;
    console.log(`Reset ${totalReset} rows (last id: ${lastId})`);
  }

  console.log(`\nDone. Reset ${totalReset} B Line rows to null segment mappings.`);
  console.log("Both deployed (GTFS) and local (ORM) frontends will compute segment IDs client-side.");
  console.log("After deploying the ORM code, run: node scripts/backfillSegmentMappings.js --city LA --route 802 --force");
}

resetBLineSegments().catch(console.error);
