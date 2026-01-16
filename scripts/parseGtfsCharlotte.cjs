#!/usr/bin/env node
/**
 * Parse Charlotte GTFS data to create GeoJSON files for light rail routes
 * Routes: 501 (Blue Line), 510 (Gold Line)
 */

const fs = require("fs");
const path = require("path");

const GTFS_DIR = path.join(__dirname, "..", "gtfs_charlotte");
const OUTPUT_DIR = path.join(__dirname, "..", "src", "data");

// Route definitions with official CATS colors
const ROUTES = {
  501: { name: "Blue Line", color: "#0077C8" }, // LYNX Blue
  510: { name: "Gold Line", color: "#C5A900" }, // CityLYNX Gold
};

// Parse CSV file
function parseCSV(filename) {
  const content = fs.readFileSync(path.join(GTFS_DIR, filename), "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  return lines.slice(1).map((line) => {
    // Handle quoted fields
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
    headers.forEach((h, i) => {
      obj[h] = values[i] || "";
    });
    return obj;
  });
}

// Main function
function main() {
  console.log("Parsing Charlotte GTFS data...");

  // Parse files
  const routes = parseCSV("routes.txt");
  const trips = parseCSV("trips.txt");
  const shapes = parseCSV("shapes.txt");
  const stops = parseCSV("stops.txt");
  const stopTimes = parseCSV("stop_times.txt");

  // Filter to rail routes (route_type = 0)
  const railRouteIds = routes
    .filter((r) => r.route_type === "0")
    .map((r) => r.route_id);

  console.log("Rail routes found:", railRouteIds);

  // Get shape_ids for each rail route
  const routeShapes = {};
  for (const routeId of railRouteIds) {
    const routeTrips = trips.filter((t) => t.route_id === routeId);
    const shapeIds = [...new Set(routeTrips.map((t) => t.shape_id))];
    routeShapes[routeId] = shapeIds;
    console.log(`Route ${routeId}: ${shapeIds.length} shapes`);
  }

  // Build shape coordinates lookup
  const shapeCoords = {};
  for (const s of shapes) {
    const id = s.shape_id;
    if (!shapeCoords[id]) shapeCoords[id] = [];
    shapeCoords[id].push({
      lat: parseFloat(s.shape_pt_lat),
      lon: parseFloat(s.shape_pt_lon),
      seq: parseInt(s.shape_pt_sequence),
    });
  }
  // Sort by sequence
  for (const id in shapeCoords) {
    shapeCoords[id].sort((a, b) => a.seq - b.seq);
  }

  // Find the longest shape for each route (most complete geometry)
  const routeFeatures = [];
  for (const routeId of railRouteIds) {
    const shapeIds = routeShapes[routeId];
    let longestShape = null;
    let maxLength = 0;

    for (const shapeId of shapeIds) {
      if (shapeCoords[shapeId] && shapeCoords[shapeId].length > maxLength) {
        maxLength = shapeCoords[shapeId].length;
        longestShape = shapeId;
      }
    }

    if (longestShape) {
      const coords = shapeCoords[longestShape].map((p) => [p.lon, p.lat]);
      const routeInfo = ROUTES[routeId] || {
        name: `Route ${routeId}`,
        color: "#888888",
      };

      routeFeatures.push({
        type: "Feature",
        properties: {
          route_id: routeId,
          route_name: routeInfo.name,
          route_color: routeInfo.color,
          shape_id: longestShape,
        },
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
      });
      console.log(
        `  Route ${routeId} (${routeInfo.name}): ${coords.length} points from shape ${longestShape}`
      );
    }
  }

  // Get stop_ids served by rail routes
  const railTripIds = trips
    .filter((t) => railRouteIds.includes(t.route_id))
    .map((t) => t.trip_id);

  const railStopIds = new Set();
  const stopRoutes = {}; // Map stop_id to routes that serve it
  for (const st of stopTimes) {
    if (railTripIds.includes(st.trip_id)) {
      const trip = trips.find((t) => t.trip_id === st.trip_id);
      if (trip) {
        railStopIds.add(st.stop_id);
        if (!stopRoutes[st.stop_id]) stopRoutes[st.stop_id] = new Set();
        stopRoutes[st.stop_id].add(trip.route_id);
      }
    }
  }

  // Filter stops and create features
  const stopFeatures = stops
    .filter((s) => railStopIds.has(s.stop_id))
    .map((s) => ({
      type: "Feature",
      properties: {
        stop_id: s.stop_id,
        stop_name: s.stop_name,
        routes: [...(stopRoutes[s.stop_id] || [])].sort(),
      },
      geometry: {
        type: "Point",
        coordinates: [parseFloat(s.stop_lon), parseFloat(s.stop_lat)],
      },
    }));

  console.log(`Found ${stopFeatures.length} rail stations`);

  // Create GeoJSON files
  const routesGeoJSON = {
    type: "FeatureCollection",
    features: routeFeatures,
  };

  const stopsGeoJSON = {
    type: "FeatureCollection",
    features: stopFeatures,
  };

  // Write output files
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "charlotteLightRailRoutes.json"),
    JSON.stringify(routesGeoJSON, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "charlotteLightRailStops.json"),
    JSON.stringify(stopsGeoJSON, null, 2)
  );

  console.log("\nCreated:");
  console.log(
    `  - src/data/charlotteLightRailRoutes.json (${routeFeatures.length} routes)`
  );
  console.log(
    `  - src/data/charlotteLightRailStops.json (${stopFeatures.length} stops)`
  );
}

main();
