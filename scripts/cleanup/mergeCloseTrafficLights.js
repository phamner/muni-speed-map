const fs = require("fs");
const path = require("path");

const THRESHOLD_METERS = 15;

const CITY_FILES = {
  philly: "phillyTrafficLightsConsolidated.json",
  boston: "bostonTrafficLightsConsolidated.json",
  portland: "portlandTrafficLightsConsolidated.json",
  la: "laTrafficLightsConsolidated.json",
  seattle: "seattleTrafficLightsConsolidated.json",
  denver: "denverTrafficLightsConsolidated.json",
  pittsburgh: "pittsburghTrafficLightsConsolidated.json",
  charlotte: "charlotteTrafficLightsConsolidated.json",
  cleveland: "clevelandTrafficLightsConsolidated.json",
  phoenix: "phoenixTrafficLightsConsolidated.json",
  baltimore: "baltimoreTrafficLightsConsolidated.json",
  sandiego: "sanDiegoTrafficLightsConsolidated.json",
  saltlake: "saltLakeCityTrafficLightsConsolidated.json",
  minneapolis: "minneapolisTrafficLightsConsolidated.json",
  sf: "sfTrafficLightsConsolidated.json",
  toronto: "torontoTrafficLightsConsolidated.json",
  sanjose: "sanJoseTrafficLightsConsolidated.json",
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mergeCity(cityKey, dryRun) {
  const filename = CITY_FILES[cityKey];
  if (!filename) {
    console.error(`Unknown city: ${cityKey}`);
    console.log("Available:", Object.keys(CITY_FILES).join(", "));
    process.exit(1);
  }

  const filePath = path.join(__dirname, "../../src/data", filename);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const features = data.features;
  console.log(
    `\n📍 ${cityKey}: ${features.length} traffic lights (threshold: ${THRESHOLD_METERS}m)`,
  );

  const used = new Set();
  const clusters = [];

  for (let i = 0; i < features.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    used.add(i);
    const [lon1, lat1] = features[i].geometry.coordinates;

    for (let j = i + 1; j < features.length; j++) {
      if (used.has(j)) continue;
      const [lon2, lat2] = features[j].geometry.coordinates;
      if (haversineMeters(lat1, lon1, lat2, lon2) < THRESHOLD_METERS) {
        cluster.push(j);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  const multiClusters = clusters.filter((c) => c.length > 1);
  if (multiClusters.length === 0) {
    console.log("   No close lights found to merge.");
    return;
  }

  console.log(
    `   Found ${multiClusters.length} clusters to merge (${multiClusters.reduce((s, c) => s + c.length, 0)} lights → ${multiClusters.length} merged)`,
  );

  if (dryRun) {
    console.log("\n   Clusters that would be merged:");
    for (const cluster of multiClusters) {
      const items = cluster.map((i) => features[i]);
      const ids = items.map((f) => f.properties.id).join(", ");
      const routes = [
        ...new Set(items.flatMap((f) => f.properties.routes || [])),
      ];
      const coords = items.map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return `(${lat.toFixed(5)}, ${lon.toFixed(5)})`;
      });
      const distances = [];
      for (let a = 0; a < items.length; a++) {
        for (let b = a + 1; b < items.length; b++) {
          const [lon1, lat1] = items[a].geometry.coordinates;
          const [lon2, lat2] = items[b].geometry.coordinates;
          distances.push(haversineMeters(lat1, lon1, lat2, lon2).toFixed(1));
        }
      }
      console.log(
        `   • ${cluster.length} lights [${ids}] routes=[${routes}] dist=${distances.join("/")}m`,
      );
      coords.forEach((c) => console.log(`     ${c}`));
    }
    return;
  }

  const merged = clusters.map((cluster) => {
    if (cluster.length === 1) return features[cluster[0]];

    const items = cluster.map((i) => features[i]);
    const avgLon =
      items.reduce((s, f) => s + f.geometry.coordinates[0], 0) / items.length;
    const avgLat =
      items.reduce((s, f) => s + f.geometry.coordinates[1], 0) / items.length;
    const allRoutes = [
      ...new Set(items.flatMap((f) => f.properties.routes || [])),
    ];
    const totalCount = items.reduce((s, f) => s + (f.properties.count || 1), 0);
    const anySnapped = items.some((f) => f.properties.snapped === true);
    const crossingIds = [
      ...new Set(
        items.map((f) => f.properties.crossing_id).filter((id) => id != null),
      ),
    ];

    return {
      type: "Feature",
      properties: {
        id: items[0].properties.id,
        type: "traffic_signal",
        count: totalCount,
        routes: allRoutes,
        snapped: anySnapped ? true : items[0].properties.snapped,
        crossing_id: crossingIds.length > 0 ? crossingIds.join(",") : null,
      },
      geometry: {
        type: "Point",
        coordinates: [avgLon, avgLat],
      },
    };
  });

  const removedCount = features.length - merged.length;
  data.features = merged;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `   ✅ Merged: ${features.length} → ${merged.length} (removed ${removedCount} duplicates)`,
  );
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const cityArg = args.find((a) => !a.startsWith("--"));

if (!cityArg) {
  console.log("Usage: node mergeCloseTrafficLights.js <city|all> [--dry-run]");
  console.log("Available cities:", Object.keys(CITY_FILES).join(", "));
  process.exit(1);
}

if (cityArg === "all") {
  for (const key of Object.keys(CITY_FILES)) {
    const filePath = path.join(__dirname, "../../src/data", CITY_FILES[key]);
    if (fs.existsSync(filePath)) {
      mergeCity(key, dryRun);
    }
  }
} else {
  mergeCity(cityArg, dryRun);
}
