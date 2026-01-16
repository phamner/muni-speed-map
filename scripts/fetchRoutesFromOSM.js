#!/usr/bin/env node
/**
 * Fetch Light Rail Routes from OpenStreetMap via Overpass API
 *
 * Downloads railway=light_rail and railway=tram routes for specified cities
 * and saves them as GeoJSON files for use in the map.
 *
 * Run with: node scripts/fetchRoutesFromOSM.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "src", "data");

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// City configurations with their bounding boxes and route filters
const CITIES = {
  Pittsburgh: {
    name: "Pittsburgh",
    bbox: [40.3, -80.15, 40.55, -79.85],
    railwayTypes: "light_rail|subway|tram",
    outputRoutesFile: "pittsburghTRoutes.json",
    outputStopsFile: "pittsburghTStops.json",
    lineColors: {
      RED: "#E31837",
      BLUE: "#0066B3",
      SLVR: "#A7A9AC",
    },
  },
  Dallas: {
    name: "Dallas",
    bbox: [32.6, -97.1, 33.05, -96.55],
    railwayTypes: "light_rail",
    outputRoutesFile: "dallasDartRoutes.json",
    outputStopsFile: "dallasDartStops.json",
    lineColors: {
      RED: "#CE0E2D",
      BLUE: "#0039A6",
      GREEN: "#009B3A",
      ORANGE: "#F7931E",
    },
  },
  Minneapolis: {
    name: "Minneapolis",
    bbox: [44.85, -93.45, 45.1, -93.1],
    railwayTypes: "light_rail",
    outputRoutesFile: "minneapolisMetroRoutes.json",
    outputStopsFile: "minneapolisMetroStops.json",
    lineColors: {
      Blue: "#0053A0",
      Green: "#009E49",
    },
  },
  Denver: {
    name: "Denver",
    bbox: [39.55, -105.15, 39.95, -104.75],
    railwayTypes: "light_rail",
    outputRoutesFile: "denverRtdRoutes.json",
    outputStopsFile: "denverRtdStops.json",
    lineColors: {
      default: "#009CDE",
    },
  },
  SaltLakeCity: {
    name: "Salt Lake City",
    bbox: [40.55, -112.1, 40.9, -111.7],
    railwayTypes: "light_rail|tram",
    outputRoutesFile: "slcTraxRoutes.json",
    outputStopsFile: "slcTraxStops.json",
    lineColors: {
      Blue: "#0053A0",
      Red: "#EE3124",
      Green: "#008144",
      "S-Line": "#77777a",
    },
  },
  Phoenix: {
    name: "Phoenix",
    bbox: [33.35, -112.35, 33.55, -111.75],
    railwayTypes: "light_rail",
    outputRoutesFile: "phoenixLightRailRoutes.json",
    outputStopsFile: "phoenixLightRailStops.json",
    lineColors: {
      MARS: "#E5721A", // Official Valley Metro Rail orange
    },
  },
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch railway ways for a city
async function fetchRailwayWays(cityKey) {
  const city = CITIES[cityKey];
  const [south, west, north, east] = city.bbox;

  console.log(`\n📍 Fetching routes for ${city.name}...`);
  console.log(`   Bounding box: ${south}, ${west}, ${north}, ${east}`);

  // Overpass QL query for railway ways with geometry
  const query = `
[out:json][timeout:90];
(
  way["railway"~"${city.railwayTypes}"](${south},${west},${north},${east});
);
out body geom;
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
    console.log(`   Found ${data.elements.length} railway ways`);

    // Convert to GeoJSON features
    const features = data.elements
      .filter((el) => el.geometry && el.geometry.length > 1)
      .map((element) => {
        // Determine route_id from tags or use 'default'
        let route_id = "default";
        if (element.tags) {
          if (element.tags.ref) {
            route_id = element.tags.ref;
          } else if (element.tags.name) {
            // Try to extract color from name
            const name = element.tags.name.toLowerCase();
            if (name.includes("red")) route_id = "RED";
            else if (name.includes("blue")) route_id = "BLUE";
            else if (name.includes("green")) route_id = "GREEN";
            else if (name.includes("orange")) route_id = "ORANGE";
            else if (name.includes("silver")) route_id = "SLVR";
            else if (name.includes("gold")) route_id = "GOLD";
          }
        }

        // Get color from our line colors or use default
        const color =
          city.lineColors[route_id] || city.lineColors["default"] || "#666666";

        return {
          type: "Feature",
          properties: {
            id: element.id,
            route_id: route_id,
            route_color: color,
            railway: element.tags?.railway || "light_rail",
            name: element.tags?.name || "",
            ref: element.tags?.ref || "",
          },
          geometry: {
            type: "LineString",
            coordinates: element.geometry.map((pt) => [pt.lon, pt.lat]),
          },
        };
      });

    console.log(`   Created ${features.length} GeoJSON features`);

    // Save routes
    const geojson = {
      type: "FeatureCollection",
      features,
    };

    const outputPath = path.join(DATA_DIR, city.outputRoutesFile);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`   ✅ Saved routes to ${city.outputRoutesFile}`);

    return features.length;
  } catch (error) {
    console.error(
      `   ❌ Error fetching routes for ${city.name}:`,
      error.message
    );
    return 0;
  }
}

// Fetch railway stations/stops for a city
async function fetchRailwayStops(cityKey) {
  const city = CITIES[cityKey];
  const [south, west, north, east] = city.bbox;

  console.log(`   Fetching stops for ${city.name}...`);

  // Overpass QL query for railway stations/stops
  const query = `
[out:json][timeout:60];
(
  node["railway"="station"](${south},${west},${north},${east});
  node["railway"="stop"](${south},${west},${north},${east});
  node["railway"="halt"](${south},${west},${north},${east});
  node["public_transport"="stop_position"]["train"="yes"](${south},${west},${north},${east});
  node["public_transport"="stop_position"]["light_rail"="yes"](${south},${west},${north},${east});
  node["public_transport"="stop_position"]["tram"="yes"](${south},${west},${north},${east});
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
    console.log(`   Found ${data.elements.length} stops/stations`);

    // Convert to GeoJSON features
    const features = data.elements.map((element) => ({
      type: "Feature",
      properties: {
        id: element.id,
        name: element.tags?.name || "Unknown",
        type: element.tags?.railway || element.tags?.public_transport || "stop",
      },
      geometry: {
        type: "Point",
        coordinates: [element.lon, element.lat],
      },
    }));

    // Save stops
    const geojson = {
      type: "FeatureCollection",
      features,
    };

    const outputPath = path.join(DATA_DIR, city.outputStopsFile);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(
      `   ✅ Saved ${features.length} stops to ${city.outputStopsFile}`
    );

    return features.length;
  } catch (error) {
    console.error(
      `   ❌ Error fetching stops for ${city.name}:`,
      error.message
    );
    return 0;
  }
}

// Main
async function main() {
  console.log("🚂 Fetching Light Rail Routes from OpenStreetMap");
  console.log("================================================");

  const results = {};

  for (const cityKey of Object.keys(CITIES)) {
    const routeCount = await fetchRailwayWays(cityKey);
    await delay(3000); // Respect rate limits

    const stopCount = await fetchRailwayStops(cityKey);
    await delay(3000);

    results[cityKey] = { routes: routeCount, stops: stopCount };
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Summary:");
  for (const [city, counts] of Object.entries(results)) {
    console.log(
      `  ${CITIES[city].name}: ${counts.routes} route segments, ${counts.stops} stops`
    );
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n✅ Done! Route and stop data saved to src/data/");
}

main().catch(console.error);
