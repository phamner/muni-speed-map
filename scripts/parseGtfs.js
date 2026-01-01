// Parse SFMTA GTFS data and extract Muni Metro rail lines as GeoJSON
// Picks the most representative standard route for each line (avoids special variants)
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gtfsDir = join(__dirname, '..', 'data', 'gtfs');
const outputDir = join(__dirname, '..', 'src', 'data');

// Muni Metro rail lines + F historic streetcar
const METRO_LINES = ['F', 'J', 'K', 'L', 'M', 'N', 'T'];

// Preferred headsigns for each line (standard terminals, not variants)
// These represent the "classic" route for each line
const PREFERRED_HEADSIGNS = {
  'F_0': ['Fishermans Wharf', 'Wharf', 'Jones'],
  'F_1': ['Castro', 'Market'],
  'J_0': ['Balboa Park'],
  'J_1': ['Embarcadero', 'Church'],
  'K_0': ['Balboa Park'],
  'K_1': ['Embarcadero'],
  'L_0': ['S.F. Zoo', 'Zoo'],
  'L_1': ['Embarcadero'],
  'M_0': ['Balboa Park'],
  'M_1': ['Embarcadero'],
  'N_0': ['Ocean Beach'],
  'N_1': ['Embarcadero', '4th', 'King', 'Caltrain', 'Judah'], // Avoid "Third" variants
  'T_0': ['Chinatown'],
  'T_1': ['Sunnydale'],
};

// Headsigns to AVOID (these are variant services that don't represent the main route)
const AVOID_HEADSIGNS = {
  'N_1': ['Third', '23rd'], // N should not go down Third St in standard service
  'L_1': ['Third', '23rd'], // Same for L
};

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

function matchesPreferred(headsign, routeDir) {
  const preferred = PREFERRED_HEADSIGNS[routeDir] || [];
  return preferred.some(p => headsign.toLowerCase().includes(p.toLowerCase()));
}

function matchesAvoid(headsign, routeDir) {
  const avoid = AVOID_HEADSIGNS[routeDir] || [];
  return avoid.some(a => headsign.toLowerCase().includes(a.toLowerCase()));
}

function main() {
  console.log('Parsing GTFS data...');
  
  // Parse routes
  const routes = parseCSV('routes.txt');
  const metroRoutes = routes.filter(r => METRO_LINES.includes(r.route_id));
  console.log(`Found ${metroRoutes.length} metro routes:`, metroRoutes.map(r => r.route_id));
  
  // Parse trips to get shape_ids for each route
  const trips = parseCSV('trips.txt');
  const metroTrips = trips.filter(t => METRO_LINES.includes(t.route_id));
  
  // Count trips per shape_id for each route/direction
  const shapeCounts = {};
  metroTrips.forEach(trip => {
    const key = `${trip.route_id}_${trip.direction_id}`;
    if (!shapeCounts[key]) {
      shapeCounts[key] = {
        route_id: trip.route_id,
        direction_id: trip.direction_id,
        shapes: {}
      };
    }
    const shapeId = trip.shape_id;
    if (!shapeCounts[key].shapes[shapeId]) {
      shapeCounts[key].shapes[shapeId] = {
        count: 0,
        headsign: trip.trip_headsign
      };
    }
    shapeCounts[key].shapes[shapeId].count++;
  });
  
  // Pick the best shape for each route/direction
  // Priority: preferred headsign > avoid bad headsigns > highest count
  const selectedShapes = {};
  Object.entries(shapeCounts).forEach(([key, data]) => {
    const shapes = Object.entries(data.shapes);
    
    // Score each shape
    const scored = shapes.map(([shapeId, info]) => {
      let score = info.count;
      
      // Boost preferred headsigns
      if (matchesPreferred(info.headsign, key)) {
        score += 10000;
      }
      
      // Penalize avoided headsigns heavily
      if (matchesAvoid(info.headsign, key)) {
        score -= 100000;
      }
      
      return { shapeId, ...info, score };
    });
    
    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);
    
    const best = scored[0];
    selectedShapes[best.shapeId] = {
      route_id: data.route_id,
      direction_id: data.direction_id,
      headsign: best.headsign,
      trip_count: best.count
    };
    
    console.log(`${data.route_id} dir ${data.direction_id}: picked shape ${best.shapeId} (${best.headsign}, ${best.count} trips, score: ${best.score})`);
    
    // Show alternatives for debugging
    if (scored.length > 1) {
      console.log(`  Alternatives: ${scored.slice(1, 4).map(s => `${s.shapeId}:${s.headsign}(${s.count})`).join(', ')}`);
    }
  });
  
  console.log(`\nSelected ${Object.keys(selectedShapes).length} shapes`);
  
  // Parse shapes
  const shapes = parseCSV('shapes.txt');
  console.log(`Total shape points: ${shapes.length}`);
  
  // Group shape points by shape_id and filter for our routes
  const shapePoints = {};
  shapes.forEach(pt => {
    if (selectedShapes[pt.shape_id]) {
      if (!shapePoints[pt.shape_id]) {
        shapePoints[pt.shape_id] = [];
      }
      shapePoints[pt.shape_id].push({
        lon: parseFloat(pt.shape_pt_lon),
        lat: parseFloat(pt.shape_pt_lat),
        seq: parseInt(pt.shape_pt_sequence),
        dist: parseFloat(pt.shape_dist_traveled) || 0
      });
    }
  });
  
  // Sort by sequence
  Object.values(shapePoints).forEach(pts => {
    pts.sort((a, b) => a.seq - b.seq);
  });
  
  // Create GeoJSON features
  const features = Object.entries(shapePoints).map(([shapeId, points]) => {
    const info = selectedShapes[shapeId];
    const route = metroRoutes.find(r => r.route_id === info.route_id);
    
    return {
      type: 'Feature',
      properties: {
        shape_id: shapeId,
        route_id: info.route_id,
        route_name: `${route.route_short_name} ${route.route_long_name}`,
        route_color: `#${route.route_color}`,
        direction_id: info.direction_id,
        direction: info.direction_id === '0' ? 'outbound' : 'inbound',
        headsign: info.headsign
      },
      geometry: {
        type: 'LineString',
        coordinates: points.map(p => [p.lon, p.lat])
      }
    };
  });
  
  const geojson = {
    type: 'FeatureCollection',
    features
  };
  
  // Write output
  const outputPath = join(outputDir, 'muniMetroRoutes.json');
  writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} features to ${outputPath}`);
  
  // Summary
  console.log('\nRoute summary:');
  features.forEach(f => {
    const p = f.properties;
    console.log(`  ${p.route_id} ${p.direction}: ${p.headsign} (shape ${p.shape_id})`);
  });
}

main();
