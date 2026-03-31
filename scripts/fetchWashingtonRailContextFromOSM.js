#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const BBOX = [38.6, -77.7, 39.4, -76.6];

const OUTPUT_HEAVY = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "rail-context",
  "washingtonRailContextHeavy.json",
);

const OUTPUT_COMMUTER = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "rail-context",
  "washingtonRailContextCommuter.json",
);

const QUERY = `
[out:json][timeout:180];
(
  relation["type"="route"]["route"="subway"](${BBOX.join(",")});
  relation["type"="route"]["route"="train"](${BBOX.join(",")});
);
(._;>>;);
out body geom;
`;

const WMATA_LINE_INFO = {
  B: { shortName: "Blue", longName: "Blue Line", color: "#009CDE" },
  G: { shortName: "Green", longName: "Green Line", color: "#00B140" },
  O: { shortName: "Orange", longName: "Orange Line", color: "#F8A700" },
  R: { shortName: "Red", longName: "Red Line", color: "#BF0D3E" },
  S: { shortName: "Silver", longName: "Silver Line", color: "#919D9D" },
  Y: { shortName: "Yellow", longName: "Yellow Line", color: "#FFD100" },
};

const COMMUTER_LINE_INFO = {
  "MARC|Brunswick": {
    agency: "Maryland Transit Administration",
    shortName: "MARC",
    longName: "MARC Brunswick Line",
  },
  "MARC|Camden": {
    agency: "Maryland Transit Administration",
    shortName: "MARC",
    longName: "MARC Camden Line",
  },
  "MARC|Penn": {
    agency: "Maryland Transit Administration",
    shortName: "MARC",
    longName: "MARC Penn Line",
  },
  "VRE|Fredericksburg": {
    agency: "Virginia Railway Express",
    shortName: "VRE",
    longName: "VRE Fredericksburg Line",
  },
  "VRE|Manassas": {
    agency: "Virginia Railway Express",
    shortName: "VRE",
    longName: "VRE Manassas Line",
  },
};

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

function normalizeWayGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .map((point) => {
      if (
        point &&
        typeof point === "object" &&
        typeof point.lon === "number" &&
        typeof point.lat === "number"
      ) {
        return [point.lon, point.lat];
      }
      if (Array.isArray(point) && point.length >= 2) {
        return [point[0], point[1]];
      }
      return null;
    })
    .filter(Boolean);
}

function samePoint(a, b, toleranceMeters = 18) {
  if (!a || !b) return false;
  return haversineDistance(a[1], a[0], b[1], b[0]) <= toleranceMeters;
}

function appendCoordinates(target, coords) {
  if (!coords.length) return;
  if (!target.length) {
    target.push(...coords);
    return;
  }
  if (samePoint(target[target.length - 1], coords[0])) {
    target.push(...coords.slice(1));
    return;
  }
  target.push(...coords);
}

function stitchWayMembers(wayMembers) {
  const lines = [];
  let current = [];

  for (const member of wayMembers) {
    const coords = normalizeWayGeometry(member.geometry);
    if (coords.length < 2) continue;

    if (!current.length) {
      current = [...coords];
      continue;
    }

    const currentStart = current[0];
    const currentEnd = current[current.length - 1];
    const nextStart = coords[0];
    const nextEnd = coords[coords.length - 1];

    if (samePoint(currentEnd, nextStart)) {
      appendCoordinates(current, coords);
      continue;
    }
    if (samePoint(currentEnd, nextEnd)) {
      appendCoordinates(current, [...coords].reverse());
      continue;
    }
    if (samePoint(currentStart, nextEnd)) {
      current = [...coords, ...current.slice(1)];
      continue;
    }
    if (samePoint(currentStart, nextStart)) {
      current = [...coords].reverse().concat(current.slice(1));
      continue;
    }

    lines.push(current);
    current = [...coords];
  }

  if (current.length) lines.push(current);
  return lines.filter((line) => line.length >= 2);
}

function lineLength(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    total += haversineDistance(
      coords[i][1],
      coords[i][0],
      coords[i + 1][1],
      coords[i + 1][0],
    );
  }
  return total;
}

function pointToLineDist(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) /
        lenSq,
    ),
  );
  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  return Math.hypot(point[0] - projX, point[1] - projY);
}

function simplifyLine(coords, epsilon = 0.00008) {
  if (coords.length <= 2) return coords;

  let maxDist = 0;
  let maxIdx = 0;
  const start = coords[0];
  const end = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i += 1) {
    const dist = pointToLineDist(coords[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyLine(coords.slice(0, maxIdx + 1), epsilon);
    const right = simplifyLine(coords.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function normalizeColor(color) {
  if (!color) return null;
  return color.startsWith("#") ? color : `#${color}`;
}

function isTrackWayMember(member, waysById) {
  if (member.type !== "way" || !waysById.has(member.ref)) return false;
  const role = String(member.role || "").toLowerCase();
  return !(
    role.includes("platform") ||
    role.includes("stop") ||
    role.includes("station")
  );
}

function isWashingtonMetro(tags) {
  const network = String(tags.network || "").toLowerCase();
  const operator = String(tags.operator || "").toLowerCase();
  return (
    tags.route === "subway" &&
    (network.includes("washington metro") ||
      network.includes("wmata") ||
      operator.includes("washington metropolitan area transit authority"))
  );
}

function getCommuterSystem(tags) {
  const network = String(tags.network || "").toLowerCase();
  const operator = String(tags.operator || "").toLowerCase();
  const name = String(tags.name || "").toLowerCase();

  if (
    network.includes("marc") ||
    operator.includes("maryland transit administration")
  ) {
    return "MARC";
  }
  if (
    network.includes("virginia railway express") ||
    network.includes("vre") ||
    operator.includes("keolis") ||
    name.includes("vre ")
  ) {
    return "VRE";
  }
  return null;
}

function isIncludedCommuter(tags) {
  if (tags.route !== "train") return false;
  const haystack = `${tags.network || ""} ${tags.operator || ""} ${tags.name || ""}`.toLowerCase();
  if (haystack.includes("amtrak")) return false;
  return Boolean(getCommuterSystem(tags));
}

function relationGroupKey(tags) {
  if (isWashingtonMetro(tags)) {
    return `heavy:${String(tags.ref || "").toUpperCase()}`;
  }

  const system = getCommuterSystem(tags);
  if (!system) return null;
  let ref = String(tags.ref || "").trim();
  if (system === "MARC" && ref === "M") {
    ref = "Penn";
  }
  return `commuter:${system}:${ref}`;
}

function buildProperties(groupKey, seedTags) {
  if (groupKey.startsWith("heavy:")) {
    const ref = groupKey.split(":")[1];
    const line = WMATA_LINE_INFO[ref] || {
      shortName: ref,
      longName: seedTags.name || `WMATA ${ref}`,
      color: normalizeColor(seedTags.colour || seedTags.color),
    };

    return {
      route_id: ref,
      route_short_name: line.shortName,
      route_long_name: line.longName,
      agency_name: "Washington Metropolitan Area Transit Authority",
      service_class: "heavy",
      route_name: `WMATA ${line.longName}`,
      route_color: normalizeColor(seedTags.colour || seedTags.color) || line.color,
    };
  }

  const [, system, ref] = groupKey.split(":");
  const info = COMMUTER_LINE_INFO[`${system}|${ref}`] || {
    agency: system === "MARC" ? "Maryland Transit Administration" : "Virginia Railway Express",
    shortName: system,
    longName: `${system} ${ref} Line`,
  };

  return {
    route_id: `${system}-${ref}`,
    route_short_name: info.shortName,
    route_long_name: info.longName,
    agency_name: info.agency,
    service_class: "commuter",
    route_name: info.longName,
  };
}

async function fetchOverpassJson() {
  let lastError = null;

  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body: QUERY.trim(),
      });

      if (!response.ok) {
        lastError = new Error(
          `Overpass request failed at ${url}: ${response.status} ${response.statusText}`,
        );
        continue;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Overpass request failed");
}

function buildCollections(overpass) {
  const relations = overpass.elements.filter((el) => el.type === "relation");
  const waysById = new Map(
    overpass.elements
      .filter((el) => el.type === "way" && Array.isArray(el.geometry))
      .map((way) => [way.id, way]),
  );

  const grouped = new Map();

  for (const relation of relations) {
    const tags = relation.tags || {};
    const groupKey = relationGroupKey(tags);
    if (!groupKey) continue;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        key: groupKey,
        tags,
        seenWayIds: new Set(),
        ways: [],
      });
    }

    const group = grouped.get(groupKey);
    for (const member of relation.members || []) {
      if (!isTrackWayMember(member, waysById)) continue;
      if (group.seenWayIds.has(member.ref)) continue;
      group.seenWayIds.add(member.ref);
      group.ways.push(waysById.get(member.ref));
    }
  }

  const heavyFeatures = [];
  const commuterFeatures = [];

  for (const group of grouped.values()) {
    const stitched = stitchWayMembers(group.ways)
      .map((line) => simplifyLine(line))
      .filter((line) => lineLength(line) >= 500);

    if (!stitched.length) continue;

    const properties = buildProperties(group.key, group.tags);
    const feature = {
      type: "Feature",
      properties,
      geometry: {
        type: stitched.length === 1 ? "LineString" : "MultiLineString",
        coordinates: stitched.length === 1 ? stitched[0] : stitched,
      },
    };

    if (properties.service_class === "heavy") {
      heavyFeatures.push(feature);
    } else {
      commuterFeatures.push(feature);
    }
  }

  heavyFeatures.sort((a, b) =>
    String(a.properties.route_id).localeCompare(String(b.properties.route_id)),
  );
  commuterFeatures.sort((a, b) =>
    String(a.properties.route_id).localeCompare(String(b.properties.route_id)),
  );

  return {
    heavy: { type: "FeatureCollection", features: heavyFeatures },
    commuter: { type: "FeatureCollection", features: commuterFeatures },
  };
}

async function main() {
  console.log("Fetching Washington rail context from OpenStreetMap...");
  const overpass = await fetchOverpassJson();
  const { heavy, commuter } = buildCollections(overpass);

  if (!heavy.features.length && !commuter.features.length) {
    throw new Error("No Washington heavy/commuter rail context features were assembled.");
  }

  await fs.writeFile(OUTPUT_HEAVY, `${JSON.stringify(heavy, null, 2)}\n`);
  await fs.writeFile(OUTPUT_COMMUTER, `${JSON.stringify(commuter, null, 2)}\n`);

  console.log(
    `Wrote ${heavy.features.length} heavy feature(s) to ${OUTPUT_HEAVY}`,
  );
  console.log(
    `Wrote ${commuter.features.length} commuter feature(s) to ${OUTPUT_COMMUTER}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
