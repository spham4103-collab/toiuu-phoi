
const RC = require(process.argv[1]);
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const res = RC.solve(data);
const out = [];
res.patterns.forEach((p, idx) => {
  const L = RC.layoutBar(p, res.kerf, res.gap, 30);
  out.push({
    patternIndex: idx,
    stockLength: p.stockLength,
    waste: p.waste,
    interlockSaving: p.interlockSaving,
    pieces: L.pieces.map(g => ({
      label: g.c.label,
      length: g.c.length,
      style: g.c.endStyle,
      mat: g.w,
      eL: g.eL,
      eR: g.eR,
      xb0: g.xb0,
      xt0: g.xt0,
      xb1: g.xb1,
      xt1: g.xt1
    }))
  });
});
console.log(JSON.stringify(out));
