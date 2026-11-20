/**
 * Helper chạy toi-uu-engine.js từ dòng lệnh / Python (CommonJS .cjs tương thích repo "type": "module")
 * Cách dùng: node run_engine_helper.cjs <engine_path> <in_payload.json> <out_result.json>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEngineFromFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Set,
    Map,
    JSON,
    Infinity,
    NaN,
    isNaN,
    isFinite,
    parseInt,
    parseFloat
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: filePath });
  const RC = sandbox.RC || sandbox.module.exports;
  if (!RC || typeof RC.solve !== 'function' || typeof RC.layoutBar !== 'function') {
    throw new Error('Không nạp được module ToiUuEngine (RC.solve / RC.layoutBar) từ ' + filePath);
  }
  return RC;
}

const enginePath = process.argv[2];
const inJsonPath = process.argv[3];
const outJsonPath = process.argv[4];

if (!enginePath || !inJsonPath || !outJsonPath) {
  const defaultEngine = path.join(__dirname, 'toi-uu-engine.js');
  if (fs.existsSync(defaultEngine)) {
    const RC = loadEngineFromFile(defaultEngine);
    const smoke = RC.solve({
      kerf: 0,
      interlock: true,
      gap: 0,
      stock: [{ label: 'Cây mới 6.000', length: 6000, clampTail: 80, qty: null, profile: 'Hộp 30x30x1.8' }],
      parts: [{ label: 'test', length: 1000, qty: 2, end_style: 'thang', mat: 30, profile: 'Hộp 30x30x1.8' }]
    });
    if (!smoke || !Array.isArray(smoke.bars) || smoke.bars.length !== 1) {
      throw new Error('Self-test toi-uu-engine.js thất bại');
    }
    console.log('[OK] run_engine_helper.cjs ready (CommonJS + VM sandbox, self-test passed)');
  } else {
    console.log('Usage: node run_engine_helper.cjs <engine_path> <in_payload.json> <out_result.json>');
  }
  process.exit(0);
}

try {
  const RC = loadEngineFromFile(enginePath);
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
  try {
    fs.writeFileSync(outJsonPath, JSON.stringify({ success: false, error: err.message || String(err) }, null, 2), 'utf8');
  } catch (e) {}
  process.exit(1);
}
