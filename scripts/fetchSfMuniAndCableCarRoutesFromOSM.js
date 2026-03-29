#!/usr/bin/env node
/**
 * Fetch San Francisco Muni light rail and cable car route geometry from OSM.
 *
 * This script queries Overpass route relations, extracts their track member ways,
 * merges contiguous geometry, and writes a separate GeoJSON file so we can
 * compare OSM route shapes against the existing GTFS-derived SF route file.
 *
 * Output:
 *   src/data/routes/sfMuniOsmRoutes.json
 *
 * Run with:
 *   node scripts/fetchSfMuniAndCableCarRoutesFromOSM.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "routes",
  "sfMuniOsmRoutes.json",
);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const SF_BBOX = [37.68, -122.53, 37.84, -122.35];

const ROUTE_DEFS = {
  J: { route_id: "J", route_name: "J CHURCH", route_color: "#A96614" },
  K: { route_id: "K", route_name: "K INGLESIDE", route_color: "#437C93" },
  L: { route_id: "L", route_name: "L TARAVAL", route_color: "#942D83" },
  M: { route_id: "M", route_name: "M OCEAN VIEW", route_color: "#008547" },
  N: { route_id: "N", route_name: "N JUDAH", route_color: "#005B95" },
  T: { route_id: "T", route_name: "T THIRD", route_color: "#BF2B45" },
  CA: {
    route_id: "CA",
    route_name: "California Street Cable Car",
    route_color: "#36afb6",
  },
  PH: {
    route_id: "PH",
    route_name: "Powell-Hyde Cable Car",
    route_color: "#36afb6",
  },
  PM: {
    route_id: "PM",
    route_name: "Powell-Mason Cable Car",
    route_color: "#36afb6",
  },
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

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMuniRelation(tags = {}) {
  const joined = [
    tags.network,
    tags["network:short"],
    tags.operator,
    tags["operator:short"],
    tags.brand,
    tags.ref,
    tags.name,
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  return (
    joined.includes("MUNI") ||
    joined.includes("SFMTA") ||
    joined.includes("SAN FRANCISCO MUNICIPAL")
  );
}

function getSfRouteKey(tags = {}) {
  const ref = normalizeText(tags.ref);
  const name = normalizeText(tags.name);
  const from = normalizeText(tags.from);
  const to = normalizeText(tags.to);
  const joined = `${ref} ${name} ${from} ${to}`;

  if (ref === "J" || joined.includes("J CHURCH")) return "J";
  if (ref === "K" || joined.includes("K INGLESIDE")) return "K";
  if (ref === "L" || joined.includes("L TARAVAL")) return "L";
  if (ref === "M" || joined.includes("M OCEAN VIEW")) return "M";
  if (ref === "N" || joined.includes("N JUDAH")) return "N";
  if (ref === "T" || joined.includes("T THIRD")) return "T";

  if (
    ref === "CA" ||
    joined.includes("CALIFORNIA STREET") ||
    joined.includes("CALIFORNIA CABLE CAR")
  ) {
    return "CA";
  }

  if (
    ref === "PH" ||
    joined.includes("POWELL-HYDE") ||
    joined.includes("POWELL HYDE")
  ) {
    return "PH";
  }

  if (
    ref === "PM" ||
    joined.includes("POWELL-MASON") ||
    joined.includes("POWELL MASON")
  ) {
    return "PM";
  }

  return null;
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

async function main() {
  const [south, west, north, east] = SF_BBOX;

  console.log("Fetching San Francisco Muni light rail + cable car routes from OSM...");
  console.log(`Bounding box: ${south}, ${west}, ${north}, ${east}`);

  const relationQuery = `
[out:json][timeout:120];
(
  relation["type"="route"]["route"~"light_rail|tram"](${south},${west},${north},${east});
);
out body;
`;

  const relationData = await fetchOverpass(relationQuery);
  const relations = relationData.elements.filter((el) => el.type === "relation");
  console.log(`Found ${relations.length} candidate route relations`);

  const groupedRoutes = new Map();
  const routeRelationIds = new Map();

  for (const relation of relations) {
    if (!isMuniRelation(relation.tags)) continue;

    const routeKey = getSfRouteKey(relation.tags);
    if (!routeKey || !ROUTE_DEFS[routeKey]) continue;

    if (!groupedRoutes.has(routeKey)) {
      groupedRoutes.set(routeKey, {
        ...ROUTE_DEFS[routeKey],
        coordinates: [],
        seenWays: new Set(),
      });
      routeRelationIds.set(routeKey, []);
    }

    routeRelationIds.get(routeKey).push(relation.id);
  }

  const selectedRelationIds = Array.from(routeRelationIds.values()).flat();
  if (selectedRelationIds.length === 0) {
    throw new Error("No matching Muni light rail or cable car relations found");
  }

  console.log(
    `Matched ${selectedRelationIds.length} route relations across ${groupedRoutes.size} routes`,
  );

  const wayQuery = `
[out:json][timeout:180];
(
  relation(id:${selectedRelationIds.join(",")});
);
(._;>>;);
out body geom;
`;

  const wayData = await fetchOverpass(wayQuery);
  const relationMembers = new Map();
  for (const el of wayData.elements) {
    if (el.type === "relation") {
      relationMembers.set(el.id, el.members || []);
    }
  }

  const wayElements = wayData.elements.filter(
    (el) => el.type === "way" && el.geometry?.length > 1,
  );

  for (const [routeKey, relationIds] of routeRelationIds) {
    const route = groupedRoutes.get(routeKey);
    const allowedWayIds = new Set();

    for (const relationId of relationIds) {
      const refs = collectWayRefsRecursive(relationId, relationMembers);
      for (const ref of refs) allowedWayIds.add(ref);
    }

    const ways = wayElements.filter((el) => allowedWayIds.has(el.id));
    console.log(`  ${route.route_id}: ${ways.length} member ways`);

    for (const way of ways) {
      if (route.seenWays.has(way.id)) continue;
      route.seenWays.add(way.id);
      route.coordinates.push(way.geometry.map((pt) => [pt.lon, pt.lat]));
    }

    route.coordinates = mergeContiguousWays(route.coordinates);
    console.log(
      `  ${route.route_id}: merged into ${route.coordinates.length} line string(s)`,
    );
  }

  const features = Array.from(groupedRoutes.values())
    .filter((route) => route.coordinates.length > 0)
    .sort((a, b) => a.route_id.localeCompare(b.route_id))
    .map((route) => ({
      type: "Feature",
      properties: {
        route_id: route.route_id,
        route_name: route.route_name,
        route_color: route.route_color,
        source: "OpenStreetMap route relation",
      },
      geometry: {
        type: "MultiLineString",
        coordinates: route.coordinates,
      },
    }));

  const geojson = {
    type: "FeatureCollection",
    features,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));

  console.log(`Saved ${features.length} route feature(s) to ${OUTPUT_PATH}`);
  console.log("Cable car routes are forced to #36afb6 in the output file.");
}

main().catch((error) => {
  console.error(`Failed to fetch SF OSM routes: ${error.message}`);
  process.exitCode = 1;
});
