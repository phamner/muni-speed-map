// Parse Denver RTD GTFS data and extract Light Rail and Commuter Rail lines as GeoJSON
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gtfsDir = join(__dirname, '..', 'gtfs_denver');
const outputDir = join(__dirname, '..', 'src', 'data');

// RTD Rail lines - route_type 0 = light rail, 2 = commuter rail
// We'll match by route_short_name (the letter)
const RAIL_LETTERS = ['A', 'B', 'D', 'E', 'G', 'H', 'L', 'N', 'R', 'S', 'W'];

// Official RTD line colors (matching types.ts)
const LINE_COLORS = {
  A: '#57C5B6',  // Teal (commuter rail to airport)
  B: '#0072CE',  // Blue (commuter rail)
  D: '#008752',  // Green
  E: '#6F2C91',  // Purple
  G: '#F9A01B',  // Gold (commuter rail)
  H: '#6F2C91',  // Purple (same as E)
  L: '#0072CE',  // Blue (same as B)
  N: '#57C5B6',  // Teal (same as A)
  R: '#CE0037',  // Red
  S: '#CE0E2D',  // Red (similar to R)
  W: '#008752',  // Green (same as D)
};

const LINE_NAMES = {
  A: 'A Line (Airport)',
  B: 'B Line (Westminster)',
  D: 'D Line',
  E: 'E Line',
  G: 'G Line (Arvada)',
  H: 'H Line',
  L: 'L Line',
  N: 'N Line (Northglenn)',
  R: 'R Line',
  S: 'S Line',  // New line, not in types.ts yet
  W: 'W Line (Lakewood)',
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

console.log('Parsing Denver RTD GTFS data...');

// Parse routes
const routes = parseCSV('routes.txt');
console.log('Sample route:', routes[0]);

// Find rail routes (route_type 0 or 2 with single letter short names)
const railRoutes = routes.filter(r => {
  const routeType = parseInt(r.route_type);
  const shortName = r.route_short_name?.trim();
  return (routeType === 0 || routeType === 2) && RAIL_LETTERS.includes(shortName);
});
console.log(`Found ${railRoutes.length} rail routes:`, railRoutes.map(r => r.route_short_name));

// Build route_id -> letter map
const routeIdToLetter = new Map();
railRoutes.forEach(r => {
  routeIdToLetter.set(r.route_id, r.route_short_name);
});

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
  if (routeIdToLetter.has(t.route_id)) {
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
  
  const letter = routeIdToLetter.get(routeId);
  
  features.push({
    type: 'Feature',
    properties: {
      shape_id: shapeId,
      route_id: letter,
      route_name: LINE_NAMES[letter] || `${letter} Line`,
      route_color: LINE_COLORS[letter] || '#009CDE',
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
  source: 'RTD Denver GTFS',
  features
};

writeFileSync(
  join(outputDir, 'denverRtdRoutes.json'),
  JSON.stringify(geojson, null, 2)
);

console.log('Wrote denverRtdRoutes.json');

