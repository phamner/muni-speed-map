const fs = require("fs");

// Load ORM B Line data and merge chains
const osmData = JSON.parse(fs.readFileSync("src/data/routes/laBLineOsm.json", "utf8"));
const segments = osmData.features.map(f => f.geometry?.coordinates).filter(c => c && c.length >= 2);

function coordinateKey(c) { return c[0].toFixed(7) + "," + c[1].toFixed(7); }
function mergeLineSegmentsIntoChains(segs) {
  const chains = segs.map(s => [...s]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) {
      for (let j = i + 1; j < chains.length && !merged; j++) {
        const iStart = coordinateKey(chains[i][0]);
        const iEnd = coordinateKey(chains[i][chains[i].length - 1]);
        const jStart = coordinateKey(chains[j][0]);
        const jEnd = coordinateKey(chains[j][chains[j].length - 1]);
        let newChain = null;
        if (iEnd === jStart) newChain = [...chains[i], ...chains[j].slice(1)];
        else if (jEnd === iStart) newChain = [...chains[j], ...chains[i].slice(1)];
        else if (iEnd === jEnd) newChain = [...chains[i], ...[...chains[j]].reverse().slice(1)];
        else if (iStart === jStart) newChain = [...[...chains[i]].reverse(), ...chains[j].slice(1)];
        if (newChain) { chains[i] = newChain; chains.splice(j, 1); merged = true; }
      }
    }
  }
  return chains;
}
function orientWestToEast(c) {
  return c[0][0] <= c[c.length - 1][0] ? c : [...c].reverse();
}

const chains = mergeLineSegmentsIntoChains(segments);
const sorted = [...chains].sort((a, b) => b.length - a.length).slice(0, 2).map(orientWestToEast);
const primary = sorted[0];

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function minDistToLine(lat, lon, coords) {
  let minD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(lat, lon, coords[i][1], coords[i][0]);
    if (d < minD) minD = d;
  }
  return minD;
}

// Check the off-route vehicles
const offRoutePositions = [
  { lat: 34.13168, lon: -118.36212 },
  { lat: 34.128777, lon: -118.360374 },
  { lat: 34.10755, lon: -118.348854 },
  { lat: 34.14129, lon: -118.36247 },
  { lat: 34.102787, lon: -118.34618 },
  { lat: 34.127857, lon: -118.35988 },
  { lat: 34.121254, lon: -118.35649 },
  { lat: 34.108917, lon: -118.34961 },
  { lat: 34.14034, lon: -118.36259 },
  { lat: 34.117958, lon: -118.35447 },
];

console.log("Distance from off-route B Line vehicles to ORM primary chain:");
offRoutePositions.forEach((p) => {
  const d = minDistToLine(p.lat, p.lon, primary);
  console.log(`  (${p.lat}, ${p.lon}) → ${d.toFixed(0)}m from route`);
});

// Also check where the ORM route runs in this lat range
console.log("\nORM primary coords in lat range 34.10-34.14:");
let count = 0;
primary.forEach((c, i) => {
  if (c[1] >= 34.10 && c[1] <= 34.14) {
    console.log(`  [${i}] lon=${c[0].toFixed(5)}, lat=${c[1].toFixed(5)}`);
    count++;
  }
});
console.log(`  ${count} points in this lat range`);

// Also check GTFS route for comparison
const gtfsData = JSON.parse(fs.readFileSync("src/data/routes/laMetroRoutes.json", "utf8"));
const bGtfs = gtfsData.features.filter(f => f.properties.route_id === "802");
const gtfsLongest = bGtfs.reduce((a, b) => a.geometry.coordinates.length > b.geometry.coordinates.length ? a : b);

console.log("\nDistance from same vehicles to GTFS longest feature:");
offRoutePositions.forEach((p) => {
  const d = minDistToLine(p.lat, p.lon, gtfsLongest.geometry.coordinates);
  console.log(`  (${p.lat}, ${p.lon}) → ${d.toFixed(0)}m from GTFS route`);
});
