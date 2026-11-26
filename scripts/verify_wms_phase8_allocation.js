import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function run() {
  console.log('=== VERIFY WMS PHASE 8 (DOT 12: ORDER WORKFLOW, QR DNVT, ALLOCATION & ZALO) ===');

  // 1. SQL Migration Dot 12 Workflow
  const sql = read('supabase_migration_dot12_order_workflow_zalo.sql');
  [
    "'sales'",
    'customer_po_no',
    'workflow_status',
    'drawings_handed_over_at',
    'bom_submitted_at',
    'doc_category',
    'reserved_qty',
    'allocated_qty',
    'expected_date',
    'ready_notified_at',
    'public.wms_notifications',
    "'drawings_ready'",
    "'bom_submitted'",
    'public.transition_project_workflow',
    'public.allocate_free_stock_to_request',
    'public.release_request_allocation',
    'public.mark_requests_zalo_notified',
    'public.mark_notification_read',
    'public._sync_po_expected_date',
    'public.approve_warehouse_voucher',
    'public.cancel_warehouse_voucher',
    'ready_items'
  ].forEach(sym => assert(sql.includes(sym), `SQL Dot 12 missing ${sym}`));
  console.log('[OK] 1. SQL Migration Dot 12 Workflow verified.');

  // 2. SharedUI & SupabaseDB
  const sharedJs = read('js/shared-ui.js');
  ['sales:', 'VALID_ROLES', "'sales'", 'canAllocateStock', 'canManageProjects', 'initNotificationBell', 'openZaloReadyModal', 'role-sales', 'cầm phiếu kẹp bản vẽ']
    .forEach(sym => assert(sharedJs.includes(sym), `shared-ui.js missing ${sym}`));

  const dbJs = read('js/supabaseClient.js');
  [
    'customerPoNo', 'workflowStatus', 'docCategory', 'transitionProjectWorkflow',
    'reservedQty', 'freeQty', 'allocatedQty', 'expectedDate', 'readyNotifiedAt',
    'allocateFreeStockToRequest', 'releaseRequestAllocation', 'markRequestsZaloNotified',
    'getReadyAllocatedRequests', 'getWmsNotifications', 'markNotificationRead', 'subscribeNotifications'
  ].forEach(sym => assert(dbJs.includes(sym), `supabaseClient.js missing ${sym}`));
  console.log('[OK] 2. SharedUI & SupabaseDB Dot 12 APIs verified.');

  // 3. QR Scanner & Project BOM Workflow & Print A4
  const qrJs = read('js/qr-scanner.js');
  ['XP:PROJ:', 'openProjectLookupModal', 'xpQrBtnCreatePxk', 'xp_crossdock_pxk'].forEach(sym =>
    assert(qrJs.includes(sym), `qr-scanner.js missing ${sym}`)
  );

  const bomJs = read('js/project-bom.js');
  [
    'btnWfHandoverDrawings', 'btnWfSubmitBom', 'bomAttCategory', 'bom_excel',
    'XP:PROJ:', 'Quét QR kiểm tra phôi đã về / Lĩnh phôi', 'ĐNMVT01',
    'Người đề nghị', 'Người kiểm tra', 'Người mua vật tư', 'Tổng giám đốc',
    'Đang về – Dự kiến', 'Phôi đã về kho – Sẵn sàng lĩnh', 'Thiếu kho – Chờ mua', 'Đã xuất SX',
    'bom-alloc-btn', 'bom-zalo-btn', 'allocateFreeStockToRequest'
  ].forEach(sym => assert(bomJs.includes(sym), `project-bom.js missing ${sym}`));

  const projHtml = read('projects.html');
  ['inpFormCustomerPo', 'workflowStatus'].forEach(sym => assert(projHtml.includes(sym), `projects.html missing ${sym}`));

  const invHtml = read('inventory.html');
  assert(invHtml.includes('reservedQty') && invHtml.includes('Khả dụng:'), 'inventory.html missing reserved/free display');
  assert(invHtml.includes('openProjectLookupModal'), 'inventory.html missing XP:PROJ QR lookup');

  const vouHtml = read('vouchers.html');
  ['openZaloReadyModal', 'ready_items', 'xp_crossdock_pxk', 'crossdock', 'openProjectLookupModal'].forEach(sym =>
    assert(vouHtml.includes(sym), `vouchers.html missing ${sym}`)
  );

  const idxHtml = read('index.html');
  ['getReadyAllocatedRequests', 'readyMatManagerBody', 'readyMatOpBody', 'openProjectLookupModal'].forEach(sym =>
    assert(idxHtml.includes(sym), `index.html missing ${sym}`)
  );

  const admHtml = read('admin.html');
  assert(admHtml.includes('value="sales"'), 'admin.html missing sales role option');
  console.log('[OK] 3. Workflow, QR ĐNVT, BOM, Inventory, Vouchers, Dashboard & Admin UI verified.');

  // 4. sw.js v36, XP:FG QR, clean /cnc refs & dist/
  const sw = read('sw.js');
  assert(sw.includes('toiuu-phoi-pwa-v37'), 'sw.js must be v37');
  assert(qrJs.includes('XP:FG:') && qrJs.includes('openFinishedGoodsLookupModal'), 'qr-scanner.js must support XP:FG: scanning');
  assert(!projHtml.includes('/cnc') && !bomJs.includes('/cnc') && !read('js/workshopExport.js').includes('/cnc'), 'stale /cnc URL must be removed');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'js', 'qr-scanner.js')), 'dist/js/qr-scanner.js missing');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'js', 'project-bom.js')), 'dist/js/project-bom.js missing');
  console.log('[OK] 4. sw.js (v36), XP:FG QR & dist/ verified.');
  console.log('=== PHASE 8 VERIFICATION PASSED 100% ===');
}

run();
