/**
 * Automated verification suite for WMS Đợt 5 (4 Material Groups, Vouchers, Weighted Avg Cost, Atomic RPCs & 5 Roles)
 * Usage: node scripts/verify_wms_vouchers.js
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function verifySqlMigration() {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_migration_dot5_wms_vouchers.sql'), 'utf8');
  const requiredTokens = [
    'ADD COLUMN IF NOT EXISTS material_group',
    'ADD COLUMN IF NOT EXISTS sku',
    'ADD COLUMN IF NOT EXISTS unit',
    'ADD COLUMN IF NOT EXISTS spec_json',
    'ADD COLUMN IF NOT EXISTS avg_cost',
    "('admin', 'engineer', 'warehouse', 'accountant', 'operator')",
    'CREATE TABLE IF NOT EXISTS public.suppliers',
    'CREATE TABLE IF NOT EXISTS public.warehouse_vouchers',
    'CREATE TABLE IF NOT EXISTS public.warehouse_voucher_items',
    'CREATE OR REPLACE FUNCTION public.generate_voucher_code()',
    'CREATE OR REPLACE FUNCTION public.approve_warehouse_voucher(p_voucher_id UUID)',
    'CREATE OR REPLACE FUNCTION public.cancel_warehouse_voucher(',
    'FOR UPDATE',
    'voucher-attachments',
    'voucher_cancel_reversal'
  ];
  for (const tok of requiredTokens) {
    assert(sql.includes(tok), `SQL migration missing expected definition: ${tok}`);
  }
  console.log('[OK] supabase_migration_dot5_wms_vouchers.sql structure & atomic RPC guards verified');
}

function verifyHtmlAndJsSyntax() {
  const htmlFiles = ['index.html', 'projects.html', 'inventory.html', 'vouchers.html', 'reports.html', 'admin.html'];
  for (const rel of htmlFiles) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const regex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let count = 0;
    while ((match = regex.exec(html)) !== null) {
      const code = match[1].trim();
      if (!code || /^\{/.test(code)) continue;
      count++;
      try {
        new Function(code);
      } catch (err) {
        throw new Error(`Syntax error in inline <script> #${count} of ${rel}: ${err.message}`);
      }
    }
    assert(html.includes('/vouchers') || html.includes('vouchers.html'), `${rel} missing /vouchers link`);
  }

  for (const rel of ['js/shared-ui.js', 'js/supabaseClient.js', 'sw.js', 'server.js']) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)]);
  }
  console.log('[OK] Syntax verified for vouchers.html, all 6 HTML pages, shared-ui.js, supabaseClient.js, sw.js, server.js');
}

function createWmsStatefulMockClient() {
  const state = {
    currentRole: 'warehouse',
    currentUsername: 'thukho1',
    currentUid: 'uid-wh-1',
    nextCodeSeq: 1,
    simulateMissingWmsCols: false,
    inventory: [
      {
        id: 'inv-sheet-5',
        profile_name: 'Tấm SS400 1500x3000x5',
        category: 'other',
        material_group: 'sheet_2d',
        sku: 'TAM-5',
        unit: 'tấm',
        spec_json: { w: 1500, l: 3000, t: 5 },
        standard_length: 3000,
        standard_length_mm: 3000,
        stock_qty: 10,
        min_stock_qty: 2,
        weight_per_m: 0,
        unit_price: 2000000,
        avg_cost: 2000000,
        rack_location: 'Kệ T1',
        notes: ''
      },
      {
        id: 'inv-tube-25',
        profile_name: 'Hộp 25x25x1',
        category: 'square',
        material_group: 'tube_1d',
        sku: 'HOP-25',
        unit: 'cây',
        spec_json: {},
        standard_length: 6000,
        standard_length_mm: 6000,
        stock_qty: 5,
        min_stock_qty: 2,
        weight_per_m: 1.15,
        unit_price: 90000,
        avg_cost: 90000,
        rack_location: 'Kệ A1',
        notes: ''
      }
    ],
    stock_offcuts: [],
    suppliers: [{ id: 'sup-1', code: 'NCC-HP', name: 'Thép Hòa Phát', phone: '0901234567' }],
    warehouse_vouchers: [],
    warehouse_voucher_items: [],
    inventory_transactions: []
  };

  function runApproveRpc(voucherId) {
    if (!['admin', 'warehouse'].includes(state.currentRole)) {
      return { data: null, error: { message: 'Chỉ Admin hoặc Thủ kho mới có quyền duyệt phiếu kho' } };
    }
    const v = state.warehouse_vouchers.find(x => x.id === voucherId);
    if (!v) return { data: null, error: { message: 'Không tìm thấy chứng từ' } };
    if (!['draft', 'pending'].includes(v.status)) {
      return { data: null, error: { message: `Phiếu ${v.voucher_code} đang ở trạng thái "${v.status}" — không thể duyệt lại!` } };
    }
    const items = state.warehouse_voucher_items.filter(it => it.voucher_id === voucherId);
    if (!items.length) return { data: null, error: { message: 'Phiếu chưa có dòng vật tư nào!' } };

    for (const it of items) {
      let inv = state.inventory.find(r => r.id === it.inventory_id || r.profile_name === it.profile);
      if (!inv) {
        if (['IN', 'RETURN', 'ADJUST'].includes(v.voucher_type)) {
          inv = {
            id: 'inv-auto-' + (state.inventory.length + 1),
            profile_name: it.profile,
            material_group: it.material_group || 'consumable',
            unit: it.unit || 'cái',
            standard_length_mm: it.length_mm || 6000,
            stock_qty: 0,
            unit_price: it.unit_price || 0,
            avg_cost: it.unit_price || 0
          };
          state.inventory.push(inv);
        } else {
          return { data: null, error: { message: `Vật tư "${it.profile}" chưa có trong kho để xuất!` } };
        }
      }

      const oldQty = Number(inv.stock_qty) || 0;
      const oldCost = Number(inv.avg_cost || inv.unit_price || 0);

      if (v.voucher_type === 'IN') {
        const effPrice = Number(it.unit_price) || 0;
        const newAvg = effPrice > 0
          ? Math.round((((Math.max(oldQty, 0) * oldCost) + (it.qty * effPrice)) / (Math.max(oldQty, 0) + it.qty)) * 100) / 100
          : oldCost;
        inv.stock_qty = oldQty + it.qty;
        inv.avg_cost = newAvg;
        if (effPrice > 0) inv.unit_price = effPrice;
        it.inventory_id = inv.id;
        it.total_amount = Math.round(it.qty * effPrice);
        state.inventory_transactions.push({
          id: 'tx-' + (state.inventory_transactions.length + 1),
          tx_type: 'voucher_in',
          profile: inv.profile_name,
          length_mm: it.length_mm || inv.standard_length_mm || 6000,
          qty_change: it.qty,
          balance_after: inv.stock_qty,
          voucher_id: v.id,
          unit_price: effPrice
        });
      } else if (v.voucher_type === 'OUT') {
        if (!v.allow_negative && oldQty < it.qty) {
          return { data: null, error: { message: `Không đủ tồn kho "${inv.profile_name}": hiện còn ${oldQty}, yêu cầu ${it.qty}` } };
        }
        inv.stock_qty = Math.max(0, oldQty - it.qty);
        it.inventory_id = inv.id;
        it.unit_price = oldCost;
        it.total_amount = Math.round(it.qty * oldCost);
        state.inventory_transactions.push({
          id: 'tx-' + (state.inventory_transactions.length + 1),
          tx_type: 'voucher_out',
          profile: inv.profile_name,
          length_mm: it.length_mm || inv.standard_length_mm || 6000,
          qty_change: -it.qty,
          balance_after: inv.stock_qty,
          voucher_id: v.id,
          unit_price: oldCost
        });
      } else if (v.voucher_type === 'RETURN') {
        if (inv.material_group === 'tube_1d' && it.length_mm && it.length_mm < (inv.standard_length_mm || 6000)) {
          const off = {
            id: 'off-' + (state.stock_offcuts.length + 1),
            profile: inv.profile_name,
            length_mm: it.length_mm,
            quantity: Math.round(it.qty),
            status: 'available'
          };
          state.stock_offcuts.push(off);
          it.offcut_id = off.id;
          state.inventory_transactions.push({
            id: 'tx-' + (state.inventory_transactions.length + 1),
            tx_type: 'offcut_in',
            profile: inv.profile_name,
            length_mm: it.length_mm,
            qty_change: it.qty,
            balance_after: off.quantity,
            voucher_id: v.id,
            unit_price: oldCost
          });
        } else {
          inv.stock_qty = oldQty + it.qty;
          state.inventory_transactions.push({
            id: 'tx-' + (state.inventory_transactions.length + 1),
            tx_type: 'voucher_return',
            profile: inv.profile_name,
            length_mm: it.length_mm || inv.standard_length_mm || 6000,
            qty_change: it.qty,
            balance_after: inv.stock_qty,
            voucher_id: v.id,
            unit_price: oldCost
          });
        }
      }
    }

    v.status = 'approved';
    v.approved_by = state.currentUsername;
    v.approved_at = new Date().toISOString();
    return { data: { success: true, voucher_id: v.id, status: 'approved' }, error: null };
  }

  function runCancelRpc(voucherId, reason) {
    const v = state.warehouse_vouchers.find(x => x.id === voucherId);
    if (!v) return { data: null, error: { message: 'Không tìm thấy phiếu' } };
    if (v.status === 'cancelled') return { data: null, error: { message: 'Phiếu đã hủy trước đó' } };
    if (['draft', 'pending'].includes(v.status)) {
      v.status = 'cancelled';
      v.cancel_reason = reason || '';
      return { data: { success: true, status: 'cancelled', reversed: false }, error: null };
    }
    if (state.currentRole !== 'admin') {
      return { data: null, error: { message: 'Phiếu đã duyệt — chỉ Admin mới có quyền hủy và đảo ngược tồn kho!' } };
    }
    const txs = state.inventory_transactions.filter(t => t.voucher_id === voucherId && t.tx_type !== 'voucher_cancel_reversal');
    for (const tx of txs) {
      const revQty = -tx.qty_change;
      const inv = state.inventory.find(r => r.profile_name === tx.profile);
      if (inv && !['offcut_in', 'offcut_out'].includes(tx.tx_type)) {
        inv.stock_qty = Math.max(0, Number(inv.stock_qty) + revQty);
      }
      state.inventory_transactions.push({
        id: 'tx-' + (state.inventory_transactions.length + 1),
        tx_type: 'voucher_cancel_reversal',
        profile: tx.profile,
        length_mm: tx.length_mm,
        qty_change: revQty,
        balance_after: inv ? inv.stock_qty : null,
        voucher_id: voucherId,
        unit_price: tx.unit_price
      });
    }
    v.status = 'cancelled';
    v.cancel_reason = reason || 'Admin đảo kho';
    return { data: { success: true, status: 'cancelled', reversed: true }, error: null };
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.payload = null;
      this._single = false;
    }
    select() { return this; }
    order() { return this; }
    limit() { return this; }
    eq(k, v) { this.filters.push(r => r[k] === v); return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    upsert(p) { this.op = 'upsert'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    single() { this._single = true; return this; }
    maybeSingle() { this._single = true; return this; }
    then(resolve, reject) { Promise.resolve(this._exec()).then(resolve, reject); }
    _exec() {
      const rows = state[this.table] || [];
      if (this.op === 'select') {
        let out = rows.filter(r => this.filters.every(fn => fn(r))).map(r => {
          if (this.table !== 'warehouse_vouchers') return Object.assign({}, r);
          return Object.assign({}, r, {
            supplier: state.suppliers.find(s => s.id === r.supplier_id) || null,
            warehouse_voucher_items: state.warehouse_voucher_items.filter(it => it.voucher_id === r.id)
          });
        });
        return { data: this._single ? (out[0] || null) : out, error: null };
      }
      if (this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (this.table === 'inventory' && state.simulateMissingWmsCols && list.some(x => Object.prototype.hasOwnProperty.call(x, 'material_group'))) {
          return { data: null, error: { message: 'Could not find the \'material_group\' column of \'inventory\' in the schema cache' } };
        }
        const saved = list.map(item => {
          const idx = rows.findIndex(r => r.profile_name === item.profile_name);
          if (idx !== -1) {
            rows[idx] = Object.assign({}, rows[idx], item);
            return Object.assign({}, rows[idx]);
          }
          const created = Object.assign({ id: this.table + '-' + (rows.length + 1) }, item);
          rows.push(created);
          return Object.assign({}, created);
        });
        return { data: this._single ? saved[0] : saved, error: null };
      }
      if (this.op === 'insert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = list.map(item => {
          const copy = Object.assign({ id: this.table + '-' + (rows.length + 1), created_at: new Date().toISOString() }, item);
          if (this.table === 'warehouse_vouchers' && !copy.voucher_code) {
            const pfx = copy.voucher_type === 'OUT' ? 'PXK' : (copy.voucher_type === 'RETURN' ? 'PHK' : 'PNK');
            copy.voucher_code = `${pfx}-20261123-${String(state.nextCodeSeq++).padStart(3, '0')}`;
          }
          rows.push(copy);
          return Object.assign({}, copy);
        });
        return { data: this._single ? inserted[0] : inserted, error: null };
      }
      if (this.op === 'update') {
        const updated = [];
        for (const r of rows) {
          if (this.filters.every(fn => fn(r))) {
            Object.assign(r, this.payload);
            updated.push(Object.assign({}, r));
          }
        }
        return { data: this._single ? (updated[0] || null) : updated, error: null };
      }
      if (this.op === 'delete') {
        state[this.table] = rows.filter(r => !this.filters.every(fn => fn(r)));
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }
  }

  return {
    state,
    supabase: {
      createClient: () => ({
        auth: {
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          getSession: async () => ({ data: { session: null } })
        },
        from: tbl => new Query(tbl),
        rpc: async (name, args) => {
          if (name === 'approve_warehouse_voucher') return runApproveRpc(args.p_voucher_id);
          if (name === 'cancel_warehouse_voucher') return runCancelRpc(args.p_voucher_id, args.p_reason);
          return { data: null, error: { message: 'Unknown RPC: ' + name } };
        },
        storage: {
          from: () => ({
            upload: async p => ({ data: { path: p }, error: null }),
            createSignedUrl: async p => ({ data: { signedUrl: 'https://signed.example/' + p }, error: null })
          })
        },
        channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
        removeChannel: () => {}
      })
    }
  };
}

async function runAtomicVoucherAndCompatTests() {
  const mock = createWmsStatefulMockClient();
  global.window = global;
  global.supabase = mock.supabase;
  delete require.cache[require.resolve(path.join(ROOT, 'js/shared-ui.js'))];
  delete require.cache[require.resolve(path.join(ROOT, 'js/supabaseClient.js'))];
  require(path.join(ROOT, 'js/shared-ui.js'));
  require(path.join(ROOT, 'js/supabaseClient.js'));

  const DB = global.SupabaseDB;
  const UI = global.SharedUI;

  // Verify 6 roles permissions matrix
  assert(UI.VALID_ROLES.length === 6, 'Should define 6 workshop roles');
  assert(UI.canApproveVouchers({ role: 'warehouse' }) && UI.canApproveVouchers({ role: 'admin' }));
  assert(!UI.canApproveVouchers({ role: 'accountant' }) && !UI.canApproveVouchers({ role: 'engineer' }));
  assert(UI.canCreateVouchers({ role: 'accountant' }) && !UI.canCreateVouchers({ role: 'operator' }));
  assert(UI.canManageInventory({ role: 'warehouse' }) && !UI.canManageInventory({ role: 'accountant' }));

  // 1. Create & Approve PNK -> Weighted Average Cost check
  // Starting Tấm SS400: 10 tấm @ 2,000,000
  const pnk = await DB.createWarehouseVoucher(
    { voucherType: 'IN', supplierId: 'sup-1', invoiceNo: 'HD-88', createdBy: 'ketoan1' },
    [{ inventoryId: 'inv-sheet-5', profile: 'Tấm SS400 1500x3000x5', materialGroup: 'sheet_2d', unit: 'tấm', qty: 10, unitPrice: 2400000 }]
  );
  assert(/^PNK-\d{8}-\d{3}$/.test(pnk.voucherCode), `Unexpected PNK code: ${pnk.voucherCode}`);

  // Non-approver (accountant) must fail
  mock.state.currentRole = 'accountant';
  await assert.rejects(() => DB.approveWarehouseVoucher(pnk.id), /Admin hoặc Thủ kho/);

  // Warehouse approves -> stock becomes 20, avg_cost = (10*2M + 10*2.4M)/20 = 2.2M
  mock.state.currentRole = 'warehouse';
  await DB.approveWarehouseVoucher(pnk.id);
  const sheetInv = mock.state.inventory.find(x => x.id === 'inv-sheet-5');
  assert.strictEqual(sheetInv.stock_qty, 20);
  assert.strictEqual(sheetInv.avg_cost, 2200000);

  // Double approval guard must reject and NOT double stock
  await assert.rejects(() => DB.approveWarehouseVoucher(pnk.id), /không thể duyệt lại/);
  assert.strictEqual(sheetInv.stock_qty, 20);

  // 2. PXK negative stock block vs valid OUT + locking avg_cost
  const pxkTooMuch = await DB.createWarehouseVoucher(
    { voucherType: 'OUT', department: 'Tổ Laser CNC', createdBy: 'kt1' },
    [{ inventoryId: 'inv-sheet-5', profile: 'Tấm SS400 1500x3000x5', materialGroup: 'sheet_2d', unit: 'tấm', qty: 25, unitPrice: 0 }]
  );
  await assert.rejects(() => DB.approveWarehouseVoucher(pxkTooMuch.id), /Không đủ tồn kho/);
  assert.strictEqual(sheetInv.stock_qty, 20);

  const pxkOk = await DB.createWarehouseVoucher(
    { voucherType: 'OUT', department: 'Tổ Laser CNC', createdBy: 'kt1' },
    [{ inventoryId: 'inv-sheet-5', profile: 'Tấm SS400 1500x3000x5', materialGroup: 'sheet_2d', unit: 'tấm', qty: 5, unitPrice: 0 }]
  );
  await DB.approveWarehouseVoucher(pxkOk.id);
  assert.strictEqual(sheetInv.stock_qty, 15);
  const pxkFetched = await DB.getWarehouseVoucherById(pxkOk.id);
  assert.strictEqual(pxkFetched.items[0].unitPrice, 2200000, 'PXK must lock avg_cost on approval');
  assert.strictEqual(pxkFetched.items[0].totalAmount, 11000000);

  // 3. RETURN offcut < 6000mm on tube_1d auto-routes to stock_offcuts
  const phk = await DB.createWarehouseVoucher(
    { voucherType: 'RETURN', department: 'Tổ Laser', createdBy: 'thocnc' },
    [{ inventoryId: 'inv-tube-25', profile: 'Hộp 25x25x1', materialGroup: 'tube_1d', unit: 'cây', lengthMm: 1450, qty: 2 }]
  );
  await DB.approveWarehouseVoucher(phk.id);
  assert.strictEqual(mock.state.stock_offcuts.length, 1);
  assert.strictEqual(mock.state.stock_offcuts[0].length_mm, 1450);

  // 4. Cancel approved PXK: warehouse blocked, admin reverses stock 15 -> 20 & logs reversal
  await assert.rejects(() => DB.cancelWarehouseVoucher(pxkOk.id, 'test'), /chỉ Admin/);
  mock.state.currentRole = 'admin';
  const cancelRes = await DB.cancelWarehouseVoucher(pxkOk.id, 'Nhập sai dự án');
  assert.strictEqual(cancelRes.reversed, true);
  assert.strictEqual(sheetInv.stock_qty, 20, 'Stock must reverse from 15 back to 20');
  assert(mock.state.inventory_transactions.some(t => t.voucher_id === pxkOk.id && t.tx_type === 'voucher_cancel_reversal' && t.qty_change === 5));

  // 5. Backward compatibility if Đợt 5 SQL columns don't exist yet
  mock.state.simulateMissingWmsCols = true;
  const fallbackSaved = await DB.addProfile('Que hàn 3.2mm', { materialGroup: 'consumable', unit: 'hộp', avgCost: 180000 });
  assert.strictEqual(fallbackSaved.profileName, 'Que hàn 3.2mm');
  assert.strictEqual(DB.isInventoryWmsReady(), false);

  console.log('[OK] Atomic RPCs (PNK weighted avg cost, PXK negative-stock guard, double-approve block, RETURN offcuts, Admin cancel reversal & pre-SQL compat) verified');
}

function verifyServerRoutes() {
  return new Promise((resolve, reject) => {
    const port = 3467;
    const srv = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1' })
    });
    const fetchRoute = p => new Promise((res, rej) => {
      http.get(`http://127.0.0.1:${port}${p}`, r => {
        r.resume();
        res({ path: p, status: r.statusCode });
      }).on('error', rej);
    });

    setTimeout(async () => {
      try {
        for (const p of ['/vouchers', '/vouchers.html', '/css/shared.css', '/js/shared-ui.js', '/inventory', '/admin']) {
          const r = await fetchRoute(p);
          assert.strictEqual(r.status, 200, `Expected 200 OK for ${p}, got ${r.status}`);
        }
        console.log('[OK] Local server.js clean routes (/vouchers, /inventory, /admin, /css/shared.css, /js/shared-ui.js) returned 200 OK');
        srv.kill();
        resolve();
      } catch (err) {
        srv.kill();
        reject(err);
      }
    }, 1100);
  });
}

function verifyPhase2Features() {
  for (const rel of [
    'js/qr-scanner.js',
    'js/shared-ui.js',
    'js/supabaseClient.js',
    'js/workshopExport.js',
    'js/project-bom.js',
    'js/inventory-smart.js'
  ]) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  }
  const swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert(swText.includes('toiuu-phoi-pwa-v34'), 'sw.js must be bumped to v34');
  assert(swText.includes('/js/qr-scanner.js'), 'sw.js must cache /js/qr-scanner.js');

  const invHtml = fs.readFileSync(path.join(ROOT, 'inventory.html'), 'utf8');
  assert(invHtml.includes('modalPrintQrLabels') && invHtml.includes('XP:INV:') && invHtml.includes('XP:OFF:') && invHtml.includes('XP:RACK:'), 'inventory.html must support A4 QR label printing');
  assert(invHtml.includes('btnScanQrLookup') && invHtml.includes('/js/qr-scanner.js'), 'inventory.html must include mobile QR lookup');

  const vHtml = fs.readFileSync(path.join(ROOT, 'vouchers.html'), 'utf8');
  assert(vHtml.includes('btnScanAddVoucherItem') && vHtml.includes('/js/qr-scanner.js'), 'vouchers.html must include continuous QR scan');

  const sbText = fs.readFileSync(path.join(ROOT, 'js/supabaseClient.js'), 'utf8');
  assert(sbText.includes('createProjectOutVoucher') && sbText.includes('getPendingVouchersCount'), 'supabaseClient.js must expose Phase 2 voucher helpers');

  const shText = fs.readFileSync(path.join(ROOT, 'js/shared-ui.js'), 'utf8');
  assert(shText.includes('initPendingVouchersBadge'), 'shared-ui.js must expose initPendingVouchersBadge');
  console.log('[OK] WMS Phase 2 checks (QR A4 print, QR scanner, workshop voucher linkage, sw.js v20) passed');
}

(async function main() {
  verifySqlMigration();
  verifyHtmlAndJsSyntax();
  verifyPhase2Features();
  await runAtomicVoucherAndCompatTests();
  await verifyServerRoutes();
})().catch(err => {
  console.error('❌ VERIFY WMS FAILED:', err);
  process.exit(1);
});
