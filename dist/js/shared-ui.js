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
    consumable: {
      key: 'consumable',
      label: 'Vật tư phụ & Tiêu hao',
      shortLabel: 'Vật tư phụ',
      icon: '🧰',
      defaultUnit: 'cái',
      badgeClass: 'grp-consumable'
    }
  };

  var UNITS = ['cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm'];

  var NAV_ITEMS = [
    { key: 'index', href: '/', label: '📐 Bàn Xếp Phôi', badgeId: '' },
    { key: 'projects', href: '/projects', label: '📁 Quản Lý Dự Án', badgeId: 'subnavProjBadge' },
    { key: 'inventory', href: '/inventory', label: '📦 Kho Phôi & Quy Cách', badgeId: '' },
    { key: 'vouchers', href: '/vouchers', label: '🧾 Phiếu Nhập / Xuất', badgeId: 'subnavVouchersBadge' },
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

  global.SharedUI = {
    ROLES: ROLES,
    VALID_ROLES: VALID_ROLES,
    MATERIAL_GROUPS: MATERIAL_GROUPS,
    UNITS: UNITS,
    NAV_ITEMS: NAV_ITEMS,
    getRoleMeta: getRoleMeta,
    getMaterialGroupMeta: getMaterialGroupMeta,
    canManageInventory: canManageInventory,
    canCreateVouchers: canCreateVouchers,
    canApproveVouchers: canApproveVouchers,
    renderSubnav: renderSubnav,
    compressImageFile: compressImageFile,
    formatMoneyVN: formatMoneyVN
  };
})(typeof window !== 'undefined' ? window : globalThis);
