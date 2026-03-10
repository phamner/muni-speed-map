#!/usr/bin/env node
/**
 * Remove Traffic Lights at Gated Grade Crossings
 *
 * Reads existing consolidated traffic light files and removes any that are
 * snapped to grade crossings with protective gates (crossing_barrier: "yes").
 * At gated crossings, the traffic signals control car traffic, not the train.
 *
 * Run for all cities:  node scripts/cleanup/removeGatedTrafficLights.js
 * Run for one city:    node scripts/cleanup/removeGatedTrafficLights.js Pittsburgh
 * Dry run (no writes): node scripts/cleanup/removeGatedTrafficLights.js --dry-run
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const CITIES = {
  LA: { crossingsFile: "laGradeCrossings.json", lightsFile: "laTrafficLightsConsolidated.json" },
  Seattle: { crossingsFile: "seattleGradeCrossings.json", lightsFile: "seattleTrafficLightsConsolidated.json" },
  Boston: { crossingsFile: "bostonGradeCrossings.json", lightsFile: "bostonTrafficLightsConsolidated.json" },
  Portland: { crossingsFile: "portlandGradeCrossings.json", lightsFile: "portlandTrafficLightsConsolidated.json" },
  SanDiego: { crossingsFile: "sanDiegoGradeCrossings.json", lightsFile: "sanDiegoTrafficLightsConsolidated.json" },
  Toronto: { crossingsFile: "torontoGradeCrossings.json", lightsFile: "torontoTrafficLightsConsolidated.json" },
  Philadelphia: { crossingsFile: "phillyGradeCrossings.json", lightsFile: "phillyTrafficLightsConsolidated.json" },
  Pittsburgh: { crossingsFile: "pittsburghGradeCrossings.json", lightsFile: "pittsburghTrafficLightsConsolidated.json" },
  Dallas: { crossingsFile: "dallasGradeCrossings.json", lightsFile: "dallasTrafficLightsConsolidated.json" },
  Minneapolis: { crossingsFile: "minneapolisGradeCrossings.json", lightsFile: "minneapolisTrafficLightsConsolidated.json" },
  Denver: { crossingsFile: "denverGradeCrossings.json", lightsFile: "denverTrafficLightsConsolidated.json" },
  SaltLakeCity: { crossingsFile: "slcGradeCrossings.json", lightsFile: "slcTrafficLightsConsolidated.json" },
  SanJose: { crossingsFile: "sanJoseGradeCrossings.json", lightsFile: "sanJoseTrafficLightsConsolidated.json" },
  Baltimore: { crossingsFile: "baltimoreGradeCrossings.json", lightsFile: "baltimoreTrafficLightsConsolidated.json" },
  Phoenix: { crossingsFile: "phoenixGradeCrossings.json", lightsFile: "phoenixTrafficLightsConsolidated.json" },
  Charlotte: { crossingsFile: "charlotteGradeCrossings.json", lightsFile: "charlotteTrafficLightsConsolidated.json" },
  Cleveland: { crossingsFile: "clevelandGradeCrossings.json", lightsFile: "clevelandTrafficLightsConsolidated.json" },
  Sacramento: { crossingsFile: "sacramentoGradeCrossings.json", lightsFile: "sacramentoTrafficLightsConsolidated.json" },
  SF: { crossingsFile: "sfGradeCrossings.json", lightsFile: "sfTrafficLightsConsolidated.json" },
  Calgary: { crossingsFile: "calgaryGradeCrossings.json", lightsFile: "calgaryTrafficLightsConsolidated.json" },
};

function processCity(cityKey, city, dryRun) {
  const crossingsPath = path.join(DATA_DIR, city.crossingsFile);
  const lightsPath = path.join(DATA_DIR, city.lightsFile);

  if (!fs.existsSync(lightsPath)) {
    console.log(`   ⏭️  No traffic lights file found, skipping`);
    return { city: cityKey, before: 0, after: 0, removed: 0, skipped: true };
  }
  if (!fs.existsSync(crossingsPath)) {
    console.log(`   ⏭️  No crossings file found, skipping`);
    return { city: cityKey, before: 0, after: 0, removed: 0, skipped: true };
  }

  const crossings = JSON.parse(fs.readFileSync(crossingsPath, "utf8"));
  const lights = JSON.parse(fs.readFileSync(lightsPath, "utf8"));

  const gatedCrossingIds = new Set();
  for (const crossing of crossings.features) {
    if (crossing.properties?.crossing_barrier === "yes") {
      gatedCrossingIds.add(crossing.properties.id);
    }
  }

  const before = lights.features.length;
  const removed = [];

  const filtered = lights.features.filter((light) => {
    if (!light.properties.snapped) return true;
    const crossingId = light.properties.crossing_id;
    if (!crossingId) return true;
    if (gatedCrossingIds.has(crossingId)) {
      const [lon, lat] = light.geometry.coordinates;
      removed.push({
        id: light.properties.id,
        routes: light.properties.routes,
        lat: lat.toFixed(5),
        lon: lon.toFixed(5),
        crossingId,
      });
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    for (const r of removed) {
      console.log(`   ❌ ${r.id} (${r.routes.join(",")}) at ${r.lat}, ${r.lon} → gated crossing ${r.crossingId}`);
    }
  }

  if (!dryRun && removed.length > 0) {
    lights.features = filtered;
    fs.writeFileSync(lightsPath, JSON.stringify(lights, null, 2));
    console.log(`   ✅ Saved ${filtered.length} traffic lights (removed ${removed.length})`);
  } else if (dryRun && removed.length > 0) {
    console.log(`   🔍 Would remove ${removed.length}, keeping ${filtered.length} (dry run)`);
  } else {
    console.log(`   ✅ No gated traffic lights found`);
  }

  return { city: cityKey, before, after: filtered.length, removed: removed.length };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targetCity = args.find((a) => a !== "--dry-run");

  console.log("🚦 Remove Traffic Lights at Gated Crossings");
  console.log("============================================");
  if (dryRun) console.log("🔍 DRY RUN — no files will be modified\n");

  const results = [];

  if (targetCity) {
    if (!CITIES[targetCity]) {
      console.error(`❌ Unknown city: ${targetCity}`);
      console.log(`Available: ${Object.keys(CITIES).join(", ")}`);
      process.exit(1);
    }
    console.log(`\n🏙️  ${targetCity}`);
    results.push(processCity(targetCity, CITIES[targetCity], dryRun));
  } else {
    for (const [cityKey, city] of Object.entries(CITIES)) {
      console.log(`\n🏙️  ${cityKey}`);
      results.push(processCity(cityKey, city, dryRun));
    }
  }

  console.log("\n============================================");
  console.log("📊 Summary:");
  let totalRemoved = 0;
  for (const r of results) {
    if (r.skipped) {
      console.log(`   ${r.city}: skipped`);
    } else if (r.removed > 0) {
      console.log(`   ${r.city}: ${r.before} → ${r.after} (removed ${r.removed})`);
      totalRemoved += r.removed;
    } else {
      console.log(`   ${r.city}: ${r.before} (no changes)`);
    }
  }
  console.log(`\n✨ Total removed: ${totalRemoved}`);
}

main();
