#!/usr/bin/env node

/**
 * Fetch the LA Metro B Line (subway, route 802) from OpenRailwayMap / Overpass
 * at the highest available resolution (every OSM node in every way).
 *
 * Usage:
 *   node scripts/fetchLaBLineHighResFromOrm.js
 *
 * Output:
 *   src/data/routes/laBLineOsm.json
 */

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "routes",
  "laBLineOsm.json",
);

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Full-resolution query: grab the B Line relation, resolve all member ways,
// then recurse to every node.  `out geom` gives coordinates inline on ways,
// but using `>; out skel qt;` ensures we get raw node lat/lon at full
// precision (7 decimal places ≈ ~1 cm accuracy — the best OSM stores).
const QUERY = `[out:json][timeout:120];
(
  relation["type"="route"]["route"="subway"]["ref"="B"]["network"~"LACMTA|Los Angeles Metro|Metro"](33.90,-118.50,34.25,-118.15);
  way(r)["railway"~"^(subway|construction)$"];
);
out body;
>;
out skel qt;`;

// ── Overpass helpers ────────────────────────────────────────────────────

function postOverpass(url, query) {
  const postData = `data=${encodeURIComponent(query)}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
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
          if (res.statusCode !== 200) {
            return reject(
              new Error(`Overpass ${url} returned ${res.statusCode}`),
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`JSON parse error from ${url}: ${err.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function fetchOverpassWithFallback(query) {
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    try {
      console.log(`Trying Overpass endpoint: ${url}`);
      const result = await postOverpass(url, query);
      console.log(`Success from ${url}`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`  Failed: ${err.message}`);
    }
  }
  throw lastError || new Error("All Overpass endpoints failed");
}

// ── OSM element processors ─────────────────────────────────────────────

/** Collect way IDs that are members of any B Line route relation. */
function getRelationMemberWayIds(elements) {
  const ids = new Set();
  for (const el of elements) {
    if (el.type !== "relation") continue;
    for (const m of el.members || []) {
      if (m.type === "way" && m.role !== "stop" && m.role !== "platform") {
        ids.add(m.ref);
      }
    }
  }
  return ids;
}

function directionFromPreferred(tags) {
  const pref = String(tags?.["railway:preferred_direction"] || "");
  if (pref === "backward") return { direction_id: "1", direction: "inbound" };
  return { direction_id: "0", direction: "outbound" };
}

function wayToFeature(way, nodeMap) {
  const coords = (way.nodes || [])
    .map((id) => nodeMap.get(id))
    .filter(Boolean);
  if (coords.length < 2) return null;

  const tags = way.tags || {};
  const railway = String(tags.railway || "");
  if (railway !== "subway" && railway !== "construction") return null;

  const underConstruction =
    railway === "construction" || tags.construction === "subway";

  const { direction_id, direction } = directionFromPreferred(tags);

  return {
    type: "Feature",
    properties: {
      shape_id: `802OSM_${way.id}`,
      route_id: "802",
      route_name: "B Line (Red)",
      route_color: "#E4002B",
      direction_id,
      direction,
      headsign: "",
      under_construction: underConstruction,
      source: "OpenStreetMap/OpenRailwayMap",
      osm_way_id: way.id,
      osm_name: tags.name || null,
      osm_railway: railway,
      osm_construction: tags.construction || null,
    },
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching LA Metro B Line from OpenRailwayMap (Overpass)...\n");
  const overpass = await fetchOverpassWithFallback(QUERY);

  // Build node lookup: id → [lon, lat] (full 7-decimal precision)
  const nodeMap = new Map();
  for (const el of overpass.elements) {
    if (el.type === "node") {
      nodeMap.set(el.id, [el.lon, el.lat]);
    }
  }
  console.log(`  Nodes resolved: ${nodeMap.size}`);

  const ways = overpass.elements.filter((el) => el.type === "way");
  const relationMemberIds = getRelationMemberWayIds(overpass.elements);
  console.log(`  Ways from Overpass: ${ways.length}`);
  console.log(`  Ways in B Line relation: ${relationMemberIds.size}`);

  // Only keep ways that are members of the B Line relation
  const features = ways
    .filter((way) => relationMemberIds.has(way.id))
    .map((way) => wayToFeature(way, nodeMap))
    .filter(Boolean);

  // Deduplicate by OSM way ID
  const deduped = [];
  const seen = new Set();
  for (const f of features) {
    const key = f.properties.osm_way_id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  const fc = {
    type: "FeatureCollection",
    features: deduped,
  };

  // Count totals for node points across all features
  const totalNodes = deduped.reduce(
    (sum, f) => sum + f.geometry.coordinates.length,
    0,
  );
  const constructionCount = deduped.filter(
    (f) => f.properties.under_construction,
  ).length;

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(fc, null, 2)}\n`);

  console.log(`\nWrote ${deduped.length} way segments (${totalNodes} total coordinate points):`);
  console.log(
    `  ${deduped.length - constructionCount} active + ${constructionCount} under construction`,
  );
  console.log(`Output: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
