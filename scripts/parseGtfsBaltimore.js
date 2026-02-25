#!/usr/bin/env node
/**
 * Parse Baltimore MTA Light RailLink GTFS data to extract routes as GeoJSON
 * 
 * Baltimore Light Rail is a single route (LIGHT RAILLINK) with multiple branches:
 * - Hunt Valley (north terminus)
 * - BWI Airport (south branch)
 * - Glen Burnie / Cromwell (south branch)
 * - Penn-Camden Shuttle (downtown spur)
 * 
 * We treat the main line as one unified route since trains run through-routed.
 * 
 * This script reads the GTFS files from gtfs_baltimore/ and generates:
 * - baltimoreLightRailRoutes.json: Route geometries
 * - baltimoreLightRailStops.json: Stop locations
 * 
 * Run with: node scripts/parseGtfsBaltimore.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GTFS_DIR = path.join(__dirname, "../gtfs_baltimore");
const OUTPUT_DIR = path.join(__dirname, "../src/data");

// Baltimore Light Rail branches
// Since this is really one line with branches, we'll create branch-based identifiers
// for filtering, but visually it's one system
const BRANCHES = {
  "Hunt Valley": { shortName: "HV", color: "#007499" },      // MTA teal
  "BWI Airport": { shortName: "BWI", color: "#007499" },     // Same color - unified line
  "Glen Burnie": { shortName: "GB", color: "#007499" },      // Same color - unified line
  "Penn-Camden": { shortName: "PC", color: "#007499" },      // Same color - unified line
};

// Shape ID patterns to branch mapping
function getBranchFromShapeId(shapeId) {
  if (!shapeId) return "Light Rail";
  
  const id = shapeId.toUpperCase();
  
  // Penn-Camden shuttle
  if (id.includes("PENN") || id.includes("CAMDEN") || id.includes("CAM_") || id.includes("_CAM")) {
    return "Penn-Camden";
  }
  // BWI branch
  if (id.includes("BWI")) {
    return "BWI Airport";
  }
  // Glen Burnie / Fairgrounds branch  
  if (id.includes("GB") || id.includes("FG")) {
    return "Glen Burnie";
  }
  // Hunt Valley (main northern terminus)
  if (id.includes("HV")) {
    return "Hunt Valley";
  }
  // North Avenue patterns are on the main line
  if (id.includes("NA")) {
    return "Main Line";
  }
  
  return "Light Rail";
}

// Parse CSV file
function parseCsv(filename) {
  const filepath = path.join(GTFS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    return [];
  }
  
  const content = fs.readFileSync(filepath, "utf8");
  const lines = content.split("\n").filter(line => line.trim());
  const header = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  
  return lines.slice(1).map(line => {
    // Handle quoted fields with commas
    const values = [];
    let current = "";
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = values[i] || "";
    });
    return obj;
  });
}

function perpendicularDistance(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    const px = x - x1;
    const py = y - y1;
    return Math.sqrt(px * px + py * py);
  }
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const px = x - projX;
  const py = y - projY;
  return Math.sqrt(px * px + py * py);
}

function douglasPeucker(coords, epsilon) {
  if (coords.length <= 2) return coords;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const distance = perpendicularDistance(
      coords[i],
      coords[0],
      coords[coords.length - 1],
    );
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) {
    return [coords[0], coords[coords.length - 1]];
  }
  const left = douglasPeucker(coords.slice(0, index + 1), epsilon);
  const right = douglasPeucker(coords.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

// Main function
async function main() {
  console.log("🚇 Parsing Baltimore MTA Light RailLink GTFS data...\n");

  // 1. Read trips.txt and choose representative shapes by normalized headsign+direction
  console.log("Reading trips.txt...");
  const trips = parseCsv("trips.txt");

  const normalizeHeadsign = (headsign) =>
    (headsign || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .replace(/\(.*?\)/g, "")
      .trim();

  const candidatesByServiceDir = new Map(); // key -> { shapeId -> count/headsign }
  const shapeHeadsigns = new Map(); // shape_id -> headsign for debugging

  for (const trip of trips) {
    const shapeId = trip.shape_id;
    if (!shapeId) continue;

    const directionId = trip.direction_id || "0";
    const normalizedHeadsign = normalizeHeadsign(trip.trip_headsign);
    const branch = getBranchFromShapeId(shapeId);
    const key = `${branch}__${normalizedHeadsign || "UNKNOWN"}__${directionId}`;

    if (!candidatesByServiceDir.has(key)) {
      candidatesByServiceDir.set(key, new Map());
    }
    const byShape = candidatesByServiceDir.get(key);
    const existing = byShape.get(shapeId) || {
      count: 0,
      headsign: trip.trip_headsign || "",
      branch,
      directionId,
    };
    existing.count += 1;
    byShape.set(shapeId, existing);

    if (!shapeHeadsigns.has(shapeId)) {
      shapeHeadsigns.set(shapeId, trip.trip_headsign);
    }
  }

  const selectedShapeIds = new Set();
  console.log(`Found ${candidatesByServiceDir.size} service-direction groups`);
  for (const [key, byShape] of candidatesByServiceDir) {
    const [bestShapeId, best] = Array.from(byShape.entries()).sort(
      (a, b) => b[1].count - a[1].count,
    )[0];
    selectedShapeIds.add(bestShapeId);
    console.log(
      `  ${key} -> ${bestShapeId} (${best.count} trips, ${best.headsign || "no headsign"})`,
    );
  }

  console.log(`Selected ${selectedShapeIds.size} representative shapes`);

  // 2. Read shapes.txt and build geometries per shape
  console.log("\nReading shapes.txt...");
  const shapes = parseCsv("shapes.txt");
  
  const shapeGeometries = new Map(); // shape_id -> [[lon, lat], ...]
  
  for (const point of shapes) {
    const shapeId = point.shape_id;
    if (!selectedShapeIds.has(shapeId)) continue;
    
    if (!shapeGeometries.has(shapeId)) {
      shapeGeometries.set(shapeId, []);
    }
    
    const lat = parseFloat(point.shape_pt_lat);
    const lon = parseFloat(point.shape_pt_lon);
    const seq = parseInt(point.shape_pt_sequence);
    
    shapeGeometries.get(shapeId).push({ lat, lon, seq });
  }
  
  // Sort each shape's points by sequence and convert to coordinate arrays
  // then simplify to reduce client parse/render cost.
  let totalOriginalCoords = 0;
  let totalSimplifiedCoords = 0;
  const SIMPLIFY_EPSILON = 0.00006; // ~6m; conservative for rail geometry
  for (const [shapeId, points] of shapeGeometries) {
    points.sort((a, b) => a.seq - b.seq);
    const coords = points.map(p => [p.lon, p.lat]);
    const simplified =
      coords.length > 100 ? douglasPeucker(coords, SIMPLIFY_EPSILON) : coords;
    totalOriginalCoords += coords.length;
    totalSimplifiedCoords += simplified.length;
    shapeGeometries.set(shapeId, simplified);
  }
  
  console.log(`Processed ${shapeGeometries.size} selected shape geometries`);
  console.log(
    `Simplified coordinates: ${totalOriginalCoords} -> ${totalSimplifiedCoords} (${Math.round((totalSimplifiedCoords / totalOriginalCoords) * 100)}%)`,
  );

  // 3. Build a single unified GeoJSON feature for the Light Rail system
  // We'll create a MultiLineString with representative segments only.
  console.log("\nBuilding route GeoJSON...");
  
  const seenSegments = new Set();
  const allCoords = [];
  
  for (const shapeId of selectedShapeIds) {
    const coords = shapeGeometries.get(shapeId);
    if (!coords || coords.length < 2) continue;
    
    // Create a simplified key for this shape to detect near-duplicates
    const startKey = `${coords[0][0].toFixed(4)},${coords[0][1].toFixed(4)}`;
    const endKey = `${coords[coords.length-1][0].toFixed(4)},${coords[coords.length-1][1].toFixed(4)}`;
    const shapeKey = `${startKey}-${endKey}-${coords.length}`;
    
    // Also check reverse direction
    const reverseKey = `${endKey}-${startKey}-${coords.length}`;
    
    if (!seenSegments.has(shapeKey) && !seenSegments.has(reverseKey)) {
      seenSegments.add(shapeKey);
      allCoords.push(coords);
    }
  }
  
  console.log(`Created ${allCoords.length} unique line segments after deduplication`);

  // Create a single feature for the entire Light Rail system
  const routeFeatures = [{
    type: "Feature",
    properties: {
      route_id: "Light Rail",
      route_name: "Light RailLink",
      route_color: "#007499",
    },
    geometry: {
      type: "MultiLineString",
      coordinates: allCoords,
    },
  }];

  const routesGeoJSON = {
    type: "FeatureCollection",
    features: routeFeatures,
  };

  // 4. Read stops.txt
  console.log("\nReading stops.txt...");
  const routes = parseCsv("routes.txt");
  const stopTimes = parseCsv("stop_times.txt");
  const stops = parseCsv("stops.txt");

  const lightRailRouteIds = new Set(
    routes
      .filter(
        (route) =>
          route.route_type === "0" ||
          (route.route_short_name || "").toUpperCase().includes("LIGHT RAIL"),
      )
      .map((route) => route.route_id),
  );

  const lightRailTripIds = new Set(
    trips
      .filter((trip) => lightRailRouteIds.has(trip.route_id))
      .map((trip) => trip.trip_id),
  );

  const lightRailStopIds = new Set();
  for (const stopTime of stopTimes) {
    if (lightRailTripIds.has(stopTime.trip_id)) {
      lightRailStopIds.add(stopTime.stop_id);
    }
  }
  
  // Build stop features - filter to just Light Rail stops
  const stopFeatures = [];
  
  for (const stop of stops) {
    if (!lightRailStopIds.has(stop.stop_id)) continue;

    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    
    if (isNaN(lat) || isNaN(lon)) continue;
    
    // Clean up stop name (remove direction suffix)
    let stopName = stop.stop_name;
    stopName = stopName.replace(/\s*\(Northbound\)$/i, "");
    stopName = stopName.replace(/\s*\(Southbound\)$/i, "");
    stopName = stopName.trim();

    stopFeatures.push({
      type: "Feature",
      properties: {
        stop_id: stop.stop_id,
        stop_name: stopName,
        routes: ["Light Rail"],
      },
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
    });
  }
  
  console.log(`Found ${stopFeatures.length} Light Rail stop points`);

  const stopsGeoJSON = {
    type: "FeatureCollection",
    features: stopFeatures,
  };

  // 5. Write output files
  console.log("\nWriting output files...");
  
  const routesPath = path.join(OUTPUT_DIR, "baltimoreLightRailRoutes.json");
  fs.writeFileSync(routesPath, JSON.stringify(routesGeoJSON, null, 2));
  console.log(`  Wrote ${routesPath}`);
  
  const stopsPath = path.join(OUTPUT_DIR, "baltimoreLightRailStops.json");
  fs.writeFileSync(stopsPath, JSON.stringify(stopsGeoJSON, null, 2));
  console.log(`  Wrote ${stopsPath}`);
  
  console.log("\n✅ Done!");
}

main().catch(console.error);
