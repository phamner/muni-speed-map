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
  "washingtonFerryRoutesOverlay.json",
);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const BBOX = [38.7, -77.35, 39.2, -76.85];
const INCLUDED_WAY_IDS = new Set([
  718456190,
  718456191,
  718456193,
  718456203,
  718456204,
  718456208,
  718456209,
  718456215,
  1212921759,
]);

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
          `Overpass Washington DC ferry fetch failed via ${endpoint} (attempt ${attempt}/2): ${error.message}`,
        );
        if (attempt < 2) await delay(1000);
      }
    }
  }

  throw lastError || new Error("Overpass Washington DC ferry fetch failed");
}

function normalizeTerminalName(value) {
  if (!value) return "";
  return value
    .replace(/^Alexandria, VA$/i, "Alexandria")
    .replace(/^Georgetown, DC$/i, "Georgetown")
    .replace(/^The Wharf, DC$/i, "The Wharf")
    .replace(/^Diamond Teague, DC$/i, "Diamond Teague")
    .replace(/^National Harbor, MD$/i, "National Harbor")
    .replace(/^Gaylord National, MD$/i, "Gaylord National")
    .replace(/^Mt Vernon, VA$/i, "Mount Vernon")
    .replace(/^The Wharf$/i, "The Wharf")
    .replace(/^East Potomac$/i, "East Potomac")
    .replace(/\s*\(Seasonal\)\s*$/i, "")
    .trim();
}

function normalizeOperator(tags = {}) {
  const operator = String(tags.operator || "").trim();
  const name = String(tags.name || "").trim();
  if (operator.includes("Potomac Riverboat Company")) return "Potomac Water Taxi";
  if (name.includes("Wharf Jitney")) return "Wharf Jitney";
  return operator || name || "Ferry";
}

function parseStopsFromName(name) {
  const trimmed = String(name || "").trim();
  const withoutSeasonal = trimmed.replace(/\s*\(Seasonal\)\s*$/i, "").trim();
  return withoutSeasonal
    .split(" - ")
    .map((part) => normalizeTerminalName(part))
    .filter(Boolean);
}

function buildBidirectionalLabel(fromTerminal, toTerminal) {
  if (fromTerminal && toTerminal) return `${fromTerminal} ↔ ${toTerminal}`;
  return fromTerminal || toTerminal || "Ferry route";
}

function buildWayFeature(way) {
  if (!INCLUDED_WAY_IDS.has(way.id)) return null;
  const coords = (way.geometry || []).map((pt) => [pt.lon, pt.lat]);
  if (coords.length < 2) return null;

  const agencyName = normalizeOperator(way.tags || {});
  const explicitStops = [
    normalizeTerminalName(String(way.tags?.from || "").trim()),
    normalizeTerminalName(String(way.tags?.to || "").trim()),
  ].filter(Boolean);
  const stopSequence =
    explicitStops.length >= 2 ? explicitStops : parseStopsFromName(way.tags?.name || "");
  const distinctStopSequence = Array.from(new Set(stopSequence));

  return {
    type: "Feature",
    properties: {
      route_id: `ferry-way-${way.id}`,
      route_name:
        distinctStopSequence.length === 2
          ? buildBidirectionalLabel(distinctStopSequence[0], distinctStopSequence[1])
          : String(way.tags?.name || agencyName || "Ferry route").trim(),
      route_short_name:
        distinctStopSequence.length === 2
          ? buildBidirectionalLabel(distinctStopSequence[0], distinctStopSequence[1])
          : String(way.tags?.name || agencyName || "Ferry route").trim(),
      route_long_name:
        distinctStopSequence.length >= 2
          ? `${agencyName}: ${distinctStopSequence.join(" => ")}`
          : String(way.tags?.name || agencyName || "Ferry route").trim(),
      agency_name: agencyName,
      network: agencyName,
      operator: agencyName,
      from_terminal:
        distinctStopSequence.length === 2 ? distinctStopSequence[0] : "",
      to_terminal:
        distinctStopSequence.length === 2 ? distinctStopSequence[1] : "",
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

  console.log("Fetching Washington DC ferry routes from OSM...");
  const data = await fetchOverpass(query);
  const ways = data.elements.filter((el) => el.type === "way");
  const features = ways.map(buildWayFeature).filter(Boolean);

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
  );
  console.log(`Wrote ${features.length} Washington DC ferry routes to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
