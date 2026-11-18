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

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DB_DIR = path.join(ROOT_DIR, 'database');
const IGS_DIR = path.join(DB_DIR, 'igs_files');
const DB_FILE = path.join(DB_DIR, 'workshop_db.json');

// Đảm bảo thư mục database tồn tại
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(IGS_DIR)) fs.mkdirSync(IGS_DIR, { recursive: true });

const DEFAULT_PROFILES = [
  'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
  'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0',
  'Ống Ø27x1.4', 'Ống Ø34x1.4'
];

// Khởi tạo hoặc đọc Database
let db = {
  workspaceId: 'ANBINH',
  updatedAt: new Date().toISOString(),
  savedProfiles: DEFAULT_PROFILES.slice(),
  savedProjects: [],
  activeProject: null
};

function saveDb() {
  try {
    db.updatedAt = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
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

    return {
      id: 'p_f360_' + Date.now() + '_' + idx,
      name: p.name || `Chi tiết ${idx + 1}`,
      profile: prof,
      length: Number(p.length) || 0,
      qty: Number(p.qty) || 1,
      style: p.style || 'thang',
      mat: p.mat || extractMatFromProfile(prof),
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
        console.log(`[DB] Đã nạp ${db.savedProjects.length} dự án từ cơ sở dữ liệu máy chủ.`);
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
  saveDb();
}

loadInitialDb();

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

// Quản lý kết nối Realtime SSE (Server-Sent Events)
const sseClients = new Map();
let publicTunnelUrl = null;

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

// Tự động thiết lập Cloud Internet Tunnel (localhost.run qua SSH) để điện thoại 4G/5G ngoài xưởng cũng vào được
function startPublicCloudTunnel() {
  try {
    const sshCmd = fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
      ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
      : 'ssh';

    const tunnel = spawn(sshCmd, [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', `80:localhost:${PORT}`,
      'nokey@localhost.run'
    ], { windowsHide: true });

    const handleOutput = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/);
      if (match && match[0] !== publicTunnelUrl) {
        publicTunnelUrl = match[0];
        console.log(`[CLOUD TUNNEL] Link Internet Toàn Cầu: ${publicTunnelUrl}`);
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

  // 3. Đồng bộ trạng thái từ bất kỳ thiết bị nào (/api/sync)
  if (pathname === '/api/sync' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const clientId = body.clientId || req.headers['x-client-id'] || null;

      if (Array.isArray(body.savedProfiles)) {
        db.savedProfiles = body.savedProfiles;
      }
      if (Array.isArray(body.savedProjects)) {
        db.savedProjects = body.savedProjects;
      }
      if (body.activeProject !== undefined) {
        db.activeProject = body.activeProject;
      }
      saveDb();

      // Phát sóng tức thì tới tất cả các thiết bị khác đang mở
      broadcastEvent({
        type: 'state_updated',
        senderId: clientId,
        updatedAt: db.updatedAt,
        action: body.action || 'sync',
        db
      }, clientId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, updatedAt: db.updatedAt, clientsCount: sseClients.size }));
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
    const fileName = path.basename(pathname.replace('/api/igs/', ''));
    const filePath = path.join(IGS_DIR, fileName);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Không tìm thấy file .IGS trên máy chủ' }));
      return;
    }
  }

  // 6. Phục vụ các file tĩnh của Web App (index.html, toi-uu-engine.js, logo_an_binh.jpg...)
  let safePath = pathname === '/' ? '/index.html' : pathname;
  let fullPath = path.join(ROOT_DIR, safePath);

  // Ngăn chặn truy cập ngoài thư mục gốc
  if (!fullPath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
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

server.listen(PORT, '0.0.0.0', () => {
  const lanList = getLanAddresses();
  console.log('====================================================================');
  console.log(' 🚀 MÁY CHỦ WEB TỐI ƯU XẾP PHÔI AN BÌNH ĐÃ KHỞI ĐỘNG THÀNH CÔNG!');
  console.log('====================================================================');
  console.log(` 💻 Truy cập trên máy tính này : http://localhost:${PORT}`);
  lanList.forEach(item => {
    console.log(` 📱 Truy cập Điện thoại/Máy CNC : ${item.url} (${item.interface})`);
  });
  console.log('====================================================================');
});
