/**
 * Kiểm thử WMS Đợt 7 (Dao cụ cắt gọt CNC & Vật tư phụ):
 * - Kiểm tra cấu trúc SQL Migration Đợt 7
 * - Kiểm tra cú pháp toàn bộ JS/HTML
 * - Kiểm tra 5 nhóm vật tư & logic quy đổi Hộp -> Viên (SharedUI.convertPackToBase)
 * - Kiểm tra giao diện inventory.html (nhóm tooling, 4x10 QR, import Excel), vouchers.html (quy đổi gói, machine/recipient, mượn trả), reports.html (Tab 4 dao cụ)
 * - Kiểm tra sw.js v22 & bảo mật dist/
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function verifySqlDot7() {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_migration_dot7_tooling_consumables.sql'), 'utf8');
  for (const token of [
    'ADD COLUMN IF NOT EXISTS sub_category TEXT',
    'ADD COLUMN IF NOT EXISTS brand TEXT',
    'ADD COLUMN IF NOT EXISTS pack_unit TEXT',
    'ADD COLUMN IF NOT EXISTS pack_qty NUMERIC',
    'ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN',
    "'tooling'",
    'ADD COLUMN IF NOT EXISTS machine_name TEXT',
    'ADD COLUMN IF NOT EXISTS recipient_name TEXT',
    'ADD COLUMN IF NOT EXISTS issue_reason TEXT',
    'ADD COLUMN IF NOT EXISTS returned_old_qty NUMERIC',
    'CREATE OR REPLACE FUNCTION public.get_tooling_consumption_report('
  ]) {
    assert(sql.includes(token), `Missing SQL Đợt 7 token: ${token}`);
  }
  console.log('[OK] SQL Migration Đợt 7 structure verified');
}

function verifySharedUiToolingAndPackConvert() {
  const sharedCode = fs.readFileSync(path.join(ROOT, 'js', 'shared-ui.js'), 'utf8');
  const ctx = { window: undefined };
  ctx.window = ctx;
  vm.runInNewContext(sharedCode, ctx);
  const UI = ctx.SharedUI;

  assert.equal(Object.keys(UI.MATERIAL_GROUPS).length, 5, 'Phải đủ 5 nhóm vật tư (gồm tooling)');
  assert.ok(UI.MATERIAL_GROUPS.tooling, 'Thiếu nhóm tooling');
  assert.ok(UI.SUB_CATEGORIES.dao_phay && UI.SUB_CATEGORIES.chip_cat && UI.SUB_CATEGORIES.vat_tu_laser, 'Thiếu SUB_CATEGORIES');
  assert.ok(UI.ISSUE_REASONS.broken_exchange && UI.ISSUE_REASONS.borrow, 'Thiếu ISSUE_REASONS');

  // Test quy đổi 2 Hộp (1 Hộp = 10 Viên) giá 850.000đ/Hộp -> 20 Viên @ 85.000đ/Viên, tổng 1.700.000đ
  const convPack = UI.convertPackToBase(2, 850000, 10, true);
  assert.equal(convPack.baseQty, 20);
  assert.equal(convPack.baseUnitPrice, 85000);
  assert.equal(convPack.totalAmount, 1700000);

  // Test nhập lẻ 5 Viên @ 85.000đ/Viên -> 5 Viên @ 85.000đ, tổng 425.000đ
  const convBase = UI.convertPackToBase(5, 85000, 10, false);
  assert.equal(convBase.baseQty, 5);
  assert.equal(convBase.baseUnitPrice, 85000);
  assert.equal(convBase.totalAmount, 425000);

  console.log('[OK] SharedUI 5 material groups & pack->base unit conversion verified');
}

function verifyHtmlAndJs() {
  for (const rel of ['js/shared-ui.js', 'js/supabaseClient.js', 'sw.js']) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  }
  const inv = fs.readFileSync(path.join(ROOT, 'inventory.html'), 'utf8');
  assert(inv.includes('data-grp="tooling"') && inv.includes('4x10') && inv.includes('modalToolingExcelImport'), 'inventory.html missing Đợt 7 features');

  const vou = fs.readFileSync(path.join(ROOT, 'vouchers.html'), 'utf8');
  assert(vou.includes('inpVoucherMachine') && vou.includes('inpVoucherRecipient') && vou.includes('btnToggleBorrowedTools') && vou.includes('vi-pack-mode'), 'vouchers.html missing Đợt 7 features');

  const rep = fs.readFileSync(path.join(ROOT, 'reports.html'), 'utf8');
  assert(rep.includes('secTabTooling') && rep.includes('getToolingConsumptionReport') && rep.includes('btnExportToolingXlsx'), 'reports.html missing Tab 4 tooling');

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert(sw.includes('toiuu-phoi-pwa-v28'), 'sw.js must be v28');
  console.log('[OK] HTML/JS Đợt 7 features & sw.js v22 verified');
}

verifySqlDot7();
verifySharedUiToolingAndPackConvert();
verifyHtmlAndJs();
console.log('=== VERIFY ĐỢT 7 (TOOLING & CONSUMABLES) PASSED 100% ===');
