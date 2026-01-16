#!/usr/bin/env node
/**
 * Merge Philadelphia GTFS surface trolley shapes with OSM tunnel geometry
 * Creates complete route lines from terminus through tunnel to City Hall loop
 */

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gtfsDir = path.join(__dirname, "..", "gtfs_philly");
const outputDir = path.join(__dirname, "..", "src", "data");

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Philadelphia subway-surface trolley routes
const SUBWAY_SURFACE_ROUTES = ["T1", "T2", "T3", "T4", "T5"]; // Routes 10, 11, 13, 34, 36
const ROUTE_ID_MAP = {
  T1: "10",
  T2: "34",
  T3: "13",
  T4: "11",
  T5: "36",
  D1: "101",
  D2: "102",
  G1: "15",
};

const LINE_COLORS = {
  10: "#5A960A",
  11: "#5A960A",
  13: "#5A960A",
  34: "#5A960A",
  36: "#5A960A",
  101: "#DC2E6B",
  102: "#DC2E6B",
  15: "#FFD700",
  tunnel: "#5A960A", // Green for tunnel
};

const LINE_NAMES = {
  10: "Route 10",
  11: "Route 11",
  13: "Route 13",
  15: "Route 15 (Girard)",
  34: "Route 34",
  36: "Route 36",
  101: "Route 101 (Media)",
  102: "Route 102 (Sharon Hill)",
};

// Extended bbox to get the full tunnel system
const TUNNEL_BBOX = "39.94,-75.21,39.96,-75.15";

function parseCSV(filename) {
  const content = fs.readFileSync(path.join(gtfsDir, filename), "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^\uFEFF/, ""));

  return lines.slice(1).map((line) => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);

    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i]?.trim() || "";
    });
    return obj;
  });
}

async function fetchTunnelGeometry() {
  console.log("Fetching tunnel geometry from OSM...");

  const query = `
[out:json][timeout:60];
(
  // Tram tunnels (subway-surface trolley)
  way["railway"="tram"]["tunnel"="yes"](${TUNNEL_BBOX});
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

  const nodes = {};
  const ways = [];

  data.elements?.forEach((el) => {
    if (el.type === "node") {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    } else if (el.type === "way") {
      ways.push(el);
    }
  });

  console.log(`Found ${ways.length} tunnel ways`);

  // Convert to coordinates
  const tunnelSegments = ways.map((way) => {
    const coords = way.nodes
      .map((nodeId) => {
        const node = nodes[nodeId];
        return node ? [node.lon, node.lat] : null;
      })
      .filter((c) => c !== null);

    return {
      id: way.id,
      name: way.tags?.name || "",
      coords,
    };
  });

  return tunnelSegments;
}

async function main() {
  console.log("Processing Philadelphia trolley routes...\n");

  // 1. Parse GTFS data
  const routes = parseCSV("routes.txt");
  const trips = parseCSV("trips.txt");
  const shapes = parseCSV("shapes.txt");

  // Get all trolley routes
  const trolleyRouteIds = [...SUBWAY_SURFACE_ROUTES, "D1", "D2", "G1"];
  const trolleyRoutes = routes.filter((r) => trolleyRouteIds.includes(r.route_id));
  console.log(`Found ${trolleyRoutes.length} trolley routes`);

  // Get unique shapes per route (just one per route, not per direction)
  const routeShapes = {};
  trolleyRouteIds.forEach((routeId) => {
    const routeTrips = trips.filter((t) => t.route_id === routeId);
    const shapeIds = [...new Set(routeTrips.map((t) => t.shape_id))];

    // Pick the shape with most points (likely the most complete)
    let bestShape = null;
    let maxPoints = 0;

    shapeIds.forEach((shapeId) => {
      const points = shapes.filter((s) => s.shape_id === shapeId);
      if (points.length > maxPoints) {
        maxPoints = points.length;
        bestShape = shapeId;
      }
    });

    if (bestShape) {
      routeShapes[routeId] = bestShape;
      console.log(`  ${routeId}: using shape ${bestShape} (${maxPoints} points)`);
    }
  });

  // 2. Build shape geometries
  const shapeGeometries = {};
  Object.entries(routeShapes).forEach(([routeId, shapeId]) => {
    const points = shapes
      .filter((s) => s.shape_id === shapeId)
      .map((s) => ({
        lon: parseFloat(s.shape_pt_lon),
        lat: parseFloat(s.shape_pt_lat),
        seq: parseInt(s.shape_pt_sequence),
      }))
      .sort((a, b) => a.seq - b.seq);

    shapeGeometries[routeId] = points.map((p) => [p.lon, p.lat]);
  });

  // 3. Fetch tunnel geometry
  const tunnelSegments = await fetchTunnelGeometry();

  // Merge all tunnel segments into one continuous line
  const allTunnelCoords = [];
  tunnelSegments.forEach((seg) => {
    allTunnelCoords.push(...seg.coords);
  });

  console.log(`\nTunnel has ${allTunnelCoords.length} total points`);

  // 4. Create GeoJSON features
  const features = [];

  // Add surface routes
  Object.entries(shapeGeometries).forEach(([gtfsRouteId, coords]) => {
    const routeId = ROUTE_ID_MAP[gtfsRouteId];

    features.push({
      type: "Feature",
      properties: {
        route_id: routeId,
        route_name: LINE_NAMES[routeId] || `Route ${routeId}`,
        route_color: LINE_COLORS[routeId] || "#666666",
        section: "surface",
      },
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    });
  });

  // Add tunnel as a shared segment for all subway-surface routes
  // Use route_id that matches one of the green lines so it shows with any of them
  if (tunnelSegments.length > 0) {
    // Create individual tunnel segment features for each subway-surface route
    // so the tunnel shows when any of routes 10, 11, 13, 34, 36 are selected
    const subwaySurfaceRoutes = ["10", "11", "13", "34", "36"];
    
    tunnelSegments.forEach((seg, idx) => {
      if (seg.coords.length > 1) {
        // Add tunnel segment once with a special marker that it's shared
        features.push({
          type: "Feature",
          properties: {
            route_id: "10", // Use route 10 as the default so it shows with green lines
            route_name: seg.name || "Subway-Surface Tunnel",
            route_color: LINE_COLORS.tunnel,
            section: "tunnel",
            osm_id: seg.id,
            shared_tunnel: true, // Mark as shared tunnel
          },
          geometry: {
            type: "LineString",
            coordinates: seg.coords,
          },
        });
      }
    });
  }

  const geojson = { type: "FeatureCollection", features };

  // Write output
  const outputPath = path.join(outputDir, "phillyTrolleyRoutes.json");
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} features to ${outputPath}`);

  // Summary
  console.log("\nRoute summary:");
  const surfaceRoutes = features.filter((f) => f.properties.section === "surface");
  const tunnelRoutes = features.filter((f) => f.properties.section === "tunnel");
  console.log(`  Surface routes: ${surfaceRoutes.length}`);
  console.log(`  Tunnel segments: ${tunnelRoutes.length}`);
}

main().catch(console.error);
