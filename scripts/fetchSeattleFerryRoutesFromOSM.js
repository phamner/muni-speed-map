#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "rail-context",
  "seattleFerryRoutesOverlay.json",
);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const BBOX = [47.0, -123.75, 48.75, -121.8];

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
          `Overpass Seattle ferry fetch failed via ${endpoint} (attempt ${attempt}/2): ${error.message}`,
        );
        if (attempt < 2) await delay(1000);
      }
    }
  }

  throw lastError || new Error("Overpass Seattle ferry fetch failed");
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

function isTrackMember(member) {
  const role = String(member?.role || "").toLowerCase();
  return (
    member?.type === "way" &&
    Array.isArray(member.geometry) &&
    member.geometry.length > 1 &&
    role !== "platform" &&
    role !== "stop" &&
    role !== "station"
  );
}

function stitchOrderedWayMembers(wayMembers) {
  const lines = [];
  let current = [];

  for (const member of wayMembers) {
    const coords = member.geometry.map((pt) => [pt.lon, pt.lat]);
    if (coords.length < 2) continue;

    if (current.length === 0) {
      current = [...coords];
      continue;
    }

    const currentStartKey = getCoordinateKey(current[0]);
    const currentEndKey = getCoordinateKey(current[current.length - 1]);

    const appendCandidate = reverseIfNeeded(coords, currentEndKey, true);
    if (appendCandidate) {
      current = current.concat(appendCandidate.slice(1));
      continue;
    }

    const prependCandidate = reverseIfNeeded(coords, currentStartKey, false);
    if (prependCandidate) {
      current = prependCandidate.slice(0, -1).concat(current);
      continue;
    }

    lines.push(current);
    current = [...coords];
  }

  if (current.length > 1) lines.push(current);
  return lines;
}

function mergeContiguousWays(wayCoordinateSets) {
  if (wayCoordinateSets.length <= 1) return wayCoordinateSets;

  const unused = new Set(wayCoordinateSets.map((_, index) => index));
  const merged = [];

  while (unused.size > 0) {
    const seedIndex = unused.values().next().value;
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

function normalizeOperator(value) {
  if (!value) return "";
  if (value.includes("Washington State Ferries")) return "Washington State Ferries";
  if (value.includes("King County")) return "King County Water Taxi";
  if (value.includes("Kitsap")) return "Kitsap Fast Ferries";
  if (value.includes("Victoria Clipper")) return "FRS Clipper";
  if (value.includes("Clipper Vacations")) return "FRS Clipper";
  if (value.includes("Pierce County")) return "Pierce County";
  return value;
}

function normalizeTerminalName(value) {
  if (!value) return "";
  return value
    .replaceAll("Fauntelroy", "Fauntleroy")
    .replaceAll("Orchange", "Port Orchard")
    .trim();
}

function getNormalizedAgency(tags = {}) {
  return normalizeOperator(
    String(tags.operator || tags.network || tags.name || "").trim(),
  );
}

const ALLOWED_SEATTLE_FERRY_AGENCIES = new Set([
  "Washington State Ferries",
  "King County Water Taxi",
  "Kitsap Fast Ferries",
  "Pierce County",
  "FRS Clipper",
]);

function shouldIncludeRelation(relation) {
  const agency = getNormalizedAgency(relation.tags || {});
  return ALLOWED_SEATTLE_FERRY_AGENCIES.has(agency);
}

function buildRouteShortName(tags) {
  const from = normalizeTerminalName(String(tags.from || "").trim());
  const to = normalizeTerminalName(String(tags.to || "").trim());
  if (from && to) return `${from} → ${to}`;
  return normalizeTerminalName(
    String(tags.name || tags.network || tags.operator || "Ferry route").trim(),
  );
}

function countGeometryPoints(feature) {
  return (feature.geometry?.coordinates || []).reduce(
    (sum, line) => sum + (Array.isArray(line) ? line.length : 0),
    0,
  );
}

function getGeometryFingerprint(feature) {
  const pointKeys = Array.from(
    new Set(
      (feature.geometry?.coordinates || [])
        .flat()
        .map((coord) => getCoordinateKey(coord)),
    ),
  ).sort();
  return pointKeys.join("|");
}

function buildBidirectionalLabel(fromTerminal, toTerminal) {
  if (fromTerminal && toTerminal) return `${fromTerminal} ↔ ${toTerminal}`;
  return fromTerminal || toTerminal || "Ferry route";
}

function buildFeature(relation) {
  const orderedMembers = (relation.members || []).filter(isTrackMember);
  const stitched = stitchOrderedWayMembers(orderedMembers);
  const coordinates = mergeContiguousWays(stitched);
  if (!coordinates.length) return null;

  const operator = getNormalizedAgency(relation.tags || {});
  let routeName = normalizeTerminalName(
    String(
      relation.tags?.name || relation.tags?.network || operator || "Ferry route",
    ).trim(),
  );
  let fromTerminal = normalizeTerminalName(String(relation.tags?.from || "").trim());
  let toTerminal = normalizeTerminalName(String(relation.tags?.to || "").trim());

  if (relation.id === 2855411) {
    routeName = "Seattle ↔ Vashon";
    fromTerminal = "Seattle";
    toTerminal = "Vashon";
  }

  const routeShortName = buildRouteShortName({
    ...relation.tags,
    from: fromTerminal,
    to: toTerminal,
    name: routeName,
  });

  return {
    type: "Feature",
    properties: {
      route_id: `ferry-${relation.id}`,
      route_name: routeName,
      route_short_name: routeShortName,
      route_long_name: routeName,
      agency_name: operator || String(relation.tags?.network || "Ferry").trim(),
      network: String(relation.tags?.network || "").trim(),
      operator,
      from_terminal: fromTerminal,
      to_terminal: toTerminal,
      service_class: "ferry",
      overlay_category: "regional_ferry",
      osm_relation_id: relation.id,
    },
    geometry: {
      type: "MultiLineString",
      coordinates,
    },
  };
}

function mergeOppositeDirectionFeatures(features) {
  const groups = new Map();
  const passthrough = [];

  for (const feature of features) {
    const props = feature.properties || {};
    const fromTerminal = String(props.from_terminal || "").trim();
    const toTerminal = String(props.to_terminal || "").trim();
    const agencyName = String(props.agency_name || "").trim();
    const network = String(props.network || "").trim();

    if (!fromTerminal || !toTerminal || fromTerminal === toTerminal) {
      passthrough.push(feature);
      continue;
    }

    const endpointKey = [fromTerminal, toTerminal].sort().join("||");
    const groupKey = `${agencyName}||${network}||${endpointKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(feature);
  }

  const merged = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    const representative = [...group].sort(
      (a, b) => countGeometryPoints(b) - countGeometryPoints(a),
    )[0];
    const props = representative.properties || {};
    const fromTerminal = String(props.from_terminal || "").trim();
    const toTerminal = String(props.to_terminal || "").trim();
    const allTerminals = Array.from(
      new Set(
        group.flatMap((feature) => {
          const featureProps = feature.properties || {};
          return [
            String(featureProps.from_terminal || "").trim(),
            String(featureProps.to_terminal || "").trim(),
          ].filter(Boolean);
        }),
      ),
    ).sort();
    const allRelationIds = group.flatMap((feature) =>
      Array.isArray(feature.properties?.osm_relation_id)
        ? feature.properties.osm_relation_id
        : [feature.properties?.osm_relation_id].filter(Boolean),
    );
    const allLongNames = Array.from(
      new Set(
        group
          .map((feature) => String(feature.properties?.route_long_name || "").trim())
          .filter(Boolean),
      ),
    );

    merged.push({
      ...representative,
      properties: {
        ...props,
        route_id: group.map((feature) => feature.properties?.route_id).join("+"),
        route_short_name:
          allTerminals.length === 2
            ? buildBidirectionalLabel(allTerminals[0], allTerminals[1])
            : buildBidirectionalLabel(fromTerminal, toTerminal),
        route_name:
          allLongNames.length === 1
            ? allLongNames[0]
            : buildBidirectionalLabel(
                allTerminals[0] || fromTerminal,
                allTerminals[1] || toTerminal,
              ),
        route_long_name: allLongNames.join(" / "),
        osm_relation_id: allRelationIds,
      },
    });
  }

  return [...passthrough, ...merged];
}

function dedupeIdenticalGeometryFeatures(features) {
  const groups = new Map();

  for (const feature of features) {
    const props = feature.properties || {};
    const key = [
      String(props.agency_name || "").trim(),
      String(props.route_short_name || "").trim(),
      getGeometryFingerprint(feature),
    ].join("||");

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }

  const deduped = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }

    const representative = [...group].sort(
      (a, b) => countGeometryPoints(b) - countGeometryPoints(a),
    )[0];
    const allRelationIds = group.flatMap((feature) =>
      Array.isArray(feature.properties?.osm_relation_id)
        ? feature.properties.osm_relation_id
        : [feature.properties?.osm_relation_id].filter(Boolean),
    );
    const allLongNames = Array.from(
      new Set(
        group
          .map((feature) => String(feature.properties?.route_long_name || "").trim())
          .filter(Boolean),
      ),
    );

    deduped.push({
      ...representative,
      properties: {
        ...representative.properties,
        route_id: group.map((feature) => feature.properties?.route_id).join("+"),
        route_long_name: allLongNames.join(" / "),
        osm_relation_id: allRelationIds,
      },
    });
  }

  return deduped;
}

async function main() {
  const [south, west, north, east] = BBOX;
  const query = `
[out:json][timeout:120];
(
  relation["type"="route"]["route"="ferry"](${south},${west},${north},${east});
);
(._;>>;);
out body geom;
`;

  console.log("Fetching Seattle region ferry routes from OSM...");
  const data = await fetchOverpass(query);
  const relations = data.elements.filter(
    (el) => el.type === "relation" && shouldIncludeRelation(el),
  );
  const rawFeatures = relations.map(buildFeature).filter(Boolean);
  const mergedFeatures = mergeOppositeDirectionFeatures(rawFeatures);
  const features = dedupeIdenticalGeometryFeatures(mergedFeatures);
  const featureCollection = {
    type: "FeatureCollection",
    features,
  };

  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(featureCollection, null, 2)}\n`);
  console.log(`Wrote ${features.length} ferry routes to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
