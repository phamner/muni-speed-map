#!/usr/bin/env node
/**
 * Parse Toronto TTC GTFS data for LRT routes (Lines 5 and 6)
 * Generates GeoJSON for route lines
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GTFS_DIR = path.join(__dirname, "..", "gtfs_toronto_lrt");
const OUTPUT_DIR = path.join(__dirname, "..", "src", "data");

// LRT route IDs
const LRT_ROUTES = {
  "805": { name: "Line 5 Eglinton", color: "#D18E00" },
  "806": { name: "Line 6 Finch West", color: "#959595" },
};

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i]?.trim() || "";
    });
    return obj;
  });
}

function main() {
  console.log("🚊 Parsing Toronto LRT GTFS data...");

  // Read GTFS files
  const routesPath = path.join(GTFS_DIR, "routes.txt");
  const tripsPath = path.join(GTFS_DIR, "trips.txt");
  const shapesPath = path.join(GTFS_DIR, "shapes.txt");

  if (!fs.existsSync(routesPath)) {
    console.error("GTFS files not found. Please download first.");
    process.exit(1);
  }

  const routes = parseCsv(routesPath);
  const trips = parseCsv(tripsPath);
  const shapesRaw = parseCsv(shapesPath);

  console.log(`   Loaded ${routes.length} routes`);
  console.log(`   Loaded ${trips.length} trips`);
  console.log(`   Loaded ${shapesRaw.length} shape points`);

  // Build shape lookup
  const shapeMap = new Map();
  for (const pt of shapesRaw) {
    const id = pt.shape_id;
    if (!shapeMap.has(id)) {
      shapeMap.set(id, []);
    }
    shapeMap.get(id).push({
      lat: parseFloat(pt.shape_pt_lat),
      lon: parseFloat(pt.shape_pt_lon),
      seq: parseInt(pt.shape_pt_sequence, 10),
    });
  }

  // Sort each shape by sequence
  for (const [id, pts] of shapeMap) {
    pts.sort((a, b) => a.seq - b.seq);
  }

  // Find shapes for LRT routes
  const features = [];
  const foundRoutes = new Set();

  for (const routeId of Object.keys(LRT_ROUTES)) {
    const routeTrips = trips.filter((t) => t.route_id === routeId);

    if (routeTrips.length === 0) {
      console.log(`   ⚠️ Route ${routeId} (${LRT_ROUTES[routeId].name}) not found in GTFS`);
      continue;
    }

    // Get unique shape IDs for this route
    const shapeIds = [...new Set(routeTrips.map((t) => t.shape_id).filter(Boolean))];
    console.log(`   Route ${routeId}: ${routeTrips.length} trips, ${shapeIds.length} unique shapes`);

    // Find the longest shape (most points) for each direction
    let longestShape = null;
    let longestLen = 0;

    for (const shapeId of shapeIds) {
      const pts = shapeMap.get(shapeId);
      if (pts && pts.length > longestLen) {
        longestLen = pts.length;
        longestShape = { id: shapeId, pts };
      }
    }

    if (longestShape) {
      const coords = longestShape.pts.map((p) => [p.lon, p.lat]);
      features.push({
        type: "Feature",
        properties: {
          route_id: routeId,
          route_name: LRT_ROUTES[routeId].name,
          route_color: LRT_ROUTES[routeId].color,
          shape_id: longestShape.id,
        },
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
      });
      foundRoutes.add(routeId);
      console.log(`   ✅ Route ${routeId}: Added shape with ${coords.length} points`);
    }
  }

  // Create GeoJSON
  const geojson = {
    type: "FeatureCollection",
    features,
  };

  // Write output
  const outputPath = path.join(OUTPUT_DIR, "torontoLrtRoutes.json");
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\n✅ Wrote ${features.length} route(s) to ${outputPath}`);

  // Report missing routes
  for (const routeId of Object.keys(LRT_ROUTES)) {
    if (!foundRoutes.has(routeId)) {
      console.log(`   ⚠️ Note: Route ${routeId} (${LRT_ROUTES[routeId].name}) has no geometry data yet`);
    }
  }
}

main();
