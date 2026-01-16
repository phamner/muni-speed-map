import fetch from 'node-fetch';
import FormData from 'form-data';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const NJT_USERNAME = process.env.NJT_USERNAME;
const NJT_PASSWORD = process.env.NJT_PASSWORD;
const BASE_URL = 'https://raildata.njtransit.com/api/GTFSRT';

async function main() {
  const formData = new FormData();
  formData.append('username', NJT_USERNAME);
  formData.append('password', NJT_PASSWORD);
  
  const tokenRes = await fetch(`${BASE_URL}/getToken`, {
    method: 'POST',
    headers: { 'accept': 'text/plain', ...formData.getHeaders() },
    body: formData
  });
  const tokenData = JSON.parse(await tokenRes.text());
  const token = tokenData.UserToken;
  console.log('Token obtained:', token ? 'YES' : 'NO');
  
  const formData2 = new FormData();
  formData2.append('token', token);
  
  const vehicleRes = await fetch(`${BASE_URL}/getVehiclePositions`, {
    method: 'POST',
    headers: { 'accept': '*/*', ...formData2.getHeaders() },
    body: formData2
  });
  
  const buffer = await vehicleRes.arrayBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  
  console.log('\n========== RAW GTFS-RT FEED ==========\n');
  console.log('Feed Header:', JSON.stringify(feed.header, null, 2));
  console.log('\nTotal entities:', feed.entity.length);
  
  const seenRoutes = new Set();
  console.log('\n========== FULL VEHICLE ENTITY (one per route) ==========\n');
  
  for (const entity of feed.entity) {
    const routeId = entity.vehicle?.trip?.routeId;
    if (routeId && !seenRoutes.has(routeId)) {
      seenRoutes.add(routeId);
      console.log(`\n----- Route ${routeId} -----`);
      console.log(JSON.stringify(entity, null, 2));
    }
  }
  
  console.log('\n========== ALL VEHICLES ==========\n');
  for (const entity of feed.entity) {
    const v = entity.vehicle;
    console.log(JSON.stringify({
      entityId: entity.id,
      routeId: v?.trip?.routeId,
      tripId: v?.trip?.tripId,
      vehicleId: v?.vehicle?.id,
      vehicleLabel: v?.vehicle?.label,
      lat: v?.position?.latitude,
      lon: v?.position?.longitude,
      bearing: v?.position?.bearing,
      speed: v?.position?.speed,
      timestamp: v?.timestamp?.toNumber ? v.timestamp.toNumber() : v?.timestamp,
      stopId: v?.stopId,
      currentStatus: v?.currentStatus
    }, null, 2));
  }
}

main().catch(console.error);
