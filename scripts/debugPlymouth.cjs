const data = require("../src/data/routes/laDLineOsm.json");

function coordKey(c) { return c[0].toFixed(7) + "," + c[1].toFixed(7); }

function mergeIntoChains(features) {
  const chains = features.map(f => [...f.geometry.coordinates]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length; i++) {
      if (chains[i] === null) continue;
      for (let j = i + 1; j < chains.length; j++) {
        if (chains[j] === null) continue;
        const a = chains[i], b = chains[j];
        const aS = coordKey(a[0]), aE = coordKey(a[a.length - 1]);
        const bS = coordKey(b[0]), bE = coordKey(b[b.length - 1]);
        let combined = null;
        if (aE === bS) combined = [...a, ...b.slice(1)];
        else if (aE === bE) combined = [...a, ...[...b].reverse().slice(1)];
        else if (aS === bE) combined = [...b, ...a.slice(1)];
        else if (aS === bS) combined = [...[...b].reverse(), ...a.slice(1)];
        if (combined) { chains[i] = combined; chains[j] = null; merged = true; }
      }
    }
  }
  return chains.filter(c => c !== null);
}

function orient(chain) {
  return chain[0][0] <= chain[chain.length - 1][0] ? chain : [...chain].reverse();
}
function minLon(c) { return Math.min(...c.map(p => p[0])); }
function maxLon(c) { return Math.max(...c.map(p => p[0])); }

const chains = mergeIntoChains(data.features);
const west = chains.filter(c => minLon(c) < -118.40).map(orient).sort((a, b) => b.length - a.length);
const primary = west[0];
const secondary = west[1]; // before bridging

const gapStart = secondary[secondary.length - 1]; // -118.3377
const eastFrags = chains.filter(c => c.length >= 2 && minLon(c) >= -118.40).map(orient).sort((a, b) => b.length - a.length);
const frag = eastFrags.find(f => Math.abs(f[0][0] - gapStart[0]) < 0.04);
const gapEnd = frag[0]; // -118.3111

console.log("Gap: " + gapStart[0].toFixed(4) + "," + gapStart[1].toFixed(6) + " -> " + gapEnd[0].toFixed(4) + "," + gapEnd[1].toFixed(6));

// Build parallel bridge using interpolation (same as cityDataLoaders)
const interpPrimaryLat = (lon) => {
  for (let k = 1; k < primary.length; k++) {
    const prev = primary[k - 1], cur = primary[k];
    if ((prev[0] <= lon && cur[0] >= lon) || (cur[0] <= lon && prev[0] >= lon)) {
      const span = cur[0] - prev[0];
      if (Math.abs(span) < 1e-10) return prev[1];
      return prev[1] + (lon - prev[0]) / span * (cur[1] - prev[1]);
    }
  }
  return lon;
};

const startOffset = gapStart[1] - interpPrimaryLat(gapStart[0]);
const endOffset = gapEnd[1] - interpPrimaryLat(gapEnd[0]);
const bridgePoints = primary
  .filter(p => p[0] > gapStart[0] && p[0] < gapEnd[0])
  .map(p => {
    const t = (p[0] - gapStart[0]) / (gapEnd[0] - gapStart[0]);
    const offset = startOffset + t * (endOffset - startOffset);
    return [p[0], p[1] + offset];
  });

console.log("Bridge points: " + bridgePoints.length);
console.log("Start offset: " + (startOffset * 111320).toFixed(1) + "m, End offset: " + (endOffset * 111320).toFixed(1) + "m");

// Check distances after parallel bridge
console.log("\n=== Distance between primary and PARALLEL bridge at each point ===");
for (const bp of bridgePoints) {
  const nearPri = primary.find(p => Math.abs(p[0] - bp[0]) < 0.001);
  if (nearPri) {
    const meters = (nearPri[1] - bp[1]) * 111320;
    console.log("  lon=" + bp[0].toFixed(4) + " pri_lat=" + nearPri[1].toFixed(6) + " bridge_lat=" + bp[1].toFixed(6) + " sep=" + meters.toFixed(1) + "m");
  }
}
