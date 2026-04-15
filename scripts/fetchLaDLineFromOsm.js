#!/usr/bin/env node

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
  "laDLineOsm.json",
);

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Bounding box around the D Line corridor from downtown to Westwood/VA.
// We fetch the D Line relation and then resolve its member ways so we pick up
// ALL track segments (many individual ways lack the route name tag).
const QUERY = `[out:json][timeout:120];
(
  way["railway"="subway"]["network"~"LACMTA|Los Angeles Metro|Metro"]["name"~"Metro D Line|Purple Line Extension",i](33.95,-118.55,34.10,-118.20);
  way["railway"="construction"]["construction"="subway"]["network"~"LACMTA|Los Angeles Metro|Metro"](33.95,-118.55,34.10,-118.20);
  relation["type"="route"]["route"="subway"]["ref"="D"](33.95,-118.55,34.10,-118.20);
  way(r);
);
out body;
>;
out skel qt;`;

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
              new Error(`Overpass failed at ${url}: ${res.statusCode}`),
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(
              new Error(
                `Overpass JSON parse failed at ${url}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
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
      console.log(`Trying Overpass: ${url}`);
      return await postOverpass(url, query);
    } catch (err) {
      lastError = err;
      console.warn(
        `Overpass attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw lastError || new Error("All Overpass endpoints failed");
}

function isDLineWay(tags) {
  const name = String(tags?.name || "").toLowerCase();
  return (
    name.includes("metro d line") ||
    name.includes("purple line extension") ||
    String(tags?.ref || "") === "D"
  );
}

/** Collect way IDs that are members of any D Line relation. */
function getRelationMemberWayIds(elements) {
  const ids = new Set();
  for (const el of elements) {
    if (el.type !== "relation") continue;
    for (const m of el.members || []) {
      if (m.type === "way") ids.add(m.ref);
    }
  }
  return ids;
}

function makeDirectionFromPreferred(tags) {
  const preferred = String(tags?.["railway:preferred_direction"] || "");
  if (preferred === "backward") {
    return { direction_id: "1", direction: "inbound" };
  }
  return { direction_id: "0", direction: "outbound" };
}

function isTrackWay(tags) {
  const railway = String(tags?.railway || "");
  // Keep subway tracks and tracks under construction — exclude platforms etc.
  return (
    railway === "subway" ||
    railway === "construction" ||
    railway === "rail"
  );
}

function wayToFeature(way, nodeMap) {
  const coords = (way.nodes || []).map((id) => nodeMap.get(id)).filter(Boolean);
  if (coords.length < 2) return null;

  const tags = way.tags || {};
  if (!isTrackWay(tags)) return null;

  const underConstruction =
    tags.railway === "construction" || tags.construction === "subway";

  const { direction_id, direction } = makeDirectionFromPreferred(tags);

  return {
    type: "Feature",
    properties: {
      shape_id: `805OSM_${way.id}`,
      route_id: "805",
      route_name: "D Line (Purple)",
      route_color: "#A05DA5",
      direction_id,
      direction,
      headsign: "",
      under_construction: underConstruction,
      source: "OpenStreetMap/OpenRailwayMap",
      osm_way_id: way.id,
      osm_name: tags.name || null,
      osm_railway: tags.railway || null,
      osm_construction: tags.construction || null,
    },
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
  };
}

async function main() {
  console.log("Fetching full LA D Line from OSM/Overpass...");
  const overpass = await fetchOverpassWithFallback(QUERY);

  const nodes = new Map(
    overpass.elements
      .filter((el) => el.type === "node")
      .map((node) => [node.id, [node.lon, node.lat]]),
  );

  const ways = overpass.elements.filter((el) => el.type === "way");
  const relationMemberIds = getRelationMemberWayIds(overpass.elements);

  const features = ways
    .filter((way) => isDLineWay(way.tags || {}) || relationMemberIds.has(way.id))
    .map((way) => wayToFeature(way, nodes))
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const feature of features) {
    const key = `${feature.properties.osm_way_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(feature);
  }

  const fc = {
    type: "FeatureCollection",
    features: deduped,
  };

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(fc, null, 2)}\n`);

  const constructionCount = deduped.filter(
    (f) => f.properties.under_construction,
  ).length;

  console.log(`Wrote ${deduped.length} D Line features:`);
  console.log(
    `  ${deduped.length - constructionCount} solid + ${constructionCount} dashed`,
  );
  console.log(`Output: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
