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

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// City configurations with their bounding boxes and route filters
const CITIES = {
  Seattle: {
    name: "Seattle",
    bbox: [47.15, -122.62, 47.83, -122.08],
    railwayTypes: "light_rail|tram|subway",
    routeTypesRegex: "light_rail|tram",
    useRouteRelations: true,
    fetchStops: false,
    outputRoutesFile: path.join("routes", "seattleLinkRoutes.json"),
    outputStopsFile: path.join("stops", "seattleLinkStops.json"),
    lineColors: {
      100479: "#28813F", // 1 Line
      "2LINE": "#007CAD", // 2 Line
      TLINE: "#F38B00", // T Line
    },
    lineNames: {
      100479: "1 Line",
      "2LINE": "2 Line",
      TLINE: "T Line",
    },
  },
  Pittsburgh: {
    name: "Pittsburgh",
    bbox: [40.3, -80.15, 40.55, -79.85],
    railwayTypes: "light_rail|subway|tram",
    routeType: "light_rail",
    useRouteRelations: true,
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
    routeType: "light_rail",
    useRouteRelations: true,
    outputRoutesFile: "denverRtdRoutes.json",
    outputStopsFile: "denverRtdStops.json",
    lineColors: {
      D: "#008348",
      E: "#552683",
      H: "#0075BE",
      L: "#FFCE00",
      R: "#C4D600",
      W: "#009DAA",
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

async function fetchOverpass(query) {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `data=${encodeURIComponent(query)}`,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error;
        console.warn(
          `   Overpass request failed via ${endpoint} (attempt ${attempt}/2): ${error.message}`,
        );
        if (attempt < 2) {
          await delay(1200);
        }
      }
    }
  }

  throw lastError || new Error("Overpass request failed");
}

function getRouteIdFromTags(tags = {}, city = null) {
  if (city?.name === "Seattle") {
    const ref = String(tags.ref || "")
      .trim()
      .toUpperCase();
    const name = String(tags.name || "")
      .trim()
      .toUpperCase();

    if (ref === "1" || ref === "1 LINE" || name.includes("1 LINE")) return "100479";
    if (ref === "2" || ref === "2 LINE" || name.includes("2 LINE")) return "2LINE";
    if (ref === "T" || ref === "T LINE" || name.includes("T LINE")) return "TLINE";
  }

  if (tags.ref) {
    const ref = String(tags.ref).trim().toUpperCase();
    if (ref.includes("RED")) return "RED";
    if (ref.includes("BLUE")) return "BLUE";
    if (ref.includes("SILVER")) return "SLVR";
    if (ref.includes("SLVR")) return "SLVR";
    return ref;
  }

  if (tags.name) {
    const name = String(tags.name).toLowerCase();
    if (name.includes("red")) return "RED";
    if (name.includes("blue")) return "BLUE";
    if (name.includes("silver")) return "SLVR";
    if (name.includes("green")) return "GREEN";
    if (name.includes("orange")) return "ORANGE";
    if (name.includes("gold")) return "GOLD";
  }

  return "default";
}

function getRouteName(routeId) {
  switch (routeId) {
    case "RED":
      return "Red Line";
    case "BLUE":
      return "Blue Line";
    case "SLVR":
      return "Silver Line";
    case "GREEN":
      return "Green Line";
    case "ORANGE":
      return "Orange Line";
    case "GOLD":
      return "Gold Line";
    case "100479":
      return "1 Line";
    case "2LINE":
      return "2 Line";
    case "TLINE":
      return "T Line";
    default:
      return routeId;
  }
}

function isTrackRelationMember(member) {
  const role = String(member?.role || "").toLowerCase();
  return (
    member?.type === "way" &&
    role !== "platform" &&
    role !== "platform_inactive" &&
    role !== "stop" &&
    role !== "station"
  );
}

function getCoordinateKey(coord) {
  const [lon, lat] = coord;
  return `${lon.toFixed(7)},${lat.toFixed(7)}`;
}

function reverseIfNeeded(coords, endpointKey, alignToEnd = true) {
  const startKey = getCoordinateKey(coords[0]);
  const endKey = getCoordinateKey(coords[coords.length - 1]);

  if (alignToEnd) {
    if (startKey === endpointKey) return coords;
    if (endKey === endpointKey) return [...coords].reverse();
  } else {
    if (endKey === endpointKey) return coords;
    if (startKey === endpointKey) return [...coords].reverse();
  }

  return null;
}

function mergeContiguousWays(wayCoordinateSets) {
  if (wayCoordinateSets.length <= 1) {
    return wayCoordinateSets;
  }

  const endpoints = new Map();
  wayCoordinateSets.forEach((coords, index) => {
    if (!coords || coords.length < 2) return;
    const startKey = getCoordinateKey(coords[0]);
    const endKey = getCoordinateKey(coords[coords.length - 1]);

    if (!endpoints.has(startKey)) endpoints.set(startKey, []);
    if (!endpoints.has(endKey)) endpoints.set(endKey, []);

    endpoints.get(startKey).push(index);
    endpoints.get(endKey).push(index);
  });

  const unused = new Set(wayCoordinateSets.map((_, index) => index));
  const merged = [];

  while (unused.size > 0) {
    let seedIndex = null;

    for (const index of unused) {
      const coords = wayCoordinateSets[index];
      const startDegree = endpoints.get(getCoordinateKey(coords[0]))?.length || 0;
      const endDegree =
        endpoints.get(getCoordinateKey(coords[coords.length - 1]))?.length || 0;
      if (startDegree === 1 || endDegree === 1) {
        seedIndex = index;
        break;
      }
    }

    if (seedIndex == null) {
      seedIndex = unused.values().next().value;
    }

    unused.delete(seedIndex);
    let chain = [...wayCoordinateSets[seedIndex]];

    let extended = true;
    while (extended) {
      extended = false;

      const chainStartKey = getCoordinateKey(chain[0]);
      const chainEndKey = getCoordinateKey(chain[chain.length - 1]);

      for (const candidateIndex of Array.from(unused)) {
        const candidate = wayCoordinateSets[candidateIndex];
        const appendCandidate = reverseIfNeeded(candidate, chainEndKey, true);
        if (appendCandidate) {
          chain = chain.concat(appendCandidate.slice(1));
          unused.delete(candidateIndex);
          extended = true;
          break;
        }

        const prependCandidate = reverseIfNeeded(candidate, chainStartKey, false);
        if (prependCandidate) {
          chain = prependCandidate.slice(0, -1).concat(chain);
          unused.delete(candidateIndex);
          extended = true;
          break;
        }
      }
    }

    merged.push(chain);
  }

  return merged.sort((a, b) => b.length - a.length);
}

function collectWayRefsRecursive(relationId, relationMembers, visited = new Set()) {
  if (visited.has(relationId)) return new Set();
  visited.add(relationId);

  const members = relationMembers.get(relationId) || [];
  const refs = new Set();

  for (const member of members) {
    if (member?.type === "way" && isTrackRelationMember(member)) {
      refs.add(member.ref);
    } else if (member?.type === "relation") {
      const nestedRefs = collectWayRefsRecursive(member.ref, relationMembers, visited);
      for (const ref of nestedRefs) refs.add(ref);
    }
  }

  return refs;
}

async function fetchRouteRelations(cityKey) {
  const city = CITIES[cityKey];
  const [south, west, north, east] = city.bbox;
  const routeSelector = city.routeTypesRegex
    ? `["route"~"${city.routeTypesRegex}"]`
    : `["route"="${city.routeType}"]`;

  console.log(`\n📍 Fetching route relations for ${city.name}...`);
  console.log(`   Bounding box: ${south}, ${west}, ${north}, ${east}`);

  const relationQuery = `
[out:json][timeout:90];
(
  relation${routeSelector}(${south},${west},${north},${east});
);
out body;
`;

  try {
    const relationData = await fetchOverpass(relationQuery);
    const relations = relationData.elements.filter((el) => el.type === "relation");

    console.log(`   Found ${relations.length} route relations`);

    const routeSegments = new Map();
    const routeRelationIds = new Map();

    for (const relation of relations) {
      const routeId = getRouteIdFromTags(relation.tags, city);
      if (!city.lineColors[routeId]) continue;

      if (!routeSegments.has(routeId)) {
        routeSegments.set(routeId, {
          route_id: routeId,
          route_name: city.lineNames?.[routeId] || getRouteName(routeId),
          route_color: city.lineColors[routeId],
          coordinates: [],
          seenWays: new Set(),
        });
      }
      if (!routeRelationIds.has(routeId)) {
        routeRelationIds.set(routeId, []);
      }
      routeRelationIds.get(routeId).push(relation.id);
    }

    const allRelationIds = Array.from(routeRelationIds.values()).flat();
    if (allRelationIds.length === 0) {
      console.log("   No matching route relations after filtering");
      return 0;
    }

    const wayQuery = `
[out:json][timeout:90];
(
  relation(id:${allRelationIds.join(",")});
);
(._;>>;);
out body geom;
`;
    const wayData = await fetchOverpass(wayQuery);
    const wayElements = wayData.elements.filter(
      (el) => el.type === "way" && el.geometry?.length > 1,
    );
    const relationMembers = new Map();
    for (const el of wayData.elements) {
      if (el.type === "relation") {
        relationMembers.set(el.id, el.members || []);
      }
    }

    for (const [routeId, relationIds] of routeRelationIds) {
      const route = routeSegments.get(routeId);
      const allowedWayIds = new Set();
      for (const relationId of relationIds) {
        const refs = collectWayRefsRecursive(relationId, relationMembers);
        for (const ref of refs) allowedWayIds.add(ref);
      }
      const ways = wayElements.filter((el) => allowedWayIds.has(el.id));

      console.log(`   ${routeId}: ${ways.length} member ways`);

      for (const way of ways) {
        if (route.seenWays.has(way.id)) continue;
        route.seenWays.add(way.id);
        route.coordinates.push(
          way.geometry.map((pt) => [pt.lon, pt.lat]),
        );
      }

      route.coordinates = mergeContiguousWays(route.coordinates);
      console.log(`   ${routeId}: merged into ${route.coordinates.length} line strings`);
    }

    const features = Array.from(routeSegments.values())
      .filter((route) => route.coordinates.length > 0)
      .map((route) => ({
        type: "Feature",
        properties: {
          route_id: route.route_id,
          route_name: route.route_name,
          route_color: route.route_color,
        },
        geometry: {
          type: "MultiLineString",
          coordinates: route.coordinates,
        },
      }));

    console.log(`   Created ${features.length} route features`);

    const geojson = {
      type: "FeatureCollection",
      features,
    };

    const outputPath = path.join(DATA_DIR, city.outputRoutesFile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`   ✅ Saved routes to ${city.outputRoutesFile}`);

    return features.length;
  } catch (error) {
    console.error(
      `   ❌ Error fetching route relations for ${city.name}:`,
      error.message,
    );
    return 0;
  }
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
        const route_id = getRouteIdFromTags(element.tags, city);

        // Get color from our line colors or use default
        const color =
          city.lineColors[route_id] || city.lineColors["default"] || "#666666";

        return {
          type: "Feature",
          properties: {
            id: element.id,
            route_id: route_id,
            route_name: city.lineNames?.[route_id] || getRouteName(route_id),
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
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
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
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
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

  const args = process.argv.slice(2);
  const cityKeys =
    args.length > 0
      ? args.filter((key) => CITIES[key])
      : Object.keys(CITIES);

  for (const cityKey of cityKeys) {
    const routeCount = CITIES[cityKey].useRouteRelations
      ? await fetchRouteRelations(cityKey)
      : await fetchRailwayWays(cityKey);
    await delay(3000); // Respect rate limits

    let stopCount = 0;
    if (CITIES[cityKey].fetchStops !== false) {
      stopCount = await fetchRailwayStops(cityKey);
      await delay(3000);
    } else {
      console.log(`   Skipping stop fetch for ${CITIES[cityKey].name}`);
    }

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
