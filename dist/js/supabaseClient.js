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
  var INTERNAL_EMAIL_DOMAIN = 'anbinh.local';
  var AUTH_STORAGE_KEY = 'toiuu_supabase_auth_v2';
  var LEGACY_SESSION_KEY = 'toiuu_logged_user_v1';

  var DEFAULT_PROFILES = [
    'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
    'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0',
    'Ống Ø27x1.4', 'Ống Ø34x1.4'
  ];

  var _url = SUPABASE_URL;
  var _key = SUPABASE_ANON_KEY;
  var _client = null;
  var _accessToken = null;
  var _loadingCount = 0;
  var _retryHandler = null;
  var _stylesInjected = false;
  var _supportsPatternHash = true;

  function usernameToEmail(input) {
    var clean = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!clean) return '';
    if (clean.indexOf('@') !== -1) return clean;
    return clean + '@' + INTERNAL_EMAIL_DOMAIN;
  }

  function emailToUsername(email) {
    var clean = String(email || '').trim().toLowerCase();
    var at = clean.indexOf('@');
    return at !== -1 ? clean.slice(0, at) : clean;
  }

  function clearLegacySessionStorage() {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (e) {}
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (e) {}
  }

  function uid(prefix) {
    return String(prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function computePatternHash(pattern) {
    if (!pattern) return '';
    var cuts = Array.isArray(pattern.cuts) ? pattern.cuts : [];
    var stockLen = Math.round(Number(pattern.stockLength || 0) * 10);
    var tokens = cuts.map(function (c) {
      var len = Math.round(Number((c && c.length) || 0) * 10);
      var style = String((c && (c.endStyle || c.end_style)) || 'thang');
      return len + ':' + style;
    }).sort();
    var raw = stockLen + '|' + tokens.join(',');
    var h = 0x811c9dc5;
    for (var i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return 'ph_' + ((h >>> 0).toString(16).padStart(8, '0')) + '_' + cuts.length;
  }

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
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY
        },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      try {
        _client.auth.onAuthStateChange(function (_event, session) {
          _accessToken = session && session.access_token ? session.access_token : null;
        });
        _client.auth.getSession().then(function (res) {
          var s = res && res.data ? res.data.session : null;
          if (s && s.access_token) _accessToken = s.access_token;
        }).catch(function () {});
      } catch (e) {}
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

  function mapProjectSummaryFromDb(row) {
    if (!row) return null;
    if (row.data && typeof row.data === 'object') {
      return mapProjectFromDb(row);
    }
    var activeProfiles = Array.isArray(row.active_profiles) ? row.active_profiles : [];
    var partsArr = Array.isArray(row.parts_summary) ? row.parts_summary : [];
    var totalPieces = partsArr.reduce(function (acc, p) {
      return acc + (Number(p && p.qty) || 0);
    }, 0);
    return {
      id: row.id,
      name: row.name || '',
      customer: row.customer || '',
      notes: row.notes || '',
      isLocked: Boolean(row.is_locked),
      isTrashed: Boolean(row.is_trashed),
      isDraft: Boolean(row.is_draft),
      source: row.source || 'web',
      isSummary: true,
      activeProfiles: activeProfiles,
      partsCount: partsArr.length,
      piecesCount: totalPieces,
      data: {
        activeProfiles: activeProfiles,
        parts: partsArr,
        isBlankReset: Boolean(row.is_blank_reset)
      },
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

  function mapProfileFromDb(row) {
    if (!row) return null;
    var uname = row.username || emailToUsername(row.email || '');
    var dispName = row.display_name || row.displayName || row.full_name || row.fullName || uname;
    return {
      id: row.id,
      username: uname,
      displayName: dispName,
      fullName: dispName,
      email: usernameToEmail(uname),
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
      patternHash: row.pattern_hash || '',
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

  async function getProjectsSummary(opts) {
    var options = opts || {};
    var client = getClient();
    var cols = 'id,name,customer,notes,is_locked,is_trashed,is_draft,source,igs_files,deleted_at,created_at,updated_at,active_profiles:data->activeProfiles,parts_summary:data->parts,is_blank_reset:data->isBlankReset';
    var query = client.from('projects').select(cols).order('updated_at', { ascending: false });
    if (!options.includeTrash) query = query.eq('is_trashed', false);
    if (!options.includeDraft) query = query.eq('is_draft', false);
    var res = await query;
    var rows = throwIfError(res, 'Không tải được danh sách tóm tắt dự án') || [];
    return rows.map(mapProjectSummaryFromDb);
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

  function saveProjectKeepalive(projectId, activeSnapshot, isDraft) {
    if (!isConfigured() || typeof fetch !== 'function' || !_accessToken) return;
    var cleanData = stripHeavyIgs(activeSnapshot || {});
    var baseUrl = _url.trim().replace(/\/+$/, '');
    var nowIso = new Date().toISOString();
    var useDraft = Boolean(isDraft || !projectId || projectId === DRAFT_PROJECT_ID);

    var endpoint = useDraft
      ? baseUrl + '/rest/v1/projects?on_conflict=id'
      : baseUrl + '/rest/v1/projects?id=eq.' + encodeURIComponent(String(projectId));

    var payload = useDraft
      ? {
          id: DRAFT_PROJECT_ID,
          name: String((cleanData && cleanData.currentProjectName) || 'Dự án nháp'),
          customer: String((cleanData && cleanData.currentProjectCustomer) || ''),
          notes: String((cleanData && cleanData.currentProjectNotes) || ''),
          is_locked: false,
          is_trashed: false,
          is_draft: true,
          source: 'web',
          data: cleanData,
          updated_at: nowIso
        }
      : {
          data: cleanData,
          updated_at: nowIso
        };

    try {
      var bodyStr = JSON.stringify(payload);
      var headers = {
        'Content-Type': 'application/json',
        apikey: _key.trim(),
        Authorization: 'Bearer ' + _accessToken,
        Prefer: useDraft ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
      };
      fetch(endpoint, {
        method: useDraft ? 'POST' : 'PATCH',
        headers: headers,
        body: bodyStr,
        keepalive: bodyStr.length <= 60000
      }).catch(function () {});
    } catch (e) {}
  }

  async function deleteStorageFilesForProjects(projectRows) {
    var rows = Array.isArray(projectRows) ? projectRows : [];
    if (!rows.length) return 0;
    var client = getClient();
    var pathSet = {};

    rows.forEach(function (r) {
      if (r && Array.isArray(r.igs_files)) {
        r.igs_files.forEach(function (f) {
          if (f && f.storage_path) pathSet[String(f.storage_path)] = true;
        });
      }
    });

    for (var i = 0; i < rows.length; i++) {
      var pid = rows[i] && rows[i].id;
      if (!pid) continue;
      var folder = toAsciiSafe(pid);
      try {
        var listRes = await client.storage.from(STORAGE_BUCKET).list(folder, { limit: 1000 });
        if (listRes && Array.isArray(listRes.data)) {
          listRes.data.forEach(function (item) {
            if (item && item.name && item.id) {
              pathSet[folder + '/' + item.name] = true;
            }
          });
        }
      } catch (e) {
        console.warn('[Storage Cleanup] Không liệt kê được thư mục ' + folder + ':', e);
      }
    }

    var allPaths = Object.keys(pathSet);
    var deleted = 0;
    for (var offset = 0; offset < allPaths.length; offset += 100) {
      var chunk = allPaths.slice(offset, offset + 100);
      try {
        var rmRes = await client.storage.from(STORAGE_BUCKET).remove(chunk);
        if (rmRes && rmRes.error) {
          console.warn('[Storage Cleanup] Lỗi xóa file Storage:', rmRes.error.message);
        } else {
          deleted += chunk.length;
        }
      } catch (e) {
        console.warn('[Storage Cleanup] Exception xóa Storage:', e);
      }
    }
    return deleted;
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
    if (!id) return false;
    var client = getClient();
    try {
      var infoRes = await client.from('projects').select('id, igs_files').eq('id', id).maybeSingle();
      if (infoRes && infoRes.data) {
        await deleteStorageFilesForProjects([infoRes.data]);
      } else {
        await deleteStorageFilesForProjects([{ id: id, igs_files: [] }]);
      }
    } catch (e) {
      console.warn('[Storage Cleanup] Bỏ qua lỗi dọn Storage khi xóa dự án:', e);
    }
    var res = await client.from('projects').delete().eq('id', id);
    throwIfError(res, 'Không xóa vĩnh viễn được dự án');
    return true;
  }

  async function emptyTrash() {
    var client = getClient();
    try {
      var trashRes = await client.from('projects').select('id, igs_files').eq('is_trashed', true);
      if (trashRes && Array.isArray(trashRes.data) && trashRes.data.length) {
        await deleteStorageFilesForProjects(trashRes.data);
      }
    } catch (e) {
      console.warn('[Storage Cleanup] Bỏ qua lỗi dọn Storage khi dọn thùng rác:', e);
    }
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
        patternHash: mapped.patternHash || '',
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
    var patternHash = String((payload && (payload.patternHash || payload.pattern_hash)) || '');

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
    if (_supportsPatternHash) {
      row.pattern_hash = patternHash;
    }

    var isMissingPatternHashCol = function (err) {
      if (!err) return false;
      var msg = String(err.message || '') + ' ' + String(err.details || '') + ' ' + String(err.hint || '');
      return (err.code === 'PGRST204' || err.code === '42703') && /pattern_hash/i.test(msg) || /pattern_hash/i.test(msg);
    };

    var res = await client
      .from('cut_progress')
      .upsert(row, { onConflict: 'project_id,bar_key' })
      .select()
      .single();

    if (res.error && isMissingPatternHashCol(res.error)) {
      _supportsPatternHash = false;
      delete row.pattern_hash;
      res = await client
        .from('cut_progress')
        .upsert(row, { onConflict: 'project_id,bar_key' })
        .select()
        .single();
    }

    // Nếu bản nháp (__draft__) chưa có dòng cha trên DB, tự tạo dòng nháp rồi thử lại
    if (res.error && res.error.code === '23503' && projectId === DRAFT_PROJECT_ID) {
      await saveDraftProject({});
      res = await client
        .from('cut_progress')
        .upsert(row, { onConflict: 'project_id,bar_key' })
        .select()
        .single();
      if (res.error && isMissingPatternHashCol(res.error)) {
        _supportsPatternHash = false;
        delete row.pattern_hash;
        res = await client
          .from('cut_progress')
          .upsert(row, { onConflict: 'project_id,bar_key' })
          .select()
          .single();
      }
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
  // SUPABASE AUTH & PROFILES (ĐỢT 2 - BẢO MẬT & RLS THEO VAI TRÒ)
  // =========================================================================
  async function getAccessToken() {
    var client = getClient();
    var res = await client.auth.getSession();
    var session = res && res.data ? res.data.session : null;
    _accessToken = session && session.access_token ? session.access_token : null;
    return _accessToken;
  }

  async function fetchProfileById(userId) {
    if (!userId) return null;
    var client = getClient();
    var res = await client
      .from('profiles')
      .select('id, username, display_name, role, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();
    var row = throwIfError(res, 'Không đọc được hồ sơ phân quyền tài khoản');
    return row ? mapProfileFromDb(row) : null;
  }

  async function signInWithUsername(username, password) {
    var client = getClient();
    var email = usernameToEmail(username);
    if (!email || !password) {
      throw new Error('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!');
    }
    var authRes = await client.auth.signInWithPassword({
      email: email,
      password: String(password)
    });
    if (authRes.error || !authRes.data || !authRes.data.user || !authRes.data.session) {
      var rawMsg = authRes.error ? String(authRes.error.message || '') : '';
      if (/invalid login credentials/i.test(rawMsg)) {
        throw new Error('Tên tài khoản hoặc Mật khẩu không chính xác!');
      }
      if (/email not confirmed/i.test(rawMsg)) {
        throw new Error('Tài khoản chưa được xác nhận email trên Supabase Auth (hãy chạy setup_auth_users.js).');
      }
      throw new Error(rawMsg || 'Đăng nhập thất bại!');
    }

    _accessToken = authRes.data.session.access_token;
    clearLegacySessionStorage();

    var prof = null;
    try {
      prof = await fetchProfileById(authRes.data.user.id);
    } catch (e) {
      await client.auth.signOut().catch(function () {});
      _accessToken = null;
      throw e;
    }

    if (!prof) {
      await client.auth.signOut().catch(function () {});
      _accessToken = null;
      throw new Error('Tài khoản Auth hợp lệ nhưng chưa có dòng phân quyền trong bảng public.profiles. Vui lòng liên hệ Admin!');
    }
    return prof;
  }

  async function signOut() {
    _accessToken = null;
    clearLegacySessionStorage();
    if (!isConfigured()) return;
    try {
      await getClient().auth.signOut();
    } catch (e) {}
  }

  async function getCurrentAuthUser() {
    clearLegacySessionStorage();
    if (!isConfigured()) return null;
    var client = getClient();
    var sRes = await client.auth.getSession();
    var session = sRes && sRes.data ? sRes.data.session : null;
    if (!session || !session.access_token) {
      _accessToken = null;
      return null;
    }
    _accessToken = session.access_token;

    // Xác thực trực tiếp với Auth server để phát hiện token hết hạn / bị thu hồi
    var uRes = await client.auth.getUser();
    if (uRes && uRes.error) {
      var msg = String(uRes.error.message || '');
      var isNetworkDown = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        (/fetch|network|timeout|load failed/i.test(msg) && !/jwt|token|session|expired|invalid|401|403/i.test(msg));
      if (!isNetworkDown) {
        await client.auth.signOut().catch(function () {});
        _accessToken = null;
        return null;
      }
      throw uRes.error;
    }

    var authUser = uRes && uRes.data ? uRes.data.user : null;
    if (!authUser) {
      await client.auth.signOut().catch(function () {});
      _accessToken = null;
      return null;
    }

    var prof = await fetchProfileById(authUser.id);
    if (!prof) {
      await client.auth.signOut().catch(function () {});
      _accessToken = null;
      return null;
    }
    return prof;
  }

  function onAuthStateChange(callback) {
    if (typeof callback !== 'function' || !isConfigured()) {
      return function () {};
    }
    var client = getClient();
    var subRes = client.auth.onAuthStateChange(function (event, session) {
      _accessToken = session && session.access_token ? session.access_token : null;
      try {
        callback(event, session);
      } catch (e) {
        console.error('[Supabase Auth]', e);
      }
    });
    var subscription = subRes && subRes.data ? subRes.data.subscription : null;
    return function () {
      try {
        if (subscription && typeof subscription.unsubscribe === 'function') {
          subscription.unsubscribe();
        }
      } catch (e) {}
    };
  }

  async function updateOwnPassword(newPassword) {
    var clean = String(newPassword || '').trim();
    if (!clean || clean.length < 6) {
      throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự!');
    }
    var client = getClient();
    var res = await client.auth.updateUser({ password: clean });
    if (res && res.error) {
      throw new Error('Không đổi được mật khẩu: ' + res.error.message);
    }
    return true;
  }

  async function getProfiles() {
    var client = getClient();
    var res = await client
      .from('profiles')
      .select('id, username, display_name, role, created_at, updated_at')
      .order('created_at', { ascending: true });
    var rows = throwIfError(res, 'Không tải được danh sách nhân sự') || [];
    return rows.map(mapProfileFromDb);
  }

  async function updateProfile(userId, patch) {
    if (!userId || !patch) return null;
    var client = getClient();
    var updateObj = { updated_at: new Date().toISOString() };
    if (patch.displayName !== undefined) updateObj.display_name = String(patch.displayName || '').trim();
    if (patch.fullName !== undefined) updateObj.display_name = String(patch.fullName || '').trim();
    if (patch.role !== undefined && ['admin', 'engineer', 'operator'].indexOf(patch.role) !== -1) {
      updateObj.role = patch.role;
    }
    var res = await client
      .from('profiles')
      .update(updateObj)
      .eq('id', userId)
      .select('id, username, display_name, role, created_at, updated_at')
      .single();
    var row = throwIfError(res, 'Không cập nhật được hồ sơ nhân sự');
    return mapProfileFromDb(row);
  }

  // Cầu nối quản trị Auth cục bộ qua server.js (tuyệt đối không giữ Secret key trên trình duyệt)
  function _getLocalBridgeCandidates() {
    var bases = [];
    if (typeof window !== 'undefined' && window.location) {
      var host = String(window.location.hostname || '').toLowerCase();
      var proto = String(window.location.protocol || '');
      var isLocalOrLan = host === 'localhost' || host === '127.0.0.1' ||
        /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
      if (isLocalOrLan && /^https?:$/i.test(proto)) {
        bases.push(window.location.origin);
      }
    }
    if (bases.indexOf('http://localhost:3000') === -1) {
      bases.push('http://localhost:3000');
    }
    return bases;
  }

  async function _fetchWithTimeout(url, opts, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 1800) : null;
    try {
      var nextOpts = Object.assign({}, opts || {});
      if (ctrl) nextOpts.signal = ctrl.signal;
      return await fetch(url, nextOpts);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function checkLocalAdminBridge() {
    if (typeof fetch !== 'function') return { available: false, reason: 'NO_FETCH' };
    var candidates = _getLocalBridgeCandidates();
    for (var i = 0; i < candidates.length; i++) {
      var base = candidates[i];
      try {
        var r = await _fetchWithTimeout(base + '/api/admin/status', { method: 'GET' }, 1500);
        if (r && r.ok) {
          var data = await r.json();
          if (data && data.success) {
            return {
              available: true,
              baseUrl: base,
              hasSecretKey: Boolean(data.hasSecretKey)
            };
          }
        }
      } catch (e) {}
    }
    return { available: false, reason: 'BRIDGE_UNAVAILABLE' };
  }

  async function _callAdminBridge(method, pathSuffix, body) {
    var status = await checkLocalAdminBridge();
    if (!status.available) {
      var err = new Error('Không tìm thấy máy chủ cầu nối xưởng (server.js localhost:3000). Nếu đang truy cập từ xa trên xepphoi.cloud, vui lòng tạo/đổi mật khẩu nhân sự khác trực tiếp trên Supabase Auth Dashboard.');
      err.code = 'BRIDGE_UNAVAILABLE';
      throw err;
    }
    if (!status.hasSecretKey) {
      var errKey = new Error('Máy chủ server.js đang chạy nhưng chưa điền SUPABASE_SECRET_KEY trong file .env!');
      err.code = 'MISSING_SECRET_KEY';
      throw errKey;
    }
    var token = await getAccessToken();
    if (!token) {
      throw new Error('Phiên đăng nhập Quản trị viên đã hết hạn. Vui lòng đăng nhập lại!');
    }
    var res = await _fetchWithTimeout(status.baseUrl + pathSuffix, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    }, 10000);
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.success) {
      throw new Error(json.error || ('Lỗi máy chủ cầu nối (HTTP ' + res.status + ')'));
    }
    return json;
  }

  async function adminCreateUser(payload) {
    var res = await _callAdminBridge('POST', '/api/admin/users', payload);
    return res.user;
  }

  async function adminResetPassword(userId, newPassword) {
    return _callAdminBridge('PUT', '/api/admin/users/' + encodeURIComponent(userId) + '/password', {
      password: newPassword
    });
  }

  async function adminUpdateRole(userId, role, displayName) {
    var res = await _callAdminBridge('PUT', '/api/admin/users/' + encodeURIComponent(userId) + '/role', {
      role: role,
      displayName: displayName
    });
    return mapProfileFromDb(res.profile);
  }

  async function adminDeleteUser(userId) {
    return _callAdminBridge('DELETE', '/api/admin/users/' + encodeURIComponent(userId));
  }

  // =========================================================================
  // PRIVATE STORAGE BUCKET: igs-files (ĐỌC QUA JWT AUTHENTICATED)
  // =========================================================================
  function extractIgsStoragePath(pathOrUrl) {
    if (!pathOrUrl) return null;
    var s = String(pathOrUrl).trim();
    if (!s || s.indexOf('/api/igs/') === 0) return null;
    if (s.indexOf('storage://') === 0) {
      return s.slice('storage://'.length).replace(/^\/+/, '');
    }
    var markerRegex = /\/storage\/v1\/object\/(?:public|authenticated|sign)\/igs-files\/([^?#]+)/i;
    var m = s.match(markerRegex);
    if (m && m[1]) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    if (!/^https?:\/\//i.test(s) && s.indexOf('/') !== 0) {
      return s;
    }
    return null;
  }

  async function downloadIgsBlob(pathOrUrl) {
    var storagePath = extractIgsStoragePath(pathOrUrl);
    if (storagePath) {
      var client = getClient();
      var res = await client.storage.from(STORAGE_BUCKET).download(storagePath);
      if (res && res.error) {
        throw new Error('Không tải được file .IGS từ Storage bảo mật: ' + res.error.message);
      }
      if (!res || !res.data) {
        throw new Error('File .IGS trống trên Storage');
      }
      return res.data;
    }
    if (!pathOrUrl) throw new Error('Thiếu đường dẫn file .IGS');
    var httpRes = await fetch(String(pathOrUrl));
    if (!httpRes.ok) {
      throw new Error('Không tải được file .IGS (HTTP ' + httpRes.status + ')');
    }
    return await httpRes.blob();
  }

  async function downloadIgsFile(pathOrUrl, fileName) {
    var blob = await downloadIgsBlob(pathOrUrl);
    if (!blob || blob.size < 50) {
      throw new Error('Dữ liệu file .IGS rỗng hoặc không hợp lệ');
    }
    var dlName = String(fileName || 'file.igs').replace(/\.igs\.igs$/i, '.igs');
    if (!/\.igs$/i.test(dlName)) dlName += '.igs';
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = dlName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  async function getIgsSignedUrl(pathOrUrl, expiresInSec) {
    var storagePath = extractIgsStoragePath(pathOrUrl);
    if (!storagePath) return pathOrUrl;
    var client = getClient();
    var res = await client.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, expiresInSec || 300);
    if (res && res.error) {
      throw new Error('Không tạo được link tải tạm .IGS: ' + res.error.message);
    }
    return res && res.data ? res.data.signedUrl : null;
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
      storageRef: 'storage://' + storagePath
    };
  }

  // =========================================================================
  // REALTIME (POSTGRES CHANGES) + VÒNG ĐỜI TỰ PHỤC HỒI KẾT NỐI
  // =========================================================================
  function subscribeTables(handlers, onStatusChange, options) {
    var client = getClient();
    var hMap = handlers || {};
    var opts = options || {};
    var onResync = typeof opts.onResync === 'function' ? opts.onResync : null;

    var disposed = false;
    var activeChannel = null;
    var reconnectTimer = null;
    var reconnectAttempts = 0;
    var hadSubscribedOnce = false;
    var isDisconnected = false;
    var hiddenAt = 0;
    var lastResyncAt = 0;

    function triggerResync(reason) {
      if (disposed || !onResync) return;
      var now = Date.now();
      if (now - lastResyncAt < 1200) return;
      lastResyncAt = now;
      try {
        Promise.resolve(onResync(reason)).catch(function (e) {
          console.warn('[Supabase Realtime] Resync error:', e);
        });
      } catch (e) {
        console.warn('[Supabase Realtime] Resync sync error:', e);
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function teardownChannel() {
      var prev = activeChannel;
      activeChannel = null;
      if (prev) {
        try {
          client.removeChannel(prev);
        } catch (e) {}
      }
    }

    function scheduleReconnect(reasonStatus) {
      if (disposed || reconnectTimer) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      var delay = Math.min(30000, 1500 * Math.pow(2, reconnectAttempts));
      reconnectAttempts = Math.min(reconnectAttempts + 1, 5);
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (!disposed) {
          connectChannel('backoff_' + reasonStatus);
        }
      }, delay);
    }

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
      if (table === 'profiles') {
        return {
          eventType: eventType,
          newRecord: mapProfileFromDb(payload.new),
          oldRecord: mapProfileFromDb(payload.old),
          raw: payload
        };
      }
      return payload;
    };

    function connectChannel() {
      if (disposed) return;
      clearReconnectTimer();
      teardownChannel();

      var channelName = 'workshop_rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      var channel = client.channel(channelName);
      activeChannel = channel;

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
        if (disposed || activeChannel !== channel) return;
        if (typeof onStatusChange === 'function') {
          try {
            onStatusChange(status);
          } catch (e) {}
        }
        if (status === 'SUBSCRIBED') {
          clearReconnectTimer();
          reconnectAttempts = 0;
          if (hadSubscribedOnce && isDisconnected) {
            triggerResync('reconnected');
          }
          hadSubscribedOnce = true;
          isDisconnected = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          isDisconnected = true;
          scheduleReconnect(status);
        }
      });
    }

    function handleVisibilityChange() {
      if (disposed || typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        var awayMs = hiddenAt ? (Date.now() - hiddenAt) : 0;
        hiddenAt = 0;
        var chState = activeChannel && activeChannel.state;
        var needReconnect = !activeChannel || (chState !== 'joined' && chState !== 'joining');
        if (needReconnect) {
          reconnectAttempts = 0;
          connectChannel();
          triggerResync('visibility');
        } else if (awayMs > 3000) {
          triggerResync('visibility');
        }
      }
    }

    function handleOnline() {
      if (disposed) return;
      reconnectAttempts = 0;
      var chState = activeChannel && activeChannel.state;
      if (!activeChannel || (chState !== 'joined' && chState !== 'joining')) {
        connectChannel();
      }
      triggerResync('online');
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', handleOnline);
    }

    connectChannel();

    return function unsubscribe() {
      disposed = true;
      clearReconnectTimer();
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('online', handleOnline);
      }
      teardownChannel();
    };
  }

  global.SupabaseDB = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    STORAGE_BUCKET: STORAGE_BUCKET,
    DRAFT_PROJECT_ID: DRAFT_PROJECT_ID,
    INTERNAL_EMAIL_DOMAIN: INTERNAL_EMAIL_DOMAIN,
    DEFAULT_PROFILES: DEFAULT_PROFILES,
    setCredentials: setCredentials,
    isConfigured: isConfigured,
    getClient: getClient,
    setLoading: setLoading,
    showConnectionError: showConnectionError,
    clearConnectionError: clearConnectionError,
    uid: uid,
    computePatternHash: computePatternHash,
    toAsciiSafe: toAsciiSafe,
    classifyProfile: classifyProfile,
    stripHeavyIgs: stripHeavyIgs,
    usernameToEmail: usernameToEmail,
    emailToUsername: emailToUsername,
    mapProjectFromDb: mapProjectFromDb,
    mapProjectSummaryFromDb: mapProjectSummaryFromDb,
    mapProjectToDb: mapProjectToDb,
    mapProfileFromDb: mapProfileFromDb,
    mapInventoryFromDb: mapInventoryFromDb,
    mapCutRow: mapCutRow,
    getAccessToken: getAccessToken,
    signInWithUsername: signInWithUsername,
    signOut: signOut,
    getCurrentAuthUser: getCurrentAuthUser,
    onAuthStateChange: onAuthStateChange,
    updateOwnPassword: updateOwnPassword,
    getProfiles: getProfiles,
    getUsers: getProfiles,
    updateProfile: updateProfile,
    checkLocalAdminBridge: checkLocalAdminBridge,
    adminCreateUser: adminCreateUser,
    adminResetPassword: adminResetPassword,
    adminUpdateRole: adminUpdateRole,
    adminDeleteUser: adminDeleteUser,
    getProjects: getProjects,
    getProjectsSummary: getProjectsSummary,
    getProjectById: getProjectById,
    getDraftProject: getDraftProject,
    saveProject: saveProject,
    updateProjectFields: updateProjectFields,
    saveDraftProject: saveDraftProject,
    saveProjectKeepalive: saveProjectKeepalive,
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
    extractIgsStoragePath: extractIgsStoragePath,
    downloadIgsBlob: downloadIgsBlob,
    downloadIgsFile: downloadIgsFile,
    getIgsSignedUrl: getIgsSignedUrl,
    uploadIgsFile: uploadIgsFile,
    subscribeTables: subscribeTables
  };
})(typeof window !== 'undefined' ? window : globalThis);
