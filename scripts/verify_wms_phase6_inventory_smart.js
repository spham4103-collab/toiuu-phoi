import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function testSqlDot9() {
  const sql = read('supabase_migration_dot9_inventory_smart.sql');
  assert(sql.includes('ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true'), 'Missing inventory.is_active column');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.check_inventory_usage'), 'Missing check_inventory_usage RPC');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.safe_delete_inventory_item'), 'Missing safe_delete_inventory_item RPC');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.merge_inventory_items'), 'Missing merge_inventory_items RPC');
  console.log('[PASS] SQL Dot 9 schema & safe delete/archive/merge RPCs');
}

function testSmartSpecParserAndRoles() {
  const code = read('js/shared-ui.js');
  const sandbox = {
    window: {},
    document: { addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const SharedUI = sandbox.window.SharedUI;
  assert(SharedUI, 'SharedUI must attach to window');

  // Role permissions: only admin and warehouse can delete/archive/merge inventory
  assert.equal(SharedUI.canDeleteInventory({ role: 'admin' }), true);
  assert.equal(SharedUI.canDeleteInventory({ role: 'warehouse' }), true);
  assert.equal(SharedUI.canDeleteInventory({ role: 'engineer' }), false);
  assert.equal(SharedUI.canDeleteInventory({ role: 'accountant' }), false);
  assert.equal(SharedUI.canDeleteInventory({ role: 'operator' }), false);

  // 7 sample spec strings
  const s1 = SharedUI.parseSmartMaterialSpec('Tấm SUS 430 1.5x1220x2440');
  assert.equal(s1.materialGroup, 'sheet_2d');
  assert.equal(s1.subCategory, 'tam_inox');
  assert.equal(s1.materialGrade, 'SUS 430');
  assert.equal(s1.thicknessMm, 1.5);
  assert.equal(s1.widthMm, 1220);
  assert.equal(s1.lengthMm, 2440);
  assert.equal(s1.unit, 'tấm');
  assert(Math.abs(s1.weightKg - 35.41) < 0.05, `Expected ~35.41kg, got ${s1.weightKg}`);

  const s2 = SharedUI.parseSmartMaterialSpec('Thép tấm SS400 10x1500x3000');
  assert.equal(s2.materialGroup, 'sheet_2d');
  assert.equal(s2.subCategory, 'tam_thep_den');
  assert.equal(s2.materialGrade, 'SS400');
  assert.equal(s2.thicknessMm, 10);
  assert.equal(s2.widthMm, 1500);
  assert.equal(s2.lengthMm, 3000);
  assert(Math.abs(s2.weightKg - 353.25) < 0.05, `Expected ~353.25kg, got ${s2.weightKg}`);

  const s3 = SharedUI.parseSmartMaterialSpec('Hộp 40x80x2');
  assert.equal(s3.materialGroup, 'tube_1d');
  assert.equal(s3.subCategory, 'hop_vuong_cn');
  assert.equal(s3.standardLengthMm, 6000);
  assert.equal(s3.unit, 'cây');

  const s4 = SharedUI.parseSmartMaterialSpec('Ống D60x3');
  assert.equal(s4.materialGroup, 'tube_1d');
  assert.equal(s4.subCategory, 'ong_tron');

  const s5 = SharedUI.parseSmartMaterialSpec('V50x50x5');
  assert.equal(s5.materialGroup, 'tube_1d');
  assert.equal(s5.subCategory, 'thep_v');

  const s6 = SharedUI.parseSmartMaterialSpec('Láp tròn SUS 304 D50x1000');
  assert.equal(s6.materialGroup, 'solid_cnc');
  assert.equal(s6.subCategory, 'lap_tron_dac');
  assert.equal(s6.materialGrade, 'SUS 304');
  assert.equal(s6.diameterMm, 50);
  assert.equal(s6.lengthMm, 1000);
  assert(Math.abs(s6.weightKg - 15.57) < 0.05, `Expected ~15.57kg, got ${s6.weightKg}`);

  const s7 = SharedUI.parseSmartMaterialSpec('Phôi khối Nhôm 6061 50x100x200');
  assert.equal(s7.materialGroup, 'solid_cnc');
  assert.equal(s7.subCategory, 'phoi_khoi_cn');
  assert.equal(s7.materialGrade, 'Nhôm 6061');
  assert.equal(s7.thicknessMm, 50);
  assert.equal(s7.widthMm, 100);
  assert.equal(s7.lengthMm, 200);
  assert.equal(s7.weightKg, 2.7);

  console.log('[PASS] SharedUI.parseSmartMaterialSpec() (7 sample strings) & canDeleteInventory()');
}

function testSmartInventoryFiles() {
  const smartJs = read('js/inventory-smart.js');
  assert(smartJs.includes('window.InventorySmart'), 'inventory-smart.js must expose window.InventorySmart');
  assert(smartJs.includes('openItemModal'), 'inventory-smart.js must implement openItemModal');
  assert(smartJs.includes('openSafeDeleteModal'), 'inventory-smart.js must implement openSafeDeleteModal');
  assert(smartJs.includes('handleBulkDelete'), 'inventory-smart.js must implement handleBulkDelete');
  assert(smartJs.includes('dlSmartGrades'), 'inventory-smart.js must provide grade datalist');

  const invHtml = read('inventory.html');
  assert(invHtml.includes('/js/inventory-smart.js'), 'inventory.html must load /js/inventory-smart.js');
  assert(invHtml.includes('btnOpenAddSmartItem'), 'inventory.html must have "+ Thêm quy cách mới" button');
  assert(invHtml.includes('chkShowArchivedBars'), 'inventory.html must have archived items toggle');
  assert(invHtml.includes('Dán từ Excel (5 nhóm vật tư)'), 'inventory.html must update paste label to 5 groups');
  assert(invHtml.includes('inventory-sticky-toolbar'), 'inventory.html must have sticky toolbar wrapper');
  assert(invHtml.includes('--top-nav-height'), 'inventory.html must define --top-nav-height');
  assert(invHtml.includes('--inventory-toolbar-height'), 'inventory.html must define --inventory-toolbar-height');
  assert(invHtml.includes('IntersectionObserver') && invHtml.includes('ResizeObserver'), 'inventory.html must use IntersectionObserver & ResizeObserver for sticky toolbar');
  assert(invHtml.includes('btnToggleMobileBarsFilters'), 'inventory.html must include mobile filter toggle button');
  assert(invHtml.includes('cả 5 nhóm vật tư'), 'inventory.html must update subtitle to 5 material groups');

  const sbJs = read('js/supabaseClient.js');
  assert(sbJs.includes('checkInventoryUsage'), 'supabaseClient.js must export checkInventoryUsage');
  assert(sbJs.includes('safeDeleteInventoryItem'), 'supabaseClient.js must export safeDeleteInventoryItem');
  assert(sbJs.includes('mergeInventoryItems'), 'supabaseClient.js must export mergeInventoryItems');

  const sw = read('sw.js');
  assert(sw.includes('toiuu-phoi-pwa-v30'), 'sw.js must be v30');
  assert(sw.includes('/js/inventory-smart.js'), 'sw.js must cache /js/inventory-smart.js');
  assert(!sw.includes('/toi-uu-engine.js') && !sw.includes('/cnc'), 'sw.js must not cache nesting/cnc assets');

  const sharedCss = read('css/shared.css');
  assert(sharedCss.includes('.xp-sticky-entry'), 'shared.css must define .xp-sticky-entry');
  assert(sharedCss.includes('.xp-modal-3tier'), 'shared.css must define .xp-modal-3tier');
  assert(sharedCss.includes('.xp-modal-table-scroll'), 'shared.css must define .xp-modal-table-scroll');
  const sharedUi = read('js/shared-ui.js');
  assert(sharedUi.includes('initStickySection'), 'shared-ui.js must export initStickySection');
  assert(!sharedUi.includes("href: '/cnc'"), 'shared-ui.js NAV_ITEMS must not include /cnc');
  assert(invHtml.includes('offcutsStickyEntry'), 'inventory.html must have offcutsStickyEntry');
  assert(invHtml.includes('obBarsStickyEntry'), 'inventory.html must have obBarsStickyEntry');
  assert(read('vouchers.html').includes('voucherFormStickyEntry'), 'vouchers.html must have voucherFormStickyEntry');
  assert(read('js/project-bom.js').includes('bomStickyEntry'), 'project-bom.js must have bomStickyEntry');
  assert(read('index.html').includes('Quản Lý Kho Vật Tư'), 'index.html must be pure WMS dashboard');
  const distDir = path.join(ROOT, 'dist');
  if (fs.existsSync(distDir)) {
    assert(!fs.existsSync(path.join(distDir, 'toi-uu-engine.js')), 'dist/ must not contain toi-uu-engine.js');
    assert(!fs.existsSync(path.join(distDir, 'js', 'index')), 'dist/ must not contain js/index/');
    assert(!fs.existsSync(path.join(distDir, 'Xuat_IGS_Va_Toi_Uu_Phoi.py')), 'dist/ must not contain Fusion script');
    for (const f of ['.env', 'workshop_db.json']) {
      assert(!fs.existsSync(path.join(distDir, f)), `dist/ must not contain ${f}`);
    }
  }
  console.log('[PASS] inventory-smart.js, inventory.html, supabaseClient.js, sw.js v24, dist/ check');
}

testSqlDot9();
testSmartSpecParserAndRoles();
testSmartInventoryFiles();
console.log('ALL PHASE 6 SMART INVENTORY CHECKS PASSED!');
