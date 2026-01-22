#!/usr/bin/env node
/**
 * Fetch Railway Infrastructure from OpenStreetMap via Overpass API
 *
 * Downloads railway switches and signals for all cities,
 * filters them to only include infrastructure near our transit lines,
 * and saves them as GeoJSON files for use in the map.
 *
 * Run with: node scripts/fetchInfrastructure.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include infrastructure within this distance of a route
const PROXIMITY_METERS = 10;

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

// Check if a point is near any route
function isNearRoutes(lat, lon, routeCoords) {
  for (const coords of routeCoords) {
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];
      const distance = distanceToSegment(lat, lon, lat1, lon1, lat2, lon2);
      if (distance <= PROXIMITY_METERS) {
        return true;
      }
    }
  }
  return false;
}

// City configurations
const CITIES = {
  SF: {
    name: "San Francisco",
    bbox: [37.65, -122.55, 37.85, -122.35],
    routesFile: "muniMetroRoutes.json",
    switchesFile: "sfSwitches.json",
    signalsFile: "sfSignals.json",
  },
  LA: {
    name: "Los Angeles",
    bbox: [33.6, -118.7, 34.35, -117.7],
    routesFile: "laMetroRoutes.json",
    switchesFile: "laSwitches.json",
    signalsFile: "laSignals.json",
  },
  Seattle: {
    name: "Seattle",
    bbox: [47.15, -122.5, 47.8, -122.0],
    routesFile: "seattleLinkRoutes.json",
    switchesFile: "seattleSwitches.json",
    signalsFile: "seattleSignals.json",
  },
  Boston: {
    name: "Boston",
    bbox: [42.22, -71.25, 42.45, -70.95],
    routesFile: "bostonGreenLineRoutes.json",
    switchesFile: "bostonSwitches.json",
    signalsFile: "bostonSignals.json",
  },
  Portland: {
    name: "Portland",
    bbox: [45.3, -123.0, 45.65, -122.4],
    routesFile: "portlandMaxRoutes.json",
    switchesFile: "portlandSwitches.json",
    signalsFile: "portlandSignals.json",
  },
  SanDiego: {
    name: "San Diego",
    bbox: [32.5, -117.3, 33.0, -116.8],
    routesFile: "sanDiegoTrolleyRoutes.json",
    switchesFile: "sanDiegoSwitches.json",
    signalsFile: "sanDiegoSignals.json",
  },
  Toronto: {
    name: "Toronto",
    bbox: [43.58, -79.55, 43.75, -79.25],
    routesFile: "torontoStreetcarRoutes.json",
    switchesFile: "torontoSwitches.json",
    signalsFile: "torontoSignals.json",
  },
  Philadelphia: {
    name: "Philadelphia",
    bbox: [39.85, -75.35, 40.15, -74.9],
    routesFile: "phillyTrolleyRoutes.json",
    switchesFile: "phillySwitches.json",
    signalsFile: "phillySignals.json",
  },
  Sacramento: {
    name: "Sacramento",
    bbox: [38.45, -121.55, 38.7, -121.2],
    routesFile: "sacramentoLightRailRoutes.json",
    switchesFile: "sacramentoSwitches.json",
    signalsFile: "sacramentoSignals.json",
  },
  Pittsburgh: {
    name: "Pittsburgh",
    bbox: [40.3, -80.15, 40.55, -79.85],
    routesFile: "pittsburghTRoutes.json",
    switchesFile: "pittsburghSwitches.json",
    signalsFile: "pittsburghSignals.json",
  },
  Dallas: {
    name: "Dallas",
    bbox: [32.6, -97.1, 33.05, -96.55],
    routesFile: "dallasDartRoutes.json",
    switchesFile: "dallasSwitches.json",
    signalsFile: "dallasSignals.json",
  },
  Minneapolis: {
    name: "Minneapolis",
    bbox: [44.85, -93.45, 45.1, -93.1],
    routesFile: "minneapolisMetroRoutes.json",
    switchesFile: "minneapolisSwitches.json",
    signalsFile: "minneapolisSignals.json",
  },
  Denver: {
    name: "Denver",
    bbox: [39.55, -105.15, 39.95, -104.75],
    routesFile: "denverRtdRoutes.json",
    switchesFile: "denverSwitches.json",
    signalsFile: "denverSignals.json",
  },
  SaltLakeCity: {
    name: "Salt Lake City",
    bbox: [40.55, -112.1, 40.9, -111.7],
    routesFile: "slcTraxRoutes.json",
    switchesFile: "slcSwitches.json",
    signalsFile: "slcSignals.json",
  },
  SanJose: {
    name: "San Jose",
    bbox: [37.15, -122.1, 37.45, -121.75],
    routesFile: "vtaLightRailRoutes.json",
    switchesFile: "sanJoseSwitches.json",
    signalsFile: "sanJoseSignals.json",
  },
  Baltimore: {
    name: "Baltimore",
    bbox: [39.15, -76.69, 39.52, -76.60],
    routesFile: "baltimoreLightRailRoutes.json",
    switchesFile: "baltimoreSwitches.json",
    signalsFile: "baltimoreSignals.json",
  },
  Cleveland: {
    name: "Cleveland",
    bbox: [41.39, -81.86, 41.55, -81.50],
    routesFile: "clevelandRtaRoutes.json",
    switchesFile: "clevelandSwitches.json",
    signalsFile: "clevelandSignals.json",
  },
};

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Fetch infrastructure of a specific type
async function fetchInfrastructure(type, bbox, routeCoords) {
  const [south, west, north, east] = bbox;

  // Overpass QL query for railway infrastructure
  const query = `
[out:json][timeout:60];
(
  node["railway"="${type}"](${south},${west},${north},${east});
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
      `   Found ${data.elements.length} total ${type}s in bounding box`,
    );

    // Filter to only those near our transit lines
    const nearbyElements = data.elements.filter((element) => {
      return isNearRoutes(element.lat, element.lon, routeCoords);
    });

    console.log(
      `   Filtered to ${nearbyElements.length} ${type}s near transit lines`,
    );

    // Convert to GeoJSON
    const features = nearbyElements.map((element) => ({
      type: "Feature",
      properties: {
        id: element.id,
        type: type,
        ...element.tags,
      },
      geometry: {
        type: "Point",
        coordinates: [element.lon, element.lat],
      },
    }));

    return {
      type: "FeatureCollection",
      features,
    };
  } catch (error) {
    console.error(`   Error fetching ${type}s:`, error.message);
    return { type: "FeatureCollection", features: [] };
  }
}

// Process a city
async function processCity(cityKey) {
  const city = CITIES[cityKey];
  console.log(`\n📍 Processing ${city.name}...`);

  // Load route data
  const routesPath = path.join(__dirname, "../src/data", city.routesFile);
  if (!fs.existsSync(routesPath)) {
    console.log(`   ⚠️ Routes file not found: ${city.routesFile}, skipping...`);
    return;
  }

  const routesData = JSON.parse(fs.readFileSync(routesPath, "utf-8"));

  // Extract coordinates from routes
  const routeCoords = [];
  for (const feature of routesData.features) {
    if (feature.geometry.type === "LineString") {
      routeCoords.push(feature.geometry.coordinates);
    } else if (feature.geometry.type === "MultiLineString") {
      routeCoords.push(...feature.geometry.coordinates);
    }
  }
  console.log(`   Loaded ${routeCoords.length} route segments`);

  // Fetch switches
  console.log("   Fetching switches...");
  const switches = await fetchInfrastructure("switch", city.bbox, routeCoords);
  const switchesPath = path.join(__dirname, "../src/data", city.switchesFile);
  fs.writeFileSync(switchesPath, JSON.stringify(switches, null, 2));
  console.log(
    `   ✅ Saved ${switches.features.length} switches to ${city.switchesFile}`,
  );

  // Add delay to avoid rate limiting
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Fetch signals
  console.log("   Fetching signals...");
  const signals = await fetchInfrastructure("signal", city.bbox, routeCoords);
  const signalsPath = path.join(__dirname, "../src/data", city.signalsFile);
  fs.writeFileSync(signalsPath, JSON.stringify(signals, null, 2));
  console.log(
    `   ✅ Saved ${signals.features.length} signals to ${city.signalsFile}`,
  );
}

// Main
async function main() {
  console.log("🚂 Railway Infrastructure Fetcher");
  console.log("================================");
  console.log("Fetching switches and signals from OpenStreetMap...\n");

  for (const cityKey of Object.keys(CITIES)) {
    await processCity(cityKey);
    // Add delay between cities to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log("\n✅ Done! Infrastructure data saved to src/data/");
}

main().catch(console.error);
