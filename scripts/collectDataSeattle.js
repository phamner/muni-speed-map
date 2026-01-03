/**
 * Seattle Sound Transit Link Light Rail Data Collector
 * 
 * Fetches real-time vehicle positions from Sound Transit's OneBusAway API,
 * calculates speeds between consecutive readings, and stores in Supabase.
 * 
 * Prerequisites:
 * - API key from Sound Transit (request at https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-terms-of-use)
 * 
 * Usage: npm run collect:seattle
 */

import { createClient } from '@supabase/supabase-js';

// Configuration - same as other collectors
const SUPABASE_URL = 'https://REDACTED_SUPABASE_REF.supabase.co';
const SUPABASE_ANON_KEY = 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sound Transit API configuration
// TODO: Replace with your API key from Sound Transit once you receive it
const OBA_API_KEY = 'YOUR_API_KEY_HERE';
const OBA_BASE_URL = 'https://api.pugetsound.onebusaway.org/api/where';

// Sound Transit Link Light Rail agency ID
const AGENCY_ID = '40';

// Polling interval in milliseconds (90 seconds to match SF)
const POLL_INTERVAL_MS = 90 * 1000;

// Link Light Rail line IDs
const LINK_LINES = ['100479', '2LINE', 'TLINE'];

// Store previous positions for speed calculation
const previousPositions = new Map();

// Haversine distance between two points in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Format timestamp for logging
function formatTime(date) {
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles'
  });
}

// Fetch vehicles for an agency from OneBusAway API
async function fetchVehicles() {
  const url = `${OBA_BASE_URL}/vehicles-for-agency/${AGENCY_ID}.json?key=${OBA_API_KEY}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.code !== 200) {
    throw new Error(`API returned error code: ${data.code} - ${data.text}`);
  }
  
  return data.data?.list || [];
}

// Calculate speed from previous position
function calculateSpeed(vehicleId, lat, lon, timestamp) {
  const prev = previousPositions.get(vehicleId);
  
  if (!prev) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return null;
  }
  
  const timeDiffSeconds = (timestamp - prev.timestamp) / 1000;
  
  // Only calculate speed if time gap is reasonable (5-180 seconds)
  if (timeDiffSeconds < 5 || timeDiffSeconds > 180) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return null;
  }
  
  const distanceMeters = haversineDistance(prev.lat, prev.lon, lat, lon);
  
  // Sanity check: if distance is too small, treat as 0 speed (stationary)
  if (distanceMeters < 1) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return 0;
  }
  
  // Convert to mph
  const speedMps = distanceMeters / timeDiffSeconds;
  const speedMph = speedMps * 2.237;
  
  // Sanity check: if calculated speed seems unreasonable (>100 mph), ignore
  if (speedMph > 100) {
    previousPositions.set(vehicleId, { lat, lon, timestamp });
    return null;
  }
  
  previousPositions.set(vehicleId, { lat, lon, timestamp });
  return speedMph;
}

// Main collection loop
async function collectData() {
  console.log(`[${formatTime(new Date())}] Fetching Sound Transit vehicle positions...`);
  
  try {
    const vehicles = await fetchVehicles();
    
    // Filter to only Link Light Rail
    const linkVehicles = vehicles.filter(v => {
      const tripId = v.tripId;
      const routeId = v.trip?.routeId?.split('_').pop(); // Extract route ID from format "40_100479"
      return LINK_LINES.includes(routeId);
    });
    
    console.log(`   Found ${linkVehicles.length} Link Light Rail vehicles`);
    
    if (linkVehicles.length === 0) {
      console.log('   No Link vehicles found, skipping...');
      return;
    }
    
    const now = new Date();
    const positionsToInsert = [];
    let speedCount = 0;
    
    for (const vehicle of linkVehicles) {
      const vehicleId = vehicle.vehicleId?.split('_').pop() || vehicle.vehicleId;
      const routeId = vehicle.trip?.routeId?.split('_').pop();
      const lat = vehicle.location?.lat;
      const lon = vehicle.location?.lon;
      const directionId = vehicle.trip?.directionId;
      const timestamp = vehicle.lastLocationUpdateTime || Date.now();
      
      if (!lat || !lon || !routeId) continue;
      
      // Calculate speed from consecutive readings
      const speed = calculateSpeed(vehicleId, lat, lon, timestamp);
      if (speed !== null) speedCount++;
      
      positionsToInsert.push({
        vehicle_id: vehicleId,
        route_id: routeId,
        direction_id: String(directionId),
        lat: lat,
        lon: lon,
        speed_calculated: speed,
        recorded_at: new Date(timestamp).toISOString(),
        city: 'Seattle',
      });
    }
    
    if (positionsToInsert.length > 0) {
      const startTime = Date.now();
      const { error } = await supabase
        .from('vehicle_positions')
        .insert(positionsToInsert);
      
      if (error) {
        console.error('   Error saving to Supabase:', error.message);
      } else {
        const duration = Date.now() - startTime;
        console.log(`[${formatTime(new Date())}] Saved ${positionsToInsert.length} positions (${speedCount} with speed) in ${duration}ms`);
      }
    }
  } catch (error) {
    console.error(`[${formatTime(new Date())}] Error:`, error.message);
    
    if (error.message.includes('401')) {
      console.error('   ⚠️  Invalid API key. Please set SOUND_TRANSIT_API_KEY in your .env file.');
      console.error('   Request an API key at: https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-terms-of-use');
    }
  }
}

// Main entry point
async function main() {
  console.log('🚃 Seattle Sound Transit Link Light Rail Collector');
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds`);
  console.log(`   Tracking lines: ${LINK_LINES.join(', ')}`);
  console.log('');
  
  if (OBA_API_KEY === 'YOUR_API_KEY_HERE' || !OBA_API_KEY) {
    console.log('⚠️  WARNING: No API key configured!');
    console.log('   Set SOUND_TRANSIT_API_KEY in your .env file');
    console.log('   Request a key at: https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd/otd-terms-of-use');
    console.log('');
    console.log('❌ Cannot run without API key. Exiting.');
    console.log('   Once you have a key, update OBA_API_KEY in this file.');
    process.exit(1);
  }
  
  // Run immediately
  await collectData();
  
  // Then poll at interval
  setInterval(collectData, POLL_INTERVAL_MS);
}

// Generate fake data for demo/testing purposes
async function generateFakeData() {
  console.log('Generating demo data for Seattle Link Light Rail...\n');
  
  // Sample stations along the 1 Line
  const line1Stations = [
    { name: 'Lynnwood City Center', lat: 47.8144, lon: -122.2954 },
    { name: 'Mountlake Terrace', lat: 47.7879, lon: -122.3039 },
    { name: 'Northgate', lat: 47.7016, lon: -122.3299 },
    { name: 'U District', lat: 47.6607, lon: -122.3147 },
    { name: 'Capitol Hill', lat: 47.6196, lon: -122.3210 },
    { name: 'Westlake', lat: 47.6113, lon: -122.3375 },
    { name: 'Pioneer Square', lat: 47.6011, lon: -122.3319 },
    { name: 'International District', lat: 47.5980, lon: -122.3279 },
    { name: 'SODO', lat: 47.5808, lon: -122.3278 },
    { name: 'Rainier Beach', lat: 47.5222, lon: -122.2793 },
    { name: 'Angle Lake', lat: 47.4213, lon: -122.2969 },
    { name: 'Federal Way', lat: 47.3168, lon: -122.3115 },
  ];
  
  const line2Stations = [
    { name: 'South Bellevue', lat: 47.5896, lon: -122.1787 },
    { name: 'East Main', lat: 47.6093, lon: -122.1819 },
    { name: 'Bellevue Downtown', lat: 47.6161, lon: -122.1961 },
    { name: 'Wilburton', lat: 47.6245, lon: -122.1829 },
    { name: 'Spring District', lat: 47.6369, lon: -122.1609 },
    { name: 'BelRed', lat: 47.6415, lon: -122.1366 },
    { name: 'Overlake', lat: 47.6438, lon: -122.1336 },
    { name: 'Redmond Technology', lat: 47.6442, lon: -122.1315 },
    { name: 'Downtown Redmond', lat: 47.6764, lon: -122.1186 },
  ];
  
  const tLineStations = [
    { name: 'Tacoma Dome', lat: 47.2387, lon: -122.4274 },
    { name: 'Freighthouse Square', lat: 47.2410, lon: -122.4257 },
    { name: 'Tacoma Convention Center', lat: 47.2524, lon: -122.4374 },
    { name: 'Theater District', lat: 47.2565, lon: -122.4399 },
    { name: 'Old City Hall', lat: 47.2518, lon: -122.4434 },
    { name: 'St Joseph', lat: 47.2476, lon: -122.4551 },
  ];
  
  // Generate random positions along each line
  const positionsToInsert = [];
  const now = new Date();
  
  // Helper to generate positions along a line
  function generateLinePositions(lineId, stations, numVehicles) {
    for (let v = 0; v < numVehicles; v++) {
      // Pick a random position between two adjacent stations
      const stationIdx = Math.floor(Math.random() * (stations.length - 1));
      const t = Math.random(); // Position between stations
      
      const lat = stations[stationIdx].lat + t * (stations[stationIdx + 1].lat - stations[stationIdx].lat);
      const lon = stations[stationIdx].lon + t * (stations[stationIdx + 1].lon - stations[stationIdx].lon);
      
      // Random speed (higher in tunnels, lower at-grade)
      const speed = Math.random() * 35 + 5; // 5-40 mph
      
      // Random time offset within last hour for variety
      const timeOffset = Math.random() * 60 * 60 * 1000;
      
      positionsToInsert.push({
        vehicle_id: `SEA-${lineId}-${v + 1}`,
        route_id: lineId,
        direction_id: Math.random() > 0.5 ? '0' : '1',
        lat: lat,
        lon: lon,
        speed_calculated: speed,
        recorded_at: new Date(now.getTime() - timeOffset).toISOString(),
        city: 'Seattle',
      });
    }
  }
  
  // Generate positions for each line (more for 1 Line since it's longer)
  generateLinePositions('100479', line1Stations, 30);
  generateLinePositions('2LINE', line2Stations, 15);
  generateLinePositions('TLINE', tLineStations, 8);
  
  console.log(`Generated ${positionsToInsert.length} demo positions`);
  
  // Insert into database
  const { error } = await supabase
    .from('vehicle_positions')
    .insert(positionsToInsert);
  
  if (error) {
    console.error('Error saving demo data:', error.message);
  } else {
    console.log('✅ Demo data saved to database!');
    console.log('   You can now view Seattle data in the frontend.');
    console.log('   To collect real data, set SOUND_TRANSIT_API_KEY in .env');
  }
}

main();

