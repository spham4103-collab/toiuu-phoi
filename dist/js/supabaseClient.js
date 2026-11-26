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
  var _offcutsTableReady = true;
  var _inventoryEnhancedReady = true;
  var _inventoryWmsReady = true;
  var _wmsVouchersReady = true;
  var _ledgerTableReady = true;
  var _projectsDeductedColReady = true;

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

  function estimateSteelWeightPerM(pName) {
    var s = String(pName || '').trim();
    if (!s) return 0;
    // Ông tròn: Ø27x1.4, Phi 34x1.8, Ống 42*2.0
    var mRound = s.match(/(?:Ø|phi|ống|ong|d)\s*(\d+(?:\.\d+)?)\s*[xX\*×]\s*(\d+(?:\.\d+)?)/i);
    if (mRound && /ống|ong|phi|ø/i.test(s)) {
      var od = parseFloat(mRound[1]);
      var wt = parseFloat(mRound[2]);
      if (od > 2 * wt && wt > 0) {
        var areaMm2 = Math.PI * (od - wt) * wt;
        return Math.round(areaMm2 * 0.00785 * 100) / 100;
      }
    }
    // Hộp vuông / chữ nhật: 30x30x1.8, 40x80x2.0
    var mBox = s.match(/(\d+(?:\.\d+)?)\s*[xX\*×]\s*(\d+(?:\.\d+)?)\s*[xX\*×]\s*(\d+(?:\.\d+)?)/);
    if (mBox) {
      var w = parseFloat(mBox[1]);
      var h = parseFloat(mBox[2]);
      var t = parseFloat(mBox[3]);
      if (w > 0 && h > 0 && t > 0 && 2 * t < Math.min(w, h)) {
        var boxAreaMm2 = (2 * (w + h) - 4 * t) * t;
        return Math.round(boxAreaMm2 * 0.00785 * 100) / 100;
      }
    }
    return 0;
  }

  function _errMsg(err) {
    if (!err) return '';
    return String(err.message || '') + ' ' + String(err.details || '') + ' ' + String(err.hint || '');
  }

  function _isMissingColumnError(err, colRegex) {
    if (!err) return false;
    var msg = _errMsg(err);
    var isColCode = err.code === 'PGRST204' || err.code === '42703' || /column|schema cache|Could not find/i.test(msg);
    if (!isColCode) return false;
    return colRegex ? colRegex.test(msg) : true;
  }

  function _isMissingTableError(err, tableName) {
    if (!err) return false;
    var msg = _errMsg(err);
    if (err.code === 'PGRST205' || err.code === '42P01') {
      return !tableName || new RegExp(tableName, 'i').test(msg) || /schema cache|does not exist/i.test(msg);
    }
    if (tableName && new RegExp(tableName, 'i').test(msg) && /does not exist|schema cache|not find/i.test(msg)) {
      return true;
    }
    return false;
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
    var d = (row.data && typeof row.data === 'object') ? row.data : {};
    return {
      id: row.id,
      name: row.name || '',
      customer: row.customer || '',
      customerPoNo: row.customer_po_no || '',
      workflowStatus: row.workflow_status || 'waiting_drawings',
      poPushedAt: row.po_pushed_at || null,
      poPushedBy: row.po_pushed_by || null,
      drawingsHandedOverAt: row.drawings_handed_over_at || null,
      drawingsHandedOverBy: row.drawings_handed_over_by || null,
      bomSubmittedAt: row.bom_submitted_at || null,
      bomSubmittedBy: row.bom_submitted_by || null,
      workflowHistory: Array.isArray(row.workflow_history) ? row.workflow_history : [],
      notes: row.notes || '',
      isLocked: Boolean(row.is_locked),
      isTrashed: Boolean(row.is_trashed),
      isDraft: Boolean(row.is_draft),
      source: row.source || 'web',
      data: d,
      igsFiles: Array.isArray(row.igs_files) ? row.igs_files : [],
      inventoryDeductedAt: row.inventory_deducted_at || d.inventoryDeductedAt || null,
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
      customerPoNo: row.customer_po_no || '',
      workflowStatus: row.workflow_status || 'waiting_drawings',
      poPushedAt: row.po_pushed_at || null,
      poPushedBy: row.po_pushed_by || null,
      drawingsHandedOverAt: row.drawings_handed_over_at || null,
      drawingsHandedOverBy: row.drawings_handed_over_by || null,
      bomSubmittedAt: row.bom_submitted_at || null,
      bomSubmittedBy: row.bom_submitted_by || null,
      workflowHistory: Array.isArray(row.workflow_history) ? row.workflow_history : [],
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
      customer_po_no: String(proj.customerPoNo != null ? proj.customerPoNo : (proj.customer_po_no || '')),
      workflow_status: String(proj.workflowStatus || proj.workflow_status || 'waiting_drawings'),
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
    var stdLen = Number(row.standard_length_mm != null ? row.standard_length_mm : row.standard_length) || 6000;
    var specObj = (row.spec_json && typeof row.spec_json === 'object' && !Array.isArray(row.spec_json))
      ? row.spec_json
      : {};
    var uPrice = Math.max(0, Number(row.unit_price) || 0);
    var aCost = row.avg_cost != null ? Math.max(0, Number(row.avg_cost) || 0) : uPrice;
    return {
      id: row.id,
      profileName: row.profile_name,
      category: row.category || classifyProfile(row.profile_name),
      materialGroup: row.material_group || 'tube_1d',
      sku: row.sku ? String(row.sku) : '',
      unit: row.unit ? String(row.unit) : 'cây',
      subCategory: row.sub_category ? String(row.sub_category) : '',
      brand: row.brand ? String(row.brand) : '',
      packUnit: row.pack_unit ? String(row.pack_unit) : '',
      packQty: row.pack_qty != null ? Math.max(1, Number(row.pack_qty) || 1) : 1,
      isReturnable: Boolean(row.is_returnable),
      specJson: specObj,
      standardLength: stdLen,
      standardLengthMm: stdLen,
      stockQty: row.stock_qty != null ? Math.max(0, Number(row.stock_qty) || 0) : 0,
      reservedQty: row.reserved_qty != null ? Math.max(0, Number(row.reserved_qty) || 0) : 0,
      freeQty: Math.max(0, (row.stock_qty != null ? Number(row.stock_qty) || 0 : 0) - (row.reserved_qty != null ? Number(row.reserved_qty) || 0 : 0)),
      minStockQty: Math.max(0, Number(row.min_stock_qty) || 0),
      weightPerM: Math.max(0, Number(row.weight_per_m) || 0),
      unitPrice: uPrice,
      avgCost: aCost,
      rackLocation: String(row.rack_location || ''),
      notes: row.notes || '',
      isDefault: Boolean(row.is_default),
      isActive: row.is_active !== false,
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

  function mapOffcutFromDb(row) {
    if (!row) return null;
    var qty = row.quantity != null ? Math.max(0, Number(row.quantity) || 0) : 0;
    var noteText = String((row.note !== undefined && row.note !== null && row.note !== '') ? row.note : (row.notes || ''));
    var srcType = row.source_type || ((row.source_bar_key || row.source_project_id) ? 'cnc_return' : 'manual');
    var statusVal = row.status || (qty > 0 ? 'available' : 'used');
    return {
      id: row.id,
      profile: row.profile || '',
      lengthMm: Number(row.length_mm) || 0,
      quantity: qty,
      sourceProjectId: row.source_project_id || null,
      sourceProjectName: row.source_project_name || '',
      sourceBarKey: row.source_bar_key || '',
      sourceType: srcType,
      rackLocation: String(row.rack_location || ''),
      status: statusVal,
      note: noteText,
      notes: noteText,
      createdBy: row.created_by || '',
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || row.created_at || null
    };
  }

  function mapInventoryTxFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      txType: row.tx_type || 'stocktake_adjust',
      profile: row.profile || '',
      lengthMm: Number(row.length_mm) || 6000,
      qtyChange: Number(row.qty_change) || 0,
      balanceAfter: row.balance_after != null ? Number(row.balance_after) : null,
      projectId: row.project_id || null,
      voucherId: row.voucher_id || null,
      unitPrice: Number(row.unit_price) || 0,
      note: String(row.note || ''),
      createdBy: String(row.created_by || ''),
      createdAt: row.created_at || new Date().toISOString()
    };
  }

  function mapSupplierFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: String(row.code || ''),
      name: String(row.name || ''),
      phone: String(row.phone || ''),
      email: String(row.email || ''),
      address: String(row.address || ''),
      taxCode: String(row.tax_code || ''),
      note: String(row.note || ''),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  function mapVoucherItemFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      voucherId: row.voucher_id,
      inventoryId: row.inventory_id || null,
      offcutId: row.offcut_id || null,
      profile: String(row.profile || ''),
      materialGroup: String(row.material_group || 'tube_1d'),
      unit: String(row.unit || 'cây'),
      qty: Number(row.qty) || 0,
      lengthMm: row.length_mm != null ? Number(row.length_mm) : null,
      unitPrice: Number(row.unit_price) || 0,
      totalAmount: Number(row.total_amount) || 0,
      issueReason: String(row.issue_reason || 'new'),
      returnedOldQty: Number(row.returned_old_qty) || 0,
      projectRequestId: row.project_request_id || null,
      poItemId: row.po_item_id || null,
      note: String(row.note || ''),
      createdAt: row.created_at || null
    };
  }

  function mapVoucherFromDb(row) {
    if (!row) return null;
    var rawItems = Array.isArray(row.items) ? row.items : (Array.isArray(row.warehouse_voucher_items) ? row.warehouse_voucher_items : []);
    return {
      id: row.id,
      voucherCode: String(row.voucher_code || ''),
      voucherType: String(row.voucher_type || 'IN'),
      status: String(row.status || 'pending'),
      projectId: row.project_id || null,
      supplierId: row.supplier_id || null,
      poId: row.po_id || null,
      supplierName: row.supplier && row.supplier.name ? String(row.supplier.name) : String(row.supplier_name || ''),
      projectName: row.project && row.project.name ? String(row.project.name) : String(row.project_name || ''),
      department: String(row.department || ''),
      machineName: String(row.machine_name || ''),
      recipientName: String(row.recipient_name || ''),
      invoiceNo: String(row.invoice_no || ''),
      attachmentUrl: String(row.attachment_url || ''),
      note: String(row.note || ''),
      cancelReason: String(row.cancel_reason || ''),
      allowNegative: Boolean(row.allow_negative),
      createdBy: String(row.created_by || ''),
      createdByUid: row.created_by_uid || null,
      approvedBy: String(row.approved_by || ''),
      approvedByUid: row.approved_by_uid || null,
      approvedAt: row.approved_at || null,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
      items: rawItems.map(mapVoucherItemFromDb).filter(Boolean)
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
    if (res && res.error && dbRow.workflow_status === 'po_draft' && (String(res.error.code || '') === '23514' || /projects_workflow_status_check/i.test(String(res.error.message || '')))) {
      dbRow.workflow_status = 'waiting_drawings';
      res = await client
        .from('projects')
        .upsert(dbRow, { onConflict: 'id' })
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /customer_po_no|workflow_status/i)) {
      delete dbRow.customer_po_no;
      delete dbRow.workflow_status;
      res = await client
        .from('projects')
        .upsert(dbRow, { onConflict: 'id' })
        .select()
        .single();
    }
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
    if (_projectsDeductedColReady) {
      if (fields.inventoryDeductedAt !== undefined) patch.inventory_deducted_at = fields.inventoryDeductedAt;
      if (fields.inventory_deducted_at !== undefined) patch.inventory_deducted_at = fields.inventory_deducted_at;
    }

    var res = await client
      .from('projects')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (res && res.error && _isMissingColumnError(res.error, /inventory_deducted_at/i)) {
      _projectsDeductedColReady = false;
      delete patch.inventory_deducted_at;
      res = await client
        .from('projects')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    }
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
  // CRUD: INVENTORY (KHO CÂY NGUYÊN TIÊU CHUẨN & THƯ VIỆN QUY CÁCH - ĐỢT 4)
  // =========================================================================
  function isInventoryEnhancedReady() {
    return _inventoryEnhancedReady;
  }

  function isInventoryWmsReady() {
    return _inventoryWmsReady;
  }

  function isWmsVouchersReady() {
    return _wmsVouchersReady;
  }

  function isLedgerTableReady() {
    return _ledgerTableReady;
  }

  function _stripActiveInventoryCol(obj) {
    var copy = Object.assign({}, obj);
    delete copy.is_active;
    return copy;
  }

  function _stripToolingInventoryCols(obj) {
    var copy = Object.assign({}, obj);
    delete copy.sub_category;
    delete copy.brand;
    delete copy.pack_unit;
    delete copy.pack_qty;
    delete copy.is_returnable;
    delete copy.is_active;
    return copy;
  }

  function _stripWmsInventoryCols(obj) {
    var copy = _stripToolingInventoryCols(obj);
    delete copy.material_group;
    delete copy.sku;
    delete copy.unit;
    delete copy.spec_json;
    delete copy.avg_cost;
    return copy;
  }

  function _stripEnhancedInventoryCols(obj) {
    var copy = _stripWmsInventoryCols(obj);
    delete copy.standard_length_mm;
    delete copy.min_stock_qty;
    delete copy.weight_per_m;
    delete copy.unit_price;
    delete copy.rack_location;
    return copy;
  }

  function _sanitizeInvPayload(obj) {
    if (!_inventoryEnhancedReady) return _stripEnhancedInventoryCols(obj);
    if (!_inventoryWmsReady) return _stripWmsInventoryCols(obj);
    return obj;
  }

  async function getInventory(opts) {
    var client = getClient();
    var res = await client.from('inventory').select('*').order('created_at', { ascending: true });
    var rows = throwIfError(res, 'Không tải được thư viện quy cách') || [];
    if (rows.length > 0) {
      _inventoryEnhancedReady = Object.prototype.hasOwnProperty.call(rows[0], 'rack_location');
      _inventoryWmsReady = Object.prototype.hasOwnProperty.call(rows[0], 'material_group');
    }
    var mapped = rows.map(mapInventoryFromDb);
    if (opts && opts.includeInactive) return mapped;
    return mapped.filter(function (r) { return r.isActive !== false; });
  }

  async function addProfile(profileName, meta) {
    var clean = String(profileName || '').trim();
    if (!clean) throw new Error('Tên quy cách không được để trống');
    var info = meta || {};
    var client = getClient();
    var stdLen = Math.max(1, Number(info.standardLengthMm != null ? info.standardLengthMm : (info.standardLength != null ? info.standardLength : 6000)) || 6000);
    var qtyVal = info.stockQty !== undefined && info.stockQty !== null && info.stockQty !== ''
      ? Math.max(0, Number(info.stockQty) || 0)
      : 0;
    var uPrice = Math.max(0, Number(info.unitPrice) || 0);
    var payload = {
      profile_name: clean,
      category: info.category || classifyProfile(clean),
      material_group: String(info.materialGroup || 'tube_1d').trim() || 'tube_1d',
      sku: String(info.sku || '').trim() || null,
      unit: String(info.unit || 'cây').trim() || 'cây',
      sub_category: String(info.subCategory || '').trim() || null,
      brand: String(info.brand || '').trim() || null,
      pack_unit: String(info.packUnit || '').trim() || null,
      pack_qty: Math.max(1, Number(info.packQty) || 1),
      is_returnable: Boolean(info.isReturnable),
      spec_json: (info.specJson && typeof info.specJson === 'object') ? info.specJson : {},
      standard_length: stdLen,
      standard_length_mm: stdLen,
      stock_qty: qtyVal,
      min_stock_qty: Math.max(0, Math.round(Number(info.minStockQty) || 0)),
      weight_per_m: Math.max(0, Number(info.weightPerM != null ? info.weightPerM : estimateSteelWeightPerM(clean)) || 0),
      unit_price: uPrice,
      avg_cost: info.avgCost !== undefined ? Math.max(0, Number(info.avgCost) || 0) : uPrice,
      rack_location: String(info.rackLocation || '').trim(),
      notes: String(info.notes || ''),
      is_default: Boolean(info.isDefault),
      is_active: info.isActive !== false
    };
    var res = await client
      .from('inventory')
      .upsert(_sanitizeInvPayload(payload), { onConflict: 'profile_name' })
      .select()
      .single();
    if (res && res.error && _isMissingColumnError(res.error, /is_active/i)) {
      res = await client
        .from('inventory')
        .upsert(_stripActiveInventoryCol(_sanitizeInvPayload(payload)), { onConflict: 'profile_name' })
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /sub_category|brand|pack_unit|pack_qty|is_returnable/i)) {
      res = await client
        .from('inventory')
        .upsert(_stripToolingInventoryCols(_sanitizeInvPayload(payload)), { onConflict: 'profile_name' })
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /material_group|sku|unit|spec_json|avg_cost/i)) {
      _inventoryWmsReady = false;
      res = await client
        .from('inventory')
        .upsert(_sanitizeInvPayload(payload), { onConflict: 'profile_name' })
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /standard_length_mm|min_stock_qty|weight_per_m|unit_price|rack_location/i)) {
      _inventoryEnhancedReady = false;
      res = await client
        .from('inventory')
        .upsert(_stripEnhancedInventoryCols(payload), { onConflict: 'profile_name' })
        .select()
        .single();
    }
    var row = throwIfError(res, 'Không lưu được quy cách vật tư');
    return mapInventoryFromDb(row);
  }

  async function updateInventoryProfile(profileNameOrId, patch) {
    if (!profileNameOrId || !patch) return null;
    var client = getClient();
    var p = patch || {};
    var updateObj = { updated_at: new Date().toISOString() };
    if (p.profileName !== undefined) {
      var cleanName = String(p.profileName || '').trim();
      if (!cleanName) throw new Error('Tên quy cách không được để trống');
      updateObj.profile_name = cleanName;
      updateObj.category = p.category || classifyProfile(cleanName);
    }
    if (p.category !== undefined) updateObj.category = String(p.category || 'other');
    if (p.materialGroup !== undefined) updateObj.material_group = String(p.materialGroup || 'tube_1d');
    if (p.sku !== undefined) updateObj.sku = String(p.sku || '').trim() || null;
    if (p.unit !== undefined) updateObj.unit = String(p.unit || 'cây');
    if (p.subCategory !== undefined) updateObj.sub_category = String(p.subCategory || '').trim() || null;
    if (p.brand !== undefined) updateObj.brand = String(p.brand || '').trim() || null;
    if (p.packUnit !== undefined) updateObj.pack_unit = String(p.packUnit || '').trim() || null;
    if (p.packQty !== undefined) updateObj.pack_qty = Math.max(1, Number(p.packQty) || 1);
    if (p.isReturnable !== undefined) updateObj.is_returnable = Boolean(p.isReturnable);
    if (p.specJson !== undefined) updateObj.spec_json = (p.specJson && typeof p.specJson === 'object') ? p.specJson : {};
    if (p.standardLengthMm !== undefined || p.standardLength !== undefined) {
      var sLen = Math.max(1, Number(p.standardLengthMm !== undefined ? p.standardLengthMm : p.standardLength) || 6000);
      updateObj.standard_length = sLen;
      updateObj.standard_length_mm = sLen;
    }
    if (p.stockQty !== undefined) {
      updateObj.stock_qty = Math.max(0, Number(p.stockQty) || 0);
    }
    if (p.minStockQty !== undefined) {
      updateObj.min_stock_qty = Math.max(0, Math.round(Number(p.minStockQty) || 0));
    }
    if (p.weightPerM !== undefined) {
      updateObj.weight_per_m = Math.max(0, Number(p.weightPerM) || 0);
    }
    if (p.unitPrice !== undefined) {
      updateObj.unit_price = Math.max(0, Number(p.unitPrice) || 0);
    }
    if (p.avgCost !== undefined) {
      updateObj.avg_cost = Math.max(0, Number(p.avgCost) || 0);
    }
    if (p.rackLocation !== undefined) {
      updateObj.rack_location = String(p.rackLocation || '').trim();
    }
    if (p.notes !== undefined) {
      updateObj.notes = String(p.notes || '');
    }
    if (p.isActive !== undefined) {
      updateObj.is_active = Boolean(p.isActive);
    }

    var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(profileNameOrId));
    var colKey = isUuid ? 'id' : 'profile_name';

    var res = await client
      .from('inventory')
      .update(_sanitizeInvPayload(updateObj))
      .eq(colKey, String(profileNameOrId).trim())
      .select()
      .single();
    if (res && res.error && _isMissingColumnError(res.error, /is_active/i)) {
      res = await client
        .from('inventory')
        .update(_stripActiveInventoryCol(_sanitizeInvPayload(updateObj)))
        .eq(colKey, String(profileNameOrId).trim())
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /sub_category|brand|pack_unit|pack_qty|is_returnable/i)) {
      res = await client
        .from('inventory')
        .update(_stripToolingInventoryCols(_sanitizeInvPayload(updateObj)))
        .eq(colKey, String(profileNameOrId).trim())
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /material_group|sku|unit|spec_json|avg_cost/i)) {
      _inventoryWmsReady = false;
      res = await client
        .from('inventory')
        .update(_sanitizeInvPayload(updateObj))
        .eq(colKey, String(profileNameOrId).trim())
        .select()
        .single();
    }
    if (res && res.error && _isMissingColumnError(res.error, /standard_length_mm|min_stock_qty|weight_per_m|unit_price|rack_location/i)) {
      _inventoryEnhancedReady = false;
      res = await client
        .from('inventory')
        .update(_stripEnhancedInventoryCols(updateObj))
        .eq(colKey, String(profileNameOrId).trim())
        .select()
        .single();
    }
    var row = throwIfError(res, 'Không cập nhật được quy cách vật tư');
    return mapInventoryFromDb(row);
  }

  async function addProfilesBulk(names) {
    var list = Array.isArray(names) ? names : [];
    var rows = list
      .map(function (n) { return String(n || '').trim(); })
      .filter(Boolean)
      .map(function (clean) {
        var r = {
          profile_name: clean,
          category: classifyProfile(clean),
          standard_length: 6000,
          standard_length_mm: 6000,
          stock_qty: 0,
          weight_per_m: estimateSteelWeightPerM(clean),
          is_default: DEFAULT_PROFILES.indexOf(clean) !== -1
        };
        return _inventoryEnhancedReady ? r : _stripEnhancedInventoryCols(r);
      });
    if (!rows.length) return [];
    var client = getClient();
    var res = await client
      .from('inventory')
      .upsert(rows, { onConflict: 'profile_name', ignoreDuplicates: true })
      .select();
    if (res && res.error && _isMissingColumnError(res.error, /standard_length_mm|weight_per_m/i)) {
      _inventoryEnhancedReady = false;
      res = await client
        .from('inventory')
        .upsert(rows.map(_stripEnhancedInventoryCols), { onConflict: 'profile_name', ignoreDuplicates: true })
        .select();
    }
    var saved = throwIfError(res, 'Không thêm được danh sách quy cách') || [];
    return saved.map(mapInventoryFromDb);
  }

  async function deleteProfile(profileName) {
    var client = getClient();
    var res = await client.from('inventory').delete().eq('profile_name', String(profileName || '').trim());
    throwIfError(res, 'Không xóa được quy cách hộp');
    return true;
  }

  async function checkInventoryUsage(inventoryId) {
    var client = getClient();
    var res = await client.rpc('check_inventory_usage', { p_inventory_id: inventoryId });
    if (res && res.error && /Could not find the function|does not exist/i.test(res.error.message || '')) {
      var cur = await client.from('inventory').select('id, profile_name, stock_qty, unit').eq('id', inventoryId).maybeSingle();
      var row = (cur && cur.data) || {};
      var sq = Math.max(0, Number(row.stock_qty) || 0);
      return {
        id: inventoryId,
        profile_name: row.profile_name || '',
        stock_qty: sq,
        is_active: true,
        unit: row.unit || 'cây',
        approved_voucher_items: 0,
        pending_voucher_items: 0,
        tx_count: 0,
        non_zero_opening_tx_count: 0,
        project_request_count: 0,
        offcut_count: 0,
        can_hard_delete: sq === 0,
        preSqlFallback: true
      };
    }
    return throwIfError(res, 'Không kiểm tra được lịch sử quy cách');
  }

  async function safeDeleteInventoryItem(inventoryId, mode, forceClearLogs) {
    var client = getClient();
    var m = String(mode || 'archive').trim().toLowerCase();
    var res = await client.rpc('safe_delete_inventory_item', {
      p_inventory_id: inventoryId,
      p_mode: m,
      p_force_clear_logs: Boolean(forceClearLogs)
    });
    if (res && res.error && /Could not find the function|does not exist/i.test(res.error.message || '')) {
      if (m === 'hard') {
        var delRes = await client.from('inventory').delete().eq('id', inventoryId);
        throwIfError(delRes, 'Không xóa được quy cách vật tư');
        return { ok: true, mode: 'hard', id: inventoryId, preSqlFallback: true };
      }
      throw new Error('Vui lòng chạy SQL Migration Đợt 9 (supabase_migration_dot9_inventory_smart.sql) để dùng tính năng Ẩn/Khôi phục quy cách!');
    }
    return throwIfError(res, 'Không thực hiện được thao tác xóa/ẩn quy cách');
  }

  async function mergeInventoryItems(sourceId, targetId) {
    var client = getClient();
    var res = await client.rpc('merge_inventory_items', {
      p_source_id: sourceId,
      p_target_id: targetId
    });
    return throwIfError(res, 'Không gộp được quy cách vật tư');
  }

  async function _ensureInventoryProfileRow(profileName, defaultLenMm) {
    var clean = String(profileName || '').trim();
    if (!clean) throw new Error('Thiếu tên quy cách vật tư');
    var client = getClient();
    var curRes = await client.from('inventory').select('*').eq('profile_name', clean).maybeSingle();
    var existing = throwIfError(curRes, 'Không đọc được thông tin tồn kho quy cách');
    if (existing) return mapInventoryFromDb(existing);
    return addProfile(clean, {
      standardLengthMm: defaultLenMm || 6000,
      stockQty: 0
    });
  }

  async function saveOpeningBalanceBars(items, createdBy) {
    var list = Array.isArray(items) ? items : [];
    var cleanItems = list
      .map(function (it) {
        var name = String((it && (it.profileName || it.profile)) || '').trim();
        if (!name) return null;
        var stdLen = Math.max(1, Number(it.standardLengthMm != null ? it.standardLengthMm : (it.standardLength || 6000)) || 6000);
        var uPrice = Math.max(0, Number(it.unitPrice) || 0);
        return {
          profileName: name,
          materialGroup: String(it.materialGroup || 'tube_1d').trim() || 'tube_1d',
          sku: String(it.sku || '').trim() || null,
          unit: String(it.unit || 'cây').trim() || 'cây',
          specJson: (it.specJson && typeof it.specJson === 'object') ? it.specJson : {},
          stockQty: Math.max(0, Number(it.stockQty != null ? it.stockQty : it.qty) || 0),
          standardLengthMm: stdLen,
          minStockQty: Math.max(0, Math.round(Number(it.minStockQty) || 0)),
          weightPerM: it.weightPerM != null ? Math.max(0, Number(it.weightPerM) || 0) : estimateSteelWeightPerM(name),
          unitPrice: uPrice,
          avgCost: it.avgCost !== undefined ? Math.max(0, Number(it.avgCost) || 0) : uPrice,
          rackLocation: String(it.rackLocation || '').trim(),
          notes: String(it.notes || '')
        };
      })
      .filter(Boolean);
    if (!cleanItems.length) return { savedRows: [], txCount: 0, ledgerSkipped: false };

    var existingList = await getInventory({ includeInactive: true });
    var existingMap = {};
    existingList.forEach(function (r) { existingMap[r.profileName] = r; });

    var client = getClient();
    var payloads = cleanItems.map(function (it) {
      var prev = existingMap[it.profileName];
      var obj = {
        profile_name: it.profileName,
        category: classifyProfile(it.profileName),
        material_group: it.materialGroup || (prev ? prev.materialGroup : 'tube_1d'),
        sku: it.sku !== null ? it.sku : (prev && prev.sku ? prev.sku : null),
        unit: it.unit || (prev ? prev.unit : 'cây'),
        sub_category: it.subCategory || (prev && prev.subCategory ? prev.subCategory : null),
        brand: it.brand || (prev && prev.brand ? prev.brand : null),
        spec_json: (it.specJson && Object.keys(it.specJson).length) ? it.specJson : (prev ? (prev.specJson || {}) : {}),
        standard_length: it.standardLengthMm,
        standard_length_mm: it.standardLengthMm,
        stock_qty: it.stockQty,
        min_stock_qty: it.minStockQty,
        weight_per_m: it.weightPerM > 0 ? it.weightPerM : (prev ? prev.weightPerM : estimateSteelWeightPerM(it.profileName)),
        unit_price: it.unitPrice > 0 ? it.unitPrice : (prev ? prev.unitPrice : 0),
        avg_cost: it.avgCost > 0 ? it.avgCost : (prev ? prev.avgCost : 0),
        rack_location: it.rackLocation,
        notes: it.notes || (prev ? prev.notes : ''),
        is_default: prev ? Boolean(prev.isDefault) : (DEFAULT_PROFILES.indexOf(it.profileName) !== -1),
        is_active: true,
        updated_at: new Date().toISOString()
      };
      return _sanitizeInvPayload(obj);
    });

    var res = await client
      .from('inventory')
      .upsert(payloads, { onConflict: 'profile_name' })
      .select();
    if (res && res.error && _isMissingColumnError(res.error, /is_active/i)) {
      res = await client
        .from('inventory')
        .upsert(payloads.map(_stripActiveInventoryCol), { onConflict: 'profile_name' })
        .select();
    }
    if (res && res.error && _isMissingColumnError(res.error, /sub_category|brand|pack_unit|pack_qty|is_returnable/i)) {
      res = await client
        .from('inventory')
        .upsert(payloads.map(function (p) { return _stripToolingInventoryCols(_sanitizeInvPayload(p)); }), { onConflict: 'profile_name' })
        .select();
    }
    if (res && res.error && _isMissingColumnError(res.error, /material_group|sku|unit|spec_json|avg_cost/i)) {
      _inventoryWmsReady = false;
      res = await client
        .from('inventory')
        .upsert(payloads.map(_sanitizeInvPayload), { onConflict: 'profile_name' })
        .select();
    }
    if (res && res.error && _isMissingColumnError(res.error, /standard_length_mm|min_stock_qty|weight_per_m|unit_price|rack_location/i)) {
      _inventoryEnhancedReady = false;
      res = await client
        .from('inventory')
        .upsert(payloads.map(_stripEnhancedInventoryCols), { onConflict: 'profile_name' })
        .select();
    }
    var saved = throwIfError(res, 'Không lưu được tồn kho đầu kỳ cây nguyên') || [];

    var txCount = 0;
    var ledgerSkipped = false;
    var actor = String(createdBy || '').trim();
    for (var i = 0; i < cleanItems.length; i++) {
      var item = cleanItems[i];
      var prevRow = existingMap[item.profileName];
      var prevQty = prevRow ? Math.max(0, Number(prevRow.stockQty) || 0) : 0;
      var delta = item.stockQty - prevQty;
      if (delta === 0) continue;
      var txNote = 'Nhập tồn đầu kỳ (Phôi cũ)' + (item.rackLocation ? (' · ' + item.rackLocation) : '');
      var txRes = await addInventoryTransaction({
        txType: 'opening_balance',
        profile: item.profileName,
        lengthMm: item.standardLengthMm,
        qtyChange: delta,
        balanceAfter: item.stockQty,
        projectId: null,
        note: txNote,
        createdBy: actor
      });
      if (txRes && txRes.skipped) ledgerSkipped = true;
      else if (txRes) txCount++;
    }

    return {
      savedRows: saved.map(mapInventoryFromDb),
      txCount: txCount,
      ledgerSkipped: ledgerSkipped
    };
  }

  async function purchaseInInventory(opts) {
    var o = opts || {};
    var profile = String(o.profile || o.profileName || '').trim();
    var qty = Math.round(Number(o.qty));
    if (!profile) throw new Error('Vui lòng chọn quy cách thép nhập kho!');
    if (!(qty > 0)) throw new Error('Số cây nhập mua mới phải lớn hơn 0!');

    var cur = await _ensureInventoryProfileRow(profile, o.lengthMm || 6000);
    var prevQty = Math.max(0, Number(cur.stockQty) || 0);
    var nextQty = prevQty + qty;
    var lengthMm = Math.max(100, Number(o.lengthMm || cur.standardLengthMm || 6000) || 6000);
    var updated = await updateInventoryProfile(profile, { stockQty: nextQty });

    var txRes = await addInventoryTransaction({
      txType: 'purchase_in',
      profile: profile,
      lengthMm: lengthMm,
      qtyChange: qty,
      balanceAfter: nextQty,
      projectId: null,
      note: String(o.note || '').trim() || 'Nhập mua mới từ nhà cung cấp',
      createdBy: String(o.createdBy || '').trim()
    });
    return {
      item: updated,
      transaction: txRes && !txRes.skipped ? txRes : null,
      ledgerSkipped: Boolean(txRes && txRes.skipped)
    };
  }

  async function stocktakeAdjustInventory(opts) {
    var o = opts || {};
    var profile = String(o.profile || o.profileName || '').trim();
    var rawActual = o.actualQty != null ? o.actualQty : o.actual_qty;
    var actualQty = Math.round(Number(rawActual));
    var reason = String(o.reason || o.note || '').trim();
    if (!profile) throw new Error('Vui lòng chọn quy cách kiểm kê!');
    if (rawActual === '' || rawActual === null || rawActual === undefined || isNaN(actualQty) || actualQty < 0) {
      throw new Error('Số lượng thực tế đếm được phải >= 0!');
    }
    if (!reason) {
      throw new Error('Vui lòng nhập lý do kiểm kê / điều chỉnh kho!');
    }

    var cur = await _ensureInventoryProfileRow(profile, 6000);
    var prevQty = Math.max(0, Number(cur.stockQty) || 0);
    var delta = actualQty - prevQty;
    var updated = await updateInventoryProfile(profile, { stockQty: actualQty });

    var txRes = await addInventoryTransaction({
      txType: 'stocktake_adjust',
      profile: profile,
      lengthMm: cur.standardLengthMm || 6000,
      qtyChange: delta,
      balanceAfter: actualQty,
      projectId: null,
      note: reason,
      createdBy: String(o.createdBy || '').trim()
    });
    return {
      item: updated,
      delta: delta,
      prevQty: prevQty,
      transaction: txRes && !txRes.skipped ? txRes : null,
      ledgerSkipped: Boolean(txRes && txRes.skipped)
    };
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
  // CRUD: STOCK OFFCUTS (KHO PHÔI LẺ & ĐỀ-XÊ TÁI SỬ DỤNG - ĐỢT 3 & ĐỢT 4)
  // =========================================================================
  function _isMissingOffcutsTableError(err) {
    return _isMissingTableError(err, 'stock_offcuts');
  }

  function isOffcutsTableReady() {
    return _offcutsTableReady;
  }

  function _stripEnhancedOffcutCols(obj) {
    var copy = Object.assign({}, obj);
    delete copy.source_type;
    delete copy.rack_location;
    delete copy.status;
    delete copy.note;
    return copy;
  }

  async function getStockOffcuts(opts) {
    var options = opts || {};
    var client = getClient();
    var query = client
      .from('stock_offcuts')
      .select('*')
      .order('created_at', { ascending: false });
    if (options.onlyAvailable) {
      query = query.gt('quantity', 0);
    }
    if (options.profile) {
      query = query.eq('profile', String(options.profile).trim());
    }
    var res = await query;
    if (res && res.error && _isMissingOffcutsTableError(res.error)) {
      _offcutsTableReady = false;
      return [];
    }
    _offcutsTableReady = true;
    var rows = throwIfError(res, 'Không tải được kho phôi đề-xê') || [];
    var mapped = rows.map(mapOffcutFromDb);
    if (options.onlyAvailable) {
      mapped = mapped.filter(function (o) {
        return o.quantity > 0 && (!o.status || o.status === 'available');
      });
    }
    if (options.status && options.status !== 'ALL') {
      mapped = mapped.filter(function (o) { return o.status === options.status; });
    }
    if (options.sourceType && options.sourceType !== 'ALL') {
      mapped = mapped.filter(function (o) { return o.sourceType === options.sourceType; });
    }
    return mapped;
  }

  async function addStockOffcut(payload) {
    var p = payload || {};
    var profile = String(p.profile || '').trim();
    var rawLen = p.lengthMm != null ? p.lengthMm : p.length_mm;
    var lengthMm = Math.round(Number(rawLen) * 100) / 100;
    var quantity = Math.max(1, parseInt(p.quantity != null ? p.quantity : 1, 10) || 1);
    var srcProjId = p.sourceProjectId || p.source_project_id || null;
    var srcBarKey = String(p.sourceBarKey || p.source_bar_key || '');
    var noteStr = String(p.note != null ? p.note : (p.notes || '')).trim();
    var srcType = p.sourceType || p.source_type || (srcBarKey ? 'cnc_return' : 'manual');
    var rackLoc = String(p.rackLocation || p.rack_location || '').trim();
    var statusVal = p.status || 'available';
    var createdBy = String(p.createdBy || p.created_by || '').trim();

    if (!profile) throw new Error('Thiếu quy cách hộp/ống cho phôi đề-xê');
    if (!(lengthMm > 0)) throw new Error('Chiều dài phôi đề-xê phải lớn hơn 0 mm');

    var client = getClient();
    var row = {
      profile: profile,
      length_mm: lengthMm,
      quantity: quantity,
      source_project_id: srcProjId,
      source_project_name: String(p.sourceProjectName || p.source_project_name || ''),
      source_bar_key: srcBarKey,
      source_type: srcType,
      rack_location: rackLoc,
      status: statusVal,
      note: noteStr,
      notes: noteStr,
      created_by: createdBy
    };
    if (!_inventoryEnhancedReady) {
      row = _stripEnhancedOffcutCols(row);
    }

    var res = await client
      .from('stock_offcuts')
      .insert(row)
      .select()
      .single();

    if (res && res.error && _isMissingColumnError(res.error, /source_type|rack_location|status|note/i)) {
      _inventoryEnhancedReady = false;
      res = await client
        .from('stock_offcuts')
        .insert(_stripEnhancedOffcutCols(row))
        .select()
        .single();
    }

    if (res && res.error) {
      if (_isMissingOffcutsTableError(res.error)) {
        _offcutsTableReady = false;
        var tblErr = new Error('Bảng public.stock_offcuts chưa được tạo trên Supabase. Vui lòng chạy file supabase_migration_dot3_offcuts_ux.sql trong SQL Editor!');
        tblErr.code = res.error.code;
        throw tblErr;
      }
      if (res.error.code === '23505') {
        var dupErr = new Error('Đoạn đề-xê của cây này đã được nhập kho trước đó!');
        dupErr.code = '23505';
        throw dupErr;
      }
    }

    _offcutsTableReady = true;
    var saved = throwIfError(res, 'Không nhập được kho đề-xê');
    var mapped = mapOffcutFromDb(saved);

    if (p.logTx !== false) {
      var txType = p.txType || (srcType === 'opening_stock' ? 'opening_balance' : 'offcut_in');
      var txNote = noteStr || (
        srcType === 'opening_stock'
          ? 'Tồn đầu kỳ phôi lẻ'
          : (srcBarKey ? ('Nhập đề-xê từ CNC (' + srcBarKey.replace('__', ' - ') + ')') : 'Nhập phôi lẻ vào kho')
      );
      if (rackLoc && txNote.indexOf(rackLoc) === -1) txNote += ' · ' + rackLoc;
      try {
        await addInventoryTransaction({
          txType: txType,
          profile: profile,
          lengthMm: lengthMm,
          qtyChange: quantity,
          balanceAfter: quantity,
          projectId: (srcProjId && srcProjId !== DRAFT_PROJECT_ID) ? srcProjId : null,
          note: txNote,
          createdBy: createdBy
        });
      } catch (e) {
        console.warn('[Stock Ledger] Bỏ qua ghi sổ cái khi nhập offcut:', e);
      }
    }

    return mapped;
  }

  async function saveOpeningBalanceOffcuts(items, createdBy) {
    var list = Array.isArray(items) ? items : [];
    var cleanItems = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var prof = String(it.profile || it.profileName || '').trim();
      var len = Math.round(Number(it.lengthMm != null ? it.lengthMm : it.length) * 100) / 100;
      var qty = Math.max(1, parseInt(it.quantity != null ? it.quantity : it.qty, 10) || 1);
      if (!prof || !(len > 0)) continue;
      cleanItems.push({
        profile: prof,
        lengthMm: len,
        quantity: qty,
        rackLocation: String(it.rackLocation || '').trim(),
        note: String(it.note || it.notes || '').trim() || 'Phôi lẻ tồn đầu kỳ'
      });
    }
    if (!cleanItems.length) {
      throw new Error('Không có dòng phôi lẻ hợp lệ nào để lưu (cần có Quy cách và Chiều dài > 0 mm)!');
    }

    // Đảm bảo quy cách mới xuất hiện trong bảng phôi lẻ cũng có trong Thư viện quy cách
    var uniqProfiles = [];
    cleanItems.forEach(function (it) {
      if (uniqProfiles.indexOf(it.profile) === -1) uniqProfiles.push(it.profile);
    });
    try {
      await addProfilesBulk(uniqProfiles);
    } catch (e) {}

    var actor = String(createdBy || '').trim();
    var savedItems = [];
    for (var j = 0; j < cleanItems.length; j++) {
      var row = cleanItems[j];
      var created = await addStockOffcut({
        profile: row.profile,
        lengthMm: row.lengthMm,
        quantity: row.quantity,
        rackLocation: row.rackLocation,
        sourceType: 'opening_stock',
        status: 'available',
        note: row.note,
        notes: row.note,
        createdBy: actor,
        txType: 'opening_balance',
        logTx: true
      });
      savedItems.push(created);
    }
    return {
      savedItems: savedItems,
      count: savedItems.length,
      ledgerSkipped: !_ledgerTableReady
    };
  }

  async function updateStockOffcut(id, patch) {
    if (!id || !patch) return null;
    if (patch.deleteIfZero && patch.quantity !== undefined && Number(patch.quantity) <= 0) {
      await deleteStockOffcut(id);
      return { deleted: true, id: id };
    }
    var client = getClient();
    var updateObj = { updated_at: new Date().toISOString() };
    if (patch.profile !== undefined) updateObj.profile = String(patch.profile || '').trim();
    if (patch.lengthMm !== undefined || patch.length_mm !== undefined) {
      var len = Math.round(Number(patch.lengthMm !== undefined ? patch.lengthMm : patch.length_mm) * 100) / 100;
      if (!(len > 0)) throw new Error('Chiều dài phôi đề-xê phải lớn hơn 0 mm');
      updateObj.length_mm = len;
    }
    if (patch.quantity !== undefined) {
      var qVal = Math.max(0, parseInt(patch.quantity, 10) || 0);
      updateObj.quantity = qVal;
      if (patch.status === undefined) {
        updateObj.status = qVal > 0 ? 'available' : 'used';
      }
    }
    if (patch.status !== undefined) updateObj.status = String(patch.status);
    if (patch.sourceType !== undefined) updateObj.source_type = String(patch.sourceType);
    if (patch.rackLocation !== undefined) updateObj.rack_location = String(patch.rackLocation || '').trim();
    if (patch.note !== undefined || patch.notes !== undefined) {
      var nStr = String(patch.note !== undefined ? patch.note : patch.notes || '');
      updateObj.note = nStr;
      updateObj.notes = nStr;
    }

    var execObj = _inventoryEnhancedReady ? updateObj : _stripEnhancedOffcutCols(updateObj);
    var res = await client
      .from('stock_offcuts')
      .update(execObj)
      .eq('id', id)
      .select()
      .single();
    if (res && res.error && _isMissingColumnError(res.error, /source_type|rack_location|status|note/i)) {
      _inventoryEnhancedReady = false;
      res = await client
        .from('stock_offcuts')
        .update(_stripEnhancedOffcutCols(updateObj))
        .eq('id', id)
        .select()
        .single();
    }
    var updated = throwIfError(res, 'Không cập nhật được phôi đề-xê');
    return mapOffcutFromDb(updated);
  }

  async function deleteStockOffcut(id) {
    if (!id) return false;
    var client = getClient();
    var res = await client.from('stock_offcuts').delete().eq('id', id);
    throwIfError(res, 'Không xóa được phôi đề-xê');
    return true;
  }

  async function consumeStockOffcuts(items, meta) {
    var list = Array.isArray(items) ? items : [];
    var metaObj = meta || {};
    var merged = {};
    list.forEach(function (it) {
      if (!it || !it.id) return;
      var q = Math.max(0, Math.round(Number(it.usedQty != null ? it.usedQty : it.qty) || 0));
      if (q > 0) {
        merged[it.id] = (merged[it.id] || 0) + q;
      }
    });
    var ids = Object.keys(merged);
    if (!ids.length) return { updatedCount: 0, deletedCount: 0, details: [] };

    var client = getClient();
    var updatedCount = 0;
    var deletedCount = 0;
    var details = [];

    for (var i = 0; i < ids.length; i++) {
      var offId = ids[i];
      var usedQty = merged[offId];
      var curRes = await client
        .from('stock_offcuts')
        .select('*')
        .eq('id', offId)
        .maybeSingle();
      var curRow = throwIfError(curRes, 'Không đọc được số lượng phôi đề-xê hiện tại');
      if (!curRow) continue;
      var cur = mapOffcutFromDb(curRow);

      var actualUsed = Math.min(usedQty, Math.max(0, cur.quantity));
      if (actualUsed <= 0) continue;
      var remaining = Math.max(0, cur.quantity - actualUsed);
      var action = 'updated';

      if (remaining <= 0) {
        if (_inventoryEnhancedReady) {
          await updateStockOffcut(offId, { quantity: 0, status: 'used' });
          action = 'marked_used';
          updatedCount++;
        } else {
          await deleteStockOffcut(offId);
          action = 'deleted';
          deletedCount++;
        }
      } else {
        await updateStockOffcut(offId, { quantity: remaining, status: 'available' });
        updatedCount++;
      }

      details.push({
        id: offId,
        profile: cur.profile,
        lengthMm: cur.lengthMm,
        rackLocation: cur.rackLocation || '',
        sourceType: cur.sourceType || 'manual',
        usedQty: actualUsed,
        remaining: remaining,
        action: action
      });

      var pId = (metaObj.projectId && metaObj.projectId !== DRAFT_PROJECT_ID) ? metaObj.projectId : null;
      var txNote = metaObj.note || ('Xuất phôi lẻ/đề-xê cho dự án ' + (metaObj.projectName || pId || ''));
      try {
        await addInventoryTransaction({
          txType: 'offcut_out',
          profile: cur.profile,
          lengthMm: cur.lengthMm,
          qtyChange: -actualUsed,
          balanceAfter: remaining,
          projectId: pId,
          note: txNote.trim(),
          createdBy: String(metaObj.createdBy || '').trim()
        });
      } catch (e) {}
    }
    return { updatedCount: updatedCount, deletedCount: deletedCount, details: details };
  }

  // =========================================================================
  // SỔ CÁI XUẤT - NHẬP KHO (INVENTORY TRANSACTIONS) & XUẤT/HOÀN KHO DỰ ÁN
  // =========================================================================
  function _isMissingLedgerTableError(err) {
    return _isMissingTableError(err, 'inventory_transactions');
  }

  async function getInventoryTransactions(filters) {
    var f = filters || {};
    var client = getClient();
    var query = client
      .from('inventory_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(2000, Number(f.limit) || 500)));

    if (f.txType && f.txType !== 'ALL') {
      query = query.eq('tx_type', String(f.txType));
    }
    if (f.profile && f.profile !== 'ALL') {
      query = query.eq('profile', String(f.profile));
    }
    if (f.projectId) {
      query = query.eq('project_id', String(f.projectId));
    }
    if (f.fromDate) {
      query = query.gte('created_at', String(f.fromDate).trim() + 'T00:00:00');
    }
    if (f.toDate) {
      query = query.lte('created_at', String(f.toDate).trim() + 'T23:59:59.999');
    }

    var res = await query;
    if (res && res.error && _isMissingLedgerTableError(res.error)) {
      _ledgerTableReady = false;
      return [];
    }
    _ledgerTableReady = true;
    var rows = throwIfError(res, 'Không tải được sổ cái giao dịch kho') || [];
    return rows.map(mapInventoryTxFromDb);
  }

  async function addInventoryTransaction(tx) {
    var t = tx || {};
    var profile = String(t.profile || '').trim();
    if (!profile) throw new Error('Thiếu tên quy cách khi ghi sổ cái kho');
    var pId = (t.projectId && t.projectId !== DRAFT_PROJECT_ID) ? String(t.projectId) : null;
    var row = {
      tx_type: String(t.txType || 'stocktake_adjust'),
      profile: profile,
      length_mm: Math.max(1, Number(t.lengthMm) || 6000),
      qty_change: Math.round(Number(t.qtyChange) || 0),
      balance_after: t.balanceAfter != null ? Math.round(Number(t.balanceAfter)) : null,
      project_id: pId,
      note: String(t.note || '').trim(),
      created_by: String(t.createdBy || '').trim()
    };

    var client = getClient();
    var res = await client
      .from('inventory_transactions')
      .insert(row)
      .select()
      .single();
    if (res && res.error && _isMissingLedgerTableError(res.error)) {
      _ledgerTableReady = false;
      return { skipped: true, reason: 'LEDGER_TABLE_NOT_READY' };
    }
    _ledgerTableReady = true;
    var saved = throwIfError(res, 'Không ghi được dòng sổ cái kho');
    return mapInventoryTxFromDb(saved);
  }

  async function checkProjectDispatchStatus(projectId) {
    if (!projectId || projectId === DRAFT_PROJECT_ID) {
      return { isDispatched: false, lastOutAt: null, ledgerChecked: false };
    }
    var client = getClient();
    var res = await client
      .from('inventory_transactions')
      .select('id, tx_type, qty_change, created_at')
      .eq('project_id', String(projectId))
      .in('tx_type', ['project_out', 'offcut_out', 'project_return'])
      .order('created_at', { ascending: true });
    if (res && res.error && _isMissingLedgerTableError(res.error)) {
      _ledgerTableReady = false;
      return { isDispatched: false, lastOutAt: null, ledgerChecked: false };
    }
    _ledgerTableReady = true;
    var rows = throwIfError(res, 'Không kiểm tra được trạng thái xuất kho dự án') || [];
    var lastOutAt = null;
    var lastOutMs = 0;
    var lastReturnMs = 0;
    rows.forEach(function (r) {
      var ms = r.created_at ? Date.parse(r.created_at) || 0 : 0;
      if (r.tx_type === 'project_out' || r.tx_type === 'offcut_out') {
        if (ms >= lastOutMs) {
          lastOutMs = ms;
          lastOutAt = r.created_at;
        }
      } else if (r.tx_type === 'project_return') {
        if (ms >= lastReturnMs) lastReturnMs = ms;
      }
    });
    return {
      isDispatched: lastOutMs > 0 && lastOutMs > lastReturnMs,
      lastOutAt: lastOutAt,
      ledgerChecked: true
    };
  }

  async function dispatchProjectInventory(opts) {
    var o = opts || {};
    var projectId = String(o.projectId || '').trim();
    var projectName = String(o.projectName || projectId).trim();
    var actor = String(o.createdBy || '').trim();
    if (!projectId || projectId === DRAFT_PROJECT_ID) {
      var errDraft = new Error('Vui lòng lưu dự án thành đơn chính thức trước khi Xuất kho để chống trừ kho trùng lặp!');
      errDraft.code = 'UNSAVED_PROJECT';
      throw errDraft;
    }

    if (o.projectDeductedAt) {
      var errDupFlag = new Error('Dự án này đã được xuất kho trước đó (' + o.projectDeductedAt + '). Để xuất lại, vui lòng bấm "↩️ Hoàn kho" trước!');
      errDupFlag.code = 'ALREADY_DISPATCHED';
      throw errDupFlag;
    }

    var dbStatus = await checkProjectDispatchStatus(projectId);
    if (dbStatus.isDispatched) {
      var errDupDb = new Error('Sổ cái xác nhận dự án "' + projectName + '" đã xuất kho trước đó. Hệ thống chặn trừ lần 2 để tránh sai số!');
      errDupDb.code = 'ALREADY_DISPATCHED';
      throw errDupDb;
    }

    var reqBars = Array.isArray(o.fullBarsByProfile) ? o.fullBarsByProfile : [];
    var reqOffcuts = Array.isArray(o.offcutsUsed) ? o.offcutsUsed : [];
    var invList = await getInventory();
    var invByProf = {};
    invList.forEach(function (r) { invByProf[r.profileName] = r; });

    var fullBarsDone = [];
    var shortages = [];
    var totalFullDeducted = 0;
    var ledgerSkipped = false;

    for (var i = 0; i < reqBars.length; i++) {
      var req = reqBars[i] || {};
      var prof = String(req.profile || '').trim();
      var reqQty = Math.max(0, Math.round(Number(req.qty) || 0));
      if (!prof || reqQty <= 0) continue;

      var invRow = invByProf[prof];
      var available = invRow ? Math.max(0, Number(invRow.stockQty) || 0) : 0;
      var deductQty = Math.min(reqQty, available);
      var stdLen = (invRow && invRow.standardLengthMm) || Number(req.lengthMm) || 6000;

      if (reqQty > available) {
        shortages.push({ profile: prof, requested: reqQty, available: available, missing: reqQty - available });
      }
      if (deductQty <= 0) continue;

      var nextQty = available - deductQty;
      await updateInventoryProfile(prof, { stockQty: nextQty });
      totalFullDeducted += deductQty;
      fullBarsDone.push({ profile: prof, deductedQty: deductQty, lengthMm: stdLen });

      var txRes = await addInventoryTransaction({
        txType: 'project_out',
        profile: prof,
        lengthMm: stdLen,
        qtyChange: -deductQty,
        balanceAfter: nextQty,
        projectId: projectId,
        note: 'Xuất kho cho dự án: ' + projectName,
        createdBy: actor
      });
      if (txRes && txRes.skipped) ledgerSkipped = true;
    }

    var offcutResult = { details: [] };
    if (reqOffcuts.length > 0) {
      offcutResult = await consumeStockOffcuts(reqOffcuts, {
        projectId: projectId,
        projectName: projectName,
        createdBy: actor,
        note: 'Xuất phôi lẻ/đề-xê cho dự án: ' + projectName
      });
    }
    var offcutsDone = offcutResult.details || [];
    var totalOffcutsDeducted = offcutsDone.reduce(function (a, b) { return a + (Number(b.usedQty) || 0); }, 0);

    if (totalFullDeducted === 0 && totalOffcutsDeducted === 0) {
      var errEmpty = new Error('Không thể xuất kho: trong kho hiện có 0 cây nguyên và 0 phôi lẻ khả dụng cho các quy cách của dự án này. Hãy nhập tồn kho trước hoặc mua mới!');
      errEmpty.code = 'NO_STOCK_TO_DEDUCT';
      throw errEmpty;
    }

    return {
      deductedAt: new Date().toISOString(),
      deductedBy: actor,
      fullBars: fullBarsDone,
      offcuts: offcutsDone,
      shortages: shortages,
      totalFullDeducted: totalFullDeducted,
      totalOffcutsDeducted: totalOffcutsDeducted,
      ledgerSkipped: ledgerSkipped || !_ledgerTableReady
    };
  }

  async function returnProjectInventory(opts) {
    var o = opts || {};
    var projectId = String(o.projectId || '').trim();
    var projectName = String(o.projectName || projectId).trim();
    var snap = o.snapshot || {};
    var actor = String(o.createdBy || '').trim();
    if (!projectId || projectId === DRAFT_PROJECT_ID) {
      throw new Error('Thiếu mã dự án hợp lệ để hoàn kho!');
    }

    var fullBars = Array.isArray(snap.fullBars) ? snap.fullBars : [];
    var offcuts = Array.isArray(snap.offcuts) ? snap.offcuts : [];
    var totalFullReturned = 0;
    var totalOffcutsReturned = 0;
    var ledgerSkipped = false;

    for (var i = 0; i < fullBars.length; i++) {
      var fb = fullBars[i] || {};
      var prof = String(fb.profile || '').trim();
      var retQty = Math.max(0, Math.round(Number(fb.deductedQty) || 0));
      if (!prof || retQty <= 0) continue;

      var cur = await _ensureInventoryProfileRow(prof, fb.lengthMm || 6000);
      var prevQty = Math.max(0, Number(cur.stockQty) || 0);
      var nextQty = prevQty + retQty;
      await updateInventoryProfile(prof, { stockQty: nextQty });
      totalFullReturned += retQty;

      var txRes = await addInventoryTransaction({
        txType: 'project_return',
        profile: prof,
        lengthMm: fb.lengthMm || cur.standardLengthMm || 6000,
        qtyChange: retQty,
        balanceAfter: nextQty,
        projectId: projectId,
        note: 'Hoàn kho từ dự án: ' + projectName,
        createdBy: actor
      });
      if (txRes && txRes.skipped) ledgerSkipped = true;
    }

    var client = getClient();
    for (var j = 0; j < offcuts.length; j++) {
      var oc = offcuts[j] || {};
      var usedQty = Math.max(0, Math.round(Number(oc.usedQty) || 0));
      if (!oc.profile || usedQty <= 0) continue;

      var restoredQty = usedQty;
      var existingRow = null;
      if (oc.id) {
        try {
          var checkRes = await client.from('stock_offcuts').select('*').eq('id', oc.id).maybeSingle();
          if (checkRes && !checkRes.error && checkRes.data) existingRow = mapOffcutFromDb(checkRes.data);
        } catch (e) {}
      }

      if (existingRow) {
        restoredQty = Math.max(0, Number(existingRow.quantity) || 0) + usedQty;
        await updateStockOffcut(oc.id, { quantity: restoredQty, status: 'available' });
      } else {
        await addStockOffcut({
          profile: oc.profile,
          lengthMm: oc.lengthMm,
          quantity: usedQty,
          rackLocation: oc.rackLocation || '',
          sourceType: oc.sourceType || 'manual',
          status: 'available',
          note: 'Hoàn kho từ dự án: ' + projectName,
          createdBy: actor,
          logTx: false
        });
      }
      totalOffcutsReturned += usedQty;

      var txOffRes = await addInventoryTransaction({
        txType: 'project_return',
        profile: oc.profile,
        lengthMm: oc.lengthMm || 1000,
        qtyChange: usedQty,
        balanceAfter: restoredQty,
        projectId: projectId,
        note: 'Hoàn kho phôi lẻ từ dự án: ' + projectName,
        createdBy: actor
      });
      if (txOffRes && txOffRes.skipped) ledgerSkipped = true;
    }

    return {
      returnedAt: new Date().toISOString(),
      totalFullReturned: totalFullReturned,
      totalOffcutsReturned: totalOffcutsReturned,
      ledgerSkipped: ledgerSkipped || !_ledgerTableReady
    };
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
  // WMS ĐỢT 5: NHÀ CUNG CẤP, CHỨNG TỪ KHO & DUYỆT / HỦY NGUYÊN TỬ (RPC)
  // =========================================================================
  var VOUCHER_BUCKET = 'voucher-attachments';

  async function getSuppliers() {
    var client = getClient();
    var res = await client.from('suppliers').select('*').order('name', { ascending: true });
    if (res && res.error && _isMissingTableError(res.error, 'suppliers')) {
      _wmsVouchersReady = false;
      return [];
    }
    var rows = throwIfError(res, 'Không tải được danh sách nhà cung cấp') || [];
    _wmsVouchersReady = true;
    return rows.map(mapSupplierFromDb);
  }

  async function saveSupplier(payload) {
    var p = payload || {};
    var cleanName = String(p.name || '').trim();
    if (!cleanName) throw new Error('Tên nhà cung cấp không được để trống');
    var client = getClient();
    var row = {
      code: String(p.code || '').trim() || null,
      name: cleanName,
      phone: String(p.phone || '').trim(),
      email: String(p.email || '').trim(),
      address: String(p.address || '').trim(),
      tax_code: String(p.taxCode || p.tax_code || '').trim(),
      note: String(p.note || '').trim(),
      updated_at: new Date().toISOString()
    };
    var res;
    if (p.id) {
      res = await client.from('suppliers').update(row).eq('id', p.id).select().single();
    } else {
      res = await client.from('suppliers').insert(row).select().single();
    }
    var saved = throwIfError(res, 'Không lưu được thông tin nhà cung cấp');
    return mapSupplierFromDb(saved);
  }

  async function deleteSupplier(id) {
    var client = getClient();
    var res = await client.from('suppliers').delete().eq('id', id);
    throwIfError(res, 'Không xóa được nhà cung cấp');
    return true;
  }

  async function getWarehouseVouchers(filters) {
    var f = filters || {};
    var client = getClient();
    var q = client
      .from('warehouse_vouchers')
      .select('*, supplier:suppliers(id,code,name), project:projects(id,name), warehouse_voucher_items(*)')
      .order('created_at', { ascending: false })
      .limit(Math.min(500, Math.max(10, Number(f.limit) || 200)));

    if (f.voucherType && f.voucherType !== 'ALL') q = q.eq('voucher_type', String(f.voucherType));
    if (f.status && f.status !== 'ALL') q = q.eq('status', String(f.status));
    if (f.projectId && f.projectId !== 'ALL') q = q.eq('project_id', String(f.projectId));
    if (f.supplierId && f.supplierId !== 'ALL') q = q.eq('supplier_id', String(f.supplierId));
    if (f.dateFrom) q = q.gte('created_at', String(f.dateFrom) + 'T00:00:00');
    if (f.dateTo) q = q.lte('created_at', String(f.dateTo) + 'T23:59:59');

    var res = await q;
    if (res && res.error && _isMissingTableError(res.error, 'warehouse_vouchers')) {
      _wmsVouchersReady = false;
      return [];
    }
    var rows = throwIfError(res, 'Không tải được danh sách chứng từ kho') || [];
    _wmsVouchersReady = true;
    return rows.map(mapVoucherFromDb);
  }

  async function getWarehouseVoucherById(id) {
    var client = getClient();
    var res = await client
      .from('warehouse_vouchers')
      .select('*, supplier:suppliers(id,code,name), project:projects(id,name), warehouse_voucher_items(*)')
      .eq('id', id)
      .single();
    var row = throwIfError(res, 'Không tải được chi tiết phiếu kho');
    return mapVoucherFromDb(row);
  }

  function _normalizeVoucherItemsInput(items) {
    return (Array.isArray(items) ? items : [])
      .map(function (it) {
        var profile = String((it && it.profile) || '').trim();
        var qty = Number(it && it.qty) || 0;
        if (!profile || qty <= 0) return null;
        var price = Math.max(0, Number(it.unitPrice != null ? it.unitPrice : it.unit_price) || 0);
        var rawUnit = String(it.unit || 'cây').trim();
        var normUnit = /^đoạn$/i.test(rawUnit) ? 'cái' : rawUnit.toLowerCase();
        return {
          inventory_id: it.inventoryId || it.inventory_id || null,
          offcut_id: it.offcutId || it.offcut_id || null,
          profile: profile,
          material_group: String(it.materialGroup || it.material_group || 'tube_1d'),
          unit: normUnit || 'cái',
          qty: qty,
          length_mm: (it.lengthMm != null && Number(it.lengthMm) > 0) ? Number(it.lengthMm) : null,
          unit_price: price,
          total_amount: Math.round(qty * price),
          issue_reason: String(it.issueReason || it.issue_reason || 'new'),
          returned_old_qty: Math.max(0, Number(it.returnedOldQty != null ? it.returnedOldQty : it.returned_old_qty) || 0),
          project_request_id: it.projectRequestId || it.project_request_id || null,
          po_item_id: it.poItemId || it.po_item_id || null,
          note: String(it.note || '').trim()
        };
      })
      .filter(Boolean);
  }

  function _stripToolingVoucherCols(obj) {
    var copy = Object.assign({}, obj);
    delete copy.machine_name;
    delete copy.recipient_name;
    delete copy.po_id;
    return copy;
  }

  function _stripToolingVoucherItemCols(obj) {
    var copy = Object.assign({}, obj);
    delete copy.issue_reason;
    delete copy.returned_old_qty;
    delete copy.project_request_id;
    delete copy.po_item_id;
    return copy;
  }

  async function createWarehouseVoucher(payload, items) {
    var p = payload || {};
    var cleanItems = _normalizeVoucherItemsInput(items);
    if (!cleanItems.length) throw new Error('Phiếu phải có ít nhất 1 dòng vật tư với số lượng > 0');

    var client = getClient();
    var headerRow = {
      voucher_code: String(p.voucherCode || '').trim() || '',
      voucher_type: String(p.voucherType || 'IN'),
      status: p.status === 'draft' ? 'draft' : 'pending',
      project_id: p.projectId || null,
      supplier_id: p.supplierId || null,
      po_id: p.poId || null,
      department: String(p.department || '').trim(),
      machine_name: String(p.machineName || '').trim(),
      recipient_name: String(p.recipientName || '').trim(),
      invoice_no: String(p.invoiceNo || '').trim(),
      attachment_url: String(p.attachmentUrl || '').trim(),
      note: String(p.note || '').trim(),
      allow_negative: Boolean(p.allowNegative),
      created_by: String(p.createdBy || '').trim()
    };

    var vRes = await client.from('warehouse_vouchers').insert(headerRow).select().single();
    if (vRes && vRes.error && _isMissingColumnError(vRes.error, /machine_name|recipient_name|po_id/i)) {
      vRes = await client.from('warehouse_vouchers').insert(_stripToolingVoucherCols(headerRow)).select().single();
    }
    if (vRes && vRes.error && _isMissingTableError(vRes.error, 'warehouse_vouchers')) {
      _wmsVouchersReady = false;
      throw new Error('Chưa chạy SQL Đợt 5 (supabase_migration_dot5_wms_vouchers.sql) trên Supabase.');
    }
    var created = throwIfError(vRes, 'Không tạo được phiếu kho');

    var itemsRows = cleanItems.map(function (it) {
      return Object.assign({ voucher_id: created.id }, it);
    });
    var iRes = await client.from('warehouse_voucher_items').insert(itemsRows).select();
    if (iRes && iRes.error && _isMissingColumnError(iRes.error, /issue_reason|returned_old_qty|project_request_id|po_item_id/i)) {
      iRes = await client.from('warehouse_voucher_items').insert(itemsRows.map(_stripToolingVoucherItemCols)).select();
    }
    if (iRes && iRes.error) {
      try { await client.from('warehouse_vouchers').delete().eq('id', created.id); } catch (e) {}
      throwIfError(iRes, 'Không lưu được chi tiết dòng vật tư trên phiếu');
    }

    return getWarehouseVoucherById(created.id);
  }

  async function updateWarehouseVoucher(voucherId, patch, items) {
    var p = patch || {};
    var client = getClient();
    var updateObj = { updated_at: new Date().toISOString() };
    if (p.voucherType !== undefined) updateObj.voucher_type = String(p.voucherType);
    if (p.status !== undefined && (p.status === 'draft' || p.status === 'pending')) updateObj.status = p.status;
    if (p.projectId !== undefined) updateObj.project_id = p.projectId || null;
    if (p.supplierId !== undefined) updateObj.supplier_id = p.supplierId || null;
    if (p.department !== undefined) updateObj.department = String(p.department || '').trim();
    if (p.machineName !== undefined) updateObj.machine_name = String(p.machineName || '').trim();
    if (p.recipientName !== undefined) updateObj.recipient_name = String(p.recipientName || '').trim();
    if (p.invoiceNo !== undefined) updateObj.invoice_no = String(p.invoiceNo || '').trim();
    if (p.attachmentUrl !== undefined) updateObj.attachment_url = String(p.attachmentUrl || '').trim();
    if (p.note !== undefined) updateObj.note = String(p.note || '').trim();
    if (p.allowNegative !== undefined) updateObj.allow_negative = Boolean(p.allowNegative);

    var uRes = await client.from('warehouse_vouchers').update(updateObj).eq('id', voucherId).select().single();
    if (uRes && uRes.error && _isMissingColumnError(uRes.error, /machine_name|recipient_name/i)) {
      uRes = await client.from('warehouse_vouchers').update(_stripToolingVoucherCols(updateObj)).eq('id', voucherId).select().single();
    }
    throwIfError(uRes, 'Không cập nhật được thông tin phiếu kho');

    if (Array.isArray(items)) {
      var cleanItems = _normalizeVoucherItemsInput(items);
      if (!cleanItems.length) throw new Error('Phiếu phải có ít nhất 1 dòng vật tư với số lượng > 0');
      var delRes = await client.from('warehouse_voucher_items').delete().eq('voucher_id', voucherId);
      throwIfError(delRes, 'Không làm mới được dòng vật tư của phiếu');
      var rowsToIns = cleanItems.map(function (it) { return Object.assign({ voucher_id: voucherId }, it); });
      var insRes = await client
        .from('warehouse_voucher_items')
        .insert(rowsToIns);
      if (insRes && insRes.error && _isMissingColumnError(insRes.error, /issue_reason|returned_old_qty/i)) {
        insRes = await client
          .from('warehouse_voucher_items')
          .insert(rowsToIns.map(_stripToolingVoucherItemCols));
      }
      throwIfError(insRes, 'Không lưu được danh sách dòng vật tư mới');
    }

    return getWarehouseVoucherById(voucherId);
  }

  async function approveWarehouseVoucher(voucherId) {
    if (!voucherId) throw new Error('Thiếu ID chứng từ cần duyệt');
    var client = getClient();
    var res = await client.rpc('approve_warehouse_voucher', { p_voucher_id: voucherId });
    var result = throwIfError(res, 'Duyệt phiếu kho thất bại');
    try {
      var vInfo = await getWarehouseVoucherById(voucherId);
      if (vInfo && vInfo.voucherType === 'OUT' && vInfo.projectId) {
        await client.from('projects').update({ inventory_deducted_at: vInfo.approvedAt || new Date().toISOString() }).eq('id', vInfo.projectId);
      }
    } catch (e) {}
    return result;
  }

  async function cancelWarehouseVoucher(voucherId, reason) {
    if (!voucherId) throw new Error('Thiếu ID chứng từ cần hủy');
    var client = getClient();
    var res = await client.rpc('cancel_warehouse_voucher', {
      p_voucher_id: voucherId,
      p_reason: String(reason || '').trim()
    });
    var result = throwIfError(res, 'Hủy phiếu kho thất bại');
    try {
      var vInfo = await getWarehouseVoucherById(voucherId);
      if (vInfo && vInfo.voucherType === 'OUT' && vInfo.projectId) {
        await client.from('projects').update({ inventory_deducted_at: null }).eq('id', vInfo.projectId);
      }
    } catch (e) {}
    return result;
  }

  async function getPendingVouchersCount() {
    if (!isConfigured()) return 0;
    try {
      var client = getClient();
      var res = await client
        .from('warehouse_vouchers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (res && res.error) return 0;
      return Number(res && res.count) || 0;
    } catch (e) {
      return 0;
    }
  }

  async function getProjectOutVouchers(projectId) {
    if (!projectId || projectId === DRAFT_PROJECT_ID || !isConfigured()) return [];
    try {
      var client = getClient();
      var res = await client
        .from('warehouse_vouchers')
        .select('*, supplier:suppliers(id,code,name), project:projects(id,name), warehouse_voucher_items(*)')
        .eq('project_id', String(projectId))
        .eq('voucher_type', 'OUT')
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false });
      if (res && res.error) return [];
      return (res.data || []).map(mapVoucherFromDb);
    } catch (e) {
      return [];
    }
  }

  async function getActiveProjectOutVouchersMap() {
    if (!isConfigured()) return {};
    try {
      var client = getClient();
      var res = await client
        .from('warehouse_vouchers')
        .select('id, voucher_code, voucher_type, status, project_id, created_at, approved_at, created_by, approved_by')
        .eq('voucher_type', 'OUT')
        .in('status', ['pending', 'approved'])
        .not('project_id', 'is', null)
        .order('created_at', { ascending: false });
      if (res && res.error) return {};
      var map = {};
      (res.data || []).forEach(function (row) {
        if (row.project_id && !map[row.project_id]) {
          map[row.project_id] = mapVoucherFromDb(row);
        }
      });
      return map;
    } catch (e) {
      return {};
    }
  }

  async function createProjectOutVoucher(opts) {
    var o = opts || {};
    var projectId = String(o.projectId || '').trim();
    if (!projectId || projectId === DRAFT_PROJECT_ID) {
      throw new Error('Vui lòng lưu dự án thành đơn hàng chính thức trước khi tạo Phiếu Xuất Kho!');
    }

    // Chống trùng lặp: kiểm tra đã có PXK pending/approved chưa
    var existingList = await getProjectOutVouchers(projectId);
    if (existingList.length > 0) {
      var dup = existingList[0];
      throw new Error('Dự án đã có phiếu ' + dup.voucherCode + ' (' + (dup.status === 'approved' ? 'Đã duyệt xuất' : 'Đang chờ duyệt') + ').');
    }

    var invList = await getInventory();
    var invByProf = {};
    invList.forEach(function (r) { invByProf[r.profileName] = r; });

    var items = [];
    var fullBars = Array.isArray(o.fullBarsByProfile) ? o.fullBarsByProfile : [];
    for (var i = 0; i < fullBars.length; i++) {
      var f = fullBars[i];
      var qty = Math.max(0, Number(f.qty) || 0);
      if (!f.profile || qty <= 0) continue;
      var invRow = invByProf[f.profile];
      if (!invRow) {
        invRow = await _ensureInventoryProfileRow(f.profile, f.lengthMm || 6000);
      }
      items.push({
        inventoryId: invRow.id,
        offcutId: null,
        profile: invRow.profileName,
        materialGroup: invRow.materialGroup || 'tube_1d',
        unit: invRow.unit || 'cây',
        qty: qty,
        lengthMm: f.lengthMm || invRow.standardLengthMm || 6000,
        unitPrice: Number(invRow.avgCost || invRow.unitPrice || 0),
        note: 'Xuất cây nguyên cho dự án'
      });
    }

    var offcuts = Array.isArray(o.offcutsUsed) ? o.offcutsUsed : [];
    for (var j = 0; j < offcuts.length; j++) {
      var off = offcuts[j];
      var oQty = Math.max(0, Number(off.usedQty || off.qty) || 0);
      if (!off.id || oQty <= 0) continue;
      items.push({
        inventoryId: null,
        offcutId: off.id,
        profile: off.profile || 'Chung',
        materialGroup: 'tube_1d',
        unit: 'đoạn',
        qty: oQty,
        lengthMm: Number(off.lengthMm) || null,
        unitPrice: 0,
        note: 'Xuất đề-xê tái sử dụng'
      });
    }

    if (!items.length) {
      throw new Error('Không có dòng vật tư nào cần xuất kho!');
    }

    var projName = String(o.projectName || projectId).trim();
    var created = await createWarehouseVoucher({
      voucherType: 'OUT',
      status: 'pending',
      projectId: projectId,
      department: String(o.department || 'Tổ Laser / Hàn Khung').trim(),
      note: String(o.note || ('Xuất vật tư sản xuất dự án: ' + projName)).trim(),
      allowNegative: Boolean(o.allowNegative),
      createdBy: String(o.createdBy || '').trim()
    }, items);

    if (o.autoApprove) {
      await approveWarehouseVoucher(created.id);
      return await getWarehouseVoucherById(created.id);
    }
    return created;
  }

  async function uploadVoucherAttachment(blobOrFile, fileNameHint) {
    var client = getClient();
    var baseName = toAsciiSafe(fileNameHint || 'phieu_giao_hang').replace(/[^a-z0-9_.-]+/gi, '_');
    var path = 'vouchers/' + new Date().toISOString().slice(0, 10) + '/' + Date.now() + '_' + baseName + '.jpg';
    var res = await client.storage.from(VOUCHER_BUCKET).upload(path, blobOrFile, {
      contentType: (blobOrFile && blobOrFile.type) || 'image/jpeg',
      upsert: false
    });
    if (res && res.error) {
      throw new Error('Lỗi tải ảnh chứng từ lên Storage: ' + res.error.message);
    }
    return path;
  }

  async function getVoucherAttachmentSignedUrl(pathOrUrl, expiresInSec) {
    var clean = String(pathOrUrl || '').trim();
    if (!clean) return null;
    if (/^https?:\/\//i.test(clean)) return clean;
    var client = getClient();
    var res = await client.storage.from(VOUCHER_BUCKET).createSignedUrl(clean, expiresInSec || 3600);
    if (res && res.error) return null;
    return res && res.data ? res.data.signedUrl : null;
  }

  // =========================================================================
  // WMS GIAI ĐOẠN 3: CẤU HÌNH HỆ THỐNG, BÁO CÁO NXT, GIÁ VỐN DỰ ÁN & CNC RETURN
  // =========================================================================
  async function getWmsSettings() {
    var fallback = { allow_engineer_view_price: false };
    if (!isConfigured()) return fallback;
    try {
      var client = getClient();
      var res = await client.from('wms_settings').select('key, value');
      if (res && res.error) return fallback;
      var out = Object.assign({}, fallback);
      (res.data || []).forEach(function (row) {
        if (row && row.key) out[row.key] = row.value;
      });
      return out;
    } catch (e) {
      return fallback;
    }
  }

  async function setWmsSetting(key, value, updatedBy) {
    if (!key) throw new Error('Thiếu khóa cấu hình wms_settings');
    var client = getClient();
    var res = await client
      .from('wms_settings')
      .upsert({
        key: String(key),
        value: value,
        updated_at: new Date().toISOString(),
        updated_by: String(updatedBy || '').trim()
      }, { onConflict: 'key' })
      .select()
      .single();
    return throwIfError(res, 'Không lưu được cấu hình WMS');
  }

  async function getNxtReport(fromIso, toIso, materialGroup) {
    var client = getClient();
    var res = await client.rpc('get_nxt_report', {
      p_from: fromIso || null,
      p_to: toIso || null,
      p_material_group: materialGroup && materialGroup !== 'ALL' ? String(materialGroup) : null
    });
    return throwIfError(res, 'Không tải được báo cáo Nhập - Xuất - Tồn') || [];
  }

  async function getProjectCostReport(fromIso, toIso) {
    var client = getClient();
    var res = await client.rpc('get_project_cost_report', {
      p_from: fromIso || null,
      p_to: toIso || null
    });
    return throwIfError(res, 'Không tải được báo cáo Giá vốn Dự án') || [];
  }

  async function getSupplierPurchaseSummary(fromIso, toIso) {
    var client = getClient();
    var res = await client.rpc('get_supplier_purchase_summary', {
      p_from: fromIso || null,
      p_to: toIso || null
    });
    return throwIfError(res, 'Không tải được tổng hợp Nhà cung cấp') || [];
  }

  async function getToolingConsumptionReport(fromIso, toIso) {
    var client = getClient();
    var res = await client.rpc('get_tooling_consumption_report', {
      p_from: fromIso || null,
      p_to: toIso || null
    });
    return throwIfError(res, 'Không tải được báo cáo tiêu hao Dao cụ & Vật tư phụ') || [];
  }

  async function bulkImportToolingCatalog(items, createdBy) {
    var list = Array.isArray(items) ? items : [];
    var saved = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it.profileName) continue;
      var row = await addProfile(it.profileName, it);
      if (row) saved.push(row);
    }
    return saved;
  }

  async function submitCncOffcutReturn(opts) {
    var o = opts || {};
    var client = getClient();
    var res = await client.rpc('submit_cnc_offcut_return', {
      p_project_id: String(o.projectId || ''),
      p_profile: String(o.profile || '').trim(),
      p_length_mm: Number(o.lengthMm) || 0,
      p_qty: Number(o.qty) || 1,
      p_rack_location: String(o.rackLocation || '').trim(),
      p_note: String(o.note || '').trim()
    });
    return throwIfError(res, 'Không tạo được phiếu hoàn đề-xê CNC');
  }

  // =========================================================================
  // WMS ĐỢT 8: ĐỀ NGHỊ VẬT TƯ DỰ ÁN (project_material_requests) & ĐÍNH KÈM
  // =========================================================================
  var PROJECT_ATT_BUCKET = 'project-attachments';

  function mapProjectRequestFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      workStage: String(row.work_stage || 'laser_sheet'),
      inventoryId: row.inventory_id || null,
      itemName: String(row.item_name || ''),
      materialGrade: String(row.material_grade || ''),
      specDimensions: String(row.spec_dimensions || ''),
      calcWeightKg: Number(row.calc_weight_kg) || 0,
      unit: String(row.unit || 'cái'),
      requiredQty: Number(row.required_qty) || 0,
      issuedQty: Number(row.issued_qty) || 0,
      allocatedQty: Number(row.allocated_qty) || 0,
      expectedDate: row.expected_date || null,
      readyNotifiedAt: row.ready_notified_at || null,
      status: String(row.status || 'pending'),
      note: String(row.note || ''),
      createdBy: row.created_by || null,
      createdAt: row.created_at || new Date().toISOString()
    };
  }

  function mapProjectAttachmentFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      fileName: String(row.file_name || ''),
      fileType: String(row.file_type || 'other'),
      docCategory: String(row.doc_category || 'drawing'),
      storagePath: String(row.storage_path || ''),
      fileSize: Number(row.file_size) || 0,
      note: String(row.note || ''),
      uploadedBy: row.uploaded_by || null,
      createdAt: row.created_at || new Date().toISOString()
    };
  }

  async function getProjectMaterialRequests(projectId) {
    if (!projectId || !isConfigured()) return [];
    var client = getClient();
    var res = await client
      .from('project_material_requests')
      .select('*')
      .eq('project_id', String(projectId))
      .order('created_at', { ascending: true });
    if (res && res.error && _isMissingTableError(res.error, 'project_material_requests')) {
      return [];
    }
    var rows = throwIfError(res, 'Không tải được đề nghị vật tư dự án') || [];
    return rows.map(mapProjectRequestFromDb);
  }

  async function getProjectRequestsSummaryMap() {
    if (!isConfigured()) return {};
    try {
      var client = getClient();
      var res = await client
        .from('project_material_requests')
        .select('project_id, status, required_qty, issued_qty');
      if (res && res.error) return {};
      var map = {};
      (res.data || []).forEach(function (r) {
        if (!r.project_id) return;
        if (!map[r.project_id]) map[r.project_id] = { total: 0, fulfilled: 0 };
        if (r.status !== 'cancelled') {
          map[r.project_id].total += 1;
          if (r.status === 'fulfilled' || Number(r.issued_qty) >= Number(r.required_qty)) {
            map[r.project_id].fulfilled += 1;
          }
        }
      });
      return map;
    } catch (e) {
      return {};
    }
  }

  async function addProjectMaterialRequest(payload) {
    var p = payload || {};
    var client = getClient();
    var row = {
      project_id: String(p.projectId),
      work_stage: String(p.workStage || 'laser_sheet'),
      inventory_id: p.inventoryId || null,
      item_name: String(p.itemName || '').trim(),
      material_grade: String(p.materialGrade || '').trim(),
      spec_dimensions: String(p.specDimensions || '').trim(),
      calc_weight_kg: Math.max(0, Number(p.calcWeightKg) || 0),
      unit: String(p.unit || 'cái').trim() || 'cái',
      required_qty: Math.max(0.001, Number(p.requiredQty) || 1),
      issued_qty: 0,
      status: p.status === 'need_purchase' ? 'need_purchase' : 'pending',
      note: String(p.note || '').trim()
    };
    var res = await client.from('project_material_requests').insert(row).select().single();
    return mapProjectRequestFromDb(throwIfError(res, 'Không thêm được dòng đề nghị vật tư'));
  }

  async function bulkAddProjectMaterialRequests(items) {
    var list = (Array.isArray(items) ? items : []).filter(function (p) { return p && p.projectId && p.itemName; });
    if (!list.length) return [];
    var client = getClient();
    var rows = list.map(function (p) {
      return {
        project_id: String(p.projectId),
        work_stage: String(p.workStage || 'laser_sheet'),
        inventory_id: p.inventoryId || null,
        item_name: String(p.itemName || '').trim(),
        material_grade: String(p.materialGrade || '').trim(),
        spec_dimensions: String(p.specDimensions || '').trim(),
        calc_weight_kg: Math.max(0, Number(p.calcWeightKg) || 0),
        unit: String(p.unit || 'cái').trim() || 'cái',
        required_qty: Math.max(0.001, Number(p.requiredQty) || 1),
        issued_qty: 0,
        status: p.status === 'need_purchase' ? 'need_purchase' : 'pending',
        note: String(p.note || '').trim()
      };
    });
    var res = await client.from('project_material_requests').insert(rows).select();
    var saved = throwIfError(res, 'Không nhập được danh sách đề nghị vật tư') || [];
    return saved.map(mapProjectRequestFromDb);
  }

  async function updateProjectMaterialRequest(id, patch) {
    var p = patch || {};
    var client = getClient();
    var upd = {};
    if (p.workStage !== undefined) upd.work_stage = String(p.workStage);
    if (p.inventoryId !== undefined) upd.inventory_id = p.inventoryId || null;
    if (p.itemName !== undefined) upd.item_name = String(p.itemName || '').trim();
    if (p.materialGrade !== undefined) upd.material_grade = String(p.materialGrade || '').trim();
    if (p.specDimensions !== undefined) upd.spec_dimensions = String(p.specDimensions || '').trim();
    if (p.calcWeightKg !== undefined) upd.calc_weight_kg = Math.max(0, Number(p.calcWeightKg) || 0);
    if (p.unit !== undefined) upd.unit = String(p.unit || 'cái');
    if (p.requiredQty !== undefined) upd.required_qty = Math.max(0.001, Number(p.requiredQty) || 1);
    if (p.status !== undefined) upd.status = String(p.status);
    if (p.note !== undefined) upd.note = String(p.note || '').trim();
    var res = await client.from('project_material_requests').update(upd).eq('id', id).select().single();
    return mapProjectRequestFromDb(throwIfError(res, 'Không cập nhật được dòng đề nghị vật tư'));
  }

  async function deleteProjectMaterialRequest(id) {
    var client = getClient();
    var res = await client.from('project_material_requests').delete().eq('id', id);
    throwIfError(res, 'Không xóa được dòng đề nghị vật tư (chú ý: dòng đã xuất kho sẽ bị khóa xóa)');
    return true;
  }

  async function getProjectAttachments(projectId) {
    if (!projectId || !isConfigured()) return [];
    var client = getClient();
    var res = await client
      .from('project_attachments')
      .select('*')
      .eq('project_id', String(projectId))
      .order('created_at', { ascending: false });
    if (res && res.error && _isMissingTableError(res.error, 'project_attachments')) {
      return [];
    }
    var rows = throwIfError(res, 'Không tải được file đính kèm dự án') || [];
    return rows.map(mapProjectAttachmentFromDb);
  }

  async function uploadProjectAttachment(projectId, file, note, docCategory) {
    if (!projectId || !file) throw new Error('Thiếu thông tin dự án hoặc tệp đính kèm');
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Dung lượng tệp vượt quá giới hạn an toàn 10MB');
    }
    var client = getClient();
    var safeFile = toAsciiSafe(file.name || 'file');
    var storagePath = toAsciiSafe(projectId) + '/' + Date.now() + '_' + safeFile;
    var upRes = await client.storage.from(PROJECT_ATT_BUCKET).upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });
    if (upRes && upRes.error) {
      throw new Error('Lỗi tải tệp lên Storage: ' + upRes.error.message);
    }
    var ext = (file.name || '').toLowerCase();
    var fType = 'other';
    if (/\.(xlsx|xls|csv)$/i.test(ext)) fType = 'excel';
    else if (/\.pdf$/i.test(ext)) fType = 'pdf';
    else if (/\.(dxf|dwg|igs|iges|step|stp)$/i.test(ext)) fType = 'cad';
    else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(ext)) fType = 'image';

    var insPayload = {
      project_id: String(projectId),
      file_name: String(file.name || safeFile),
      file_type: fType,
      doc_category: String(docCategory || 'drawing'),
      storage_path: storagePath,
      file_size: Number(file.size) || 0,
      note: String(note || '').trim()
    };
    var insRes = await client.from('project_attachments').insert(insPayload).select().single();
    if (insRes && insRes.error && _isMissingColumnError(insRes.error, /doc_category/i)) {
      delete insPayload.doc_category;
      insRes = await client.from('project_attachments').insert(insPayload).select().single();
    }
    return mapProjectAttachmentFromDb(throwIfError(insRes, 'Không lưu được thông tin file đính kèm'));
  }

  async function getProjectAttachmentSignedUrl(storagePath, expiresInSec) {
    if (!storagePath) return null;
    var client = getClient();
    var res = await client.storage.from(PROJECT_ATT_BUCKET).createSignedUrl(storagePath, expiresInSec || 3600);
    if (res && res.error) return null;
    return res && res.data ? res.data.signedUrl : null;
  }

  async function deleteProjectAttachment(id, storagePath) {
    var client = getClient();
    if (storagePath) {
      try { await client.storage.from(PROJECT_ATT_BUCKET).remove([storagePath]); } catch (e) {}
    }
    var res = await client.from('project_attachments').delete().eq('id', id);
    throwIfError(res, 'Không xóa được file đính kèm');
    return true;
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
  // =========================================================================
  // ĐỢT 11: MUA HÀNG (PR -> PO -> PNK) & KHO THÀNH PHẨM / GIAO HÀNG
  // =========================================================================
  function _genDocCode(prefix) {
    var d = new Date();
    var ymd = d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    var rnd = Math.floor(100 + Math.random() * 900);
    return prefix + '-' + ymd + '-' + rnd;
  }

  async function _loadProfileNameMap() {
    var map = {};
    try {
      var profs = await getProfiles();
      (profs || []).forEach(function (pr) {
        var label = pr.displayName || pr.username || '';
        if (pr.id && label) map[String(pr.id)] = label;
        if (pr.username && label) map[String(pr.username)] = label;
      });
    } catch (e) {}
    return map;
  }

  function mapPurchaseRequestFromDb(row, profileMap) {
    if (!row) return null;
    var pMap = profileMap || {};
    var items = Array.isArray(row.purchase_request_items) ? row.purchase_request_items : [];
    var rawCreator = String(row.created_by || '');
    return {
      id: row.id,
      prCode: String(row.pr_code || ''),
      title: String(row.title || ''),
      projectId: row.project_id || null,
      projectName: row.project && row.project.name ? String(row.project.name) : '',
      projectCustomer: row.project && row.project.customer ? String(row.project.customer) : '',
      department: String(row.department || ''),
      priority: String(row.priority || 'normal'),
      neededDate: row.needed_date || null,
      status: String(row.status || 'pending'),
      rejectReason: String(row.reject_reason || ''),
      note: String(row.note || ''),
      createdBy: rawCreator,
      createdByName: pMap[rawCreator] || rawCreator,
      approvedBy: String(row.approved_by || ''),
      approvedAt: row.approved_at || null,
      createdAt: row.created_at || new Date().toISOString(),
      items: items.map(function (it) {
        var est = Number(it.estimated_price) || 0;
        return {
          id: it.id,
          prId: it.pr_id,
          inventoryId: it.inventory_id || null,
          projectRequestId: it.project_request_id || null,
          itemName: String(it.item_name || ''),
          materialGrade: String(it.material_grade || ''),
          specText: String(it.spec_text || ''),
          unit: String(it.unit || 'cái'),
          requestedQty: Number(it.requested_qty) || 0,
          orderedQty: Number(it.ordered_qty) || 0,
          estimatedPrice: est,
          estimatedUnitPrice: est,
          note: String(it.note || '')
        };
      })
    };
  }

  function mapPurchaseOrderFromDb(row, profileMap) {
    if (!row) return null;
    var pMap = profileMap || {};
    var items = Array.isArray(row.purchase_order_items) ? row.purchase_order_items : [];
    var rawCreator = String(row.created_by || '');
    return {
      id: row.id,
      poCode: String(row.po_code || ''),
      supplierId: row.supplier_id || null,
      supplierName: row.supplier && row.supplier.name ? String(row.supplier.name) : '',
      supplierPhone: row.supplier && row.supplier.phone ? String(row.supplier.phone) : '',
      supplierAddress: row.supplier && row.supplier.address ? String(row.supplier.address) : '',
      prId: row.pr_id || null,
      prCode: (row.pr && row.pr.pr_code) ? String(row.pr.pr_code) : String(row.pr_code || ''),
      projectId: row.project_id || null,
      projectName: row.project && row.project.name ? String(row.project.name) : '',
      projectCustomer: row.project && row.project.customer ? String(row.project.customer) : '',
      orderDate: row.order_date || null,
      expectedDate: row.expected_date || null,
      status: String(row.status || 'sent'),
      totalAmount: Number(row.total_amount) || 0,
      paymentTerms: String(row.payment_terms || ''),
      deliveryTerms: String(row.delivery_terms || ''),
      note: String(row.note || ''),
      createdBy: rawCreator,
      createdByName: pMap[rawCreator] || rawCreator,
      approvedBy: String(row.approved_by || ''),
      createdAt: row.created_at || new Date().toISOString(),
      items: items.map(function (it) {
        var lineAmt = Number(it.total_amount) || 0;
        return {
          id: it.id,
          poId: it.po_id,
          prItemId: it.pr_item_id || null,
          inventoryId: it.inventory_id || null,
          itemName: String(it.item_name || ''),
          materialGrade: String(it.material_grade || ''),
          unit: String(it.unit || 'cái'),
          orderedQty: Number(it.ordered_qty) || 0,
          receivedQty: Number(it.received_qty) || 0,
          unitPrice: Number(it.unit_price) || 0,
          totalAmount: lineAmt,
          lineTotal: lineAmt,
          note: String(it.note || '')
        };
      })
    };
  }

  async function getPurchaseRequests(filters) {
    var f = filters || {};
    var client = getClient();
    var q = client.from('purchase_requests')
      .select('*, project:projects(name,customer), purchase_request_items(*)')
      .order('created_at', { ascending: false });
    if (f.status && f.status !== 'ALL') q = q.eq('status', f.status);
    if (f.priority && f.priority !== 'ALL') q = q.eq('priority', f.priority);
    if (f.projectId) q = q.eq('project_id', f.projectId);
    var res = await q;
    if (res && res.error && _isMissingTableError(res.error, 'purchase_requests')) return [];
    var rows = throwIfError(res, 'Không tải được danh sách Đề nghị mua hàng') || [];
    var profileMap = await _loadProfileNameMap();
    var mapped = rows.map(function (r) { return mapPurchaseRequestFromDb(r, profileMap); });

    // Fallback: các dòng PR cũ chưa có material_grade -> đọc bù từ project_material_requests theo project_request_id
    var missingReqIds = [];
    mapped.forEach(function (pr) {
      (pr.items || []).forEach(function (it) {
        if ((!it.materialGrade || !it.specText) && it.projectRequestId && missingReqIds.indexOf(it.projectRequestId) < 0) {
          missingReqIds.push(it.projectRequestId);
        }
      });
    });
    if (missingReqIds.length) {
      try {
        var pmrRes = await client.from('project_material_requests')
          .select('id, material_grade, spec_dimensions')
          .in('id', missingReqIds);
        if (pmrRes && !pmrRes.error && Array.isArray(pmrRes.data)) {
          var pmrMap = {};
          pmrRes.data.forEach(function (m) { pmrMap[m.id] = m; });
          mapped.forEach(function (pr) {
            (pr.items || []).forEach(function (it) {
              var src = it.projectRequestId ? pmrMap[it.projectRequestId] : null;
              if (src) {
                if (!it.materialGrade && src.material_grade) it.materialGrade = String(src.material_grade);
                if (!it.specText && src.spec_dimensions) it.specText = String(src.spec_dimensions);
              }
            });
          });
        }
      } catch (e) {}
    }
    return mapped;
  }

  async function getPendingPrCount() {
    var client = getClient();
    var res = await client.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (res && res.error) return 0;
    return res && res.count ? res.count : 0;
  }

  async function createPurchaseRequest(payload, items) {
    var p = payload || {};
    var list = (Array.isArray(items) ? items : []).filter(function (it) {
      return it && String(it.itemName || '').trim() && Number(it.requestedQty || 0) > 0;
    });
    if (!list.length) throw new Error('PR phải có ít nhất 1 dòng vật tư với số lượng > 0');
    var client = getClient();
    var header = {
      pr_code: String(p.prCode || _genDocCode('PR')),
      title: String(p.title || 'Đề nghị mua hàng').trim(),
      project_id: p.projectId || null,
      department: String(p.department || '').trim(),
      priority: p.priority === 'urgent' ? 'urgent' : 'normal',
      needed_date: p.neededDate || null,
      status: p.status === 'draft' ? 'draft' : 'pending',
      note: String(p.note || '').trim(),
      created_by: String(p.createdBy || '').trim()
    };
    var res = await client.from('purchase_requests').insert(header).select().single();
    var created = throwIfError(res, 'Không tạo được Đề nghị mua hàng');
    var itemRows = list.map(function (it) {
      var estPrice = Math.max(0, Number(it.estimatedPrice != null ? it.estimatedPrice : (it.estimatedUnitPrice || 0)));
      return {
        pr_id: created.id,
        inventory_id: it.inventoryId || null,
        project_request_id: it.projectRequestId || null,
        item_name: String(it.itemName).trim(),
        material_grade: String(it.materialGrade || '').trim(),
        spec_text: String(it.specText || '').trim(),
        unit: String(it.unit || 'cái').trim(),
        requested_qty: Number(it.requestedQty),
        estimated_price: estPrice,
        note: String(it.note || '').trim()
      };
    });
    var iRes = await client.from('purchase_request_items').insert(itemRows).select();
    if (iRes && iRes.error && _isMissingColumnError(iRes.error, /material_grade/i)) {
      var fallbackRows = itemRows.map(function (r) {
        var copy = Object.assign({}, r);
        delete copy.material_grade;
        return copy;
      });
      iRes = await client.from('purchase_request_items').insert(fallbackRows).select();
    }
    if (iRes && iRes.error) {
      try { await client.from('purchase_requests').delete().eq('id', created.id); } catch (e) {}
      throwIfError(iRes, 'Không lưu được chi tiết PR');
    }
    return created;
  }

  async function updatePurchaseRequestStatus(prId, status, extra) {
    var client = getClient();
    var e = extra || {};
    var patch = { status: status, updated_at: new Date().toISOString() };
    if (status === 'approved') {
      patch.approved_by = e.approvedBy || '';
      patch.approved_at = new Date().toISOString();
    }
    if (status === 'rejected') {
      patch.reject_reason = String(e.rejectReason || '').trim();
    }
    var res = await client.from('purchase_requests').update(patch).eq('id', prId).select().single();
    return throwIfError(res, 'Không cập nhật được trạng thái PR');
  }

  async function getPurchaseOrders(filters) {
    var f = filters || {};
    var client = getClient();
    var q = client.from('purchase_orders')
      .select('*, supplier:suppliers(name,phone,address), project:projects(name,customer), pr:purchase_requests(pr_code), purchase_order_items(*)')
      .order('created_at', { ascending: false });
    if (f.status && f.status !== 'ALL') q = q.eq('status', f.status);
    if (f.supplierId) q = q.eq('supplier_id', f.supplierId);
    var res = await q;
    if (res && res.error && _isMissingTableError(res.error, 'purchase_orders')) return [];
    if (res && res.error) {
      var q2 = client.from('purchase_orders')
        .select('*, supplier:suppliers(name,phone,address), project:projects(name,customer), purchase_order_items(*)')
        .order('created_at', { ascending: false });
      if (f.status && f.status !== 'ALL') q2 = q2.eq('status', f.status);
      if (f.supplierId) q2 = q2.eq('supplier_id', f.supplierId);
      res = await q2;
    }
    var rows = throwIfError(res, 'Không tải được danh sách Đơn đặt hàng (PO)') || [];
    var profileMap = await _loadProfileNameMap();
    return rows.map(function (r) { return mapPurchaseOrderFromDb(r, profileMap); });
  }

  async function getPurchaseOrderById(poId) {
    var client = getClient();
    var res = await client.from('purchase_orders')
      .select('*, supplier:suppliers(name,phone,address), project:projects(name,customer), pr:purchase_requests(pr_code), purchase_order_items(*)')
      .eq('id', poId)
      .maybeSingle();
    if (res && res.error && _isMissingTableError(res.error, 'purchase_orders')) return null;
    if (res && res.error) {
      res = await client.from('purchase_orders')
        .select('*, supplier:suppliers(name,phone,address), project:projects(name,customer), purchase_order_items(*)')
        .eq('id', poId)
        .maybeSingle();
    }
    var row = throwIfError(res, 'Không tải được Đơn đặt hàng');
    var profileMap = await _loadProfileNameMap();
    return mapPurchaseOrderFromDb(row, profileMap);
  }

  async function createPurchaseOrder(payload, items) {
    var p = payload || {};
    var list = (Array.isArray(items) ? items : []).filter(function (it) {
      return it && String(it.itemName || '').trim() && Number(it.orderedQty || 0) > 0;
    });
    if (!list.length) throw new Error('PO phải có ít nhất 1 dòng hàng hóa với số lượng > 0');
    var client = getClient();
    var totalAmt = list.reduce(function (s, it) {
      return s + Math.round(Number(it.orderedQty) * Math.max(0, Number(it.unitPrice || 0)));
    }, 0);
    var header = {
      po_code: String(p.poCode || _genDocCode('PO')),
      supplier_id: p.supplierId || null,
      pr_id: p.prId || null,
      project_id: p.projectId || null,
      order_date: p.orderDate || new Date().toISOString().slice(0, 10),
      expected_date: p.expectedDate || null,
      status: 'sent',
      total_amount: totalAmt,
      payment_terms: String(p.paymentTerms || '').trim(),
      delivery_terms: String(p.deliveryTerms || '').trim(),
      note: String(p.note || '').trim(),
      created_by: String(p.createdBy || '').trim(),
      approved_by: String(p.approvedBy || p.createdBy || '').trim()
    };
    var res = await client.from('purchase_orders').insert(header).select().single();
    var created = throwIfError(res, 'Không tạo được Đơn đặt hàng (PO)');
    var itemRows = list.map(function (it) {
      var qty = Number(it.orderedQty);
      var price = Math.max(0, Number(it.unitPrice || 0));
      return {
        po_id: created.id,
        pr_item_id: it.prItemId || null,
        inventory_id: it.inventoryId || null,
        item_name: String(it.itemName).trim(),
        material_grade: String(it.materialGrade || '').trim(),
        unit: String(it.unit || 'cái').trim(),
        ordered_qty: qty,
        unit_price: price,
        total_amount: Math.round(qty * price),
        note: String(it.note || '').trim()
      };
    });
    var iRes = await client.from('purchase_order_items').insert(itemRows).select();
    if (iRes && iRes.error && _isMissingColumnError(iRes.error, /material_grade/i)) {
      var fallbackRows = itemRows.map(function (r) {
        var copy = Object.assign({}, r);
        delete copy.material_grade;
        return copy;
      });
      iRes = await client.from('purchase_order_items').insert(fallbackRows).select();
    }
    if (iRes && iRes.error) {
      try { await client.from('purchase_orders').delete().eq('id', created.id); } catch (e) {}
      throwIfError(iRes, 'Không lưu được chi tiết PO');
    }

    // Cộng dồn ordered_qty trên purchase_request_items nếu tạo từ PR
    for (var i = 0; i < list.length; i++) {
      var srcIt = list[i];
      if (srcIt.prItemId) {
        var curPri = await client.from('purchase_request_items').select('ordered_qty').eq('id', srcIt.prItemId).maybeSingle();
        var prevOrd = (curPri && curPri.data && Number(curPri.data.ordered_qty)) || 0;
        await client.from('purchase_request_items').update({ ordered_qty: prevOrd + Number(srcIt.orderedQty) }).eq('id', srcIt.prItemId);
      }
    }
    if (p.prId) {
      await client.from('purchase_requests').update({ status: 'ordered', updated_at: new Date().toISOString() }).eq('id', p.prId);
    }
    return getPurchaseOrderById(created.id);
  }

  async function createPurchaseOrderFromPr(prId, supplierId, extra, selectedItems) {
    var e = extra || {};
    var payload = Object.assign({}, e, { prId: prId, supplierId: supplierId });
    return createPurchaseOrder(payload, selectedItems);
  }

  async function updatePurchaseOrderStatus(poId, status) {
    var client = getClient();
    var res = await client.from('purchase_orders').update({ status: status, updated_at: new Date().toISOString() }).eq('id', poId).select().single();
    return throwIfError(res, 'Không cập nhật được trạng thái PO');
  }

  // Kho Thành phẩm & Giao hàng
  async function getFinishedGoodsItems(projectId) {
    var client = getClient();
    var q = client.from('finished_goods_items').select('*, project:projects(name)').order('created_at', { ascending: false });
    if (projectId && projectId !== 'ALL') q = q.eq('project_id', projectId);
    var res = await q;
    if (res && res.error && _isMissingTableError(res.error, 'finished_goods_items')) return [];
    var rows = throwIfError(res, 'Không tải được danh mục Thành phẩm') || [];
    return rows.map(function (r) {
      return {
        id: r.id,
        projectId: r.project_id || null,
        projectName: r.project && r.project.name ? String(r.project.name) : '',
        fgCode: String(r.fg_code || ''),
        name: String(r.name || ''),
        drawingNo: String(r.drawing_no || ''),
        specText: String(r.spec_text || ''),
        unit: String(r.unit || 'bộ'),
        plannedQty: Number(r.planned_qty) || 0,
        producedQty: Number(r.produced_qty) || 0,
        deliveredQty: Number(r.delivered_qty) || 0,
        stockQty: Number(r.stock_qty) || 0,
        rackLocation: String(r.rack_location || ''),
        note: String(r.note || ''),
        createdAt: r.created_at || null
      };
    });
  }

  async function saveFinishedGoodsItem(payload) {
    var p = payload || {};
    var client = getClient();
    var row = {
      project_id: p.projectId || null,
      fg_code: String(p.fgCode || '').trim(),
      name: String(p.name || '').trim(),
      drawing_no: String(p.drawingNo || '').trim(),
      spec_text: String(p.specText || '').trim(),
      unit: String(p.unit || 'bộ').trim(),
      planned_qty: Math.max(0, Number(p.plannedQty) || 0),
      rack_location: String(p.rackLocation || '').trim(),
      note: String(p.note || '').trim(),
      updated_at: new Date().toISOString()
    };
    if (!row.fg_code || !row.name) throw new Error('Vui lòng nhập Mã TP và Tên Thành phẩm');
    var res = p.id
      ? await client.from('finished_goods_items').update(row).eq('id', p.id).select().single()
      : await client.from('finished_goods_items').insert(row).select().single();
    return throwIfError(res, 'Không lưu được Thành phẩm');
  }

  async function getFgReceipts() {
    var client = getClient();
    var res = await client.from('fg_receipts')
      .select('*, project:projects(name), fg_receipt_items(*, fg_item:finished_goods_items(fg_code,name,unit))')
      .order('created_at', { ascending: false });
    if (res && res.error && _isMissingTableError(res.error, 'fg_receipts')) return [];
    var rows = throwIfError(res, 'Không tải được Phiếu nhập Thành phẩm') || [];
    return rows.map(function (r) {
      return {
        id: r.id,
        receiptCode: String(r.receipt_code || ''),
        projectId: r.project_id || null,
        projectName: r.project && r.project.name ? String(r.project.name) : '',
        department: String(r.department || ''),
        qcBy: String(r.qc_by || ''),
        status: String(r.status || 'draft'),
        note: String(r.note || ''),
        createdBy: String(r.created_by || ''),
        approvedBy: String(r.approved_by || ''),
        approvedAt: r.approved_at || null,
        createdAt: r.created_at || null,
        items: (r.fg_receipt_items || []).map(function (it) {
          return {
            id: it.id,
            fgItemId: it.fg_item_id,
            fgCode: it.fg_item ? it.fg_item.fg_code : '',
            name: it.fg_item ? it.fg_item.name : '',
            unit: it.fg_item ? it.fg_item.unit : 'bộ',
            qty: Number(it.qty) || 0,
            note: String(it.note || '')
          };
        })
      };
    });
  }

  async function createFgReceipt(payload, items) {
    var p = payload || {};
    var list = (Array.isArray(items) ? items : []).filter(function (it) { return it && it.fgItemId && Number(it.qty) > 0; });
    if (!list.length) throw new Error('Phiếu nhập TP phải có ít nhất 1 dòng');
    var client = getClient();
    var header = {
      receipt_code: String(p.receiptCode || _genDocCode('PNTP')),
      project_id: p.projectId || null,
      department: String(p.department || '').trim(),
      qc_by: String(p.qcBy || '').trim(),
      status: 'draft',
      note: String(p.note || '').trim(),
      created_by: String(p.createdBy || '').trim()
    };
    var res = await client.from('fg_receipts').insert(header).select().single();
    var created = throwIfError(res, 'Không tạo được phiếu nhập Thành phẩm');
    var rows = list.map(function (it) {
      return { receipt_id: created.id, fg_item_id: it.fgItemId, qty: Number(it.qty), note: String(it.note || '') };
    });
    var iRes = await client.from('fg_receipt_items').insert(rows).select();
    if (iRes && iRes.error) {
      try { await client.from('fg_receipts').delete().eq('id', created.id); } catch (e) {}
      throwIfError(iRes, 'Không lưu được chi tiết PNTP');
    }
    return created;
  }

  async function approveFgReceipt(receiptId) {
    var res = await getClient().rpc('approve_fg_receipt', { p_receipt_id: receiptId });
    return throwIfError(res, 'Không duyệt được phiếu nhập Thành phẩm');
  }

  async function cancelFgReceipt(receiptId, reason) {
    var res = await getClient().rpc('cancel_fg_receipt', { p_receipt_id: receiptId, p_reason: reason || '' });
    return throwIfError(res, 'Không hủy được phiếu nhập Thành phẩm');
  }

  async function getDeliveryNotes() {
    var client = getClient();
    var res = await client.from('delivery_notes')
      .select('*, project:projects(name), delivery_note_items(*)')
      .order('created_at', { ascending: false });
    if (res && res.error && _isMissingTableError(res.error, 'delivery_notes')) return [];
    var rows = throwIfError(res, 'Không tải được Phiếu xuất giao hàng') || [];
    return rows.map(function (r) {
      return {
        id: r.id,
        dnCode: String(r.dn_code || ''),
        projectId: r.project_id || null,
        projectName: r.project && r.project.name ? String(r.project.name) : '',
        customerName: String(r.customer_name || ''),
        customerPhone: String(r.customer_phone || ''),
        deliveryAddress: String(r.delivery_address || ''),
        vehicleNo: String(r.vehicle_no || ''),
        driverName: String(r.driver_name || ''),
        deliveryDate: r.delivery_date || null,
        status: String(r.status || 'draft'),
        attachmentUrl: String(r.attachment_url || ''),
        note: String(r.note || ''),
        createdBy: String(r.created_by || ''),
        approvedBy: String(r.approved_by || ''),
        approvedAt: r.approved_at || null,
        createdAt: r.created_at || null,
        items: (r.delivery_note_items || []).map(function (it) {
          return {
            id: it.id,
            fgItemId: it.fg_item_id,
            fgCode: String(it.fg_code || ''),
            name: String(it.name || ''),
            unit: String(it.unit || 'bộ'),
            qty: Number(it.qty) || 0,
            note: String(it.note || '')
          };
        })
      };
    });
  }

  async function createDeliveryNote(payload, items) {
    var p = payload || {};
    var list = (Array.isArray(items) ? items : []).filter(function (it) { return it && it.fgItemId && Number(it.qty) > 0; });
    if (!list.length) throw new Error('Phiếu xuất giao hàng phải có ít nhất 1 dòng');
    var client = getClient();
    var header = {
      dn_code: String(p.dnCode || _genDocCode('PXGH')),
      project_id: p.projectId || null,
      customer_name: String(p.customerName || '').trim(),
      customer_phone: String(p.customerPhone || '').trim(),
      delivery_address: String(p.deliveryAddress || '').trim(),
      vehicle_no: String(p.vehicleNo || '').trim(),
      driver_name: String(p.driverName || '').trim(),
      delivery_date: p.deliveryDate || new Date().toISOString().slice(0, 10),
      status: 'draft',
      attachment_url: String(p.attachmentUrl || '').trim(),
      note: String(p.note || '').trim(),
      created_by: String(p.createdBy || '').trim()
    };
    var res = await client.from('delivery_notes').insert(header).select().single();
    var created = throwIfError(res, 'Không tạo được Phiếu xuất giao hàng');
    var rows = list.map(function (it) {
      return {
        dn_id: created.id,
        fg_item_id: it.fgItemId,
        fg_code: String(it.fgCode || ''),
        name: String(it.name || ''),
        unit: String(it.unit || 'bộ'),
        qty: Number(it.qty),
        note: String(it.note || '')
      };
    });
    var iRes = await client.from('delivery_note_items').insert(rows).select();
    if (iRes && iRes.error) {
      try { await client.from('delivery_notes').delete().eq('id', created.id); } catch (e) {}
      throwIfError(iRes, 'Không lưu được chi tiết PXGH');
    }
    return created;
  }

  async function approveDeliveryNote(dnId) {
    var res = await getClient().rpc('approve_delivery_note', { p_dn_id: dnId });
    return throwIfError(res, 'Không duyệt được Phiếu xuất giao hàng');
  }

  async function markDeliveryNoteDelivered(dnId, attachmentUrl) {
    var client = getClient();
    var patch = { status: 'delivered', updated_at: new Date().toISOString() };
    if (attachmentUrl) patch.attachment_url = attachmentUrl;
    var res = await client.from('delivery_notes').update(patch).eq('id', dnId).select().single();
    return throwIfError(res, 'Không cập nhật được trạng thái đã giao hàng');
  }

  async function cancelDeliveryNote(dnId, reason) {
    var res = await getClient().rpc('cancel_delivery_note', { p_dn_id: dnId, p_reason: reason || '' });
    return throwIfError(res, 'Không hủy được Phiếu xuất giao hàng');
  }

  async function uploadDeliveryAttachment(fileOrBlob, dnCode) {
    return uploadVoucherAttachment(fileOrBlob, 'delivery_' + (dnCode || Date.now()));
  }

  async function getCompanyDashboardSummary() {
    var client = getClient();
    var res = await client.rpc('get_company_dashboard_summary');
    if (res && res.error && /Could not find the function|does not exist/i.test(res.error.message || '')) {
      return null;
    }
    return throwIfError(res, 'Không tải được tổng hợp Dashboard');
  }

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
      if (table === 'stock_offcuts') {
        return {
          eventType: eventType,
          newRecord: mapOffcutFromDb(payload.new),
          oldRecord: mapOffcutFromDb(payload.old),
          raw: payload
        };
      }
      if (table === 'inventory_transactions') {
        return {
          eventType: eventType,
          newRecord: mapInventoryTxFromDb(payload.new),
          oldRecord: mapInventoryTxFromDb(payload.old),
          raw: payload
        };
      }
      if (table === 'warehouse_vouchers') {
        return {
          eventType: eventType,
          newRecord: mapVoucherFromDb(payload.new),
          oldRecord: mapVoucherFromDb(payload.old),
          raw: payload
        };
      }
      if (table === 'project_material_requests') {
        return {
          eventType: eventType,
          newRecord: mapProjectRequestFromDb(payload.new),
          oldRecord: mapProjectRequestFromDb(payload.old),
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

  // =========================================================================
  // WMS ĐỢT 12: GIỮ HÀNG ĐÍCH DANH (ALLOCATION), BÁO ZALO & THÔNG BÁO REALTIME
  // =========================================================================
  async function allocateFreeStockToRequest(requestId, qty) {
    var client = getClient();
    var res = await client.rpc('allocate_free_stock_to_request', {
      p_request_id: requestId,
      p_qty: Number(qty)
    });
    return throwIfError(res, 'Không giữ được phôi cho đơn hàng');
  }

  async function releaseRequestAllocation(requestId, qty) {
    var client = getClient();
    var res = await client.rpc('release_request_allocation', {
      p_request_id: requestId,
      p_qty: Number(qty)
    });
    return throwIfError(res, 'Không hủy giữ được phôi');
  }

  async function markRequestsZaloNotified(requestIds) {
    if (!Array.isArray(requestIds) || !requestIds.length) return { ok: true, count: 0 };
    var client = getClient();
    var res = await client.rpc('mark_requests_zalo_notified', {
      p_request_ids: requestIds
    });
    return throwIfError(res, 'Không cập nhật được trạng thái báo Zalo');
  }

  async function getReadyAllocatedRequests() {
    if (!isConfigured()) return [];
    try {
      var client = getClient();
      var res = await client
        .from('project_material_requests')
        .select('id, project_id, work_stage, inventory_id, item_name, spec_dimensions, unit, required_qty, issued_qty, allocated_qty, ready_notified_at, projects(id, name, customer, customer_po_no), inventory(id, profile_name, rack_location, stock_qty, reserved_qty)')
        .gt('allocated_qty', 0)
        .order('updated_at', { ascending: false });
      if (res && res.error) return [];
      return (res.data || []).map(function (r) {
        var proj = r.projects || {};
        var inv = r.inventory || {};
        return {
          id: r.id,
          request_id: r.id,
          projectId: r.project_id,
          project_id: r.project_id,
          projectName: proj.name || r.project_id,
          project_name: proj.name || r.project_id,
          customerPoNo: proj.customer_po_no || '',
          customer_po_no: proj.customer_po_no || '',
          customer: proj.customer || '',
          workStage: r.work_stage || '',
          inventoryId: r.inventory_id || inv.id || null,
          inventory_id: r.inventory_id || inv.id || null,
          itemName: r.item_name || inv.profile_name || '',
          item_name: r.item_name || inv.profile_name || '',
          specDimensions: r.spec_dimensions || '',
          unit: r.unit || 'cái',
          requiredQty: Number(r.required_qty || 0),
          issuedQty: Number(r.issued_qty || 0),
          allocatedQty: Number(r.allocated_qty || 0),
          qty: Number(r.allocated_qty || 0),
          rackLocation: inv.rack_location || '',
          rack_location: inv.rack_location || '',
          readyNotifiedAt: r.ready_notified_at || null
        };
      });
    } catch (e) {
      return [];
    }
  }

  async function getWmsNotifications(limit) {
    if (!isConfigured()) return [];
    try {
      var client = getClient();
      var res = await client
        .from('wms_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Number(limit) || 20);
      if (res && res.error) return [];
      return res.data || [];
    } catch (e) {
      return [];
    }
  }

  async function markNotificationRead(notificationId) {
    if (!notificationId || !isConfigured()) return;
    try {
      var client = getClient();
      await client.rpc('mark_notification_read', { p_notification_id: notificationId });
    } catch (e) {}
  }

  async function transitionProjectWorkflow(projectId, nextStatus, note) {
    var client = getClient();
    var res = await client.rpc('transition_project_workflow', {
      p_project_id: String(projectId),
      p_next_status: String(nextStatus),
      p_note: note ? String(note) : null
    });
    return throwIfError(res, 'Không chuyển được trạng thái quy trình đơn hàng');
  }

  async function getWmsPeriodLocks() {
    if (!isConfigured()) return [];
    try {
      var res = await getClient().from('wms_period_locks').select('*').order('period_ym', { ascending: false });
      if (res && res.error) return [];
      return res.data || [];
    } catch (e) { return []; }
  }

  async function setWmsPeriodLock(periodYm, isLocked, lockedBy, note) {
    var ym = String(periodYm || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('Kỳ kế toán phải có định dạng YYYY-MM (vd: 2026-11)');
    var res = await getClient().from('wms_period_locks').upsert({
      period_ym: ym,
      is_locked: Boolean(isLocked),
      locked_by: String(lockedBy || '').trim(),
      locked_at: new Date().toISOString(),
      note: String(note || '').trim()
    }, { onConflict: 'period_ym' }).select().single();
    return throwIfError(res, 'Không cập nhật được trạng thái khóa kỳ');
  }

  async function getWmsAuditLogs(limit) {
    if (!isConfigured()) return [];
    try {
      var res = await getClient().from('wms_audit_logs').select('*').order('created_at', { ascending: false }).limit(Number(limit) || 60);
      if (res && res.error) return [];
      return res.data || [];
    } catch (e) { return []; }
  }

  function subscribeNotifications(callback) {
    if (!isConfigured() || typeof callback !== 'function') return function () {};
    var client = getClient();
    var ch = client
      .channel('wms_notif_rt_' + Date.now())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wms_notifications' }, function (payload) {
        try { callback(payload.new || payload); } catch (_) {}
      })
      .subscribe();
    return function () {
      try { client.removeChannel(ch); } catch (_) {}
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
    estimateSteelWeightPerM: estimateSteelWeightPerM,
    stripHeavyIgs: stripHeavyIgs,
    usernameToEmail: usernameToEmail,
    emailToUsername: emailToUsername,
    mapProjectFromDb: mapProjectFromDb,
    mapProjectSummaryFromDb: mapProjectSummaryFromDb,
    mapProjectToDb: mapProjectToDb,
    mapProfileFromDb: mapProfileFromDb,
    mapInventoryFromDb: mapInventoryFromDb,
    mapCutRow: mapCutRow,
    mapOffcutFromDb: mapOffcutFromDb,
    mapInventoryTxFromDb: mapInventoryTxFromDb,
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
    isInventoryEnhancedReady: isInventoryEnhancedReady,
    isInventoryWmsReady: isInventoryWmsReady,
    isWmsVouchersReady: isWmsVouchersReady,
    isLedgerTableReady: isLedgerTableReady,
    getInventory: getInventory,
    addProfile: addProfile,
    updateInventoryProfile: updateInventoryProfile,
    addProfilesBulk: addProfilesBulk,
    deleteProfile: deleteProfile,
    checkInventoryUsage: checkInventoryUsage,
    safeDeleteInventoryItem: safeDeleteInventoryItem,
    mergeInventoryItems: mergeInventoryItems,
    saveOpeningBalanceBars: saveOpeningBalanceBars,
    purchaseInInventory: purchaseInInventory,
    stocktakeAdjustInventory: stocktakeAdjustInventory,
    getSuppliers: getSuppliers,
    saveSupplier: saveSupplier,
    deleteSupplier: deleteSupplier,
    getWarehouseVouchers: getWarehouseVouchers,
    getWarehouseVoucherById: getWarehouseVoucherById,
    createWarehouseVoucher: createWarehouseVoucher,
    updateWarehouseVoucher: updateWarehouseVoucher,
    approveWarehouseVoucher: approveWarehouseVoucher,
    cancelWarehouseVoucher: cancelWarehouseVoucher,
    getPendingVouchersCount: getPendingVouchersCount,
    getProjectOutVouchers: getProjectOutVouchers,
    getActiveProjectOutVouchersMap: getActiveProjectOutVouchersMap,
    createProjectOutVoucher: createProjectOutVoucher,
    uploadVoucherAttachment: uploadVoucherAttachment,
    getVoucherAttachmentSignedUrl: getVoucherAttachmentSignedUrl,
    getWmsSettings: getWmsSettings,
    setWmsSetting: setWmsSetting,
    getNxtReport: getNxtReport,
    getProjectCostReport: getProjectCostReport,
    getSupplierPurchaseSummary: getSupplierPurchaseSummary,
    getToolingConsumptionReport: getToolingConsumptionReport,
    bulkImportToolingCatalog: bulkImportToolingCatalog,
    submitCncOffcutReturn: submitCncOffcutReturn,
    getProjectMaterialRequests: getProjectMaterialRequests,
    getProjectRequestsSummaryMap: getProjectRequestsSummaryMap,
    addProjectMaterialRequest: addProjectMaterialRequest,
    bulkAddProjectMaterialRequests: bulkAddProjectMaterialRequests,
    updateProjectMaterialRequest: updateProjectMaterialRequest,
    deleteProjectMaterialRequest: deleteProjectMaterialRequest,
    getProjectAttachments: getProjectAttachments,
    uploadProjectAttachment: uploadProjectAttachment,
    getProjectAttachmentSignedUrl: getProjectAttachmentSignedUrl,
    deleteProjectAttachment: deleteProjectAttachment,
    getPurchaseRequests: getPurchaseRequests,
    getPendingPrCount: getPendingPrCount,
    createPurchaseRequest: createPurchaseRequest,
    updatePurchaseRequestStatus: updatePurchaseRequestStatus,
    getPurchaseOrders: getPurchaseOrders,
    getPurchaseOrderById: getPurchaseOrderById,
    createPurchaseOrder: createPurchaseOrder,
    createPurchaseOrderFromPr: createPurchaseOrderFromPr,
    updatePurchaseOrderStatus: updatePurchaseOrderStatus,
    getFinishedGoodsItems: getFinishedGoodsItems,
    saveFinishedGoodsItem: saveFinishedGoodsItem,
    getFgReceipts: getFgReceipts,
    createFgReceipt: createFgReceipt,
    approveFgReceipt: approveFgReceipt,
    cancelFgReceipt: cancelFgReceipt,
    getDeliveryNotes: getDeliveryNotes,
    createDeliveryNote: createDeliveryNote,
    approveDeliveryNote: approveDeliveryNote,
    markDeliveryNoteDelivered: markDeliveryNoteDelivered,
    cancelDeliveryNote: cancelDeliveryNote,
    uploadDeliveryAttachment: uploadDeliveryAttachment,
    getCompanyDashboardSummary: getCompanyDashboardSummary,
    allocateFreeStockToRequest: allocateFreeStockToRequest,
    releaseRequestAllocation: releaseRequestAllocation,
    markRequestsZaloNotified: markRequestsZaloNotified,
    getReadyAllocatedRequests: getReadyAllocatedRequests,
    getWmsNotifications: getWmsNotifications,
    markNotificationRead: markNotificationRead,
    subscribeNotifications: subscribeNotifications,
    getWmsPeriodLocks: getWmsPeriodLocks,
    setWmsPeriodLock: setWmsPeriodLock,
    getWmsAuditLogs: getWmsAuditLogs,
    transitionProjectWorkflow: transitionProjectWorkflow,
    getCutProgress: getCutProgress,
    getAllCutProgress: getAllCutProgress,
    updateCutStatus: updateCutStatus,
    resetCutProgress: resetCutProgress,
    isOffcutsTableReady: isOffcutsTableReady,
    getStockOffcuts: getStockOffcuts,
    addStockOffcut: addStockOffcut,
    saveOpeningBalanceOffcuts: saveOpeningBalanceOffcuts,
    updateStockOffcut: updateStockOffcut,
    deleteStockOffcut: deleteStockOffcut,
    consumeStockOffcuts: consumeStockOffcuts,
    getInventoryTransactions: getInventoryTransactions,
    addInventoryTransaction: addInventoryTransaction,
    checkProjectDispatchStatus: checkProjectDispatchStatus,
    dispatchProjectInventory: dispatchProjectInventory,
    returnProjectInventory: returnProjectInventory,
    extractIgsStoragePath: extractIgsStoragePath,
    downloadIgsBlob: downloadIgsBlob,
    downloadIgsFile: downloadIgsFile,
    getIgsSignedUrl: getIgsSignedUrl,
    uploadIgsFile: uploadIgsFile,
    subscribeTables: subscribeTables
  };
})(typeof window !== 'undefined' ? window : globalThis);
