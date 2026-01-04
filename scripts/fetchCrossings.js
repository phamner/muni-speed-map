#!/usr/bin/env node
/**
 * Fetch Grade Crossings from OpenStreetMap via Overpass API
 * 
 * Downloads railway grade crossings (level crossings) for SF and LA,
 * filters them to only include crossings near our transit lines,
 * and saves them as GeoJSON files for use in the map.
 * 
 * Run with: node scripts/fetchCrossings.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Distance threshold - only include crossings within this distance of a route
const PROXIMITY_METERS = 50;

// Cluster threshold - merge crossings within this distance into one marker
const CLUSTER_METERS = 25;

// Haversine distance between two points in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
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

// Cluster nearby crossings into single markers to reduce visual clutter
function clusterCrossings(features) {
  if (features.length === 0) return features;
  
  const clustered = [];
  const used = new Set();
  
  for (let i = 0; i < features.length; i++) {
    if (used.has(i)) continue;
    
    const feature = features[i];
    const [lon, lat] = feature.geometry.coordinates;
    
    // Find all crossings within CLUSTER_METERS of this one
    const clusterMembers = [feature];
    used.add(i);
    
    for (let j = i + 1; j < features.length; j++) {
      if (used.has(j)) continue;
      
      const other = features[j];
      const [otherLon, otherLat] = other.geometry.coordinates;
      const distance = haversineDistance(lat, lon, otherLat, otherLon);
      
      if (distance <= CLUSTER_METERS) {
        clusterMembers.push(other);
        used.add(j);
      }
    }
    
    // Create a single clustered feature
    if (clusterMembers.length === 1) {
      // No clustering needed, keep as-is but add count
      feature.properties.crossingCount = 1;
      clustered.push(feature);
    } else {
      // Merge cluster into one feature at the centroid
      let sumLat = 0, sumLon = 0;
      const allRoutes = new Set();
      let hasBarrier = false, hasLight = false, hasBell = false;
      
      for (const member of clusterMembers) {
        const [mLon, mLat] = member.geometry.coordinates;
        sumLat += mLat;
        sumLon += mLon;
        
        // Merge routes
        for (const route of member.properties.routes) {
          allRoutes.add(route);
        }
        
        // Merge crossing equipment (any crossing in cluster has it)
        if (member.properties.crossing_barrier) hasBarrier = true;
        if (member.properties.crossing_light) hasBell = true;
        if (member.properties.crossing_bell) hasBell = true;
      }
      
      const centroidLat = sumLat / clusterMembers.length;
      const centroidLon = sumLon / clusterMembers.length;
      
      clustered.push({
        type: 'Feature',
        properties: {
          id: clusterMembers.map(m => m.properties.id).join(','),
          type: 'level_crossing',
          routes: Array.from(allRoutes),
          crossingCount: clusterMembers.length,
          crossing_barrier: hasBarrier ? 'yes' : null,
          crossing_light: hasLight ? 'yes' : null,
          crossing_bell: hasBell ? 'yes' : null,
        },
        geometry: {
          type: 'Point',
          coordinates: [centroidLon, centroidLat]
        }
      });
    }
  }
  
  return clustered;
}

// City configurations
const CITIES = {
  SF: {
    name: 'San Francisco',
    bbox: [37.65, -122.55, 37.85, -122.35],
    routesFile: 'muniMetroRoutes.json',
    outputFile: 'sfGradeCrossings.json'
  },
  LA: {
    name: 'Los Angeles',
    bbox: [33.6, -118.7, 34.35, -117.7],
    routesFile: 'laMetroRoutes.json',
    outputFile: 'laGradeCrossings.json'
  },
  Seattle: {
    name: 'Seattle',
    bbox: [47.15, -122.5, 47.80, -122.0],
    routesFile: 'seattleLinkRoutes.json',
    outputFile: 'seattleGradeCrossings.json'
  },
  Boston: {
    name: 'Boston',
    bbox: [42.22, -71.25, 42.45, -70.95],
    routesFile: 'bostonGreenLineRoutes.json',
    outputFile: 'bostonGradeCrossings.json'
  },
  Portland: {
    name: 'Portland',
    bbox: [45.3, -123.0, 45.65, -122.4],
    routesFile: 'portlandMaxRoutes.json',
    outputFile: 'portlandGradeCrossings.json'
  },
  SanDiego: {
    name: 'San Diego',
    bbox: [32.5, -117.3, 33.0, -116.8],
    routesFile: 'sanDiegoTrolleyRoutes.json',
    outputFile: 'sanDiegoGradeCrossings.json'
  },
  Toronto: {
    name: 'Toronto',
    bbox: [43.58, -79.55, 43.75, -79.25],
    routesFile: 'torontoStreetcarRoutes.json',
    outputFile: 'torontoGradeCrossings.json'
  },
  Philadelphia: {
    name: 'Philadelphia',
    bbox: [39.85, -75.35, 40.05, -75.05],
    routesFile: 'phillyTrolleyRoutes.json',
    outputFile: 'phillyGradeCrossings.json'
  },
  Sacramento: {
    name: 'Sacramento',
    bbox: [38.45, -121.6, 38.7, -121.2],
    routesFile: 'sacramentoLightRailRoutes.json',
    outputFile: 'sacramentoGradeCrossings.json'
  },
  Pittsburgh: {
    name: 'Pittsburgh',
    bbox: [40.30, -80.15, 40.55, -79.85],
    routesFile: 'pittsburghTRoutes.json',
    outputFile: 'pittsburghGradeCrossings.json'
  },
  Dallas: {
    name: 'Dallas',
    bbox: [32.60, -97.10, 33.05, -96.55],
    routesFile: 'dallasDartRoutes.json',
    outputFile: 'dallasGradeCrossings.json'
  },
  Minneapolis: {
    name: 'Minneapolis',
    bbox: [44.85, -93.45, 45.10, -93.10],
    routesFile: 'minneapolisMetroRoutes.json',
    outputFile: 'minneapolisGradeCrossings.json'
  },
  Denver: {
    name: 'Denver',
    bbox: [39.55, -105.15, 39.95, -104.75],
    routesFile: 'denverRtdRoutes.json',
    outputFile: 'denverGradeCrossings.json'
  },
  SaltLakeCity: {
    name: 'Salt Lake City',
    bbox: [40.55, -112.10, 40.90, -111.70],
    routesFile: 'slcTraxRoutes.json',
    outputFile: 'slcGradeCrossings.json'
  }
};

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

async function fetchCrossings(cityKey, city) {
  const { name, bbox, routesFile, outputFile } = city;
  const [south, west, north, east] = bbox;
  
  console.log(`\n📍 Fetching grade crossings for ${name}...`);
  console.log(`   Bounding box: ${south}, ${west}, ${north}, ${east}`);
  
  // Load routes for this city
  const routesPath = path.join(__dirname, '..', 'src', 'data', routesFile);
  let routes;
  try {
    routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
    console.log(`   Loaded ${routes.features.length} route segments from ${routesFile}`);
  } catch (error) {
    console.error(`   ❌ Could not load routes from ${routesFile}:`, error.message);
    return 0;
  }
  
  // Build route geometry map
  const routeCoordsByRouteId = new Map();
  routes.features.forEach(feature => {
    const routeId = feature.properties.route_id;
    if (!routeCoordsByRouteId.has(routeId)) {
      routeCoordsByRouteId.set(routeId, []);
    }
    routeCoordsByRouteId.get(routeId).push(feature.geometry.coordinates);
  });
  console.log(`   Found ${routeCoordsByRouteId.size} unique routes`);
  
  // Overpass QL query for railway level crossings
  const query = `
[out:json][timeout:60];
(
  node["railway"="level_crossing"](${south},${west},${north},${east});
);
out body;
`;

  try {
    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `data=${encodeURIComponent(query)}`
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`   Found ${data.elements.length} total grade crossings in bounding box`);
    
    // Filter crossings to only those near our transit lines
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
        // SF-specific filter: Skip ALL crossings near F line
        // The F runs on Market St surface, where subway lines run underground
        // Grade crossings tagged near F are NOT valid crossings for the underground lines
        if (cityKey === 'SF') {
          const nearF = nearRoutes.includes('F');
          if (nearF) {
            // Skip this crossing - it's on Market St (F's surface route)
            // The other lines (J/K/L/M/N) are underground here
            continue;
          }
        }
        
        filteredFeatures.push({
          type: 'Feature',
          properties: {
            id: String(node.id),
            type: 'level_crossing',
            routes: nearRoutes, // Which routes this crossing is near
            name: node.tags?.name || null,
            crossing_barrier: node.tags?.['crossing:barrier'] || null,
            crossing_light: node.tags?.['crossing:light'] || null,
            crossing_bell: node.tags?.['crossing:bell'] || null,
          },
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          }
        });
      }
    }
    
    console.log(`   ✂️  Filtered to ${filteredFeatures.length} crossings near transit lines`);
    
    // Cluster nearby crossings to reduce visual clutter
    const clusteredFeatures = clusterCrossings(filteredFeatures);
    console.log(`   🔗 Clustered to ${clusteredFeatures.length} markers (merged crossings within ${CLUSTER_METERS}m)`);
    
    // SF-specific: manually delete specific problematic crossings
    let finalFeatures = clusteredFeatures;
    if (cityKey === 'SF') {
      const crossingsToDelete = new Set([
        '703454967',  // Near Castro/17th - K/L/M portal, not a real crossing
        '302737181,1369473144,4406691927,6250503701',  // Chinatown/Embarcadero area
        '763662801,4406691920',  // Chinatown area
        '1582859657',  // Powell/California area - T line is underground here
        '4503467074,4503467075',  // Powell/California area - T line is underground here
      ]);
      const beforeCount = finalFeatures.length;
      finalFeatures = clusteredFeatures.filter(f => !crossingsToDelete.has(f.properties.id));
      if (finalFeatures.length < beforeCount) {
        console.log(`   🗑️  Deleted ${beforeCount - finalFeatures.length} manually specified crossings`);
      }
    }
    
    // Create GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: finalFeatures
    };
    
    // Save to file
    const outputPath = path.join(__dirname, '..', 'src', 'data', outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`   ✅ Saved to src/data/${outputFile}`);
    
    return clusteredFeatures.length;
  } catch (error) {
    console.error(`   ❌ Error fetching ${name}:`, error.message);
    return 0;
  }
}

async function main() {
  console.log('🚧 Grade Crossing Fetcher');
  console.log('   Using OpenStreetMap Overpass API');
  console.log(`   Filtering to crossings within ${PROXIMITY_METERS}m of transit lines`);
  console.log(`   Clustering crossings within ${CLUSTER_METERS}m into single markers`);
  
  let totalCrossings = 0;
  
  for (const [cityKey, city] of Object.entries(CITIES)) {
    const count = await fetchCrossings(cityKey, city);
    totalCrossings += count;
    
    // Be nice to the API - wait between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n✨ Done! Saved ${totalCrossings} transit-related grade crossings`);
}

main();
