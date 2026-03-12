#!/usr/bin/env node
/**
 * Add separated_at_grade override for Phoenix B line between two points,
 * excluding sections already marked as grade-separated (elevated/tunnel).
 * Merges with existing phoenixSeparationOverrides.json (preserves A line).
 *
 * Run with: node scripts/addPhoenixBLineSeparationOverride.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "src", "data");

// User-specified section: { start: {lat, lng}, end: {lat, lng} }
const SECTION = {
  start: { lat: 33.574976135592266, lng: -112.11364646976072 },
  end: { lat: 33.37935853143534, lng: -112.07326217050337 },
};

// Buffer distance in meters - route points within this distance of elevated/tunnel are excluded
const GRADE_SEPARATED_BUFFER_M = 60;

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

function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const A = lat - lat1;
  const B = lon - lon1;
  const C = lat2 - lat1;
  const D = lon2 - lon1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq !== 0 ? dot / lenSq : -1;
  param = Math.max(0, Math.min(1, param));
  const nearLat = lat1 + param * C;
  const nearLon = lon1 + param * D;
  return haversineDistance(lat, lon, nearLat, nearLon);
}

function findClosestIndex(coords, targetLat, targetLng) {
  let minDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat] = coords[i];
    const d = haversineDistance(targetLat, targetLng, lat, lng);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function isPointNearGradeSeparated(lat, lng, gradeSeparatedFeatures) {
  for (const f of gradeSeparatedFeatures) {
    const coords = f.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      const d = distanceToSegment(lat, lng, lat1, lng1, lat2, lng2);
      if (d <= GRADE_SEPARATED_BUFFER_M) return true;
    }
  }
  return false;
}

function main() {
  const routesPath = path.join(DATA_DIR, "phoenixLightRailRoutes.json");
  const separationPath = path.join(DATA_DIR, "phoenixSeparation.json");
  const overridesPath = path.join(DATA_DIR, "phoenixSeparationOverrides.json");

  const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
  const separation = JSON.parse(fs.readFileSync(separationPath, "utf8"));

  // Get B line both directions (0 = south-to-north, 1 = north-to-south)
  const bLineDir0 = routes.features.find(
    (f) => f.properties.route_id === "B" && f.properties.direction_id === "0"
  );
  const bLineDir1 = routes.features.find(
    (f) => f.properties.route_id === "B" && f.properties.direction_id === "1"
  );
  if (!bLineDir0 || !bLineDir1) {
    console.error("B line directions not found");
    process.exit(1);
  }

  const bLineShapes = [
    { coords: bLineDir0.geometry.coordinates, label: "east" },
    { coords: bLineDir1.geometry.coordinates, label: "west" },
  ];

  // Get grade-separated features (elevated + tunnel only)
  const gradeSeparatedFeatures = (separation.features || []).filter(
    (f) =>
      f.properties?.separationType === "elevated" ||
      f.properties?.separationType === "tunnel"
  );

  const allSegments = [];

  for (const { coords, label } of bLineShapes) {
    const idx1 = findClosestIndex(coords, SECTION.start.lat, SECTION.start.lng);
    const idx2 = findClosestIndex(coords, SECTION.end.lat, SECTION.end.lng);

    const startIdx = Math.min(idx1, idx2);
    const endIdx = Math.max(idx1, idx2);

    const segmentCoords = coords.slice(startIdx, endIdx + 1);
    const isGradeSeparated = segmentCoords.map(([lng, lat]) =>
      isPointNearGradeSeparated(lat, lng, gradeSeparatedFeatures)
    );

    let currentSegment = [];
    for (let i = 0; i < segmentCoords.length; i++) {
      if (isGradeSeparated[i]) {
        if (currentSegment.length >= 2) {
          allSegments.push({ coordinates: [...currentSegment], label });
        }
        currentSegment = [];
      } else {
        currentSegment.push(segmentCoords[i]);
      }
    }
    if (currentSegment.length >= 2) {
      allSegments.push({ coordinates: currentSegment, label });
    }
  }

  const bLineFeatures = allSegments.map(({ coordinates, label }, i) => ({
    type: "Feature",
    properties: {
      id: `manual-b-line-separated-at-grade-${i + 1}`,
      separationType: "separated_at_grade",
      name: `B Line (North-South) ${label} track`,
      description:
        "Dedicated right-of-way in cutting/embankment, separated from traffic",
      isManualOverride: true,
      source: "Local knowledge",
      lines: ["B"],
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  }));

  // Merge with existing overrides (preserve A line features)
  let existingFeatures = [];
  if (fs.existsSync(overridesPath)) {
    const existing = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    existingFeatures = existing.features || [];
  }

  const mergedFeatures = [...existingFeatures, ...bLineFeatures];

  const overrides = {
    type: "FeatureCollection",
    description:
      "Manual overrides for Phoenix Valley Metro grade separation data. A line and B line separated-at-grade sections.",
    lastUpdated: new Date().toISOString().slice(0, 10),
    features: mergedFeatures,
  };

  fs.writeFileSync(
    overridesPath,
    JSON.stringify(overrides, null, 2),
    "utf8"
  );

  const eastCount = allSegments.filter((s) => s.label === "east").length;
  const westCount = allSegments.filter((s) => s.label === "west").length;
  console.log(`Added ${bLineFeatures.length} B line segment(s) to ${overridesPath}`);
  console.log(`  East track: ${eastCount} segments, West track: ${westCount} segments`);
  console.log(
    `B line points: ${allSegments.reduce((s, seg) => s + seg.coordinates.length, 0)}`
  );
  console.log(`Total features: ${mergedFeatures.length}`);
}

main();
