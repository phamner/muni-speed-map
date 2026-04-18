// Re-run the chain merge on the D Line ways and log every gap
const https = require("https");

const QUERY = `[out:json][timeout:120];
(
  way["railway"="subway"]["network"~"LACMTA|Los Angeles Metro|Metro"]["name"~"Metro D Line|Purple Line Extension",i](33.95,-118.55,34.10,-118.20);
  way["railway"="construction"]["construction"="subway"]["network"~"LACMTA|Los Angeles Metro|Metro"](33.95,-118.55,34.10,-118.20);
  relation["type"="route"]["route"="subway"]["ref"="D"](33.95,-118.55,34.10,-118.20);
  way(r);
);
out body;
>;
out skel qt;`;

function post(url, query) {
  const postData = `data=${encodeURIComponent(query)}`;
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) } }, (res) => {
      let body = ""; res.on("data", c => body += c);
      res.on("end", () => { if (res.statusCode !== 200) return reject(new Error(res.statusCode + "")); resolve(JSON.parse(body)); });
    });
    req.on("error", reject); req.write(postData); req.end();
  });
}

function dist(a, b) {
  const dy = (a[1] - b[1]) * 111320;
  const dx = (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
  return Math.sqrt(dy * dy + dx * dx);
}

async function main() {
  const data = await post("https://overpass-api.de/api/interpreter", QUERY);
  const nodeMap = new Map(data.elements.filter(e => e.type === "node").map(n => [n.id, [n.lon, n.lat]]));
  const ways = data.elements.filter(e => e.type === "way");
  
  const relIds = new Set();
  for (const el of data.elements) {
    if (el.type === "relation") for (const m of el.members || []) { if (m.type === "way") relIds.add(m.ref); }
  }

  const segments = [];
  for (const w of ways) {
    const t = w.tags || {};
    const ry = t.railway || "";
    if (ry !== "subway" && ry !== "construction" && ry !== "rail") continue;
    const name = (t.name || "").toLowerCase();
    const isD = name.includes("metro d line") || name.includes("purple line") || (t.ref || "") === "D" || relIds.has(w.id);
    if (!isD) continue;
    const coords = (w.nodes || []).map(id => nodeMap.get(id)).filter(Boolean);
    if (coords.length < 2) continue;
    segments.push({ id: w.id, coords, name: t.name || "" });
  }

  // Dedup
  const seen = new Set();
  const deduped = segments.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
  console.log("Total segments:", deduped.length);

  // Chain with tolerance 0.00001 (~1m) first
  function chain(segs, tol) {
    const chains = segs.map(s => [...s.coords]);
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < chains.length; i++) {
        if (!chains[i]) continue;
        for (let j = i + 1; j < chains.length; j++) {
          if (!chains[j]) continue;
          const a = chains[i], b = chains[j];
          const close = (p, q) => Math.abs(p[0]-q[0]) < tol && Math.abs(p[1]-q[1]) < tol;
          let combined = null;
          if (close(a[a.length-1], b[0])) combined = [...a, ...b.slice(1)];
          else if (close(a[a.length-1], b[b.length-1])) combined = [...a, ...[...b].reverse().slice(1)];
          else if (close(a[0], b[b.length-1])) combined = [...b, ...a.slice(1)];
          else if (close(a[0], b[0])) combined = [...[...b].reverse(), ...a.slice(1)];
          if (combined) { chains[i] = combined; chains[j] = null; merged = true; }
        }
      }
    }
    return chains.filter(Boolean).sort((a, b) => b.length - a.length);
  }

  const c1 = chain(deduped, 0.00001);
  console.log("\nWith 1m tolerance:", c1.length, "chains");
  for (const c of c1) {
    console.log("  " + c.length + " pts, lon " + Math.min(...c.map(p=>p[0])).toFixed(4) + " to " + Math.max(...c.map(p=>p[0])).toFixed(4));
  }

  // Show gaps between chain endpoints
  console.log("\nGaps between chain endpoints (sorted by distance):");
  const gaps = [];
  for (let i = 0; i < c1.length; i++) {
    for (let j = i + 1; j < c1.length; j++) {
      const a = c1[i], b = c1[j];
      const pairs = [
        [a[a.length-1], b[0], "a.end→b.start"],
        [a[a.length-1], b[b.length-1], "a.end→b.end"],
        [a[0], b[b.length-1], "a.start→b.end"],
        [a[0], b[0], "a.start→b.start"],
      ];
      for (const [p, q, label] of pairs) {
        const d2 = dist(p, q);
        if (d2 < 200) gaps.push({ i, j, d: d2, label, pLon: p[0].toFixed(4), qLon: q[0].toFixed(4) });
      }
    }
  }
  gaps.sort((a, b) => a.d - b.d);
  for (const g of gaps.slice(0, 30)) {
    console.log(`  chains ${g.i}-${g.j}: ${g.d.toFixed(1)}m (${g.label}) at lon ${g.pLon}↔${g.qLon}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
