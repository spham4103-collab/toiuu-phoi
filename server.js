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
const clientDefaults = readClientJsDefaults();
const SUPABASE_URL = (process.env.SUPABASE_URL || envVars.SUPABASE_URL || clientDefaults.url || '').trim();
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envVars.SUPABASE_SERVICE_ROLE_KEY ||
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
  /^https?:\/\//i.test(SUPABASE_URL)
);

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

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

  // Tìm xem đã có dự án cùng tên trên Supabase chưa để giữ nguyên ID
  let existingProj = null;
  if (supabase) {
    try {
      const { data: foundRows } = await supabase
        .from('projects')
        .select('id, created_at')
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

  const projectId = existingProj ? existingProj.id : `proj_f360_${Date.now()}`;
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
      if (uploaded && uploaded.publicUrl) {
        pieceIgsUrl = uploaded.publicUrl;
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
      id: `p_f360_${Date.now()}_${idx}`,
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
    id: `s_f360_${Date.now()}_${idx}`,
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
        if (uploaded && uploaded.publicUrl) {
          barIgsUrl = uploaded.publicUrl;
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
      project_name: fusionData.project_name || projName,
      export_dir: fusionData.export_dir || '',
      stock_length: fusionData.stock_length || 6000,
      clamp_tail: clampTail,
      kerf,
      nested_bars: lightNestedBars
    }
  };

  const projNotes = `Tự động đồng bộ từ Fusion 360 (${newParts.length} mục, ${activeProfiles.length} loại hộp)`;
  const projectRecord = {
    id: projectId,
    name: projName,
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
  if (supabase) {
    // Upsert quy cách hộp mới vào bảng inventory
    if (activeProfiles.length) {
      const invRows = activeProfiles.map(prof => ({
        profile_name: prof,
        category: classifyProfile(prof),
        standard_length: fusionData.stock_length || 6000
      }));
      const { error: invErr } = await supabase
        .from('inventory')
        .upsert(invRows, { onConflict: 'profile_name', ignoreDuplicates: true });
      if (invErr) {
        console.warn('[SUPABASE DB] Lỗi upsert inventory:', invErr.message);
      }
    }

    // Upsert dự án vào bảng projects (Supabase Realtime sẽ tự phát tới mọi trình duyệt)
    const { error: projErr } = await supabase
      .from('projects')
      .upsert(projectRecord, { onConflict: 'id' });
    if (projErr) {
      throw new Error(`Không đẩy được dự án lên Supabase: ${projErr.message}`);
    }
    supabaseSynced = true;
  }

  // Ghi bản sao lưu cục bộ dự phòng (optional local backup)
  const localIdx = (localBackupDb.savedProjects || []).findIndex(p => p.id === projectId);
  const localEntry = {
    id: projectId,
    name: projName,
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
    igsUploadedCount
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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. Thông tin trạng thái cầu nối máy chủ cục bộ (/api/info)
  if (pathname === '/api/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      serverTime: new Date().toISOString(),
      port: PORT,
      supabaseConfigured: isSupabaseConfigured,
      supabaseUrl: isSupabaseConfigured ? SUPABASE_URL : null,
      lanUrls: getLanAddresses()
    }));
    return;
  }

  // 2. Cầu nối nhận bản vẽ & file .IGS trực tiếp từ Autodesk Fusion 360 (/api/fusion-import)
  if (pathname === '/api/fusion-import' && req.method === 'POST') {
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
        webUrl: 'https://xepphoi.cloud',
        lanUrls: getLanAddresses()
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
        'Access-Control-Allow-Origin': '*',
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

  // 4. Phục vụ các file tĩnh & nhánh web con (/ , /projects, /inventory, /cnc, /admin, /js/...)
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const cleanRouteMap = {
    '/admin': '/admin.html',
    '/admin/': '/admin.html',
    '/projects': '/projects.html',
    '/projects/': '/projects.html',
    '/inventory': '/inventory.html',
    '/inventory/': '/inventory.html',
    '/cnc': '/cnc.html',
    '/cnc/': '/cnc.html'
  };
  if (cleanRouteMap[safePath]) {
    safePath = cleanRouteMap[safePath];
  }
  let fullPath = path.join(ROOT_DIR, safePath);

  if (!fullPath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    const indexPath = path.join(fullPath, 'index.html');
    if (fs.existsSync(indexPath)) fullPath = indexPath;
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath).toLowerCase();
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

server.listen(PORT, () => {
  const lanList = getLanAddresses();
  console.log('====================================================================');
  console.log(' 🚀 FUSION 360 BRIDGE & LOCAL SERVER - CƠ KHÍ AN BÌNH');
  console.log('====================================================================');
  console.log(` 💻 Truy cập cục bộ  : http://localhost:${PORT}`);
  lanList.forEach(item => {
    console.log(` 📱 Mạng LAN xưởng   : ${item.url} (${item.interface})`);
  });
  console.log(` 🗄️  Supabase Cloud   : ${isSupabaseConfigured ? `Đã kết nối (${SUPABASE_URL})` : 'CHƯA CẤU HÌNH (cần điền SUPABASE_URL & KEY vào .env hoặc js/supabaseClient.js)'}`);
  console.log('====================================================================');
});
