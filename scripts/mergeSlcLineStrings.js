#!/usr/bin/env node
/**
 * Merge multiple LineStrings per route into a single LineString (the longest).
 * SLC TRAX has MultiLineString with 2-6 LineStrings per route; this simplifies
 * to 1 LineString per route for cleaner segment display.
 *
 * Run with: node scripts/mergeSlcLineStrings.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.join(__dirname, "../src/data/slcTraxRoutes.json");

function haversineKm(a, b) {
  const R = 6371;
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

function lineLength(coords) {
  return coords.reduce(
    (sum, p, i) => (i ? sum + haversineKm(coords[i - 1], p) : 0),
    0
  );
}

const data = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));

for (const feature of data.features) {
  const geom = feature.geometry;
  if (geom.type !== "MultiLineString" || geom.coordinates.length <= 1) {
    continue;
  }

  const lineStrings = geom.coordinates;
  let longest = lineStrings[0];
  let maxLen = lineLength(longest);

  for (let i = 1; i < lineStrings.length; i++) {
    const len = lineLength(lineStrings[i]);
    if (len > maxLen) {
      maxLen = len;
      longest = lineStrings[i];
    }
  }

  feature.geometry = {
    type: "LineString",
    coordinates: longest,
  };

  console.log(
    `${feature.properties.route_id}: merged ${lineStrings.length} LineStrings → 1 (${maxLen.toFixed(1)} km)`
  );
}

fs.writeFileSync(INPUT_PATH, JSON.stringify(data, null, 2), "utf8");
console.log(`Wrote ${INPUT_PATH}`);
