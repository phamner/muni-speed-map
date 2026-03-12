#!/usr/bin/env node
/**
 * Add separated_at_grade override for Phoenix A line between two points,
 * excluding sections already marked as grade-separated (elevated/tunnel).
 *
 * Run with: node scripts/addPhoenixALineSeparationOverride.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "src", "data");

// User-specified sections: { start: {lat, lng}, end: {lat, lng} }
const SECTIONS = [
  {
    start: { lat: 33.44829214579853, lng: -112.07373489789326 },
    end: { lat: 33.44819201389412, lng: -112.02532893207844 },
  },
  {
    start: { lat: 33.44823890207363, lng: -112.02525862344145 },
    end: { lat: 33.41532395490916, lng: -111.79067490106101 },
  },
];

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

  // Get A line both directions (0 = south/west-to-east, 1 = north/east-to-west)
  const aLineDir0 = routes.features.find(
    (f) => f.properties.route_id === "A" && f.properties.direction_id === "0"
  );
  const aLineDir1 = routes.features.find(
    (f) => f.properties.route_id === "A" && f.properties.direction_id === "1"
  );
  if (!aLineDir0 || !aLineDir1) {
    console.error("A line directions not found");
    process.exit(1);
  }

  const aLineShapes = [
    { coords: aLineDir0.geometry.coordinates, label: "south" },
    { coords: aLineDir1.geometry.coordinates, label: "north" },
  ];

  // Get grade-separated features (elevated + tunnel only)
  const gradeSeparatedFeatures = (separation.features || []).filter(
    (f) =>
      f.properties?.separationType === "elevated" ||
      f.properties?.separationType === "tunnel"
  );

  const allSegments = [];

  for (const { coords, label } of aLineShapes) {
    for (const section of SECTIONS) {
      const idx1 = findClosestIndex(coords, section.start.lat, section.start.lng);
      const idx2 = findClosestIndex(coords, section.end.lat, section.end.lng);

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
  }

  const segments = allSegments;

  if (segments.length === 0) {
    console.log(
      "No at-grade segments found - entire section may be grade-separated"
    );
    process.exit(0);
  }

  const features = segments.map(({ coordinates, label }, i) => ({
    type: "Feature",
    properties: {
      id: `manual-a-line-separated-at-grade-${i + 1}`,
      separationType: "separated_at_grade",
      name: `A Line (East-West) ${label === "north" ? "north" : "south"} track`,
      description:
        "Dedicated right-of-way in cutting/embankment, separated from traffic",
      isManualOverride: true,
      source: "Local knowledge",
      lines: ["A"],
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  }));

  const overrides = {
    type: "FeatureCollection",
    description:
      "Manual overrides for Phoenix Valley Metro grade separation data. A line separated-at-grade sections.",
    lastUpdated: new Date().toISOString().slice(0, 10),
    features,
  };

  fs.writeFileSync(
    overridesPath,
    JSON.stringify(overrides, null, 2),
    "utf8"
  );

  const southCount = segments.filter((s) => s.label === "south").length;
  const northCount = segments.filter((s) => s.label === "north").length;
  console.log(`Wrote ${features.length} segment(s) to ${overridesPath}`);
  console.log(`  South track: ${southCount} segments, North track: ${northCount} segments`);
  console.log(
    `Total points: ${segments.reduce((s, seg) => s + seg.coordinates.length, 0)}`
  );
}

main();
