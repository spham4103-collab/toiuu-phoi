// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-fusion-token",
};

const STORAGE_BUCKET = "igs-files";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function classifyProfile(pName: string): string {
  const s = String(pName || "");
  if (/ống|ong|phi|ø/i.test(s)) return "round";
  const m = s.match(/(\d+)\s*[xX\*×]\s*(\d+)/);
  if (m) return parseInt(m[1], 10) === parseInt(m[2], 10) ? "square" : "rect";
  return "other";
}

function extractMatFromProfile(pName: string): number {
  if (!pName) return 30;
  const m = String(pName).match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X|\*)(\d+)/i);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
  const mR = String(pName).match(/(?:Ø|D|Phi)\s*(\d+)/i);
  return mR ? parseInt(mR[1], 10) : 30;
}

function toSafeFileName(name: string): string {
  return String(name || "file.igs")
    .replace(/\.igs\.igs$/i, ".igs")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
}

function toAsciiSafe(str: string): string {
  return String(str || "Proj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "Proj";
}

Deno.serve(async (req: Request) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed. Chỉ nhận phương thức POST." }, 405);
  }

  // 2. Lấy biến môi trường Supabase
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({
      success: false,
      error: "Supabase Edge Function chưa được cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.",
    }, 500);
  }

  // 3. Xác thực Bearer JWT của Kỹ sư
  const authHeader = req.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const userJwt = tokenMatch ? tokenMatch[1].trim() : "";

  if (!userJwt) {
    return jsonResponse({
      success: false,
      error: "Thiếu Bearer Token xác thực kỹ sư trong header Authorization.",
    }, 401);
  }

  // Khởi tạo Supabase client với user JWT để kiểm tra Auth session
  const userClient = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(userJwt);
  if (userErr || !userData || !userData.user) {
    return jsonResponse({
      success: false,
      error: `Phiên đăng nhập kỹ sư không hợp lệ hoặc đã hết hạn: ${userErr?.message || "Unauthorized"}`,
    }, 401);
  }
  const authUser = userData.user;

  // Khởi tạo Supabase admin client (Service Role) để kiểm tra role và thực hiện DB/Storage operations
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profErr } = await adminClient
    .from("profiles")
    .select("id, username, display_name, role")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profErr || !profile) {
    return jsonResponse({
      success: false,
      error: "Tài khoản chưa có hồ sơ phân quyền trong xưởng (không tìm thấy bản ghi profiles).",
    }, 403);
  }

  const role = String(profile.role || "").toLowerCase();
  if (!["admin", "engineer"].includes(role)) {
    return jsonResponse({
      success: false,
      error: `Tài khoản (@${profile.username}) có vai trò '${profile.role}'. Chỉ Kỹ sư (engineer) hoặc Quản trị viên (admin) mới được phép xuất dự án từ Fusion 360.`,
    }, 403);
  }

  // 4. Đọc body payload
  let payload: any;
  try {
    payload = await req.json();
  } catch (err: any) {
    return jsonResponse({ success: false, error: "Dữ liệu JSON request body không hợp lệ: " + err.message }, 400);
  }

  const action = String(payload.action || "").trim();

  // =========================================================================
  // LUỒNG 1: action === 'init' (Bước 1 của quy trình 2 bước)
  // Tính toán projectId, kiểm tra khóa/xuất kho (tự tạo version mới nếu cần),
  // upsert quy cách vật tư vào kho và trả về danh sách uploadTargets chuẩn hóa
  // =========================================================================
  if (action === "init") {
    const rawProjName = String(payload.project_name || "Bản vẽ cắt phôi CNC").trim();
    const partsList = Array.isArray(payload.parts) ? payload.parts : [];
    const nestedBars = Array.isArray(payload.nested_bars) ? payload.nested_bars : [];

    // Tìm dự án cùng tên đã có trên Supabase
    let existingProj: any = null;
    try {
      const { data: foundRows } = await adminClient
        .from("projects")
        .select("id, name, is_locked, inventory_deducted_at, data, created_at, igs_files")
        .eq("is_trashed", false)
        .eq("is_draft", false)
        .ilike("name", rawProjName)
        .limit(1);
      if (Array.isArray(foundRows) && foundRows.length) {
        existingProj = foundRows[0];
      }
    } catch (_e) {
      // bỏ qua lỗi tìm kiếm nếu chưa có
    }

    let finalProjName = rawProjName;
    let wasVersioned = false;
    let versionReason = "";
    let isUpdatingExisting = Boolean(existingProj);
    const randSuffix = Math.random().toString(36).slice(2, 7);

    // Kiểm tra bảo vệ dự án đang bị khóa hoặc đã xuất kho
    const existingDispatched = Boolean(
      existingProj && (
        existingProj.inventory_deducted_at ||
        (existingProj.data && (existingProj.data.inventoryDeductedAt || existingProj.data.inventory_deducted_at))
      )
    );

    if (existingProj && (existingProj.is_locked || existingDispatched)) {
      versionReason = existingProj.is_locked ? "locked" : "dispatched";
      let nextVer = 2;
      try {
        const escapedName = rawProjName.replace(/[%_]/g, "\\$&");
        const { data: verRows } = await adminClient
          .from("projects")
          .select("name")
          .eq("is_trashed", false)
          .eq("is_draft", false)
          .ilike("name", `${escapedName} (v%`);
        if (Array.isArray(verRows) && verRows.length) {
          let maxV = 1;
          for (const vr of verRows) {
            const m = String(vr.name || "").match(/\(v(\d+)/i);
            if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
          }
          nextVer = Math.max(2, maxV + 1);
        }
      } catch (_e) {}

      const d = new Date();
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      finalProjName = `${rawProjName} (v${nextVer} - ${stamp})`;
      existingProj = null;
      isUpdatingExisting = false;
      wasVersioned = true;
    }

    const projectId = existingProj ? existingProj.id : `proj_f360_${Date.now()}_${randSuffix}`;

    // Upsert bảng inventory với các quy cách ống/hộp phát hiện được
    const activeProfiles: string[] = [];
    for (const p of partsList) {
      const prof = p.profile || "Hộp 30x30x1.8";
      if (!activeProfiles.includes(prof)) activeProfiles.push(prof);
    }
    for (const b of nestedBars) {
      if (b.profile && !activeProfiles.includes(b.profile)) activeProfiles.push(b.profile);
    }

    if (activeProfiles.length) {
      const stdLen = Number(payload.stock_length) || 6000;
      const invRows = activeProfiles.map(prof => ({
        profile_name: prof,
        category: classifyProfile(prof),
        standard_length: stdLen,
        standard_length_mm: stdLen,
      }));
      try {
        await adminClient
          .from("inventory")
          .upsert(invRows, { onConflict: "profile_name", ignoreDuplicates: true });
      } catch (invErr: any) {
        console.warn("[EDGE FUNCTION] Cảnh báo upsert inventory:", invErr?.message);
      }
    }

    // Xây dựng danh sách uploadTargets chuẩn hóa
    const uploadTargets: Array<{
      kind: "part" | "bar";
      index?: number;
      letter?: string;
      name: string;
      profile: string;
      localFileName: string;
      storagePath: string;
    }> = [];

    partsList.forEach((p: any, idx: number) => {
      const safePartName = toSafeFileName(p.filename || `${p.name || ("Chi_tiet_" + (idx + 1))}.igs`);
      const storagePath = `${projectId}/parts/${safePartName}`;
      uploadTargets.push({
        kind: "part",
        index: idx,
        name: p.name || `Chi tiết ${idx + 1}`,
        profile: p.profile || (activeProfiles[0] || "Hộp 30x30x1.8"),
        localFileName: safePartName,
        storagePath: storagePath,
      });
    });

    nestedBars.forEach((bar: any) => {
      const safeBarName = toSafeFileName(bar.filename || `${bar.name || ("Cay_" + (bar.letter || "A"))}.igs`);
      const storagePath = `${projectId}/bars/${safeBarName}`;
      uploadTargets.push({
        kind: "bar",
        letter: bar.letter || "A",
        name: bar.name || safeBarName,
        profile: bar.profile || "",
        localFileName: safeBarName,
        storagePath: storagePath,
      });
    });

    return jsonResponse({
      success: true,
      action: "init",
      projectId,
      projectName: finalProjName,
      wasVersioned,
      versionReason,
      isUpdatingExisting,
      storageBucket: STORAGE_BUCKET,
      uploadTargets,
      activeProfiles,
      engineer: {
        username: profile.username,
        displayName: profile.display_name,
        role: profile.role,
      },
    });
  }

  // =========================================================================
  // LUỒNG 2: action === 'complete' (Bước 2 của quy trình 2 bước)
  // Nhận thông tin các file .IGS đã upload trực tiếp lên Storage, dọn dẹp file
  // mồ côi nếu có và lưu/cập nhật bản ghi dự án vào bảng projects
  // =========================================================================
  if (action === "complete") {
    const projectId = String(payload.projectId || "").trim();
    if (!projectId) {
      return jsonResponse({ success: false, error: "Thiếu projectId khi xác nhận complete." }, 400);
    }

    const finalProjName = String(payload.projectName || payload.project_name || "Bản vẽ cắt phôi CNC").trim();
    const wasVersioned = Boolean(payload.wasVersioned);
    const versionReason = String(payload.versionReason || "");
    const isUpdatingExisting = Boolean(payload.isUpdatingExisting);
    const kerf = Number(payload.kerf != null ? payload.kerf : 0);
    const clampTail = Number(payload.clamp_tail != null ? payload.clamp_tail : (payload.clamp != null ? payload.clamp : 80));
    const stockLen = Number(payload.stock_length || 6000);

    const partsList = Array.isArray(payload.parts) ? payload.parts : [];
    const nestedBars = Array.isArray(payload.nested_bars) ? payload.nested_bars : [];
    const uploadedFiles = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];

    // Bản đồ tra cứu file đã upload theo storagePath hoặc filename
    const uploadedMap = new Map<string, any>();
    uploadedFiles.forEach((f: any) => {
      if (f.storagePath) uploadedMap.set(f.storagePath, f);
      if (f.localFileName) uploadedMap.set(f.localFileName, f);
      if (f.name) uploadedMap.set(f.name, f);
    });

    const activeProfiles: string[] = [];
    const igsFilesMeta: any[] = [];
    const randSuffix = Math.random().toString(36).slice(2, 7);

    // 1. Lắp ráp danh sách chi tiết (newParts)
    const newParts: any[] = [];
    partsList.forEach((p: any, idx: number) => {
      const prof = p.profile || "Hộp 30x30x1.8";
      if (!activeProfiles.includes(prof)) activeProfiles.push(prof);

      const safePartName = toSafeFileName(p.filename || `${p.name || ("Chi_tiet_" + (idx + 1))}.igs`);
      const targetPath = `${projectId}/parts/${safePartName}`;
      const upl = uploadedMap.get(targetPath) || uploadedMap.get(safePartName) || uploadedMap.get(p.name);

      let pieceIgsUrl: string | null = null;
      if (upl && upl.storagePath) {
        pieceIgsUrl = `storage://${upl.storagePath}`;
        const { data: pubData } = adminClient.storage.from(STORAGE_BUCKET).getPublicUrl(upl.storagePath);
        igsFilesMeta.push({
          kind: "part",
          name: p.name || `Chi tiết ${idx + 1}`,
          original_file: safePartName,
          storage_path: upl.storagePath,
          public_url: pubData?.publicUrl || "",
          profile: prof,
          size_bytes: Number(upl.sizeBytes) || 0,
        });
      }

      newParts.push({
        id: `p_f360_${Date.now()}_${randSuffix}_${idx}`,
        name: p.name || `Chi tiết ${idx + 1}`,
        profile: prof,
        length: Number(p.length) || 0,
        qty: Number(p.qty) || 1,
        style: p.style || "thang",
        mat: p.mat || extractMatFromProfile(prof),
        igs_url: pieceIgsUrl,
        _autoDetected: true,
      });
    });

    const newStock = activeProfiles.map((prof, idx) => ({
      id: `s_f360_${Date.now()}_${randSuffix}_${idx}`,
      profile: prof,
      name: `Cây mới 6.000 (${prof})`,
      length: stockLen,
      qty: null,
      clamp: clampTail,
    }));

    // 2. Lắp ráp danh sách cây ghép (nested_bars)
    const lightNestedBars: any[] = [];
    nestedBars.forEach((bar: any) => {
      const prof = bar.profile || (activeProfiles[0] || "");
      if (prof && !activeProfiles.includes(prof)) activeProfiles.push(prof);

      const safeBarName = toSafeFileName(bar.filename || `${bar.name || ("Cay_" + (bar.letter || "A"))}.igs`);
      const targetPath = `${projectId}/bars/${safeBarName}`;
      const upl = uploadedMap.get(targetPath) || uploadedMap.get(safeBarName) || uploadedMap.get(bar.name);

      let barIgsUrl: string | null = null;
      if (upl && upl.storagePath) {
        barIgsUrl = `storage://${upl.storagePath}`;
        const { data: pubData } = adminClient.storage.from(STORAGE_BUCKET).getPublicUrl(upl.storagePath);
        igsFilesMeta.push({
          kind: "bar",
          name: bar.name || safeBarName,
          original_file: safeBarName,
          storage_path: upl.storagePath,
          public_url: pubData?.publicUrl || "",
          profile: prof,
          letter: bar.letter || "",
          size_bytes: Number(upl.sizeBytes) || 0,
        });
      }

      lightNestedBars.push({
        name: bar.name,
        profile: bar.profile,
        letter: bar.letter,
        count: Number(bar.count) || 1,
        cuts_count: Number(bar.cuts_count) || (Array.isArray(bar.pieces) ? bar.pieces.length : 0),
        pieces: bar.pieces || [],
        igs_url: barIgsUrl,
      });
    });

    // 3. Dọn các file .IGS mồ côi trên Storage khi cập nhật lại dự án
    let orphansRemovedCount = 0;
    if (isUpdatingExisting) {
      try {
        const keepPaths = new Set(igsFilesMeta.map(f => f.storage_path).filter(Boolean));
        const candidateOldPaths = new Set<string>();

        // Lấy danh sách cũ từ DB
        const { data: oldProjRow } = await adminClient
          .from("projects")
          .select("igs_files")
          .eq("id", projectId)
          .maybeSingle();
        if (oldProjRow && Array.isArray(oldProjRow.igs_files)) {
          oldProjRow.igs_files.forEach((f: any) => {
            if (f && f.storage_path) candidateOldPaths.add(f.storage_path);
          });
        }

        // Lấy danh sách thực tế trên Storage trong các thư mục con
        for (const sub of ["parts", "bars", ""]) {
          const folderPrefix = sub ? `${projectId}/${sub}` : projectId;
          const { data: listed } = await adminClient.storage.from(STORAGE_BUCKET).list(folderPrefix, { limit: 1000 });
          if (Array.isArray(listed)) {
            listed.forEach((item: any) => {
              if (item && item.name && item.id) {
                candidateOldPaths.add(`${folderPrefix}/${item.name}`.replace(/\/+/g, "/"));
              }
            });
          }
        }

        const orphanPaths = Array.from(candidateOldPaths).filter(p => p && !keepPaths.has(p));
        if (orphanPaths.length) {
          for (let offset = 0; offset < orphanPaths.length; offset += 100) {
            const chunk = orphanPaths.slice(offset, offset + 100);
            const { error: rmErr } = await adminClient.storage.from(STORAGE_BUCKET).remove(chunk);
            if (!rmErr) orphansRemovedCount += chunk.length;
          }
        }
      } catch (orphanErr: any) {
        console.warn("[EDGE FUNCTION] Cảnh báo dọn file mồ côi:", orphanErr?.message);
      }
    }

    const projectDataPayload = {
      activeProfiles,
      selectedTabProfile: activeProfiles[0] || "Hộp 30x30x1.8",
      parts: newParts,
      stock: newStock,
      method: "cnc",
      kerf,
      clamp: clampTail,
      interlock: true,
      gap: 0,
      fusionProject: {
        project_name: finalProjName,
        export_dir: payload.export_dir || "",
        stock_length: stockLen,
        clamp_tail: clampTail,
        kerf,
        nested_bars: lightNestedBars,
      },
    };

    const reasonText = versionReason === "dispatched" ? "đã xuất kho" : "đang khóa";
    const projNotes = wasVersioned
      ? `Tự động tạo phiên bản mới từ Fusion 360 vì bản gốc "${finalProjName}" ${reasonText} (${newParts.length} mục, ${activeProfiles.length} loại hộp) · Kỹ sư: @${profile.username}`
      : `Tự động đồng bộ từ Fusion 360 (${newParts.length} mục, ${activeProfiles.length} loại hộp) · Kỹ sư: @${profile.username}`;

    const nowStr = new Date().toISOString();

    // Lấy created_at cũ nếu có
    let createdAt = nowStr;
    try {
      const { data: pExist } = await adminClient
        .from("projects")
        .select("created_at")
        .eq("id", projectId)
        .maybeSingle();
      if (pExist && pExist.created_at) createdAt = pExist.created_at;
    } catch (_e) {}

    const projectRecord = {
      id: projectId,
      name: finalProjName,
      customer: "Fusion 360 CAD",
      notes: projNotes,
      is_locked: false,
      is_trashed: false,
      is_draft: false,
      source: "fusion360",
      data: projectDataPayload,
      igs_files: igsFilesMeta,
      deleted_at: null,
      created_at: createdAt,
      updated_at: nowStr,
    };

    // Upsert dự án vào bảng projects (Supabase Realtime sẽ tự phát tới toàn bộ trình duyệt)
    const { error: projErr } = await adminClient
      .from("projects")
      .upsert(projectRecord, { onConflict: "id" });

    if (projErr) {
      return jsonResponse({
        success: false,
        error: `Không lưu được dự án vào bảng projects: ${projErr.message}`,
      }, 500);
    }

    return jsonResponse({
      success: true,
      action: "complete",
      projectId,
      projectName: finalProjName,
      wasVersioned,
      versionReason,
      uploadedIgsCount: igsFilesMeta.length,
      orphansRemovedCount,
      webUrl: `https://xepphoi.cloud/?project=${encodeURIComponent(projectId)}`,
      cncUrl: `https://xepphoi.cloud/cnc?project=${encodeURIComponent(projectId)}`,
    });
  }

  // =========================================================================
  // LUỒNG 3: Single-shot Import (Tương thích ngược 100% với server.js cũ)
  // Xử lý cả metadata và nội dung nhị phân/base64 igs_content nếu được gửi kèm
  // =========================================================================
  const rawProjName = String(payload.project_name || "Bản vẽ cắt phôi CNC").trim();
  const partsList = Array.isArray(payload.parts) ? payload.parts : [];
  const clampTail = Number(payload.clamp_tail != null ? payload.clamp_tail : 80);
  const kerf = Number(payload.kerf != null ? payload.kerf : 0);
  const stockLen = Number(payload.stock_length || 6000);

  let existingProj: any = null;
  try {
    const { data: foundRows } = await adminClient
      .from("projects")
      .select("id, name, is_locked, inventory_deducted_at, data, created_at, igs_files")
      .eq("is_trashed", false)
      .eq("is_draft", false)
      .ilike("name", rawProjName)
      .limit(1);
    if (Array.isArray(foundRows) && foundRows.length) {
      existingProj = foundRows[0];
    }
  } catch (_e) {}

  let finalProjName = rawProjName;
  let wasVersioned = false;
  let versionReason = "";
  let isUpdatingExisting = Boolean(existingProj);
  const randSuffix = Math.random().toString(36).slice(2, 7);

  const existingDispatched = Boolean(
    existingProj && (
      existingProj.inventory_deducted_at ||
      (existingProj.data && (existingProj.data.inventoryDeductedAt || existingProj.data.inventory_deducted_at))
    )
  );

  if (existingProj && (existingProj.is_locked || existingDispatched)) {
    versionReason = existingProj.is_locked ? "locked" : "dispatched";
    let nextVer = 2;
    try {
      const escapedName = rawProjName.replace(/[%_]/g, "\\$&");
      const { data: verRows } = await adminClient
        .from("projects")
        .select("name")
        .eq("is_trashed", false)
        .eq("is_draft", false)
        .ilike("name", `${escapedName} (v%`);
      if (Array.isArray(verRows) && verRows.length) {
        let maxV = 1;
        for (const vr of verRows) {
          const m = String(vr.name || "").match(/\(v(\d+)/i);
          if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
        }
        nextVer = Math.max(2, maxV + 1);
      }
    } catch (_e) {}

    const d = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    finalProjName = `${rawProjName} (v${nextVer} - ${stamp})`;
    existingProj = null;
    isUpdatingExisting = false;
    wasVersioned = true;
  }

  const projectId = existingProj ? existingProj.id : `proj_f360_${Date.now()}_${randSuffix}`;
  const nowStr = new Date().toISOString();
  const activeProfiles: string[] = [];
  const igsFilesMeta: any[] = [];
  let igsUploadedCount = 0;

  // 1. Xử lý từng chi tiết
  const newParts: any[] = [];
  for (let idx = 0; idx < partsList.length; idx++) {
    const p = partsList[idx];
    const prof = p.profile || "Hộp 30x30x1.8";
    if (!activeProfiles.includes(prof)) activeProfiles.push(prof);

    let pieceIgsUrl = p.igs_url || null;
    if (p.igs_content && p.igs_content.length > 50) {
      const safePartFileName = toSafeFileName(p.filename || `${p.name || ("Chi_tiet_" + (idx + 1))}.igs`);
      const storagePath = `${projectId}/parts/${safePartFileName}`;
      const fileBytes = new TextEncoder().encode(p.igs_content);
      const { error: upErr } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, fileBytes, {
          contentType: "application/octet-stream",
          upsert: true,
        });

      if (!upErr) {
        pieceIgsUrl = `storage://${storagePath}`;
        igsUploadedCount++;
        const { data: pubData } = adminClient.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
        igsFilesMeta.push({
          kind: "part",
          name: p.name || `Chi tiết ${idx + 1}`,
          original_file: safePartFileName,
          storage_path: storagePath,
          public_url: pubData?.publicUrl || "",
          profile: prof,
          size_bytes: fileBytes.byteLength,
        });
      }
    }

    newParts.push({
      id: `p_f360_${Date.now()}_${randSuffix}_${idx}`,
      name: p.name || `Chi tiết ${idx + 1}`,
      profile: prof,
      length: Number(p.length) || 0,
      qty: Number(p.qty) || 1,
      style: p.style || "thang",
      mat: p.mat || extractMatFromProfile(prof),
      igs_url: pieceIgsUrl,
      _autoDetected: true,
    });
  }

  const newStock = activeProfiles.map((prof, idx) => ({
    id: `s_f360_${Date.now()}_${randSuffix}_${idx}`,
    profile: prof,
    name: `Cây mới 6.000 (${prof})`,
    length: stockLen,
    qty: null,
    clamp: clampTail,
  }));

  // 2. Xử lý các cây ghép (nested_bars)
  const lightNestedBars: any[] = [];
  if (Array.isArray(payload.nested_bars)) {
    for (const bar of payload.nested_bars) {
      const prof = bar.profile || (activeProfiles[0] || "");
      if (prof && !activeProfiles.includes(prof)) activeProfiles.push(prof);

      const rawName = toSafeFileName(bar.filename || `${bar.name || ("Cay_" + bar.letter)}.igs`);
      const storagePath = `${projectId}/bars/${rawName}`;

      let barIgsUrl = bar.igs_url || null;
      if (bar.igs_content && bar.igs_content.length > 50) {
        const fileBytes = new TextEncoder().encode(bar.igs_content);
        const { error: upErr } = await adminClient.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, fileBytes, {
            contentType: "application/octet-stream",
            upsert: true,
          });

        if (!upErr) {
          barIgsUrl = `storage://${storagePath}`;
          igsUploadedCount++;
          const { data: pubData } = adminClient.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
          igsFilesMeta.push({
            kind: "bar",
            name: bar.name || rawName,
            original_file: rawName,
            storage_path: storagePath,
            public_url: pubData?.publicUrl || "",
            profile: prof,
            letter: bar.letter || "",
            size_bytes: fileBytes.byteLength,
          });
        }
      }

      lightNestedBars.push({
        name: bar.name,
        profile: bar.profile,
        letter: bar.letter,
        count: Number(bar.count) || 1,
        cuts_count: Number(bar.cuts_count) || (Array.isArray(bar.pieces) ? bar.pieces.length : 0),
        pieces: bar.pieces || [],
        igs_url: barIgsUrl,
      });
    }
  }

  // 3. Upsert inventory
  if (activeProfiles.length) {
    const invRows = activeProfiles.map(prof => ({
      profile_name: prof,
      category: classifyProfile(prof),
      standard_length: stockLen,
      standard_length_mm: stockLen,
    }));
    await adminClient
      .from("inventory")
      .upsert(invRows, { onConflict: "profile_name", ignoreDuplicates: true });
  }

  // 4. Dọn file mồ côi nếu cập nhật lại dự án
  let orphansRemovedCount = 0;
  if (isUpdatingExisting) {
    try {
      const keepPaths = new Set(igsFilesMeta.map(f => f.storage_path).filter(Boolean));
      const candidateOldPaths = new Set<string>();
      if (existingProj && Array.isArray(existingProj.igs_files)) {
        existingProj.igs_files.forEach((f: any) => {
          if (f && f.storage_path) candidateOldPaths.add(f.storage_path);
        });
      }
      for (const sub of ["parts", "bars", ""]) {
        const folder = sub ? `${projectId}/${sub}` : projectId;
        const { data: listed } = await adminClient.storage.from(STORAGE_BUCKET).list(folder, { limit: 1000 });
        if (Array.isArray(listed)) {
          listed.forEach((item: any) => {
            if (item && item.name && item.id) {
              candidateOldPaths.add(`${folder}/${item.name}`.replace(/\/+/g, "/"));
            }
          });
        }
      }
      const orphanPaths = Array.from(candidateOldPaths).filter(p => p && !keepPaths.has(p));
      if (orphanPaths.length) {
        for (let offset = 0; offset < orphanPaths.length; offset += 100) {
          const chunk = orphanPaths.slice(offset, offset + 100);
          const { error: rmErr } = await adminClient.storage.from(STORAGE_BUCKET).remove(chunk);
          if (!rmErr) orphansRemovedCount += chunk.length;
        }
      }
    } catch (_e) {}
  }

  const projectDataPayload = {
    activeProfiles,
    selectedTabProfile: activeProfiles[0] || "Hộp 30x30x1.8",
    parts: newParts,
    stock: newStock,
    method: "cnc",
    kerf,
    clamp: clampTail,
    interlock: true,
    gap: 0,
    fusionProject: {
      project_name: finalProjName,
      export_dir: payload.export_dir || "",
      stock_length: stockLen,
      clamp_tail: clampTail,
      kerf,
      nested_bars: lightNestedBars,
    },
  };

  const reasonText = versionReason === "dispatched" ? "đã xuất kho" : "đang khóa";
  const projNotes = wasVersioned
    ? `Tự động tạo phiên bản mới từ Fusion 360 vì bản gốc "${finalProjName}" ${reasonText} (${newParts.length} mục, ${activeProfiles.length} loại hộp) · Kỹ sư: @${profile.username}`
    : `Tự động đồng bộ từ Fusion 360 (${newParts.length} mục, ${activeProfiles.length} loại hộp) · Kỹ sư: @${profile.username}`;

  const projectRecord = {
    id: projectId,
    name: finalProjName,
    customer: "Fusion 360 CAD",
    notes: projNotes,
    is_locked: false,
    is_trashed: false,
    is_draft: false,
    source: "fusion360",
    data: projectDataPayload,
    igs_files: igsFilesMeta,
    deleted_at: null,
    created_at: existingProj?.created_at || nowStr,
    updated_at: nowStr,
  };

  const { error: projErr } = await adminClient
    .from("projects")
    .upsert(projectRecord, { onConflict: "id" });

  if (projErr) {
    return jsonResponse({
      success: false,
      error: `Không đẩy được dự án lên Supabase: ${projErr.message}`,
    }, 500);
  }

  return jsonResponse({
    success: true,
    projectId,
    projectName: finalProjName,
    supabaseSynced: true,
    igsUploadedCount,
    wasVersioned,
    versionReason,
    orphansRemovedCount,
    webUrl: `https://xepphoi.cloud/?project=${encodeURIComponent(projectId)}`,
    cncUrl: `https://xepphoi.cloud/cnc?project=${encodeURIComponent(projectId)}`,
  });
});
