#!/usr/bin/env node
/**
 * One-off OSM fetcher for local-circulator / heritage-style rail overlays.
 *
 * Downloads route relations for:
 * - OC Streetcar
 * - Purple Line (Maryland / DC)
 * - Seattle Streetcar (First Hill + South Lake Union)
 * - Seattle Center Monorail
 * - Phoenix Streetcar
 *
 * Writes GeoJSON into src/data/routes for use as overlay-only route layers.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROUTES_DIR = path.join(__dirname, "..", "src", "data", "routes");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const CITIES = [
  {
    name: "LA",
    bbox: [33.70, -117.98, 33.80, -117.84],
    outputFile: "laHeritageLocalCirculatorRoutes.json",
    routeTypesRegex: "tram",
    fetchMode: "construction_ways",
    lineDefinitions: [
      {
        routeId: "OCSC",
        routeName: "OC Streetcar",
        routeColor: "#F28C28",
        matches: (tags) => {
          const text = collectTagText(tags);
          return (
            text.includes("oc streetcar") ||
            text.includes("orange county streetcar")
          );
        },
      },
    ],
  },
  {
    name: "Washington DC",
    bbox: [38.94, -77.12, 39.05, -76.86],
    outputFile: "washingtonPreviewRoutes.json",
    routeTypesRegex: "tram|light_rail",
    fetchMode: "construction_ways",
    lineDefinitions: [
      {
        routeId: "PURPLE",
        routeName: "Purple Line",
        routeColor: "#7F3FBF",
        matches: (tags) => {
          const text = collectTagText(tags);
          return (
            text.includes("purple line") &&
            (tags?.wikidata === "Q7261432" ||
              String(tags?.wikipedia || "").toLowerCase() ===
                "en:purple line (maryland)" ||
              String(tags?.website || "").includes("purplelinemd.com"))
          );
        },
      },
    ],
  },
  {
    name: "Seattle",
    bbox: [47.45, -122.43, 47.66, -122.26],
    outputFile: "seattleHeritageLocalCirculatorRoutes.json",
    routeTypesRegex: "tram|monorail",
    lineDefinitions: [
      {
        routeId: "SLU",
        routeName: "South Lake Union Streetcar",
        routeColor: "#C8102E",
        matches: (tags) => {
          const text = collectTagText(tags);
          return (
            text.includes("south lake union") ||
            text.includes("slu streetcar")
          );
        },
      },
      {
        routeId: "FH",
        routeName: "First Hill Streetcar",
        routeColor: "#F28C28",
        matches: (tags) => {
          const text = collectTagText(tags);
          return text.includes("first hill");
        },
      },
      {
        routeId: "MONO",
        routeName: "Seattle Center Monorail",
        routeColor: "#7E57C2",
        matches: (tags) => {
          const text = collectTagText(tags);
          return text.includes("monorail");
        },
      },
    ],
  },
  {
    name: "Phoenix",
    bbox: [33.38, -112.10, 33.44, -111.88],
    outputFile: "phoenixHeritageLocalCirculatorRoutes.json",
    routeTypesRegex: "tram",
    lineDefinitions: [
      {
        routeId: "PSC",
        routeName: "Phoenix Streetcar",
        routeColor: "#16A085",
        matches: (tags) => {
          const text = collectTagText(tags);
          return (
            text.includes("streetcar") ||
            text.includes("tempe streetcar") ||
            text.includes("valley metro streetcar")
          );
        },
      },
    ],
  },
];

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

function collectTagText(tags = {}) {
  return [
    tags.ref,
    tags.name,
    tags.long_name,
    tags.description,
    tags.operator,
    tags.network,
    tags.from,
    tags.to,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

async function fetchCity(config) {
  const [south, west, north, east] = config.bbox;
  console.log(`\nFetching ${config.name} heritage/local circulator routes...`);
  const matchedByRouteId = new Map();
  for (const definition of config.lineDefinitions) {
    matchedByRouteId.set(definition.routeId, {
      definition,
      relationIds: [],
      coordinates: [],
    });
  }

  if (config.fetchMode === "construction_ways") {
    const wayQuery = `
[out:json][timeout:90];
(
  way["railway"="construction"]["name"](${south},${west},${north},${east});
  way["construction:railway"~"tram|light_rail"]["name"](${south},${west},${north},${east});
);
out body geom;
`;
    const wayData = await fetchOverpass(wayQuery);
    const wayElements = wayData.elements.filter(
      (el) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 1,
    );

    for (const way of wayElements) {
      const tags = way.tags || {};
      for (const entry of matchedByRouteId.values()) {
        if (entry.definition.matches(tags)) {
          entry.coordinates.push(way.geometry.map((pt) => [pt.lon, pt.lat]));
        }
      }
    }
  } else {
    const relationQuery = `
[out:json][timeout:90];
(
  relation["route"~"${config.routeTypesRegex}"](${south},${west},${north},${east});
);
out body;
`;

    const relationData = await fetchOverpass(relationQuery);
    const relations = relationData.elements.filter((el) => el.type === "relation");

    for (const relation of relations) {
      const tags = relation.tags || {};
      for (const entry of matchedByRouteId.values()) {
        if (entry.definition.matches(tags)) {
          entry.relationIds.push(relation.id);
        }
      }
    }

    const selectedRelationIds = Array.from(matchedByRouteId.values())
      .flatMap((entry) => entry.relationIds)
      .filter((id, index, arr) => arr.indexOf(id) === index);

    if (selectedRelationIds.length === 0) {
      throw new Error(`No matching route relations found for ${config.name}`);
    }

    const wayQuery = `
[out:json][timeout:90];
(
  relation(id:${selectedRelationIds.join(",")});
);
(._;>>;);
out body geom;
`;

    const wayData = await fetchOverpass(wayQuery);
    const wayElements = wayData.elements.filter(
      (el) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 1,
    );
    const relationMembers = new Map();
    for (const element of wayData.elements) {
      if (element.type === "relation") {
        relationMembers.set(element.id, element.members || []);
      }
    }

    for (const entry of matchedByRouteId.values()) {
      if (entry.relationIds.length === 0) continue;

      const allowedWayIds = new Set();
      for (const relationId of entry.relationIds) {
        const refs = collectWayRefsRecursive(relationId, relationMembers);
        for (const ref of refs) allowedWayIds.add(ref);
      }

      entry.coordinates = wayElements
        .filter((element) => allowedWayIds.has(element.id))
        .map((element) => element.geometry.map((pt) => [pt.lon, pt.lat]));
    }
  }

  const features = [];
  for (const entry of matchedByRouteId.values()) {
    const coordinates = mergeContiguousWays(entry.coordinates);
    if (coordinates.length === 0) continue;

    features.push({
      type: "Feature",
      properties: {
        route_id: entry.definition.routeId,
        route_name: entry.definition.routeName,
        route_color: entry.definition.routeColor,
        overlay_category: "heritage_local_circulator",
        source:
          config.fetchMode === "construction_ways"
            ? "OpenStreetMap construction railway ways"
            : "OpenStreetMap route relation",
      },
      geometry: {
        type: "MultiLineString",
        coordinates,
      },
    });
  }

  const output = {
    type: "FeatureCollection",
    features,
  };

  const outputPath = path.join(ROUTES_DIR, config.outputFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Saved ${features.length} features to ${outputPath}`);
}

async function main() {
  const requestedCity = process.argv[2]?.toLowerCase();
  const citiesToFetch = requestedCity
    ? CITIES.filter((config) => config.name.toLowerCase() === requestedCity)
    : CITIES;

  if (requestedCity && citiesToFetch.length === 0) {
    throw new Error(
      `Unknown city "${process.argv[2]}". Expected one of: ${CITIES.map((config) => config.name).join(", ")}`,
    );
  }

  for (const config of citiesToFetch) {
    await fetchCity(config);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
