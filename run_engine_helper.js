/**
 * Helper chạy toi-uu-engine.js từ dòng lệnh / Python
 * Cách dùng: node run_engine_helper.js <engine_path> <in_payload.json> <out_result.json>
 */
const fs = require('fs');
const enginePath = process.argv[2];
const inJsonPath = process.argv[3];
const outJsonPath = process.argv[4];

try {
  const RC = require(enginePath);
  const payload = JSON.parse(fs.readFileSync(inJsonPath, 'utf8'));
  const res = RC.solve(payload);
  const out = [];
  const profCounters = {};

  (res.patterns || []).forEach((p) => {
    const prof = p.profile || 'Default';
    if (!profCounters[prof]) profCounters[prof] = 0;
    const idx = profCounters[prof]++;
    const letter = String.fromCharCode(65 + (idx % 26));

    const matMacDinh = p.cuts && p.cuts.length > 0 && p.cuts[0].mat ? p.cuts[0].mat : 30;
    const L = RC.layoutBar(p, res.kerf || 0, res.gap || 0, matMacDinh);
    out.push({
      profile: p.profile,
      letter: letter,
      stockLabel: p.stockLabel,
      stockLength: p.stockLength,
      usableLength: p.usableLength,
      clampTail: p.clampTail,
      cutsCount: p.cuts.length,
      waste: p.waste,
      interlockSaving: p.interlockSaving,
      count: p.count || 1,
      pieces: L.pieces.map(g => ({
        key: g.c.label,
        length: g.c.length,
        style: g.c.endStyle,
        mat: g.w,
        eL: g.eL,
        eR: g.eR,
        want_eL: g.eL === 'S' ? 'S' : 'M',
        want_eR: g.eR === 'S' ? 'S' : 'M',
        start_z: Math.min(g.xb0, g.xt0),
        end_z: Math.max(g.xb1, g.xt1),
        xb0: g.xb0,
        xt0: g.xt0,
        xb1: g.xb1,
        xt1: g.xt1
      }))
    });
  });

  fs.writeFileSync(outJsonPath, JSON.stringify({ success: true, bars: out }, null, 2), 'utf8');
} catch (err) {
  fs.writeFileSync(outJsonPath, JSON.stringify({ success: false, error: err.message || String(err) }, null, 2), 'utf8');
  process.exit(1);
}
