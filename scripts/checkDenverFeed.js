import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

async function checkFeed() {
  const response = await fetch('https://www.rtd-denver.com/files/gtfs-rt/VehiclePosition.pb', {
    headers: { 'Accept': 'application/x-protobuf' }
  });
  
  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  
  // Get all unique route IDs
  const routeIds = new Set();
  feed.entity.forEach(entity => {
    if (entity.vehicle?.trip?.routeId) {
      routeIds.add(entity.vehicle.trip.routeId);
    }
  });
  
  console.log('All route IDs in feed:', [...routeIds].sort());
  console.log('Total entities:', feed.entity.length);
  
  // Count how many have each route ID
  const counts = {};
  feed.entity.forEach(entity => {
    const rid = entity.vehicle?.trip?.routeId;
    if (rid) counts[rid] = (counts[rid] || 0) + 1;
  });
  console.log('\nVehicle counts by route ID:');
  Object.entries(counts).sort((a,b) => a[0].localeCompare(b[0])).forEach(([rid, count]) => {
    console.log('  ' + rid + ': ' + count + ' vehicles');
  });
}

checkFeed().catch(console.error);
