import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function run() {
  console.log('=== VERIFY WMS PHASE 7 (DOT 11: PURCHASING & DELIVERY + PERIOD LOCK + AUDIT) ===');

  // 1. SQL Migration Dot 11
  const sql = read('supabase_migration_dot11_purchasing_delivery.sql');
  [
    'public.purchase_requests',
    'public.purchase_request_items',
    'public.purchase_orders',
    'public.purchase_order_items',
    'public._sync_po_item_received',
    'public.finished_goods_items',
    'public.fg_receipts',
    'public.fg_receipt_items',
    'public.delivery_notes',
    'public.delivery_note_items',
    'public.approve_fg_receipt',
    'public.cancel_fg_receipt',
    'public.approve_delivery_note',
    'public.cancel_delivery_note',
    'public.get_company_dashboard_summary',
    'public.wms_period_locks',
    'public.wms_audit_logs',
    'public._assert_period_unlocked',
    'public._write_wms_audit_log',
    'public.approve_warehouse_voucher',
    'public.cancel_warehouse_voucher'
  ].forEach(sym => assert(sql.includes(sym), `SQL missing ${sym}`));
  console.log('[OK] 1. SQL Migration Dot 11 verified.');

  // 2. SharedUI & SupabaseDB
  const sharedJs = read('js/shared-ui.js');
  ['NAV_ITEMS', '/purchasing', '/delivery', 'canApprovePR', 'canAccessPurchasing', 'canAccessDelivery', 'refreshPendingPrBadge', 'initPendingPrBadge']
    .forEach(sym => assert(sharedJs.includes(sym), `shared-ui.js missing ${sym}`));

  const dbJs = read('js/supabaseClient.js');
  [
    'getPurchaseRequests', 'createPurchaseRequest', 'updatePurchaseRequestStatus',
    'getPurchaseOrders', 'getPurchaseOrderById', 'createPurchaseOrder', 'createPurchaseOrderFromPr',
    'getFinishedGoodsItems', 'saveFinishedGoodsItem', 'getFgReceipts', 'createFgReceipt',
    'approveFgReceipt', 'cancelFgReceipt', 'getDeliveryNotes', 'createDeliveryNote',
    'approveDeliveryNote', 'markDeliveryNoteDelivered', 'cancelDeliveryNote',
    'uploadDeliveryAttachment', 'getCompanyDashboardSummary', 'poId', 'poItemId'
  ].forEach(sym => assert(dbJs.includes(sym), `supabaseClient.js missing ${sym}`));
  console.log('[OK] 2. SharedUI & SupabaseDB APIs verified.');

  // 3. New pages: purchasing.html & delivery.html
  const purchHtml = read('purchasing.html');
  ['xp-modal-3tier', 'xp_pr_draft_items', 'createPurchaseOrderFromPr', 'printPoA4', '/vouchers?new=IN&po=', 'canApprovePR', 'canViewPrices']
    .forEach(sym => assert(purchHtml.includes(sym), `purchasing.html missing ${sym}`));

  const delivHtml = read('delivery.html');
  ['xp-modal-3tier', 'qrcode-generator', 'XP:FG:', 'approveFgReceipt', 'approveDeliveryNote', 'compressImageFile', 'uploadDeliveryAttachment', 'printDeliveryNoteA4']
    .forEach(sym => assert(delivHtml.includes(sym), `delivery.html missing ${sym}`));
  console.log('[OK] 3. purchasing.html & delivery.html verified.');

  // 4. Nav sync & integrations across all existing pages
  ['index.html', 'inventory.html', 'vouchers.html', 'projects.html', 'reports.html', 'admin.html'].forEach(f => {
    const html = read(f);
    assert(html.includes('href="/purchasing"'), `${f} missing /purchasing nav link`);
    assert(html.includes('href="/delivery"'), `${f} missing /delivery nav link`);
  });

  const idxHtml = read('index.html');
  ['getCompanyDashboardSummary', 'kpiPendingPr', 'kpiOpenOverduePo', 'kpiFgReadyDebt'].forEach(sym =>
    assert(idxHtml.includes(sym), `index.html missing ${sym}`)
  );

  const vouHtml = read('vouchers.html');
  ['getPurchaseOrderById', 'activePoIdForVoucher', '_poOrderedQty'].forEach(sym =>
    assert(vouHtml.includes(sym), `vouchers.html missing ${sym}`)
  );

  const invHtml = read('inventory.html');
  const bomJs = read('js/project-bom.js');
  assert(invHtml.includes('xp_pr_draft_items'), 'inventory.html missing xp_pr_draft_items');
  assert(bomJs.includes('xp_pr_draft_items'), 'project-bom.js missing xp_pr_draft_items');
  console.log('[OK] 4. Nav sync & integrations verified.');

  // 5. server.js, sync_all.py, sw.js & dist/
  const srv = read('server.js');
  assert(srv.includes("'purchasing.html'") && srv.includes("'/purchasing'"), 'server.js missing /purchasing route');
  assert(srv.includes("'delivery.html'") && srv.includes("'/delivery'"), 'server.js missing /delivery route');

  const syncPy = read('sync_all.py');
  assert(syncPy.includes("'purchasing'") && syncPy.includes("'delivery'"), 'sync_all.py missing purchasing/delivery');

  const sw = read('sw.js');
  assert(sw.includes('toiuu-phoi-pwa-v31'), 'sw.js must be v31');
  assert(sw.includes('/purchasing') && sw.includes('/delivery'), 'sw.js missing /purchasing or /delivery');

  assert(fs.existsSync(path.join(ROOT, 'dist', 'purchasing.html')), 'dist/purchasing.html missing (run sync_all.py)');
  assert(fs.existsSync(path.join(ROOT, 'dist', 'delivery.html')), 'dist/delivery.html missing (run sync_all.py)');
  console.log('[OK] 5. server.js, sync_all.py, sw.js (v30) & dist/ verified.');
  console.log('=== PHASE 7 VERIFICATION PASSED 100% ===');
}

run();
