#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const BBOX = [38.94, -77.12, 39.05, -76.86];
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const ROUTE_FILE = path.join(ROOT, "src", "data", "routes", "washingtonPreviewRoutes.json");
const OUTPUTS = {
  stops: path.join(ROOT, "src", "data", "stops", "washingtonPurpleLineStops.json"),
  crossings: path.join(
    ROOT,
    "src",
    "data",
    "crossings",
    "washingtonPurpleLineGradeCrossings.json",
  ),
  switches: path.join(ROOT, "src", "data", "switches", "washingtonPurpleLineSwitches.json"),
  trafficLights: path.join(
    ROOT,
    "src",
    "data",
    "traffic-lights",
    "washingtonPurpleLineTrafficLightsConsolidated.json",
  ),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOverpass(query) {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `data=${encodeURIComponent(query)}`,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
        console.warn(
          `Overpass request failed via ${endpoint} (attempt ${attempt}/2): ${error.message}`,
        );
        if (attempt < 2) {
          await delay(1200);
        }
      }
    }
  }

  throw lastError || new Error("All Overpass endpoints failed");
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointToSegmentDistanceMeters(point, a, b) {
  const lonScale = Math.cos(toRad((a[1] + b[1] + point[1]) / 3));
  const ax = a[0] * 111320 * lonScale;
  const ay = a[1] * 110540;
  const bx = b[0] * 111320 * lonScale;
  const by = b[1] * 110540;
  const px = point[0] * 111320 * lonScale;
  const py = point[1] * 110540;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function minDistanceToRouteMeters(point, routeLines) {
  let best = Infinity;
  for (const line of routeLines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const candidate = pointToSegmentDistanceMeters(point, line[i], line[i + 1]);
      if (candidate < best) best = candidate;
    }
  }
  return best;
}

function readRouteLines() {
  const routeData = JSON.parse(fs.readFileSync(ROUTE_FILE, "utf8"));
  return (routeData.features || []).flatMap((feature) => {
    if (feature?.geometry?.type === "LineString") {
      return [feature.geometry.coordinates];
    }
    if (feature?.geometry?.type === "MultiLineString") {
      return feature.geometry.coordinates;
    }
    return [];
  });
}

function centroidFromCoords(coords) {
  const [sumLon, sumLat] = coords.reduce(
    (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]],
    [0, 0],
  );
  return [sumLon / coords.length, sumLat / coords.length];
}

function elementCenter(element) {
  if (typeof element.lon === "number" && typeof element.lat === "number") {
    return [element.lon, element.lat];
  }
  if (element.center && typeof element.center.lon === "number") {
    return [element.center.lon, element.center.lat];
  }
  if (Array.isArray(element.geometry) && element.geometry.length > 0) {
    return centroidFromCoords(element.geometry.map((point) => [point.lon, point.lat]));
  }
  return null;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function dedupeByCoordinate(features, thresholdMeters = 8) {
  const result = [];
  for (const feature of features) {
    const coord = feature.geometry.coordinates;
    const existing = result.find(
      (candidate) =>
        haversineMeters(candidate.geometry.coordinates, coord) <= thresholdMeters &&
        String(candidate.properties.stop_name || candidate.properties.name || "") ===
          String(feature.properties.stop_name || feature.properties.name || ""),
    );
    if (!existing) result.push(feature);
  }
  return result;
}

function aggregateStopsByName(features) {
  const groups = new Map();

  for (const feature of features) {
    const key = feature.properties.stop_name;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(feature);
  }

  return Array.from(groups.entries())
    .map(([stopName, items]) => ({
      type: "Feature",
      properties: {
        stop_id: items.map((item) => item.properties.stop_id).join(","),
        stop_name: stopName,
        routes: ["PURPLE"],
      },
      geometry: {
        type: "Point",
        coordinates: centroidFromCoords(items.map((item) => item.geometry.coordinates)),
      },
    }))
    .sort((a, b) => a.properties.stop_name.localeCompare(b.properties.stop_name));
}

function clusterTrafficLights(points) {
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < points.length; i += 1) {
    if (used.has(i)) continue;
    used.add(i);
    const seed = points[i];
    const cluster = [seed];

    for (let j = i + 1; j < points.length; j += 1) {
      if (used.has(j)) continue;
      if (
        haversineMeters(seed.geometry.coordinates, points[j].geometry.coordinates) <= 18 &&
        seed.properties.crossing_id === points[j].properties.crossing_id
      ) {
        used.add(j);
        cluster.push(points[j]);
      }
    }

    const centroid = centroidFromCoords(cluster.map((item) => item.geometry.coordinates));
    clusters.push({
      type: "Feature",
      properties: {
        id: `cluster-${clusters.length}`,
        type: "traffic_signal",
        count: cluster.length,
        routes: ["PURPLE"],
        snapped: true,
        crossing_id: seed.properties.crossing_id,
      },
      geometry: {
        type: "Point",
        coordinates: centroid,
      },
    });
  }

  return clusters;
}

function crossingType(tags = {}) {
  if (tags.railway === "level_crossing") return "level_crossing";
  if (tags.crossing === "railway") return "railway_crossing";
  return tags.railway || tags.crossing || "crossing";
}

async function main() {
  const [south, west, north, east] = BBOX;
  const routeLines = readRouteLines();

  const trackData = await fetchOverpass(`
[out:json][timeout:90];
(
  way["name"="Purple Line"]["railway"="construction"](${south},${west},${north},${east});
  way["name"="Purple Line"]["construction:railway"="light_rail"](${south},${west},${north},${east});
);
(._;>;);
out body;
`);

  const wayNodeIds = new Set();
  for (const element of trackData.elements || []) {
    if (element.type === "way" && Array.isArray(element.nodes)) {
      for (const nodeId of element.nodes) wayNodeIds.add(nodeId);
    }
  }

  const switches = [];
  const crossings = [];
  for (const element of trackData.elements || []) {
    if (element.type !== "node" || !wayNodeIds.has(element.id)) continue;
    const coord = [element.lon, element.lat];
    const tags = element.tags || {};

    if (tags.railway === "switch") {
      switches.push({
        type: "Feature",
        properties: {
          id: element.id,
          railway: "switch",
        },
        geometry: {
          type: "Point",
          coordinates: coord,
        },
      });
    }

    if (tags.railway === "level_crossing" || tags.crossing === "railway") {
      crossings.push({
        type: "Feature",
        properties: {
          id: String(element.id),
          type: crossingType(tags),
          routes: ["PURPLE"],
          name: tags.name || null,
          crossing_barrier: tags.crossing_barrier || null,
          crossing_light: tags.crossing_light || null,
          crossing_bell: tags.crossing_bell || null,
          crossingCount: 1,
        },
        geometry: {
          type: "Point",
          coordinates: coord,
        },
      });
    }
  }

  const stopCandidates = await fetchOverpass(`
[out:json][timeout:90];
(
  node["railway"~"station|tram_stop|halt"](${south},${west},${north},${east});
  way["railway"~"station|tram_stop|halt"](${south},${west},${north},${east});
  relation["railway"~"station|tram_stop|halt"](${south},${west},${north},${east});
  node["public_transport"="platform"][!bus][!highway](${south},${west},${north},${east});
  way["public_transport"="platform"][!bus][!highway](${south},${west},${north},${east});
  relation["public_transport"="platform"][!bus](${south},${west},${north},${east});
);
out center tags;
`);

  const rawStops = [];
  for (const element of stopCandidates.elements || []) {
    const tags = element.tags || {};
    if (!tags.name) continue;
    if (tags.bus === "yes" || tags.highway === "bus_stop") continue;
    if (tags.public_transport === "platform" && !tags.railway && !tags.station && !tags.tram) {
      // Keep only platforms that are tightly aligned to the Purple Line.
      const coord = elementCenter(element);
      if (!coord || minDistanceToRouteMeters(coord, routeLines) > 35) continue;
    }
    const coord = elementCenter(element);
    if (!coord) continue;
    if (minDistanceToRouteMeters(coord, routeLines) > 120) continue;

    rawStops.push({
      type: "Feature",
      properties: {
        stop_id: String(element.id),
        stop_name: tags.name,
        routes: ["PURPLE"],
      },
      geometry: {
        type: "Point",
        coordinates: coord,
      },
    });
  }

  const stops = aggregateStopsByName(dedupeByCoordinate(rawStops));

  const trafficSignalData = await fetchOverpass(`
[out:json][timeout:90];
node["highway"="traffic_signals"](${south},${west},${north},${east});
out body;
`);

  const trafficSignalsNearCrossings = [];
  for (const element of trafficSignalData.elements || []) {
    if (element.type !== "node") continue;
    const coord = [element.lon, element.lat];

    let nearestCrossing = null;
    let bestDistance = Infinity;
    for (const crossing of crossings) {
      const distance = haversineMeters(coord, crossing.geometry.coordinates);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearestCrossing = crossing;
      }
    }

    if (!nearestCrossing || bestDistance > 35) continue;

    trafficSignalsNearCrossings.push({
      type: "Feature",
      properties: {
        id: String(element.id),
        type: "traffic_signal",
        count: 1,
        routes: ["PURPLE"],
        snapped: true,
        crossing_id: nearestCrossing.properties.id,
      },
      geometry: {
        type: "Point",
        coordinates: coord,
      },
    });
  }

  const trafficLights = clusterTrafficLights(trafficSignalsNearCrossings);

  writeJson(OUTPUTS.switches, {
    type: "FeatureCollection",
    features: switches,
  });
  writeJson(OUTPUTS.crossings, {
    type: "FeatureCollection",
    features: crossings,
  });
  writeJson(OUTPUTS.stops, {
    type: "FeatureCollection",
    features: stops,
  });
  writeJson(OUTPUTS.trafficLights, {
    type: "FeatureCollection",
    features: trafficLights,
  });

  console.log(
    JSON.stringify(
      {
        stops: stops.length,
        switches: switches.length,
        crossings: crossings.length,
        trafficLights: trafficLights.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
