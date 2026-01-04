// Parse Minneapolis Metro Transit GTFS data and extract Light Rail lines as GeoJSON
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gtfsDir = join(__dirname, '..', 'gtfs_minneapolis');
const outputDir = join(__dirname, '..', 'src', 'data');

// Metro Transit Light Rail lines (route_type 0)
// 901 = Blue Line, 902 = Green Line
const RAIL_LINES = ['901', '902'];

// Line colors matching Metro Transit branding
const LINE_COLORS = {
  '901': '#0053A0', // Blue Line
  '902': '#009E49', // Green Line
};

const LINE_NAMES = {
  '901': 'Blue Line',
  '902': 'Green Line',
};

function parseCSV(filename) {
  const content = readFileSync(join(gtfsDir, filename), 'utf-8').replace(/\r/g, '');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, '')); // Remove BOM if present
  
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
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

console.log('Parsing Minneapolis Metro Transit GTFS data...');

// Parse routes
const routes = parseCSV('routes.txt');
const railRoutes = routes.filter(r => RAIL_LINES.includes(r.route_id));
console.log(`Found ${railRoutes.length} rail routes`);

// Parse shapes
const shapes = parseCSV('shapes.txt');
const shapeMap = new Map();
shapes.forEach(s => {
  const shapeId = s.shape_id;
  if (!shapeMap.has(shapeId)) {
    shapeMap.set(shapeId, []);
  }
  shapeMap.get(shapeId).push({
    lat: parseFloat(s.shape_pt_lat),
    lon: parseFloat(s.shape_pt_lon),
    seq: parseInt(s.shape_pt_sequence)
  });
});

// Sort each shape's points by sequence
shapeMap.forEach((points, shapeId) => {
  points.sort((a, b) => a.seq - b.seq);
});

console.log(`Parsed ${shapeMap.size} shapes`);

// Parse trips to get shape_id -> route_id mapping
const trips = parseCSV('trips.txt');
const shapeToRoute = new Map();
trips.forEach(t => {
  if (RAIL_LINES.includes(t.route_id)) {
    shapeToRoute.set(t.shape_id, t.route_id);
  }
});

console.log(`Found ${shapeToRoute.size} rail shapes`);

// Build GeoJSON features
const features = [];
const seenShapes = new Set();

shapeToRoute.forEach((routeId, shapeId) => {
  if (seenShapes.has(shapeId)) return;
  seenShapes.add(shapeId);
  
  const points = shapeMap.get(shapeId);
  if (!points || points.length === 0) return;
  
  const route = railRoutes.find(r => r.route_id === routeId);
  
  features.push({
    type: 'Feature',
    properties: {
      shape_id: shapeId,
      route_id: routeId === '901' ? 'Blue' : routeId === '902' ? 'Green' : routeId,
      route_name: LINE_NAMES[routeId] || route?.route_long_name || 'Unknown',
      route_color: LINE_COLORS[routeId] || `#${route?.route_color || '0053A0'}`,
    },
    geometry: {
      type: 'LineString',
      coordinates: points.map(p => [p.lon, p.lat])
    }
  });
});

console.log(`Generated ${features.length} features`);

// Write output
const geojson = {
  type: 'FeatureCollection',
  generated: new Date().toISOString(),
  source: 'Metro Transit GTFS',
  features
};

writeFileSync(
  join(outputDir, 'minneapolisMetroRoutes.json'),
  JSON.stringify(geojson, null, 2)
);

console.log('Wrote minneapolisMetroRoutes.json');

