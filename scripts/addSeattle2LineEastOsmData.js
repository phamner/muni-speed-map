#!/usr/bin/env node
/**
 * Add OSM/OpenRailwayMap-derived infrastructure data for Seattle's 2 Line
 * east of the CID/Judkins Park portal area.
 *
 * This script:
 * - queries Overpass / OSM for the Seattle 2 Line east-side branch
 * - adds missing grade crossings, track switches,
 *   speed-limit segments, and separation segments
 * - never deletes existing grade crossings
 *
 * Usage:
 *   node scripts/addSeattle2LineEastOsmData.js
 *
 * Notes:
 * - The branch cutoff is defined by CUTOVER_LAT/LON.
 * - Traffic lights are added as individual OSM signals rather than clustered
 *   `cluster-*` synthetic IDs. That is intentional for this one-off add script.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const ROUTES_FILE = path.join(ROOT, "src", "data", "routes", "seattleLinkRoutes.json");
const CROSSINGS_FILE = path.join(ROOT, "src", "data", "crossings", "seattleGradeCrossings.json");
const SWITCHES_FILE = path.join(ROOT, "src", "data", "switches", "seattleSwitches.json");
const MAXSPEED_FILE = path.join(ROOT, "src", "data", "maxspeed", "seattleMaxspeed.json");
const SEPARATION_FILE = path.join(ROOT, "src", "data", "separation", "seattleSeparation.json");

const ROUTE_ID = "2LINE";
const CUTOVER_LAT = 47.592403;
const CUTOVER_LON = -122.327189;

// Tighter bbox around the east branch, extending a bit west of the cutoff so
// nearby infrastructure at the junction is not missed.
const BBOX = {
  south: 47.57,
  west: -122.34,
  north: 47.83,
  east: -122.10,
};

const ROUTE_PROXIMITY_METERS = 110;
const POINT_DEDUPE_METERS = 12;
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const A = lat - lat1;
  const B = lon - lon1;
  const C = lat2 - lat1;
  const D = lon2 - lon1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let nearLat;
  let nearLon;
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

function extractLineStrings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function findNearestPointOnLine(lat, lon, coordinates) {
  let minDistance = Infinity;
  let distanceAlong = 0;
  let bestDistanceAlong = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    const segLen = haversineDistance(y1, x1, y2, x2);
    const dist = distanceToSegment(lat, lon, y1, x1, y2, x2);

    if (dist < minDistance) {
      minDistance = dist;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t =
        dx === 0 && dy === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy),
              ),
            );
      bestDistanceAlong = distanceAlong + t * segLen;
    }

    distanceAlong += segLen;
  }

  return {
    distance: minDistance,
    distanceAlong: bestDistanceAlong,
    totalLength: distanceAlong,
  };
}

function buildRouteLine(routeFeature) {
  const lineStrings = extractLineStrings(routeFeature.geometry);
  let best = null;
  let bestDistance = Infinity;
  let cumulative = 0;

  for (const coords of lineStrings) {
    const result = findNearestPointOnLine(CUTOVER_LAT, CUTOVER_LON, coords);
    if (result.distance < bestDistance) {
      bestDistance = result.distance;
      best = {
        coordinates: coords,
        cutoverDistanceAlong: cumulative + result.distanceAlong,
      };
    }
    cumulative += result.totalLength;
  }

  if (!best) {
    throw new Error(`Unable to locate cutover point on ${ROUTE_ID} route geometry`);
  }

  return best;
}

function nearestAlongRoute(lat, lon, routeCoords) {
  return findNearestPointOnLine(lat, lon, routeCoords);
}

function geometryIsOnEastBranch(coords, routeCoords, cutoverDistanceAlong) {
  let minDistance = Infinity;
  let maxAlongOnRoute = -Infinity;

  for (const [lon, lat] of coords) {
    const match = nearestAlongRoute(lat, lon, routeCoords);
    minDistance = Math.min(minDistance, match.distance);
    if (match.distance <= ROUTE_PROXIMITY_METERS) {
      maxAlongOnRoute = Math.max(maxAlongOnRoute, match.distanceAlong);
    }
  }

  return (
    minDistance <= ROUTE_PROXIMITY_METERS &&
    maxAlongOnRoute >= cutoverDistanceAlong
  );
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function overpassQuery() {
  const { south, west, north, east } = BBOX;
  return `
[out:json][timeout:90];
(
  node["railway"="level_crossing"](${south},${west},${north},${east});
  node["railway"="switch"](${south},${west},${north},${east});
  way["railway"="light_rail"]["maxspeed"](${south},${west},${north},${east});
  way["railway"="light_rail"]["tunnel"="yes"](${south},${west},${north},${east});
  way["railway"="light_rail"]["bridge"="yes"](${south},${west},${north},${east});
  way["railway"="light_rail"]["embedded"="yes"](${south},${west},${north},${east});
  way["railway"="light_rail"]["railway:traffic_mode"](${south},${west},${north},${east});
  way["railway"="light_rail"]["segregated"](${south},${west},${north},${east});
  way["railway"="light_rail"]["cutting"="yes"](${south},${west},${north},${east});
  way["railway"="light_rail"]["embankment"="yes"](${south},${west},${north},${east});
  way["railway"="light_rail"]["layer"](${south},${west},${north},${east});
);
out body geom;
`.trim();
}

async function fetchOverpass() {
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: overpassQuery(),
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function featureHasExactId(feature, rawId) {
  const existing = String(feature?.properties?.id ?? "");
  return existing === String(rawId) || existing.split(",").includes(String(rawId));
}

function pointNearExisting(features, lon, lat, meters) {
  return features.some((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return false;
    return haversineDistance(lat, lon, coords[1], coords[0]) <= meters;
  });
}

function getSeparationType(tags = {}) {
  if (tags.tunnel === "yes") return "tunnel";
  if (tags.bridge === "yes") return "elevated";

  const layer = parseInt(tags.layer, 10);
  if (!Number.isNaN(layer)) {
    if (layer <= -1) return "tunnel";
    if (layer >= 1) return "elevated";
  }

  if (
    tags.embedded === "yes" ||
    tags["railway:run"] === "street" ||
    tags.tram === "yes"
  ) {
    return "street_running";
  }

  if (tags["railway:traffic_mode"] === "mixed") return "mixed_traffic";

  if (
    tags.segregated === "yes" ||
    tags.cutting === "yes" ||
    tags.embankment === "yes"
  ) {
    return "separated_at_grade";
  }

  return null;
}

function makeLineStringFeature(element, props) {
  return {
    type: "Feature",
    properties: props,
    geometry: {
      type: "LineString",
      coordinates: (element.geometry || []).map((p) => [p.lon, p.lat]),
    },
  };
}

async function main() {
  const routes = await readJson(ROUTES_FILE);
  const routeFeature = routes.features.find(
    (feature) => feature.properties?.route_id === ROUTE_ID,
  );

  if (!routeFeature) {
    throw new Error(`Could not find ${ROUTE_ID} in ${ROUTES_FILE}`);
  }

  const { coordinates: routeCoords, cutoverDistanceAlong } = buildRouteLine(routeFeature);
  const overpass = await fetchOverpass();
  const elements = overpass.elements || [];

  const crossings = await readJson(CROSSINGS_FILE);
  const switches = await readJson(SWITCHES_FILE);
  const maxspeed = await readJson(MAXSPEED_FILE);
  const separation = await readJson(SEPARATION_FILE);

  let addedCrossings = 0;
  let addedSwitches = 0;
  let addedMaxspeed = 0;
  let addedSeparation = 0;

  for (const element of elements) {
    if (element.type === "node") {
      const lon = element.lon;
      const lat = element.lat;
      const match = nearestAlongRoute(lat, lon, routeCoords);
      const onEastBranch =
        match.distance <= ROUTE_PROXIMITY_METERS &&
        match.distanceAlong >= cutoverDistanceAlong;

      if (!onEastBranch) continue;

      if (element.tags?.railway === "level_crossing") {
        const exists =
          crossings.features.some((feature) => featureHasExactId(feature, element.id)) ||
          pointNearExisting(crossings.features, lon, lat, POINT_DEDUPE_METERS);

        if (!exists) {
          crossings.features.push({
            type: "Feature",
            properties: {
              id: String(element.id),
              type: "level_crossing",
              routes: [ROUTE_ID],
              crossingCount: 1,
              crossing_barrier: element.tags?.["crossing:barrier"] || null,
              crossing_light: element.tags?.["crossing:light"] || null,
              crossing_bell: element.tags?.["crossing:bell"] || null,
            },
            geometry: { type: "Point", coordinates: [lon, lat] },
          });
          addedCrossings++;
        }
      }

      if (element.tags?.railway === "switch") {
        const exists = switches.features.some((feature) =>
          featureHasExactId(feature, element.id),
        );
        if (!exists) {
          switches.features.push({
            type: "Feature",
            properties: {
              id: element.id,
              type: "switch",
              railway: "switch",
            },
            geometry: { type: "Point", coordinates: [lon, lat] },
          });
          addedSwitches++;
        }
      }
    }

    if (element.type === "way" && Array.isArray(element.geometry) && element.geometry.length >= 2) {
      const coords = element.geometry.map((p) => [p.lon, p.lat]);
      const onEastBranch = geometryIsOnEastBranch(coords, routeCoords, cutoverDistanceAlong);
      if (!onEastBranch) continue;

      if (element.tags?.maxspeed) {
        const exists = maxspeed.features.some((feature) =>
          featureHasExactId(feature, element.id),
        );
        if (!exists) {
          const mphMatch = String(element.tags.maxspeed).match(/(\d+(?:\.\d+)?)/);
          const maxspeedMph = mphMatch ? Math.round(Number(mphMatch[1])) : null;
          maxspeed.features.push(
            makeLineStringFeature(element, {
              id: element.id,
              maxspeed: element.tags.maxspeed,
              maxspeed_mph: maxspeedMph,
              name: element.tags.name || "2 Line",
              network: element.tags.network || null,
              tunnel: element.tags.tunnel === "yes",
              bridge: element.tags.bridge === "yes",
            }),
          );
          addedMaxspeed++;
        }
      }

      const separationType = getSeparationType(element.tags);
      if (separationType) {
        const exists = separation.features.some((feature) =>
          featureHasExactId(feature, element.id),
        );
        if (!exists) {
          separation.features.push(
            makeLineStringFeature(element, {
              id: element.id,
              separationType,
              name: element.tags?.name || null,
              tunnel: element.tags?.tunnel === "yes",
              bridge: element.tags?.bridge === "yes",
              embedded: element.tags?.embedded === "yes",
              railwayRun: element.tags?.["railway:run"] || null,
              trafficMode: element.tags?.["railway:traffic_mode"] || null,
              segregated: element.tags?.segregated || null,
              cutting: element.tags?.cutting === "yes",
              embankment: element.tags?.embankment === "yes",
              layer: element.tags?.layer ? parseInt(element.tags.layer, 10) : null,
            }),
          );
          addedSeparation++;
        }
      }
    }
  }

  await writeJson(CROSSINGS_FILE, crossings);
  await writeJson(SWITCHES_FILE, switches);
  await writeJson(MAXSPEED_FILE, maxspeed);
  await writeJson(SEPARATION_FILE, separation);

  console.log(`Seattle 2 Line east-side OSM merge complete.`);
  console.log(`  Added crossings:   ${addedCrossings}`);
  console.log(`  Added switches:    ${addedSwitches}`);
  console.log(`  Added maxspeed:    ${addedMaxspeed}`);
  console.log(`  Added separation:  ${addedSeparation}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
