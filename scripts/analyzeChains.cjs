const data = require("../src/data/routes/laBLineOsm.json");
const features = data.features;

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
        const aFirst = coordKey(chains[i][0]);
        const aLast = coordKey(chains[i][chains[i].length - 1]);
        const bFirst = coordKey(chains[j][0]);
        const bLast = coordKey(chains[j][chains[j].length - 1]);
        let appended = null;
        if (aLast === bFirst) appended = [...chains[i], ...chains[j].slice(1)];
        else if (aLast === bLast) appended = [...chains[i], ...[...chains[j]].slice(0, -1).reverse()];
        else if (aFirst === bFirst) appended = [[...chains[i]].reverse(), ...chains[j].slice(1)].flat();
        else if (aFirst === bLast) appended = [...chains[j], ...chains[i].slice(1)];
        if (appended) { chains[i] = appended; chains[j] = null; merged = true; }
      }
    }
  }
  return chains.filter(c => c !== null);
}

function orientWE(chain) {
  if (chain[0][0] > chain[chain.length - 1][0]) return [...chain].reverse();
  return chain;
}
function minLon(chain) { return Math.min(...chain.map(c => c[0])); }
function maxLon(chain) { return Math.max(...chain.map(c => c[0])); }

const chains = mergeIntoChains(features);
chains.sort((a, b) => b.length - a.length);

console.log("=== Before bridging ===");
console.log("Total chains:", chains.length);
for (let i = 0; i < Math.min(chains.length, 5); i++) {
  const c = chains[i];
  console.log("Chain " + i + ":", c.length + " pts, lon " + minLon(c).toFixed(4) + " -> " + maxLon(c).toFixed(4));
}

// Simulate the bridging logic
const westChains = chains.filter(c => minLon(c) < -118.40).map(orientWE).sort((a, b) => b.length - a.length);
const primary = westChains[0] || [];
let secondary = westChains[1] || [];

console.log("\n=== West chains (minLon < -118.40) ===");
console.log("Primary:", primary.length, "pts, lon", minLon(primary).toFixed(4), "->", maxLon(primary).toFixed(4));
console.log("Secondary:", secondary.length, "pts, lon", minLon(secondary).toFixed(4), "->", maxLon(secondary).toFixed(4));

if (secondary.length >= 2 && maxLon(secondary) < maxLon(primary) - 0.005) {
  console.log("\nSecondary is shorter, looking for east fragments...");
  const eastFragments = chains
    .filter(c => c.length >= 2 && minLon(c) >= -118.40)
    .map(orientWE)
    .sort((a, b) => b.length - a.length);

  for (const frag of eastFragments) {
    console.log("  Fragment:", frag.length, "pts, lon", minLon(frag).toFixed(4), "->", maxLon(frag).toFixed(4));
    const gap = Math.abs(frag[0][0] - secondary[secondary.length - 1][0]);
    console.log("    Gap:", gap.toFixed(4), gap < 0.04 ? "=> BRIDGING" : "=> too far");
    if (gap < 0.04) {
      secondary = [...secondary, ...frag];
      break;
    }
  }
}

console.log("\n=== After bridging ===");
console.log("Primary:", primary.length, "pts, lon", minLon(primary).toFixed(4), "->", maxLon(primary).toFixed(4));
console.log("Secondary:", secondary.length, "pts, lon", minLon(secondary).toFixed(4), "->", maxLon(secondary).toFixed(4));
