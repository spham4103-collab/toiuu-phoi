import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadScriptIntoSandbox(relPath) {
  const code = read(relPath);
  const sandbox = {
    window: null,
    globalThis: null,
    document: undefined,
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    RegExp,
    parseFloat,
    parseInt,
    isFinite
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: relPath });
  return sandbox;
}

function run() {
  console.log('=== VERIFY WMS PHASE 9 (DOT 13: SHOPFLOOR POLISH) ===');

  // 1. Syntax check JS modules
  ['js/shared-ui.js', 'js/supabaseClient.js', 'js/project-bom.js', 'js/qr-scanner.js', 'sw.js'].forEach(rel => {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  });
  console.log('[OK] 1. Syntax check JS modules passed.');

  // 2. Verify SQL Migration Dot 13
  const sql = read('supabase_migration_dot13_shopfloor_polish.sql');
  [
    'bom_revision', 'priority', 'rev_label', 'is_superseded',
    'bump_project_revision', 'revision_bumped',
    'request_type', 'rework_ng', 'ng_reason', 'ng_reported_by',
    'get_project_cost_report', 'standard_cost', 'ng_rework_cost', 'total_net_cost',
    'is_emergency', 'emergency_confirmed_at', 'emergency_confirmed_by',
    'confirm_emergency_voucher'
  ].forEach(sym => assert(sql.includes(sym), `SQL Dot 13 missing ${sym}`));
  console.log('[OK] 2. SQL Migration Dot 13 schema & RPCs verified.');

  // 3. Test findCuttableStockCandidates (Trục tròn & Tấm/Khối)
  const uiCtx = loadScriptIntoSandbox('js/shared-ui.js');
  const SharedUI = uiCtx.SharedUI;
  assert.ok(SharedUI && typeof SharedUI.findCuttableStockCandidates === 'function', 'SharedUI.findCuttableStockCandidates missing');
  assert.equal(SharedUI.formatRevLabel(2), 'Rev 02');
  assert.equal(SharedUI.formatRevLabel(1), 'Rev 01');

  const sampleInventory = [
    { id: 'inv-sus-d18', profileName: 'Láp đặc SUS 304 D18×6000', sku: 'SUS-D18', standardLengthMm: 6000, stockQty: 3, reservedQty: 0, freeQty: 3, rackLocation: 'Kệ A1', unit: 'cây', isActive: true, specJson: { shape: 'round', material_grade: 'SUS 304', diameter_mm: 18, length_mm: 6000 } },
    { id: 'inv-sus-d30', profileName: 'Láp đặc SUS 304 D30×6000', sku: 'SUS-D30', standardLengthMm: 6000, stockQty: 2, reservedQty: 0, freeQty: 2, rackLocation: 'Kệ A2', unit: 'cây', isActive: true },
    { id: 'inv-ss400-d16', profileName: 'Láp đặc SS400 D16×6000', sku: 'SS-D16', standardLengthMm: 6000, stockQty: 4, reservedQty: 0, freeQty: 4, rackLocation: 'Kệ A3', unit: 'cây', isActive: true },
    { id: 'inv-pom-t25', profileName: 'Tấm POM T25×1000×2000', sku: 'POM-T25', standardLengthMm: 2000, stockQty: 2, reservedQty: 0, freeQty: 2, rackLocation: 'Kệ B2', unit: 'tấm', isActive: true, specJson: { shape: 'plate', material_grade: 'POM', thickness_mm: 25, width_mm: 1000, length_mm: 2000 } },
    { id: 'inv-al-t25', profileName: 'Tấm Nhôm 6061 T25×1000×2000', sku: 'AL-T25', standardLengthMm: 2000, stockQty: 2, reservedQty: 0, freeQty: 2, rackLocation: 'Kệ B3', unit: 'tấm', isActive: true },
    { id: 'inv-pom-t10', profileName: 'Tấm POM T10×1000×2000', sku: 'POM-T10', standardLengthMm: 2000, stockQty: 5, reservedQty: 0, freeQty: 5, rackLocation: 'Kệ B4', unit: 'tấm', isActive: true }
  ];
  const sampleOffcuts = [
    { id: 'off-sus-500', profile: 'Trục tròn SUS 304 D16', lengthMm: 500, quantity: 2, status: 'available', rackLocation: 'Đề-xê 01' },
    { id: 'off-sus-30', profile: 'Trục tròn SUS 304 D16', lengthMm: 30, quantity: 2, status: 'available', rackLocation: 'Đề-xê 02' }
  ];

  const roundCands = SharedUI.findCuttableStockCandidates(
    { itemName: 'Trục gá D16×43mm', specDimensions: 'D16×43mm', materialGrade: 'SUS 304', requiredQty: 4 },
    sampleInventory,
    sampleOffcuts
  );
  assert.equal(roundCands.length, 2, 'Phải tìm ra đúng 2 nguồn cắt được cho D16×43mm SUS 304 (1 đề-xê 500mm + 1 cây dài D18)');
  assert.equal(roundCands[0].sourceType, 'offcut', 'Ưu tiên đề-xê cắt được lên đầu');
  assert.equal(roundCands[0].id, 'off-sus-500');
  assert.equal(roundCands[1].inventoryId, 'inv-sus-d18');

  const plateCands = SharedUI.findCuttableStockCandidates(
    { itemName: 'Đế kẹp POM 270×25×80mm', specDimensions: '270×25×80mm', materialGrade: 'POM', requiredQty: 2 },
    sampleInventory,
    sampleOffcuts
  );
  assert.equal(plateCands.length, 1, 'Phải tìm ra đúng 1 tấm POM T25×1000×2000 cắt được cho 270×25×80mm POM');
  assert.equal(plateCands[0].inventoryId, 'inv-pom-t25');
  console.log('[OK] 3. Smart findCuttableStockCandidates (Round bar, Plate, Offcut priority, Material grade) verified.');

  // 4. Test QR Parser with Revision (XP:PROJ:<id>:R2 vs XP:PROJ:<id>:R1 vs legacy)
  const qrCtx = loadScriptIntoSandbox('js/qr-scanner.js');
  const parseQr = qrCtx.WorkshopQrScanner.parseQrPayload;
  const pRev2 = parseQr('XP:PROJ:proj_demo_01:R2');
  assert.deepEqual({ kind: pRev2.kind, id: pRev2.id, rev: pRev2.rev }, { kind: 'PROJ', id: 'proj_demo_01', rev: 2 });
  const pRev1 = parseQr('XP:PROJ:proj_demo_01:R1');
  assert.deepEqual({ kind: pRev1.kind, id: pRev1.id, rev: pRev1.rev }, { kind: 'PROJ', id: 'proj_demo_01', rev: 1 });
  const pLegacy = parseQr('XP:PROJ:proj_legacy');
  assert.deepEqual({ kind: pLegacy.kind, id: pLegacy.id, rev: pLegacy.rev }, { kind: 'PROJ', id: 'proj_legacy', rev: null });
  console.log('[OK] 4. QR Revision payload parsing (R1/R2/legacy) verified.');

  // 5. Verify UI integrations & sw.js v37
  const qrCode = read('js/qr-scanner.js');
  assert(qrCode.includes('xpQrOldRevAlert') && qrCode.includes('CẢNH BÁO BẢN IN CŨ'), 'qr-scanner.js missing old revision alert banner');

  const bomJs = read('js/project-bom.js');
  [
    'btnBomBumpRev', 'bom-toggle-superseded', ':R\' + revNum',
    'btnBomReworkNg', 'bom-cut-cand-btn', 'bom-quick-sku-btn', 'rework_ng'
  ].forEach(sym => assert(bomJs.includes(sym), `project-bom.js missing ${sym}`));

  const projHtml = read('projects.html');
  assert(projHtml.includes('chkFormUrgent') && projHtml.includes('🔥 GẤP'), 'projects.html missing Urgent flag');

  const purchHtml = read('purchasing.html');
  assert(purchHtml.includes('urgentProjSet') && purchHtml.includes('🔥 GẤP'), 'purchasing.html missing urgent pinning');

  const vHtml = read('vouchers.html');
  ['wrapEmergencyOut', 'chkEmergencyOut', 'handleConfirmEmergencyVoucher', 'btn-quick-sku-vi'].forEach(sym =>
    assert(vHtml.includes(sym), `vouchers.html missing ${sym}`)
  );

  const repHtml = read('reports.html');
  ['standard_cost', 'ng_rework_cost', 'Chi phí bù hỏng (NG)'].forEach(sym =>
    assert(repHtml.includes(sym), `reports.html missing ${sym}`)
  );

  const idxHtml = read('index.html');
  ['emergencyAlertCard', 'confirmHomeEmergencyVoucher', 'getUnconfirmedEmergencyVouchers'].forEach(sym =>
    assert(idxHtml.includes(sym), `index.html missing ${sym}`)
  );

  const sw = read('sw.js');
  assert(sw.includes('toiuu-phoi-pwa-v37'), 'sw.js must be bumped to v37');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'js', 'shared-ui.js')), 'dist/js/shared-ui.js missing');
  console.log('[OK] 5. All Dot 13 UI features & sw.js (v37) verified.');
  console.log('=== PHASE 9 VERIFICATION PASSED 100% ===');
}

run();
