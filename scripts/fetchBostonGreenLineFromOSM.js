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

const BBOX = [42.28, -71.21, 42.43, -70.95];
const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "routes",
  "bostonGreenLineRoutes.json",
);

const QUERY = `
[out:json][timeout:180];
(
  relation["type"="route"]["route"="light_rail"]["network"="MBTA"]["gtfs:route_id"~"^Green-"](${BBOX.join(",")});
);
(._;>>;);
out body geom;
`;

const BRANCH_META = {
  "Green-B": { name: "Green Line B", letter: "B", color: "#00843D" },
  "Green-C": { name: "Green Line C", letter: "C", color: "#00843D" },
  "Green-D": { name: "Green Line D", letter: "D", color: "#00843D" },
  "Green-E": { name: "Green Line E", letter: "E", color: "#00843D" },
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

function simplifyLine(coords, epsilon = 0.000003) {
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

function getDirectionId(tags = {}) {
  const from = String(tags.from || "").toLowerCase();
  const to = String(tags.to || "").toLowerCase();
  const downtownTargets = ["government center", "union square", "heath street"];
  const outbound = downtownTargets.includes(to);
  const inbound = downtownTargets.includes(from);
  if (outbound && !inbound) return "0";
  if (inbound && !outbound) return "1";
  return "0";
}

function getDirectionLabel(directionId) {
  return directionId === "0" ? "outbound" : "inbound";
}

function buildCollection(overpass) {
  const waysById = new Map(
    overpass.elements
      .filter((element) => element.type === "way")
      .map((element) => [element.id, element]),
  );

  const features = [];
  for (const relation of overpass.elements.filter((el) => el.type === "relation")) {
    const tags = relation.tags || {};
    const routeId = String(tags["gtfs:route_id"] || "").trim();
    if (!BRANCH_META[routeId]) continue;

    const wayMembers = (relation.members || []).filter((member) =>
      isTrackWayMember(member, waysById),
    );
    const stitched = stitchWayMembers(wayMembers);
    if (!stitched.length) continue;

    const unique = new Map();
    for (const line of stitched) {
      const simplified = simplifyLine(line);
      const key = canonicalLineKey(simplified);
      if (!unique.has(key)) unique.set(key, simplified);
    }

    const directionId = getDirectionId(tags);
    const meta = BRANCH_META[routeId];
    const to = String(tags.to || "").trim();

    features.push({
      type: "Feature",
      properties: {
        route_id: routeId,
        route_name: meta.name,
        route_color: meta.color,
        route_letter: meta.letter,
        direction_id: directionId,
        direction: getDirectionLabel(directionId),
        headsign: to || null,
        osm_relation_id: relation.id,
      },
      geometry: {
        type: "MultiLineString",
        coordinates: Array.from(unique.values()),
      },
    });
  }

  features.sort((a, b) => {
    const routeCompare = String(a.properties.route_id).localeCompare(
      String(b.properties.route_id),
    );
    if (routeCompare !== 0) return routeCompare;
    return String(a.properties.direction_id).localeCompare(
      String(b.properties.direction_id),
    );
  });

  return { type: "FeatureCollection", features };
}

async function main() {
  console.log("Fetching Boston Green Line routes from OpenStreetMap...");
  const overpass = await fetchOverpass(QUERY);
  const routes = buildCollection(overpass);

  if (!routes.features.length) {
    throw new Error("No Boston Green Line route features were assembled.");
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(routes, null, 2)}\n`);
  console.log(`Wrote ${routes.features.length} feature(s) to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
