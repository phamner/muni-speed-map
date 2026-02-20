#!/usr/bin/env node
/**
 * Fetch Grade Crossings for SF F-Market & Wharves Line Only
 *
 * Downloads railway grade crossings (level crossings) near the F line,
 * and merges them into the existing sfGradeCrossings.json file.
 *
 * Run with: node scripts/fetchFLineCrossings.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include crossings within this distance of the F line
const PROXIMITY_METERS = 50;

// Cluster threshold - merge crossings within this distance into one marker
const CLUSTER_METERS = 25;

// F line bounding box (Embarcadero + Market St corridor)
// The F line runs from Castro/Market to Fisherman's Wharf along Embarcadero
const F_LINE_BBOX = {
  south: 37.760,
  west: -122.435,
  north: 37.810,
  east: -122.385,
};

// Try alternative Overpass API endpoints if main one times out
const OVERPASS_APIS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Haversine distance between two points in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate minimum distance from a point to a line segment
function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const A = lat - lat1;
  const B = lon - lon1;
  const C = lat2 - lat1;
  const D = lon2 - lon1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let nearLat, nearLon;

  if (param < 0) {
    nearLat = lat1;
    nearLon = lon1;
  } else if (param > 1) {
    nearLat = lat2;
    nearLon = lon2;
  } else {
    nearLat = lat1 + param * C;
    nearLon = lon1 + param * D;
  }

  return haversineDistance(lat, lon, nearLat, nearLon);
}

// Calculate minimum distance from a point to a polyline
function distanceToLineString(lat, lon, coordinates) {
  let minDistance = Infinity;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];
    const distance = distanceToSegment(lat, lon, lat1, lon1, lat2, lon2);
    minDistance = Math.min(minDistance, distance);

    if (minDistance < PROXIMITY_METERS) break;
  }

  return minDistance;
}

// Cluster nearby crossings into single markers
function clusterCrossings(features) {
  if (features.length === 0) return features;

  const clustered = [];
  const used = new Set();

  for (let i = 0; i < features.length; i++) {
    if (used.has(i)) continue;

    const feature = features[i];
    const [lon, lat] = feature.geometry.coordinates;

    const clusterMembers = [feature];
    used.add(i);

    for (let j = i + 1; j < features.length; j++) {
      if (used.has(j)) continue;

      const other = features[j];
      const [otherLon, otherLat] = other.geometry.coordinates;
      const distance = haversineDistance(lat, lon, otherLat, otherLon);

      if (distance <= CLUSTER_METERS) {
        clusterMembers.push(other);
        used.add(j);
      }
    }

    if (clusterMembers.length === 1) {
      feature.properties.crossingCount = 1;
      clustered.push(feature);
    } else {
      let sumLat = 0, sumLon = 0;
      let hasBarrier = false, hasLight = false, hasBell = false;

      for (const member of clusterMembers) {
        const [mLon, mLat] = member.geometry.coordinates;
        sumLat += mLat;
        sumLon += mLon;

        if (member.properties.crossing_barrier) hasBarrier = true;
        if (member.properties.crossing_light) hasLight = true;
        if (member.properties.crossing_bell) hasBell = true;
      }

      const centroidLat = sumLat / clusterMembers.length;
      const centroidLon = sumLon / clusterMembers.length;

      clustered.push({
        type: "Feature",
        properties: {
          id: clusterMembers.map((m) => m.properties.id).join(","),
          type: "level_crossing",
          routes: ["F"],
          crossingCount: clusterMembers.length,
          crossing_barrier: hasBarrier ? "yes" : null,
          crossing_light: hasLight ? "yes" : null,
          crossing_bell: hasBell ? "yes" : null,
        },
        geometry: {
          type: "Point",
          coordinates: [centroidLon, centroidLat],
        },
      });
    }
  }

  return clustered;
}

async function fetchFLineCrossings() {
  const { south, west, north, east } = F_LINE_BBOX;

  console.log("🚃 Fetching grade crossings for SF F-Market & Wharves line...");
  console.log(`   Bounding box: ${south}, ${west}, ${north}, ${east}`);

  // Load F line routes
  const routesPath = path.join(__dirname, "..", "src", "data", "muniMetroRoutes.json");
  const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
  
  // Filter to only F line features
  const fLineFeatures = routes.features.filter(
    (f) => f.properties.route_id === "F"
  );
  console.log(`   Found ${fLineFeatures.length} F line route segments`);

  // Build coordinate arrays for F line
  const fLineCoords = [];
  for (const feature of fLineFeatures) {
    if (feature.geometry.type === "MultiLineString") {
      for (const lineCoords of feature.geometry.coordinates) {
        fLineCoords.push(lineCoords);
      }
    } else if (feature.geometry.type === "LineString") {
      fLineCoords.push(feature.geometry.coordinates);
    }
  }

  // Query Overpass API for road-level crossings only (not pedestrian crossings)
  const query = `
    [out:json][timeout:60];
    (
      node["railway"="level_crossing"](${south},${west},${north},${east});
    );
    out body;
  `;

  console.log("   Querying Overpass API...");
  
  let data = null;
  for (const apiUrl of OVERPASS_APIS) {
    try {
      console.log(`   Trying ${apiUrl}...`);
      const response = await fetch(apiUrl, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      if (response.ok) {
        data = await response.json();
        console.log(`   ✓ Success with ${apiUrl}`);
        break;
      } else {
        console.log(`   ✗ Failed: ${response.status}`);
      }
    } catch (err) {
      console.log(`   ✗ Error: ${err.message}`);
    }
  }

  if (!data) {
    throw new Error("All Overpass API endpoints failed");
  }
  console.log(`   Found ${data.elements.length} total crossings in bounding box`);

  // Filter crossings to only those near the F line
  const filteredFeatures = [];

  for (const node of data.elements) {
    const lat = node.lat;
    const lon = node.lon;

    let isNearFLine = false;
    for (const lineCoords of fLineCoords) {
      const distance = distanceToLineString(lat, lon, lineCoords);
      if (distance <= PROXIMITY_METERS) {
        isNearFLine = true;
        break;
      }
    }

    if (isNearFLine) {
      filteredFeatures.push({
        type: "Feature",
        properties: {
          id: String(node.id),
          type: "level_crossing",
          routes: ["F"],
          name: node.tags?.name || null,
          crossing_barrier: node.tags?.["crossing:barrier"] || null,
          crossing_light: node.tags?.["crossing:light"] || null,
          crossing_bell: node.tags?.["crossing:bell"] || null,
        },
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
      });
    }
  }

  console.log(`   ✂️  Filtered to ${filteredFeatures.length} crossings near F line`);

  // Cluster nearby crossings
  const clusteredFeatures = clusterCrossings(filteredFeatures);
  console.log(`   🔗 Clustered to ${clusteredFeatures.length} markers`);

  // Load existing sfGradeCrossings.json
  const existingPath = path.join(__dirname, "..", "src", "data", "sfGradeCrossings.json");
  const existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));
  console.log(`   📂 Loaded existing file with ${existing.features.length} crossings`);

  // Check for duplicates by comparing coordinates (within 10m)
  const newFeatures = [];
  for (const newFeature of clusteredFeatures) {
    const [newLon, newLat] = newFeature.geometry.coordinates;
    
    let isDuplicate = false;
    for (const existingFeature of existing.features) {
      const [existLon, existLat] = existingFeature.geometry.coordinates;
      const distance = haversineDistance(newLat, newLon, existLat, existLon);
      
      if (distance < 10) {
        // This crossing already exists - add F to its routes if not present
        if (!existingFeature.properties.routes.includes("F")) {
          existingFeature.properties.routes.push("F");
          console.log(`   ➕ Added F to existing crossing at ${existLat.toFixed(5)}, ${existLon.toFixed(5)}`);
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      newFeatures.push(newFeature);
    }
  }

  console.log(`   ✨ Adding ${newFeatures.length} new F line crossings`);

  // Merge new features into existing
  const merged = {
    type: "FeatureCollection",
    features: [...existing.features, ...newFeatures],
  };

  // Save updated file
  fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2));
  console.log(`   💾 Saved ${merged.features.length} total crossings to sfGradeCrossings.json`);

  return newFeatures.length;
}

// Run
console.log("🚦 F Line Grade Crossing Fetcher\n");
fetchFLineCrossings()
  .then((count) => {
    console.log(`\n✅ Done! Added ${count} new F line crossings.`);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
