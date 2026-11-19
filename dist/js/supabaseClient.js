/**
 * ============================================================================
 * SUPABASE CLIENT & SHARED DATA LAYER - XẾP PHÔI AN BÌNH (xepphoi.cloud)
 * Nguồn dữ liệu duy nhất (Single Source of Truth): PostgreSQL + Realtime + Storage
 * ============================================================================
 * HƯỚNG DẪN CẤU HÌNH:
 * Thay thế 2 giá trị dưới đây bằng thông tin trong Supabase Dashboard:
 *   Project Settings -> API -> Project URL & anon public key
 */
const SUPABASE_URL = 'https://tfvwijzrgnbznwwvfwww.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5oX0pgAGMONVczCPR9yY-A__fmnqaEo';

(function (global) {
  'use strict';

  var STORAGE_BUCKET = 'igs-files';
  var DRAFT_PROJECT_ID = '__draft__';

  var DEFAULT_PROFILES = [
    'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
    'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0',
    'Ống Ø27x1.4', 'Ống Ø34x1.4'
  ];

  var DEFAULT_USERS = [
    {
      username: 'admin',
      password: '123456',
      fullName: 'Kỹ Sư Thiết Kế (Admin)',
      role: 'engineer',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      username: 'kt1',
      password: '12345',
      fullName: 'Sơn KT (Kỹ Sư)',
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

  var _url = SUPABASE_URL;
  var _key = SUPABASE_ANON_KEY;
  var _client = null;
  var _loadingCount = 0;
  var _retryHandler = null;
  var _stylesInjected = false;

  function setCredentials(url, anonKey) {
    _url = url || SUPABASE_URL;
    _key = anonKey || SUPABASE_ANON_KEY;
    _client = null;
  }

  function isConfigured() {
    return Boolean(
      _url &&
      _key &&
      typeof _url === 'string' &&
      typeof _key === 'string' &&
      _url.indexOf('YOUR_SUPABASE_URL') === -1 &&
      _key.indexOf('YOUR_SUPABASE_ANON_KEY') === -1 &&
      /^https?:\/\//i.test(_url.trim())
    );
  }

  function getClient() {
    if (!isConfigured()) {
      throw new Error('Chưa cấu hình SUPABASE_URL / SUPABASE_ANON_KEY trong js/supabaseClient.js');
    }
    if (!_client) {
      var sdk = global.supabase || (typeof supabase !== 'undefined' ? supabase : null);
      if (!sdk || typeof sdk.createClient !== 'function') {
        throw new Error('Chưa tải được thư viện @supabase/supabase-js từ CDN');
      }
      _client = sdk.createClient(_url.trim(), _key.trim(), {
        realtime: { params: { eventsPerSecond: 10 } }
      });
    }
    return _client;
  }

  // =========================================================================
  // UI LOADING & THÔNG BÁO LỖI KẾT NỐI MẠNG NHẸ NHÀNG
  // =========================================================================
  function ensureUiStyles() {
    if (_stylesInjected || typeof document === 'undefined' || !document.head) return;
    _stylesInjected = true;
    var style = document.createElement('style');
    style.id = 'sb-ui-styles';
    style.textContent = [
      '@keyframes sbBarSlide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}',
      '#sbTopProgressBar{position:fixed;top:0;left:0;width:100%;height:3px;z-index:99999;pointer-events:none;overflow:hidden;opacity:0;transition:opacity .2s}',
      '#sbTopProgressBar.active{opacity:1}',
      '#sbTopProgressBar::after{content:"";display:block;width:38%;height:100%;background:linear-gradient(90deg,transparent,#0F766E,#14B8A6,transparent);animation:sbBarSlide 1.1s infinite ease-in-out}',
      '#sbLoadingPill{position:fixed;bottom:18px;right:18px;z-index:99998;display:none;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(15,118,110,0.95);color:#fff;font:600 12.5px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.22);backdrop-filter:blur(6px)}',
      '#sbLoadingPill.show{display:inline-flex}',
      '#sbLoadingSpinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:sbSpin .7s linear infinite}',
      '@keyframes sbSpin{to{transform:rotate(360deg)}}',
      '#sbConnErrorBanner{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:99999;display:none;align-items:center;gap:10px;max-width:min(94vw,680px);padding:10px 14px;border-radius:12px;background:#FEF2F2;border:1.5px solid #FCA5A5;color:#991B1B;font:600 13px/1.4 "Plus Jakarta Sans",system-ui,sans-serif;box-shadow:0 12px 30px rgba(153,27,27,.18)}',
      '#sbConnErrorBanner.show{display:flex;flex-wrap:wrap}',
      '#sbConnErrorBanner button{cursor:pointer;border-radius:8px;font:700 12px/1 "Plus Jakarta Sans",system-ui,sans-serif;padding:6px 10px}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureUiDom() {
    if (typeof document === 'undefined' || !document.body) return null;
    ensureUiStyles();
    var bar = document.getElementById('sbTopProgressBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sbTopProgressBar';
      document.body.appendChild(bar);
    }
    var pill = document.getElementById('sbLoadingPill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'sbLoadingPill';
      pill.innerHTML = '<span id="sbLoadingSpinner"></span><span id="sbLoadingText">Đang tải dữ liệu...</span>';
      document.body.appendChild(pill);
    }
    var banner = document.getElementById('sbConnErrorBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sbConnErrorBanner';
      banner.innerHTML =
        '<span id="sbConnErrorMsg" style="flex:1;min-width:200px;"></span>' +
        '<button type="button" id="sbConnRetryBtn" style="background:#DC2626;color:#fff;border:none;">🔄 Thử kết nối lại</button>' +
        '<button type="button" id="sbConnCloseBtn" style="background:#fff;color:#991B1B;border:1px solid #FCA5A5;">✕</button>';
      document.body.appendChild(banner);
      document.getElementById('sbConnRetryBtn').onclick = function () {
        if (typeof _retryHandler === 'function') _retryHandler();
        else if (typeof window !== 'undefined' && window.location) window.location.reload();
      };
      document.getElementById('sbConnCloseBtn').onclick = function () {
        clearConnectionError();
      };
    }
    return { bar: bar, pill: pill, banner: banner };
  }

  function setLoading(isLoading, text) {
    if (isLoading) {
      _loadingCount++;
    } else {
      _loadingCount = Math.max(0, _loadingCount - 1);
    }
    var active = _loadingCount > 0;
    var dom = ensureUiDom();
    if (!dom) return;
    dom.bar.classList.toggle('active', active);
    dom.pill.classList.toggle('show', active);
    var txtEl = document.getElementById('sbLoadingText');
    if (txtEl && text) txtEl.textContent = text;
  }

  function showConnectionError(message, onRetry) {
    if (typeof onRetry === 'function') _retryHandler = onRetry;
    var dom = ensureUiDom();
    if (!dom) return;
    var msgEl = document.getElementById('sbConnErrorMsg');
    if (msgEl) msgEl.textContent = message || '❌ Mất kết nối tới máy chủ cơ sở dữ liệu Supabase. Vui lòng kiểm tra mạng!';
    dom.banner.classList.add('show');
  }

  function clearConnectionError() {
    var dom = ensureUiDom();
    if (!dom) return;
    dom.banner.classList.remove('show');
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('offline', function () {
      showConnectionError('📡 Mất kết nối Internet. Các thao tác lưu dữ liệu sẽ tạm gián đoạn cho đến khi có mạng trở lại!');
    });
    window.addEventListener('online', function () {
      clearConnectionError();
    });
  }

  // =========================================================================
  // HELPERS & DATA MAPPERS
  // =========================================================================
  function toAsciiSafe(str) {
    if (!str) return 'file';
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'file';
  }

  function classifyProfile(pName) {
    var s = String(pName || '');
    if (/ống|ong|phi|ø/i.test(s)) return 'round';
    var m = s.match(/(\d+)\s*[xX\*×]\s*(\d+)/);
    if (m) {
      return parseInt(m[1], 10) === parseInt(m[2], 10) ? 'square' : 'rect';
    }
    return 'other';
  }

  function stripHeavyIgs(obj) {
    if (obj === null || obj === undefined) return obj;
    try {
      return JSON.parse(JSON.stringify(obj, function (k, v) {
        return k === 'igs_content' ? undefined : v;
      }));
    } catch (e) {
      return obj;
    }
  }

  function mapProjectFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || '',
      customer: row.customer || '',
      notes: row.notes || '',
      isLocked: Boolean(row.is_locked),
      isTrashed: Boolean(row.is_trashed),
      isDraft: Boolean(row.is_draft),
      source: row.source || 'web',
      data: (row.data && typeof row.data === 'object') ? row.data : {},
      igsFiles: Array.isArray(row.igs_files) ? row.igs_files : [],
      deletedAt: row.deleted_at || null,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString()
    };
  }

  function mapProjectToDb(proj) {
    if (!proj) throw new Error('Dữ liệu dự án không hợp lệ');
    var cleanData = stripHeavyIgs(proj.data || {});
    var igsList = Array.isArray(proj.igsFiles)
      ? proj.igsFiles
      : (Array.isArray(proj.igs_files) ? proj.igs_files : []);
    return {
      id: String(proj.id),
      name: String(proj.name || 'Dự án không tên'),
      customer: String(proj.customer || ''),
      notes: String(proj.notes || ''),
      is_locked: Boolean(proj.isLocked != null ? proj.isLocked : proj.is_locked),
      is_trashed: Boolean(proj.isTrashed != null ? proj.isTrashed : proj.is_trashed),
      is_draft: Boolean(proj.isDraft != null ? proj.isDraft : (proj.is_draft || proj.id === DRAFT_PROJECT_ID)),
      source: proj.source || (String(proj.id || '').indexOf('proj_f360_') === 0 ? 'fusion360' : 'web'),
      data: cleanData,
      igs_files: igsList,
      deleted_at: proj.deletedAt || proj.deleted_at || null,
      created_at: proj.createdAt || proj.created_at || new Date().toISOString(),
      updated_at: proj.updatedAt || proj.updated_at || new Date().toISOString()
    };
  }

  function mapUserFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      password: row.password,
      fullName: row.full_name || row.fullName || row.username,
      role: row.role || 'operator',
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString()
    };
  }

  function mapInventoryFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      profileName: row.profile_name,
      category: row.category || 'other',
      standardLength: Number(row.standard_length) || 6000,
      stockQty: row.stock_qty != null ? Number(row.stock_qty) : null,
      notes: row.notes || '',
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  function mapCutRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      barKey: row.bar_key,
      profileName: row.profile_name || '',
      barLetter: row.bar_letter || '',
      cutCount: Number(row.cut_count) || 0,
      totalCount: Number(row.total_count) || 1,
      status: row.status || 'pending',
      updatedBy: row.updated_by || null,
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  function throwIfError(res, contextMsg) {
    if (res && res.error) {
      var err = new Error((contextMsg ? contextMsg + ': ' : '') + (res.error.message || JSON.stringify(res.error)));
      err.code = res.error.code;
      err.details = res.error.details;
      throw err;
    }
    return res ? res.data : null;
  }

  // =========================================================================
  // CRUD: PROJECTS
  // =========================================================================
  async function getProjects(opts) {
    var options = opts || {};
    var client = getClient();
    var query = client.from('projects').select('*').order('updated_at', { ascending: false });
    if (!options.includeTrash) query = query.eq('is_trashed', false);
    if (!options.includeDraft) query = query.eq('is_draft', false);
    var res = await query;
    var rows = throwIfError(res, 'Không tải được danh sách dự án') || [];
    return rows.map(mapProjectFromDb);
  }

  async function getProjectById(id) {
    if (!id) return null;
    var client = getClient();
    var res = await client.from('projects').select('*').eq('id', id).maybeSingle();
    var row = throwIfError(res, 'Không tải được chi tiết dự án');
    return row ? mapProjectFromDb(row) : null;
  }

  async function getDraftProject() {
    return getProjectById(DRAFT_PROJECT_ID);
  }

  async function saveProject(proj) {
    var client = getClient();
    var dbRow = mapProjectToDb(proj);
    dbRow.updated_at = new Date().toISOString();
    var res = await client
      .from('projects')
      .upsert(dbRow, { onConflict: 'id' })
      .select()
      .single();
    var saved = throwIfError(res, 'Không lưu được dự án');
    return mapProjectFromDb(saved);
  }

  async function updateProjectFields(id, fields) {
    if (!id || !fields) return null;
    var client = getClient();
    var patch = { updated_at: new Date().toISOString() };
    if (fields.name !== undefined) patch.name = String(fields.name);
    if (fields.customer !== undefined) patch.customer = String(fields.customer || '');
    if (fields.notes !== undefined) patch.notes = String(fields.notes || '');
    if (fields.isLocked !== undefined) patch.is_locked = Boolean(fields.isLocked);
    if (fields.is_locked !== undefined) patch.is_locked = Boolean(fields.is_locked);
    if (fields.isTrashed !== undefined) patch.is_trashed = Boolean(fields.isTrashed);
    if (fields.is_trashed !== undefined) patch.is_trashed = Boolean(fields.is_trashed);
    if (fields.isDraft !== undefined) patch.is_draft = Boolean(fields.isDraft);
    if (fields.deletedAt !== undefined) patch.deleted_at = fields.deletedAt;
    if (fields.deleted_at !== undefined) patch.deleted_at = fields.deleted_at;
    if (fields.data !== undefined) patch.data = stripHeavyIgs(fields.data);
    if (fields.igsFiles !== undefined) patch.igs_files = fields.igsFiles;
    if (fields.igs_files !== undefined) patch.igs_files = fields.igs_files;

    var res = await client
      .from('projects')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    var updated = throwIfError(res, 'Không cập nhật được dự án');
    return mapProjectFromDb(updated);
  }

  async function saveDraftProject(activeSnapshot) {
    return saveProject({
      id: DRAFT_PROJECT_ID,
      name: (activeSnapshot && activeSnapshot.currentProjectName) || 'Dự án nháp',
      customer: (activeSnapshot && activeSnapshot.currentProjectCustomer) || '',
      notes: (activeSnapshot && activeSnapshot.currentProjectNotes) || '',
      isLocked: false,
      isTrashed: false,
      isDraft: true,
      source: 'web',
      data: stripHeavyIgs(activeSnapshot || {})
    });
  }

  async function trashProject(id) {
    return updateProjectFields(id, {
      isTrashed: true,
      deletedAt: new Date().toISOString()
    });
  }

  async function restoreProject(id) {
    return updateProjectFields(id, {
      isTrashed: false,
      deletedAt: null
    });
  }

  async function permanentDeleteProject(id) {
    var client = getClient();
    var res = await client.from('projects').delete().eq('id', id);
    throwIfError(res, 'Không xóa vĩnh viễn được dự án');
    return true;
  }

  async function emptyTrash() {
    var client = getClient();
    var res = await client.from('projects').delete().eq('is_trashed', true);
    throwIfError(res, 'Không dọn sạch được thùng rác');
    return true;
  }

  // =========================================================================
  // CRUD: INVENTORY (QUY CÁCH THÉP HỘP / ỐNG)
  // =========================================================================
  async function getInventory() {
    var client = getClient();
    var res = await client.from('inventory').select('*').order('created_at', { ascending: true });
    var rows = throwIfError(res, 'Không tải được thư viện quy cách') || [];
    return rows.map(mapInventoryFromDb);
  }

  async function addProfile(profileName, meta) {
    var clean = String(profileName || '').trim();
    if (!clean) throw new Error('Tên quy cách không được để trống');
    var info = meta || {};
    var client = getClient();
    var payload = {
      profile_name: clean,
      category: info.category || classifyProfile(clean),
      standard_length: info.standardLength != null ? Number(info.standardLength) : 6000,
      stock_qty: info.stockQty !== undefined ? info.stockQty : null,
      notes: info.notes || '',
      is_default: Boolean(info.isDefault)
    };
    var res = await client
      .from('inventory')
      .upsert(payload, { onConflict: 'profile_name' })
      .select()
      .single();
    var row = throwIfError(res, 'Không lưu được quy cách hộp');
    return mapInventoryFromDb(row);
  }

  async function addProfilesBulk(names) {
    var list = Array.isArray(names) ? names : [];
    var rows = list
      .map(function (n) { return String(n || '').trim(); })
      .filter(Boolean)
      .map(function (clean) {
        return {
          profile_name: clean,
          category: classifyProfile(clean),
          standard_length: 6000,
          is_default: DEFAULT_PROFILES.indexOf(clean) !== -1
        };
      });
    if (!rows.length) return [];
    var client = getClient();
    var res = await client
      .from('inventory')
      .upsert(rows, { onConflict: 'profile_name', ignoreDuplicates: true })
      .select();
    var saved = throwIfError(res, 'Không thêm được danh sách quy cách') || [];
    return saved.map(mapInventoryFromDb);
  }

  async function deleteProfile(profileName) {
    var client = getClient();
    var res = await client.from('inventory').delete().eq('profile_name', String(profileName || '').trim());
    throwIfError(res, 'Không xóa được quy cách hộp');
    return true;
  }

  // =========================================================================
  // CRUD: CUT PROGRESS (CẬP NHẬT THEO DÒNG - ROW LEVEL)
  // =========================================================================
  async function getCutProgress(projectId) {
    if (!projectId) return {};
    var client = getClient();
    var res = await client.from('cut_progress').select('*').eq('project_id', projectId);
    var rows = throwIfError(res, 'Không tải được tiến độ cắt CNC') || [];
    var map = {};
    rows.forEach(function (r) {
      var mapped = mapCutRow(r);
      map[mapped.barKey] = {
        cutCount: mapped.cutCount,
        totalCount: mapped.totalCount,
        status: mapped.status,
        updatedBy: mapped.updatedBy,
        updatedAt: mapped.updatedAt
      };
    });
    return map;
  }

  async function getAllCutProgress() {
    var client = getClient();
    var res = await client.from('cut_progress').select('*');
    var rows = throwIfError(res, 'Không tải được toàn bộ tiến độ cắt') || [];
    return rows.map(mapCutRow);
  }

  async function updateCutStatus(projectId, barKey, payload) {
    if (!projectId || !barKey) throw new Error('Thiếu projectId hoặc barKey để cập nhật tiến độ');
    var client = getClient();
    var parts = String(barKey).split('__');
    var profileName = parts.length > 1 ? parts.slice(0, -1).join('__') : '';
    var barLetter = parts.length > 1 ? parts[parts.length - 1] : barKey;
    var cutCount = Math.max(0, Number(payload && payload.cutCount != null ? payload.cutCount : 0));
    var totalCount = Math.max(1, Number(payload && payload.totalCount != null ? payload.totalCount : 1));
    var status = (payload && payload.status) || (cutCount >= totalCount ? 'done' : (cutCount > 0 ? 'cutting' : 'pending'));

    var row = {
      project_id: projectId,
      bar_key: String(barKey),
      profile_name: (payload && payload.profileName) || profileName,
      bar_letter: (payload && payload.barLetter) || barLetter,
      cut_count: cutCount,
      total_count: totalCount,
      status: status,
      updated_by: (payload && payload.updatedBy) || null,
      updated_at: new Date().toISOString()
    };

    var res = await client
      .from('cut_progress')
      .upsert(row, { onConflict: 'project_id,bar_key' })
      .select()
      .single();

    // Nếu bản nháp (__draft__) chưa có dòng cha trên DB, tự tạo dòng nháp rồi thử lại
    if (res.error && res.error.code === '23503' && projectId === DRAFT_PROJECT_ID) {
      await saveDraftProject({});
      res = await client
        .from('cut_progress')
        .upsert(row, { onConflict: 'project_id,bar_key' })
        .select()
        .single();
    }

    var saved = throwIfError(res, 'Không cập nhật được tiến độ cắt');
    return mapCutRow(saved);
  }

  async function resetCutProgress(projectId) {
    if (!projectId) return true;
    var client = getClient();
    var res = await client.from('cut_progress').delete().eq('project_id', projectId);
    throwIfError(res, 'Không đặt lại được tiến độ cắt');
    return true;
  }

  // =========================================================================
  // CRUD: WORKSHOP USERS (TÀI KHOẢN & PHÂN QUYỀN)
  // =========================================================================
  async function getUsers() {
    var client = getClient();
    var res = await client.from('workshop_users').select('*').order('created_at', { ascending: true });
    var rows = throwIfError(res, 'Không tải được danh sách nhân sự') || [];
    return rows.map(mapUserFromDb);
  }

  async function upsertUser(user) {
    if (!user || !user.username) throw new Error('Thiếu tên đăng nhập');
    var client = getClient();
    var payload = {
      username: String(user.username).trim().toLowerCase(),
      password: String(user.password || ''),
      full_name: String(user.fullName || user.full_name || user.username),
      role: user.role === 'engineer' ? 'engineer' : 'operator',
      created_at: user.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    var res = await client
      .from('workshop_users')
      .upsert(payload, { onConflict: 'username' })
      .select()
      .single();
    var saved = throwIfError(res, 'Không lưu được tài khoản nhân sự');
    return mapUserFromDb(saved);
  }

  async function updateUser(username, patch) {
    if (!username || !patch) return null;
    var client = getClient();
    var updateObj = { updated_at: new Date().toISOString() };
    if (patch.password !== undefined) updateObj.password = String(patch.password);
    if (patch.fullName !== undefined) updateObj.full_name = String(patch.fullName);
    if (patch.full_name !== undefined) updateObj.full_name = String(patch.full_name);
    if (patch.role !== undefined) updateObj.role = patch.role === 'engineer' ? 'engineer' : 'operator';

    var res = await client
      .from('workshop_users')
      .update(updateObj)
      .eq('username', String(username).trim().toLowerCase())
      .select()
      .single();
    var saved = throwIfError(res, 'Không cập nhật được tài khoản');
    return mapUserFromDb(saved);
  }

  async function deleteUser(username) {
    var clean = String(username || '').trim().toLowerCase();
    if (clean === 'admin') throw new Error('Không thể xóa tài khoản Quản trị viên tối cao (admin)');
    var client = getClient();
    var res = await client.from('workshop_users').delete().eq('username', clean);
    throwIfError(res, 'Không xóa được tài khoản');
    return true;
  }

  async function resetDefaultUsers() {
    var client = getClient();
    await client.from('workshop_users').delete().neq('username', 'admin');
    var rows = DEFAULT_USERS.map(function (u) {
      return {
        username: u.username,
        password: u.password,
        full_name: u.fullName,
        role: u.role,
        created_at: u.createdAt
      };
    });
    var res = await client
      .from('workshop_users')
      .upsert(rows, { onConflict: 'username' })
      .select();
    var saved = throwIfError(res, 'Không khôi phục được danh sách tài khoản mặc định') || [];
    return saved.map(mapUserFromDb);
  }

  // =========================================================================
  // STORAGE BUCKET: igs-files
  // =========================================================================
  function getIgsPublicUrl(storagePath) {
    var client = getClient();
    var res = client.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    return res && res.data ? res.data.publicUrl : null;
  }

  async function uploadIgsFile(storagePath, content) {
    var client = getClient();
    var res = await client.storage.from(STORAGE_BUCKET).upload(storagePath, content, {
      contentType: 'application/octet-stream',
      upsert: true
    });
    if (res && res.error) {
      throw new Error('Không tải file .IGS lên Storage: ' + res.error.message);
    }
    return {
      path: storagePath,
      publicUrl: getIgsPublicUrl(storagePath)
    };
  }

  // =========================================================================
  // REALTIME (POSTGRES CHANGES)
  // =========================================================================
  function subscribeTables(handlers, onStatusChange) {
    var client = getClient();
    var hMap = handlers || {};
    var channelName = 'workshop_rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    var channel = client.channel(channelName);

    var wrapPayload = function (table, payload) {
      var eventType = payload.eventType || payload.type;
      if (table === 'projects') {
        return {
          eventType: eventType,
          newRecord: mapProjectFromDb(payload.new),
          oldRecord: mapProjectFromDb(payload.old),
          raw: payload
        };
      }
      if (table === 'inventory') {
        return {
          eventType: eventType,
          newRecord: mapInventoryFromDb(payload.new),
          oldRecord: mapInventoryFromDb(payload.old),
          raw: payload
        };
      }
      if (table === 'cut_progress') {
        return {
          eventType: eventType,
          newRecord: mapCutRow(payload.new),
          oldRecord: mapCutRow(payload.old),
          raw: payload
        };
      }
      if (table === 'workshop_users') {
        return {
          eventType: eventType,
          newRecord: mapUserFromDb(payload.new),
          oldRecord: mapUserFromDb(payload.old),
          raw: payload
        };
      }
      return payload;
    };

    Object.keys(hMap).forEach(function (table) {
      var fn = hMap[table];
      if (typeof fn !== 'function') return;
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: table },
        function (payload) {
          try {
            fn(wrapPayload(table, payload));
          } catch (e) {
            console.error('[Supabase Realtime]', table, e);
          }
        }
      );
    });

    channel.subscribe(function (status) {
      if (typeof onStatusChange === 'function') {
        onStatusChange(status);
      }
    });

    return function unsubscribe() {
      try {
        client.removeChannel(channel);
      } catch (e) {}
    };
  }

  global.SupabaseDB = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    STORAGE_BUCKET: STORAGE_BUCKET,
    DRAFT_PROJECT_ID: DRAFT_PROJECT_ID,
    DEFAULT_PROFILES: DEFAULT_PROFILES,
    DEFAULT_USERS: DEFAULT_USERS,
    setCredentials: setCredentials,
    isConfigured: isConfigured,
    getClient: getClient,
    setLoading: setLoading,
    showConnectionError: showConnectionError,
    clearConnectionError: clearConnectionError,
    toAsciiSafe: toAsciiSafe,
    classifyProfile: classifyProfile,
    stripHeavyIgs: stripHeavyIgs,
    mapProjectFromDb: mapProjectFromDb,
    mapProjectToDb: mapProjectToDb,
    mapUserFromDb: mapUserFromDb,
    mapInventoryFromDb: mapInventoryFromDb,
    mapCutRow: mapCutRow,
    getProjects: getProjects,
    getProjectById: getProjectById,
    getDraftProject: getDraftProject,
    saveProject: saveProject,
    updateProjectFields: updateProjectFields,
    saveDraftProject: saveDraftProject,
    trashProject: trashProject,
    restoreProject: restoreProject,
    permanentDeleteProject: permanentDeleteProject,
    emptyTrash: emptyTrash,
    getInventory: getInventory,
    addProfile: addProfile,
    addProfilesBulk: addProfilesBulk,
    deleteProfile: deleteProfile,
    getCutProgress: getCutProgress,
    getAllCutProgress: getAllCutProgress,
    updateCutStatus: updateCutStatus,
    resetCutProgress: resetCutProgress,
    getUsers: getUsers,
    upsertUser: upsertUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    resetDefaultUsers: resetDefaultUsers,
    getIgsPublicUrl: getIgsPublicUrl,
    uploadIgsFile: uploadIgsFile,
    subscribeTables: subscribeTables
  };
})(typeof window !== 'undefined' ? window : globalThis);
