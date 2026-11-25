import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function run() {
  console.log('=== VERIFY WMS PHASE 8 (DOT 12: SALES ROLE, ALLOCATION, TRAFFIC LIGHT, ZALO & NOTIFS) ===');

  // 1. SQL Migration Dot 12
  const sql = read('supabase_migration_dot12_order_allocation_zalo.sql');
  [
    "'sales'",
    'reserved_qty',
    'allocated_qty',
    'expected_date',
    'ready_notified_at',
    'public.wms_notifications',
    'public.allocate_free_stock_to_request',
    'public.release_request_allocation',
    'public.mark_requests_zalo_notified',
    'public.mark_notification_read',
    'public._sync_po_expected_date',
    'public.approve_warehouse_voucher',
    'public.cancel_warehouse_voucher',
    'ready_items'
  ].forEach(sym => assert(sql.includes(sym), `SQL Dot 12 missing ${sym}`));
  console.log('[OK] 1. SQL Migration Dot 12 verified.');

  // 2. SharedUI & SupabaseDB
  const sharedJs = read('js/shared-ui.js');
  ['sales:', 'VALID_ROLES', "'sales'", 'canAllocateStock', 'canManageProjects', 'initNotificationBell', 'openZaloReadyModal', 'role-sales']
    .forEach(sym => assert(sharedJs.includes(sym), `shared-ui.js missing ${sym}`));

  const dbJs = read('js/supabaseClient.js');
  [
    'reservedQty', 'freeQty', 'allocatedQty', 'expectedDate', 'readyNotifiedAt',
    'allocateFreeStockToRequest', 'releaseRequestAllocation', 'markRequestsZaloNotified',
    'getReadyAllocatedRequests', 'getWmsNotifications', 'markNotificationRead', 'subscribeNotifications'
  ].forEach(sym => assert(dbJs.includes(sym), `supabaseClient.js missing ${sym}`));
  console.log('[OK] 2. SharedUI & SupabaseDB Dot 12 APIs verified.');

  // 3. UI integrations across project-bom.js, inventory.html, vouchers.html, index.html, admin.html
  const bomJs = read('js/project-bom.js');
  ['Đang về – Dự kiến', 'Phôi đã về kho – Sẵn sàng lĩnh', 'Thiếu kho – Chờ mua', 'Đã xuất SX', 'bom-alloc-btn', 'bom-zalo-btn', 'allocateFreeStockToRequest']
    .forEach(sym => assert(bomJs.includes(sym), `project-bom.js missing ${sym}`));

  const invHtml = read('inventory.html');
  assert(invHtml.includes('reservedQty') && invHtml.includes('Khả dụng:'), 'inventory.html missing reserved/free display');
  assert(invHtml.includes('role-sales'), 'inventory.html missing role-sales handling');

  const vouHtml = read('vouchers.html');
  ['openZaloReadyModal', 'ready_items', 'xp_crossdock_pxk', 'crossdock'].forEach(sym =>
    assert(vouHtml.includes(sym), `vouchers.html missing ${sym}`)
  );

  const idxHtml = read('index.html');
  ['getReadyAllocatedRequests', 'readyMatManagerBody', 'readyMatOpBody', 'triggerHomeZalo', 'triggerHomeCrossDock'].forEach(sym =>
    assert(idxHtml.includes(sym), `index.html missing ${sym}`)
  );

  const admHtml = read('admin.html');
  assert(admHtml.includes('value="sales"'), 'admin.html missing sales role option');
  console.log('[OK] 3. BOM, Inventory, Vouchers, Dashboard & Admin UI verified.');

  // 4. sw.js v31 & dist/
  const sw = read('sw.js');
  assert(sw.includes('toiuu-phoi-pwa-v31'), 'sw.js must be v31');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'js', 'shared-ui.js')), 'dist/js/shared-ui.js missing');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'js', 'project-bom.js')), 'dist/js/project-bom.js missing');
  console.log('[OK] 4. sw.js (v31) & dist/ verified.');
  console.log('=== PHASE 8 VERIFICATION PASSED 100% ===');
}

run();
