import { getStore } from "@netlify/blobs";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Client-Id",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function extractMatFromProfile(pName) {
  if (!pName) return 30;
  const m = String(pName).match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X|\*|×)(\d+)/i);
  if (m) return Math.max(parseInt(m[1]), parseInt(m[2]));
  const mRound = String(pName).match(/(?:Ø|D|Phi)\s*(\d+)/i);
  if (mRound) return parseInt(mRound[1]);
  return 30;
}

export const config = {
  path: "/api/*"
};

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  // pathname can be /api/foo or /.netlify/functions/api/foo
  let path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "/api");
  if (!path.startsWith("/api")) {
    path = "/api" + path;
  }

  // Khởi tạo các Blob Store bền vững trên Netlify
  const projectsStore = getStore({ name: "anbinh_projects", consistency: "strong" });
  const igsStore = getStore({ name: "anbinh_igs_files", consistency: "strong" });
  const stateStore = getStore({ name: "anbinh_state", consistency: "strong" });

  try {
    // 1. Tải file 3D .IGS của cây ghép: GET /api/igs/:filename
    if (path.startsWith("/api/igs/") && req.method === "GET") {
      const rawName = path.replace("/api/igs/", "");
      const fileName = decodeURIComponent(rawName);
      const content = await igsStore.get(fileName, { type: "text" });
      if (!content) {
        return jsonResponse({ success: false, error: "Không tìm thấy file .IGS trên đám mây" }, 404);
      }
      return new Response(content, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
        }
      });
    }

    // 2. Nhận dữ liệu xuất trực tiếp từ Fusion 360: POST /api/fusion-import
    if (path === "/api/fusion-import" && req.method === "POST") {
      const fusionData = await req.json();
      const partsList = Array.isArray(fusionData) ? fusionData : (fusionData.parts || []);
      if (!partsList.length) {
        return jsonResponse({ success: false, error: "Dữ liệu bản vẽ rỗng" }, 400);
      }

      const clampTail = fusionData.clamp_tail != null ? Number(fusionData.clamp_tail) : 80;
      const kerf = fusionData.kerf != null ? Number(fusionData.kerf) : 0;
      const projName = fusionData.project_name
        ? `${fusionData.project_name}`
        : `Bản vẽ Fusion 360 (${new Date().toLocaleDateString('vi-VN')})`;

      // Đọc danh mục quy cách đã lưu
      let savedProfiles = await stateStore.get("saved_profiles", { type: "json" }) || DEFAULT_PROFILES.slice();
      const activeProfiles = [];

      const newParts = [];
      for (let idx = 0; idx < partsList.length; idx++) {
        const p = partsList[idx];
        const prof = p.profile || 'Hộp 30x30x1.8';
        if (!activeProfiles.includes(prof)) activeProfiles.push(prof);
        if (!savedProfiles.includes(prof)) savedProfiles.push(prof);

        let pieceIgsUrl = null;
        if (p.igs_content && p.igs_content.length > 50) {
          const safePartFileName = `${p.name || ('Chi_tiet_' + (idx + 1))}.igs`
            .replace(/\.igs\.igs$/i, '.igs')
            .replace(/[\/\\:*?"<>|]/g, '_');
          await igsStore.set(safePartFileName, p.igs_content);
          pieceIgsUrl = `/api/igs/${encodeURIComponent(safePartFileName)}`;
        }

        newParts.push({
          id: 'p_f360_' + Date.now() + '_' + idx,
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
        id: 's_f360_' + Date.now() + '_' + idx,
        profile: prof,
        name: `Cây mới 6.000 (${prof})`,
        length: 6000,
        qty: null,
        clamp: clampTail
      }));

      // Lưu trữ các file .IGS lên Đám Mây Netlify Blobs để mọi máy CNC và điện thoại đều tải được
      const lightNestedBars = [];
      if (Array.isArray(fusionData.nested_bars)) {
        for (const bar of fusionData.nested_bars) {
          const safeFileName = `${bar.name || ('Cay_' + bar.letter)}.igs`
            .replace(/\.igs\.igs$/i, '.igs')
            .replace(/[\/\\:*?"<>|]/g, '_');

          if (bar.igs_content && bar.igs_content.length > 50) {
            await igsStore.set(safeFileName, bar.igs_content);
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
        }
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

      const projId = 'proj_f360_' + Date.now();
      const projectRecord = {
        id: projId,
        name: projName,
        customer: 'Fusion 360 CAD',
        notes: `Tự động đồng bộ từ Fusion 360 (${newParts.length} mục, ${activeProfiles.length} loại hộp)`,
        createdAt: nowStr,
        updatedAt: nowStr,
        data: projectDataPayload
      };

      // Lưu vĩnh viễn dự án vào Netlify Blobs
      await projectsStore.setJSON(projId, projectRecord);

      // Cập nhật chỉ mục danh sách dự án
      let projectIndex = await projectsStore.get("index", { type: "json" }) || [];
      // Thay thế dự án cũ nếu trùng tên
      projectIndex = projectIndex.filter(p => p.name !== projName);
      projectIndex.unshift({
        id: projId,
        name: projName,
        customer: projectRecord.customer,
        notes: projectRecord.notes,
        createdAt: nowStr,
        updatedAt: nowStr
      });
      await projectsStore.setJSON("index", projectIndex);

      // Lưu trạng thái đang mở
      const activeState = {
        currentProjectId: projId,
        currentProjectName: projName,
        currentProjectCustomer: projectRecord.customer,
        currentProjectNotes: projectRecord.notes,
        updatedAt: nowStr,
        ...projectDataPayload
      };
      await stateStore.setJSON("active_project", activeState);
      await stateStore.setJSON("saved_profiles", savedProfiles);

      // Bắn tín hiệu Realtime tức thì qua Cloud Broadcast đến tất cả thiết bị
      try {
        fetch("https://ntfy.sh/toiuu_phoi_anbinh_cloud_v2", {
          method: "POST",
          headers: { "Title": "Fusion 360", "Priority": "high" },
          body: JSON.stringify({ action: "fusion_import", projectId: projId, projectName: projName, timestamp: Date.now() })
        }).catch(() => {});
      } catch (e) {}

      return jsonResponse({
        success: true,
        projectId: projId,
        projectName: projName,
        webUrl: "https://xepphoi.cloud"
      });
    }

    // 3. Lấy danh sách toàn bộ dự án từ Đám Mây: GET /api/projects
    if (path === "/api/projects" && req.method === "GET") {
      let index = await projectsStore.get("index", { type: "json" });
      if (!index || !Array.isArray(index)) {
        index = [];
        // Nếu chưa có index, quét danh sách blobs
        const listRes = await projectsStore.list();
        for (const b of (listRes.blobs || [])) {
          if (b.key.startsWith("proj_")) {
            const p = await projectsStore.get(b.key, { type: "json" });
            if (p) {
              index.push({
                id: p.id,
                name: p.name,
                customer: p.customer,
                notes: p.notes,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
              });
            }
          }
        }
      }
      return jsonResponse({ success: true, projects: index });
    }

    // 4. Lấy chi tiết 1 dự án: GET /api/projects/:id
    if (path.startsWith("/api/projects/") && req.method === "GET") {
      const projId = path.replace("/api/projects/", "").trim();
      const project = await projectsStore.get(projId, { type: "json" });
      if (!project) {
        return jsonResponse({ success: false, error: "Không tìm thấy dự án" }, 404);
      }
      return jsonResponse({ success: true, project });
    }

    // 5. Lưu/Cập nhật dự án từ Web: POST /api/projects
    if (path === "/api/projects" && req.method === "POST") {
      const body = await req.json();
      const projId = body.id || ('proj_' + Date.now());
      const nowStr = new Date().toISOString();

      const record = {
        id: projId,
        name: body.name || 'Dự án mới',
        customer: body.customer || '',
        notes: body.notes || '',
        createdAt: body.createdAt || nowStr,
        updatedAt: nowStr,
        data: body.data || body
      };

      await projectsStore.setJSON(projId, record);

      // Cập nhật index
      let index = await projectsStore.get("index", { type: "json" }) || [];
      index = index.filter(p => p.id !== projId);
      index.unshift({
        id: projId,
        name: record.name,
        customer: record.customer,
        notes: record.notes,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
      await projectsStore.setJSON("index", index);

      return jsonResponse({ success: true, project: record });
    }

    // 6. Xóa dự án: DELETE /api/projects?id=...
    if (path === "/api/projects" && req.method === "DELETE") {
      const projId = url.searchParams.get("id");
      if (projId) {
        await projectsStore.delete(projId);
        let index = await projectsStore.get("index", { type: "json" }) || [];
        index = index.filter(p => p.id !== projId);
        await projectsStore.setJSON("index", index);
      }
      return jsonResponse({ success: true });
    }

    // 7. Lấy trạng thái máy chủ & dự án đang mở: GET /api/state hoặc GET /api/info
    if ((path === "/api/state" || path === "/api/info") && req.method === "GET") {
      const activeProject = await stateStore.get("active_project", { type: "json" });
      const savedProfiles = await stateStore.get("saved_profiles", { type: "json" }) || DEFAULT_PROFILES;
      const index = await projectsStore.get("index", { type: "json" }) || [];
      const cutStatuses = await stateStore.get("cut_statuses", { type: "json" }) || {};
      const users = await stateStore.get("users", { type: "json" }) || DEFAULT_USERS;

      return jsonResponse({
        success: true,
        serverTime: new Date().toISOString(),
        cloudProvider: "Netlify Edge & Blobs 24/7",
        domain: "xepphoi.cloud",
        projectsCount: index.length,
        savedProfiles,
        activeProject,
        cutStatuses,
        users
      });
    }

    // 8. Đồng bộ trạng thái: POST /api/sync
    if (path === "/api/sync" && req.method === "POST") {
      const body = await req.json();
      if (body.savedProfiles) {
        await stateStore.setJSON("saved_profiles", body.savedProfiles);
      }
      if (body.activeProject) {
        await stateStore.setJSON("active_project", body.activeProject);
      }
      if (Array.isArray(body.users) && body.users.length > 0) {
        await stateStore.setJSON("users", body.users);
      }
      if (body.cutStatuses) {
        await stateStore.setJSON("cut_statuses", body.cutStatuses);
        try {
          fetch("https://ntfy.sh/toiuu_phoi_anbinh_cloud_v2", {
            method: "POST",
            headers: { "Title": "Tien Do Cat", "Priority": "default" },
            body: JSON.stringify({ action: "cut_progress", cutStatuses: body.cutStatuses, timestamp: Date.now() })
          }).catch(() => {});
        } catch (e) {}
      }
      if (Array.isArray(body.savedProjects) && body.savedProjects.length > 0) {
        const index = body.savedProjects.map(p => ({
          id: p.id,
          name: p.name,
          customer: p.customer || '',
          notes: p.notes || '',
          createdAt: p.createdAt || new Date().toISOString(),
          updatedAt: p.updatedAt || new Date().toISOString()
        }));
        await projectsStore.setJSON("index", index);
        for (const p of body.savedProjects) {
          if (p.id && p.data) {
            await projectsStore.setJSON(p.id, p);
          }
        }
      }
      return jsonResponse({ success: true, updatedAt: new Date().toISOString() });
    }

    return jsonResponse({ error: "Endpoint không tồn tại", path }, 404);
  } catch (err) {
    console.error("[API Error]", err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
