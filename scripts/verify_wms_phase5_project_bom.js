import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function testSqlDot8() {
  const sql = read('supabase_migration_dot8_project_bom.sql');
  assert(sql.includes('CREATE TABLE IF NOT EXISTS public.project_material_requests'), 'Missing project_material_requests table');
  assert(sql.includes('CREATE TABLE IF NOT EXISTS public.project_attachments'), 'Missing project_attachments table');
  assert(sql.includes("'project-attachments'"), 'Missing project-attachments storage bucket');
  assert(sql.includes('ADD COLUMN IF NOT EXISTS project_request_id UUID'), 'Missing warehouse_voucher_items.project_request_id');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public._sync_project_request_issued'), 'Missing _sync_project_request_issued function');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.approve_warehouse_voucher'), 'Missing updated approve_warehouse_voucher');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.cancel_warehouse_voucher'), 'Missing updated cancel_warehouse_voucher');
  console.log('[PASS] SQL Dot 8 schema & atomic project_request_id sync');
}

function testSharedUiWeightCalculator() {
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
  assert.equal(Object.keys(SharedUI.WORK_STAGES).length, 6, 'Must expose 6 work stages');
  assert(Object.keys(SharedUI.MATERIAL_DENSITIES).length >= 6, 'Must expose material densities');

  const ss400Plate = SharedUI.calcMaterialWeightKg({ shape: 'plate', lengthMm: 2440, widthMm: 1220, thicknessMm: 10, grade: 'SS400' });
  assert(Math.abs(ss400Plate - 233.68) < 0.05, `SS400 plate expected ~233.68kg, got ${ss400Plate}`);

  const susRound = SharedUI.calcMaterialWeightKg({ shape: 'round', diameterMm: 60, lengthMm: 150, grade: 'SUS 304' });
  assert(Math.abs(susRound - 3.36) < 0.05, `SUS304 round expected ~3.36kg, got ${susRound}`);

  const aluPlate = SharedUI.calcMaterialWeightKg({ shape: 'plate', lengthMm: 1000, widthMm: 500, thicknessMm: 20, grade: 'Nhôm 6061' });
  assert.equal(aluPlate, 27, `Nhôm 6061 plate expected 27kg, got ${aluPlate}`);

  const pomRound = SharedUI.calcMaterialWeightKg({ shape: 'round', diameterMm: 100, lengthMm: 100, grade: 'POM' });
  assert(Math.abs(pomRound - 1.11) < 0.05, `POM round expected ~1.11kg, got ${pomRound}`);
  console.log('[PASS] SharedUI WORK_STAGES & calcMaterialWeightKg (SS400, SUS 304, Nhôm 6061, POM)');
}

function testProjectBomAndPages() {
  const bomJs = read('js/project-bom.js');
  assert(bomJs.includes('window.ProjectBomModal'), 'project-bom.js must expose window.ProjectBomModal');
  assert(bomJs.includes('calcMaterialWeightKg'), 'project-bom.js must integrate weight calculator');
  assert(bomJs.includes('xp_reorder_draft_pnk'), 'project-bom.js must support pushing shortages to PNK draft');
  assert(bomJs.includes('createWarehouseVoucher'), 'project-bom.js must support creating PXK');

  const projectsHtml = read('projects.html');
  assert(projectsHtml.includes('/js/project-bom.js'), 'projects.html must load /js/project-bom.js');
  assert(projectsHtml.includes('inpFormDueDate'), 'projects.html must include dueDate field in project modal');
  assert(projectsHtml.includes('grpFormStages'), 'projects.html must include workStages checkboxes');
  assert(projectsHtml.includes('btn-open-bom'), 'projects.html must render BOM button on project cards');

  const vouchersHtml = read('vouchers.html');
  assert(vouchersHtml.includes('projectRequestId'), 'vouchers.html must display projectRequestId context');

  const sw = read('sw.js');
  assert(sw.includes('toiuu-phoi-pwa-v28'), 'sw.js must be v28');
  assert(sw.includes('/js/project-bom.js'), 'sw.js must cache /js/project-bom.js');

  const distDir = path.join(ROOT, 'dist');
  if (fs.existsSync(distDir)) {
    const forbidden = ['.env', 'workshop_db.json'];
    for (const f of forbidden) {
      assert(!fs.existsSync(path.join(distDir, f)), `dist/ must not contain ${f}`);
    }
  }
  console.log('[PASS] project-bom.js, projects.html, vouchers.html, sw.js v23, dist/ check');
}

testSqlDot8();
testSharedUiWeightCalculator();
testProjectBomAndPages();
console.log('ALL PHASE 5 PROJECT BOM CHECKS PASSED!');
