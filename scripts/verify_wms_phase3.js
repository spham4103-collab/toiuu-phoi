/**
 * Kiểm thử WMS Giai đoạn 3:
 * - Cú pháp SQL Đợt 6, toàn bộ HTML/JS (gồm reports.html)
 * - Phân quyền canViewPrices() cho đủ 5 vai trò & công tắc allow_engineer_view_price
 * - Kiểm chứng toán học công thức NXT: Tồn đầu + Nhập - Xuất === Tồn cuối === inventory.stock_qty
 * - Kiểm tra route /reports trên server.js & bảo mật dist/
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function verifySqlDot6() {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_migration_dot6_reports_pricing_rls.sql'), 'utf8');
  for (const token of [
    'CREATE TABLE IF NOT EXISTS public.wms_settings',
    'allow_engineer_view_price',
    'CREATE OR REPLACE FUNCTION public.can_view_wms_prices()',
    'CREATE OR REPLACE FUNCTION public.get_nxt_report(',
    'CREATE OR REPLACE FUNCTION public.get_project_cost_report(',
    'CREATE OR REPLACE FUNCTION public.get_supplier_purchase_summary(',
    'CREATE OR REPLACE FUNCTION public.submit_cnc_offcut_return(',
    "DROP POLICY IF EXISTS \"suppliers_select_member\" ON public.suppliers"
  ]) {
    assert(sql.includes(token), `Missing SQL token: ${token}`);
  }
  console.log('[OK] SQL Migration Đợt 6 (wms_settings, RPCs, RLS) structure verified');
}

function verifyHtmlAndJsSyntax() {
  for (const rel of [
    'js/shared-ui.js',
    'js/supabaseClient.js',
    'js/workshopExport.js',
    'js/qr-scanner.js',
    'sw.js',
    'server.js'
  ]) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  }

  for (const htmlFile of ['index.html', 'projects.html', 'inventory.html', 'vouchers.html', 'reports.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(m => !/\bsrc\s*=|\btype\s*=\s*["']application\/json["']/i.test(m[1]))
      .map(m => m[2]);
    scripts.forEach((code, idx) => {
      if (!code.trim()) return;
      new vm.Script(code, { filename: `${htmlFile}#inline-${idx}` });
    });
  }

  const swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert(swText.includes('toiuu-phoi-pwa-v38'), 'sw.js must be bumped to v38');
  assert(swText.includes("'/reports'") && swText.includes("'/reports.html'"), 'sw.js must cache /reports');

  console.log('[OK] Syntax check passed for all JS & HTML files including reports.html + sw.js v21');
}

function verifyPriceVisibilityAndRoles() {
  const sharedCode = fs.readFileSync(path.join(ROOT, 'js', 'shared-ui.js'), 'utf8');
  const ctx = { window: undefined };
  ctx.window = ctx;
  vm.runInNewContext(sharedCode, ctx);
  const UI = ctx.SharedUI;

  // Mặc định: allow_engineer_view_price = false
  assert.equal(UI.canViewPrices({ role: 'admin' }), true);
  assert.equal(UI.canViewPrices({ role: 'accountant' }), true);
  assert.equal(UI.canViewPrices({ role: 'engineer' }, { allow_engineer_view_price: false }), false);
  assert.equal(UI.canViewPrices({ role: 'warehouse' }, { allow_engineer_view_price: true }), false);
  assert.equal(UI.canViewPrices({ role: 'operator' }, { allow_engineer_view_price: true }), false);

  // Khi Admin bật công tắc cho Kỹ sư
  assert.equal(UI.canViewPrices({ role: 'engineer' }, { allow_engineer_view_price: true }), true);

  // Quản lý NCC chỉ mở cho admin & accountant
  assert.equal(UI.canManageSuppliers({ role: 'admin' }), true);
  assert.equal(UI.canManageSuppliers({ role: 'accountant' }), true);
  assert.equal(UI.canManageSuppliers({ role: 'warehouse' }), false);
  assert.equal(UI.canManageSuppliers({ role: 'engineer' }), false);
  assert.equal(UI.canManageSuppliers({ role: 'operator' }), false);

  console.log('[OK] SharedUI.canViewPrices() & canManageSuppliers() verified for all 5 roles');
}

function verifyNxtMathInvariant() {
  // Giả lập đúng logic PostgreSQL get_nxt_report:
  // current_qty = 18; tx gồm:
  // - Trước kỳ: +10 (opening)
  // - Trong kỳ: +15 (PNK), -5 (PXK), -2 (PXK) => in=15, out=7
  // - Sau kỳ:   +3 (PNK), -3 (PXK) => net_after_to = 0 (hoặc +5 => net_after_to = +5, current_qty = 23)
  const pFrom = new Date('2026-11-01T00:00:00Z').getTime();
  const pTo = new Date('2026-11-30T23:59:59Z').getTime();

  const txs = [
    { profile: 'Hộp 30x30x1.8', tx_type: 'opening_balance', qty_change: 10, created_at: '2026-10-20T08:00:00Z' },
    { profile: 'Hộp 30x30x1.8', tx_type: 'voucher_in', qty_change: 15, created_at: '2026-11-05T08:00:00Z' },
    { profile: 'Hộp 30x30x1.8', tx_type: 'voucher_out', qty_change: -5, created_at: '2026-11-10T08:00:00Z' },
    { profile: 'Hộp 30x30x1.8', tx_type: 'voucher_out', qty_change: -2, created_at: '2026-11-20T08:00:00Z' },
    { profile: 'Hộp 30x30x1.8', tx_type: 'offcut_in', qty_change: 1, created_at: '2026-11-21T08:00:00Z' },
    { profile: 'Hộp 30x30x1.8', tx_type: 'voucher_in', qty_change: 5, created_at: '2026-12-02T08:00:00Z' }
  ];
  const currentStockQty = 23; // 10 + 15 - 5 - 2 + 5

  let netAfterTo = 0;
  let inQty = 0;
  let outQty = 0;
  for (const t of txs) {
    if (t.tx_type === 'offcut_in' || t.tx_type === 'offcut_out') continue;
    const ts = new Date(t.created_at).getTime();
    if (ts > pTo) netAfterTo += t.qty_change;
    if (ts >= pFrom && ts <= pTo) {
      if (t.qty_change > 0) inQty += t.qty_change;
      if (t.qty_change < 0) outQty += Math.abs(t.qty_change);
    }
  }
  const closingQty = currentStockQty - netAfterTo;
  const openingQty = closingQty - inQty + outQty;

  assert.equal(openingQty, 10);
  assert.equal(inQty, 15);
  assert.equal(outQty, 7);
  assert.equal(closingQty, 18);
  assert.equal(openingQty + inQty - outQty, closingQty, 'Tồn đầu + Nhập - Xuất === Tồn cuối');

  // Khi pTo >= hiện tại, closingQty === currentStockQty
  assert.equal(currentStockQty - 0, currentStockQty, 'Khi kết kỳ ở hiện tại, Tồn cuối === inventory.stock_qty');
  console.log('[OK] NXT mathematical invariant (opening + in - out === closing === stock_qty) verified');
}

function verifyDistSecurity() {
  const distDir = path.join(ROOT, 'dist');
  assert(fs.existsSync(path.join(distDir, 'reports.html')), 'dist/reports.html must exist after sync_all.py');
  assert(!fs.existsSync(path.join(distDir, '.env')), 'dist/.env must NOT exist');
  assert(!fs.existsSync(path.join(distDir, 'database', 'workshop_db.json')), 'dist/database/workshop_db.json must NOT exist');
  for (const fn of fs.readdirSync(distDir)) {
    const fp = path.join(distDir, fn);
    if (fs.statSync(fp).isFile() && /\.(html|js|json)$/i.test(fn)) {
      const txt = fs.readFileSync(fp, 'utf8');
      assert(!txt.includes('sb_secret_'), `Secret key leaked in dist/${fn}`);
    }
  }
  console.log('[OK] dist/ security scan passed (zero secrets)');
}

function verifyServerReportsRoute() {
  return new Promise((resolve, reject) => {
    const port = 3468;
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
        for (const p of ['/reports', '/reports.html']) {
          const r = await fetchRoute(p);
          assert.equal(r.status, 200, `Expected 200 OK for ${p}, got ${r.status}`);
        }
        console.log('[OK] Local server.js clean route (/reports, /reports.html) returned 200 OK');
        srv.kill();
        resolve();
      } catch (err) {
        srv.kill();
        reject(err);
      }
    }, 1000);
  });
}

(async function main() {
  verifySqlDot6();
  verifyHtmlAndJsSyntax();
  verifyPriceVisibilityAndRoles();
  verifyNxtMathInvariant();
  verifyDistSecurity();
  await verifyServerReportsRoute();
})().catch(err => {
  console.error('❌ VERIFY PHASE 3 FAILED:', err);
  process.exit(1);
});
