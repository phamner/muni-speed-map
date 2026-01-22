#!/usr/bin/env node
/**
 * Fetch Railway Separation Data from OpenStreetMap via Overpass API
 *
 * Downloads track separation data (tunnel, bridge, street running, embedded, etc.)
 * for rail lines in all cities, filters them to only include track near our transit lines,
 * and saves them as GeoJSON files for use in the "By Separation" view.
 *
 * Separation categories:
 * - 🔵 Tunnel / Trench: tunnel=yes
 * - 🟢 Elevated/Bridge: bridge=yes
 * - 🔴 Street Running: embedded=yes, railway:run=street, tram:tram=yes
 * - 🟠 Reserved Lane: railway:traffic_mode=mixed, etc.
 * - 🟡 Separated At-Grade: explicit barrier/fencing tags
 * - ⬜ Unknown: No separation tags (handled in rendering, not in data)
 *
 * Run with: node scripts/fetchSeparationData.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include track within this distance of our routes
// Increased from 75 to 100 to account for slight geometry misalignment between GTFS and OSM
const PROXIMITY_METERS = 100;

// Haversine distance between two points in meters
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

// Check if a way segment is near any route
function isWayNearRoutes(wayGeometry, routeCoords) {
  for (const point of wayGeometry) {
    for (const coords of routeCoords) {
      for (let i = 0; i < coords.length - 1; i++) {
        const [lon1, lat1] = coords[i];
        const [lon2, lat2] = coords[i + 1];
        const distance = distanceToSegment(
          point.lat,
          point.lon,
          lat1,
          lon1,
          lat2,
          lon2
        );
        if (distance <= PROXIMITY_METERS) {
          return true;
        }
      }
    }
  }
  return false;
}

// Data directory for routes and output
const DATA_DIR = path.join(__dirname, "..", "src", "data");

// City configurations
const CITIES = {
  SF: {
    name: "San Francisco",
    bbox: [37.65, -122.55, 37.85, -122.35],
    routesFile: "muniMetroRoutes.json",
    outputFile: "sfSeparation.json",
    railwayTypes: "light_rail|tram", // Only Muni Metro, not BART
  },
  LA: {
    name: "Los Angeles",
    bbox: [33.76, -118.5, 34.18, -117.74],
    routesFile: "laMetroRoutes.json",
    outputFile: "laSeparation.json",
    railwayTypes: "light_rail|subway",
  },
  Seattle: {
    name: "Seattle",
    bbox: [47.23, -122.46, 47.82, -122.1],
    routesFile: "seattleLinkRoutes.json",
    outputFile: "seattleSeparation.json",
    railwayTypes: "light_rail",
  },
  Boston: {
    name: "Boston",
    bbox: [42.25, -71.2, 42.4, -71.0],
    routesFile: "bostonGreenLineRoutes.json",
    outputFile: "bostonSeparation.json",
    railwayTypes: "light_rail|tram", // Only Green Line, not heavy rail subway
  },
  Portland: {
    name: "Portland",
    bbox: [45.4, -122.85, 45.6, -122.5],
    routesFile: "portlandMaxRoutes.json",
    outputFile: "portlandSeparation.json",
    railwayTypes: "light_rail|tram",
  },
  "San Diego": {
    name: "San Diego",
    bbox: [32.65, -117.2, 32.95, -116.95],
    routesFile: "sanDiegoTrolleyRoutes.json",
    outputFile: "sanDiegoSeparation.json",
    railwayTypes: "light_rail",
  },
  Toronto: {
    name: "Toronto",
    bbox: [43.62, -79.55, 43.85, -79.2], // Expanded for Line 5 Eglinton & Line 6 Finch West
    routesFile: "torontoStreetcarRoutes.json",
    outputFile: "torontoSeparation.json",
    railwayTypes: "tram|light_rail", // Include streetcars and LRT lines
  },
  Philadelphia: {
    name: "Philadelphia",
    bbox: [39.9, -75.25, 40.05, -75.05],
    routesFile: "phillyTrolleyRoutes.json",
    outputFile: "phillySeparation.json",
    railwayTypes: "light_rail|tram", // Only trolleys, not heavy rail subway
  },
  Sacramento: {
    name: "Sacramento",
    bbox: [38.5, -121.5, 38.65, -121.35],
    routesFile: "sacramentoLightRailRoutes.json",
    outputFile: "sacramentoSeparation.json",
    railwayTypes: "light_rail",
  },
  Pittsburgh: {
    name: "Pittsburgh",
    bbox: [40.3, -80.1, 40.5, -79.9],
    routesFile: "pittsburghTRoutes.json",
    outputFile: "pittsburghSeparation.json",
    railwayTypes: "light_rail|tram",
  },
  Dallas: {
    name: "Dallas",
    bbox: [32.65, -97.0, 33.0, -96.6],
    routesFile: "dallasDartRoutes.json",
    outputFile: "dallasSeparation.json",
    railwayTypes: "light_rail",
  },
  Minneapolis: {
    name: "Minneapolis",
    bbox: [44.88, -93.4, 45.05, -93.15],
    routesFile: "minneapolisMetroRoutes.json",
    outputFile: "minneapolisSeparation.json",
    railwayTypes: "light_rail",
  },
  Denver: {
    name: "Denver",
    bbox: [39.6, -105.1, 39.9, -104.8],
    routesFile: "denverRtdRoutes.json",
    outputFile: "denverSeparation.json",
    railwayTypes: "light_rail",
  },
  "Salt Lake City": {
    name: "Salt Lake City",
    bbox: [40.6, -112.0, 40.85, -111.75],
    routesFile: "slcTraxRoutes.json",
    outputFile: "slcSeparation.json",
    railwayTypes: "light_rail",
  },
  "San Jose": {
    name: "San Jose",
    bbox: [37.23, -122.08, 37.42, -121.78],
    routesFile: "vtaLightRailRoutes.json",
    outputFile: "vtaSeparation.json",
    railwayTypes: "light_rail",
  },
  Phoenix: {
    name: "Phoenix",
    bbox: [33.35, -112.35, 33.55, -111.75],
    routesFile: "phoenixLightRailRoutes.json",
    outputFile: "phoenixSeparation.json",
    railwayTypes: "light_rail",
  },
  Charlotte: {
    name: "Charlotte",
    bbox: [35.09, -80.95, 35.35, -80.7],
    routesFile: "charlotteLightRailRoutes.json",
    outputFile: "charlotteSeparation.json",
    railwayTypes: "light_rail|tram",
  },
  Baltimore: {
    name: "Baltimore",
    bbox: [39.15, -76.69, 39.52, -76.60],
    routesFile: "baltimoreLightRailRoutes.json",
    outputFile: "baltimoreSeparation.json",
    railwayTypes: "light_rail",
  },
  Cleveland: {
    name: "Cleveland",
    bbox: [41.39, -81.86, 41.55, -81.50],
    routesFile: "clevelandRtaRoutes.json",
    outputFile: "clevelandSeparation.json",
    railwayTypes: "light_rail|subway", // Blue/Green are light_rail, Red is subway in OSM
  },
};

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Add delay between requests to be nice to Overpass
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Determine separation type from OSM tags
function getSeparationType(tags) {
  // Priority order: most specific to least specific
  
  // 🔵 Tunnel - explicit tag or layer <= -1
  if (tags?.tunnel === "yes") {
    return "tunnel";
  }
  
  // 🟢 Elevated/Bridge - explicit tag
  if (tags?.bridge === "yes") {
    return "elevated";
  }
  
  // Use layer tag as fallback for tunnel/elevated
  // This catches freeway median rail that only has bridge=yes at overpasses
  const layer = parseInt(tags?.layer, 10);
  if (!isNaN(layer)) {
    if (layer <= -1) {
      return "tunnel";
    }
    if (layer >= 1) {
      return "elevated";
    }
  }
  
  // 🔴 Street Running - shares lanes with cars
  if (
    tags?.embedded === "yes" ||
    tags?.["railway:run"] === "street" ||
    tags?.["tram:track"] === "yes" ||
    tags?.["railway:track"] === "streetrunning" ||
    tags?.["lane"] === "shared"
  ) {
    return "street_running";
  }
  
  // 🟠 Reserved Lane - dedicated lane but minimal barriers
  if (
    tags?.["railway:traffic_mode"] === "mixed" ||
    tags?.["railway:run"] === "crossing" ||
    tags?.segregated === "no"
  ) {
    return "reserved_lane";
  }
  
  // 🟡 Separated At-Grade - barriers/fencing but at street level
  if (
    tags?.segregated === "yes" ||
    tags?.barrier ||
    tags?.fence === "yes" ||
    tags?.["railway:run"] === "grade_separated"
  ) {
    return "separated_at_grade";
  }
  
  // Cuttings and embankments are typically separated
  if (tags?.cutting === "yes" || tags?.embankment === "yes") {
    return "separated_at_grade";
  }
  
  // ⬜ Unknown - no separation data
  return "unknown";
}

// Fetch separation data for a city
async function fetchSeparationData(cityKey, config) {
  const [south, west, north, east] = config.bbox;

  // Overpass QL query for railway ways with ANY separation-related tags
  // We fetch all rail ways in the area, then filter by tags in code
  // layer tag is used as fallback for elevated (layer >= 1) or tunnel (layer <= -1)
  const query = `
[out:json][timeout:120];
(
  // Get all railway ways with separation-related tags
  way["railway"~"${config.railwayTypes}"]["tunnel"="yes"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["bridge"="yes"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["embedded"="yes"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["railway:run"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["railway:traffic_mode"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["segregated"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["cutting"="yes"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["embankment"="yes"](${south},${west},${north},${east});
  way["railway"~"${config.railwayTypes}"]["tram:track"="yes"](${south},${west},${north},${east});
  // layer tag for elevated (>=1) or underground (<=-1) - catches freeway median rail
  way["railway"~"${config.railwayTypes}"]["layer"](${south},${west},${north},${east});
);
out body geom;
`;

  console.log(`\n📍 Fetching separation data for ${config.name}...`);

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
      `   Found ${data.elements.length} segments with separation tags in bounding box`
    );

    // Load route data to filter by proximity
    const routesPath = path.join(DATA_DIR, config.routesFile);
    if (!fs.existsSync(routesPath)) {
      console.log(
        `   ⚠️ Routes file not found: ${config.routesFile}, skipping city`
      );
      return;
    }

    const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));

    // Extract route coordinates, handling both LineString and MultiLineString
    const routeCoords = [];
    routes.features.forEach((f) => {
      if (f.geometry.type === "MultiLineString") {
        routeCoords.push(...f.geometry.coordinates);
      } else if (f.geometry.type === "LineString") {
        routeCoords.push(f.geometry.coordinates);
      }
    });

    // Filter ways by proximity to our routes
    let filteredElements = data.elements.filter((el) => {
      if (!el.geometry) return false;
      return isWayNearRoutes(el.geometry, routeCoords);
    });

    console.log(
      `   After proximity filter: ${filteredElements.length} segments near transit lines`
    );

    if (filteredElements.length === 0) {
      console.log(
        `   ℹ️ No separation data found near transit lines for ${config.name}`
      );
      // Still save an empty file so the app doesn't error
      const emptyGeojson = {
        type: "FeatureCollection",
        generated: new Date().toISOString(),
        source: "OpenStreetMap via Overpass API",
        features: [],
      };
      const outputPath = path.join(DATA_DIR, config.outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(emptyGeojson, null, 2));
      console.log(`   ✅ Saved empty file to ${config.outputFile}`);
      return;
    }

    // Convert to GeoJSON with separation type
    const features = filteredElements.map((element) => {
      const separationType = getSeparationType(element.tags);

      return {
        type: "Feature",
        properties: {
          id: element.id,
          separationType,
          name: element.tags?.name || null,
          // Raw tags for debugging/future use
          tunnel: element.tags?.tunnel === "yes",
          bridge: element.tags?.bridge === "yes",
          embedded: element.tags?.embedded === "yes",
          railwayRun: element.tags?.["railway:run"] || null,
          trafficMode: element.tags?.["railway:traffic_mode"] || null,
          segregated: element.tags?.segregated || null,
          cutting: element.tags?.cutting === "yes",
          embankment: element.tags?.embankment === "yes",
          layer: element.tags?.layer ? parseInt(element.tags.layer, 10) : null,
        },
        geometry: {
          type: "LineString",
          coordinates: element.geometry.map((p) => [p.lon, p.lat]),
        },
      };
    });

    const geojson = {
      type: "FeatureCollection",
      generated: new Date().toISOString(),
      source: "OpenStreetMap via Overpass API",
      features,
    };

    // Save to file
    const outputPath = path.join(DATA_DIR, config.outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

    // Show distribution by separation type
    const counts = {
      tunnel: 0,
      elevated: 0,
      street_running: 0,
      reserved_lane: 0,
      separated_at_grade: 0,
      unknown: 0,
    };
    features.forEach((f) => {
      counts[f.properties.separationType]++;
    });
    
    console.log(`   Distribution:`);
    console.log(`     🔵 Tunnel / Trench: ${counts.tunnel}`);
    console.log(`     🟢 Elevated: ${counts.elevated}`);
    console.log(`     🔴 Street Running: ${counts.street_running}`);
    console.log(`     🟠 Reserved Lane: ${counts.reserved_lane}`);
    console.log(`     🟡 Separated At-Grade: ${counts.separated_at_grade}`);
    console.log(`     ⬜ Unknown: ${counts.unknown}`);
    console.log(
      `   ✅ Saved ${features.length} segments to ${config.outputFile}`
    );
  } catch (error) {
    console.error(`   ❌ Error fetching ${config.name}: ${error.message}`);
  }
}

// Main execution
async function main() {
  console.log("🚇 Fetching Railway Separation Data from OpenStreetMap");
  console.log("========================================================\n");

  for (const [cityKey, config] of Object.entries(CITIES)) {
    await fetchSeparationData(cityKey, config);
    // Be nice to Overpass API - 8 second delay between requests
    await delay(8000);
  }

  console.log("\n✅ Done!");
}

main();
