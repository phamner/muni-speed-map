#!/usr/bin/env node
/**
 * Consolidate VTA Blue Line: merge all Blue LineStrings into one feature
 * (trunk + longest branch). Green and Orange are left unchanged.
 *
 * Run with: node scripts/consolidateVtaBlue.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.join(__dirname, "../src/data/vtaLightRailRoutes.json");

const OVERLAP_THRESHOLD_M = 50;
const BRANCH_MIN_POINTS_FAR = 5;

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
  if (dx === 0 && dy === 0) return haversineM([px, py], [x1, y1]);
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))
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
  let farCount = 0;
  for (const pt of candidate) {
    const [lon, lat] = pt;
    const d = distanceToLineString(lon, lat, trunk);
    if (d > OVERLAP_THRESHOLD_M) farCount++;
  }
  return farCount >= BRANCH_MIN_POINTS_FAR ? "branch" : "overlap";
}

const data = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));

// Collect Blue LineStrings (handle both LineString and MultiLineString)
const blueLineStrings = [];
const otherFeatures = [];

for (const feature of data.features) {
  if (feature.properties.route_id !== "Blue") {
    otherFeatures.push(feature);
    continue;
  }
  const geom = feature.geometry;
  if (geom.type === "MultiLineString") {
    for (const line of geom.coordinates) {
      if (line && line.length >= 2) blueLineStrings.push(line);
    }
  } else if (geom.coordinates && geom.coordinates.length >= 2) {
    blueLineStrings.push(geom.coordinates);
  }
}

if (blueLineStrings.length === 0) {
  console.log("No Blue LineStrings found.");
  process.exit(1);
}

// Pick longest as trunk
let trunkIdx = 0;
let maxLen = lineLengthKm(blueLineStrings[0]);
for (let i = 1; i < blueLineStrings.length; i++) {
  const len = lineLengthKm(blueLineStrings[i]);
  if (len > maxLen) {
    maxLen = len;
    trunkIdx = i;
  }
}

const trunk = blueLineStrings[trunkIdx];
const branches = [];

for (let i = 0; i < blueLineStrings.length; i++) {
  if (i === trunkIdx) continue;
  if (classifyLineString(blueLineStrings[i], trunk) === "branch") {
    branches.push(blueLineStrings[i]);
  }
}

// Keep trunk + longest branch
let kept = [trunk];
if (branches.length > 0) {
  let longestBranch = branches.reduce((a, b) =>
    lineLengthKm(a) >= lineLengthKm(b) ? a : b
  );
  kept.push(longestBranch);
}

const blueFeature = {
  type: "Feature",
  properties: {
    route_id: "Blue",
    route_name: "Blue Line",
    route_color: "#0072CE",
  },
  geometry:
    kept.length === 1
      ? { type: "LineString", coordinates: kept[0] }
      : { type: "MultiLineString", coordinates: kept },
};

const totalLen = kept.reduce((s, c) => s + lineLengthKm(c), 0);
data.features = [blueFeature, ...otherFeatures];

fs.writeFileSync(INPUT_PATH, JSON.stringify(data, null, 2), "utf8");
console.log(
  `Blue: ${blueLineStrings.length} LineStrings → ${kept.length} (${totalLen.toFixed(1)} km)`
);
console.log(`Wrote ${INPUT_PATH}`);
