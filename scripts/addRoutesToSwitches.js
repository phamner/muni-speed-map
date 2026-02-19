import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Haversine distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Distance from point to line segment
function distanceToLineSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const A = lat - lat1;
  const B = lon - lon1;
  const C = lat2 - lat1;
  const D = lon2 - lon1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = lat1;
    yy = lon1;
  } else if (param > 1) {
    xx = lat2;
    yy = lon2;
  } else {
    xx = lat1 + param * C;
    yy = lon1 + param * D;
  }

  return haversineDistance(lat, lon, xx, yy);
}

// Distance from point to LineString
function distanceToLineString(lat, lon, lineCoords) {
  let minDist = Infinity;

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [lon1, lat1] = lineCoords[i];
    const [lon2, lat2] = lineCoords[i + 1];
    const dist = distanceToLineSegment(lat, lon, lat1, lon1, lat2, lon2);
    minDist = Math.min(minDist, dist);
  }

  return minDist;
}

// Main function
async function addRoutesToSwitches() {
  console.log("Loading switches data...");
  const switchesPath = join(__dirname, "../src/data/sfSwitches.json");
  const switches = JSON.parse(fs.readFileSync(switchesPath, "utf-8"));

  console.log("Loading routes data...");
  const routesPath = join(__dirname, "../src/data/muniMetroRoutes.json");
  const routes = JSON.parse(fs.readFileSync(routesPath, "utf-8"));

  console.log(`Processing ${switches.features.length} switches...`);

  const maxDistanceMeters = 50; // Same as used in SpeedMap.tsx

  // Process each switch
  switches.features.forEach((switchFeature, index) => {
    const [lon, lat] = switchFeature.geometry.coordinates;
    const nearbyRoutes = [];

    // Check distance to each route
    routes.features.forEach((routeFeature) => {
      const routeId = routeFeature.properties?.route_id;
      if (!routeId) return;

      const coords = routeFeature.geometry.coordinates;
      // Handle both LineString and MultiLineString
      const lineStrings =
        routeFeature.geometry.type === "MultiLineString" ? coords : [coords];

      for (const lineCoords of lineStrings) {
        const distance = distanceToLineString(lat, lon, lineCoords);
        if (distance <= maxDistanceMeters) {
          if (!nearbyRoutes.includes(routeId)) {
            nearbyRoutes.push(routeId);
          }
          break; // Found this route, no need to check other linestrings
        }
      }
    });

    // Add routes property
    switchFeature.properties.routes = nearbyRoutes;

    if ((index + 1) % 100 === 0) {
      console.log(
        `Processed ${index + 1}/${switches.features.length} switches`,
      );
    }
  });

  console.log("Writing updated switches data...");
  fs.writeFileSync(switchesPath, JSON.stringify(switches, null, 2));

  console.log("Done!");
  console.log(`Total switches: ${switches.features.length}`);
  console.log(
    `Switches with routes: ${switches.features.filter((f) => f.properties.routes?.length > 0).length}`,
  );
}

addRoutesToSwitches().catch(console.error);
