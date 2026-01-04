// Parse Philadelphia SEPTA GTFS data and extract Trolley lines as GeoJSON
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gtfsDir = join(__dirname, "..", "gtfs_philly");
const outputDir = join(__dirname, "..", "src", "data");

// Philadelphia SEPTA Trolley lines (route_id from GTFS)
// T1-T5 = Subway-Surface Trolleys (routes 10, 11, 13, 34, 36)
// D1-D2 = Media/Sharon Hill Trolleys (routes 101, 102)
// G1 = Girard Ave Trolley (route 15)
const TROLLEY_ROUTE_IDS = ["T1", "T2", "T3", "T4", "T5", "D1", "D2", "G1"];

// Map GTFS route_id to our frontend route_id
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

// Line colors matching SEPTA branding
const LINE_COLORS = {
  10: "#5A960A", // Subway-Surface (Green)
  11: "#5A960A",
  13: "#5A960A",
  34: "#5A960A",
  36: "#5A960A",
  101: "#DC2E6B", // Media Line (Magenta)
  102: "#DC2E6B", // Sharon Hill Line
  15: "#FFD700", // Girard Ave (Gold)
};

const LINE_NAMES = {
  10: "Route 10",
  11: "Route 11",
  13: "Route 13",
  15: "Route 15 (Girard)",
  34: "Route 34",
  36: "Route 36",
  101: "Route 101 (D1)",
  102: "Route 102 (Sharon Hill)",
};

function parseCSV(filename) {
  const content = readFileSync(join(gtfsDir, filename), "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^\uFEFF/, ""));

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

function main() {
  console.log("Parsing Philadelphia SEPTA GTFS data...");
  console.log(`GTFS directory: ${gtfsDir}`);

  // Parse routes
  const routes = parseCSV("routes.txt");
  console.log(`Total routes: ${routes.length}`);
  const trolleyRoutes = routes.filter((r) =>
    TROLLEY_ROUTE_IDS.includes(r.route_id)
  );
  console.log(
    `Found ${trolleyRoutes.length} Trolley routes:`,
    trolleyRoutes.map((r) => `${r.route_id} (${r.route_long_name})`)
  );

  // Parse trips to get shape_ids for each route
  const trips = parseCSV("trips.txt");
  console.log(`Total trips: ${trips.length}`);
  const trolleyTrips = trips.filter((t) =>
    TROLLEY_ROUTE_IDS.includes(t.route_id)
  );
  console.log(`Trolley trips: ${trolleyTrips.length}`);

  // Count trips per shape_id for each route/direction
  const shapeCounts = {};
  trolleyTrips.forEach((trip) => {
    const key = `${trip.route_id}_${trip.direction_id}`;
    if (!shapeCounts[key]) {
      shapeCounts[key] = {
        route_id: trip.route_id,
        direction_id: trip.direction_id,
        shapes: {},
      };
    }
    const shapeId = trip.shape_id;
    if (!shapeCounts[key].shapes[shapeId]) {
      shapeCounts[key].shapes[shapeId] = {
        count: 0,
        headsign: trip.trip_headsign || "",
      };
    }
    shapeCounts[key].shapes[shapeId].count++;
  });

  // Pick the most common shape for each route/direction
  const selectedShapes = {};
  Object.entries(shapeCounts).forEach(([key, data]) => {
    const shapes = Object.entries(data.shapes);
    shapes.sort((a, b) => b[1].count - a[1].count);

    const [shapeId, info] = shapes[0];
    selectedShapes[shapeId] = {
      route_id: data.route_id,
      direction_id: data.direction_id,
      headsign: info.headsign,
      trip_count: info.count,
    };

    console.log(
      `${data.route_id} dir ${data.direction_id}: picked shape ${shapeId} (${
        info.headsign || "no headsign"
      }, ${info.count} trips)`
    );
  });

  console.log(`\nSelected ${Object.keys(selectedShapes).length} shapes`);

  // Parse shapes
  const shapes = parseCSV("shapes.txt");
  console.log(`Total shape points: ${shapes.length}`);

  // Group shape points by shape_id
  const shapePoints = {};
  shapes.forEach((pt) => {
    if (selectedShapes[pt.shape_id]) {
      if (!shapePoints[pt.shape_id]) {
        shapePoints[pt.shape_id] = [];
      }
      shapePoints[pt.shape_id].push({
        lon: parseFloat(pt.shape_pt_lon),
        lat: parseFloat(pt.shape_pt_lat),
        seq: parseInt(pt.shape_pt_sequence),
        dist: parseFloat(pt.shape_dist_traveled) || 0,
      });
    }
  });

  // Sort by sequence
  Object.values(shapePoints).forEach((pts) => {
    pts.sort((a, b) => a.seq - b.seq);
  });

  // Create GeoJSON features
  const features = Object.entries(shapePoints).map(([shapeId, points]) => {
    const info = selectedShapes[shapeId];
    const route = trolleyRoutes.find((r) => r.route_id === info.route_id);
    const gtfsRouteId = info.route_id;
    const routeId = ROUTE_ID_MAP[gtfsRouteId] || gtfsRouteId;

    return {
      type: "Feature",
      properties: {
        shape_id: shapeId,
        route_id: routeId,
        route_name: LINE_NAMES[routeId] || route?.route_long_name || routeId,
        route_color:
          LINE_COLORS[routeId] || `#${route?.route_color || "666666"}`,
        route_letter: routeId,
        direction_id: info.direction_id,
        direction: info.direction_id === "0" ? "outbound" : "inbound",
        headsign: info.headsign,
      },
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.lon, p.lat]),
      },
    };
  });

  const geojson = {
    type: "FeatureCollection",
    features,
  };

  // Write output
  const outputPath = join(outputDir, "phillyTrolleyRoutes.json");
  writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} features to ${outputPath}`);

  // Summary
  console.log("\nRoute summary:");
  features.forEach((f) => {
    const p = f.properties;
    console.log(
      `  ${p.route_id} ${p.direction}: ${p.route_name} (${
        p.headsign || "no headsign"
      })`
    );
  });
}

main();
