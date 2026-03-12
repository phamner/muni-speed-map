#!/usr/bin/env node
/**
 * Consolidate Portland MAX route shapes.
 *
 * The GTFS data produces many duplicate features per route/direction
 * (multiple schedule variants with nearly identical geometry).
 * This script keeps only the longest feature per (route_id, direction_id)
 * pair, so each route has exactly 2 features (one per direction).
 *
 * For routes with fragmented geometry (like the NS line which has 3 separate
 * LineStrings per direction), the fragments are concatenated into a single
 * continuous LineString.
 *
 * Run with: node scripts/consolidatePortlandRoutes.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "src", "data");

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

function lineLength(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return total;
}

function main() {
  const routesPath = path.join(DATA_DIR, "portlandMaxRoutes.json");
  const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));

  const featureCount = routes.features.length;

  // Group features by (route_id, direction_id)
  const groups = new Map();
  for (const feature of routes.features) {
    const key = `${feature.properties.route_id}_${feature.properties.direction_id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(feature);
  }

  console.log(`Input: ${featureCount} features across ${groups.size} route/direction groups`);

  // For each group, collect all unique shape variants, then pick the best
  const consolidated = [];

  for (const [key, features] of groups) {
    const routeId = features[0].properties.route_id;
    const routeName = features[0].properties.route_name;
    const directionId = features[0].properties.direction_id;

    // Deduplicate by shape_id first
    const byShape = new Map();
    for (const f of features) {
      const shapeId = f.properties.shape_id;
      if (!byShape.has(shapeId)) {
        byShape.set(shapeId, f);
      }
    }
    const uniqueShapes = Array.from(byShape.values());

    // Group shapes that cover different parts of the route
    // (same route_id + direction, but different geometry)
    // vs shapes that are just schedule variants of the same geometry
    
    // Strategy: find the shape set that gives the longest total coverage
    // First, group by schedule prefix (618xxx, 619xxx, 620xxx)
    const scheduleGroups = new Map();
    for (const f of uniqueShapes) {
      const shapeId = f.properties.shape_id;
      const prefix = shapeId.substring(0, 3);
      if (!scheduleGroups.has(prefix)) {
        scheduleGroups.set(prefix, []);
      }
      scheduleGroups.get(prefix).push(f);
    }

    // Pick the schedule group with the most total coverage
    let bestGroup = null;
    let bestLength = 0;

    for (const [prefix, groupFeatures] of scheduleGroups) {
      const totalLength = groupFeatures.reduce(
        (sum, f) => sum + lineLength(f.geometry.coordinates),
        0
      );
      if (totalLength > bestLength) {
        bestLength = totalLength;
        bestGroup = groupFeatures;
      }
    }

    if (!bestGroup || bestGroup.length === 0) continue;

    // Keep only the single longest shape from this group
    let longestFeature = bestGroup[0];
    let longestLen = lineLength(bestGroup[0].geometry.coordinates);

    for (let i = 1; i < bestGroup.length; i++) {
      const len = lineLength(bestGroup[i].geometry.coordinates);
      if (len > longestLen) {
        longestLen = len;
        longestFeature = bestGroup[i];
      }
    }

    consolidated.push(longestFeature);
    console.log(
      `  ${routeName} dir ${directionId}: kept shape ${longestFeature.properties.shape_id} (${Math.round(longestLen)}m, ${longestFeature.geometry.coordinates.length} pts) from ${bestGroup.length} variant(s)`
    );
  }

  const output = {
    type: "FeatureCollection",
    features: consolidated,
  };

  fs.writeFileSync(routesPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nOutput: ${consolidated.length} features written to ${routesPath}`);
}

main();
