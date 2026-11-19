/**
 * ============================================================================
 * KIỂM THỬ THUẬT TOÁN TỐI ƯU CẮT PHÔI (TRƯỚC VS SAU) — xepphoi.cloud
 * Chạy bằng: node scripts/test_nesting.js
 * ============================================================================
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function loadEngineFromSource(codeStr) {
  const sb = {
    self: null,
    Date, Math, JSON, Number, String, Boolean, Array, Object, Set, Map,
    Float64Array, Int32Array, Uint8Array, RegExp, Error, console,
    parseFloat, parseInt, isNaN
  };
  sb.self = sb;
  vm.runInNewContext(codeStr, sb);
  return sb.RC;
}

function loadSupabaseHelpers() {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'js', 'supabaseClient.js'), 'utf8');
  const sb = {
    window: null, globalThis: null, console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: () => Promise.reject(new Error('offline test')),
    URL, URLSearchParams, Blob: class {}, File: class {},
    setTimeout, clearTimeout, Date, Math, JSON, encodeURIComponent, decodeURIComponent
  };
  sb.window = sb;
  sb.globalThis = sb;
  sb.window.addEventListener = () => {};
  vm.runInNewContext(code, sb);
  return sb.window.SupabaseDB;
}

function getNewEngineSource() {
  return fs.readFileSync(path.join(ROOT_DIR, 'toi-uu-engine.js'), 'utf8');
}

function getOldEngineSource() {
  const gitExe = 'C:\\Program Files\\Git\\bin\\git.exe';
  return execFileSync(gitExe, ['show', '423c683~1:toi-uu-engine.js'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function extractMatFromProfile(pName) {
  if (!pName) return 30;
  const m = String(pName).match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X|\*)(\d+)/);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
  const mR = String(pName).match(/(?:Ø|D|Phi)\s*(\d+)/i);
  return mR ? parseInt(mR[1], 10) : 30;
}

function summarizeResult(res) {
  const wastes = res.bars.map(b => Math.max(0, b.waste));
  const maxWaste = wastes.length ? Math.max(...wastes) : 0;
  const newPurchaseLen = res.bars.reduce((a, b) => a + (b.isNewPurchase ? b.stockLength : 0), 0);
  const sub800Count = wastes.filter(w => w > 0 && w < 800).length;
  return {
    bars: res.bars.length,
    newBars: res.totalNewBars,
    existingUsed: res.totalExistingUsed,
    newPurchaseLen,
    totalWaste: Math.round(res.totalWaste * 100) / 100,
    maxWaste: Math.round(maxWaste * 100) / 100,
    wastes,
    sub800Count,
    saving: Math.round((res.usageStats ? res.usageStats.totalInterlockSaving : 0) * 100) / 100,
    patternsCount: res.patterns.length,
    ms: res.ms
  };
}

function assertIntegrity(RC, SupabaseDB, payload, res, scenarioName) {
  // 1. Bảo toàn số lượng & nhãn chi tiết 100% (bao gồm cả Mirror / tên riêng)
  const expectedCounts = {};
  (payload.parts || []).forEach(p => {
    const st = p.end_style || 'thang';
    const key = [p.profile || 'Chung', p.label || '', p.length, st, st === 'thang' ? 0 : (p.mat || '')].join('|');
    expectedCounts[key] = (expectedCounts[key] || 0) + (p.qty || 1);
  });

  const actualCounts = {};
  res.bars.forEach(b => {
    b.cuts.forEach(c => {
      const matVal = c.endStyle === 'thang' ? 0 : (c.mat || '');
      const key = [b.profile || 'Chung', c.label || '', c.length, c.endStyle || 'thang', matVal].join('|');
      actualCounts[key] = (actualCounts[key] || 0) + 1;
    });
  });
  (res.unfulfilled || []).forEach(u => {
    // Nếu có unfulfilled, cộng theo matching label/length/profile
    const matchKey = Object.keys(expectedCounts).find(k => k.startsWith(`${u.profile || 'Chung'}|${u.label || ''}|${u.length}|`));
    if (matchKey) actualCounts[matchKey] = (actualCounts[matchKey] || 0) + (u.qtyMissing || 1);
  });

  assert.deepStrictEqual(actualCounts, expectedCounts, `[${scenarioName}] Mismatch in piece conservation / labels!`);

  // 2. Kiểm tra hình học & công thức kerf / ke / kẹp đuôi trên từng cây
  res.bars.forEach((b, idx) => {
    assert(b.waste >= -0.02, `[${scenarioName}] Bar #${idx + 1} overflow waste=${b.waste}`);
    const expectedWaste = Math.round((b.usableLength - b.cutTotal - b.kerfTotal + b.interlockSaving) * 100) / 100;
    assert(Math.abs(b.waste - expectedWaste) < 0.05, `[${scenarioName}] Bar #${idx + 1} math mismatch: ${b.waste} vs ${expectedWaste}`);
  });

  // 3. Kiểm tra patterns, layoutBar và pattern_hash cho /cnc
  let patternBarSum = 0;
  res.patterns.forEach((p, idx) => {
    patternBarSum += p.count;
    const L = RC.layoutBar(p, res.kerf, res.gap, extractMatFromProfile(p.profile));
    assert.strictEqual(L.pieces.length, p.cuts.length, `[${scenarioName}] layoutBar pieces count mismatch at pattern ${idx}`);
    assert(L.end <= p.usableLength + 0.05, `[${scenarioName}] layoutBar end ${L.end} exceeds usable ${p.usableLength}`);
    const hash = SupabaseDB.computePatternHash(p);
    assert(typeof hash === 'string' && hash.startsWith('ph_'), `[${scenarioName}] Invalid pattern_hash: ${hash}`);
  });
  assert.strictEqual(patternBarSum, res.bars.length, `[${scenarioName}] patterns count sum != bars.length`);

  // 4. Kiểm tra byStockType không vượt availableQty
  const byStockSum = res.byStockType.reduce((a, s) => a + (s.usedQty || 0), 0);
  assert.strictEqual(byStockSum, res.bars.length, `[${scenarioName}] byStockType usedQty sum != bars.length`);
  res.byStockType.forEach(s => {
    if (s.availableQty !== null) {
      assert(s.usedQty <= s.availableQty, `[${scenarioName}] Overused limited stock ${s.label}: ${s.usedQty}/${s.availableQty}`);
    }
  });
}

function testFusionHelperIntegration(payload) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toiuu_test_'));
  try {
    const inJson = path.join(tmpDir, 'in.json');
    const outJson = path.join(tmpDir, 'out.json');
    const helperDst = path.join(tmpDir, 'run_engine_helper.js');
    const engineDst = path.join(tmpDir, 'toi-uu-engine.js');
    fs.copyFileSync(path.join(ROOT_DIR, 'run_engine_helper.js'), helperDst);
    fs.copyFileSync(path.join(ROOT_DIR, 'toi-uu-engine.js'), engineDst);
    fs.writeFileSync(inJson, JSON.stringify(payload), 'utf8');

    execFileSync(process.execPath, [helperDst, engineDst, inJson, outJson], {
      cwd: tmpDir,
      encoding: 'utf8'
    });
    const out = JSON.parse(fs.readFileSync(outJson, 'utf8'));
    assert.strictEqual(out.success, true, 'run_engine_helper.js must succeed');
    assert(Array.isArray(out.bars) && out.bars.length > 0, 'run_engine_helper.js must return bars');

    const keysCounts = {};
    out.bars.forEach(bar => {
      const barMult = bar.count || 1;
      bar.pieces.forEach(pc => {
        assert(pc.want_eL === 'S' || pc.want_eL === 'M', 'Invalid want_eL');
        assert(pc.want_eR === 'S' || pc.want_eR === 'M', 'Invalid want_eR');
        assert(pc.end_z > pc.start_z, 'Invalid Z bounds');
        keysCounts[pc.key] = (keysCounts[pc.key] || 0) + barMult;
      });
    });
    assert.strictEqual(keysCounts['Hộp 30x30x1.8_L835_Ke1'], 2, 'Regular 835(ke1) count must be 2');
    assert.strictEqual(keysCounts['Hộp 30x30x1.8_L835_Ke1_Mirror'], 2, 'Mirror 835(ke1) count must be 2 (never merged with non-Mirror)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runAllTests() {
  const oldRC = loadEngineFromSource(getOldEngineSource());
  const newRC = loadEngineFromSource(getNewEngineSource());
  const SupabaseDB = loadSupabaseHelpers();

  const scenarios = [
    {
      name: '1A. Hộp 30x30x1.8 (Đề bài + Mirror)',
      payload: {
        kerf: 0,
        interlock: true,
        gap: 0,
        stock: [{ label: 'Cây mới 6.000', length: 6000, clampTail: 80, qty: null, priority: 0, profile: 'Hộp 30x30x1.8' }],
        parts: [
          { label: 'Hộp 30x30x1.8_L835_Ke1', length: 835, qty: 2, end_style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'Hộp 30x30x1.8_L1100_Ke2', length: 1100, qty: 2, end_style: 'ke', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'Hộp 30x30x1.8_L835_Ke1_Mirror', length: 835, qty: 2, end_style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'Hộp 30x30x1.8_L1040_thang', length: 1040, qty: 2, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
          { label: 'Hộp 30x30x1.8_L640_thang', length: 640, qty: 7, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
          { label: 'Hộp 30x30x1.8_L453_thang', length: 453, qty: 1, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' }
        ]
      },
      verify: (oldS, newS, newRes) => {
        assert.strictEqual(newS.bars, 3);
        assert(newS.maxWaste >= 5280, `Expected maxWaste >= 5280mm, got ${newS.maxWaste}`);
        assert(newS.maxWaste > oldS.maxWaste, 'Consolidated maxWaste must beat old engine');
        assert(newS.saving >= 120, 'Should retain full ke saving >= 120mm');
        // Xác nhận Mirror & non-Mirror không bao giờ mất nhãn
        const cutLabels = newRes.bars.flatMap(b => b.cuts.map(c => c.label));
        assert.strictEqual(cutLabels.filter(l => l === 'Hộp 30x30x1.8_L835_Ke1').length, 2);
        assert.strictEqual(cutLabels.filter(l => l === 'Hộp 30x30x1.8_L835_Ke1_Mirror').length, 2);
      }
    },
    {
      name: '1B. Hộp 30x30x1.8 (Biến thể dư 7 / 2600 / 1040)',
      payload: {
        kerf: 0,
        interlock: true,
        gap: 0,
        stock: [{ label: 'Cây mới 6.000', length: 6000, clampTail: 80, qty: null, priority: 0, profile: 'Hộp 30x30x1.8' }],
        parts: [
          { label: 'L835_Ke1', length: 835, qty: 2, end_style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'L1100_Ke2', length: 1100, qty: 2, end_style: 'ke', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'L835_Ke1_Mirror', length: 835, qty: 2, end_style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'L1040', length: 1040, qty: 3, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
          { label: 'L640', length: 640, qty: 8, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
          { label: 'L453', length: 453, qty: 1, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' }
        ]
      },
      verify: (oldS, newS) => {
        assert.strictEqual(newS.bars, 3);
        assert(newS.maxWaste >= 3600, `Expected consolidated offcut >= 3600mm, got ${newS.maxWaste}`);
        assert(newS.maxWaste > oldS.maxWaste, `New maxWaste ${newS.maxWaste} must exceed old ${oldS.maxWaste}`);
      }
    },
    {
      name: '2. Ưu tiên Kho Đề-xê (tận dụng giảm cây 6m mua mới)',
      payload: {
        kerf: 0,
        interlock: false,
        gap: 0,
        stock: [
          { label: '♻️ Đề-xê kho (1.500mm)', length: 1500, clampTail: 80, qty: 2, priority: -1000, profile: 'Hộp 40x40x1.8' },
          { label: '♻️ Đề-xê kho (2.200mm)', length: 2200, clampTail: 80, qty: 1, priority: -999, profile: 'Hộp 40x40x1.8' },
          { label: '♻️ Đề-xê kho (3.200mm)', length: 3200, clampTail: 80, qty: 1, priority: -998, profile: 'Hộp 40x40x1.8' },
          { label: 'Cây mới 6.000', length: 6000, clampTail: 80, qty: null, priority: 0, profile: 'Hộp 40x40x1.8' }
        ],
        parts: [
          { label: 'ct_1900', length: 1900, qty: 1, end_style: 'thang', mat: 0, profile: 'Hộp 40x40x1.8' },
          { label: 'ct_1500', length: 1500, qty: 2, end_style: 'thang', mat: 0, profile: 'Hộp 40x40x1.8' },
          { label: 'ct_1400', length: 1400, qty: 2, end_style: 'thang', mat: 0, profile: 'Hộp 40x40x1.8' }
        ]
      },
      verify: (_oldS, newS) => {
        assert.strictEqual(newS.newBars, 0, `Should use 0 new 6m bars when offcuts fit all, got ${newS.newBars}`);
        assert.strictEqual(newS.existingUsed, 4, `All 4 offcuts must be reused, got ${newS.existingUsed}`);
      }
    },
    {
      name: '3. Cắt đá kerf 3mm + vát ke 45° (Đa quy cách)',
      payload: {
        kerf: 3,
        interlock: true,
        gap: 1,
        stock: [
          { label: 'Cây mới 6m (25x50)', length: 6000, clampTail: 0, qty: null, priority: 0, profile: 'Hộp 25x50x1.8' },
          { label: 'Cây mới 6m (40x40)', length: 6000, clampTail: 0, qty: null, priority: 1, profile: 'Hộp 40x40x1.8' }
        ],
        parts: [
          { label: 'A1', length: 1450, qty: 4, end_style: 'ke', mat: 50, profile: 'Hộp 25x50x1.8' },
          { label: 'A2', length: 920, qty: 6, end_style: 'ke1', mat: 50, profile: 'Hộp 25x50x1.8' },
          { label: 'A3', length: 580, qty: 5, end_style: 'thang', mat: 0, profile: 'Hộp 25x50x1.8' },
          { label: 'B1', length: 1800, qty: 3, end_style: 'ke', mat: 40, profile: 'Hộp 40x40x1.8' },
          { label: 'B2', length: 750, qty: 4, end_style: 'thang', mat: 0, profile: 'Hộp 40x40x1.8' }
        ]
      },
      verify: (oldS, newS) => {
        assert(newS.bars <= oldS.bars, `Bars should not increase: ${newS.bars} vs ${oldS.bars}`);
        assert(newS.maxWaste >= oldS.maxWaste, `Max waste should improve or match: ${newS.maxWaste} vs ${oldS.maxWaste}`);
      }
    },
    {
      name: '4. Đơn lớn 120 chi tiết (Gom mẫu + Hiệu năng < 300ms)',
      payload: {
        kerf: 0,
        interlock: true,
        gap: 0,
        stock: [{ label: 'Cây mới 6.000', length: 6000, clampTail: 80, qty: null, priority: 0, profile: 'Hộp 30x30x1.8' }],
        parts: [
          { label: 'L1200_K1', length: 1200, qty: 12, end_style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'L800_K1', length: 800, qty: 12, end_style: 'ke1', mat: 30, profile: 'Hộp 30x30x1.8' },
          { label: 'L950_S', length: 950, qty: 24, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
          { label: 'L600_S', length: 600, qty: 36, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' },
          { label: 'L450_S', length: 450, qty: 36, end_style: 'thang', mat: 0, profile: 'Hộp 30x30x1.8' }
        ]
      },
      verify: (oldS, newS) => {
        assert(newS.ms < 300, `Expected runtime < 300ms, got ${newS.ms}ms`);
        assert(newS.bars <= oldS.bars, `Bars ${newS.bars} should <= old ${oldS.bars}`);
        assert(newS.maxWaste >= oldS.maxWaste, `Max waste ${newS.maxWaste} should >= old ${oldS.maxWaste}`);
        assert(newS.patternsCount <= oldS.patternsCount, `Patterns ${newS.patternsCount} should <= old ${oldS.patternsCount}`);
      }
    }
  ];

  console.log('==============================================================================================================');
  console.log(' SO SÁNH THUẬT TOÁN TỐI ƯU PHÔI: TRƯỚC (CŨ) vs SAU (NÂNG CẤP ĐA TẦNG 2 PHA)');
  console.log('==============================================================================================================');

  for (const sc of scenarios) {
    const oldRes = oldRC.solve(JSON.parse(JSON.stringify(sc.payload)));
    const newRes = newRC.solve(JSON.parse(JSON.stringify(sc.payload)));
    assertIntegrity(newRC, SupabaseDB, sc.payload, newRes, sc.name);

    const oldS = summarizeResult(oldRes);
    const newS = summarizeResult(newRes);
    sc.verify(oldS, newS, newRes);

    console.log(`\n▶ ${sc.name}`);
    console.log(`  TRƯỚC: ${oldS.bars} cây (Mới:${oldS.newBars}, Tồn:${oldS.existingUsed}) | Tổng dư:${oldS.totalWaste} mm | Dư lớn nhất:${oldS.maxWaste} mm | Tiết kiệm ke:${oldS.saving} mm | Số mẫu:${oldS.patternsCount} | ${oldS.ms} ms`);
    console.log(`         Chi tiết dư từng cây: [${oldS.wastes.join(', ')}]`);
    console.log(`  SAU  : ${newS.bars} cây (Mới:${newS.newBars}, Tồn:${newS.existingUsed}) | Tổng dư:${newS.totalWaste} mm | Dư lớn nhất:${newS.maxWaste} mm | Tiết kiệm ke:${newS.saving} mm | Số mẫu:${newS.patternsCount} | ${newS.ms} ms`);
    console.log(`         Chi tiết dư từng cây: [${newS.wastes.join(', ')}]`);
  }

  // Test luồng Fusion 360 run_engine_helper.js trên Kịch bản 1A
  testFusionHelperIntegration(scenarios[0].payload);
  console.log('\n✅ FUSION_360_RUN_ENGINE_HELPER_OK (Bảo toàn đầy đủ Mirror + tọa độ Z/mặt vát)');
  console.log('✅ ALL_NESTING_BENCHMARK_TESTS_PASSED');
}

runAllTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
