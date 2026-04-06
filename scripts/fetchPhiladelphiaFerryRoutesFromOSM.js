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
  "phillyFerryRoutesOverlay.json",
);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const BBOX = [39.7, -75.4, 40.25, -74.8];
const INCLUDED_WAY_IDS = new Set([30104246]);

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
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        console.warn(
          `Overpass Philadelphia ferry fetch failed via ${endpoint} (attempt ${attempt}/2): ${error.message}`,
        );
        if (attempt < 2) await delay(1000);
      }
    }
  }

  throw lastError || new Error("Overpass Philadelphia ferry fetch failed");
}

function normalizeTerminalName(value) {
  if (!value) return "";
  return value
    .replace(/^Penn's Landing$/i, "Penn's Landing")
    .replace(/^Camden$/i, "Camden")
    .trim();
}

function normalizeOperator(tags = {}) {
  const altName = String(tags.alt_name || "").trim();
  if (altName.includes("RiverLink Ferry")) return "RiverLink Ferry";
  const name = String(tags.name || "").trim();
  if (name.includes("Penn’s Landing")) return "RiverLink Ferry";
  return String(tags.operator || tags.network || altName || name || "Ferry").trim();
}

function buildBidirectionalLabel(fromTerminal, toTerminal) {
  if (fromTerminal && toTerminal) return `${fromTerminal} ↔ ${toTerminal}`;
  return fromTerminal || toTerminal || "Ferry route";
}

function buildWayFeature(way) {
  if (!INCLUDED_WAY_IDS.has(way.id)) return null;
  const coords = (way.geometry || []).map((pt) => [pt.lon, pt.lat]);
  if (coords.length < 2) return null;

  const fromTerminal = normalizeTerminalName(String(way.tags?.from || "").trim());
  const toTerminal = normalizeTerminalName(String(way.tags?.to || "").trim());
  const agencyName = normalizeOperator(way.tags || {});

  return {
    type: "Feature",
    properties: {
      route_id: `ferry-way-${way.id}`,
      route_name: buildBidirectionalLabel(fromTerminal, toTerminal),
      route_short_name: buildBidirectionalLabel(fromTerminal, toTerminal),
      route_long_name: `${agencyName}: ${fromTerminal} => ${toTerminal}`,
      agency_name: agencyName,
      network: agencyName,
      operator: agencyName,
      from_terminal: fromTerminal,
      to_terminal: toTerminal,
      service_class: "ferry",
      overlay_category: "regional_ferry",
      osm_way_id: way.id,
    },
    geometry: {
      type: "MultiLineString",
      coordinates: [coords],
    },
  };
}

async function main() {
  const [south, west, north, east] = BBOX;
  const query = `
[out:json][timeout:120];
(
  way["route"="ferry"](${south},${west},${north},${east});
);
out body geom;
`;

  console.log("Fetching Philadelphia ferry routes from OSM...");
  const data = await fetchOverpass(query);
  const ways = data.elements.filter((el) => el.type === "way");
  const features = ways.map(buildWayFeature).filter(Boolean);

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
  );
  console.log(
    `Wrote ${features.length} Philadelphia ferry routes to ${OUTPUT_FILE}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
