const d = require('./src/data/routes/laBLineOsm.json');
const segs = d.features
  .filter(f => !f.properties.under_construction)
  .map(f => f.geometry.coordinates)
  .filter(c => c.length >= 2);

function coordKey(c) { return c[0].toFixed(7)+','+c[1].toFixed(7); }
function merge(lines) {
  const chains = lines.map(l => [...l]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length; i++) {
      if (!chains[i]) continue;
      for (let j = i+1; j < chains.length; j++) {
        if (!chains[j]) continue;
        const a=chains[i], b=chains[j];
        const aS=coordKey(a[0]),aE=coordKey(a[a.length-1]),bS=coordKey(b[0]),bE=coordKey(b[b.length-1]);
        let c=null;
        if(aE===bS) c=[...a,...b.slice(1)];
        else if(aE===bE) c=[...a,...[...b].reverse().slice(1)];
        else if(aS===bE) c=[...b,...a.slice(1)];
        else if(aS===bS) c=[...[...b].reverse(),...a.slice(1)];
        if(c){chains[i]=c;chains[j]=null;merged=true;}
      }
    }
  }
  return chains.filter(Boolean).sort((a,b)=>b.length-a.length);
}
const chains = merge(segs);
console.log('Chains:', chains.length);
chains.forEach((c,i) => {
  const lats = c.map(p=>p[1]);
  console.log('  Chain'+i+':', c.length, 'pts, lat range:', Math.min(...lats).toFixed(4), '->', Math.max(...lats).toFixed(4));
});
