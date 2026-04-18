const b = require("./src/data/routes/laBLineOsm.json");
const d = require("./src/data/routes/laDLineOsm.json");
const la = require("./src/data/routes/laMetroRoutes.json");

function spacing(name, features) {
  let mn = 1e9, mx = 0, td = 0, ts = 0;
  for (const f of features) {
    const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const dy = (c[i][1] - c[i-1][1]) * 111320;
      const dx = (c[i][0] - c[i-1][0]) * 111320 * Math.cos(c[i][1] * Math.PI / 180);
      const dist = Math.sqrt(dy*dy + dx*dx);
      if (dist < mn) mn = dist;
      if (dist > mx) mx = dist;
      td += dist; ts++;
    }
  }
  const pts = features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
  console.log(`${name}: ${features.length} features, ${pts} pts, avg ${Math.round(td/ts)}m, min ${Math.round(mn)}m, max ${Math.round(mx)}m`);
}

spacing("B Line ORM", b.features);
spacing("D Line ORM", d.features);

for (const rid of ["802", "805"]) {
  const feats = la.features.filter(f => String(f.properties?.route_id) === rid);
  spacing(`GTFS route ${rid}`, feats);
}
