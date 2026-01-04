import fetch from 'node-fetch';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// RTD Rail route IDs from GTFS - maps to display letters
const RAIL_ROUTE_MAP = {
  'A': 'A',         // A Line - Airport (commuter rail)
  '113B': 'B',      // B Line - Westminster (commuter rail)
  '101D': 'D',      // D Line (light rail)
  '101E': 'E',      // E Line (light rail)
  '113G': 'G',      // G Line - Arvada (commuter rail)
  '101H': 'H',      // H Line (light rail)
  '109L': 'L',      // L Line (light rail)
  '117N': 'N',      // N Line - Northglenn (commuter rail)
  '107R': 'R',      // R Line (light rail)
  '101S': 'S',      // S Line (light rail)
  '103W': 'W',      // W Line (light rail)
};

const LIGHT_RAIL_ROUTES = Object.keys(RAIL_ROUTE_MAP);

async function testFeed() {
  const response = await fetch('https://www.rtd-denver.com/files/gtfs-rt/VehiclePosition.pb', {
    headers: { 'Accept': 'application/x-protobuf' }
  });
  
  const buffer = await response.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  
  // Filter for rail vehicles
  const railVehicles = feed.entity.filter(entity => 
    entity.vehicle?.trip?.routeId && LIGHT_RAIL_ROUTES.includes(entity.vehicle.trip.routeId)
  );
  
  console.log('Total vehicles in feed:', feed.entity.length);
  console.log('Rail vehicles detected:', railVehicles.length);
  console.log();
  
  // Group by display route ID
  const byLine = {};
  railVehicles.forEach(entity => {
    const gtfsId = entity.vehicle.trip.routeId;
    const displayId = RAIL_ROUTE_MAP[gtfsId];
    if (!byLine[displayId]) byLine[displayId] = [];
    byLine[displayId].push({
      vehicleId: entity.vehicle.vehicle?.id,
      lat: entity.vehicle.position?.latitude,
      lon: entity.vehicle.position?.longitude
    });
  });
  
  console.log('Vehicles by line:');
  Object.entries(byLine).sort((a,b) => a[0].localeCompare(b[0])).forEach(([line, vehicles]) => {
    console.log(`  ${line} Line: ${vehicles.length} vehicles`);
  });
}

testFeed().catch(console.error);
