/**
 * ============================================================================
 * LOCAL FUSION 360 BRIDGE & STATIC WEB SERVER - CƠ KHÍ AN BÌNH
 * Single Source of Truth: Supabase (PostgreSQL + Realtime + Storage)
 * ============================================================================
 * Chức năng:
 * 1. Cầu nối nhận dữ liệu trực tiếp từ Autodesk Fusion 360 (POST /api/fusion-import)
 * 2. Tự động upload file 3D .IGS lên Supabase Storage (bucket 'igs-files')
 *    và đẩy dự án / quy cách mới lên Supabase Database để mọi thiết bị nhận Realtime
 * 3. Ghi sao lưu cục bộ tùy chọn vào database/workshop_db.json và database/igs_files/
 * 4. Phục vụ web tĩnh & clean URLs tại mạng LAN xưởng khi chạy cục bộ
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const http = require('http');
const fs = require('fs');
const os = require('os');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DB_DIR = path.join(ROOT_DIR, 'database');
const IGS_DIR = path.join(DB_DIR, 'igs_files');
const DB_BACKUP_FILE = path.join(DB_DIR, 'workshop_db.json');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const CLIENT_JS_FILE = path.join(ROOT_DIR, 'js', 'supabaseClient.js');
const STORAGE_BUCKET = 'igs-files';

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(IGS_DIR)) fs.mkdirSync(IGS_DIR, { recursive: true });

// Đọc biến môi trường từ .env (nếu có)
function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch (e) {}
  return out;
}

function readClientJsDefaults() {
  if (!fs.existsSync(CLIENT_JS_FILE)) return {};
  try {
    const src = fs.readFileSync(CLIENT_JS_FILE, 'utf8');
    const urlMatch = src.match(/const\s+SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
    const keyMatch = src.match(/const\s+SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
    return {
      url: urlMatch ? urlMatch[1].trim() : '',
      anonKey: keyMatch ? keyMatch[1].trim() : ''
    };
  } catch (e) {
    return {};
  }
}

const envVars = loadEnvFile(ENV_FILE);
const PORT = Number(process.env.PORT || envVars.PORT || 3000);
const HOST = (process.env.HOST || envVars.HOST || '127.0.0.1').trim();
const FUSION_BRIDGE_TOKEN = (process.env.FUSION_BRIDGE_TOKEN || envVars.FUSION_BRIDGE_TOKEN || '').trim();
const ALLOWED_ORIGINS = new Set([
  'https://xepphoi.cloud',
  'https://www.xepphoi.cloud',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
]);
const STATIC_EXT_ALLOWLIST = new Set(['.html', '.js', '.css', '.json', '.jpg', '.jpeg', '.png', '.svg', '.ico', '.webp']);
const PUBLIC_ROOT_FILES = new Set([
  'index.html', 'projects.html', 'inventory.html', 'vouchers.html', 'cnc.html', 'admin.html',
  'toi-uu-engine.js', 'sw.js', 'manifest.json', 'logo_an_binh.jpg', 'workshop_config.json'
]);
const PUBLIC_ROOT_DIRS = new Set(['css', 'js']);
const clientDefaults = readClientJsDefaults();
const SUPABASE_URL = (process.env.SUPABASE_URL || envVars.SUPABASE_URL || clientDefaults.url || '').trim();
const SUPABASE_SECRET_KEY_RAW = (
  process.env.SUPABASE_SECRET_KEY ||
  envVars.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envVars.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim();
const hasSecretKey = Boolean(
  SUPABASE_SECRET_KEY_RAW &&
  !SUPABASE_SECRET_KEY_RAW.includes('YOUR_SUPABASE_')
);
const SUPABASE_KEY = hasSecretKey
  ? SUPABASE_SECRET_KEY_RAW
  : (
      process.env.SUPABASE_ANON_KEY ||
      envVars.SUPABASE_ANON_KEY ||
      clientDefaults.anonKey ||
      ''
    ).trim();

const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_KEY &&
  !SUPABASE_URL.includes('YOUR_SUPABASE_URL') &&
  !SUPABASE_KEY.includes('YOUR_SUPABASE_ANON_KEY') &&
  !SUPABASE_KEY.includes('YOUR_SUPABASE_SERVICE_ROLE_KEY') &&
  !SUPABASE_KEY.includes('YOUR_SUPABASE_SECRET_KEY') &&
  /^https?:\/\//i.test(SUPABASE_URL)
);

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;
const INTERNAL_EMAIL_DOMAIN = 'anbinh.local';

const DEFAULT_PROFILES = [
  'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
  'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0',
  'Ống Ø27x1.4', 'Ống Ø34x1.4'
];

// Bản sao dự phòng cục bộ trong RAM (Optional Local Backup - không dùng để đồng bộ)
let localBackupDb = {
  workspaceId: 'ANBINH',
  updatedAt: new Date().toISOString(),
  savedProfiles: DEFAULT_PROFILES.slice(),
  savedProjects: []
};

if (fs.existsSync(DB_BACKUP_FILE)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_BACKUP_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      localBackupDb = Object.assign(localBackupDb, parsed);
    }
  } catch (e) {}
}

function saveOptionalLocalBackup() {
  try {
    localBackupDb.updatedAt = new Date().toISOString();
    fs.writeFileSync(DB_BACKUP_FILE, JSON.stringify(localBackupDb, null, 2), 'utf8');
  } catch (err) {
    console.warn('[LOCAL BACKUP] Lỗi ghi database/workshop_db.json:', err.message);
  }
}

function toAsciiSafe(str) {
  if (!str) return 'file.igs';
  const safe = String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'file.igs';
}

function classifyProfile(pName) {
  const s = String(pName || '');
  if (/ống|ong|phi|ø/i.test(s)) return 'round';
  const m = s.match(/(\d+)\s*[xX\*×]\s*(\d+)/);
  if (m) return parseInt(m[1], 10) === parseInt(m[2], 10) ? 'square' : 'rect';
  return 'other';
}

function extractMatFromProfile(pName) {
  if (!pName) return 30;
  const m = String(pName).match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X|\*|×)(\d+)/i);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
  const mRound = String(pName).match(/(?:Ø|D|Phi)\s*(\d+)/i);
  if (mRound) return parseInt(mRound[1], 10);
  return 30;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({
          interface: name,
          ip: net.address,
          url: `http://${net.address}:${PORT}`
        });
      }
    }
  }
  return results;
}

async function uploadIgsToSupabaseStorage(projectId, safeLocalFileName, bufferOrString) {
  if (!supabase || !bufferOrString) return null;
  const asciiName = toAsciiSafe(safeLocalFileName.endsWith('.igs') ? safeLocalFileName : `${safeLocalFileName}.igs`);
  const storagePath = `${toAsciiSafe(projectId)}/${asciiName}`;
  const bodyBuffer = Buffer.isBuffer(bufferOrString)
    ? bufferOrString
    : Buffer.from(String(bufferOrString), 'utf8');

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, bodyBuffer, {
      contentType: 'application/octet-stream',
      upsert: true
    });

  if (error) {
    console.warn(`[SUPABASE STORAGE] Lỗi upload ${asciiName}:`, error.message);
    return null;
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return {
    storagePath,
    publicUrl: data ? data.publicUrl : null,
    sizeBytes: bodyBuffer.length
  };
}

// Xử lý payload từ Autodesk Fusion 360 -> Upload .IGS lên Supabase Storage & upsert Project lên Supabase PostgreSQL
async function processFusionPayload(fusionData) {
  if (!fusionData || (!fusionData.parts && !Array.isArray(fusionData))) return null;

  const partsList = Array.isArray(fusionData) ? fusionData : (fusionData.parts || []);
  if (!partsList.length) return null;

  const clampTail = fusionData.clamp_tail != null ? Number(fusionData.clamp_tail) : 80;
  const kerf = fusionData.kerf != null ? Number(fusionData.kerf) : 0;
  const projName = fusionData.project_name
    ? String(fusionData.project_name).trim()
    : `Bản vẽ Fusion 360 (${new Date().toLocaleDateString('vi-VN')})`;

  // Tìm xem đã có dự án cùng tên trên Supabase chưa
  let existingProj = null;
  if (supabase) {
    try {
      const { data: foundRows } = await supabase
        .from('projects')
        .select('id, name, is_locked, inventory_deducted_at, data, created_at, igs_files')
        .eq('is_trashed', false)
        .eq('is_draft', false)
        .ilike('name', projName)
        .limit(1);
      if (Array.isArray(foundRows) && foundRows.length) {
        existingProj = foundRows[0];
      }
    } catch (e) {}
  } else if (Array.isArray(localBackupDb.savedProjects)) {
    existingProj = localBackupDb.savedProjects.find(p => p.name && p.name.toLowerCase() === projName.toLowerCase()) || null;
  }

  let finalProjName = projName;
  let wasVersioned = false;
  let versionReason = '';
  let isUpdatingExisting = Boolean(existingProj);
  const randSuffix = Math.random().toString(36).slice(2, 7);

  // Bảo vệ khóa dự án / đã xuất kho: nếu dự án cùng tên đang bị khóa hoặc đã xuất kho -> tự tạo bản phiên bản mới thay vì ghi đè!
  const existingDispatched = Boolean(
    existingProj && (
      existingProj.inventory_deducted_at ||
      (existingProj.data && (existingProj.data.inventoryDeductedAt || existingProj.data.inventory_deducted_at))
    )
  );
  if (existingProj && (existingProj.is_locked || existingDispatched)) {
    versionReason = existingProj.is_locked ? 'locked' : 'dispatched';
    let nextVer = 2;
    if (supabase) {
      try {
        const escapedName = projName.replace(/[%_]/g, '\\$&');
        const { data: verRows } = await supabase
          .from('projects')
          .select('name')
          .eq('is_trashed', false)
          .eq('is_draft', false)
          .ilike('name', `${escapedName} (v%`);
        if (Array.isArray(verRows) && verRows.length) {
          let maxV = 1;
          for (const vr of verRows) {
            const m = String(vr.name || '').match(/\(v(\d+)/i);
            if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
          }
          nextVer = Math.max(2, maxV + 1);
        }
      } catch (e) {}
    }
    const d = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const stamp = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    finalProjName = `${projName} (v${nextVer} - ${stamp})`;
    existingProj = null;
    isUpdatingExisting = false;
    wasVersioned = true;
    console.log(`[FUSION 360] Dự án "${projName}" ${versionReason === 'locked' ? 'đang KHÓA' : 'ĐÃ XUẤT KHO'} -> Tự tạo bản mới "${finalProjName}"`);
  }

  const projectId = existingProj ? existingProj.id : `proj_f360_${Date.now()}_${randSuffix}`;
  const nowStr = new Date().toISOString();
  const activeProfiles = [];
  const igsFilesMeta = [];
  let igsUploadedCount = 0;

  // 1. Xử lý từng chi tiết và upload file .IGS chi tiết (nếu có)
  const newParts = [];
  for (let idx = 0; idx < partsList.length; idx++) {
    const p = partsList[idx];
    const prof = p.profile || 'Hộp 30x30x1.8';
    if (!activeProfiles.includes(prof)) activeProfiles.push(prof);
    if (!localBackupDb.savedProfiles.includes(prof)) localBackupDb.savedProfiles.push(prof);

    let pieceIgsUrl = p.igs_url || null;
    if (p.igs_content && p.igs_content.length > 50) {
      const safePartFileName = `${p.name || ('Chi_tiet_' + (idx + 1))}.igs`
        .replace(/\.igs\.igs$/i, '.igs')
        .replace(/[\/\\:*?"<>|]/g, '_');
      try {
        fs.writeFileSync(path.join(IGS_DIR, safePartFileName), p.igs_content, 'utf8');
      } catch (e) {}

      const uploaded = await uploadIgsToSupabaseStorage(projectId, safePartFileName, p.igs_content);
      if (uploaded && uploaded.storagePath) {
        pieceIgsUrl = `storage://${uploaded.storagePath}`;
        igsUploadedCount++;
        igsFilesMeta.push({
          kind: 'part',
          name: p.name || `Chi tiết ${idx + 1}`,
          original_file: safePartFileName,
          storage_path: uploaded.storagePath,
          public_url: uploaded.publicUrl,
          profile: prof,
          size_bytes: uploaded.sizeBytes
        });
      } else {
        pieceIgsUrl = `/api/igs/${encodeURIComponent(safePartFileName)}`;
      }
    }

    newParts.push({
      id: `p_f360_${Date.now()}_${randSuffix}_${idx}`,
      name: p.name || `Chi tiết ${idx + 1}`,
      profile: prof,
      length: Number(p.length) || 0,
      qty: Number(p.qty) || 1,
      style: p.style || 'thang',
      mat: p.mat || extractMatFromProfile(prof),
      igs_url: pieceIgsUrl,
      _autoDetected: true
    });
  }

  const newStock = activeProfiles.map((prof, idx) => ({
    id: `s_f360_${Date.now()}_${randSuffix}_${idx}`,
    profile: prof,
    name: `Cây mới 6.000 (${prof})`,
    length: 6000,
    qty: null,
    clamp: clampTail
  }));

  // 2. Xử lý các file .IGS của từng cây ghép (nested_bars) -> Upload lên Supabase Storage
  const lightNestedBars = [];
  if (Array.isArray(fusionData.nested_bars)) {
    for (const bar of fusionData.nested_bars) {
      const rawName = `${bar.name || ('Cay_' + bar.letter)}.igs`
        .replace(/\.igs\.igs$/i, '.igs')
        .replace(/[\/\\:*?"<>|]/g, '_');

      let fileBuf = null;
      if (bar.igs_content && bar.igs_content.length > 50) {
        fileBuf = Buffer.from(bar.igs_content, 'utf8');
        try {
          fs.writeFileSync(path.join(IGS_DIR, rawName), fileBuf);
        } catch (e) {}
      } else if (bar.igs_file && fs.existsSync(bar.igs_file)) {
        try {
          fileBuf = fs.readFileSync(bar.igs_file);
          fs.copyFileSync(bar.igs_file, path.join(IGS_DIR, rawName));
        } catch (e) {}
      }

      let barIgsUrl = `/api/igs/${encodeURIComponent(rawName)}`;
      if (fileBuf) {
        const uploaded = await uploadIgsToSupabaseStorage(projectId, rawName, fileBuf);
        if (uploaded && uploaded.storagePath) {
          barIgsUrl = `storage://${uploaded.storagePath}`;
          igsUploadedCount++;
          igsFilesMeta.push({
            kind: 'bar',
            name: bar.name || rawName,
            original_file: rawName,
            storage_path: uploaded.storagePath,
            public_url: uploaded.publicUrl,
            profile: bar.profile || '',
            letter: bar.letter || '',
            size_bytes: uploaded.sizeBytes
          });
        }
      }

      lightNestedBars.push({
        name: bar.name,
        profile: bar.profile,
        letter: bar.letter,
        count: bar.count || 1,
        cuts_count: bar.cuts_count,
        pieces: bar.pieces || [],
        igs_url: barIgsUrl
      });
    }
  }

  const projectDataPayload = {
    activeProfiles,
    selectedTabProfile: activeProfiles[0] || 'Hộp 30x30x1.8',
    parts: newParts,
    stock: newStock,
    method: 'cnc',
    kerf,
    clamp: clampTail,
    interlock: true,
    gap: 0,
    fusionProject: {
      project_name: fusionData.project_name || finalProjName,
      export_dir: fusionData.export_dir || '',
      stock_length: fusionData.stock_length || 6000,
      clamp_tail: clampTail,
      kerf,
      nested_bars: lightNestedBars
    }
  };

  const reasonText = versionReason === 'dispatched' ? 'đã xuất kho' : 'đang khóa';
  const projNotes = wasVersioned
    ? `Tự động tạo phiên bản mới từ Fusion 360 vì bản gốc "${projName}" ${reasonText} (${newParts.length} mục, ${activeProfiles.length} loại hộp)`
    : `Tự động đồng bộ từ Fusion 360 (${newParts.length} mục, ${activeProfiles.length} loại hộp)`;
  const projectRecord = {
    id: projectId,
    name: finalProjName,
    customer: 'Fusion 360 CAD',
    notes: projNotes,
    is_locked: false,
    is_trashed: false,
    is_draft: false,
    source: 'fusion360',
    data: projectDataPayload,
    igs_files: igsFilesMeta,
    deleted_at: null,
    created_at: existingProj && existingProj.created_at ? existingProj.created_at : nowStr,
    updated_at: nowStr
  };

  let supabaseSynced = false;
  let orphansRemovedCount = 0;
  if (supabase) {
    // Upsert quy cách hộp mới vào bảng inventory
    if (activeProfiles.length) {
      const stdLen = Number(fusionData.stock_length) || 6000;
      const invRows = activeProfiles.map(prof => ({
        profile_name: prof,
        category: classifyProfile(prof),
        standard_length: stdLen,
        standard_length_mm: stdLen
      }));
      const { error: invErr } = await supabase
        .from('inventory')
        .upsert(invRows, { onConflict: 'profile_name', ignoreDuplicates: true });
      if (invErr) {
        console.warn('[SUPABASE DB] Lỗi upsert inventory:', invErr.message);
      }
    }

    // Dọn các file .IGS mồ côi trên Storage khi xuất lại dự án không khóa ít cây/chi tiết hơn trước
    if (isUpdatingExisting) {
      try {
        const keepPaths = new Set(igsFilesMeta.map(f => f.storage_path).filter(Boolean));
        const candidateOldPaths = new Set();
        if (existingProj && Array.isArray(existingProj.igs_files)) {
          existingProj.igs_files.forEach(f => {
            if (f && f.storage_path) candidateOldPaths.add(f.storage_path);
          });
        }
        const folder = toAsciiSafe(projectId);
        const { data: listed } = await supabase.storage.from(STORAGE_BUCKET).list(folder, { limit: 1000 });
        if (Array.isArray(listed)) {
          listed.forEach(item => {
            if (item && item.name && item.id) {
              candidateOldPaths.add(`${folder}/${item.name}`);
            }
          });
        }
        const orphanPaths = Array.from(candidateOldPaths).filter(p => p && !keepPaths.has(p));
        if (orphanPaths.length) {
          for (let offset = 0; offset < orphanPaths.length; offset += 100) {
            const chunk = orphanPaths.slice(offset, offset + 100);
            const { error: rmErr } = await supabase.storage.from(STORAGE_BUCKET).remove(chunk);
            if (!rmErr) orphansRemovedCount += chunk.length;
          }
          if (orphansRemovedCount > 0) {
            console.log(`[SUPABASE STORAGE] Đã dọn ${orphansRemovedCount} file .IGS mồ côi của dự án "${finalProjName}"`);
          }
        }
      } catch (e) {
        console.warn('[SUPABASE STORAGE] Lỗi dọn file .IGS mồ côi:', e.message);
      }
    }

    // Upsert dự án vào bảng projects (Supabase Realtime sẽ tự phát tới mọi trình duyệt)
    const { error: projErr } = await supabase
      .from('projects')
      .upsert(projectRecord, { onConflict: 'id' });
    if (projErr) {
      const hint = !hasSecretKey ? ' (Chưa điền SUPABASE_SECRET_KEY trong file .env để vượt RLS!)' : '';
      throw new Error(`Không đẩy được dự án lên Supabase: ${projErr.message}${hint}`);
    }
    supabaseSynced = true;
  }

  // Ghi bản sao lưu cục bộ dự phòng (optional local backup)
  const localIdx = (localBackupDb.savedProjects || []).findIndex(p => p.id === projectId);
  const localEntry = {
    id: projectId,
    name: finalProjName,
    customer: 'Fusion 360 CAD',
    notes: projNotes,
    createdAt: projectRecord.created_at,
    updatedAt: nowStr,
    data: projectDataPayload
  };
  if (localIdx >= 0) localBackupDb.savedProjects[localIdx] = localEntry;
  else localBackupDb.savedProjects.unshift(localEntry);
  saveOptionalLocalBackup();

  return {
    project: localEntry,
    supabaseSynced,
    igsUploadedCount,
    wasVersioned,
    versionReason,
    orphansRemovedCount
  };
}

function readJsonBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function requireAdminJwt(req) {
  if (!isSupabaseConfigured || !supabase || !hasSecretKey) {
    return {
      ok: false,
      status: 503,
      error: 'Máy chủ xưởng chưa cấu hình SUPABASE_SECRET_KEY trong file .env!'
    };
  }
  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : '';
  if (!token) {
    return { ok: false, status: 401, error: 'Thiếu Bearer Access Token xác thực Quản trị viên.' };
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return { ok: false, status: 401, error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' };
  }
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('id, username, display_name, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profErr || !prof) {
    return { ok: false, status: 403, error: 'Tài khoản chưa có hồ sơ phân quyền trong xưởng.' };
  }
  if (prof.role !== 'admin') {
    return { ok: false, status: 403, error: 'Chỉ Quản trị viên (role=admin) mới được phép thao tác.' };
  }
  return { ok: true, user: userData.user, profile: prof };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.igs': 'application/octet-stream',
  '.iges': 'application/octet-stream'
};

function isLoopbackRequest(req) {
  const addr = String((req && req.socket && req.socket.remoteAddress) || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function applySafeCors(req, res) {
  const origin = String((req && req.headers && req.headers.origin) || '').trim();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id, Authorization, X-Fusion-Token');
}

function resolveUnderBase(baseDir, relPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedFull = path.resolve(resolvedBase, relPath);
  if (resolvedFull !== resolvedBase && !resolvedFull.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedFull;
}

const server = http.createServer(async (req, res) => {
  applySafeCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let parsedUrl;
  let pathname;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  // 1. Thông tin trạng thái cầu nối máy chủ cục bộ (/api/info)
  if (pathname === '/api/info' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      serverTime: new Date().toISOString(),
      port: PORT,
      supabaseConfigured: isSupabaseConfigured,
      hasSecretKey,
      supabaseUrl: isSupabaseConfigured ? SUPABASE_URL : null,
      lanUrls: getLanAddresses()
    });
    return;
  }

  // 1B. Local Admin Bridge cho /admin (chỉ chạy ở máy chủ xưởng khi có SUPABASE_SECRET_KEY)
  if (pathname === '/api/admin/status' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      ok: hasSecretKey && isSupabaseConfigured,
      hasSecretKey,
      supabaseConfigured: isSupabaseConfigured
    });
    return;
  }

  if (pathname === '/api/admin/users' && req.method === 'POST') {
    try {
      const authCheck = await requireAdminJwt(req);
      if (!authCheck.ok) return sendJson(res, authCheck.status, { success: false, error: authCheck.error });

      const body = await readJsonBody(req, 1024 * 1024);
      const rawUser = String(body.username || '').trim().toLowerCase().replace(/\s+/g, '');
      const password = String(body.password || '').trim();
      const displayName = String(body.displayName || body.fullName || '').trim();
      const role = ['admin', 'engineer', 'warehouse', 'accountant', 'operator'].includes(body.role) ? body.role : 'operator';

      if (!/^[a-z0-9._-]{3,32}$/.test(rawUser)) {
        return sendJson(res, 400, { success: false, error: 'Tên đăng nhập phải dài 3-32 ký tự (chữ thường, số, ., _, -).' });
      }
      if (!password || password.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Mật khẩu Supabase Auth phải có ít nhất 6 ký tự.' });
      }

      const email = `${rawUser}@${INTERNAL_EMAIL_DOMAIN}`;
      const { data: existProf } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', rawUser)
        .maybeSingle();
      if (existProf) {
        return sendJson(res, 409, { success: false, error: `Tài khoản @${rawUser} đã tồn tại.` });
      }

      const roleNames = {
        admin: 'Quản trị',
        engineer: 'Kỹ sư',
        warehouse: 'Thủ kho',
        accountant: 'Kế toán',
        operator: 'Thợ CNC'
      };
      const resolvedName = displayName || `${roleNames[role] || 'Nhân sự'} (${rawUser})`;
      const { data: createdAuth, error: crtErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: rawUser, display_name: resolvedName, role }
      });
      if (crtErr || !createdAuth || !createdAuth.user) {
        return sendJson(res, 400, { success: false, error: crtErr ? crtErr.message : 'Không tạo được tài khoản Auth.' });
      }

      const { data: savedProf, error: profErr } = await supabase
        .from('profiles')
        .upsert({
          id: createdAuth.user.id,
          username: rawUser,
          display_name: resolvedName,
          role
        }, { onConflict: 'id' })
        .select()
        .single();

      if (profErr) {
        try { await supabase.auth.admin.deleteUser(createdAuth.user.id); } catch (e) {}
        return sendJson(res, 500, { success: false, error: `Không lưu được hồ sơ profile: ${profErr.message}` });
      }

      return sendJson(res, 200, {
        success: true,
        user: {
          id: savedProf.id,
          username: savedProf.username,
          displayName: savedProf.display_name,
          fullName: savedProf.display_name,
          role: savedProf.role,
          email,
          createdAt: savedProf.created_at,
          updatedAt: savedProf.updated_at
        }
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  const adminPassMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (adminPassMatch && req.method === 'PUT') {
    try {
      const authCheck = await requireAdminJwt(req);
      if (!authCheck.ok) return sendJson(res, authCheck.status, { success: false, error: authCheck.error });

      const targetId = adminPassMatch[1];
      const body = await readJsonBody(req, 64 * 1024);
      const password = String(body.password || '').trim();
      if (!password || password.length < 6) {
        return sendJson(res, 400, { success: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      }
      const { error: updErr } = await supabase.auth.admin.updateUserById(targetId, { password });
      if (updErr) {
        return sendJson(res, 400, { success: false, error: updErr.message });
      }
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  const adminRoleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (adminRoleMatch && req.method === 'PUT') {
    try {
      const authCheck = await requireAdminJwt(req);
      if (!authCheck.ok) return sendJson(res, authCheck.status, { success: false, error: authCheck.error });

      const targetId = adminRoleMatch[1];
      const body = await readJsonBody(req, 64 * 1024);
      const nextRole = String(body.role || '').trim();
      if (!['admin', 'engineer', 'warehouse', 'accountant', 'operator'].includes(nextRole)) {
        return sendJson(res, 400, { success: false, error: 'Vai trò không hợp lệ.' });
      }
      if (targetId === authCheck.user.id && nextRole !== 'admin') {
        return sendJson(res, 400, { success: false, error: 'Không thể tự hạ quyền Quản trị viên của chính bạn.' });
      }
      const patch = { role: nextRole, updated_at: new Date().toISOString() };
      if (body.displayName !== undefined) patch.display_name = String(body.displayName || '').trim();

      const { data: updated, error: updErr } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', targetId)
        .select()
        .single();
      if (updErr) {
        return sendJson(res, 400, { success: false, error: updErr.message });
      }
      await supabase.auth.admin.updateUserById(targetId, {
        user_metadata: {
          username: updated.username,
          display_name: updated.display_name,
          role: updated.role
        }
      }).catch(() => {});

      return sendJson(res, 200, { success: true, profile: updated });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  const adminDelMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminDelMatch && req.method === 'DELETE') {
    try {
      const authCheck = await requireAdminJwt(req);
      if (!authCheck.ok) return sendJson(res, authCheck.status, { success: false, error: authCheck.error });

      const targetId = adminDelMatch[1];
      if (targetId === authCheck.user.id) {
        return sendJson(res, 400, { success: false, error: 'Không thể tự xóa tài khoản đang đăng nhập.' });
      }
      const { data: targetProf } = await supabase.from('profiles').select('username').eq('id', targetId).maybeSingle();
      if (targetProf && String(targetProf.username || '').toLowerCase() === 'admin') {
        return sendJson(res, 400, { success: false, error: 'Không thể xóa tài khoản Quản trị viên tối cao (@admin).' });
      }
      const { error: delErr } = await supabase.auth.admin.deleteUser(targetId);
      if (delErr) {
        return sendJson(res, 400, { success: false, error: delErr.message });
      }
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 2. Cầu nối nhận bản vẽ & file .IGS trực tiếp từ Autodesk Fusion 360 (/api/fusion-import)
  if (pathname === '/api/fusion-import' && req.method === 'POST') {
    const tokenHdr = String((req.headers && req.headers['x-fusion-token']) || '').trim();
    if (!isLoopbackRequest(req) && (!FUSION_BRIDGE_TOKEN || tokenHdr !== FUSION_BRIDGE_TOKEN)) {
      sendJson(res, 403, {
        success: false,
        error: 'Forbidden: cầu nối /api/fusion-import chỉ nhận kết nối nội bộ (localhost) hoặc cần header X-Fusion-Token hợp lệ.'
      });
      return;
    }
    try {
      const fusionData = await readJsonBody(req);
      const result = await processFusionPayload(fusionData);
      if (!result) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Dữ liệu Fusion 360 trống hoặc không hợp lệ' }));
        return;
      }

      console.log(
        `[FUSION 360] Đã nhận dự án "${result.project.name}" | Supabase DB: ${result.supabaseSynced ? 'OK' : 'CHƯA CẤU HÌNH'} | Upload IGS: ${result.igsUploadedCount} file`
      );

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        projectId: result.project.id,
        projectName: result.project.name,
        supabaseSynced: result.supabaseSynced,
        igsUploadedCount: result.igsUploadedCount,
        wasVersioned: Boolean(result.wasVersioned),
        versionReason: result.versionReason || '',
        orphansRemovedCount: Number(result.orphansRemovedCount || 0),
        webUrl: `https://xepphoi.cloud/?project=${encodeURIComponent(result.project.id)}`,
        cncUrl: `https://xepphoi.cloud/cnc?project=${encodeURIComponent(result.project.id)}`,
        lanUrls: HOST === '127.0.0.1' ? [] : getLanAddresses()
      }));
    } catch (err) {
      console.error('[FUSION 360] Lỗi import:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 3. Fallback tải file 3D .IGS từ bản sao lưu cục bộ (/api/igs/:filename)
  if (pathname.startsWith('/api/igs/') && req.method === 'GET') {
    let fileName = path.basename(decodeURIComponent(pathname.replace('/api/igs/', '')));
    let filePath = path.join(IGS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      try {
        const allFiles = fs.readdirSync(IGS_DIR);
        const norm = s => s.toLowerCase().replace(/[\s_]+/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const targetNorm = norm(fileName);
        const match = allFiles.find(f => norm(f) === targetNorm);
        if (match) {
          filePath = path.join(IGS_DIR, match);
          fileName = match;
        }
      } catch (e) {}
    }

    if (fs.existsSync(filePath)) {
      const asciiFileName = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Không tìm thấy file .IGS dự phòng trên máy chủ cục bộ' }));
      return;
    }
  }

  // 4. Phục vụ các file tĩnh an toàn theo allowlist (chặn tuyệt đối dotfile & thư mục nhạy cảm)
  const rawSegments = pathname.split('/').filter(Boolean);
  if (
    pathname.includes('\0') ||
    rawSegments.some(seg => seg.startsWith('.') || seg.includes('..'))
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  let safePath = pathname === '/' ? '/index.html' : pathname;
  const cleanRouteMap = {
    '/admin': '/admin.html',
    '/admin/': '/admin.html',
    '/projects': '/projects.html',
    '/projects/': '/projects.html',
    '/inventory': '/inventory.html',
    '/inventory/': '/inventory.html',
    '/vouchers': '/vouchers.html',
    '/vouchers/': '/vouchers.html',
    '/cnc': '/cnc.html',
    '/cnc/': '/cnc.html'
  };
  if (cleanRouteMap[safePath]) {
    safePath = cleanRouteMap[safePath];
  }

  const relPath = safePath.replace(/^\/+/, '');
  const normLower = relPath.toLowerCase();
  const topSeg = (normLower.split('/')[0] || '');

  // Chặn mọi thư mục/file hệ thống nhạy cảm
  if (
    topSeg === 'database' ||
    topSeg === 'scripts' ||
    topSeg === 'node_modules' ||
    topSeg === '__pycache__' ||
    relPath === 'server.js' ||
    relPath === 'package.json' ||
    relPath === 'package-lock.json'
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const isAllowlistedPublic = PUBLIC_ROOT_FILES.has(relPath) || PUBLIC_ROOT_DIRS.has(topSeg);
  if (!isAllowlistedPublic) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Không tìm thấy trang');
    return;
  }

  let fullPath = null;
  for (const baseDir of [DIST_DIR, ROOT_DIR]) {
    let candidate = resolveUnderBase(baseDir, relPath);
    if (!candidate) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      const indexCandidate = resolveUnderBase(baseDir, path.posix.join(relPath, 'index.html'));
      if (indexCandidate && fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
        candidate = indexCandidate;
      }
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      fullPath = candidate;
      break;
    }
  }

  if (fullPath) {
    const ext = path.extname(fullPath).toLowerCase();
    if (!STATIC_EXT_ALLOWLIST.has(ext)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(fullPath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Không tìm thấy trang');
  }
});

server.listen(PORT, HOST, () => {
  const lanList = HOST === '127.0.0.1' || HOST === '::1' ? [] : getLanAddresses();
  console.log('====================================================================');
  console.log(' 🚀 FUSION 360 BRIDGE & LOCAL SERVER - CƠ KHÍ AN BÌNH');
  console.log('====================================================================');
  console.log(` 💻 Truy cập cục bộ  : http://127.0.0.1:${PORT} (Bind: ${HOST})`);
  if (HOST === '127.0.0.1' || HOST === '::1') {
    console.log(' 🛡️  Chế độ bảo mật   : Chỉ nhận kết nối nội bộ máy chủ xưởng (127.0.0.1)');
  } else {
    lanList.forEach(item => {
      console.log(` 📱 Mạng LAN xưởng   : ${item.url} (${item.interface})`);
    });
  }
  console.log(` 🗄️  Supabase Cloud   : ${isSupabaseConfigured ? `Đã kết nối (${SUPABASE_URL})` : 'CHƯA CẤU HÌNH (cần điền SUPABASE_URL & KEY vào .env)'}`);
  console.log(` 🔐 Secret Key RLS   : ${hasSecretKey ? 'ĐÃ KÍCH HOẠT (Fusion 360 & Local Admin Bridge sẵn sàng)' : '⚠️ CHƯA CẤU HÌNH — hãy điền SUPABASE_SECRET_KEY=... vào file .env!'}`);
  console.log('====================================================================');
});
