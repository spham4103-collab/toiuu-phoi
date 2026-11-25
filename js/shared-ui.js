/**
 * ============================================================================
 * SHARED UI & WMS METADATA - XẾP PHÔI AN BÌNH (xepphoi.cloud)
 * Dùng chung cho cả 6 trang: /, /projects, /inventory, /vouchers, /cnc, /admin
 * ============================================================================
 */
(function (global) {
  'use strict';

  var ROLES = {
    admin: {
      key: 'admin',
      label: 'Quản Trị Viên',
      shortLabel: 'Admin',
      icon: '👑',
      pillClass: 'role-admin',
      desc: 'Toàn quyền tối cao hệ thống, nhân sự, chứng từ kho & duyệt/hủy đảo kho.'
    },
    engineer: {
      key: 'engineer',
      label: 'Kỹ Sư Thiết Kế',
      shortLabel: 'Kỹ sư',
      icon: '📐',
      pillClass: 'role-eng',
      desc: 'Quản lý dự án, bản vẽ CAD/Fusion 360, lập phiếu yêu cầu xuất & vật tư kho.'
    },
    warehouse: {
      key: 'warehouse',
      label: 'Thủ Kho',
      shortLabel: 'Thủ kho',
      icon: '📦',
      pillClass: 'role-warehouse',
      desc: 'Quản lý tồn kho, lập & duyệt phiếu Nhập/Xuất/Hoàn kho, kiểm kê vật tư.'
    },
    accountant: {
      key: 'accountant',
      label: 'Kế Toán / Mua Hàng',
      shortLabel: 'Kế toán',
      icon: '💼',
      pillClass: 'role-accountant',
      desc: 'Xem tồn kho/sổ cái, quản lý nhà cung cấp & lập phiếu Nhập mua mới chờ duyệt.'
    },
    operator: {
      key: 'operator',
      label: 'Thợ Máy CNC',
      shortLabel: 'Thợ CNC',
      icon: '👷',
      pillClass: 'role-op',
      desc: 'Xem sơ đồ cắt CNC, tích tiến độ cắt từng cây & báo cáo đề-xê dư.'
    }
  };

  var VALID_ROLES = ['admin', 'engineer', 'warehouse', 'accountant', 'operator'];

  var MATERIAL_GROUPS = {
    tube_1d: {
      key: 'tube_1d',
      label: 'Thép hộp / Ống (1D)',
      shortLabel: 'Hộp/Ống 1D',
      icon: '🪵',
      defaultUnit: 'cây',
      badgeClass: 'grp-tube_1d'
    },
    sheet_2d: {
      key: 'sheet_2d',
      label: 'Thép tấm / Inox (2D)',
      shortLabel: 'Thép tấm 2D',
      icon: '📐',
      defaultUnit: 'tấm',
      badgeClass: 'grp-sheet_2d'
    },
    solid_cnc: {
      key: 'solid_cnc',
      label: 'Phôi đặc CNC / Tiện',
      shortLabel: 'Phôi đặc CNC',
      icon: '🔩',
      defaultUnit: 'kg',
      badgeClass: 'grp-solid_cnc'
    },
    tooling: {
      key: 'tooling',
      label: 'Dao cụ cắt gọt CNC',
      shortLabel: 'Dao cụ CNC',
      icon: '🔧',
      defaultUnit: 'mũi',
      badgeClass: 'grp-tooling'
    },
    consumable: {
      key: 'consumable',
      label: 'Vật tư phụ & Tiêu hao',
      shortLabel: 'Vật tư phụ',
      icon: '🧰',
      defaultUnit: 'cái',
      badgeClass: 'grp-consumable'
    }
  };

  var SUB_CATEGORIES = {
    hop_vuong_cn: { key: 'hop_vuong_cn', label: 'Hộp vuông / Chữ nhật', group: 'tube_1d' },
    ong_tron: { key: 'ong_tron', label: 'Ống tròn', group: 'tube_1d' },
    thep_v: { key: 'thep_v', label: 'Thép V', group: 'tube_1d' },
    thep_u: { key: 'thep_u', label: 'Thép U', group: 'tube_1d' },
    thep_i: { key: 'thep_i', label: 'Thép I', group: 'tube_1d' },
    thep_la: { key: 'thep_la', label: 'Thép La', group: 'tube_1d' },
    tam_thep_den: { key: 'tam_thep_den', label: 'Tấm thép đen', group: 'sheet_2d' },
    tam_inox: { key: 'tam_inox', label: 'Tấm Inox', group: 'sheet_2d' },
    tam_nhom: { key: 'tam_nhom', label: 'Tấm Nhôm', group: 'sheet_2d' },
    tam_nhua_phip: { key: 'tam_nhua_phip', label: 'Tấm Nhựa / Phíp', group: 'sheet_2d' },
    lap_tron_dac: { key: 'lap_tron_dac', label: 'Láp tròn đặc', group: 'solid_cnc' },
    phoi_khoi_cn: { key: 'phoi_khoi_cn', label: 'Phôi khối / Thanh chữ nhật', group: 'solid_cnc' },
    ong_duc_day: { key: 'ong_duc_day', label: 'Ống đúc dày', group: 'solid_cnc' },
    dao_phay: { key: 'dao_phay', label: 'Dao phay (Endmill / Mặt)', group: 'tooling' },
    chip_cat: { key: 'chip_cat', label: 'Chíp cắt (Insert APMT/CNMG...)', group: 'tooling' },
    mui_khoan: { key: 'mui_khoan', label: 'Mũi khoan (HSS / Carbide)', group: 'tooling' },
    mui_taro: { key: 'mui_taro', label: 'Mũi taro ren', group: 'tooling' },
    bau_kep_do: { key: 'bau_kep_do', label: 'Bầu kẹp / Collet / Dụng cụ đo', group: 'tooling' },
    vat_tu_laser: { key: 'vat_tu_laser', label: 'Vật tư Laser (Béc, Kính, Gốm...)', group: 'consumable' },
    vat_tu_han_mai: { key: 'vat_tu_han_mai', label: 'Que hàn, Dây hàn, Đá cắt/mài', group: 'consumable' },
    bulong_ocvit: { key: 'bulong_ocvit', label: 'Bu-lông, Ốc vít, Long đền', group: 'consumable' },
    vong_bi_phukien: { key: 'vong_bi_phukien', label: 'Vòng bi, Ray trượt, Bản lề', group: 'consumable' },
    dau_son_hoachat: { key: 'dau_son_hoachat', label: 'Dầu cắt gọt, Sơn, Hóa chất', group: 'consumable' },
    khac: { key: 'khac', label: 'Khác', group: 'all' }
  };

  var ISSUE_REASONS = {
    new: { key: 'new', label: 'Cấp mới', shortLabel: 'Cấp mới' },
    worn_exchange: { key: 'worn_exchange', label: 'Đổi mòn tự nhiên', shortLabel: 'Đổi mòn' },
    broken_exchange: { key: 'broken_exchange', label: 'Đổi gãy / mẻ', shortLabel: 'Gãy/Mẻ' },
    borrow: { key: 'borrow', label: 'Mượn dụng cụ', shortLabel: 'Mượn' },
    return_tool: { key: 'return_tool', label: 'Trả dụng cụ', shortLabel: 'Trả dụng cụ' }
  };

  var MACHINES = ['CNC Phay', 'CNC Tiện', 'Laser Ống', 'Laser Tấm', 'Tổ Hàn', 'Tổ Lắp Ráp', 'Kho / Chung'];

  var WORK_STAGES = {
    laser_sheet: { key: 'laser_sheet', label: 'Cắt Laser Tấm', shortLabel: 'Laser Tấm', icon: '📐' },
    cnc_mill_turn: { key: 'cnc_mill_turn', label: 'Phay / Tiện CNC', shortLabel: 'Phay/Tiện CNC', icon: '🔩' },
    laser_tube: { key: 'laser_tube', label: 'Thép hình / Laser Ống', shortLabel: 'Thép hình 1D', icon: '🪵' },
    welding_assembly: { key: 'welding_assembly', label: 'Hàn / Lắp ráp', shortLabel: 'Hàn/Lắp ráp', icon: '🔥' },
    consumable_tooling: { key: 'consumable_tooling', label: 'Vật tư phụ & Dao cụ', shortLabel: 'Vật tư/Dao cụ', icon: '🔧' },
    outsourced: { key: 'outsourced', label: 'Gia công / Mua ngoài', shortLabel: 'Mua ngoài', icon: '🛒' }
  };

  var MATERIAL_DENSITIES = {
    'SS400': 7.85,
    'CT3': 7.85,
    'S45C': 7.85,
    'SUS 304': 7.93,
    'SUS 430': 7.93,
    'SUS 201': 7.93,
    'Nhôm 6061': 2.70,
    'Nhôm 5052': 2.68,
    'Thép 2083': 7.80,
    'SKD11': 7.85,
    'POM': 1.41,
    'Nhựa phíp': 1.35,
    'Phíp': 1.35,
    'Đồng thau': 8.50
  };

  var UNITS = ['cây', 'tấm', 'kg', 'cái', 'mũi', 'viên', 'bộ', 'hộp', 'vỉ', 'cuộn', 'can', 'lít', 'm', 'đoạn'];

  var NAV_ITEMS = [
    { key: 'index', href: '/', label: '📐 Bàn Xếp Phôi', badgeId: '' },
    { key: 'projects', href: '/projects', label: '📁 Quản Lý Dự Án', badgeId: 'subnavProjBadge' },
    { key: 'inventory', href: '/inventory', label: '📦 Kho Phôi & Quy Cách', badgeId: '' },
    { key: 'vouchers', href: '/vouchers', label: '🧾 Phiếu Nhập / Xuất', badgeId: 'subnavVouchersBadge' },
    { key: 'reports', href: '/reports', label: '📊 Báo Cáo', cls: 'reports-nav-link', id: 'navLinkReports', priceOnly: true },
    { key: 'cnc', href: '/cnc', label: '⚡ Sơ Đồ & Tiến Độ CNC', badgeId: '' },
    { key: 'admin', href: '/admin', label: '⚙️ Quản Trị & Nhân Sự', adminOnly: true, cls: 'subnav-admin', id: 'navLinkAdmin' }
  ];

  function getRoleMeta(role) {
    var r = String(role || 'operator').trim().toLowerCase();
    return ROLES[r] || ROLES.operator;
  }

  function getMaterialGroupMeta(groupKey) {
    var g = String(groupKey || 'tube_1d').trim();
    return MATERIAL_GROUPS[g] || MATERIAL_GROUPS.tube_1d;
  }

  function canManageInventory(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'engineer' || r === 'warehouse';
  }

  function canCreateVouchers(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'engineer' || r === 'warehouse' || r === 'accountant';
  }

  function canApproveVouchers(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'warehouse';
  }

  function canManageSuppliers(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'accountant';
  }

  function canDeleteInventory(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'warehouse';
  }

  var _wmsSettingsCache = { allow_engineer_view_price: false };

  async function loadWmsSettings() {
    if (!global.SupabaseDB || typeof global.SupabaseDB.getWmsSettings !== 'function') {
      return _wmsSettingsCache;
    }
    try {
      var res = await global.SupabaseDB.getWmsSettings();
      if (res && typeof res === 'object') {
        _wmsSettingsCache = Object.assign({ allow_engineer_view_price: false }, res);
      }
    } catch (e) {}
    return _wmsSettingsCache;
  }

  function getCachedWmsSettings() {
    return _wmsSettingsCache;
  }

  function canViewPrices(user, settingsOverride) {
    var r = user && user.role;
    if (r === 'admin' || r === 'accountant') return true;
    if (r === 'engineer') {
      var s = settingsOverride || _wmsSettingsCache || {};
      return Boolean(s.allow_engineer_view_price === true || s.allow_engineer_view_price === 'true');
    }
    return false;
  }

  function applyPriceVisibilityUI(user, settingsOverride) {
    var allowed = canViewPrices(user, settingsOverride);
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('hide-prices', !allowed);
      document.body.classList.toggle('hide-reports-nav', !allowed);
      var navRep = document.getElementById('navLinkReports');
      if (navRep) navRep.style.display = allowed ? 'inline-flex' : 'none';
      document.querySelectorAll('.reports-nav-link').forEach(function (el) {
        el.style.display = allowed ? 'inline-flex' : 'none';
      });
    }
    return allowed;
  }

  function renderSubnav(container, activeKey, opts) {
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    var options = opts || {};
    var isAdmin = Boolean(options.isAdmin);
    var html = NAV_ITEMS.map(function (it) {
      if (it.adminOnly && !isAdmin && !options.keepHiddenAdmin) return '';
      var isAct = it.key === activeKey;
      var cls = 'subnav-link' + (it.cls ? ' ' + it.cls : '') + (isAct ? ' active' : '');
      var style = (it.adminOnly && !isAdmin) ? ' style="display:none;"' : '';
      var idAttr = it.id ? (' id="' + it.id + '"') : '';
      var badgeHtml = '';
      if (it.badgeId) {
        var bVal = (options.badges && options.badges[it.key] != null) ? options.badges[it.key] : 0;
        badgeHtml = ' <span id="' + it.badgeId + '" style="background:#0F766E;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:800;">' + bVal + '</span>';
      }
      return '<a href="' + it.href + '" class="' + cls + '"' + idAttr + style + '>' + it.label + badgeHtml + '</a>';
    }).join('');
    el.innerHTML = html;
  }

  function compressImageFile(file, maxBytes, maxDim) {
    var targetBytes = Number(maxBytes) || (300 * 1024);
    var limitDim = Number(maxDim) || 1600;
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Chưa chọn tệp ảnh'));
      if (!/^image\//i.test(file.type || '')) {
        if (file.size <= 4 * 1024 * 1024) return resolve(file);
        return reject(new Error('Tệp đính kèm không phải ảnh và vượt quá 4MB'));
      }
      if (file.size <= targetBytes && typeof HTMLCanvasElement === 'undefined') {
        return resolve(file);
      }

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Không đọc được file ảnh')); };
      reader.onload = function (ev) {
        var img = new Image();
        img.onerror = function () { reject(new Error('Không giải mã được định dạng ảnh')); };
        img.onload = function () {
          var w = img.naturalWidth || img.width || 800;
          var h = img.naturalHeight || img.height || 600;
          var scale = Math.min(1, limitDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));

          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);

          function tryQuality(q) {
            canvas.toBlob(function (blob) {
              if (!blob) return reject(new Error('Không nén được ảnh'));
              if (blob.size <= targetBytes || q <= 0.35) {
                resolve(blob);
              } else {
                tryQuality(Math.max(0.35, q - 0.15));
              }
            }, 'image/jpeg', q);
          }
          tryQuality(0.82);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function formatMoneyVN(val) {
    return Math.round(Number(val) || 0).toLocaleString('vi-VN');
  }

  function getSubCategoryLabel(key) {
    var k = String(key || '').trim();
    return (SUB_CATEGORIES[k] && SUB_CATEGORIES[k].label) || (k || '—');
  }

  function getIssueReasonLabel(key) {
    var k = String(key || 'new').trim();
    return (ISSUE_REASONS[k] && ISSUE_REASONS[k].shortLabel) || 'Cấp mới';
  }

  function convertPackToBase(qty, unitPrice, packQty, isPackMode) {
    var q = Math.max(0, Number(qty) || 0);
    var p = Math.max(0, Number(unitPrice) || 0);
    var pq = Math.max(1, Number(packQty) || 1);
    if (!isPackMode || pq <= 1) {
      return { baseQty: q, baseUnitPrice: p, totalAmount: Math.round(q * p) };
    }
    var baseQty = Math.round(q * pq * 1000) / 1000;
    var baseUnitPrice = Math.round((p / pq) * 100) / 100;
    return {
      baseQty: baseQty,
      baseUnitPrice: baseUnitPrice,
      totalAmount: Math.round(q * p)
    };
  }

  function getWorkStageMeta(stageKey) {
    var k = String(stageKey || 'laser_sheet').trim();
    return WORK_STAGES[k] || WORK_STAGES.laser_sheet;
  }

  function calcMaterialWeightKg(opts) {
    var o = opts || {};
    var shape = String(o.shape || 'plate').toLowerCase();
    var grade = String(o.grade || 'SS400').trim();
    var density = Number(o.customDensity) > 0
      ? Number(o.customDensity)
      : (MATERIAL_DENSITIES[grade] || 7.85);
    var volCm3 = 0;
    if (shape === 'round' || shape === 'cylinder') {
      var dMm = Math.max(0, Number(o.diameterMm) || 0);
      var lMm = Math.max(0, Number(o.lengthMm) || 0);
      var rCm = (dMm / 10) / 2;
      var lCm = lMm / 10;
      volCm3 = Math.PI * rCm * rCm * lCm;
    } else {
      var lenMm = Math.max(0, Number(o.lengthMm) || 0);
      var widMm = Math.max(0, Number(o.widthMm) || 0);
      var thkMm = Math.max(0, Number(o.thicknessMm) || 0);
      volCm3 = (lenMm / 10) * (widMm / 10) * (thkMm / 10);
    }
    var kg = (volCm3 * density) / 1000;
    return Math.round(kg * 1000) / 1000;
  }

  function _detectMaterialGrade(rawLower) {
    if (/sus\s*430|inox\s*430|\b430\b/.test(rawLower)) return 'SUS 430';
    if (/sus\s*304|inox\s*304|\b304\b/.test(rawLower)) return 'SUS 304';
    if (/sus\s*201|inox\s*201|\b201\b/.test(rawLower)) return 'SUS 201';
    if (/nh[oô]m\s*6061|\b6061\b|a6061/.test(rawLower)) return 'Nhôm 6061';
    if (/nh[oô]m\s*5052|\b5052\b|a5052/.test(rawLower)) return 'Nhôm 5052';
    if (/\b2083\b/.test(rawLower)) return 'Thép 2083';
    if (/skd\s*11/.test(rawLower)) return 'SKD11';
    if (/s45c|c45/.test(rawLower)) return 'S45C';
    if (/ss400/.test(rawLower)) return 'SS400';
    if (/\bct3\b/.test(rawLower)) return 'CT3';
    if (/\bpom\b/.test(rawLower)) return 'POM';
    if (/ph[ií]p|bakelite/.test(rawLower)) return 'Nhựa phíp';
    if (/[đd][ồô]ng\s*thau|brass/.test(rawLower)) return 'Đồng thau';
    if (/inox/.test(rawLower)) return 'SUS 304';
    if (/nh[oô]m/.test(rawLower)) return 'Nhôm 6061';
    return '';
  }

  function parseSmartMaterialSpec(rawText) {
    var text = String(rawText || '').trim();
    var lower = text.toLowerCase();
    var grade = _detectMaterialGrade(lower);
    var result = {
      rawText: text,
      materialGroup: 'tube_1d',
      subCategory: 'hop_vuong_cn',
      materialGrade: grade,
      unit: 'cây',
      standardLengthMm: 6000,
      thicknessMm: 0,
      widthMm: 0,
      lengthMm: 0,
      diameterMm: 0,
      sectionSpec: '',
      weightKg: 0,
      specJson: {}
    };
    if (!text) return result;

    // 1. Dao cụ CNC
    if (/dao\s*phay|endmill|ch[ií]p|insert|apmt|cnmg|wnmg|m[uũ]i\s*khoan|taro|collet|b[aầ]u\s*k[eẹ]p/.test(lower)) {
      result.materialGroup = 'tooling';
      result.unit = /ch[ií]p|insert|apmt|cnmg|wnmg/.test(lower) ? 'viên' : (/taro|khoan/.test(lower) ? 'mũi' : 'cái');
      result.standardLengthMm = 100;
      if (/ch[ií]p|insert|apmt|cnmg|wnmg/.test(lower)) result.subCategory = 'chip_cat';
      else if (/khoan/.test(lower)) result.subCategory = 'mui_khoan';
      else if (/taro/.test(lower)) result.subCategory = 'mui_taro';
      else if (/collet|k[eẹ]p/.test(lower)) result.subCategory = 'bau_kep_do';
      else result.subCategory = 'dao_phay';
      return result;
    }

    // 2. Vật tư phụ & tiêu hao
    if (/que\s*h[aà]n|d[aâ]y\s*h[aà]n|[đd][aá]\s*c[aắ]t|[đd][aá]\s*m[aà]i|bu[\s-]*l[oô]ng|[oố]c\s*v[ií]t|v[oò]ng\s*bi|b[eé]c|k[ií]nh\s*b[aả]o|d[aầ]u\s*c[aắ]t|s[oơ]n/.test(lower)) {
      result.materialGroup = 'consumable';
      result.standardLengthMm = 100;
      if (/que\s*h[aà]n|d[aâ]y\s*h[aà]n|[đd][aá]/.test(lower)) {
        result.subCategory = 'vat_tu_han_mai';
        result.unit = /que|d[aâ]y/.test(lower) ? 'kg' : 'cái';
      } else if (/bu[\s-]*l[oô]ng|[oố]c/.test(lower)) {
        result.subCategory = 'bulong_ocvit';
        result.unit = 'cái';
      } else if (/v[oò]ng\s*bi/.test(lower)) {
        result.subCategory = 'vong_bi_phukien';
        result.unit = 'cái';
      } else if (/b[eé]c|k[ií]nh/.test(lower)) {
        result.subCategory = 'vat_tu_laser';
        result.unit = 'cái';
      } else {
        result.subCategory = 'dau_son_hoachat';
        result.unit = 'can';
      }
      return result;
    }

    var triMatch = text.match(/(\d+(?:[.,]\d+)?)\s*[xX\*×]\s*(\d+(?:[.,]\d+)?)\s*[xX\*×]\s*(\d+(?:[.,]\d+)?)/);
    var roundMatch = text.match(/(?:[dD]|Ø|ø|[pP]hi)\s*(\d+(?:[.,]\d+)?)\s*[xX\*×]\s*(\d+(?:[.,]\d+)?)/);

    // 3. Phôi đặc CNC
    if (/l[aá]p|tr[oò]n\s*[đd][aặ]c|tr[uụ]c\s*[đd][aặ]c|ph[oô]i\s*kh[oố]i|ph[oô]i\s*[đd][aặ]c|[oố]ng\s*[đd][uú]c/.test(lower)) {
      result.materialGroup = 'solid_cnc';
      var cncGrade = grade || 'SS400';
      if (/[oố]ng\s*[đd][uú]c/.test(lower)) {
        result.subCategory = 'ong_duc_day';
      } else if (roundMatch && !triMatch) {
        var dVal = parseFloat(roundMatch[1].replace(',', '.'));
        var lVal = parseFloat(roundMatch[2].replace(',', '.'));
        result.subCategory = 'lap_tron_dac';
        result.diameterMm = dVal;
        result.lengthMm = lVal;
        result.standardLengthMm = lVal;
        result.unit = lVal <= 500 ? 'cục' : 'cây';
        result.weightKg = calcMaterialWeightKg({ shape: 'round', diameterMm: dVal, lengthMm: lVal, grade: cncGrade });
        result.specJson = { shape: 'round', material_grade: cncGrade, diameter_mm: dVal, length_mm: lVal, weight_kg: result.weightKg };
        return result;
      } else if (triMatch) {
        var nums = [
          parseFloat(triMatch[1].replace(',', '.')),
          parseFloat(triMatch[2].replace(',', '.')),
          parseFloat(triMatch[3].replace(',', '.'))
        ].sort(function (a, b) { return a - b; });
        result.subCategory = 'phoi_khoi_cn';
        result.thicknessMm = nums[0];
        result.widthMm = nums[1];
        result.lengthMm = nums[2];
        result.standardLengthMm = nums[2];
        result.unit = 'cục';
        result.weightKg = calcMaterialWeightKg({ shape: 'plate', thicknessMm: nums[0], widthMm: nums[1], lengthMm: nums[2], grade: cncGrade });
        result.specJson = { shape: 'plate', material_grade: cncGrade, thickness_mm: nums[0], width_mm: nums[1], length_mm: nums[2], weight_kg: result.weightKg };
        return result;
      }
      return result;
    }

    // 4. Thép tấm / Inox tấm / Nhôm tấm (sheet_2d)
    var isSheetKeyword = /t[aấ]m|plate|sheet|t[oô]n|\b[tT]\s*\d/.test(lower);
    var isBigPlateDims = false;
    if (triMatch) {
      var sNums = [
        parseFloat(triMatch[1].replace(',', '.')),
        parseFloat(triMatch[2].replace(',', '.')),
        parseFloat(triMatch[3].replace(',', '.'))
      ].sort(function (a, b) { return a - b; });
      if (sNums[1] >= 300 && sNums[2] >= 600) isBigPlateDims = true;
    }
    if (isSheetKeyword || isBigPlateDims) {
      result.materialGroup = 'sheet_2d';
      result.unit = 'tấm';
      var sheetGrade = grade || 'SS400';
      if (/sus|inox/.test(lower)) result.subCategory = 'tam_inox';
      else if (/nh[oô]m|6061|5052/.test(lower)) result.subCategory = 'tam_nhom';
      else if (/ph[ií]p|pom|nh[uự]a/.test(lower)) result.subCategory = 'tam_nhua_phip';
      else result.subCategory = 'tam_thep_den';
      if (triMatch) {
        var pNums = [
          parseFloat(triMatch[1].replace(',', '.')),
          parseFloat(triMatch[2].replace(',', '.')),
          parseFloat(triMatch[3].replace(',', '.'))
        ].sort(function (a, b) { return a - b; });
        result.thicknessMm = pNums[0];
        result.widthMm = pNums[1];
        result.lengthMm = pNums[2];
        result.standardLengthMm = pNums[2];
        result.weightKg = calcMaterialWeightKg({ shape: 'plate', thicknessMm: pNums[0], widthMm: pNums[1], lengthMm: pNums[2], grade: sheetGrade });
        result.specJson = { shape: 'plate', material_grade: sheetGrade, thickness_mm: pNums[0], width_mm: pNums[1], length_mm: pNums[2], weight_kg: result.weightKg };
      } else {
        result.standardLengthMm = 2440;
      }
      return result;
    }

    // 5. Thép hình / Ống (tube_1d)
    result.materialGroup = 'tube_1d';
    result.unit = 'cây';
    result.standardLengthMm = 6000;
    if (/(?:^|\s)[vV]\s*\d+|th[eé]p\s*v\b/.test(text)) {
      result.subCategory = 'thep_v';
      result.sectionSpec = triMatch ? ('V' + triMatch[1] + 'x' + triMatch[2] + 'x' + triMatch[3]) : text;
    } else if (/(?:^|\s)[uU]\s*\d+|th[eé]p\s*u\b/.test(text)) {
      result.subCategory = 'thep_u';
      result.sectionSpec = text;
    } else if (/(?:^|\s)[iI]\s*\d+|th[eé]p\s*i\b/.test(text)) {
      result.subCategory = 'thep_i';
      result.sectionSpec = text;
    } else if (/th[eé]p\s*la\b|(?:^|\s)la\s+\d+/.test(lower)) {
      result.subCategory = 'thep_la';
      result.sectionSpec = text;
    } else if (/[oố]ng|phi|ø|Ø|\b[dD]\d+/.test(text) && roundMatch) {
      result.subCategory = 'ong_tron';
      result.sectionSpec = 'D' + roundMatch[1] + 'x' + roundMatch[2];
    } else {
      result.subCategory = 'hop_vuong_cn';
      result.sectionSpec = triMatch ? (triMatch[1] + 'x' + triMatch[2] + 'x' + triMatch[3]) : text;
    }
    result.specJson = { shape: 'tube', material_grade: grade || 'SS400', section_spec: result.sectionSpec };
    return result;
  }

  var _pendingVouchersUnsub = null;
  var _pendingVouchersTimer = null;

  async function refreshPendingVouchersBadge() {
    if (!global.SupabaseDB || typeof global.SupabaseDB.getPendingVouchersCount !== 'function') return 0;
    try {
      var cnt = await global.SupabaseDB.getPendingVouchersCount();
      var links = document.querySelectorAll('a[href="/vouchers"]');
      links.forEach(function (link) {
        var badge = link.querySelector('#subnavVouchersBadge, .vouchers-pending-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'vouchers-pending-badge';
          badge.style.cssText = 'background:#EA580C;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:800;margin-left:4px;display:none;';
          link.appendChild(badge);
        }
        badge.textContent = String(cnt);
        badge.style.display = cnt > 0 ? 'inline-block' : 'none';
      });
      return cnt;
    } catch (e) {
      return 0;
    }
  }

  function initPendingVouchersBadge() {
    refreshPendingVouchersBadge();
    if (_pendingVouchersUnsub || !global.SupabaseDB || !global.SupabaseDB.isConfigured()) return;
    try {
      _pendingVouchersUnsub = global.SupabaseDB.subscribeTables({
        warehouse_vouchers: function () {
          clearTimeout(_pendingVouchersTimer);
          _pendingVouchersTimer = setTimeout(refreshPendingVouchersBadge, 300);
        }
      });
    } catch (e) {}
  }

  global.SharedUI = {
    ROLES: ROLES,
    VALID_ROLES: VALID_ROLES,
    MATERIAL_GROUPS: MATERIAL_GROUPS,
    SUB_CATEGORIES: SUB_CATEGORIES,
    ISSUE_REASONS: ISSUE_REASONS,
    MACHINES: MACHINES,
    WORK_STAGES: WORK_STAGES,
    MATERIAL_DENSITIES: MATERIAL_DENSITIES,
    UNITS: UNITS,
    NAV_ITEMS: NAV_ITEMS,
    getRoleMeta: getRoleMeta,
    getMaterialGroupMeta: getMaterialGroupMeta,
    getSubCategoryLabel: getSubCategoryLabel,
    getIssueReasonLabel: getIssueReasonLabel,
    getWorkStageMeta: getWorkStageMeta,
    calcMaterialWeightKg: calcMaterialWeightKg,
    parseSmartMaterialSpec: parseSmartMaterialSpec,
    convertPackToBase: convertPackToBase,
    canManageInventory: canManageInventory,
    canDeleteInventory: canDeleteInventory,
    canCreateVouchers: canCreateVouchers,
    canApproveVouchers: canApproveVouchers,
    canManageSuppliers: canManageSuppliers,
    loadWmsSettings: loadWmsSettings,
    getCachedWmsSettings: getCachedWmsSettings,
    canViewPrices: canViewPrices,
    applyPriceVisibilityUI: applyPriceVisibilityUI,
    renderSubnav: renderSubnav,
    compressImageFile: compressImageFile,
    formatMoneyVN: formatMoneyVN,
    refreshPendingVouchersBadge: refreshPendingVouchersBadge,
    initPendingVouchersBadge: initPendingVouchersBadge
  };
})(typeof window !== 'undefined' ? window : globalThis);
