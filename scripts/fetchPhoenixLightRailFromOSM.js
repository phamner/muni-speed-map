#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

const OUTPUT_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "routes",
  "phoenixLightRailRoutes.json",
);

const QUERY = `
[out:json][timeout:180];
(
  relation["route"="light_rail"]["operator"~"Valley Metro",i](32.9,-112.4,33.8,-111.6);
);
out body;
>;
out geom;
`;

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
      if (Array.isArray(point) && point.length >= 2) {
        return [point[0], point[1]];
      }
      if (
        point &&
        typeof point === "object" &&
        typeof point.lon === "number" &&
        typeof point.lat === "number"
      ) {
        return [point.lon, point.lat];
      }
      return null;
    })
    .filter(Boolean);
}

function samePoint(a, b, toleranceMeters = 12) {
  if (!a || !b) return false;
  return haversineDistance(a[1], a[0], b[1], b[0]) <= toleranceMeters;
}

function appendCoordinates(target, coords) {
  if (!coords.length) return;
  if (!target.length) {
    target.push(...coords);
    return;
  }
  const first = coords[0];
  const lastTarget = target[target.length - 1];
  if (samePoint(lastTarget, first)) {
    target.push(...coords.slice(1));
  } else {
    target.push(...coords);
  }
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

  if (current.length) {
    lines.push(current);
  }

  return lines.filter((line) => line.length >= 2);
}

function lineLength(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineDistance(
      coords[i][1],
      coords[i][0],
      coords[i + 1][1],
      coords[i + 1][0],
    );
  }
  return total;
}

function chooseRouteColor(tags) {
  const color = tags.colour || tags.color || "#448BCD";
  return color.startsWith("#") ? color : `#${color}`;
}

function chooseRouteId(tags) {
  return String(tags.ref || "A");
}

function buildFeatures(overpass) {
  const relations = overpass.elements.filter((el) => el.type === "relation");
  const waysById = new Map(
    overpass.elements
      .filter((el) => el.type === "way" && Array.isArray(el.geometry))
      .map((way) => [way.id, way]),
  );

  const features = [];

  for (const relation of relations) {
    const tags = relation.tags || {};
    if (
      !/valley metro/i.test(tags.operator || "") &&
      !/valley metro/i.test(tags.network || "")
    ) {
      continue;
    }

    const railWayMembers = (relation.members || [])
      .filter((member) => {
        if (member.type !== "way") return false;
        const role = String(member.role || "").toLowerCase();
        if (
          role.includes("platform") ||
          role.includes("stop") ||
          role.includes("station")
        ) {
          return false;
        }
        return waysById.has(member.ref);
      })
      .map((member) => waysById.get(member.ref))
      .filter(Boolean);

    const stitched = stitchWayMembers(railWayMembers);
    if (!stitched.length) continue;

    const ref = String(tags.ref || "").toUpperCase();
    const routeName = String(tags.name || "Valley Metro Rail");
    if (!["A", "B"].includes(ref) || !/light rail/i.test(routeName)) {
      continue;
    }

    stitched.sort((a, b) => lineLength(b) - lineLength(a));

    features.push({
      type: "Feature",
      properties: {
        route_id: chooseRouteId(tags),
        route_name: routeName,
        route_color: chooseRouteColor(tags),
        osm_relation_id: relation.id,
      },
      geometry: {
        type: stitched.length === 1 ? "LineString" : "MultiLineString",
        coordinates: stitched.length === 1 ? stitched[0] : stitched,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
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

async function main() {
  const overpass = await fetchOverpassJson();
  const featureCollection = buildFeatures(overpass);

  if (!featureCollection.features.length) {
    const relationSummary = overpass.elements
      .filter((el) => el.type === "relation")
      .map((el) => ({
        id: el.id,
        name: el.tags?.name,
        ref: el.tags?.ref,
        operator: el.tags?.operator,
        network: el.tags?.network,
        memberCount: el.members?.length || 0,
      }));
    throw new Error(
      `No Phoenix light rail features assembled from Overpass response. Relations: ${JSON.stringify(relationSummary)}`,
    );
  }

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(featureCollection, null, 2)}\n`);

  console.log(
    `Wrote ${featureCollection.features.length} Phoenix light rail feature(s) to ${OUTPUT_FILE}`,
  );
  for (const feature of featureCollection.features) {
    const geometryType = feature.geometry.type;
    const partCount =
      geometryType === "MultiLineString"
        ? feature.geometry.coordinates.length
        : 1;
    console.log(
      `- ${feature.properties.route_name} (${feature.properties.route_id}) ${feature.properties.route_color} [${geometryType}, ${partCount} part(s)]`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
