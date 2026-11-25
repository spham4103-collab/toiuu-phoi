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
    sales: {
      key: 'sales',
      label: 'Kinh Doanh',
      shortLabel: 'Kinh doanh',
      icon: '🤝',
      pillClass: 'role-sales',
      desc: 'Quản lý đơn hàng/dự án, tạo đề nghị vật tư, xem tồn kho khả dụng (ẩn đơn giá).'
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

  var VALID_ROLES = ['admin', 'sales', 'engineer', 'warehouse', 'accountant', 'operator'];

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
    { key: 'index', href: '/', label: '🏠 Tổng quan', badgeId: '' },
    { key: 'inventory', href: '/inventory', label: '📦 Kho vật tư', badgeId: '' },
    { key: 'vouchers', href: '/vouchers', label: '🧾 Phiếu kho', badgeId: 'subnavVouchersBadge' },
    { key: 'purchasing', href: '/purchasing', label: '🛒 Mua hàng', badgeId: 'subnavPrBadge' },
    { key: 'delivery', href: '/delivery', label: '🚚 Giao hàng', badgeId: '' },
    { key: 'projects', href: '/projects', label: '📁 Dự án', badgeId: 'subnavProjBadge' },
    { key: 'reports', href: '/reports', label: '📊 Báo cáo', cls: 'reports-nav-link', id: 'navLinkReports', priceOnly: true },
    { key: 'admin', href: '/admin', label: '🛡️ Quản trị', adminOnly: true, cls: 'subnav-admin', id: 'navLinkAdmin' }
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

  function canApprovePR(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'accountant';
  }

  function canAccessPurchasing(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'accountant' || r === 'warehouse' || r === 'engineer';
  }

  function canAccessDelivery(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'accountant' || r === 'warehouse' || r === 'engineer';
  }

  function canAllocateStock(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'warehouse';
  }

  function canManageProjects(user) {
    var r = user && user.role;
    return r === 'admin' || r === 'engineer' || r === 'sales';
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
    var isSales = Boolean(user && user.role === 'sales');
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('hide-prices', !allowed);
      document.body.classList.toggle('hide-reports-nav', !allowed);
      document.body.classList.toggle('role-sales', isSales);
      var navRep = document.getElementById('navLinkReports');
      if (navRep) navRep.style.display = allowed ? 'inline-flex' : 'none';
      document.querySelectorAll('.reports-nav-link').forEach(function (el) {
        el.style.display = allowed ? 'inline-flex' : 'none';
      });
      if (isSales) {
        document.querySelectorAll('.subnav-bar a.subnav-link').forEach(function (a) {
          var href = a.getAttribute('href') || '';
          var allowSales = href === '/' || href === '/projects' || href === '/inventory';
          a.style.display = allowSales ? 'inline-flex' : 'none';
        });
      }
      if (user && typeof initNotificationBell === 'function') {
        initNotificationBell(user);
      }
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
    refreshPendingPrBadge();
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

  async function refreshPendingPrBadge() {
    if (!global.SupabaseDB || typeof global.SupabaseDB.getPendingPrCount !== 'function') return 0;
    try {
      var cnt = await global.SupabaseDB.getPendingPrCount();
      var links = document.querySelectorAll('a[href="/purchasing"]');
      links.forEach(function (link) {
        var badge = link.querySelector('#subnavPrBadge, .pr-pending-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'pr-pending-badge';
          badge.style.cssText = 'background:#D97706;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:800;margin-left:4px;display:none;';
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

  function initPendingPrBadge() {
    refreshPendingPrBadge();
  }

  function initStickySection(toolbarEl, tableEl, scrollContainer, opts) {
    if (!toolbarEl) return { refresh: function () {}, destroy: function () {} };
    if (
      (toolbarEl.closest && toolbarEl.closest('.inv-modal, .bom-dialog, .xp-modal-3tier')) ||
      (tableEl && tableEl.closest && tableEl.closest('.xp-modal-table-scroll'))
    ) {
      return { refresh: function () {}, destroy: function () {} };
    }
    if (typeof toolbarEl._xpStickyCleanup === 'function') {
      try { toolbarEl._xpStickyCleanup(); } catch (e) {}
    }

    var isWindow = !scrollContainer || scrollContainer === window || scrollContainer === document.documentElement;
    var headerEl = isWindow ? document.querySelector('header.top') : null;
    var parentEl = toolbarEl.parentElement;
    if (parentEl && getComputedStyle(parentEl).overflow === 'hidden') {
      parentEl.style.overflow = 'visible';
    }

    var sentinel = toolbarEl.previousElementSibling;
    if (!sentinel || !sentinel.classList || !sentinel.classList.contains('xp-sticky-sentinel')) {
      sentinel = document.createElement('div');
      sentinel.className = 'xp-sticky-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      toolbarEl.parentNode.insertBefore(sentinel, toolbarEl);
    }

    var offsetTop = 0;
    function syncHeights() {
      offsetTop = (isWindow && headerEl) ? Math.max(0, Math.floor(headerEl.getBoundingClientRect().bottom)) : 0;
      var entryH = Math.floor(toolbarEl.getBoundingClientRect().height);
      var theadTop = isWindow
        ? (toolbarEl.classList.contains('is-stuck')
            ? Math.max(0, Math.floor(toolbarEl.getBoundingClientRect().bottom - 1))
            : Math.max(0, offsetTop + entryH - 1))
        : Math.max(0, entryH - 1);

      if (isWindow) {
        document.documentElement.style.setProperty('--top-nav-height', offsetTop + 'px');
      }
      if (parentEl) {
        parentEl.style.setProperty('--xp-sticky-offset', offsetTop + 'px');
        parentEl.style.setProperty('--sticky-entry-height', entryH + 'px');
        parentEl.style.setProperty('--xp-sticky-thead-top', theadTop + 'px');
      }
      if (tableEl) {
        tableEl.style.setProperty('--xp-sticky-offset', offsetTop + 'px');
        tableEl.style.setProperty('--sticky-entry-height', entryH + 'px');
        tableEl.style.setProperty('--xp-sticky-thead-top', theadTop + 'px');
      }
    }
    syncHeights();

    var io = null;
    var toggleBtn = toolbarEl.querySelector('[data-sticky-toggle]');
    function updateStuckState(isIntersecting, rectTop) {
      var rootTop = isWindow ? offsetTop : scrollContainer.getBoundingClientRect().top;
      var stuck = !isIntersecting && rectTop <= rootTop + 2;
      var changed = toolbarEl.classList.contains('is-stuck') !== stuck;
      toolbarEl.classList.toggle('is-stuck', stuck);
      if (!stuck) {
        toolbarEl.classList.remove('mobile-expanded');
        if (toggleBtn) toggleBtn.textContent = 'Mở rộng ô nhập ▾';
      }
      if (changed || stuck) syncHeights();
    }

    function bindIO() {
      if (io) io.disconnect();
      if (typeof IntersectionObserver !== 'undefined') {
        io = new IntersectionObserver(function (entries) {
          var entry = entries[0];
          if (!entry) return;
          updateStuckState(entry.isIntersecting, entry.boundingClientRect.top);
        }, {
          root: isWindow ? null : scrollContainer,
          rootMargin: '-' + (offsetTop + 1) + 'px 0px 0px 0px',
          threshold: 0
        });
        io.observe(sentinel);
      }
    }
    bindIO();

    var rafId = 0;
    var scrollTarget = isWindow ? window : scrollContainer;
    function onScroll() {
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = 0;
        var sTop = sentinel.getBoundingClientRect().top;
        var rootTop = isWindow ? offsetTop : scrollContainer.getBoundingClientRect().top;
        updateStuckState(sTop > rootTop + 1, sTop);
      });
    }
    if (scrollTarget && scrollTarget.addEventListener) {
      scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    }

    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () {
        var prevOffset = offsetTop;
        syncHeights();
        if (prevOffset !== offsetTop) bindIO();
      });
      ro.observe(toolbarEl);
      if (headerEl) ro.observe(headerEl);
    }

    var onToggleClick = null;
    if (toggleBtn) {
      onToggleClick = function () {
        var expanded = toolbarEl.classList.toggle('mobile-expanded');
        toggleBtn.textContent = expanded ? 'Thu gọn ▴' : 'Mở rộng ô nhập ▾';
        syncHeights();
      };
      toggleBtn.addEventListener('click', onToggleClick);
    }

    function destroy() {
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollTarget && scrollTarget.removeEventListener) {
        scrollTarget.removeEventListener('scroll', onScroll);
      }
      if (toggleBtn && onToggleClick) toggleBtn.removeEventListener('click', onToggleClick);
      toolbarEl._xpStickyCleanup = null;
    }

    toolbarEl._xpStickyCleanup = destroy;
    return { refresh: syncHeights, destroy: destroy };
  }

  var _notifBellInitFor = null;
  var _notifRealtimeUnsub = null;
  function initNotificationBell(user) {
    if (typeof document === 'undefined' || !user) return;
    if (_notifBellInitFor === (user.id || user.username)) return;
    var topActions = document.querySelector('.top-actions');
    if (!topActions) return;
    _notifBellInitFor = user.id || user.username;

    var wrap = document.getElementById('wmsNotifWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'wmsNotifWrap';
      wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;';
      wrap.innerHTML =
        '<button type="button" id="btnWmsNotifBell" class="btn btn-soft btn-sm" title="Thông báo kho & đơn hàng" style="position:relative;min-height:32px;padding:4px 10px;">' +
        '🔔 <span id="wmsNotifBadge" style="display:none;background:#DC2626;color:#fff;font-size:10.5px;font-weight:800;padding:1px 5px;border-radius:999px;margin-left:2px;">0</span>' +
        '</button>' +
        '<div id="wmsNotifDropdown" style="display:none;position:absolute;top:110%;right:0;width:min(360px,90vw);max-height:420px;overflow-y:auto;background:#fff;border:1.5px solid #CBD5E1;border-radius:12px;box-shadow:0 18px 40px rgba(15,23,42,0.2);z-index:2500;padding:10px;">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;border-bottom:1px solid #E2E8F0;margin-bottom:6px;">' +
        '    <strong style="font-size:13px;color:#0F172A;">🔔 Thông báo phôi & đơn hàng</strong>' +
        '    <button type="button" id="btnWmsNotifRefresh" style="border:none;background:none;color:#0F766E;font-size:12px;font-weight:700;cursor:pointer;">Làm mới</button>' +
        '  </div>' +
        '  <div id="wmsNotifList" style="font-size:12.5px;color:#334155;">Đang tải...</div>' +
        '</div>';
      var pill = document.getElementById('userBadgePill');
      if (pill && pill.parentNode === topActions) {
        topActions.insertBefore(wrap, pill);
      } else {
        topActions.insertBefore(wrap, topActions.firstChild);
      }
    }

    var bellBtn = document.getElementById('btnWmsNotifBell');
    var dropdown = document.getElementById('wmsNotifDropdown');
    var badge = document.getElementById('wmsNotifBadge');
    var listEl = document.getElementById('wmsNotifList');

    function escH(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }

    async function loadNotifs() {
      if (!global.SupabaseDB || typeof global.SupabaseDB.getWmsNotifications !== 'function') return;
      try {
        var rows = await global.SupabaseDB.getWmsNotifications(20);
        var uid = user.id || '';
        var unread = rows.filter(function (n) {
          return !Array.isArray(n.is_read_by) || n.is_read_by.indexOf(uid) === -1;
        });
        if (unread.length > 0) {
          badge.style.display = 'inline-block';
          badge.textContent = String(unread.length);
        } else {
          badge.style.display = 'none';
        }
        if (!rows.length) {
          listEl.innerHTML = '<div style="text-align:center;color:#94A3B8;padding:18px;">Chưa có thông báo mới.</div>';
          return;
        }
        listEl.innerHTML = rows.map(function (n) {
          var isUnread = !Array.isArray(n.is_read_by) || n.is_read_by.indexOf(uid) === -1;
          var targetHref = n.project_id ? ('/projects?id=' + encodeURIComponent(n.project_id)) : '/vouchers';
          return '<div class="wms-notif-item" data-id="' + escH(n.id) + '" data-href="' + escH(targetHref) + '" style="padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid ' + (isUnread ? '#99F6E4' : '#F1F5F9') + ';background:' + (isUnread ? '#F0FDFA' : '#fff') + ';">' +
            '<div style="font-weight:700;color:#0B3B38;font-size:12.5px;">' + escH(n.title) + '</div>' +
            '<div style="font-size:12px;color:#475569;margin-top:2px;">' + escH(n.message) + '</div>' +
            '<div style="font-size:10.5px;color:#94A3B8;margin-top:3px;">' + escH((n.created_at || '').slice(0, 16).replace('T', ' ')) + '</div>' +
          '</div>';
        }).join('');
        listEl.querySelectorAll('.wms-notif-item').forEach(function (el) {
          el.onclick = async function () {
            var nid = el.getAttribute('data-id');
            var href = el.getAttribute('data-href');
            if (nid && global.SupabaseDB && typeof global.SupabaseDB.markNotificationRead === 'function') {
              await global.SupabaseDB.markNotificationRead(nid).catch(function () {});
            }
            window.location.href = href;
          };
        });
      } catch (e) {}
    }

    bellBtn.onclick = function (e) {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      if (dropdown.style.display === 'block') loadNotifs();
    };
    document.getElementById('btnWmsNotifRefresh').onclick = function (e) {
      e.stopPropagation();
      loadNotifs();
    };
    document.addEventListener('click', function (e) {
      if (dropdown.style.display === 'block' && !wrap.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    loadNotifs();
    if (_notifRealtimeUnsub) { try { _notifRealtimeUnsub(); } catch (_) {} }
    if (global.SupabaseDB && typeof global.SupabaseDB.subscribeNotifications === 'function') {
      _notifRealtimeUnsub = global.SupabaseDB.subscribeNotifications(function () {
        loadNotifs();
      });
    }
  }

  function openZaloReadyModal(opts) {
    if (typeof document === 'undefined') return;
    var o = opts || {};
    var items = Array.isArray(o.items) ? o.items : [];
    var projectId = o.projectId || (items[0] && items[0].project_id) || '';
    var projectName = o.projectName || (items[0] && items[0].project_name) || projectId || 'Đơn hàng';
    var customerPoNo = o.customerPoNo || (items[0] && (items[0].customer_po_no || items[0].customerPoNo)) || '';
    var customer = o.customer || (items[0] && items[0].customer) || 'Khách hàng';
    var reqIds = items.map(function (it) { return it.request_id || it.id; }).filter(Boolean);

    var lines = items.map(function (it) {
      var rk = it.rack_location || it.rackLocation || 'Kho';
      return '  - ' + (it.item_name || it.itemName || '') + ' × ' + (it.qty || it.allocatedQty || 0) + ' ' + (it.unit || '') + ' (Kệ: ' + rk + ')';
    });
    var msgText = [
      '📦 PHÔI ĐÃ VỀ KHO — SẴN SÀNG LĨNH',
      '• Đơn hàng: ' + projectName + (customerPoNo ? ' | PO: ' + customerPoNo : '') + (customer ? ' (KH: ' + customer + ')' : ''),
      '• Vật tư vừa về:',
      lines.join('\n'),
      '• Trạng thái: Đã giữ riêng tại kho. Mời tổ Sản xuất cầm phiếu kẹp bản vẽ ra kho lĩnh phôi!',
      '🔗 Chi tiết: https://xepphoi.cloud/projects?id=' + encodeURIComponent(projectId)
    ].join('\n');

    var modal = document.getElementById('xpZaloReadyModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'xpZaloReadyModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.58);z-index:3500;display:none;align-items:center;justify-content:center;padding:14px;';
      modal.innerHTML =
        '<div style="background:#fff;border-radius:16px;border:1.5px solid #5EEAD4;width:min(560px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.28);">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#F0FDFA;border-bottom:1px solid #CCFBF1;">' +
        '    <h3 style="margin:0;font-size:16px;color:#0B3B38;">📲 Báo Hàng Về Nhóm Zalo &amp; Xuất Thẳng</h3>' +
        '    <button type="button" id="btnCloseZaloModal" class="btn btn-soft btn-sm">✕ Đóng</button>' +
        '  </div>' +
        '  <div style="padding:16px 18px;overflow-y:auto;">' +
        '    <p style="font-size:13px;color:#475569;margin:0 0 8px;">Phôi đã được giữ riêng cho đơn hàng. Chọn 1 chạm để báo nhóm Zalo xưởng hoặc xuất thẳng cho Sản xuất:</p>' +
        '    <textarea id="txtZaloReadyMsg" rows="8" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #CBD5E1;font-family:inherit;font-size:13px;line-height:1.45;"></textarea>' +
        '    <div id="zaloModalStatus" style="font-size:12px;color:#0F766E;font-weight:700;margin-top:6px;"></div>' +
        '  </div>' +
        '  <div style="padding:12px 18px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">' +
        '    <button type="button" id="btnZaloCopyOnly" class="btn btn-p btn-sm">📋 Copy tin nhắn dán Zalo</button>' +
        '    <button type="button" id="btnZaloNativeShare" class="btn btn-soft btn-sm">📤 Mở Zalo chia sẻ nhanh</button>' +
        '    <button type="button" id="btnZaloCrossDock" class="btn btn-cta btn-sm">⚡ Xuất thẳng cho Sản xuất (Tạo PXK ngay)</button>' +
        '  </div>' +
        '</div>';
      document.body.appendChild(modal);
      document.getElementById('btnCloseZaloModal').onclick = function () { modal.style.display = 'none'; };
    }

    document.getElementById('txtZaloReadyMsg').value = msgText;
    document.getElementById('zaloModalStatus').textContent = '';

    async function markNotified() {
      if (reqIds.length && global.SupabaseDB && typeof global.SupabaseDB.markRequestsZaloNotified === 'function') {
        await global.SupabaseDB.markRequestsZaloNotified(reqIds).catch(function () {});
      }
    }

    document.getElementById('btnZaloCopyOnly').onclick = async function () {
      var txt = document.getElementById('txtZaloReadyMsg').value;
      try { await navigator.clipboard.writeText(txt); } catch (_) {}
      await markNotified();
      document.getElementById('zaloModalStatus').textContent = '✅ Đã copy tin nhắn & đánh dấu Đã báo Zalo!';
    };

    document.getElementById('btnZaloNativeShare').onclick = async function () {
      var txt = document.getElementById('txtZaloReadyMsg').value;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Phôi đã về kho — ' + projectName, text: txt });
          await markNotified();
          document.getElementById('zaloModalStatus').textContent = '✅ Đã chia sẻ & đánh dấu Đã báo Zalo!';
          return;
        } catch (_) {}
      }
      try { await navigator.clipboard.writeText(txt); } catch (_) {}
      await markNotified();
      document.getElementById('zaloModalStatus').textContent = '✅ Đã copy tin nhắn (hãy dán vào nhóm Zalo)!';
    };

    document.getElementById('btnZaloCrossDock').onclick = function () {
      modal.style.display = 'none';
      if (typeof o.onCrossDock === 'function') {
        o.onCrossDock(items, projectId);
      } else {
        try {
          sessionStorage.setItem('xp_crossdock_pxk', JSON.stringify({
            projectId: projectId,
            projectName: projectName,
            items: items
          }));
        } catch (_) {}
        window.location.href = '/vouchers?new=OUT&from=crossdock';
      }
    };

    modal.style.display = 'flex';
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
    canApprovePR: canApprovePR,
    canAccessPurchasing: canAccessPurchasing,
    canAccessDelivery: canAccessDelivery,
    canAllocateStock: canAllocateStock,
    canManageProjects: canManageProjects,
    initNotificationBell: initNotificationBell,
    openZaloReadyModal: openZaloReadyModal,
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
    initPendingVouchersBadge: initPendingVouchersBadge,
    refreshPendingPrBadge: refreshPendingPrBadge,
    initPendingPrBadge: initPendingPrBadge,
    initStickySection: initStickySection
  };
})(typeof window !== 'undefined' ? window : globalThis);
