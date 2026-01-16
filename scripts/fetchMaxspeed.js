#!/usr/bin/env node
/**
 * Fetch Railway Speed Limits from OpenStreetMap via Overpass API
 *
 * Downloads maxspeed data for rail lines in all cities,
 * filters them to only include track near our transit lines,
 * and saves them as GeoJSON files for use in the map.
 *
 * Run with: node scripts/fetchMaxspeed.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include track within this distance of our routes
// 75m accounts for minor geometry differences between GTFS routes and OSM rail centerlines
const PROXIMITY_METERS = 75;

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
  // Check if any point of the way is near our routes
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
          lon2,
        );
        if (distance <= PROXIMITY_METERS) {
          return true;
        }
      }
    }
  }
  return false;
}

// Parse maxspeed string to numeric mph value
function parseMaxspeed(maxspeedStr) {
  if (!maxspeedStr) return null;

  // Handle "XX mph" format
  const mphMatch = maxspeedStr.match(/^(\d+(?:\.\d+)?)\s*mph$/i);
  if (mphMatch) {
    return parseFloat(mphMatch[1]);
  }

  // Handle "XX km/h" or "XX" (assumed km/h) format
  const kmhMatch = maxspeedStr.match(/^(\d+(?:\.\d+)?)\s*(?:km\/h)?$/i);
  if (kmhMatch) {
    // Convert km/h to mph
    return parseFloat(kmhMatch[1]) * 0.621371;
  }

  return null;
}

// Data directory for routes and output
const DATA_DIR = path.join(__dirname, "..", "src", "data");

// City configurations
const CITIES = {
  SF: {
    name: "San Francisco",
    bbox: [37.65, -122.55, 37.85, -122.35],
    routesFile: "muniMetroRoutes.json",
    outputFile: "sfMaxspeed.json",
    railwayTypes: "light_rail|tram",
    networkFilter: "Muni", // Only include Muni, not BART
  },
  LA: {
    name: "Los Angeles",
    bbox: [33.76, -118.50, 34.18, -117.74], // Extended to cover full A line to Glendora/San Dimas
    routesFile: "laMetroRoutes.json",
    outputFile: "laMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null, // LACMTA filter too restrictive
  },
  Seattle: {
    name: "Seattle",
    bbox: [47.23, -122.46, 47.82, -122.10], // Extended to cover full 1 Line (Federal Way to Lynnwood)
    routesFile: "seattleLinkRoutes.json",
    outputFile: "seattleMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Boston: {
    name: "Boston",
    bbox: [42.25, -71.2, 42.4, -71.0], // Tighter bbox
    routesFile: "bostonGreenLineRoutes.json",
    outputFile: "bostonMaxspeed.json",
    railwayTypes: "light_rail|tram",
    networkFilter: null,
  },
  Portland: {
    name: "Portland",
    bbox: [45.4, -122.85, 45.6, -122.5], // Tighter bbox
    routesFile: "portlandMaxRoutes.json",
    outputFile: "portlandMaxspeed.json",
    railwayTypes: "light_rail|tram",
    networkFilter: null,
  },
  "San Diego": {
    name: "San Diego",
    bbox: [32.65, -117.2, 32.95, -116.95], // Tighter bbox
    routesFile: "sanDiegoTrolleyRoutes.json",
    outputFile: "sanDiegoMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Toronto: {
    name: "Toronto",
    bbox: [43.62, -79.5, 43.72, -79.3], // Tighter bbox downtown
    routesFile: "torontoStreetcarRoutes.json",
    outputFile: "torontoMaxspeed.json",
    railwayTypes: "tram",
    networkFilter: null,
  },
  Philadelphia: {
    name: "Philadelphia",
    bbox: [39.9, -75.25, 40.05, -75.05], // Tighter bbox
    routesFile: "phillyTrolleyRoutes.json",
    outputFile: "phillyMaxspeed.json",
    railwayTypes: "light_rail|tram",
    networkFilter: null,
  },
  Sacramento: {
    name: "Sacramento",
    bbox: [38.5, -121.5, 38.65, -121.35], // Tighter bbox
    routesFile: "sacramentoLightRailRoutes.json",
    outputFile: "sacramentoMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Pittsburgh: {
    name: "Pittsburgh",
    bbox: [40.3, -80.1, 40.5, -79.9],
    routesFile: "pittsburghTRoutes.json",
    outputFile: "pittsburghMaxspeed.json",
    railwayTypes: "light_rail|tram",
    networkFilter: null,
  },
  Dallas: {
    name: "Dallas",
    bbox: [32.65, -97.0, 33.0, -96.6],
    routesFile: "dallasDartRoutes.json",
    outputFile: "dallasMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Minneapolis: {
    name: "Minneapolis",
    bbox: [44.88, -93.4, 45.05, -93.15],
    routesFile: "minneapolisMetroRoutes.json",
    outputFile: "minneapolisMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Denver: {
    name: "Denver",
    bbox: [39.6, -105.1, 39.9, -104.8],
    routesFile: "denverRtdRoutes.json",
    outputFile: "denverMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  "Salt Lake City": {
    name: "Salt Lake City",
    bbox: [40.6, -112.0, 40.85, -111.75],
    routesFile: "slcTraxRoutes.json",
    outputFile: "slcMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  "San Jose": {
    name: "San Jose",
    bbox: [37.23, -122.08, 37.42, -121.78], // VTA Light Rail extent
    routesFile: "vtaLightRailRoutes.json",
    outputFile: "vtaMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Phoenix: {
    name: "Phoenix",
    bbox: [33.35, -112.35, 33.55, -111.75], // Valley Metro Rail extent
    routesFile: "phoenixLightRailRoutes.json",
    outputFile: "phoenixMaxspeed.json",
    railwayTypes: "light_rail",
    networkFilter: null,
  },
  Charlotte: {
    name: "Charlotte",
    bbox: [35.09, -80.95, 35.35, -80.70], // LYNX Blue Line + Gold Line extent
    routesFile: "charlotteLightRailRoutes.json",
    outputFile: "charlotteMaxspeed.json",
    railwayTypes: "light_rail|tram",
    networkFilter: null,
  },
};

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Add delay between requests to be nice to Overpass
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch maxspeed data for a city
async function fetchMaxspeed(cityKey, config) {
  const [south, west, north, east] = config.bbox;

  // Overpass QL query for railway ways with maxspeed and geometry
  const query = `
[out:json][timeout:90];
(
  way["railway"~"${config.railwayTypes}"]["maxspeed"](${south},${west},${north},${east});
);
out body geom;
`;

  console.log(`\n📍 Fetching maxspeed data for ${config.name}...`);

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
      `   Found ${data.elements.length} ways with maxspeed in bounding box`,
    );

    // Load route data to filter by proximity
    const routesPath = path.join(DATA_DIR, config.routesFile);
    if (!fs.existsSync(routesPath)) {
      console.log(
        `   ⚠️ Routes file not found: ${config.routesFile}, skipping city`,
      );
      return;
    }

    const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
    const routeCoords = routes.features.map((f) => f.geometry.coordinates);

    // Filter ways
    let filteredElements = data.elements;

    // Apply network filter if specified
    if (config.networkFilter) {
      filteredElements = filteredElements.filter(
        (el) => el.tags?.network === config.networkFilter,
      );
      console.log(
        `   After network filter (${config.networkFilter}): ${filteredElements.length} ways`,
      );
    }

    // Filter by proximity to our routes
    filteredElements = filteredElements.filter((el) => {
      if (!el.geometry) return false;
      return isWayNearRoutes(el.geometry, routeCoords);
    });

    console.log(
      `   After proximity filter: ${filteredElements.length} ways near transit lines`,
    );

    if (filteredElements.length === 0) {
      console.log(
        `   ⚠️ No maxspeed data found near transit lines for ${config.name}`,
      );
      return;
    }

    // Convert to GeoJSON
    const features = filteredElements.map((element) => {
      const speedMph = parseMaxspeed(element.tags?.maxspeed);

      return {
        type: "Feature",
        properties: {
          id: element.id,
          maxspeed: element.tags?.maxspeed,
          maxspeed_mph: speedMph,
          name: element.tags?.name || null,
          network: element.tags?.network || null,
          tunnel: element.tags?.tunnel === "yes",
          bridge: element.tags?.bridge === "yes",
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

    // Show speed distribution
    const speeds = {};
    features.forEach((f) => {
      const speed = f.properties.maxspeed || "unknown";
      speeds[speed] = (speeds[speed] || 0) + 1;
    });
    console.log(`   Speed distribution:`, speeds);
    console.log(
      `   ✅ Saved ${features.length} segments to ${config.outputFile}`,
    );
  } catch (error) {
    console.error(`   ❌ Error fetching ${config.name}: ${error.message}`);
  }
}

// Main execution
async function main() {
  console.log("🚄 Fetching Railway Speed Limits from OpenStreetMap");
  console.log("================================================\n");

  for (const [cityKey, config] of Object.entries(CITIES)) {
    await fetchMaxspeed(cityKey, config);
    // Be nice to Overpass API
    await delay(5000);
  }

  console.log("\n✅ Done!");
}

main();
