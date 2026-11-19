import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('C:/Users/Administrator/toiuu-phoi');

function loadIifeInVm(filePath, extraGlobals = {}) {
  const code = fs.readFileSync(filePath, 'utf8');
  const ctx = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    URL: globalThis.URL,
    Blob: globalThis.Blob || undefined,
    ...extraGlobals
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: path.basename(filePath) });
  return ctx;
}

function makeMockSupabaseSdk(dbState, options = {}) {
  const opts = { preMigration: false, ...options };

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.orderCol = null;
      this.orderAsc = true;
      this.limitNum = null;
      this.op = 'select';
      this.payload = null;
      this.upsertOpts = null;
      this.expectSingle = false;
      this.expectMaybeSingle = false;
      this.returnSelect = false;
    }
    select() {
      if (this.op !== 'insert' && this.op !== 'update' && this.op !== 'upsert' && this.op !== 'delete') {
        this.op = 'select';
      } else {
        this.returnSelect = true;
      }
      return this;
    }
    insert(row) {
      this.op = 'insert';
      this.payload = row;
      return this;
    }
    upsert(row, uOpts) {
      this.op = 'upsert';
      this.payload = row;
      this.upsertOpts = uOpts || {};
      return this;
    }
    update(patch) {
      this.op = 'update';
      this.payload = patch;
      return this;
    }
    delete() {
      this.op = 'delete';
      return this;
    }
    eq(col, val) {
      this.filters.push(r => r[col] === val);
      return this;
    }
    gt(col, val) {
      this.filters.push(r => Number(r[col]) > Number(val));
      return this;
    }
    gte(col, val) {
      this.filters.push(r => String(r[col] || '') >= String(val));
      return this;
    }
    lte(col, val) {
      this.filters.push(r => String(r[col] || '') <= String(val));
      return this;
    }
    in(col, arr) {
      this.filters.push(r => Array.isArray(arr) && arr.includes(r[col]));
      return this;
    }
    order(col, { ascending = true } = {}) {
      this.orderCol = col;
      this.orderAsc = ascending;
      return this;
    }
    limit(n) {
      this.limitNum = n;
      return this;
    }
    single() {
      this.expectSingle = true;
      return this;
    }
    maybeSingle() {
      this.expectMaybeSingle = true;
      return this;
    }
    then(resolve, reject) {
      return Promise.resolve(this._exec()).then(resolve, reject);
    }
    _exec() {
      if (opts.preMigration && this.table === 'inventory_transactions') {
        return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.inventory_transactions' in the schema cache" } };
      }

      const enhancedInvCols = ['standard_length_mm', 'min_stock_qty', 'weight_per_m', 'unit_price', 'rack_location'];
      const enhancedOffCols = ['source_type', 'rack_location', 'status', 'note'];
      const checkMissingCols = (obj, cols) => {
        const list = Array.isArray(obj) ? obj : [obj];
        for (const item of list) {
          if (!item) continue;
          for (const c of cols) {
            if (Object.prototype.hasOwnProperty.call(item, c)) {
              return { data: null, error: { code: 'PGRST204', message: `Could not find the '${c}' column of '${this.table}' in the schema cache` } };
            }
          }
        }
        return null;
      };

      const rows = dbState[this.table] || [];
      if (this.op === 'select') {
        let out = rows.filter(r => this.filters.every(fn => fn(r)));
        if (this.orderCol) {
          out.sort((a, b) => {
            const va = String(a[this.orderCol] || '');
            const vb = String(b[this.orderCol] || '');
            return this.orderAsc ? va.localeCompare(vb) : vb.localeCompare(va);
          });
        }
        if (this.limitNum != null) out = out.slice(0, this.limitNum);
        out = out.map(clone);
        if (this.expectMaybeSingle) return { data: out[0] || null, error: null };
        if (this.expectSingle) return out[0] ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'No rows' } };
        return { data: out, error: null };
      }

      if (this.op === 'insert') {
        if (opts.preMigration && this.table === 'stock_offcuts') {
          const miss = checkMissingCols(this.payload, enhancedOffCols);
          if (miss) return miss;
        }
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = [];
        for (const raw of items) {
          const rec = {
            id: raw.id || `uuid_${this.table}_${++dbState._seq}`,
            created_at: raw.created_at || new Date(1700000000000 + dbState._seq * 1000).toISOString(),
            updated_at: raw.updated_at || new Date(1700000000000 + dbState._seq * 1000).toISOString(),
            ...clone(raw)
          };
          if (this.table === 'stock_offcuts' && rec.source_project_id && rec.source_bar_key) {
            const dup = rows.some(r => r.source_project_id === rec.source_project_id && r.source_bar_key === rec.source_bar_key);
            if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          rows.push(rec);
          inserted.push(clone(rec));
        }
        if (this.expectSingle) return { data: inserted[0], error: null };
        return { data: inserted, error: null };
      }

      if (this.op === 'upsert') {
        if (opts.preMigration && this.table === 'inventory') {
          const miss = checkMissingCols(this.payload, enhancedInvCols);
          if (miss) return miss;
        }
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const conflictCol = (this.upsertOpts && this.upsertOpts.onConflict) || 'id';
        const ignoreDups = Boolean(this.upsertOpts && this.upsertOpts.ignoreDuplicates);
        const saved = [];
        for (const raw of items) {
          const idx = rows.findIndex(r => r[conflictCol] === raw[conflictCol]);
          if (idx >= 0) {
            if (!ignoreDups) {
              rows[idx] = { ...rows[idx], ...clone(raw), updated_at: new Date().toISOString() };
              saved.push(clone(rows[idx]));
            }
          } else {
            const rec = {
              id: raw.id || `uuid_${this.table}_${++dbState._seq}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...clone(raw)
            };
            rows.push(rec);
            saved.push(clone(rec));
          }
        }
        if (this.expectSingle) return { data: saved[0], error: null };
        return { data: saved, error: null };
      }

      if (this.op === 'update') {
        if (opts.preMigration && this.table === 'projects' && Object.prototype.hasOwnProperty.call(this.payload, 'inventory_deducted_at')) {
          return { data: null, error: { code: 'PGRST204', message: "Could not find the 'inventory_deducted_at' column of 'projects' in the schema cache" } };
        }
        if (opts.preMigration && this.table === 'inventory') {
          const miss = checkMissingCols(this.payload, enhancedInvCols);
          if (miss) return miss;
        }
        if (opts.preMigration && this.table === 'stock_offcuts') {
          const miss = checkMissingCols(this.payload, enhancedOffCols);
          if (miss) return miss;
        }
        const updated = [];
        for (let i = 0; i < rows.length; i++) {
          if (this.filters.every(fn => fn(rows[i]))) {
            rows[i] = { ...rows[i], ...clone(this.payload) };
            updated.push(clone(rows[i]));
          }
        }
        if (this.expectSingle) return updated[0] ? { data: updated[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'Not found' } };
        return { data: updated, error: null };
      }

      if (this.op === 'delete') {
        dbState[this.table] = rows.filter(r => !this.filters.every(fn => fn(r)));
        return { data: [], error: null };
      }

      return { data: null, error: null };
    }
  }

  return {
    createClient() {
      return {
        auth: {
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          getSession: async () => ({ data: { session: null } })
        },
        from: (table) => new QueryBuilder(table),
        channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
        removeChannel: () => {}
      };
    }
  };
}

function checkInlineScripts() {
  const htmlFiles = ['index.html', 'inventory.html', 'cnc.html', 'projects.html', 'admin.html'];
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
    assert(count >= 1, `${rel} should have at least 1 inline script`);
  }

  for (const jsRel of ['js/supabaseClient.js', 'js/workshopExport.js', 'toi-uu-engine.js', 'sw.js']) {
    execSync(`node --check "${path.join(ROOT, jsRel)}"`, { stdio: 'pipe' });
  }
}

async function runSupabaseClientUnitTests() {
  const db = {
    _seq: 1,
    inventory: [
      { id: 'inv_1', profile_name: 'Hộp 30x30x1.8', category: 'square', standard_length: 6000, standard_length_mm: 6000, stock_qty: 0, min_stock_qty: 5, weight_per_m: 1.56, unit_price: 185000, rack_location: 'Kệ A1', notes: '', is_default: true },
      { id: 'inv_2', profile_name: 'Hộp 40x80x2.0', category: 'rect', standard_length: 6000, standard_length_mm: 6000, stock_qty: 12, min_stock_qty: 4, weight_per_m: 3.64, unit_price: 390000, rack_location: 'Kệ B2', notes: '', is_default: true }
    ],
    stock_offcuts: [],
    inventory_transactions: [],
    projects: [
      { id: 'proj_101', name: 'Cổng sắt CNC 101', is_locked: false, is_trashed: false, is_draft: false, data: {} }
    ]
  };

  const mockSdk = makeMockSupabaseSdk(db, { preMigration: false });
  const ctx = loadIifeInVm(path.join(ROOT, 'js/supabaseClient.js'), { supabase: mockSdk });
  const SB = ctx.SupabaseDB;

  // 1. Weight estimator
  const w30 = SB.estimateSteelWeightPerM('Hộp 30x30x1.8');
  assert(w30 > 1.5 && w30 < 1.7, `Unexpected weight for 30x30x1.8: ${w30}`);
  const wPipe = SB.estimateSteelWeightPerM('Ống Ø27x1.4');
  assert(wPipe > 0.85 && wPipe < 0.95, `Unexpected weight for Ø27x1.4: ${wPipe}`);

  // 2. Opening balance full bars
  const obBarsRes = await SB.saveOpeningBalanceBars([
    { profileName: 'Hộp 30x30x1.8', stockQty: 20, standardLengthMm: 6000, rackLocation: 'Kệ A1', minStockQty: 5 },
    { profileName: 'Hộp 50x50x2.0', stockQty: 6, standardLengthMm: 6000, rackLocation: 'Kệ C1', minStockQty: 2 }
  ], 'kt1');
  assert.equal(obBarsRes.txCount, 2);
  const invAfterOb = await SB.getInventory();
  assert.equal(invAfterOb.find(x => x.profileName === 'Hộp 30x30x1.8').stockQty, 20);
  assert.equal(invAfterOb.find(x => x.profileName === 'Hộp 50x50x2.0').stockQty, 6);

  // 3. Opening balance offcuts
  const obOffRes = await SB.saveOpeningBalanceOffcuts([
    { profile: 'Hộp 30x30x1.8', lengthMm: 2450, quantity: 2, rackLocation: 'Kệ B1', note: 'Phôi cũ' }
  ], 'kt1');
  assert.equal(obOffRes.count, 1);
  assert.equal(obOffRes.savedItems[0].sourceType, 'opening_stock');
  assert.equal(obOffRes.savedItems[0].status, 'available');

  // 4. Purchase In
  const purRes = await SB.purchaseInInventory({ profile: 'Hộp 30x30x1.8', qty: 10, note: 'Hòa Phát HD01', createdBy: 'kt1' });
  assert.equal(purRes.item.stockQty, 30);
  assert.equal(purRes.transaction.txType, 'purchase_in');
  assert.equal(purRes.transaction.qtyChange, 10);
  assert.equal(purRes.transaction.balanceAfter, 30);

  // 5. Stocktake Adjust (mandatory reason check + signed delta)
  await assert.rejects(
    () => SB.stocktakeAdjustInventory({ profile: 'Hộp 30x30x1.8', actualQty: 28, reason: '', createdBy: 'kt1' }),
    /lý do/i
  );
  const stRes = await SB.stocktakeAdjustInventory({ profile: 'Hộp 30x30x1.8', actualQty: 28, reason: 'Kiểm kê thiếu 2 cây rỉ sét', createdBy: 'kt1' });
  assert.equal(stRes.delta, -2);
  assert.equal(stRes.item.stockQty, 28);

  // 6. Operator CNC offcut return logs 'offcut_in'
  const cncOff = await SB.addStockOffcut({
    profile: 'Hộp 40x80x2.0',
    lengthMm: 1650,
    quantity: 1,
    sourceProjectId: 'proj_101',
    sourceProjectName: 'Cổng sắt CNC 101',
    sourceBarKey: 'Hộp 40x80x2.0__A',
    sourceType: 'cnc_return',
    createdBy: 'thocnc',
    txType: 'offcut_in',
    logTx: true
  });
  assert.equal(cncOff.sourceType, 'cnc_return');
  assert(db.inventory_transactions.some(t => t.tx_type === 'offcut_in' && t.created_by === 'thocnc' && t.qty_change === 1));

  // 7. Dispatch Project + Anti-Duplicate Guard + Return Project
  const offIdToUse = obOffRes.savedItems[0].id;
  const disp1 = await SB.dispatchProjectInventory({
    projectId: 'proj_101',
    projectName: 'Cổng sắt CNC 101',
    fullBarsByProfile: [{ profile: 'Hộp 30x30x1.8', qty: 8, lengthMm: 6000 }],
    offcutsUsed: [{ id: offIdToUse, profile: 'Hộp 30x30x1.8', lengthMm: 2450, usedQty: 2 }],
    createdBy: 'kt1'
  });
  assert.equal(disp1.totalFullDeducted, 8);
  assert.equal(disp1.totalOffcutsDeducted, 2);
  assert.equal((await SB.getInventory()).find(x => x.profileName === 'Hộp 30x30x1.8').stockQty, 20);
  const availAfterDisp = await SB.getStockOffcuts({ onlyAvailable: true });
  assert(!availAfterDisp.some(o => o.id === offIdToUse), 'Used offcut should no longer appear in available list');

  // Attempt 2 MUST fail via both flag check & ledger check!
  await assert.rejects(
    () => SB.dispatchProjectInventory({
      projectId: 'proj_101',
      projectName: 'Cổng sắt CNC 101',
      projectDeductedAt: disp1.deductedAt,
      fullBarsByProfile: [{ profile: 'Hộp 30x30x1.8', qty: 8, lengthMm: 6000 }],
      offcutsUsed: [],
      createdBy: 'kt1'
    }),
    err => err.code === 'ALREADY_DISPATCHED'
  );
  await assert.rejects(
    () => SB.dispatchProjectInventory({
      projectId: 'proj_101',
      projectName: 'Cổng sắt CNC 101',
      projectDeductedAt: null, // Even without client flag, DB ledger check blocks it!
      fullBarsByProfile: [{ profile: 'Hộp 30x30x1.8', qty: 8, lengthMm: 6000 }],
      offcutsUsed: [],
      createdBy: 'kt1'
    }),
    err => err.code === 'ALREADY_DISPATCHED'
  );
  // Ensure stock_qty didn't change
  assert.equal((await SB.getInventory()).find(x => x.profileName === 'Hộp 30x30x1.8').stockQty, 20);

  // Return Project Inventory restores exact bars and offcut
  const retRes = await SB.returnProjectInventory({
    projectId: 'proj_101',
    projectName: 'Cổng sắt CNC 101',
    snapshot: { fullBars: disp1.fullBars, offcuts: disp1.offcuts },
    createdBy: 'kt1'
  });
  assert.equal(retRes.totalFullReturned, 8);
  assert.equal(retRes.totalOffcutsReturned, 2);
  assert.equal((await SB.getInventory()).find(x => x.profileName === 'Hộp 30x30x1.8').stockQty, 28);
  const availAfterRet = await SB.getStockOffcuts({ onlyAvailable: true });
  assert.equal(availAfterRet.find(o => o.id === offIdToUse).quantity, 2);

  // Re-dispatch after return MUST succeed cleanly!
  const disp2 = await SB.dispatchProjectInventory({
    projectId: 'proj_101',
    projectName: 'Cổng sắt CNC 101',
    fullBarsByProfile: [{ profile: 'Hộp 30x30x1.8', qty: 5, lengthMm: 6000 }],
    offcutsUsed: [],
    createdBy: 'kt1'
  });
  assert.equal(disp2.totalFullDeducted, 5);
  assert.equal((await SB.getInventory()).find(x => x.profileName === 'Hộp 30x30x1.8').stockQty, 23);

  // 8. Pre-Migration Backward Compatibility Tests
  const legacyDb = {
    _seq: 1,
    inventory: [{ id: 'i1', profile_name: 'Hộp 30x30x1.8', category: 'square', standard_length: 6000, stock_qty: null, notes: '', is_default: true }],
    stock_offcuts: [],
    projects: [{ id: 'p_leg', name: 'Legacy', is_locked: false, data: {} }]
  };
  const legacySdk = makeMockSupabaseSdk(legacyDb, { preMigration: true });
  const legCtx = loadIifeInVm(path.join(ROOT, 'js/supabaseClient.js'), { supabase: legacySdk });
  const SBL = legCtx.SupabaseDB;
  const legTxs = await SBL.getInventoryTransactions();
  assert.equal(Array.isArray(legTxs) && legTxs.length === 0, true);
  assert.equal(SBL.isLedgerTableReady(), false);
  const legInv = await SBL.getInventory();
  assert.equal(legInv[0].stockQty, 0);
  const legAdded = await SBL.addProfile('Hộp 25x25x1.4', { rackLocation: 'Kệ Z' });
  assert.equal(legAdded.profileName, 'Hộp 25x25x1.4');
  assert.equal(SBL.isInventoryEnhancedReady(), false);
  const legOff = await SBL.addStockOffcut({ profile: 'Hộp 30x30x1.8', lengthMm: 1400, quantity: 1, sourceType: 'opening_stock' });
  assert.equal(legOff.lengthMm, 1400);
  const legUpdProj = await SBL.updateProjectFields('p_leg', { name: 'Legacy OK', inventoryDeductedAt: new Date().toISOString() });
  assert.equal(legUpdProj.name, 'Legacy OK');
}

function runWorkshopExportTests() {
  const ctx = loadIifeInVm(path.join(ROOT, 'js/workshopExport.js'));
  const WE = ctx.WorkshopExport;

  const paste = [
    'Quy cách\tChiều dài (mm)\tSố lượng\tVị trí kệ\tGhi chú',
    'Hộp 30x30x1.8\t2.450\t3\tKệ B1\tPhôi lẻ cũ',
    '1\tHộp 40x80x2.0\t1,850\t2\tKệ A2\tDư cắt cổng',
    'Ống Ø27x1.4;1200;4;Kệ C1;Ống dư'
  ].join('\n');

  const parsed = WE.parseOffcutsPasteText(paste);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].profile, 'Hộp 30x30x1.8');
  assert.equal(parsed.rows[0].lengthMm, 2450);
  assert.equal(parsed.rows[0].quantity, 3);
  assert.equal(parsed.rows[1].profile, 'Hộp 40x80x2.0');
  assert.equal(parsed.rows[1].lengthMm, 1850);
  assert.equal(parsed.rows[2].profile, 'Ống Ø27x1.4');
  assert.equal(parsed.rows[2].quantity, 4);

  const rep = WE.buildInventoryReportSheetsData({
    inventoryItems: [{ profileName: 'Hộp 30x30x1.8', category: 'square', standardLengthMm: 6000, stockQty: 2, minStockQty: 5, weightPerM: 1.56, unitPrice: 185000, rackLocation: 'Kệ A1' }],
    stockOffcuts: [{ profile: 'Hộp 30x30x1.8', lengthMm: 2450, quantity: 3, sourceType: 'opening_stock', status: 'available', rackLocation: 'Kệ B1', note: 'Phôi cũ', createdBy: 'kt1' }],
    transactions: [{ createdAt: new Date().toISOString(), txType: 'opening_balance', profile: 'Hộp 30x30x1.8', lengthMm: 6000, qtyChange: 2, balanceAfter: 2, projectId: null, note: 'Đầu kỳ', createdBy: 'kt1' }],
    exportedBy: 'kt1'
  });
  assert.equal(rep.sheetBars.length, 5);
  assert.equal(rep.sheetBars[4][6], 'Sắp hết hàng');
  assert.equal(rep.sheetOffcuts.length, 5);
  assert.equal(rep.sheetOffcuts[4][5], 'Phôi cũ đầu kỳ');
  assert.equal(rep.sheetLedger.length, 5);
  assert.equal(rep.sheetLedger[4][2], 'Tồn đầu kỳ');
}

function verifySqlAndSecurity() {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_migration_dot4_inventory_ledger.sql'), 'utf8');
  assert(/REVOKE ALL ON TABLE public\.inventory, public\.stock_offcuts, public\.inventory_transactions FROM anon/i.test(sql), 'Must revoke anon');
  assert(/ALTER TABLE public\.inventory_transactions ENABLE ROW LEVEL SECURITY/i.test(sql), 'Must enable RLS on inventory_transactions');
  assert(/tx_type = 'offcut_in'[\s\S]*qty_change > 0/i.test(sql), 'Operator insert policy must restrict to offcut_in');
  assert(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.inventory_transactions/i.test(sql), 'Must add inventory_transactions to Realtime');

  // Verify no leaked secrets in dist or frontend files
  const scanDirs = [path.join(ROOT, 'dist'), path.join(ROOT, 'js')];
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/\.(html|js|json|css)$/i.test(ent.name)) {
          assert(!/workshop_db\.json$/i.test(ent.name), `Sensitive file found in ${full}`);
          const content = fs.readFileSync(full, 'utf8');
          assert(!/sb_secret_/i.test(content), `Secret key leaked in ${full}`);
        }
      }
    };
    walk(dir);
  }
}

async function main() {
  checkInlineScripts();
  console.log('[OK] Syntax check passed for all JS modules and all 5 HTML inline scripts');
  await runSupabaseClientUnitTests();
  console.log('[OK] SupabaseDB Đợt 4 inventory/ledger/dispatch/return/anti-duplicate/pre-migration tests passed');
  runWorkshopExportTests();
  console.log('[OK] WorkshopExport Excel/Paste parser & multi-sheet warehouse report tests passed');
  verifySqlAndSecurity();
  console.log('[OK] SQL RLS policy check & dist/ security scan passed');
}

main().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
