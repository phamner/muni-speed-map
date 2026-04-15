const fs = require("fs");

// Check both chains for gaps
const osmData = JSON.parse(fs.readFileSync("src/data/routes/laBLineOsm.json", "utf8"));

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

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function orientWestToEast(c) {
  return c[0][0] <= c[c.length - 1][0] ? c : [...c].reverse();
}

const segments = osmData.features.map(f => f.geometry?.coordinates).filter(c => c && c.length >= 2);
const chains = mergeLineSegmentsIntoChains(segments);
const sorted = [...chains].sort((a, b) => b.length - a.length);

console.log("=== All chains ===");
sorted.forEach((chain, i) => {
  const oriented = orientWestToEast(chain);
  console.log(`\nChain ${i}: ${chain.length} pts`);
  console.log(`  From: (${oriented[0][0].toFixed(5)}, ${oriented[0][1].toFixed(5)})`);
  console.log(`  To:   (${oriented[oriented.length-1][0].toFixed(5)}, ${oriented[oriented.length-1][1].toFixed(5)})`);
  
  // Check for gaps > 200m
  let totalLen = 0;
  for (let j = 1; j < oriented.length; j++) {
    const d = haversine(oriented[j-1][1], oriented[j-1][0], oriented[j][1], oriented[j][0]);
    totalLen += d;
    if (d > 200) {
      console.log(`  *** GAP at [${j-1}]->[${j}]: ${d.toFixed(0)}m`);
      console.log(`      From: (${oriented[j-1][0].toFixed(5)}, ${oriented[j-1][1].toFixed(5)})`);
      console.log(`      To:   (${oriented[j][0].toFixed(5)}, ${oriented[j][1].toFixed(5)})`);
    }
  }
  console.log(`  Total length: ${(totalLen/1000).toFixed(2)} km`);
});

// Now check GTFS route for the gap area
const gtfsData = JSON.parse(fs.readFileSync("src/data/routes/laMetroRoutes.json", "utf8"));
const bGtfs = gtfsData.features.filter(f => f.properties.route_id === "802");
const gtfsDir0 = bGtfs.find(f => f.properties.direction_id === "0" || f.properties.direction_id === 0);

console.log("\n=== GTFS dir 0 points in gap area (lat 34.10-34.14, lon -118.37 to -118.34) ===");
let gapPts = 0;
gtfsDir0.geometry.coordinates.forEach((c, i) => {
  if (c[1] >= 34.10 && c[1] <= 34.14 && c[0] >= -118.37 && c[0] <= -118.34) {
    if (gapPts < 30) console.log(`  [${i}] lon=${c[0].toFixed(5)}, lat=${c[1].toFixed(5)}`);
    gapPts++;
  }
});
console.log(`  ${gapPts} GTFS points in the gap area`);
