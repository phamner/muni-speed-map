#!/usr/bin/env node
/**
 * Fetch and Consolidate Traffic Lights for All Cities
 *
 * Downloads traffic signals (highway=traffic_signals) from OpenStreetMap,
 * filters them to only include signals near transit lines,
 * clusters nearby signals, snaps them to grade crossings,
 * and saves them as GeoJSON files for use in the map.
 *
 * Run with: node scripts/fetchAllTrafficLights.js
 * Or for a specific city: node scripts/fetchAllTrafficLights.js SanDiego
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include traffic lights within this distance of a route
const PROXIMITY_METERS = 35;

// Clustering and snapping thresholds
const CLUSTER_DISTANCE_METERS = 30;
const SNAP_DISTANCE_METERS = 50;

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

// Calculate minimum distance from a point to a polyline
function distanceToLineString(lat, lon, coordinates) {
  let minDistance = Infinity;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];
    const distance = distanceToSegment(lat, lon, lat1, lon1, lat2, lon2);
    minDistance = Math.min(minDistance, distance);

    if (minDistance < PROXIMITY_METERS) break;
  }

  return minDistance;
}

// City configurations - matching fetchCrossings.js
const CITIES = {
  LA: {
    name: "Los Angeles",
    bbox: [33.6, -118.7, 34.35, -117.7],
    routesFile: "laMetroRoutes.json",
    crossingsFile: "laGradeCrossings.json",
    outputFile: "laTrafficLightsConsolidated.json",
  },
  Seattle: {
    name: "Seattle",
    bbox: [47.15, -122.5, 47.8, -122.0],
    routesFile: "seattleLinkRoutes.json",
    crossingsFile: "seattleGradeCrossings.json",
    outputFile: "seattleTrafficLightsConsolidated.json",
    includeUnsnappedForRoutes: ["TLINE"], // T Line streetcar runs in streets; 1/2 Line keep grade-crossing-only
  },
  Boston: {
    name: "Boston",
    bbox: [42.22, -71.25, 42.45, -70.95],
    routesFile: "bostonGreenLineRoutes.json",
    crossingsFile: "bostonGradeCrossings.json",
    outputFile: "bostonTrafficLightsConsolidated.json",
  },
  Portland: {
    name: "Portland",
    bbox: [45.3, -123.0, 45.65, -122.4],
    routesFile: "portlandMaxRoutes.json",
    crossingsFile: "portlandGradeCrossings.json",
    outputFile: "portlandTrafficLightsConsolidated.json",
    includeUnsnapped: true, // Portland is missing grade crossings downtown
  },
  SanDiego: {
    name: "San Diego",
    bbox: [32.5, -117.3, 33.0, -116.8],
    routesFile: "sanDiegoTrolleyRoutes.json",
    crossingsFile: "sanDiegoGradeCrossings.json",
    outputFile: "sanDiegoTrafficLightsConsolidated.json",
  },
  Toronto: {
    name: "Toronto",
    bbox: [43.58, -79.55, 43.75, -79.25],
    routesFile: "torontoStreetcarRoutes.json",
    crossingsFile: "torontoGradeCrossings.json",
    outputFile: "torontoTrafficLightsConsolidated.json",
    includeUnsnapped: true, // Streetcars run on streets, no traditional crossings
  },
  Philadelphia: {
    name: "Philadelphia",
    bbox: [39.85, -75.35, 40.05, -75.05],
    routesFile: "phillyTrolleyRoutes.json",
    crossingsFile: "phillyGradeCrossings.json",
    outputFile: "phillyTrafficLightsConsolidated.json",
    includeUnsnapped: true, // Trolleys run on streets, no traditional crossings
  },
  Pittsburgh: {
    name: "Pittsburgh",
    bbox: [40.3, -80.15, 40.55, -79.85],
    routesFile: "pittsburghTRoutes.json",
    crossingsFile: "pittsburghGradeCrossings.json",
    outputFile: "pittsburghTrafficLightsConsolidated.json",
  },
  Dallas: {
    name: "Dallas",
    bbox: [32.6, -97.1, 33.05, -96.55],
    routesFile: "dallasDartRoutes.json",
    crossingsFile: "dallasGradeCrossings.json",
    outputFile: "dallasTrafficLightsConsolidated.json",
  },
  Minneapolis: {
    name: "Minneapolis",
    bbox: [44.85, -93.45, 45.1, -93.1],
    routesFile: "minneapolisMetroRoutes.json",
    crossingsFile: "minneapolisGradeCrossings.json",
    outputFile: "minneapolisTrafficLightsConsolidated.json",
  },
  Denver: {
    name: "Denver",
    bbox: [39.55, -105.15, 39.95, -104.75],
    routesFile: "denverRtdRoutes.json",
    crossingsFile: "denverGradeCrossings.json",
    outputFile: "denverTrafficLightsConsolidated.json",
  },
  SaltLakeCity: {
    name: "Salt Lake City",
    bbox: [40.55, -112.1, 40.9, -111.7],
    routesFile: "slcTraxRoutes.json",
    crossingsFile: "slcGradeCrossings.json",
    outputFile: "slcTrafficLightsConsolidated.json",
  },
  SanJose: {
    name: "San Jose",
    bbox: [37.15, -122.1, 37.45, -121.75],
    routesFile: "vtaLightRailRoutes.json",
    crossingsFile: "sanJoseGradeCrossings.json",
    outputFile: "sanJoseTrafficLightsConsolidated.json",
  },
  Baltimore: {
    name: "Baltimore",
    bbox: [39.15, -76.69, 39.52, -76.60],
    routesFile: "baltimoreLightRailRoutes.json",
    crossingsFile: "baltimoreGradeCrossings.json",
    outputFile: "baltimoreTrafficLightsConsolidated.json",
  },
  Phoenix: {
    name: "Phoenix",
    bbox: [33.3, -112.2, 33.6, -111.8],
    routesFile: "phoenixLightRailRoutes.json",
    crossingsFile: "phoenixGradeCrossings.json",
    outputFile: "phoenixTrafficLightsConsolidated.json",
  },
  Charlotte: {
    name: "Charlotte",
    bbox: [35.1, -81.0, 35.4, -80.7],
    routesFile: "charlotteLightRailRoutes.json",
    crossingsFile: "charlotteGradeCrossings.json",
    outputFile: "charlotteTrafficLightsConsolidated.json",
    includeUnsnapped: true, // Gold Line streetcar runs in mixed traffic, few OSM grade crossings
  },
  Cleveland: {
    name: "Cleveland",
    bbox: [41.39, -81.86, 41.55, -81.50],
    routesFile: "clevelandRtaRoutes.json",
    crossingsFile: "clevelandGradeCrossings.json",
    outputFile: "clevelandTrafficLightsConsolidated.json",
  },
  Sacramento: {
    name: "Sacramento",
    bbox: [38.45, -121.55, 38.7, -121.2],
    routesFile: "sacramentoLightRailRoutes.json",
    crossingsFile: "sacramentoGradeCrossings.json",
    outputFile: "sacramentoTrafficLightsConsolidated.json",
  },
  Calgary: {
    name: "Calgary",
    bbox: [50.9, -114.25, 51.15, -113.9],
    routesFile: "calgaryLightRailRoutes.json",
    crossingsFile: "calgaryGradeCrossings.json",
    outputFile: "calgaryTrafficLightsConsolidated.json",
  },
};

// Multiple Overpass API endpoints for fallback
const OVERPASS_APIS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function fetchWithRetry(query) {
  for (const api of OVERPASS_APIS) {
    try {
      console.log(`   Trying ${api}...`);
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (response.ok) {
        return await response.json();
      }
      console.log(`   ❌ ${api} returned ${response.status}`);
    } catch (error) {
      console.log(`   ❌ ${api} failed: ${error.message}`);
    }
  }
  throw new Error("All Overpass API endpoints failed");
}

async function fetchTrafficLightsForCity(cityKey, city) {
  const { name, bbox, routesFile, crossingsFile, outputFile, includeUnsnapped, includeUnsnappedForRoutes } = city;
  const [south, west, north, east] = bbox;

  console.log(`\n🚦 Processing ${name}...`);
  console.log(`   Bounding box: ${south}, ${west}, ${north}, ${east}`);

  // Load routes
  const routesPath = path.join(__dirname, "..", "src", "data", routesFile);
  let routes;
  try {
    routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));
    console.log(`   Loaded ${routes.features.length} route segments`);
  } catch (error) {
    console.error(`   ❌ Could not load routes: ${error.message}`);
    return { city: name, count: 0, error: "routes not found" };
  }

  // Load crossings
  const crossingsPath = path.join(__dirname, "..", "src", "data", crossingsFile);
  let crossings;
  try {
    crossings = JSON.parse(fs.readFileSync(crossingsPath, "utf8"));
    console.log(`   Loaded ${crossings.features.length} grade crossings`);
  } catch (error) {
    console.error(`   ❌ Could not load crossings: ${error.message}`);
    return { city: name, count: 0, error: "crossings not found" };
  }

  // Build route geometry map
  const routeCoordsByRouteId = new Map();
  routes.features.forEach((feature) => {
    const routeId = feature.properties.route_id || feature.properties.route_letter || feature.properties.line;
    if (!routeId) return;
    
    if (!routeCoordsByRouteId.has(routeId)) {
      routeCoordsByRouteId.set(routeId, []);
    }

    if (feature.geometry.type === "MultiLineString") {
      for (const lineCoords of feature.geometry.coordinates) {
        routeCoordsByRouteId.get(routeId).push(lineCoords);
      }
    } else if (feature.geometry.type === "LineString") {
      routeCoordsByRouteId.get(routeId).push(feature.geometry.coordinates);
    }
  });
  console.log(`   Found ${routeCoordsByRouteId.size} unique routes`);

  // Fetch traffic lights from Overpass API
  const query = `
[out:json][timeout:180];
(
  node["highway"="traffic_signals"](${south},${west},${north},${east});
);
out body;
`;

  let data;
  try {
    data = await fetchWithRetry(query);
    console.log(`   Found ${data.elements.length} total traffic lights in bounding box`);
  } catch (error) {
    console.error(`   ❌ Overpass API error: ${error.message}`);
    return { city: name, count: 0, error: "API failed" };
  }

  // Filter to traffic lights near transit lines
  const filteredFeatures = [];

  for (const node of data.elements) {
    const lat = node.lat;
    const lon = node.lon;
    const nearRoutes = [];

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

    if (nearRoutes.length > 0) {
      filteredFeatures.push({
        type: "Feature",
        properties: {
          id: String(node.id),
          type: "traffic_signal",
          routes: nearRoutes,
        },
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
      });
    }
  }

  console.log(`   ✂️  Filtered to ${filteredFeatures.length} traffic lights near transit`);

  if (filteredFeatures.length === 0) {
    console.log(`   ⚠️  No traffic lights found near transit lines`);
    return { city: name, count: 0 };
  }

  // Cluster traffic lights
  const clusters = [];
  const processed = new Set();

  filteredFeatures.forEach((light, index) => {
    if (processed.has(index)) return;

    const cluster = [light];
    processed.add(index);

    const [lightLon, lightLat] = light.geometry.coordinates;

    filteredFeatures.forEach((otherLight, otherIndex) => {
      if (processed.has(otherIndex)) return;

      const [otherLon, otherLat] = otherLight.geometry.coordinates;
      const distance = haversineDistance(lightLat, lightLon, otherLat, otherLon);

      if (distance <= CLUSTER_DISTANCE_METERS) {
        cluster.push(otherLight);
        processed.add(otherIndex);
      }
    });

    clusters.push(cluster);
  });

  console.log(`   📦 Clustered into ${clusters.length} groups`);

  // Consolidate clusters and snap to crossings
  const consolidatedLights = [];

  clusters.forEach((cluster, clusterIndex) => {
    let sumLat = 0, sumLon = 0;
    const allRoutes = new Set();

    cluster.forEach((light) => {
      const [lon, lat] = light.geometry.coordinates;
      sumLon += lon;
      sumLat += lat;
      (light.properties.routes || []).forEach((route) => allRoutes.add(route));
    });

    const centroidLon = sumLon / cluster.length;
    const centroidLat = sumLat / cluster.length;

    // Find nearest crossing
    let nearestCrossing = null;
    let minDistance = Infinity;

    crossings.features.forEach((crossing) => {
      const crossingCoords = crossing.geometry?.coordinates;
      if (!crossingCoords) return;

      const [crossingLon, crossingLat] = crossingCoords;
      const distance = haversineDistance(centroidLat, centroidLon, crossingLat, crossingLon);

      if (distance < minDistance) {
        minDistance = distance;
        nearestCrossing = crossing;
      }
    });

    // Snap to crossing if within threshold
    let finalCoords = [centroidLon, centroidLat];
    const snapped = nearestCrossing && minDistance <= SNAP_DISTANCE_METERS;
    if (snapped) {
      finalCoords = nearestCrossing.geometry.coordinates;
    }

    consolidatedLights.push({
      type: "Feature",
      properties: {
        id: `cluster-${clusterIndex}`,
        type: "traffic_signal",
        count: cluster.length,
        routes: Array.from(allRoutes),
        snapped,
        crossing_id: nearestCrossing?.properties?.id,
      },
      geometry: {
        type: "Point",
        coordinates: finalCoords,
      },
    });
  });

  // Deduplicate by coordinates
  const coordsMap = new Map();
  consolidatedLights.forEach((light) => {
    const [lon, lat] = light.geometry.coordinates;
    const key = `${lon.toFixed(7)},${lat.toFixed(7)}`;

    if (coordsMap.has(key)) {
      const existing = coordsMap.get(key);
      existing.properties.count += light.properties.count;
      const allRoutes = new Set([...existing.properties.routes, ...light.properties.routes]);
      existing.properties.routes = Array.from(allRoutes);
    } else {
      coordsMap.set(key, light);
    }
  });

  const deduplicatedLights = Array.from(coordsMap.values());
  deduplicatedLights.forEach((light, index) => {
    light.properties.id = `cluster-${index}`;
  });

  // Filter to only snapped traffic lights (those near grade crossings)
  // Unless includeUnsnapped (all) or includeUnsnappedForRoutes (specific routes only, e.g. T Line streetcar)
  const snappedLights = deduplicatedLights.filter((l) => l.properties.snapped);
  const unsnappedLights = deduplicatedLights.filter((l) => !l.properties.snapped);

  let additionalUnsnapped = [];
  if (includeUnsnapped) {
    additionalUnsnapped = unsnappedLights;
  } else if (includeUnsnappedForRoutes?.length) {
    additionalUnsnapped = unsnappedLights.filter((l) =>
      (l.properties.routes || []).some((r) => includeUnsnappedForRoutes.includes(r))
    );
  }
  const finalLights = [...snappedLights, ...additionalUnsnapped];

  console.log(`   🔗 ${snappedLights.length}/${deduplicatedLights.length} snapped to crossings`);
  if (includeUnsnapped) {
    console.log(`   📍 Including all ${deduplicatedLights.length} traffic lights (includeUnsnapped=true)`);
  } else if (additionalUnsnapped.length) {
    console.log(`   📍 Including ${additionalUnsnapped.length} unsnapped for routes: ${includeUnsnappedForRoutes.join(", ")}`);
  }

  // Save output
  const output = {
    type: "FeatureCollection",
    features: finalLights,
  };

  const outputPath = path.join(__dirname, "..", "src", "data", outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`   ✅ Saved ${finalLights.length} traffic lights to ${outputFile}`);

  return { city: name, count: finalLights.length };
}

async function main() {
  console.log("🚦 Traffic Light Fetcher (All Cities)");
  console.log("=====================================");
  console.log(`Proximity threshold: ${PROXIMITY_METERS}m`);
  console.log(`Cluster distance: ${CLUSTER_DISTANCE_METERS}m`);
  console.log(`Snap distance: ${SNAP_DISTANCE_METERS}m`);

  // Check for specific city argument
  const targetCity = process.argv[2];
  
  const results = [];
  
  if (targetCity) {
    if (!CITIES[targetCity]) {
      console.error(`\n❌ Unknown city: ${targetCity}`);
      console.log(`Available cities: ${Object.keys(CITIES).join(", ")}`);
      process.exit(1);
    }
    const result = await fetchTrafficLightsForCity(targetCity, CITIES[targetCity]);
    results.push(result);
  } else {
    // Process all cities
    for (const [cityKey, city] of Object.entries(CITIES)) {
      const result = await fetchTrafficLightsForCity(cityKey, city);
      results.push(result);
      
      // Small delay between cities to be nice to Overpass API
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log("\n=====================================");
  console.log("📊 Summary:");
  let totalCount = 0;
  for (const result of results) {
    if (result.error) {
      console.log(`   ${result.city}: ❌ ${result.error}`);
    } else {
      console.log(`   ${result.city}: ${result.count} traffic lights`);
      totalCount += result.count;
    }
  }
  console.log(`\n✨ Total: ${totalCount} traffic lights across ${results.length} cities`);
}

main().catch(console.error);
