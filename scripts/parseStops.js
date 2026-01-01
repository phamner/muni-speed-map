// Parse SFMTA GTFS data and extract Muni Metro stops as GeoJSON
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gtfsDir = join(__dirname, '..', 'data', 'gtfs');
const outputDir = join(__dirname, '..', 'src', 'data');

// Muni Metro rail lines + F historic streetcar
const METRO_LINES = ['F', 'J', 'K', 'L', 'M', 'N', 'T'];

function parseCSV(filename) {
  const content = readFileSync(join(gtfsDir, filename), 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  
  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = values[i]?.trim() || '';
    });
    return obj;
  });
}

function main() {
  console.log('Parsing GTFS stops data...');
  
  // Parse stops
  const stops = parseCSV('stops.txt');
  console.log(`Total stops in GTFS: ${stops.length}`);
  
  // Create a map of stop_id -> stop info
  const stopsMap = {};
  stops.forEach(stop => {
    stopsMap[stop.stop_id] = stop;
  });
  
  // Parse trips to get trip IDs for Muni Metro lines
  const trips = parseCSV('trips.txt');
  const metroTripIds = new Set();
  const tripToRoute = {};
  
  trips.forEach(trip => {
    if (METRO_LINES.includes(trip.route_id)) {
      metroTripIds.add(trip.trip_id);
      tripToRoute[trip.trip_id] = trip.route_id;
    }
  });
  console.log(`Found ${metroTripIds.size} Muni Metro trips`);
  
  // Parse stop_times to find which stops are used by Metro trips
  console.log('Parsing stop_times.txt (this may take a moment)...');
  const stopTimes = parseCSV('stop_times.txt');
  console.log(`Total stop_times entries: ${stopTimes.length}`);
  
  // Collect unique stops used by Metro lines, and track which lines use each stop
  const metroStopIds = new Set();
  const stopRoutes = {}; // stop_id -> Set of route_ids
  
  stopTimes.forEach(st => {
    if (metroTripIds.has(st.trip_id)) {
      metroStopIds.add(st.stop_id);
      if (!stopRoutes[st.stop_id]) {
        stopRoutes[st.stop_id] = new Set();
      }
      stopRoutes[st.stop_id].add(tripToRoute[st.trip_id]);
    }
  });
  
  console.log(`Found ${metroStopIds.size} unique Muni Metro stops`);
  
  // Create GeoJSON features for Metro stops
  const features = [];
  
  metroStopIds.forEach(stopId => {
    const stop = stopsMap[stopId];
    if (!stop) {
      console.warn(`Stop ${stopId} not found in stops.txt`);
      return;
    }
    
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    
    if (isNaN(lat) || isNaN(lon)) {
      console.warn(`Invalid coordinates for stop ${stopId}`);
      return;
    }
    
    const routes = Array.from(stopRoutes[stopId]).sort();
    
    features.push({
      type: 'Feature',
      properties: {
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        stop_code: stop.stop_code || stop.stop_id,
        routes: routes,
        route_count: routes.length,
      },
      geometry: {
        type: 'Point',
        coordinates: [lon, lat]
      }
    });
  });
  
  // Sort by stop name for easier debugging
  features.sort((a, b) => a.properties.stop_name.localeCompare(b.properties.stop_name));
  
  const geojson = {
    type: 'FeatureCollection',
    features
  };
  
  // Write output
  const outputPath = join(outputDir, 'muniMetroStops.json');
  writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} stops to ${outputPath}`);
  
  // Summary by line
  console.log('\nStops per line:');
  METRO_LINES.forEach(line => {
    const count = features.filter(f => f.properties.routes.includes(line)).length;
    console.log(`  ${line}: ${count} stops`);
  });
  
  // Show some example stops
  console.log('\nSample stops:');
  features.slice(0, 10).forEach(f => {
    console.log(`  ${f.properties.stop_name} (${f.properties.routes.join(', ')})`);
  });
}

main();

