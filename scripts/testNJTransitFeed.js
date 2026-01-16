/**
 * Test script to verify NJ Transit GTFS-RT API access
 * Checks for light rail vehicle positions (HBLR, River Line, Newark Light Rail)
 */

import fetch from 'node-fetch';
import FormData from 'form-data';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const NJT_USERNAME = process.env.NJT_USERNAME;
const NJT_PASSWORD = process.env.NJT_PASSWORD;

// Try Test endpoint first (can switch to Production later)
const BASE_URL = 'https://testraildata.njtransit.com/api/GTFSRT';
// const BASE_URL = 'https://raildata.njtransit.com/api/GTFSRT';

// Light rail route patterns to look for
const LIGHT_RAIL_PATTERNS = [
  'hblr', 'hudson', 'bergen',  // Hudson-Bergen Light Rail
  'river', 'riv',              // River Line
  'newark', 'nlr',             // Newark Light Rail
  'light', 'lrt'               // Generic light rail terms
];

async function getToken() {
  console.log('🔐 Getting authentication token...');
  console.log(`Using endpoint: ${BASE_URL}/getToken`);
  console.log(`Username: ${NJT_USERNAME ? NJT_USERNAME.substring(0, 5) + '...' : 'NOT SET'}`);
  console.log(`Password: ${NJT_PASSWORD ? '***SET***' : 'NOT SET'}`);
  
  if (!NJT_USERNAME || !NJT_PASSWORD) {
    throw new Error('NJT_USERNAME and NJT_PASSWORD must be set in .env file');
  }
  
  const formData = new FormData();
  formData.append('username', NJT_USERNAME);
  formData.append('password', NJT_PASSWORD);
  
  const response = await fetch(`${BASE_URL}/getToken`, {
    method: 'POST',
    headers: {
      'accept': 'text/plain',
      ...formData.getHeaders()
    },
    body: formData
  });
  
  const text = await response.text();
  console.log('Token response:', text);
  
  try {
    const result = JSON.parse(text);
    if (result.Authenticated === 'True' && result.UserToken) {
      console.log('✅ Authentication successful!');
      return result.UserToken;
    } else if (result.errorMessage) {
      throw new Error(result.errorMessage);
    } else {
      throw new Error('Authentication failed: ' + text);
    }
  } catch (e) {
    if (e.message.includes('Daily usage limit')) {
      throw e;
    }
    throw new Error('Failed to parse token response: ' + text);
  }
}

async function getVehiclePositions(token) {
  console.log('\n🚃 Fetching vehicle positions...');
  
  const formData = new FormData();
  formData.append('token', token);
  
  const response = await fetch(`${BASE_URL}/getVehiclePositions`, {
    method: 'POST',
    headers: {
      'accept': '*/*',
      ...formData.getHeaders()
    },
    body: formData
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch vehicle positions: ${response.status} ${text}`);
  }
  
  const buffer = await response.arrayBuffer();
  console.log(`📦 Received ${buffer.byteLength} bytes`);
  
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );
  
  return feed;
}

function analyzeVehicles(feed) {
  console.log('\n📊 Analyzing vehicle data...');
  console.log(`Total entities in feed: ${feed.entity.length}`);
  
  const routeCounts = new Map();
  const vehicles = [];
  
  for (const entity of feed.entity) {
    if (!entity.vehicle) continue;
    
    const v = entity.vehicle;
    const routeId = v.trip?.routeId || 'unknown';
    const tripId = v.trip?.tripId || 'unknown';
    const lat = v.position?.latitude;
    const lon = v.position?.longitude;
    const speed = v.position?.speed;
    const vehicleId = v.vehicle?.id || entity.id;
    
    routeCounts.set(routeId, (routeCounts.get(routeId) || 0) + 1);
    
    vehicles.push({
      vehicleId,
      routeId,
      tripId,
      lat,
      lon,
      speed,
      timestamp: v.timestamp
    });
  }
  
  // Print route summary
  console.log('\n📍 Routes found in feed:');
  const sortedRoutes = [...routeCounts.entries()].sort((a, b) => b[1] - a[1]);
  
  for (const [routeId, count] of sortedRoutes) {
    const isLightRail = LIGHT_RAIL_PATTERNS.some(pattern => 
      routeId.toLowerCase().includes(pattern)
    );
    const marker = isLightRail ? '🚊 LIGHT RAIL!' : '🚂';
    console.log(`  ${marker} Route ${routeId}: ${count} vehicles`);
  }
  
  // Check for potential light rail routes
  console.log('\n🔍 Checking for light rail...');
  const lightRailVehicles = vehicles.filter(v => 
    LIGHT_RAIL_PATTERNS.some(pattern => 
      v.routeId.toLowerCase().includes(pattern) ||
      v.tripId.toLowerCase().includes(pattern)
    )
  );
  
  if (lightRailVehicles.length > 0) {
    console.log(`✅ Found ${lightRailVehicles.length} potential light rail vehicles!`);
    console.log('\nSample light rail vehicles:');
    for (const v of lightRailVehicles.slice(0, 5)) {
      console.log(`  Vehicle ${v.vehicleId}: Route ${v.routeId}, Trip ${v.tripId}`);
      console.log(`    Position: ${v.lat}, ${v.lon}`);
      if (v.speed != null) console.log(`    Speed: ${v.speed} m/s`);
    }
  } else {
    console.log('⚠️  No obvious light rail routes found by name pattern.');
    console.log('   Light rail may use numeric route IDs. Showing all routes...');
  }
  
  // Show sample vehicles from each route for investigation
  console.log('\n📋 Sample vehicles by route (first 3 per route):');
  const routeVehicles = new Map();
  for (const v of vehicles) {
    if (!routeVehicles.has(v.routeId)) {
      routeVehicles.set(v.routeId, []);
    }
    if (routeVehicles.get(v.routeId).length < 3) {
      routeVehicles.get(v.routeId).push(v);
    }
  }
  
  for (const [routeId, samples] of routeVehicles) {
    console.log(`\n  Route: ${routeId}`);
    for (const v of samples) {
      console.log(`    - Vehicle ${v.vehicleId}: (${v.lat?.toFixed(5)}, ${v.lon?.toFixed(5)})`);
    }
  }
  
  return { vehicles, routeCounts };
}

// Try using verification code directly as token
async function tryVerificationCode() {
  console.log('\n🔄 Trying verification code directly as token...');
  
  const verificationCode = 'R4TUqenW';
  
  const formData = new FormData();
  formData.append('token', verificationCode);
  
  const response = await fetch(`${BASE_URL}/getVehiclePositions`, {
    method: 'POST',
    headers: {
      'accept': '*/*',
      ...formData.getHeaders()
    },
    body: formData
  });
  
  console.log(`Response status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const text = await response.text();
    console.log(`Response: ${text.substring(0, 500)}`);
    return null;
  }
  
  // Check if it's JSON error or protobuf
  const contentType = response.headers.get('content-type');
  console.log(`Content-Type: ${contentType}`);
  
  const buffer = await response.arrayBuffer();
  console.log(`📦 Received ${buffer.byteLength} bytes`);
  
  // Check if it's a JSON error
  const text = new TextDecoder().decode(buffer);
  if (text.startsWith('{')) {
    console.log(`JSON response: ${text}`);
    return null;
  }
  
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(buffer)
  );
  
  return feed;
}

// Try using verification code as password
async function tryVerificationAsPassword() {
  console.log('\n🔄 Trying verification code as password...');
  
  const verificationCode = 'R4TUqenW';
  
  const formData = new FormData();
  formData.append('username', NJT_USERNAME);
  formData.append('password', verificationCode);
  
  console.log(`Username: ${NJT_USERNAME}`);
  console.log(`Password: ${verificationCode}`);
  
  const response = await fetch(`${BASE_URL}/getToken`, {
    method: 'POST',
    headers: {
      'accept': 'text/plain',
      ...formData.getHeaders()
    },
    body: formData
  });
  
  const text = await response.text();
  console.log(`Token response: ${text}`);
  
  try {
    const result = JSON.parse(text);
    if (result.Authenticated === 'True' && result.UserToken) {
      console.log('✅ Authentication successful with verification code!');
      return result.UserToken;
    }
  } catch (e) {
    // Not JSON
  }
  return null;
}

async function main() {
  console.log('🚇 NJ Transit GTFS-RT API Test\n');
  console.log('Looking for: Hudson-Bergen Light Rail, River Line, Newark Light Rail\n');
  
  try {
    let feed = null;
    
    // Approach 1: Try verification code directly as token
    feed = await tryVerificationCode();
    
    if (!feed) {
      // Approach 2: Try verification code as password
      const token = await tryVerificationAsPassword();
      if (token) {
        feed = await getVehiclePositions(token);
      }
    }
    
    if (!feed) {
      // Approach 3: Try original password
      console.log('\n⚠️  Verification code approaches failed, trying original password...');
      const token = await getToken();
      feed = await getVehiclePositions(token);
    }
    
    if (!feed) {
      console.log('\n❌ Could not access the API with any method.');
      process.exit(1);
    }
    
    // Analyze the data
    const { vehicles, routeCounts } = analyzeVehicles(feed);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total vehicles: ${vehicles.length}`);
    console.log(`Unique routes: ${routeCounts.size}`);
    console.log('\nNote: If light rail uses numeric IDs, we may need to');
    console.log('cross-reference with GTFS static data to identify them.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
