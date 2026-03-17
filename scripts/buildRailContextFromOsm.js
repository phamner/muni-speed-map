#!/usr/bin/env node
/**
 * Downloads heavy rail route shapes from OpenStreetMap via the Overpass API
 * and outputs a GeoJSON FeatureCollection for use as the heavy rail
 * context overlay.
 *
 * Usage: node scripts/buildRailContextFromOsm.js <profile>
 *   Profiles: bart, baltimore
 *
 * Example: node scripts/buildRailContextFromOsm.js bart
 */

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data", "rail-context");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const PROFILES = {
  bart: {
    query: `[out:json][timeout:120];
(
  way["railway"~"subway|light_rail"]["network"="BART"]["service"!~"yard|crossover|siding|spur"](36.5,-123.0,38.5,-121.0);
);
out body;>;out skel qt;`,
    properties: {
      route_id: "BART",
      route_short_name: "BART",
      route_long_name: "Bay Area Rapid Transit",
      agency_name: "Bay Area Rapid Transit",
      service_class: "heavy",
      route_name: "BART",
    },
    outputFiles: ["sfRailContextHeavy.json", "vtaRailContextHeavy.json"],
    consolidate: true,
  },
  baltimore: {
    query: `[out:json][timeout:120];
(way["railway"="subway"]["operator"="Maryland Transit Administration"](38.8,-77.0,39.6,-76.3););
out body;>;out skel qt;`,
    properties: {
      route_id: "MetroSubwayLink",
      route_short_name: "Metro",
      route_long_name: "Metro SubwayLink",
      agency_name: "Maryland Transit Administration",
      service_class: "heavy",
      route_name: "Metro SubwayLink",
    },
    outputFiles: ["baltimoreRailContextHeavy.json"],
    consolidate: true,
  },
};

function fetchOverpass(query) {
  const postData = `data=${encodeURIComponent(query)}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      OVERPASS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200)
            return reject(new Error(`Overpass error: ${res.statusCode}`));
          resolve(JSON.parse(body));
        });
      },
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function buildNodeLookup(elements) {
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === "node") {
      nodes.set(el.id, [el.lon, el.lat]);
    }
  }
  return nodes;
}

function waysToLineStrings(elements, nodeLookup) {
  const lines = [];
  for (const el of elements) {
    if (el.type !== "way") continue;
    const coords = [];
    for (const nid of el.nodes) {
      const pt = nodeLookup.get(nid);
      if (pt) coords.push(pt);
    }
    if (coords.length >= 2) {
      lines.push({ coords, tags: el.tags || {} });
    }
  }
  return lines;
}

function mergeLines(lines) {
  const coordKey = (c) => `${c[0].toFixed(7)},${c[1].toFixed(7)}`;
  const chains = lines.map((l) => [...l.coords]);
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length; i++) {
      if (!chains[i]) continue;
      for (let j = i + 1; j < chains.length; j++) {
        if (!chains[j]) continue;
        const aStart = coordKey(chains[i][0]);
        const aEnd = coordKey(chains[i][chains[i].length - 1]);
        const bStart = coordKey(chains[j][0]);
        const bEnd = coordKey(chains[j][chains[j].length - 1]);

        let combined = null;
        if (aEnd === bStart) {
          combined = [...chains[i], ...chains[j].slice(1)];
        } else if (aEnd === bEnd) {
          combined = [...chains[i], ...[...chains[j]].reverse().slice(1)];
        } else if (aStart === bEnd) {
          combined = [...chains[j], ...chains[i].slice(1)];
        } else if (aStart === bStart) {
          combined = [...[...chains[j]].reverse(), ...chains[i].slice(1)];
        }

        if (combined) {
          chains[i] = combined;
          chains[j] = null;
          merged = true;
        }
      }
    }
  }

  return chains.filter(Boolean);
}

function simplifyLine(coords, epsilon = 0.00005) {
  if (coords.length <= 2) return coords;

  let maxDist = 0;
  let maxIdx = 0;
  const start = coords[0];
  const end = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const d = pointToLineDist(coords[i], start, end);
    if (d > maxDist) {
      maxDist = d;
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

function pointToLineDist(pt, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = pt[0] - lineStart[0];
    const ey = pt[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pt[0] - lineStart[0]) * dx + (pt[1] - lineStart[1]) * dy) / lenSq,
    ),
  );
  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  const ex = pt[0] - projX;
  const ey = pt[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function lineLength(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx =
      (coords[i][0] - coords[i - 1][0]) *
      111000 *
      Math.cos((coords[i][1] * Math.PI) / 180);
    const dy = (coords[i][1] - coords[i - 1][1]) * 111000;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

async function main() {
  const profileName = process.argv[2];
  if (!profileName || !PROFILES[profileName]) {
    console.error(
      `Usage: node scripts/buildRailContextFromOsm.js <${Object.keys(PROFILES).join("|")}>`,
    );
    process.exit(1);
  }

  const profile = PROFILES[profileName];
  console.log(`[${profileName}] Fetching from Overpass API...`);
  const data = await fetchOverpass(profile.query);

  const nodeLookup = buildNodeLookup(data.elements);
  const lines = waysToLineStrings(data.elements, nodeLookup);
  console.log(`Got ${lines.length} way segments, ${nodeLookup.size} nodes`);

  const merged = mergeLines(lines);
  console.log(`Merged into ${merged.length} line(s)`);

  const MIN_LENGTH_M = profile.minLengthM || 500;
  const significantLines = merged.filter((c) => lineLength(c) >= MIN_LENGTH_M);
  console.log(
    `Filtered: ${merged.length} -> ${significantLines.length} (removed ${merged.length - significantLines.length} short segments)`,
  );

  const totalPtsBefore = significantLines.reduce((s, c) => s + c.length, 0);
  const simplified = significantLines.map((c) => simplifyLine(c));
  const totalPtsAfter = simplified.reduce((s, c) => s + c.length, 0);
  console.log(`Simplified: ${totalPtsBefore} -> ${totalPtsAfter} points`);

  let features;
  if (profile.consolidate) {
    features = [
      {
        type: "Feature",
        properties: { ...profile.properties },
        geometry: {
          type: "MultiLineString",
          coordinates: simplified,
        },
      },
    ];
    console.log(`Consolidated into 1 MultiLineString feature`);
  } else {
    features = simplified.map((coords) => ({
      type: "Feature",
      properties: { ...profile.properties },
      geometry: { type: "LineString", coordinates: coords },
    }));
  }

  const collection = { type: "FeatureCollection", features };

  const jsonStr = JSON.stringify(
    collection,
    (_, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v),
    2,
  );

  for (const filename of profile.outputFiles) {
    const outPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(outPath, jsonStr);
    console.log(`Wrote ${outPath} (${features.length} features)`);
  }

  console.log(
    `File size: ${(Buffer.byteLength(jsonStr) / 1024).toFixed(0)} KB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
