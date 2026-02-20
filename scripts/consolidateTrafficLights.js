#!/usr/bin/env node

/**
 * Consolidate traffic lights by clustering and snapping to grade crossings
 * This pre-processes the traffic lights data so runtime filtering is instant
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function consolidateTrafficLights(
  trafficLightsPath,
  crossingsPath,
  outputPath,
) {
  console.log(`Reading traffic lights from ${trafficLightsPath}...`);
  const trafficLights = JSON.parse(fs.readFileSync(trafficLightsPath, "utf-8"));

  console.log(`Reading grade crossings from ${crossingsPath}...`);
  const crossings = JSON.parse(fs.readFileSync(crossingsPath, "utf-8"));

  const CLUSTER_DISTANCE_METERS = 30; // Traffic lights within 30m are part of same cluster
  const SNAP_DISTANCE_METERS = 50; // Snap cluster centroid to crossing within 50m

  console.log(`Total traffic lights: ${trafficLights.features.length}`);
  console.log(`Total crossings: ${crossings.features.length}`);

  // Cluster traffic lights that are close together
  const clusters = [];
  const processed = new Set();

  trafficLights.features.forEach((light, index) => {
    if (processed.has(index)) return;

    const cluster = [light];
    processed.add(index);

    const lightCoords = light.geometry?.coordinates;
    if (!lightCoords) return;

    const [lightLon, lightLat] = lightCoords;

    // Find all other lights within cluster distance
    trafficLights.features.forEach((otherLight, otherIndex) => {
      if (processed.has(otherIndex)) return;

      const otherCoords = otherLight.geometry?.coordinates;
      if (!otherCoords) return;

      const [otherLon, otherLat] = otherCoords;
      const distance = haversineDistance(
        lightLat,
        lightLon,
        otherLat,
        otherLon,
      );

      if (distance <= CLUSTER_DISTANCE_METERS) {
        cluster.push(otherLight);
        processed.add(otherIndex);
      }
    });

    clusters.push(cluster);
  });

  console.log(`Found ${clusters.length} traffic light clusters`);

  // For each cluster, calculate centroid and snap to nearest crossing
  const consolidatedLights = [];

  clusters.forEach((cluster, clusterIndex) => {
    // Calculate centroid of cluster
    let sumLat = 0;
    let sumLon = 0;
    const allRoutes = new Set();

    cluster.forEach((light) => {
      const coords = light.geometry?.coordinates;
      if (coords) {
        sumLon += coords[0];
        sumLat += coords[1];
      }
      // Collect all routes from all lights in cluster
      const routes = light.properties?.routes || [];
      routes.forEach((route) => allRoutes.add(route));
    });

    const centroidLon = sumLon / cluster.length;
    const centroidLat = sumLat / cluster.length;

    // Find nearest grade crossing to this centroid
    let nearestCrossing = null;
    let minDistance = Infinity;

    crossings.features.forEach((crossing) => {
      const crossingCoords = crossing.geometry?.coordinates;
      if (!crossingCoords) return;

      const [crossingLon, crossingLat] = crossingCoords;
      const distance = haversineDistance(
        centroidLat,
        centroidLon,
        crossingLat,
        crossingLon,
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestCrossing = crossing;
      }
    });

    // If there's a crossing within snap distance, use its coordinates
    // Otherwise use the centroid
    let finalCoords = [centroidLon, centroidLat];
    if (nearestCrossing && minDistance <= SNAP_DISTANCE_METERS) {
      finalCoords = nearestCrossing.geometry.coordinates;
    }

    consolidatedLights.push({
      type: "Feature",
      properties: {
        id: `cluster-${clusterIndex}`,
        type: "traffic_signal",
        count: cluster.length,
        routes: Array.from(allRoutes), // All routes from all lights in cluster
        snapped: nearestCrossing && minDistance <= SNAP_DISTANCE_METERS,
        crossing_id: nearestCrossing?.properties?.id,
      },
      geometry: {
        type: "Point",
        coordinates: finalCoords,
      },
    });
  });

  console.log(
    `Consolidated to ${consolidatedLights.length} traffic light locations`,
  );

  // Deduplicate: merge traffic lights that ended up at the same coordinates after snapping
  const coordsMap = new Map();
  
  consolidatedLights.forEach((light) => {
    const [lon, lat] = light.geometry.coordinates;
    const key = `${lon.toFixed(7)},${lat.toFixed(7)}`;
    
    if (coordsMap.has(key)) {
      // Merge with existing entry
      const existing = coordsMap.get(key);
      existing.properties.count += light.properties.count;
      // Merge routes
      const allRoutes = new Set([
        ...existing.properties.routes,
        ...light.properties.routes,
      ]);
      existing.properties.routes = Array.from(allRoutes);
    } else {
      coordsMap.set(key, light);
    }
  });

  const deduplicatedLights = Array.from(coordsMap.values());
  
  // Re-number the IDs
  deduplicatedLights.forEach((light, index) => {
    light.properties.id = `cluster-${index}`;
  });

  console.log(
    `Deduplicated to ${deduplicatedLights.length} unique locations`,
  );

  // Save consolidated traffic lights
  const output = {
    type: "FeatureCollection",
    features: deduplicatedLights,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Saved consolidated traffic lights to ${outputPath}`);
}

// Run for San Francisco
const trafficLightsPath = path.join(
  __dirname,
  "../src/data/sfTrafficLights.json",
);
const crossingsPath = path.join(__dirname, "../src/data/sfGradeCrossings.json");
const outputPath = path.join(
  __dirname,
  "../src/data/sfTrafficLightsConsolidated.json",
);

consolidateTrafficLights(trafficLightsPath, crossingsPath, outputPath);
