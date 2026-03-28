// Parse Seattle Sound Transit GTFS data and extract Link Light Rail lines as GeoJSON
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gtfsDir = join(__dirname, "..", "gtfs_seattle");
const outputDir = join(__dirname, "..", "src", "data");

// Sound Transit Link Light Rail lines (route_id from GTFS)
// 100479 = 1 Line (Main line: Lynnwood - Federal Way)
// 2LINE = 2 Line (East Link: South Bellevue - Downtown Redmond)
// TLINE = T Line (Tacoma Link: Tacoma Dome - St Joseph)
const LINK_LINES = ["100479", "2LINE", "TLINE"];

// Line colors matching Sound Transit branding
const LINE_COLORS = {
  100479: "#28813F", // 1 Line (Green)
  "2LINE": "#007CAD", // 2 Line (Blue)
  TLINE: "#F38B00", // T Line (Orange)
};

const LINE_NAMES = {
  100479: "1 Line",
  "2LINE": "2 Line",
  TLINE: "T Line",
};

const LINE_LETTERS = {
  100479: "1",
  "2LINE": "2",
  TLINE: "T",
};

function parseCSV(filename) {
  const content = readFileSync(join(gtfsDir, filename), "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^\uFEFF/, "")); // Remove BOM if present

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
  console.log("Parsing Seattle Sound Transit GTFS data...");
  console.log(`GTFS directory: ${gtfsDir}`);

  // Parse routes
  const routes = parseCSV("routes.txt");
  console.log(`Total routes: ${routes.length}`);
  const linkRoutes = routes.filter((r) => LINK_LINES.includes(r.route_id));
  console.log(
    `Found ${linkRoutes.length} Link Light Rail routes:`,
    linkRoutes.map((r) => `${r.route_id} (${r.route_short_name})`),
  );

  // Parse trips to get shape_ids for each route
  const trips = parseCSV("trips.txt");
  const stopTimes = parseCSV("stop_times.txt");
  console.log(`Total trips: ${trips.length}`);
  const linkTrips = trips.filter((t) => LINK_LINES.includes(t.route_id));
  console.log(`Link Light Rail trips: ${linkTrips.length}`);

  // Count stops per trip so we can prefer the full-service shape over short-turns.
  const tripStopCounts = {};
  stopTimes.forEach((st) => {
    tripStopCounts[st.trip_id] = (tripStopCounts[st.trip_id] || 0) + 1;
  });

  // Count trips per shape_id for each route/direction
  const shapeCounts = {};
  linkTrips.forEach((trip) => {
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
        max_stop_count: 0,
      };
    }
    shapeCounts[key].shapes[shapeId].count += 1;
    const stopCount = tripStopCounts[trip.trip_id] || 0;
    if (stopCount > shapeCounts[key].shapes[shapeId].max_stop_count) {
      shapeCounts[key].shapes[shapeId].max_stop_count = stopCount;
      shapeCounts[key].shapes[shapeId].headsign = trip.trip_headsign || "";
    }
  });

  // Pick the shape with the most stops for each route/direction,
  // then break ties by trip frequency.
  const selectedShapes = {};
  Object.entries(shapeCounts).forEach(([key, data]) => {
    const shapes = Object.entries(data.shapes);

    shapes.sort((a, b) => {
      if (b[1].max_stop_count !== a[1].max_stop_count) {
        return b[1].max_stop_count - a[1].max_stop_count;
      }
      return b[1].count - a[1].count;
    });

    const [shapeId, info] = shapes[0];
    selectedShapes[shapeId] = {
      route_id: data.route_id,
      direction_id: data.direction_id,
      headsign: info.headsign,
      trip_count: info.count,
      stop_count: info.max_stop_count,
    };

    console.log(
      `${data.route_id} dir ${data.direction_id}: picked shape ${shapeId} (${info.headsign || "no headsign"}, ${info.max_stop_count} stops, ${info.count} trips)`,
    );
  });

  console.log(`\nSelected ${Object.keys(selectedShapes).length} shapes`);

  // Parse shapes
  const shapes = parseCSV("shapes.txt");
  console.log(`Total shape points: ${shapes.length}`);

  // Group shape points by shape_id and filter for our routes
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
    const route = linkRoutes.find((r) => r.route_id === info.route_id);
    const routeId = info.route_id;

    return {
      type: "Feature",
      properties: {
        shape_id: shapeId,
        route_id: routeId,
        route_name: LINE_NAMES[routeId] || route?.route_long_name || routeId,
        route_color:
          LINE_COLORS[routeId] || `#${route?.route_color || "666666"}`,
        route_letter: LINE_LETTERS[routeId] || routeId,
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
  const outputPath = join(outputDir, "routes", "seattleLinkRoutes.json");
  mkdirSync(join(outputDir, "routes"), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} features to ${outputPath}`);

  // Summary
  console.log("\nRoute summary:");
  features.forEach((f) => {
    const p = f.properties;
    console.log(
      `  ${p.route_id} ${p.direction}: ${p.route_name} (${p.headsign || "no headsign"})`,
    );
  });
}

main();
