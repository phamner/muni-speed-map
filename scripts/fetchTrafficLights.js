#!/usr/bin/env node
/**
 * Fetch Traffic Lights from OpenStreetMap via Overpass API
 *
 * Downloads traffic signals (highway=traffic_signals) for SF Muni Metro,
 * filters them to only include signals near transit lines,
 * and saves them as a GeoJSON file for use in the map.
 *
 * Run with: node scripts/fetchTrafficLights.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include traffic lights within this distance of a route
const PROXIMITY_METERS = 35;

// Haversine distance between two points in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
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

// Calculate minimum distance from a point to a line segment
function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const A = lat - lat1;
  const B = lon - lon1;
  const C = lat2 - lat1;
  const D = lon2 - lon1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let nearLat, nearLon;

  if (param < 0) {
    nearLat = lat1;
    nearLon = lon1;
  } else if (param > 1) {
    nearLat = lat2;
    nearLon = lon2;
  } else {
    nearLat = lat1 + param * C;
    nearLon = lon1 + param * D;
  }

  return haversineDistance(lat, lon, nearLat, nearLon);
}

// Calculate minimum distance from a point to a polyline
function distanceToLineString(lat, lon, coordinates) {
  let minDistance = Infinity;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];
    const distance = distanceToSegment(lat, lon, lat1, lon1, lat2, lon2);
    minDistance = Math.min(minDistance, distance);

    // Early exit if we're already close enough
    if (minDistance < PROXIMITY_METERS) break;
  }

  return minDistance;
}

const OVERPASS_API = "https://overpass.kumi.systems/api/interpreter";

async function fetchTrafficLights() {
  const name = "San Francisco";
  const bbox = [37.65, -122.55, 37.85, -122.35];
  const routesFile = "muniMetroRoutes.json";
  const outputFile = "sfTrafficLights.json";

  const [south, west, north, east] = bbox;

  console.log(`\n🚦 Fetching traffic lights for ${name}...`);
  console.log(`   Bounding box: ${south}, ${west}, ${north}, ${east}`);

  // Load routes for SF
  const routesPath = path.join(__dirname, "..", "src", "data", routesFile);
  let routes;
  try {
    routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
    console.log(
      `   Loaded ${routes.features.length} route segments from ${routesFile}`,
    );
  } catch (error) {
    console.error(
      `   ❌ Could not load routes from ${routesFile}:`,
      error.message,
    );
    return 0;
  }

  // Build route geometry map - handle both LineString and MultiLineString
  const routeCoordsByRouteId = new Map();
  routes.features.forEach((feature) => {
    const routeId = feature.properties.route_id;
    if (!routeCoordsByRouteId.has(routeId)) {
      routeCoordsByRouteId.set(routeId, []);
    }

    // Handle MultiLineString (array of line strings) vs LineString (single line)
    if (feature.geometry.type === "MultiLineString") {
      // Each element in coordinates is a separate line string
      for (const lineCoords of feature.geometry.coordinates) {
        routeCoordsByRouteId.get(routeId).push(lineCoords);
      }
    } else {
      // LineString - coordinates is a single line
      routeCoordsByRouteId.get(routeId).push(feature.geometry.coordinates);
    }
  });
  console.log(`   Found ${routeCoordsByRouteId.size} unique routes`);

  // Overpass QL query for traffic signals
  // Use a longer timeout and request only essential data
  const query = `
[out:json][timeout:180];
(
  node["highway"="traffic_signals"](${south},${west},${north},${east});
);
out body;
`;

  try {
    const response = await fetch(OVERPASS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    console.log(
      `   Found ${data.elements.length} total traffic lights in bounding box`,
    );

    // Filter traffic lights to only those near our transit lines
    const filteredFeatures = [];

    for (const node of data.elements) {
      const lat = node.lat;
      const lon = node.lon;
      const nearRoutes = [];

      // Check each route
      for (const [routeId, lineCoordsList] of routeCoordsByRouteId) {
        let isNear = false;
        for (const lineCoords of lineCoordsList) {
          const distance = distanceToLineString(lat, lon, lineCoords);
          if (distance <= PROXIMITY_METERS) {
            isNear = true;
            break;
          }
        }
        if (isNear) {
          nearRoutes.push(routeId);
        }
      }

      // Only include if near at least one route
      if (nearRoutes.length > 0) {
        filteredFeatures.push({
          type: "Feature",
          properties: {
            id: String(node.id),
            type: "traffic_signal",
            routes: nearRoutes, // Which routes this signal is near
            name: node.tags?.name || null,
            direction: node.tags?.direction || null,
            traffic_signals: node.tags?.["traffic_signals"] || null,
            traffic_signals_direction:
              node.tags?.["traffic_signals:direction"] || null,
          },
          geometry: {
            type: "Point",
            coordinates: [lon, lat],
          },
        });
      }
    }

    console.log(
      `   ✂️  Filtered to ${filteredFeatures.length} traffic lights near transit lines`,
    );

    // Create GeoJSON
    const geojson = {
      type: "FeatureCollection",
      features: filteredFeatures,
    };

    // Save to file
    const outputPath = path.join(__dirname, "..", "src", "data", outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`   ✅ Saved to src/data/${outputFile}`);

    return filteredFeatures.length;
  } catch (error) {
    console.error(`   ❌ Error fetching ${name}:`, error.message);
    return 0;
  }
}

async function main() {
  console.log("🚦 Traffic Light Fetcher");
  console.log("   Using OpenStreetMap Overpass API");
  console.log(
    `   Filtering to traffic lights within ${PROXIMITY_METERS}m of transit lines`,
  );

  const count = await fetchTrafficLights();

  console.log(
    `\n✨ Done! Saved ${count} traffic lights near SF Muni Metro routes`,
  );
}

main();
