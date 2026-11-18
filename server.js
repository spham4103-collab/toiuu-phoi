/**
 * ============================================================================
 * FULL-STACK WEB SERVER & REALTIME MULTI-DEVICE SYNC ENGINE
 * Phần mềm Tối Ưu Xếp Phôi Thép Hộp - Cơ Khí An Bình
 * ============================================================================
 * Chức năng:
 * 1. Máy chủ Web HTTP chính thức (Truy cập qua PC, Điện thoại, Máy tính bảng, Máy CNC)
 * 2. Cơ sở dữ liệu tập trung (Lưu trữ bền vững Dự án, Quy cách hộp, Tồn kho, File 3D .IGS)
 * 3. Đồng bộ Thời Gian Thực (Realtime SSE) giữa tất cả các thiết bị trong xưởng & Internet
 * 4. API nhận dữ liệu trực tiếp từ Autodesk Fusion 360 (POST /api/fusion-import)
 * 5. Tự động mở kênh Cloud Internet (HTTPS Tunnel) để truy cập từ xa qua 4G/5G
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DB_DIR = path.join(ROOT_DIR, 'database');
const DIST_DB_DIR = path.join(ROOT_DIR, 'dist', 'database');
const IGS_DIR = path.join(DB_DIR, 'igs_files');
const DB_FILE = path.join(DB_DIR, 'workshop_db.json');
const DB_JS_FILE = path.join(DB_DIR, 'workshop_db.js');

// Đảm bảo thư mục database tồn tại
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(DIST_DB_DIR)) fs.mkdirSync(DIST_DB_DIR, { recursive: true });
if (!fs.existsSync(IGS_DIR)) fs.mkdirSync(IGS_DIR, { recursive: true });

const DEFAULT_PROFILES = [
  'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
  'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0',
  'Ống Ø27x1.4', 'Ống Ø34x1.4'
];

const DEFAULT_USERS = [
  {
    username: 'admin',
    password: '123456',
    fullName: 'Kỹ Sư Thiết Kế (Admin)',
    role: 'engineer',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    username: 'thocnc',
    password: '1234',
    fullName: 'Thợ Vận Hành Máy CNC',
    role: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

// Khởi tạo hoặc đọc Database
let db = {
  workspaceId: 'ANBINH',
  updatedAt: new Date().toISOString(),
  savedProfiles: DEFAULT_PROFILES.slice(),
  savedProjects: [],
  deletedProjectIds: [],
  activeProject: null,
  cutStatuses: {},
  users: DEFAULT_USERS.slice()
};

const sseClients = new Map();
let publicTunnelUrl = null;
const NTFY_TOPIC = 'toiuu_phoi_anbinh_db_v3';
let cloudPushTimer = null;
let gitSyncTimer = null;
let isGitSyncing = false;

function buildLightDbSnapshot(actionName = 'server_sync') {
  return {
    senderId: 'server_anbinh_host',
    action: actionName,
    workspaceId: db.workspaceId || 'ANBINH',
    updatedAt: db.updatedAt,
    publicUrl: publicTunnelUrl || db.publicUrl || null,
    lanUrls: getLanAddresses(),
    savedProfiles: db.savedProfiles,
    deletedProjectIds: db.deletedProjectIds || [],
    savedProjects: (db.savedProjects || []).map(p => {
      const clone = JSON.parse(JSON.stringify(p));
      if (clone.fusionProject && Array.isArray(clone.fusionProject.nested_bars)) {
        clone.fusionProject.nested_bars.forEach(b => delete b.igs_content);
      }
      if (clone.data && clone.data.fusionProject && Array.isArray(clone.data.fusionProject.nested_bars)) {
        clone.data.fusionProject.nested_bars.forEach(b => delete b.igs_content);
      }
      return clone;
    }),
    activeProject: db.activeProject ? (() => {
      const clone = JSON.parse(JSON.stringify(db.activeProject));
      if (clone.fusionProject && Array.isArray(clone.fusionProject.nested_bars)) {
        clone.fusionProject.nested_bars.forEach(b => delete b.igs_content);
      }
      return clone;
    })() : null,
    cutStatuses: db.cutStatuses || {},
    users: db.users || []
  };
}

function writeWorkshopDbJs(lightDb) {
  try {
    const endMarker = '// __WORKSHOP_DB_DATA_END__';
    let engineTail = '';
    if (fs.existsSync(DB_JS_FILE)) {
      const curJs = fs.readFileSync(DB_JS_FILE, 'utf8');
      const idx = curJs.indexOf(endMarker);
      if (idx !== -1) {
        engineTail = curJs.slice(idx + endMarker.length);
      }
    }
    const header = `// __WORKSHOP_DB_DATA_START__\nwindow.__WORKSHOP_DB__ = ${JSON.stringify(lightDb)};\n${endMarker}`;
    const fullJs = header + (engineTail || '\n');
    fs.writeFileSync(DB_JS_FILE, fullJs, 'utf8');
    if (fs.existsSync(DIST_DB_DIR)) {
      fs.writeFileSync(path.join(DIST_DB_DIR, 'workshop_db.js'), fullJs, 'utf8');
      fs.writeFileSync(path.join(DIST_DB_DIR, 'workshop_db.json'), JSON.stringify(db, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[DB] Lỗi ghi workshop_db.js:', err.message);
  }
}

function findGitExecutable() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'git'
  ];
  for (const c of candidates) {
    if (c === 'git' || fs.existsSync(c)) return c;
  }
  return 'git';
}

function runGitAsync(gitBin, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(gitBin, args, { cwd: ROOT_DIR, windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', d => { out += d.toString(); });
      child.stderr.on('data', d => { err += d.toString(); });
      child.on('close', code => resolve({ code, out, err }));
      child.on('error', e => resolve({ code: 1, out, err: e.message }));
    } catch (e) {
      resolve({ code: 1, out: '', err: e.message });
    }
  });
}

// Tự động đồng bộ database/workshop_db.* lên GitHub CDN để mọi thiết bị truy cập https://xepphoi.cloud nhận ngay ở 0ms
function scheduleGitAutoSync() {
  clearTimeout(gitSyncTimer);
  gitSyncTimer = setTimeout(async () => {
    if (isGitSyncing) return;
    isGitSyncing = true;
    try {
      const gitBin = findGitExecutable();
      const statusRes = await runGitAsync(gitBin, ['status', '--porcelain', 'database/workshop_db.json', 'database/workshop_db.js', 'dist/database/workshop_db.json', 'dist/database/workshop_db.js']);
      if (statusRes.code === 0 && statusRes.out.trim()) {
        await runGitAsync(gitBin, ['add', 'database/workshop_db.json', 'database/workshop_db.js', 'dist/database/workshop_db.json', 'dist/database/workshop_db.js']);
        const commitRes = await runGitAsync(gitBin, ['commit', '-m', 'chore(db): auto sync workshop database']);
        if (commitRes.code === 0) {
          const pushRes = await runGitAsync(gitBin, ['push', 'origin', 'main']);
          if (pushRes.code === 0) {
            console.log('[GIT CDN] Đã tự động đồng bộ cơ sở dữ liệu lên GitHub / xepphoi.cloud!');
          }
        }
      }
    } catch (e) {
      // Im lặng nếu đang offline hoặc có xung đột
    } finally {
      isGitSyncing = false;
    }
  }, 5000);
}

// Tự động đẩy toàn bộ cơ sở dữ liệu lên Đám mây 24/7 (ntfy.sh) để đồng bộ Realtime tức thì
function pushDbToGlobalCloud(actionName = 'server_sync') {
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    try {
      const lightDb = buildLightDbSnapshot(actionName);
      const payload = JSON.stringify(lightDb);

      const options = {
        hostname: 'ntfy.sh',
        path: `/${NTFY_TOPIC}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Filename': 'workshop_db.json',
          'Title': `AnBinh Server AutoSync (${actionName})`,
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[CLOUD 24/7] Đã đẩy thành công toàn bộ cơ sở dữ liệu lên Đám mây (${actionName}).`);
        }
      });
      req.on('error', () => {});
      req.write(payload);
      req.end();
    } catch (err) {}
  }, 400);
}

function saveDb(action = 'db_save', options = {}) {
  try {
    db.updatedAt = new Date().toISOString();
    db.publicUrl = publicTunnelUrl || db.publicUrl || null;
    db.lanUrls = getLanAddresses();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    const lightDb = buildLightDbSnapshot(action);
    writeWorkshopDbJs(lightDb);
    if (!options.skipCloudPush) {
      pushDbToGlobalCloud(action);
    }
    if (!options.skipGitPush) {
      scheduleGitAutoSync();
    }
  } catch (err) {
    console.error('[DB] Lỗi lưu database:', err.message);
  }
}

function extractMatFromProfile(pName) {
  if (!pName) return 30;
  const m = String(pName).match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X|\*|×)(\d+)/i);
  if (m) return Math.max(parseInt(m[1]), parseInt(m[2]));
  const mRound = String(pName).match(/(?:Ø|D|Phi)\s*(\d+)/i);
  if (mRound) return parseInt(mRound[1]);
  return 30;
}

// Chuyển đổi payload từ Fusion 360 thành cấu trúc dự án chuẩn và lưu các file .IGS
function processFusionPayload(fusionData) {
  if (!fusionData || (!fusionData.parts && !Array.isArray(fusionData))) return null;

  const partsList = Array.isArray(fusionData) ? fusionData : (fusionData.parts || []);
  if (!partsList.length) return null;

  const clampTail = fusionData.clamp_tail != null ? Number(fusionData.clamp_tail) : 80;
  const kerf = fusionData.kerf != null ? Number(fusionData.kerf) : 0;
  const projName = fusionData.project_name
    ? `${fusionData.project_name}`
    : `Bản vẽ Fusion 360 (${new Date().toLocaleDateString('vi-VN')})`;

  const activeProfiles = [];
  const newParts = partsList.map((p, idx) => {
    const prof = p.profile || 'Hộp 30x30x1.8';
    if (!activeProfiles.includes(prof)) activeProfiles.push(prof);
    if (!db.savedProfiles.includes(prof)) db.savedProfiles.push(prof);

    let pieceIgsUrl = null;
    if (p.igs_content && p.igs_content.length > 50) {
      const safePartFileName = `${p.name || ('Chi_tiet_' + (idx + 1))}.igs`
        .replace(/\.igs\.igs$/i, '.igs')
        .replace(/[\/\\:*?"<>|]/g, '_');
      try {
        fs.writeFileSync(path.join(IGS_DIR, safePartFileName), p.igs_content, 'utf8');
        pieceIgsUrl = `/api/igs/${encodeURIComponent(safePartFileName)}`;
      } catch (e) {}
    }

    return {
      id: 'p_f360_' + Date.now() + '_' + idx,
      name: p.name || `Chi tiết ${idx + 1}`,
      profile: prof,
      length: Number(p.length) || 0,
      qty: Number(p.qty) || 1,
      style: p.style || 'thang',
      mat: p.mat || extractMatFromProfile(prof),
      igs_url: pieceIgsUrl,
      _autoDetected: true
    };
  });

  const newStock = activeProfiles.map((prof, idx) => ({
    id: 's_f360_' + Date.now() + '_' + idx,
    profile: prof,
    name: `Cây mới 6.000 (${prof})`,
    length: 6000,
    qty: null,
    clamp: clampTail
  }));

  // Lưu các file .IGS của cây ghép ra thư mục server để mọi thiết bị tải được nhẹ nhàng
  const lightNestedBars = [];
  if (Array.isArray(fusionData.nested_bars)) {
    fusionData.nested_bars.forEach(bar => {
      const safeFileName = `${bar.name || ('Cay_' + bar.letter)}.igs`.replace(/\.igs\.igs$/i, '.igs').replace(/[\/\\:*?"<>|]/g, '_');
      if (bar.igs_content && bar.igs_content.length > 50) {
        try {
          fs.writeFileSync(path.join(IGS_DIR, safeFileName), bar.igs_content, 'utf8');
        } catch (e) {}
      } else if (bar.igs_file && fs.existsSync(bar.igs_file)) {
        try {
          fs.copyFileSync(bar.igs_file, path.join(IGS_DIR, safeFileName));
        } catch (e) {}
      }
      lightNestedBars.push({
        name: bar.name,
        profile: bar.profile,
        letter: bar.letter,
        count: bar.count || 1,
        cuts_count: bar.cuts_count,
        pieces: bar.pieces || [],
        igs_url: `/api/igs/${encodeURIComponent(safeFileName)}`
      });
    });
  }

  const lightFusionMeta = {
    project_name: fusionData.project_name,
    export_dir: fusionData.export_dir,
    stock_length: fusionData.stock_length || 6000,
    clamp_tail: clampTail,
    kerf: kerf,
    nested_bars: lightNestedBars
  };

  const nowStr = new Date().toISOString();
  const projectDataPayload = {
    activeProfiles: activeProfiles,
    selectedTabProfile: activeProfiles[0] || 'Hộp 30x30x1.8',
    parts: newParts,
    stock: newStock,
    method: 'cnc',
    kerf: kerf,
    clamp: clampTail,
    interlock: true,
    gap: 0,
    fusionProject: lightFusionMeta
  };

  // Kiểm tra xem dự án cùng tên đã có chưa để cập nhật hoặc tạo mới
  let existingProj = db.savedProjects.find(p => p.name === projName);
  if (existingProj) {
    existingProj.updatedAt = nowStr;
    existingProj.data = projectDataPayload;
  } else {
    existingProj = {
      id: 'proj_f360_' + Date.now(),
      name: projName,
      customer: 'Fusion 360 CAD',
      notes: ` Tự động đồng bộ từ Fusion 360 (${newParts.length} mục, ${activeProfiles.length} loại hộp)`,
      createdAt: nowStr,
      updatedAt: nowStr,
      data: projectDataPayload
    };
    db.savedProjects.unshift(existingProj);
  }

  db.activeProject = {
    currentProjectId: existingProj.id,
    currentProjectName: existingProj.name,
    currentProjectCustomer: existingProj.customer,
    currentProjectNotes: existingProj.notes,
    ...projectDataPayload
  };

  saveDb();
  return existingProj;
}

function loadInitialDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        db = Object.assign(db, raw);
        if (!Array.isArray(db.users) || !db.users.length) {
          db.users = DEFAULT_USERS.slice();
        }
        if (!Array.isArray(db.savedProfiles) || !db.savedProfiles.length) {
          db.savedProfiles = DEFAULT_PROFILES.slice();
        }
        if (!Array.isArray(db.savedProjects)) {
          db.savedProjects = [];
        }
        if (!Array.isArray(db.deletedProjectIds)) {
          db.deletedProjectIds = [];
        }
        if (!db.cutStatuses || typeof db.cutStatuses !== 'object') {
          db.cutStatuses = {};
        }
        console.log(`[DB] Đã nạp ${db.savedProjects.length} dự án và ${db.users.length} tài khoản từ cơ sở dữ liệu máy chủ.`);
        saveDb('server_start');
        return;
      }
    } catch (e) {
      console.warn('[DB] Khởi tạo lại database do file cũ lỗi:', e.message);
    }
  }

  // Nếu chạy lần đầu chưa có DB, kiểm tra xem có dự án xuất sẵn trên Desktop không để nạp luôn
  const desktopSample = 'C:/Users/Administrator/Desktop/TEST/Bàn thao tác/fusion_exported_project.json';
  if (fs.existsSync(desktopSample)) {
    try {
      const fData = JSON.parse(fs.readFileSync(desktopSample, 'utf8'));
      processFusionPayload(fData);
      console.log('[DB] Đã tự động nạp dự án mẫu "Bàn thao tác" từ Fusion 360 vào Server.');
    } catch (e) {}
  }
  saveDb('server_start');
}

loadInitialDb();

// =========================================================================
// HỆ THỐNG MERGE DỮ LIỆU ĐỒNG BỘ SONG SONG (NON-DESTRUCTIVE CRDT-LIKE MERGE)
// Thiết bị hoạt động độc lập - Dữ liệu đồng bộ song song không ghi đè
// =========================================================================

function mergeSavedProjects(existing = [], incoming = [], deletedIds = []) {
  if (!Array.isArray(incoming)) return existing || [];
  const delSet = new Set([
    ...(Array.isArray(deletedIds) ? deletedIds : []),
    ...(Array.isArray(db.deletedProjectIds) ? db.deletedProjectIds : [])
  ]);
  const map = new Map();

  // Đưa các dự án hiện có vào map (bỏ qua những ID đã bị xóa)
  (existing || []).forEach(p => {
    if (p && p.id && !delSet.has(p.id)) {
      map.set(p.id, p);
    }
  });

  // Hợp nhất các dự án mới gửi lên: nếu trùng ID thì giữ bản có timestamp mới hơn
  incoming.forEach(p => {
    if (!p || !p.id || delSet.has(p.id)) return;
    const cur = map.get(p.id);
    if (!cur) {
      map.set(p.id, p);
    } else {
      const incTime = new Date(p.updatedAt || p.createdAt || 0).getTime();
      const curTime = new Date(cur.updatedAt || cur.createdAt || 0).getTime();
      if (incTime >= curTime) {
        map.set(p.id, p);
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
  });
}

function mergeProfiles(existing = [], incoming = []) {
  if (!Array.isArray(incoming)) return existing || [];
  const set = new Set(existing || []);
  incoming.forEach(p => {
    if (p && typeof p === 'string' && p.trim()) {
      set.add(p.trim());
    }
  });
  return Array.from(set);
}

function mergeCutStatuses(existing = {}, incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return existing || {};
  const merged = Object.assign({}, existing || {});
  Object.keys(incoming).forEach(k => {
    const incVal = incoming[k];
    const curVal = merged[k];
    if (!curVal) {
      merged[k] = incVal;
    } else {
      const incCount = (typeof incVal === 'object' && incVal.cutCount != null) ? incVal.cutCount : (typeof incVal === 'number' ? incVal : 0);
      const curCount = (typeof curVal === 'object' && curVal.cutCount != null) ? curVal.cutCount : (typeof curVal === 'number' ? curVal : 0);
      const maxCount = Math.max(incCount, curCount);

      if (typeof incVal === 'object') {
        merged[k] = Object.assign({}, curVal, incVal, { cutCount: maxCount });
      } else {
        merged[k] = maxCount;
      }
    }
  });
  return merged;
}

function mergeUsers(existing = [], incoming = []) {
  if (!Array.isArray(incoming)) return existing || [];
  const map = new Map();
  (existing || []).forEach(u => {
    if (u && u.username) map.set(u.username.toLowerCase(), u);
  });
  incoming.forEach(u => {
    if (u && u.username) {
      const k = u.username.toLowerCase();
      map.set(k, Object.assign({}, map.get(k) || {}, u));
    }
  });
  return Array.from(map.values());
}

// Lấy danh sách địa chỉ IP mạng LAN của máy chủ
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

function broadcastEvent(eventData, excludeClientId = null) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const [cid, res] of sseClients.entries()) {
    if (excludeClientId && cid === excludeClientId) continue;
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(cid);
    }
  }
}

// Hàm áp dụng dữ liệu đồng bộ dùng chung giữa /api/sync và kênh Cloud Inbound 24/7
function applyIncomingSyncPayload(body, clientId = null, saveOptions = {}) {
  if (!body || typeof body !== 'object') return null;
  const action = body.action || 'sync';

  if (Array.isArray(body.deletedProjectIds) && body.deletedProjectIds.length) {
    if (!Array.isArray(db.deletedProjectIds)) db.deletedProjectIds = [];
    body.deletedProjectIds.forEach(did => {
      if (did && !db.deletedProjectIds.includes(did)) db.deletedProjectIds.push(did);
    });
  }

  if (Array.isArray(body.savedProjects)) {
    db.savedProjects = mergeSavedProjects(db.savedProjects, body.savedProjects, body.deletedProjectIds);
  }

  if (Array.isArray(body.savedProfiles) && body.savedProfiles.length) {
    db.savedProfiles = (action === 'profiles' && !saveOptions.fromCloudPoll)
      ? Array.from(new Set(body.savedProfiles.map(s => String(s).trim()).filter(Boolean)))
      : mergeProfiles(db.savedProfiles, body.savedProfiles);
  }

  if (body.cutStatuses && typeof body.cutStatuses === 'object') {
    db.cutStatuses = mergeCutStatuses(db.cutStatuses, body.cutStatuses);
  }

  if (Array.isArray(body.users) && body.users.length) {
    db.users = (action === 'update_users' && !saveOptions.fromCloudPoll)
      ? body.users
      : mergeUsers(db.users, body.users);
  }

  if (body.activeProject && (action === 'fusion_import' || action === 'save_project' || action === 'active_project' || !db.activeProject)) {
    db.activeProject = body.activeProject;
  }

  saveDb(action, saveOptions);

  const broadcastPayload = {
    type: 'state_updated',
    senderId: clientId,
    updatedAt: db.updatedAt,
    action: action,
    db: {
      workspaceId: db.workspaceId,
      updatedAt: db.updatedAt,
      publicUrl: publicTunnelUrl || db.publicUrl || null,
      lanUrls: getLanAddresses(),
      savedProfiles: db.savedProfiles,
      savedProjects: db.savedProjects,
      deletedProjectIds: db.deletedProjectIds,
      cutStatuses: db.cutStatuses,
      users: db.users,
      activeProject: (action === 'fusion_import') ? db.activeProject : undefined
    }
  };

  broadcastEvent(broadcastPayload, clientId);
  return broadcastPayload;
}

// Lắng nghe chiều về từ Đám mây 24/7 (ntfy.sh/toiuu_phoi_anbinh_db_v3) để cập nhật khi thiết bị ngoài 4G lưu dữ liệu
function fetchJsonUrl(targetUrl) {
  return new Promise((resolve) => {
    try {
      https.get(targetUrl, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    } catch (e) { resolve(null); }
  });
}

async function processCloudMessageObj(msg) {
  if (!msg || msg.event !== 'message') return;
  let cloudDb = null;
  if (msg.attachment && msg.attachment.url) {
    cloudDb = await fetchJsonUrl(msg.attachment.url);
  } else if (msg.message && msg.message.trim().startsWith('{')) {
    try { cloudDb = JSON.parse(msg.message); } catch (e) {}
  }
  if (!cloudDb || cloudDb.senderId === 'server_anbinh_host') return;
  applyIncomingSyncPayload(cloudDb, cloudDb.senderId || null, { skipCloudPush: true, fromCloudPoll: true });
}

function startCloudInboundListener() {
  // 1. Nạp tin nhắn 24h gần nhất nếu có thay đổi khi server tắt
  https.get(`https://ntfy.sh/${NTFY_TOPIC}/json?poll=1&since=24h`, (res) => {
    let raw = '';
    res.on('data', c => { raw += c; });
    res.on('end', async () => {
      const lines = raw.trim().split('\n').filter(Boolean);
      for (const l of lines.slice(-5)) {
        try { await processCloudMessageObj(JSON.parse(l)); } catch (e) {}
      }
    });
  }).on('error', () => {});

  // 2. Mở stream lắng nghe thời gian thực từ Đám mây 24/7
  const connectStream = () => {
    try {
      const req = https.get(`https://ntfy.sh/${NTFY_TOPIC}/json`, (res) => {
        let buf = '';
        res.on('data', async (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try { await processCloudMessageObj(JSON.parse(t)); } catch (e) {}
          }
        });
        res.on('close', () => setTimeout(connectStream, 10000));
        res.on('error', () => setTimeout(connectStream, 10000));
      });
      req.on('error', () => setTimeout(connectStream, 15000));
    } catch (e) {
      setTimeout(connectStream, 15000);
    }
  };
  connectStream();
}

// Tự động thiết lập Cloud Internet Tunnel (localhost.run qua SSH) để điện thoại 4G/5G ngoài xưởng cũng vào được
function startPublicCloudTunnel() {
  try {
    const sshCmd = fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
      ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
      : 'ssh';

    const tunnel = spawn(sshCmd, [
      '-T',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', `80:127.0.0.1:${PORT}`,
      'nokey@localhost.run'
    ], { windowsHide: true });

    const handleOutput = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/);
      if (match && match[0] !== publicTunnelUrl) {
        publicTunnelUrl = match[0];
        console.log(`[CLOUD TUNNEL] Link Internet Toàn Cầu: ${publicTunnelUrl}`);
        saveDb('tunnel_ready');
        broadcastEvent({
          type: 'server_info',
          publicUrl: publicTunnelUrl,
          lanUrls: getLanAddresses(),
          clientsCount: sseClients.size
        });
      }
    };

    tunnel.stdout.on('data', handleOutput);
    tunnel.stderr.on('data', handleOutput);
    tunnel.on('close', () => {
      publicTunnelUrl = null;
      setTimeout(startPublicCloudTunnel, 15000);
    });
    tunnel.on('error', () => {});
  } catch (e) {}
}

startPublicCloudTunnel();

// Đọc body JSON của HTTP Request
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
  // CORS Headers cho phép mọi thiết bị truy cập
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

  // 1. Kênh SSE Realtime (/api/events)
  if (pathname === '/api/events' && req.method === 'GET') {
    const clientId = parsedUrl.searchParams.get('clientId') || ('client_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    sseClients.set(clientId, res);

    // Gửi trạng thái ban đầu ngay khi kết nối
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      clientId,
      clientsCount: sseClients.size,
      lanUrls: getLanAddresses(),
      publicUrl: publicTunnelUrl,
      db
    })}\n\n`);

    // Thông báo số lượng thiết bị đang online cho các máy khác
    broadcastEvent({
      type: 'clients_count',
      clientsCount: sseClients.size
    }, clientId);

    req.on('close', () => {
      sseClients.delete(clientId);
      broadcastEvent({
        type: 'clients_count',
        clientsCount: sseClients.size
      });
    });
    return;
  }

  // 2. Lấy thông tin máy chủ & trạng thái (/api/info & /api/state)
  if ((pathname === '/api/info' || pathname === '/api/state') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      serverTime: new Date().toISOString(),
      port: PORT,
      lanUrls: getLanAddresses(),
      publicUrl: publicTunnelUrl,
      clientsCount: sseClients.size,
      db
    }));
    return;
  }

  // 2b. Lấy danh sách dự án dùng chung cho các nhánh web (/api/projects)
  if (pathname === '/api/projects' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      projects: db.savedProjects || [],
      deletedProjectIds: db.deletedProjectIds || [],
      updatedAt: db.updatedAt
    }));
    return;
  }

  // 3. Đồng bộ trạng thái song song từ bất kỳ thiết bị nào (/api/sync)
  // Quy tắc: Thiết bị hoạt động độc lập - Dữ liệu dùng chung đồng bộ song song không ghi đè
  if (pathname === '/api/sync' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const clientId = body.clientId || req.headers['x-client-id'] || null;

      applyIncomingSyncPayload(body, clientId, { skipCloudPush: false });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        updatedAt: db.updatedAt,
        clientsCount: sseClients.size,
        savedProjectsCount: (db.savedProjects || []).length
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 4. API Nhận dữ liệu trực tiếp từ Script Autodesk Fusion 360 (/api/fusion-import)
  if (pathname === '/api/fusion-import' && req.method === 'POST') {
    try {
      const fusionData = await readJsonBody(req);
      const importedProj = processFusionPayload(fusionData);
      if (!importedProj) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Dữ liệu Fusion 360 trống hoặc không hợp lệ' }));
        return;
      }

      console.log(`[FUSION 360] Đã nhận và đồng bộ dự án "${importedProj.name}" tới ${sseClients.size} thiết bị!`);

      // Phát sóng ngay lập tức cho mọi trình duyệt đang mở trên PC / Điện thoại / Máy CNC
      broadcastEvent({
        type: 'fusion_imported',
        projectName: importedProj.name,
        projectId: importedProj.id,
        updatedAt: db.updatedAt,
        db
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        projectId: importedProj.id,
        projectName: importedProj.name,
        webUrl: `http://localhost:${PORT}`,
        lanUrls: getLanAddresses()
      }));
    } catch (err) {
      console.error('[FUSION 360] Lỗi import:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 5. Tải file 3D .IGS của cây ghép (/api/igs/:filename)
  if (pathname.startsWith('/api/igs/') && req.method === 'GET') {
    let fileName = path.basename(decodeURIComponent(pathname.replace('/api/igs/', '')));
    let filePath = path.join(IGS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      // Thử tìm file tương đương nếu có dấu / không dấu
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
      res.end(JSON.stringify({ error: 'Không tìm thấy file .IGS trên máy chủ' }));
      return;
    }
  }

  // 6. Phục vụ các file tĩnh & nhánh web con (index.html, projects.html, inventory.html, cnc.html, admin.html...)
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

  // Ngăn chặn truy cập ngoài thư mục gốc
  if (!fullPath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Tự động tìm index.html nếu trỏ vào thư mục (ví dụ /admin/)
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    const indexPath = path.join(fullPath, 'index.html');
    if (fs.existsSync(indexPath)) fullPath = indexPath;
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isDbAsset = pathname.startsWith('/database/workshop_db.');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isDbAsset ? 'no-store, no-cache, must-revalidate' : 'no-cache'
    });
    fs.createReadStream(fullPath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Không tìm thấy trang');
  }
});

// Giữ kết nối SSE không bị timeout bằng heartbeat mỗi 20 giây
setInterval(() => {
  for (const [cid, res] of sseClients.entries()) {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      sseClients.delete(cid);
    }
  }
}, 20000);

server.listen(PORT, () => {
  const lanList = getLanAddresses();
  console.log('====================================================================');
  console.log(' 🚀 MÁY CHỦ WEB TỐI ƯU XẾP PHÔI AN BÌNH ĐÃ KHỞI ĐỘNG THÀNH CÔNG!');
  console.log('====================================================================');
  console.log(` 💻 Truy cập trên máy tính này : http://localhost:${PORT}`);
  lanList.forEach(item => {
    console.log(` 📱 Truy cập Điện thoại/Máy CNC : ${item.url} (${item.interface})`);
  });
  console.log('====================================================================');
  startCloudInboundListener();
});
        
