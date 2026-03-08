#!/usr/bin/env node
/**
 * Merge Baltimore Light Rail LineStrings: keep longest as main trunk, discard
 * overlapping (parallel) LineStrings, keep branches that diverge.
 *
 * Run with: node scripts/mergeBaltimoreLineStrings.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.join(__dirname, "../src/data/baltimoreLightRailRoutes.json");

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
  return coords.reduce(
    (sum, p, i) => (i ? sum + haversineM(coords[i - 1], p) : 0),
    0
  ) / 1000;
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

const data = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));

for (const feature of data.features) {
  const geom = feature.geometry;
  if (geom.type !== "MultiLineString" || geom.coordinates.length <= 1) {
    continue;
  }

  const lineStrings = geom.coordinates;

  // Pick longest as main trunk
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
  const kept = [trunk];
  const branches = [];

  for (let i = 0; i < lineStrings.length; i++) {
    if (i === trunkIdx) continue;
    const cls = classifyLineString(lineStrings[i], trunk);
    if (cls === "branch") {
      branches.push(lineStrings[i]);
    }
  }

  const result = [trunk, ...branches];
  feature.geometry =
    result.length === 1
      ? { type: "LineString", coordinates: result[0] }
      : { type: "MultiLineString", coordinates: result };

  console.log(
    `${feature.properties.route_id}: ${lineStrings.length} → ${result.length} (trunk ${maxLen.toFixed(1)} km + ${branches.length} branch${branches.length > 1 ? "es" : ""})`
  );
}

fs.writeFileSync(INPUT_PATH, JSON.stringify(data, null, 2), "utf8");
console.log(`Wrote ${INPUT_PATH}`);
