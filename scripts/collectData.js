#!/usr/bin/env node
/**
 * Muni Speed Map - Data Collector
 * 
 * Polls 511 API every 15 seconds and saves vehicle positions to Supabase.
 * Also calculates speed from consecutive positions.
 * 
 * Run with: node scripts/collectData.js
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = 'https://REDACTED_SUPABASE_REF.supabase.co';
const SUPABASE_ANON_KEY = 'REDACTED_SUPABASE_KEY';
const API_511_KEY = 'REDACTED_511_KEY';

const METRO_LINES = ['J', 'K', 'L', 'M', 'N', 'T'];
const POLL_INTERVAL_MS = 90000; // 90 seconds (511 API limit: 60 requests/hour)

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Store last known positions for speed calculation
const lastPositions = new Map();

// Calculate distance between two points in meters (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Convert meters per second to miles per hour
function mpsToMph(mps) {
  return mps * 2.237;
}

// Fetch vehicle positions from 511 API
async function fetchVehiclePositions() {
  try {
    const response = await fetch(
      `https://api.511.org/transit/VehicleMonitoring?api_key=${API_511_KEY}&agency=SF&format=json`
    );
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const vehicleActivities = data?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.VehicleActivity || [];
    
    // Filter for Muni Metro lines only
    const metroVehicles = vehicleActivities
      .filter(v => {
        const lineRef = v?.MonitoredVehicleJourney?.LineRef;
        return METRO_LINES.includes(lineRef);
      })
      .map(v => {
        const journey = v.MonitoredVehicleJourney;
        const location = journey?.VehicleLocation;
        const recordedAt = v?.RecordedAtTime || new Date().toISOString();
        
        return {
          vehicle_id: journey?.VehicleRef || '',
          route_id: journey?.LineRef || '',
          direction_id: journey?.DirectionRef || '',
          lat: parseFloat(location?.Latitude) || 0,
          lon: parseFloat(location?.Longitude) || 0,
          heading: parseFloat(journey?.Bearing) || null,
          speed_reported: journey?.Velocity ? parseFloat(journey.Velocity) : null,
          recorded_at: recordedAt,
        };
      })
      .filter(v => v.lat !== 0 && v.lon !== 0 && v.vehicle_id);
    
    return metroVehicles;
  } catch (error) {
    console.error('Error fetching vehicle positions:', error.message);
    return [];
  }
}

// Calculate speed from last known position
function calculateSpeed(vehicle) {
  const key = vehicle.vehicle_id;
  const lastPos = lastPositions.get(key);
  
  if (lastPos) {
    const timeDiffSeconds = (new Date(vehicle.recorded_at) - new Date(lastPos.recorded_at)) / 1000;
    
    // Only calculate if reasonable time gap (5-180 seconds)
    // 90s polling interval means most gaps will be ~90s
    if (timeDiffSeconds > 5 && timeDiffSeconds < 180) {
      const distanceMeters = haversineDistance(
        lastPos.lat, lastPos.lon,
        vehicle.lat, vehicle.lon
      );
      
      // Filter out GPS jumps (unrealistic speeds > 80 mph)
      const speedMps = distanceMeters / timeDiffSeconds;
      const speedMph = mpsToMph(speedMps);
      
      if (speedMph >= 0 && speedMph <= 80) {
        vehicle.speed_calculated = Math.round(speedMph * 10) / 10;
      }
    }
  }
  
  // Update last known position
  lastPositions.set(key, {
    lat: vehicle.lat,
    lon: vehicle.lon,
    recorded_at: vehicle.recorded_at,
  });
  
  return vehicle;
}

// Save positions to Supabase
async function savePositions(positions) {
  if (positions.length === 0) return { count: 0 };
  
  const { data, error } = await supabase
    .from('vehicle_positions')
    .insert(positions);
  
  if (error) {
    console.error('Error saving positions:', error.message);
    return { count: 0, error };
  }
  
  return { count: positions.length };
}

// Main collection loop
async function collectOnce() {
  const startTime = Date.now();
  
  // Fetch current positions
  const vehicles = await fetchVehiclePositions();
  
  if (vehicles.length === 0) {
    console.log(`[${new Date().toISOString()}] No vehicles found`);
    return;
  }
  
  // Calculate speeds
  const vehiclesWithSpeed = vehicles.map(calculateSpeed);
  
  // Count vehicles with calculated speeds
  const withSpeed = vehiclesWithSpeed.filter(v => v.speed_calculated !== undefined);
  
  // Save to database
  const { count, error } = await savePositions(vehiclesWithSpeed);
  
  const elapsed = Date.now() - startTime;
  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  if (error) {
    console.log(`[${timestamp} PT] Error: ${error.message}`);
  } else {
    console.log(
      `[${timestamp} PT] Saved ${count} positions ` +
      `(${withSpeed.length} with speed) in ${elapsed}ms`
    );
  }
}

// Run continuously
async function runCollector() {
  console.log('🚊 Muni Speed Map - Data Collector');
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000} seconds (within 511 API rate limit)`);
  console.log(`   Tracking lines: ${METRO_LINES.join(', ')}`);
  console.log('   Press Ctrl+C to stop\n');
  
  // Initial collection
  await collectOnce();
  
  // Set up interval
  setInterval(collectOnce, POLL_INTERVAL_MS);
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down collector...');
  process.exit(0);
});

// Start the collector
runCollector();

