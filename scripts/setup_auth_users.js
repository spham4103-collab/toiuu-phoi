/**
 * ============================================================================
 * SCRIPT KHỞI TẠO TÀI KHOẢN SUPABASE AUTH & BẢNG PROFILES (CHẠY 1 LẦN Ở XƯỞNG)
 * Chạy bằng: node scripts/setup_auth_users.js (hoặc npm run setup:auth)
 * ============================================================================
 * Yêu cầu trong file .env có sẵn:
 *   SUPABASE_URL=https://tfvwijzrgnbznwwvfwww.supabase.co
 *   SUPABASE_SECRET_KEY=sb_secret_...   (hoặc SUPABASE_SERVICE_ROLE_KEY=...)
 *
 * Có thể tùy biến mật khẩu trước khi chạy qua .env hoặc biến môi trường:
 *   ADMIN_INIT_PASSWORD=...
 *   KT1_INIT_PASSWORD=...
 *   THOCNC_INIT_PASSWORD=...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const INTERNAL_EMAIL_DOMAIN = 'anbinh.local';

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const envVars = loadEnvFile(ENV_FILE);
const getEnv = (name, fallback = '') => (process.env[name] || envVars[name] || fallback).trim();

const SUPABASE_URL = getEnv('SUPABASE_URL', 'https://tfvwijzrgnbznwwvfwww.supabase.co');
const SUPABASE_SECRET_KEY = getEnv('SUPABASE_SECRET_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || SUPABASE_SECRET_KEY.includes('YOUR_SUPABASE_')) {
  console.error('====================================================================');
  console.error(' ❌ THIẾU SUPABASE_SECRET_KEY TRONG FILE .env');
  console.error('====================================================================');
  console.error(' Script Auth Admin cần quyền Secret key (sb_secret_...) để tạo user trên');
  console.error(' Supabase Authentication và điền bảng public.profiles.');
  console.error('');
  console.error(' Cách làm:');
  console.error('  1. Vào Supabase Dashboard -> Project Settings -> API Keys');
  console.error('  2. Copy "Secret key" (bắt đầu bằng sb_secret_...)');
  console.error(`  3. Mở file "${ENV_FILE}" và thêm dòng:`);
  console.error('     SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxxxxxx');
  console.error('  4. Chạy lại lệnh: node scripts/setup_auth_users.js');
  console.error('====================================================================');
  process.exit(1);
}

const INITIAL_USERS = [
  {
    username: 'admin',
    email: `admin@${INTERNAL_EMAIL_DOMAIN}`,
    password: getEnv('ADMIN_INIT_PASSWORD', 'AnBinh@Admin2026'),
    display_name: 'Quản Trị Viên (Admin)',
    role: 'admin'
  },
  {
    username: 'kt1',
    email: `kt1@${INTERNAL_EMAIL_DOMAIN}`,
    password: getEnv('KT1_INIT_PASSWORD', 'AnBinh@Kt2026'),
    display_name: 'Sơn KT (Kỹ Sư)',
    role: 'engineer'
  },
  {
    username: 'thocnc',
    email: `thocnc@${INTERNAL_EMAIL_DOMAIN}`,
    password: getEnv('THOCNC_INIT_PASSWORD', 'AnBinh@Cnc2026'),
    display_name: 'Thợ Vận Hành Máy CNC',
    role: 'operator'
  }
];

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function run() {
  console.log('====================================================================');
  console.log(' 🔐 KHỞI TẠO TÀI KHOẢN SUPABASE AUTH & PROFILES - XƯỞNG AN BÌNH');
  console.log(` 🗄️  Supabase URL: ${SUPABASE_URL}`);
  console.log('====================================================================');

  // Lấy toàn bộ user Auth hiện có (phân trang đơn giản tối đa 1000)
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.error('❌ Không liệt kê được auth.users (kiểm tra lại SUPABASE_SECRET_KEY):', listErr.message);
    process.exit(1);
  }

  const existingUsers = (listData && Array.isArray(listData.users)) ? listData.users : [];
  const results = [];

  for (const spec of INITIAL_USERS) {
    const existing = existingUsers.find(u => String(u.email || '').toLowerCase() === spec.email.toLowerCase());
    let authUser = null;
    let actionLabel = '';

    if (existing) {
      const { data: updData, error: updErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password: spec.password,
        email_confirm: true,
        user_metadata: {
          username: spec.username,
          display_name: spec.display_name,
          role: spec.role
        }
      });
      if (updErr) {
        console.error(`❌ Lỗi cập nhật tài khoản ${spec.email}:`, updErr.message);
        process.exit(1);
      }
      authUser = updData.user;
      actionLabel = 'Cập nhật';
    } else {
      const { data: crtData, error: crtErr } = await supabase.auth.admin.createUser({
        email: spec.email,
        password: spec.password,
        email_confirm: true,
        user_metadata: {
          username: spec.username,
          display_name: spec.display_name,
          role: spec.role
        }
      });
      if (crtErr) {
        console.error(`❌ Lỗi tạo tài khoản ${spec.email}:`, crtErr.message);
        process.exit(1);
      }
      authUser = crtData.user;
      actionLabel = 'Tạo mới';
    }

    const { error: profErr } = await supabase
      .from('profiles')
      .upsert({
        id: authUser.id,
        username: spec.username,
        display_name: spec.display_name,
        role: spec.role
      }, { onConflict: 'id' });

    if (profErr) {
      console.error(`❌ Lỗi lưu public.profiles cho ${spec.username}:`, profErr.message);
      console.error('👉 Hãy chắc chắn anh đã chạy file "supabase_migration_dot2_auth_rls.sql" trong SQL Editor trước!');
      process.exit(1);
    }

    results.push({
      action: actionLabel,
      username: spec.username,
      email: spec.email,
      role: spec.role,
      password: spec.password
    });
  }

  console.log('✅ ĐÃ KHỞI TẠO & ĐỒNG BỘ THÀNH CÔNG 3 TÀI KHOẢN SUPABASE AUTH:');
  console.log('');
  for (const r of results) {
    console.log(`  • [${r.action}] @${r.username} (${r.email}) | Role: ${r.role} | Mật khẩu: ${r.password}`);
  }
  console.log('');
  console.log('ℹ️  Trên trang web, nhân sự vẫn chỉ cần gõ tên ngắn gọn (admin / kt1 / thocnc).');
  console.log('ℹ️  Mật khẩu có thể tự đổi sau khi đăng nhập hoặc đổi trên trang /admin.');
  console.log('====================================================================');
}

run().catch(err => {
  console.error('❌ Lỗi không mong đợi:', err);
  process.exit(1);
});
