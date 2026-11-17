const fs = require('fs');
const RC = require('./toi-uu-engine.js');

const parts = [
  { id: 'p1', name: 'Hộp 30x30x1.8 L835', length: 835, qty: 4, style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
  { id: 'p2', name: 'Hộp 30x30x1.8 L1100', length: 1100, qty: 2, style: 'ke', mat: 30, profile: 'Hộp 30x30x1.8' },
  { id: 'p3', name: 'Hộp 30x30x1.8 L640', length: 640, qty: 8, style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
  { id: 'p4', name: 'Hộp 30x30x1.8 L1040', length: 1040, qty: 3, style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
  { id: 'p5', name: 'Hộp 30x30x1.8 L453', length: 453, qty: 1, style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' }
];

const stock = [
  { label: 'Cây tồn 6.000', length: 6000, qty: 5, clampTail: 80, profile: 'Chung' }
];

const engineData = {
  kerf: 0,
  interlock: true,
  gap: 0,
  stock,
  parts: parts.map(p => ({
    label: p.id,
    length: p.length,
    qty: p.qty,
    end_style: p.style,
    mat: p.mat,
    profile: 'Chung'
  }))
};

const res = RC.solve(engineData);
console.log('--- TEST RESULTS ---');
console.log('Bars used:', res.bars.length);
console.log('Pieces cut:', res.totalPiecesCut);
console.log('New bars:', res.totalNewBars);
console.log('Existing bars:', res.totalExistingUsed);
console.log('Total waste:', res.totalWaste);
console.log('Total interlock saving:', res.usageStats.totalInterlockSaving);
console.log('Efficiency:', (res.usageStats.totalCutLength / res.usageStats.totalNominalLength * 100).toFixed(1) + '%');

res.patterns.forEach((p, idx) => {
  const layout = RC.layoutBar(p, 0, 0, 30);
  console.log(`\nPattern ${idx} (count=${p.count}, cuts=${p.cuts.length}, waste=${p.waste}, saving=${p.interlockSaving}):`);
  layout.pieces.forEach(g => {
    console.log(`  Piece: len=${g.c.length}, eL=${g.eL}, eR=${g.eR}, xt0=${g.xt0}, xt1=${g.xt1}, xb0=${g.xb0}, xb1=${g.xb1}, run=${g.run}`);
  });
});
