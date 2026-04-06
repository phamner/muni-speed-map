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
  "baltimoreFerryRoutesOverlay.json",
);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const BBOX = [39.15, -76.75, 39.4, -76.45];
const INCLUDED_WAY_IDS = new Set([242900441, 242900443, 718616985]);

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
          `Overpass Baltimore ferry fetch failed via ${endpoint} (attempt ${attempt}/2): ${error.message}`,
        );
        if (attempt < 2) await delay(1000);
      }
    }
  }

  throw lastError || new Error("Overpass Baltimore ferry fetch failed");
}

function normalizeTerminalName(value) {
  if (!value) return "";
  return value
    .replace(/^Maritime Park$/i, "Maritime Park")
    .replace(/^Locust Point$/i, "Locust Point")
    .replace(/^Canton Park$/i, "Canton Waterfront Park")
    .replace(/^Federal Hill$/i, "Federal Hill")
    .replace(/^Pier 5$/i, "Pier 5")
    .trim();
}

function normalizeOperator(tags = {}) {
  const network = String(tags.network || "").trim();
  const operator = String(tags.operator || "").trim();
  if (network.includes("Harbor Connector")) return "Baltimore Harbor Connector";
  if (operator.includes("Baltimore City Department of Transportation")) {
    return "Baltimore Harbor Connector";
  }
  return network || operator || String(tags.name || "Ferry").trim();
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
  const routeRef = String(way.tags?.["ref:CCC"] || "").trim();
  const routeName = buildBidirectionalLabel(fromTerminal, toTerminal);

  return {
    type: "Feature",
    properties: {
      route_id: routeRef || `ferry-way-${way.id}`,
      route_name: routeName,
      route_short_name: routeRef || routeName,
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

  console.log("Fetching Baltimore ferry routes from OSM...");
  const data = await fetchOverpass(query);
  const ways = data.elements.filter((el) => el.type === "way");
  const features = ways.map(buildWayFeature).filter(Boolean);

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
  );
  console.log(`Wrote ${features.length} Baltimore ferry routes to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
