/**
 * ============================================================================
 * SCRIPT DI CHUYỂN DỮ LIỆU GỐC TỪ workshop_db.json LÊN SUPABASE (CHẠY 1 LẦN)
 * Sử dụng:
 *   node scripts/migrate_to_supabase.js
 *   node scripts/migrate_to_supabase.js --dry-run   (Kiểm thử đọc & chuẩn hóa dữ liệu không gửi mạng)
 * ============================================================================
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DB_JSON_PATH = path.join(ROOT_DIR, 'database', 'workshop_db.json');
const IGS_DIR = path.join(ROOT_DIR, 'database', 'igs_files');
const CLIENT_JS_PATH = path.join(ROOT_DIR, 'js', 'supabaseClient.js');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const STORAGE_BUCKET = 'igs-files';
const DRAFT_PROJECT_ID = '__draft__';

const isDryRun = process.argv.includes('--dry-run');

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
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
  return out;
}

function readClientJsDefaults() {
  if (!fs.existsSync(CLIENT_JS_PATH)) return {};
  const src = fs.readFileSync(CLIENT_JS_PATH, 'utf8');
  const urlMatch = src.match(/const\s+SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
  const keyMatch = src.match(/const\s+SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
  return {
    url: urlMatch ? urlMatch[1].trim() : '',
    anonKey: keyMatch ? keyMatch[1].trim() : ''
  };
}

function resolveSupabaseCredentials() {
  const envFile = loadEnvFile(ENV_PATH);
  const clientDefaults = readClientJsDefaults();

  const url =
    process.env.SUPABASE_URL ||
    envFile.SUPABASE_URL ||
    clientDefaults.url ||
    '';

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    envFile.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    envFile.SUPABASE_ANON_KEY ||
    clientDefaults.anonKey ||
    '';

  return { url: url.trim(), key: key.trim() };
}

function isPlaceholderConfig(url, key) {
  return (
    !url ||
    !key ||
    url.includes('YOUR_SUPABASE_URL') ||
    key.includes('YOUR_SUPABASE_KEY') ||
    key.includes('YOUR_SUPABASE_ANON_KEY') ||
    !/^https?:\/\//i.test(url)
  );
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

function normalizeForMatch(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function classifyProfile(pName) {
  const s = String(pName || '');
  if (/ống|ong|phi|ø/i.test(s)) return 'round';
  const m = s.match(/(\d+)\s*[xX\*×]\s*(\d+)/);
  if (m) {
    return parseInt(m[1], 10) === parseInt(m[2], 10) ? 'square' : 'rect';
  }
  return 'other';
}

function stripHeavyIgs(obj) {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(
    JSON.stringify(obj, (k, v) => (k === 'igs_content' ? undefined : v))
  );
}

function findLocalIgsFile(bar, diskFiles) {
  if (!diskFiles.length) return null;
  const candidates = [];
  if (bar && bar.name) {
    const bName = bar.name.endsWith('.igs') ? bar.name : `${bar.name}.igs`;
    candidates.push(bName);
  }
  if (bar && bar.igs_url) {
    try {
      const lastSeg = decodeURIComponent(String(bar.igs_url).split('/').pop().split('?')[0]);
      if (lastSeg) candidates.push(lastSeg);
    } catch (e) {}
  }

  for (const cand of candidates) {
    const exact = diskFiles.find(f => f === cand);
    if (exact) return exact;
    const normCand = normalizeForMatch(cand);
    const fuzzy = diskFiles.find(f => normalizeForMatch(f) === normCand);
    if (fuzzy) return fuzzy;
  }
  return null;
}

async function main() {
  console.log('====================================================================');
  console.log(`🚀 BẮT ĐẦU DI CHUYỂN DỮ LIỆU XƯỞNG AN BÌNH -> SUPABASE ${isDryRun ? '(CHẾ ĐỘ DRY-RUN)' : ''}`);
  console.log('====================================================================');

  if (!fs.existsSync(DB_JSON_PATH)) {
    console.error(`❌ Không tìm thấy file dữ liệu gốc tại: ${DB_JSON_PATH}`);
    process.exit(1);
  }

  const rawDb = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf8'));
  const { url, key } = resolveSupabaseCredentials();

  let supabase = null;
  if (!isDryRun) {
    if (isPlaceholderConfig(url, key)) {
      console.error('❌ LỖI: Chưa cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY!');
      console.error('👉 Vui lòng thực hiện một trong hai cách sau rồi chạy lại:');
      console.error('   1. Tạo file .env (từ .env.example) và điền SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (hoặc SUPABASE_ANON_KEY).');
      console.error('   2. Hoặc điền trực tiếp SUPABASE_URL và SUPABASE_ANON_KEY vào file js/supabaseClient.js.');
      process.exit(1);
    }
    supabase = createClient(url, key, { auth: { persistSession: false } });
  }

  // -------------------------------------------------------------------------
  // 1. NHÂN SỰ (workshop_users)
  // -------------------------------------------------------------------------
  const usersList = Array.isArray(rawDb.users) ? rawDb.users : [];
  const userRows = usersList
    .filter(u => u && u.username)
    .map(u => ({
      username: String(u.username).trim().toLowerCase(),
      password: String(u.password || '1234'),
      full_name: String(u.fullName || u.full_name || u.username),
      role: u.role === 'engineer' ? 'engineer' : 'operator',
      created_at: u.createdAt || '2026-01-01T00:00:00.000Z'
    }));

  if (!isDryRun && userRows.length) {
    const { error } = await supabase
      .from('workshop_users')
      .upsert(userRows, { onConflict: 'username' });
    if (error) throw new Error(`Lỗi upsert workshop_users: ${error.message}`);
  }
  console.log(`✓ [1/5] workshop_users : ${userRows.length} tài khoản (${userRows.map(u => u.username).join(', ')})`);

  // -------------------------------------------------------------------------
  // 2. THƯ VIỆN QUY CÁCH (inventory)
  // -------------------------------------------------------------------------
  const profSet = new Set(Array.isArray(rawDb.savedProfiles) ? rawDb.savedProfiles : []);
  (rawDb.savedProjects || []).forEach(p => {
    if (p && p.data && Array.isArray(p.data.activeProfiles)) {
      p.data.activeProfiles.forEach(pr => profSet.add(pr));
    }
  });
  const defaultSet = new Set([
    'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
    'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0',
    'Ống Ø27x1.4', 'Ống Ø34x1.4'
  ]);
  const inventoryRows = Array.from(profSet)
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .map(name => ({
      profile_name: name,
      category: classifyProfile(name),
      standard_length: 6000,
      is_default: defaultSet.has(name)
    }));

  if (!isDryRun && inventoryRows.length) {
    const { error } = await supabase
      .from('inventory')
      .upsert(inventoryRows, { onConflict: 'profile_name' });
    if (error) throw new Error(`Lỗi upsert inventory: ${error.message}`);
  }
  console.log(`✓ [2/5] inventory      : ${inventoryRows.length} quy cách hộp/ống`);

  // -------------------------------------------------------------------------
  // 3. FILE 3D .IGS TRONG database/igs_files/ -> SUPABASE STORAGE (igs-files)
  // -------------------------------------------------------------------------
  const diskIgsFiles = fs.existsSync(IGS_DIR)
    ? fs.readdirSync(IGS_DIR).filter(f => /\.(igs|iges)$/i.test(f))
    : [];

  let uploadedIgsCount = 0;
  const igsUploadPlans = [];

  async function processProjectIgsBars(projObj) {
    const projId = String(projObj.id);
    const igsMetaList = [];
    const data = projObj.data && typeof projObj.data === 'object' ? projObj.data : {};
    const bars = (data.fusionProject && Array.isArray(data.fusionProject.nested_bars))
      ? data.fusionProject.nested_bars
      : [];

    for (const bar of bars) {
      const localFile = findLocalIgsFile(bar, diskIgsFiles);
      const rawFileName = localFile || `${bar.name || ('Cay_' + (bar.letter || 'A'))}.igs`;
      const asciiFileName = toAsciiSafe(rawFileName.endsWith('.igs') ? rawFileName : `${rawFileName}.igs`);
      const storagePath = `${toAsciiSafe(projId)}/${asciiFileName}`;

      if (localFile) {
        const localFullPath = path.join(IGS_DIR, localFile);
        const fileBuf = fs.readFileSync(localFullPath);
        let publicUrl = `supabase://${STORAGE_BUCKET}/${storagePath}`;

        if (!isDryRun) {
          const { error: upErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, fileBuf, {
              contentType: 'application/octet-stream',
              upsert: true
            });
          if (upErr) {
            console.warn(`⚠️ Không upload được ${localFile} lên Storage: ${upErr.message}`);
          } else {
            const { data: pubData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
            publicUrl = pubData ? pubData.publicUrl : publicUrl;
            uploadedIgsCount++;
          }
        } else {
          igsUploadPlans.push({ localFile, storagePath, bytes: fileBuf.length });
          uploadedIgsCount++;
        }

        bar.igs_url = publicUrl;
        igsMetaList.push({
          name: bar.name || rawFileName,
          original_file: localFile,
          storage_path: storagePath,
          public_url: publicUrl,
          profile: bar.profile || '',
          letter: bar.letter || '',
          size_bytes: fileBuf.length
        });
      }
    }

    return igsMetaList;
  }

  // -------------------------------------------------------------------------
  // 4. DỰ ÁN & BẢN NHÁP (projects)
  // -------------------------------------------------------------------------
  const deletedSet = new Set(Array.isArray(rawDb.deletedProjectIds) ? rawDb.deletedProjectIds : []);
  const savedProjects = Array.isArray(rawDb.savedProjects) ? rawDb.savedProjects : [];
  const projectRows = [];
  const validProjectIds = new Set();

  for (const p of savedProjects) {
    if (!p || !p.id || deletedSet.has(p.id)) continue;
    const cloned = stripHeavyIgs(p);
    const igsMeta = await processProjectIgsBars(cloned);
    const isFusion = String(cloned.id).startsWith('proj_f360_') || (cloned.data && cloned.data.fusionProject);

    projectRows.push({
      id: String(cloned.id),
      name: String(cloned.name || 'Dự án không tên'),
      customer: String(cloned.customer || ''),
      notes: String(cloned.notes || ''),
      is_locked: Boolean(cloned.isLocked),
      is_trashed: false,
      is_draft: false,
      source: isFusion ? 'fusion360' : 'web',
      data: cloned.data || {},
      igs_files: igsMeta,
      deleted_at: null,
      created_at: cloned.createdAt || new Date().toISOString(),
      updated_at: cloned.updatedAt || cloned.createdAt || new Date().toISOString()
    });
    validProjectIds.add(String(cloned.id));
  }

  // Đẩy bản nháp hiện hành (activeProject) nếu chưa thuộc danh mục dự án đã lưu
  const ap = rawDb.activeProject;
  const apHasParts = ap && Array.isArray(ap.parts) && ap.parts.length > 0;
  let draftTargetId = (ap && ap.currentProjectId && validProjectIds.has(ap.currentProjectId))
    ? ap.currentProjectId
    : null;

  if (apHasParts && !draftTargetId) {
    const cleanDraft = stripHeavyIgs(ap);
    projectRows.push({
      id: DRAFT_PROJECT_ID,
      name: cleanDraft.currentProjectName || 'Dự án nháp (Đang xếp phôi)',
      customer: cleanDraft.currentProjectCustomer || '',
      notes: cleanDraft.currentProjectNotes || '',
      is_locked: false,
      is_trashed: false,
      is_draft: true,
      source: 'web',
      data: cleanDraft,
      igs_files: [],
      deleted_at: null,
      created_at: rawDb.updatedAt || new Date().toISOString(),
      updated_at: rawDb.updatedAt || new Date().toISOString()
    });
    validProjectIds.add(DRAFT_PROJECT_ID);
    draftTargetId = DRAFT_PROJECT_ID;
  }

  if (!isDryRun && projectRows.length) {
    const { error } = await supabase
      .from('projects')
      .upsert(projectRows, { onConflict: 'id' });
    if (error) throw new Error(`Lỗi upsert projects: ${error.message}`);
  }
  console.log(`✓ [3/5] projects       : ${projectRows.length} bản ghi (${projectRows.filter(x => x.is_draft).length ? 'bao gồm __draft__' : 'không có draft'})`);
  console.log(`✓ [4/5] storage (igs)  : ${uploadedIgsCount} file .igs ${isDryRun ? '(sẽ tải lên bucket igs-files)' : 'đã tải lên bucket igs-files'}`);
  if (isDryRun && igsUploadPlans.length) {
    igsUploadPlans.forEach(item => {
      console.log(`   ↳ ${item.localFile} -> ${item.storagePath} (${item.bytes} bytes)`);
    });
  }

  // -------------------------------------------------------------------------
  // 5. TIẾN ĐỘ CẮT CNC (cut_progress)
  // -------------------------------------------------------------------------
  const cutStatuses = rawDb.cutStatuses && typeof rawDb.cutStatuses === 'object' ? rawDb.cutStatuses : {};
  const cutKeys = Object.keys(cutStatuses);
  let cutRows = [];

  if (cutKeys.length) {
    // Đảm bảo luôn có bản ghi cha trên projects để thỏa mãn khóa ngoại project_id
    if (!draftTargetId) {
      const fallbackId = projectRows.length ? projectRows[0].id : DRAFT_PROJECT_ID;
      if (!validProjectIds.has(fallbackId)) {
        const emptyDraft = {
          id: DRAFT_PROJECT_ID,
          name: 'Dự án nháp',
          customer: '',
          notes: '',
          is_locked: false,
          is_trashed: false,
          is_draft: true,
          source: 'web',
          data: {},
          igs_files: []
        };
        if (!isDryRun) {
          await supabase.from('projects').upsert(emptyDraft, { onConflict: 'id' });
        }
        validProjectIds.add(DRAFT_PROJECT_ID);
      }
      draftTargetId = fallbackId;
    }

    cutRows = cutKeys.map(barKey => {
      const val = cutStatuses[barKey];
      const parts = String(barKey).split('__');
      const profileName = parts.length > 1 ? parts.slice(0, -1).join('__') : '';
      const barLetter = parts.length > 1 ? parts[parts.length - 1] : barKey;
      const cutCount = typeof val === 'object' && val !== null ? (Number(val.cutCount) || 0) : (Number(val) || 0);
      const totalCount = typeof val === 'object' && val !== null ? Math.max(1, Number(val.totalCount) || 1) : 1;
      const status = (typeof val === 'object' && val && val.status)
        ? val.status
        : (cutCount >= totalCount ? 'done' : (cutCount > 0 ? 'cutting' : 'pending'));

      return {
        project_id: draftTargetId,
        bar_key: barKey,
        profile_name: profileName,
        bar_letter: barLetter,
        cut_count: cutCount,
        total_count: totalCount,
        status: ['pending', 'cutting', 'done'].includes(status) ? status : 'pending',
        updated_at: (typeof val === 'object' && val && val.updatedAt) ? val.updatedAt : new Date().toISOString()
      };
    });

    if (!isDryRun && cutRows.length) {
      const { error } = await supabase
        .from('cut_progress')
        .upsert(cutRows, { onConflict: 'project_id,bar_key' });
      if (error) throw new Error(`Lỗi upsert cut_progress: ${error.message}`);
    }
  }
  console.log(`✓ [5/5] cut_progress   : ${cutRows.length} dòng tiến độ cắt (gắn project_id="${draftTargetId || 'N/A'}")`);
  console.log('====================================================================');
  console.log(isDryRun
    ? '✅ DRY-RUN HOÀN TẤT! Cấu trúc workshop_db.json hợp lệ và sẵn sàng migrate.'
    : '🎉 DI CHUYỂN TOÀN BỘ DỮ LIỆU LÊN SUPABASE THÀNH CÔNG!');
}

main().catch(err => {
  console.error('❌ LỖI DI CHUYỂN DỮ LIỆU:', err.message);
  process.exit(1);
});
