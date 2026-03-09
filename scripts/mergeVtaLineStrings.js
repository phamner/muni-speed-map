#!/usr/bin/env node
/**
 * Merge VTA (San Jose) Light Rail LineStrings: reduce Orange and Green only.
 *
 * - Blue: keep all original features (preserves full downtown loop)
 * - Orange: merge all to 1 (longest) - simple linear route
 * - Green: keep trunk + longest branch (Winchester + Santa Teresa split)
 *
 * Run after: npm run parse-gtfs:vta
 * Run with: npm run merge:vta
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.join(__dirname, "../src/data/vtaLightRailRoutes.json");

const OVERLAP_THRESHOLD_M = 50; // Points within this distance of trunk = overlap
const BRANCH_MIN_POINTS_FAR = 5; // Need this many points >threshold to count as branch

function haversineM(a, b) {
  const R = 6371000;
  const p1 = (a[1] * Math.PI) / 180;
  const p2 = (b[1] * Math.PI) / 180;
  const d = ((b[0] - a[0]) * Math.PI) / 180;
  return (
    R *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((p2 - p1) / 2) ** 2 +
          Math.cos(p1) * Math.cos(p2) * Math.sin(d / 2) ** 2
      )
    )
  );
}

function lineLengthKm(coords) {
  return (
    coords.reduce(
      (sum, p, i) => (i ? sum + haversineM(coords[i - 1], p) : 0),
      0
    ) / 1000
  );
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return haversineM([px, py], [x1, y1]);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    )
  );
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return haversineM([px, py], [projX, projY]);
}

function distanceToLineString(lon, lat, coords) {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const d = distanceToSegment(lon, lat, x1, y1, x2, y2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function classifyLineString(candidate, trunk) {
  let nearCount = 0;
  let farCount = 0;
  for (const pt of candidate) {
    const [lon, lat] = pt;
    const d = distanceToLineString(lon, lat, trunk);
    if (d <= OVERLAP_THRESHOLD_M) nearCount++;
    else farCount++;
  }
  if (farCount >= BRANCH_MIN_POINTS_FAR) return "branch";
  return "overlap";
}

/**
 * Merge LineStrings for a route. Orange: keep longest only. Blue/Green: trunk + branches.
 */
function mergeLineStrings(lineStrings, routeId, props) {
  if (lineStrings.length === 0) return null;
  if (lineStrings.length === 1) {
    return {
      type: "Feature",
      properties: props,
      geometry: { type: "LineString", coordinates: lineStrings[0] },
    };
  }

  // Pick longest as trunk
  let trunkIdx = 0;
  let maxLen = lineLengthKm(lineStrings[0]);
  for (let i = 1; i < lineStrings.length; i++) {
    const len = lineLengthKm(lineStrings[i]);
    if (len > maxLen) {
      maxLen = len;
      trunkIdx = i;
    }
  }

  const trunk = lineStrings[trunkIdx];

  if (routeId === "Orange") {
    // Orange: keep longest only (simple linear route)
    return {
      type: "Feature",
      properties: props,
      geometry: { type: "LineString", coordinates: trunk },
    };
  }

  // Blue and Green: keep trunk + longest branch only (2 LineStrings max)
  const branches = [];
  for (let i = 0; i < lineStrings.length; i++) {
    if (i === trunkIdx) continue;
    const cls = classifyLineString(lineStrings[i], trunk);
    if (cls === "branch") {
      branches.push(lineStrings[i]);
    }
  }

  // Keep only the longest branch to avoid over-segmentation
  let kept = [trunk];
  if (branches.length > 0) {
    let longestBranch = branches[0];
    let maxBranchLen = lineLengthKm(branches[0]);
    for (let i = 1; i < branches.length; i++) {
      const len = lineLengthKm(branches[i]);
      if (len > maxBranchLen) {
        maxBranchLen = len;
        longestBranch = branches[i];
      }
    }
    kept.push(longestBranch);
  }

  return {
    type: "Feature",
    properties: props,
    geometry:
      kept.length === 1
        ? { type: "LineString", coordinates: kept[0] }
        : { type: "MultiLineString", coordinates: kept },
  };
}

const data = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));

// Group features by route_id
const byRoute = new Map();
for (const feature of data.features) {
  const routeId = feature.properties.route_id;
  if (!byRoute.has(routeId)) {
    byRoute.set(routeId, { props: feature.properties, lineStrings: [] });
  }
  const coords = feature.geometry.coordinates;
  if (coords && coords.length >= 2) {
    byRoute.get(routeId).lineStrings.push(coords);
  }
}

// Merge Orange and Green only; Blue keeps all original features
const mergedFeatures = [];
const routeOrder = ["Blue", "Green", "Orange"];

for (const routeId of routeOrder) {
  const group = byRoute.get(routeId);
  if (!group) continue;

  if (routeId === "Blue") {
    // Blue: keep all original features (preserves downtown loop)
    for (const coords of group.lineStrings) {
      mergedFeatures.push({
        type: "Feature",
        properties: group.props,
        geometry: { type: "LineString", coordinates: coords },
      });
    }
    const totalLen = group.lineStrings.reduce(
      (s, c) => s + lineLengthKm(c),
      0
    );
    console.log(
      `Blue: ${group.lineStrings.length} LineStrings (unchanged, ${totalLen.toFixed(1)} km)`
    );
    continue;
  }

  const feature = mergeLineStrings(
    group.lineStrings,
    routeId,
    group.props
  );
  if (feature) {
    mergedFeatures.push(feature);
    const geom = feature.geometry;
    const count =
      geom.type === "MultiLineString"
        ? geom.coordinates.length
        : 1;
    const len =
      geom.type === "MultiLineString"
        ? geom.coordinates.reduce(
            (s, c) => s + lineLengthKm(c),
            0
          )
        : lineLengthKm(geom.coordinates);
    console.log(
      `${routeId}: ${group.lineStrings.length} LineStrings → ${count} (${len.toFixed(1)} km)`
    );
  }
}

data.features = mergedFeatures;
data.generated = new Date().toISOString();
data.source = "VTA GTFS (merged)";

fs.writeFileSync(INPUT_PATH, JSON.stringify(data, null, 2), "utf8");
console.log(`\nWrote ${INPUT_PATH} (${mergedFeatures.length} features)`);
