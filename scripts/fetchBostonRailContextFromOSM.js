#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const BBOX = [41.9, -71.8, 43.1, -69.8];
const OUTPUT_COMMUTER = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "rail-context",
  "bostonRailContextCommuter.json",
);

const QUERY = `
[out:json][timeout:180];
(
  relation["type"="route"]["route"="train"](${BBOX.join(",")});
);
(._;>>;);
out body geom;
`;

const MBTA_LINE_INFO = {
  "CR-Fairmount": "Fairmount Line",
  "CR-Fitchburg": "Fitchburg Line",
  "CR-Franklin": "Franklin/Foxboro Line",
  "CR-Greenbush": "Greenbush Line",
  "CR-Haverhill": "Haverhill Line",
  "CR-Kingston": "Kingston/Plymouth Line",
  "CR-Lowell": "Lowell Line",
  "CR-Needham": "Needham Line",
  "CR-Newburyport": "Newburyport/Rockport Line",
  "CR-Providence": "Providence/Stoughton Line",
  "CR-Worcester": "Framingham/Worcester Line",
  "CR-Middleborough": "Middleborough/Lakeville Line",
  "CR-Fall River/New Bedford": "Fall River/New Bedford Line",
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
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchOverpass(query) {
  let lastError = null;

  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Overpass failed via ${url}: ${error.message}`);
    }
  }

  throw lastError || new Error("All Overpass endpoints failed");
}

function normalizeWayGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .map((point) =>
      point &&
      typeof point.lon === "number" &&
      typeof point.lat === "number"
        ? [point.lon, point.lat]
        : null,
    )
    .filter(Boolean);
}

function samePoint(a, b, toleranceMeters = 18) {
  if (!a || !b) return false;
  return haversineDistance(a[1], a[0], b[1], b[0]) <= toleranceMeters;
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

function simplifyLine(coords, epsilon = 0.00003) {
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

function isTrackWayMember(member, waysById) {
  if (member.type !== "way" || !waysById.has(member.ref)) return false;
  const role = String(member.role || "").toLowerCase();
  return !(
    role.includes("platform") ||
    role.includes("stop") ||
    role.includes("station")
  );
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
      current.push(...coords.slice(1));
      continue;
    }
    if (samePoint(currentEnd, nextEnd)) {
      current.push(...[...coords].reverse().slice(1));
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

function canonicalLineKey(coords) {
  const forward = coords.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(";");
  const reverse = [...coords]
    .reverse()
    .map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`)
    .join(";");
  return forward < reverse ? forward : reverse;
}

function routeIdFromTags(tags = {}) {
  return String(tags["gtfs:route_id"] || tags.ref || "").trim() || null;
}

function isMbtaCommuterRelation(tags = {}) {
  const routeId = routeIdFromTags(tags);
  const network = String(tags.network || "").toLowerCase();
  const feed = String(tags["gtfs:feed"] || "").toLowerCase();
  const service = String(tags.service || "").toLowerCase();
  const passenger = String(tags.passenger || "").toLowerCase();
  return (
    tags.route === "train" &&
    (routeId.startsWith("CR-") ||
      network.includes("mbta") ||
      feed.includes("us-ma-mbta")) &&
    (service === "commuter" || passenger === "suburban")
  );
}

function lineNameFor(tags = {}) {
  const routeId = routeIdFromTags(tags);
  if (MBTA_LINE_INFO[routeId]) return MBTA_LINE_INFO[routeId];

  const name = String(tags.name || "");
  const match = name.match(/MBTA\s+(.+?)(?::|$)/i);
  if (match?.[1]) return match[1].replace(/\s*Line\s*$/i, "").trim() + " Line";

  return routeId;
}

function buildCollection(overpass) {
  const waysById = new Map(
    overpass.elements
      .filter((element) => element.type === "way")
      .map((element) => [element.id, element]),
  );

  const groups = new Map();
  for (const relation of overpass.elements.filter((el) => el.type === "relation")) {
    const tags = relation.tags || {};
    if (!isMbtaCommuterRelation(tags)) continue;

    const routeId = routeIdFromTags(tags);
    if (!routeId) continue;

    const wayMembers = (relation.members || []).filter((member) =>
      isTrackWayMember(member, waysById),
    );
    const stitched = stitchWayMembers(wayMembers);
    if (!stitched.length) continue;

    if (!groups.has(routeId)) {
      groups.set(routeId, {
        routeId,
        routeName: lineNameFor(tags),
        shortName: String(tags.ref || routeId).replace(/^CR-/, ""),
        lines: [],
      });
    }

    groups.get(routeId).lines.push(...stitched);
  }

  const features = [];
  for (const group of groups.values()) {
    const unique = new Map();
    for (const line of group.lines) {
      const simplified = simplifyLine(line);
      const key = canonicalLineKey(simplified);
      if (!unique.has(key)) unique.set(key, simplified);
    }

    features.push({
      type: "Feature",
      properties: {
        route_id: group.routeId,
        route_short_name: group.shortName || null,
        route_long_name: group.routeName,
        agency_name: "MBTA Commuter Rail",
        service_class: "commuter",
        route_name: group.routeName,
      },
      geometry: {
        type: "MultiLineString",
        coordinates: Array.from(unique.values()),
      },
    });
  }

  features.sort((a, b) =>
    String(a.properties.route_name).localeCompare(String(b.properties.route_name)),
  );

  return { type: "FeatureCollection", features };
}

async function main() {
  console.log("Fetching Boston commuter rail context from OpenStreetMap...");
  const overpass = await fetchOverpass(QUERY);
  const commuter = buildCollection(overpass);

  if (!commuter.features.length) {
    throw new Error("No Boston commuter rail context features were assembled.");
  }

  await fs.writeFile(OUTPUT_COMMUTER, `${JSON.stringify(commuter, null, 2)}\n`);
  console.log(
    `Wrote ${commuter.features.length} commuter feature(s) to ${OUTPUT_COMMUTER}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
