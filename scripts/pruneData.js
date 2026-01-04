#!/usr/bin/env node
/**
 * Prune old data from the database
 *
 * Keeps only the most recent MAX_POSITIONS_PER_CITY positions for each city.
 * Run manually with: node scripts/pruneData.js
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://REDACTED_SUPABASE_REF.supabase.co";
const SUPABASE_ANON_KEY =
  "REDACTED_SUPABASE_KEY";

const MAX_POSITIONS_PER_CITY = 5000;
const CITIES = [
  "SF",
  "LA",
  "Seattle",
  "Boston",
  "Portland",
  "San Diego",
  "Toronto",
  "Philadelphia",
  "Sacramento",
  "Pittsburgh",
  "Dallas",
  "Minneapolis",
  "Denver",
  "Salt Lake City",
];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function pruneCity(city) {
  console.log(`\nPruning ${city}...`);

  // Get count of positions for this city
  const { count, error: countError } = await supabase
    .from("vehicle_positions")
    .select("*", { count: "exact", head: true })
    .eq("city", city);

  if (countError) {
    console.error(`  Error counting ${city}:`, countError.message);
    return { city, deleted: 0, error: true };
  }

  console.log(`  Current count: ${count}`);

  // If under limit, nothing to do
  if (count <= MAX_POSITIONS_PER_CITY) {
    console.log(`  ✓ Already under limit (${MAX_POSITIONS_PER_CITY})`);
    return { city, deleted: 0 };
  }

  const toDelete = count - MAX_POSITIONS_PER_CITY;
  console.log(`  Deleting ${toDelete} oldest positions...`);

  // Delete in batches to avoid timeout
  const BATCH_SIZE = 1000;
  let deleted = 0;

  while (deleted < toDelete) {
    const batchToDelete = Math.min(BATCH_SIZE, toDelete - deleted);

    // Get IDs of oldest positions to delete
    const { data: oldestRows, error: selectError } = await supabase
      .from("vehicle_positions")
      .select("id")
      .eq("city", city)
      .order("recorded_at", { ascending: true })
      .limit(batchToDelete);

    if (selectError || !oldestRows?.length) {
      console.error(`  Error selecting:`, selectError?.message);
      break;
    }

    // Delete batch
    const idsToDelete = oldestRows.map((r) => r.id);
    const { error: deleteError } = await supabase
      .from("vehicle_positions")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      console.error(`  Error deleting:`, deleteError.message);
      break;
    }

    deleted += idsToDelete.length;
    console.log(`  Deleted ${deleted}/${toDelete}...`);
  }

  console.log(`  ✓ Pruned to ${MAX_POSITIONS_PER_CITY} positions`);
  return { city, deleted };
}

async function main() {
  console.log("🧹 Pruning old data from database");
  console.log(`   Keeping max ${MAX_POSITIONS_PER_CITY} positions per city\n`);

  const results = [];
  for (const city of CITIES) {
    const result = await pruneCity(city);
    if (result) results.push(result);
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Summary:");
  let totalDeleted = 0;
  for (const { city, deleted } of results) {
    if (deleted > 0) {
      console.log(`  ${city}: deleted ${deleted.toLocaleString()} positions`);
      totalDeleted += deleted;
    } else {
      console.log(`  ${city}: no changes needed`);
    }
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    `\n✅ Done! Total deleted: ${totalDeleted.toLocaleString()} positions`
  );
}

main().catch(console.error);
