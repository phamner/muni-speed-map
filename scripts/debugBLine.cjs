const fs = require("fs");

// Load the B Line ORM data
const osmData = JSON.parse(fs.readFileSync("src/data/routes/laBLineOsm.json", "utf8"));
const segments = osmData.features.map(f => f.geometry?.coordinates).filter(c => c && c.length >= 2);

// Merge into chains (same logic as app)
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

const chains = mergeLineSegmentsIntoChains(segments);
const sorted = [...chains].sort((a, b) => b.length - a.length).slice(0, 2);

function orientWestToEast(c) {
  const first = c[0][0], last = c[c.length - 1][0];
  return first <= last ? c : [...c].reverse();
}
const primary = orientWestToEast(sorted[0]);
const secondary = orientWestToEast(sorted[1]);

console.log("=== B Line ORM Chains ===");
console.log("Primary (outbound dir 0):", primary.length, "pts");
console.log("  start:", primary[0][0].toFixed(4), primary[0][1].toFixed(4));
console.log("  end:", primary[primary.length - 1][0].toFixed(4), primary[primary.length - 1][1].toFixed(4));

console.log("Secondary (inbound dir 1, will be reversed):", secondary.length, "pts");
console.log("  start:", secondary[0][0].toFixed(4), secondary[0][1].toFixed(4));
console.log("  end:", secondary[secondary.length - 1][0].toFixed(4), secondary[secondary.length - 1][1].toFixed(4));

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function routeLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  return d;
}

const primLen = routeLength(primary);
const secLen = routeLength(secondary);
const secReversed = [...secondary].reverse();

console.log("\n=== Route Lengths ===");
console.log("ORM Primary length:", (primLen / 1000).toFixed(2), "km ->", Math.floor(primLen / 200), "segments @200m");
console.log("ORM Secondary length:", (secLen / 1000).toFixed(2), "km ->", Math.floor(secLen / 200), "segments @200m");

// Also check GTFS for comparison
const gtfsData = JSON.parse(fs.readFileSync("src/data/routes/laMetroRoutes.json", "utf8"));
const bGtfs = gtfsData.features.filter(f => f.properties.route_id === "802");
console.log("\n=== GTFS B Line Features ===");
for (const f of bGtfs) {
  const len = routeLength(f.geometry.coordinates);
  console.log("GTFS dir", f.properties.direction_id, f.properties.shape_id, ":", f.geometry.coordinates.length, "pts,", (len / 1000).toFixed(2), "km ->", Math.floor(len / 200), "segments @200m");
  console.log("  start:", f.geometry.coordinates[0][0].toFixed(4), f.geometry.coordinates[0][1].toFixed(4));
  console.log("  end:", f.geometry.coordinates[f.geometry.coordinates.length - 1][0].toFixed(4), f.geometry.coordinates[f.geometry.coordinates.length - 1][1].toFixed(4));
}

// Key comparison: which is the LONGEST feature?
// In parallel-track mode, the longest feature is used as the reference for segment IDs
const allFeatureLengths = [];
// ORM features
allFeatureLengths.push({ name: "ORM dir 0 (primary)", length: primLen, startLon: primary[0][0], startLat: primary[0][1] });
allFeatureLengths.push({ name: "ORM dir 1 (sec reversed)", length: secLen, startLon: secReversed[0][0], startLat: secReversed[0][1] });
// GTFS features  
for (const f of bGtfs) {
  const len = routeLength(f.geometry.coordinates);
  allFeatureLengths.push({ name: "GTFS dir " + f.properties.direction_id, length: len, startLon: f.geometry.coordinates[0][0], startLat: f.geometry.coordinates[0][1] });
}

allFeatureLengths.sort((a, b) => b.length - a.length);
console.log("\n=== Feature length ranking (longest = reference for segment IDs) ===");
allFeatureLengths.forEach((f, i) => {
  console.log(`${i + 1}. ${f.name}: ${(f.length / 1000).toFixed(2)} km, starts at lon=${f.startLon.toFixed(4)} lat=${f.startLat.toFixed(4)}`);
});

console.log("\n=== Segment ID comparison for a sample point (North Hollywood area, ~34.168, -118.377) ===");
const sampleLat = 34.168;
const sampleLon = -118.377;

function distAlongRoute(coords, lat, lon) {
  let minDist = Infinity;
  let bestAlong = 0;
  let along = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) along += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    const d = haversine(lat, lon, coords[i][1], coords[i][0]);
    if (d < minDist) { minDist = d; bestAlong = along; }
  }
  return { distanceAlong: bestAlong, minDistance: minDist };
}

const ormResult = distAlongRoute(primary, sampleLat, sampleLon);
console.log("ORM primary: distAlong =", ormResult.distanceAlong.toFixed(0), "m, segment =", "802_" + Math.floor(ormResult.distanceAlong / 200), "(dist from route:", ormResult.minDistance.toFixed(0), "m)");

// GTFS longest feature for reference
const gtfsLongest = bGtfs.reduce((a, b) => routeLength(a.geometry.coordinates) > routeLength(b.geometry.coordinates) ? a : b);
const gtfsResult = distAlongRoute(gtfsLongest.geometry.coordinates, sampleLat, sampleLon);
console.log("GTFS longest (dir " + gtfsLongest.properties.direction_id + "): distAlong =", gtfsResult.distanceAlong.toFixed(0), "m, segment =", "802_" + Math.floor(gtfsResult.distanceAlong / 200), "(dist from route:", gtfsResult.minDistance.toFixed(0), "m)");

console.log("\n=== Segment ID comparison for Union Station area (~34.056, -118.234) ===");
const usLat = 34.056;
const usLon = -118.234;
const ormUS = distAlongRoute(primary, usLat, usLon);
console.log("ORM primary: distAlong =", ormUS.distanceAlong.toFixed(0), "m, segment =", "802_" + Math.floor(ormUS.distanceAlong / 200));
const gtfsUS = distAlongRoute(gtfsLongest.geometry.coordinates, usLat, usLon);
console.log("GTFS longest: distAlong =", gtfsUS.distanceAlong.toFixed(0), "m, segment =", "802_" + Math.floor(gtfsUS.distanceAlong / 200));
