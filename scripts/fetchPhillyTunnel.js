#!/usr/bin/env node
/**
 * Fetch Philadelphia subway-surface trolley tunnel geometry from OpenStreetMap
 */

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Philadelphia downtown area - from 40th St portal to City Hall
const BBOX = "39.94,-75.21,39.96,-75.15";

async function fetchTunnelGeometry() {
  console.log("Fetching Philadelphia subway-surface tunnel geometry...");

  // Query for subway and light_rail tunnels in downtown Philadelphia
  const query = `
[out:json][timeout:60];
(
  // SEPTA subway lines (Broad Street, Market-Frankford)
  way["railway"="subway"](${BBOX});
  // Light rail/tram tunnels
  way["railway"="light_rail"]["tunnel"="yes"](${BBOX});
  way["railway"="tram"]["tunnel"="yes"](${BBOX});
  // Also try without tunnel tag in case it's tagged differently
  way["railway"="light_rail"](${BBOX});
);
out body;
>;
out skel qt;
`;

  const response = await fetch(OVERPASS_API, {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const data = await response.json();
  console.log(`Received ${data.elements?.length || 0} elements`);

  // Separate nodes and ways
  const nodes = {};
  const ways = [];

  data.elements?.forEach((el) => {
    if (el.type === "node") {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    } else if (el.type === "way") {
      ways.push(el);
    }
  });

  console.log(`Found ${ways.length} ways, ${Object.keys(nodes).length} nodes`);

  // Log what we found
  ways.forEach((w) => {
    console.log(
      `  Way ${w.id}: ${w.tags?.railway || "?"} - ${w.tags?.name || w.tags?.ref || "unnamed"}`,
      w.tags?.tunnel ? "(tunnel)" : ""
    );
  });

  // Convert ways to GeoJSON
  const features = ways.map((way) => {
    const coords = way.nodes
      .map((nodeId) => {
        const node = nodes[nodeId];
        return node ? [node.lon, node.lat] : null;
      })
      .filter((c) => c !== null);

    return {
      type: "Feature",
      properties: {
        osm_id: way.id,
        railway: way.tags?.railway,
        name: way.tags?.name || way.tags?.ref || "",
        tunnel: way.tags?.tunnel === "yes",
        route: way.tags?.route,
      },
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    };
  });

  const geojson = { type: "FeatureCollection", features };

  // Save to file for inspection
  const outputPath = path.join(__dirname, "..", "src", "data", "phillyTunnel.json");
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\nSaved ${features.length} features to ${outputPath}`);

  return geojson;
}

fetchTunnelGeometry().catch(console.error);
