// ============================================================================
// Xếp Phôi An Bình · js/project-bom.js
// Đợt 8: Quản lý Dự án đa công đoạn, Đề nghị Vật tư (BOM), Máy tính khối lượng,
// Nhập/Xuất Excel, Đính kèm bản vẽ, Tạo PXK & Báo cáo Giá vốn theo dự án.
// ============================================================================

(function () {
  'use strict';

  var STATE = {
    project: null,
    requests: [],
    attachments: [],
    vouchers: [],
    inventory: [],
    currentUser: null,
    activeTab: 'bom',
    stageFilter: 'all',
    selectedIds: {},
    importPreviewRows: null,
    opts: {}
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function numVN(val, dec) {
    var n = Number(val || 0);
    if (!isFinite(n)) return '0';
    var d = dec == null ? 2 : dec;
    return n.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }

  function formatShortDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) {
      return String(iso);
    }
  }

  function formatBytes(bytes) {
    var b = Number(bytes || 0);
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    var el = $('toast');
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(el._bomT);
      el._bomT = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }
  }

  function canEditBom() {
    var u = STATE.currentUser;
    return Boolean(u && (u.role === 'admin' || u.role === 'engineer'));
  }

  function canCreatePxk() {
    if (window.SharedUI && typeof window.SharedUI.canCreateVouchers === 'function') {
      return window.SharedUI.canCreateVouchers(STATE.currentUser);
    }
    return canEditBom();
  }

  function canViewPrices() {
    if (window.SharedUI && typeof window.SharedUI.canViewPrices === 'function') {
      return window.SharedUI.canViewPrices(STATE.currentUser);
    }
    return false;
  }

  var STAGE_COLORS = {
    laser_tube: '#0F766E',
    laser_sheet: '#2563EB',
    cnc_mill_turn: '#7C3AED',
    welding_assembly: '#D97706',
    consumable_tooling: '#475569',
    outsourced: '#BE123C'
  };

  function getWorkStages() {
    var src = window.SharedUI && window.SharedUI.WORK_STAGES;
    if (Array.isArray(src)) return src;
    if (src && typeof src === 'object') {
      return Object.keys(src).map(function (k) {
        var item = src[k];
        return Object.assign({ color: STAGE_COLORS[k] || '#0F766E' }, item);
      });
    }
    return [
      { key: 'laser_tube', label: 'Cắt Laser Thép Hình', shortLabel: 'Laser Ống/Hộp', icon: '⚡', color: '#0F766E' },
      { key: 'laser_sheet', label: 'Cắt Laser Thép Tấm', shortLabel: 'Laser Tấm', icon: '🟦', color: '#2563EB' },
      { key: 'cnc_mill_turn', label: 'Gia công Phay / Tiện CNC', shortLabel: 'Phay/Tiện CNC', icon: '⚙️', color: '#7C3AED' },
      { key: 'welding_assembly', label: 'Hàn & Lắp ráp', shortLabel: 'Hàn/Lắp', icon: '🔥', color: '#D97706' },
      { key: 'consumable_tooling', label: 'Vật tư phụ & Dao cụ', shortLabel: 'Vật tư/Dao cụ', icon: '🔩', color: '#475569' },
      { key: 'outsourced', label: 'Gia công / Mua ngoài', shortLabel: 'Mua ngoài', icon: '🚚', color: '#BE123C' }
    ];
  }

  function getStageMeta(key) {
    if (window.SharedUI && typeof window.SharedUI.getWorkStageMeta === 'function') {
      var m = window.SharedUI.getWorkStageMeta(key);
      if (m) return Object.assign({ color: STAGE_COLORS[m.key] || '#0F766E' }, m);
    }
    var list = getWorkStages();
    return list.find(function (s) { return s.key === key; }) || list[0];
  }

  function getDensities() {
    var src = window.SharedUI && window.SharedUI.MATERIAL_DENSITIES;
    if (Array.isArray(src)) return src;
    if (src && typeof src === 'object') {
      return Object.keys(src).map(function (grade) {
        var d = Number(src[grade] || 7.85);
        return { grade: grade, label: grade + ' (' + d.toFixed(2) + ' g/cm³)', density: d };
      });
    }
    return [
      { grade: 'SS400', label: 'Thép SS400 / CT3 (7.85 g/cm³)', density: 7.85 },
      { grade: 'SUS 304', label: 'Inox SUS 304 (7.93 g/cm³)', density: 7.93 },
      { grade: 'Nhôm 6061', label: 'Nhôm 6061 (2.70 g/cm³)', density: 2.70 },
      { grade: 'Thép 2083', label: 'Thép khuôn 2083 / SKD11 (7.80 g/cm³)', density: 7.80 },
      { grade: 'POM', label: 'Nhựa POM (1.41 g/cm³)', density: 1.41 },
      { grade: 'Nhựa phíp', label: 'Nhựa Phíp / Bakelite (1.35 g/cm³)', density: 1.35 }
    ];
  }

  function getInventoryById(invId) {
    if (!invId) return null;
    return STATE.inventory.find(function (x) { return x.id === invId; }) || null;
  }

  function ensureModalInjected() {
    if ($('modalProjectBomDetail')) return;

    var style = document.createElement('style');
    style.id = 'projectBomStyles';
    style.textContent = [
      '#modalProjectBomDetail { position:fixed; inset:0; background:rgba(15,23,42,.58); display:none; align-items:center; justify-content:center; z-index:2200; padding:12px; }',
      '#modalProjectBomDetail.open { display:flex; }',
      '.bom-dialog { background:#fff; border-radius:16px; width:min(1160px, 100%); max-height:92vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(15,23,42,.28); overflow:hidden; }',
      '.bom-head { padding:14px 18px; border-bottom:1px solid #E2E8F0; background:linear-gradient(135deg,#F0FDFA,#FFFFFF); display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }',
      '.bom-tabs { display:flex; gap:6px; padding:8px 18px; background:#F8FAFC; border-bottom:1px solid #E2E8F0; flex-wrap:wrap; }',
      '.bom-tab { border:1px solid #CBD5E1; background:#fff; color:#334155; padding:7px 14px; border-radius:9px; font-size:13px; font-weight:700; cursor:pointer; }',
      '.bom-tab.active { background:#0F766E; color:#fff; border-color:#0F766E; }',
      '.bom-body { padding:16px 18px; overflow-y:auto; flex:1; }',
      '.bom-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; margin-bottom:12px; }',
      '.bom-table { width:100%; border-collapse:collapse; font-size:12.5px; }',
      '.bom-table th { background:#F1F5F9; color:#334155; font-weight:700; text-align:left; padding:8px 9px; border-bottom:1px solid #CBD5E1; white-space:nowrap; }',
      '.bom-table td { padding:8px 9px; border-bottom:1px solid #E2E8F0; vertical-align:middle; }',
      '.bom-table tr:hover td { background:#F8FAFC; }',
      '.bom-stage-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid transparent; white-space:nowrap; }',
      '.bom-status-pending { background:#FEF3C7; color:#92400E; }',
      '.bom-status-partial { background:#DBEAFE; color:#1E40AF; }',
      '.bom-status-fulfilled { background:#DCFCE7; color:#166534; }',
      '.bom-card { background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px; padding:12px 14px; margin-bottom:14px; }',
      '.bom-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px; }',
      '.bom-grid label { display:block; font-size:11.5px; font-weight:700; color:#334155; margin-bottom:3px; }',
      '.bom-grid input, .bom-grid select { width:100%; padding:7px 9px; border:1px solid #CBD5E1; border-radius:8px; font-size:12.5px; background:#fff; font-family:inherit; }'
    ].join('\n');
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'modalProjectBomDetail';
    wrap.innerHTML = [
      '<div class="bom-dialog xp-modal-3tier" role="dialog" aria-modal="true">',
      '  <div class="bom-head">',
      '    <div>',
      '      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">',
      '        <h3 id="bomModalTitle" style="font-size:18px;color:#0B3B38;margin:0;">Chi tiết Dự án</h3>',
      '        <span id="bomModalDueBadge"></span>',
      '      </div>',
      '      <div id="bomModalMeta" style="font-size:12.5px;color:#475569;margin-top:4px;"></div>',
      '      <div id="bomModalStages" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;"></div>',
      '    </div>',
      '    <button type="button" id="btnCloseBomModal" style="background:none;border:none;font-size:26px;line-height:1;cursor:pointer;color:#64748B;">&times;</button>',
      '  </div>',
      '  <div class="bom-tabs">',
      '    <button type="button" class="bom-tab active" data-bom-tab="bom">📋 Đề nghị Vật tư (<span id="bomTabCntReq">0</span>)</button>',
      '    <button type="button" class="bom-tab" data-bom-tab="tube">📏 Thép hình 1D &amp; Xếp phôi</button>',
      '    <button type="button" class="bom-tab" data-bom-tab="vouchers">🧾 Phiếu kho &amp; Chi phí (<span id="bomTabCntVouch">0</span>)</button>',
      '  </div>',
      '  <div class="bom-body" id="bomModalBody"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(wrap);

    $('btnCloseBomModal').addEventListener('click', closeModal);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeModal();
    });
    wrap.querySelectorAll('.bom-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        STATE.activeTab = btn.getAttribute('data-bom-tab');
        renderModal();
      });
    });
  }

  function closeModal() {
    var m = $('modalProjectBomDetail');
    if (m) m.classList.remove('open');
  }

  async function refreshData() {
    if (!STATE.project || !window.SupabaseDB) return;
    var pid = STATE.project.id;
    var results = await Promise.all([
      window.SupabaseDB.getProjectMaterialRequests(pid),
      window.SupabaseDB.getProjectAttachments(pid),
      window.SupabaseDB.getWarehouseVouchers({ projectId: pid }),
      window.SupabaseDB.getInventory().catch(function () { return STATE.inventory; })
    ]);
    STATE.requests = results[0] || [];
    STATE.attachments = results[1] || [];
    STATE.vouchers = results[2] || [];
    if (Array.isArray(results[3])) STATE.inventory = results[3];
    if (typeof STATE.opts.onProjectChanged === 'function') {
      STATE.opts.onProjectChanged(pid, STATE.requests);
    }
  }

  async function openModal(projectId, opts) {
    ensureModalInjected();
    STATE.opts = opts || {};
    var projects = STATE.opts.projectsList || [];
    STATE.project = projects.find(function (p) { return p.id === projectId; }) || { id: projectId, name: projectId, data: {} };
    STATE.inventory = STATE.opts.inventoryItems || [];
    STATE.currentUser = STATE.opts.currentUser || null;
    STATE.activeTab = STATE.opts.initialTab || 'bom';
    STATE.stageFilter = 'all';
    STATE.selectedIds = {};
    STATE.importPreviewRows = null;

    $('modalProjectBomDetail').classList.add('open');
    $('bomModalTitle').textContent = STATE.project.name || 'Dự án';
    $('bomModalBody').innerHTML = '<div style="text-align:center;padding:36px;color:#64748B;">⏳ Đang tải dữ liệu vật tư &amp; chứng từ...</div>';

    try {
      await refreshData();
      renderModal();
    } catch (err) {
      $('bomModalBody').innerHTML = '<div style="padding:24px;color:#B4232C;background:#FEF2F2;border-radius:10px;">❌ Không tải được dữ liệu: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderHeader() {
    var p = STATE.project || {};
    var data = p.data || {};
    $('bomModalTitle').textContent = p.name || 'Dự án';
    var dueBadge = $('bomModalDueBadge');
    if (data.dueDate) {
      dueBadge.innerHTML = '<span class="pill pill-amber">📅 Hạn giao: ' + escapeHtml(data.dueDate) + '</span>';
    } else {
      dueBadge.innerHTML = '';
    }
    var metaParts = [];
    if (p.customer) metaParts.push('Khách hàng: <b>' + escapeHtml(p.customer) + '</b>');
    if (p.notes) metaParts.push(escapeHtml(p.notes));
    $('bomModalMeta').innerHTML = metaParts.join(' · ') || 'Chưa có ghi chú khách hàng';

    var stages = Array.isArray(data.workStages) && data.workStages.length ? data.workStages : [];
    $('bomModalStages').innerHTML = stages.map(function (sk) {
      var m = getStageMeta(sk);
      return '<span class="bom-stage-badge" style="background:' + m.color + '15;color:' + m.color + ';border-color:' + m.color + '40;">' + m.icon + ' ' + escapeHtml(m.shortLabel) + '</span>';
    }).join('');

    $('bomTabCntReq').textContent = String(STATE.requests.length);
    $('bomTabCntVouch').textContent = String(STATE.vouchers.length);

    document.querySelectorAll('#modalProjectBomDetail .bom-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-bom-tab') === STATE.activeTab);
    });
  }

  function renderModal() {
    renderHeader();
    var bodyEl = $('bomModalBody');
    if (bodyEl) bodyEl.classList.toggle('xp-modal-body-flex', STATE.activeTab === 'bom');
    if (STATE.activeTab === 'bom') {
      renderBomTab();
    } else if (STATE.activeTab === 'tube') {
      renderTubeTab();
    } else {
      renderVouchersTab();
    }
  }

  function getFilteredRequests() {
    if (STATE.stageFilter === 'all') return STATE.requests;
    return STATE.requests.filter(function (r) { return r.workStage === STATE.stageFilter; });
  }

  function getSelectedOrShortageRequests() {
    var keys = Object.keys(STATE.selectedIds).filter(function (k) { return STATE.selectedIds[k]; });
    if (keys.length) {
      return STATE.requests.filter(function (r) { return STATE.selectedIds[r.id]; });
    }
    return getFilteredRequests();
  }

  function renderBomTab() {
    var editable = canEditBom();
    var canPxk = canCreatePxk();
    var stages = getWorkStages();
    var densities = getDensities();
    var rows = getFilteredRequests();

    var stageOpts = stages.map(function (s) {
      return '<option value="' + s.key + '"' + (STATE.stageFilter === s.key ? ' selected' : '') + '>' + s.icon + ' ' + escapeHtml(s.label) + '</option>';
    }).join('');

    var invOpts = '<option value="">— Mua ngoài / Không liên kết kho —</option>' + STATE.inventory.map(function (inv) {
      var lbl = (inv.sku ? '[' + inv.sku + '] ' : '') + inv.profileName + ' (Tồn: ' + numVN(inv.qty) + ' ' + (inv.unit || 'cây') + ')';
      return '<option value="' + escapeHtml(inv.id) + '">' + escapeHtml(lbl) + '</option>';
    }).join('');

    var gradeOpts = densities.map(function (d) {
      return '<option value="' + escapeHtml(d.grade) + '">' + escapeHtml(d.label) + '</option>';
    }).join('') + '<option value="custom">Khác (tự nhập tỷ trọng)</option>';

    var statusMap = {
      pending: { label: 'Chờ cấp', cls: 'bom-status-pending' },
      partial: { label: 'Đang cấp dở', cls: 'bom-status-partial' },
      fulfilled: { label: 'Đã cấp đủ', cls: 'bom-status-fulfilled' }
    };

    var tableRowsHtml = rows.length ? rows.map(function (r) {
      var m = getStageMeta(r.workStage);
      var inv = getInventoryById(r.inventoryId);
      var stockQty = inv ? Number(inv.qty || 0) : null;
      var remainingToIssue = Math.max(0, Number(r.requiredQty || 0) - Number(r.issuedQty || 0));
      var shortageToBuy = inv ? Math.max(0, remainingToIssue - stockQty) : remainingToIssue;
      var st = statusMap[r.status] || statusMap.pending;
      var checked = Boolean(STATE.selectedIds[r.id]);

      return '<tr>' +
        '<td><input type="checkbox" class="bom-row-chk" data-id="' + escapeHtml(r.id) + '"' + (checked ? ' checked' : '') + '></td>' +
        '<td><span class="bom-stage-badge" style="background:' + m.color + '15;color:' + m.color + ';border-color:' + m.color + '35;">' + m.icon + ' ' + escapeHtml(m.shortLabel) + '</span></td>' +
        '<td><strong>' + escapeHtml(r.itemName) + '</strong>' +
          (r.specDimensions ? '<div style="font-size:11.5px;color:#475569;">📐 ' + escapeHtml(r.specDimensions) + (r.calcWeightKg > 0 ? ' · <b>' + numVN(r.calcWeightKg) + ' kg</b>' : '') + '</div>' : (r.calcWeightKg > 0 ? '<div style="font-size:11.5px;color:#475569;">⚖️ ' + numVN(r.calcWeightKg) + ' kg</div>' : '')) +
          (r.note ? '<div style="font-size:11px;color:#64748B;font-style:italic;">' + escapeHtml(r.note) + '</div>' : '') +
        '</td>' +
        '<td>' + escapeHtml(r.materialGrade || '—') + '</td>' +
        '<td>' + (inv
          ? '<div style="font-size:11.5px;font-weight:700;color:#0F766E;">' + escapeHtml(inv.sku || inv.profileName) + '</div><div style="font-size:11px;color:#475569;">Tồn: <b>' + numVN(stockQty) + '</b> ' + escapeHtml(inv.unit || r.unit) + '</div>'
          : '<span style="font-size:11px;color:#94A3B8;">Ngoài danh mục kho</span>') + '</td>' +
        '<td style="text-align:right;"><b>' + numVN(r.requiredQty) + '</b> ' + escapeHtml(r.unit) + '</td>' +
        '<td style="text-align:right;color:#0F766E;font-weight:700;">' + numVN(r.issuedQty) + '</td>' +
        '<td style="text-align:right;color:' + (shortageToBuy > 0 ? '#B4232C' : '#166534') + ';font-weight:700;">' + (shortageToBuy > 0 ? numVN(shortageToBuy) : '0') + '</td>' +
        '<td><span class="bom-stage-badge ' + st.cls + '">' + st.label + '</span></td>' +
        '<td style="text-align:right;">' +
          (editable && Number(r.issuedQty || 0) === 0
            ? '<button type="button" class="btn btn-sm btn-danger bom-del-req" data-id="' + escapeHtml(r.id) + '" title="Xóa dòng đề nghị">🗑️</button>'
            : '') +
        '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="10" style="text-align:center;padding:24px;color:#64748B;">Chưa có dòng Đề nghị Vật tư nào. Thêm thủ công bên dưới hoặc nhập từ file Excel!</td></tr>';

    var importPreviewHtml = '';
    if (STATE.importPreviewRows && STATE.importPreviewRows.length) {
      importPreviewHtml = '<div class="bom-card" style="border-color:#0F766E;background:#F0FDFA;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">' +
        '<strong>📥 Xem trước nhập Excel (' + STATE.importPreviewRows.length + ' dòng)</strong>' +
        '<div style="display:flex;gap:8px;">' +
        '<button type="button" class="btn btn-sm btn-soft" id="btnCancelImportPreview">Hủy</button>' +
        '<button type="button" class="btn btn-sm btn-p" id="btnConfirmImportPreview">✅ Xác nhận nhập ' + STATE.importPreviewRows.length + ' dòng</button>' +
        '</div></div>' +
        '<div class="table-responsive"><table class="bom-table"><thead><tr><th>Công đoạn</th><th>Tên vật tư</th><th>Khớp kho</th><th>Kích thước</th><th>SL</th><th>ĐVT</th></tr></thead><tbody>' +
        STATE.importPreviewRows.map(function (r) {
          var inv = getInventoryById(r.inventoryId);
          return '<tr><td>' + escapeHtml(getStageMeta(r.workStage).shortLabel) + '</td><td>' + escapeHtml(r.itemName) + '</td><td>' + (inv ? '<span style="color:#0F766E;font-weight:700;">✓ ' + escapeHtml(inv.sku || inv.profileName) + '</span>' : '<span style="color:#94A3B8;">Mua ngoài</span>') + '</td><td>' + escapeHtml(r.specDimensions || '—') + '</td><td>' + numVN(r.requiredQty) + '</td><td>' + escapeHtml(r.unit) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
    }

    var addFormHtml = editable ? (
      '<div class="bom-card" style="margin-bottom:6px;">' +
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">' +
      '    <strong style="font-size:13.5px;color:#0B3B38;">➕ Thêm dòng Đề nghị Vật tư</strong>' +
      '    <div style="display:flex;gap:6px;flex-wrap:wrap;">' +
      '      <button type="button" class="btn btn-sm btn-soft xp-sticky-mobile-toggle" data-sticky-toggle>Mở rộng ô nhập ▾</button>' +
      '      <button type="button" class="btn btn-sm btn-soft" id="btnToggleWeightCalc">🧮 Máy tính Khối lượng Phôi</button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="bomWeightCalcBox" style="display:none;background:#fff;border:1px dashed #0F766E;border-radius:10px;padding:10px 12px;margin-bottom:10px;">' +
      '    <div style="font-size:12px;font-weight:700;color:#0F766E;margin-bottom:8px;">🧮 Tính nhanh Khối lượng Phôi theo Kích thước &amp; Mác vật liệu</div>' +
      '    <div class="bom-grid">' +
      '      <div><label>Hình dạng phôi</label><select id="wcShape"><option value="plate">Tấm / Phôi hộp (D × R × C)</option><option value="round">Tròn đặc (Φ × Dài)</option></select></div>' +
      '      <div><label>Mác vật liệu (Tỷ trọng)</label><select id="wcGrade">' + gradeOpts + '</select></div>' +
      '      <div id="wcCustomDensityWrap" style="display:none;"><label>Tỷ trọng (g/cm³)</label><input type="number" step="0.01" id="wcCustomDensity" value="7.85"></div>' +
      '      <div id="wcLenWrap"><label>Chiều dài L (mm)</label><input type="number" id="wcLength" value="2440" min="0"></div>' +
      '      <div id="wcWidthWrap"><label>Chiều rộng W (mm)</label><input type="number" id="wcWidth" value="1220" min="0"></div>' +
      '      <div id="wcThickWrap"><label>Độ dày T (mm)</label><input type="number" id="wcThick" value="10" min="0" step="0.1"></div>' +
      '      <div id="wcDiaWrap" style="display:none;"><label>Đường kính Φ (mm)</label><input type="number" id="wcDia" value="60" min="0" step="0.1"></div>' +
      '    </div>' +
      '    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:8px;">' +
      '      <div style="font-size:13px;">Kết quả: <strong id="wcResultKg" style="color:#0F766E;font-size:15px;">233.68 kg</strong> <span id="wcResultSpec" style="color:#64748B;">(T10×1220×2440)</span></div>' +
      '      <button type="button" class="btn btn-sm btn-p" id="btnApplyWeightCalc">✓ Áp dụng vào dòng vật tư</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="bom-grid xp-sticky-collapsible">' +
      '    <div><label>Công đoạn *</label><select id="bomAddStage">' + stages.map(function (s) { return '<option value="' + s.key + '">' + s.icon + ' ' + escapeHtml(s.label) + '</option>'; }).join('') + '</select></div>' +
      '    <div><label>Liên kết vật tư kho</label><select id="bomAddInvId">' + invOpts + '</select></div>' +
      '    <div><label>Tên vật tư / Quy cách *</label><input type="text" id="bomAddName" placeholder="VD: Thép tấm SS400 T10"></div>' +
      '    <div><label>Mác vật liệu</label><input type="text" id="bomAddGrade" placeholder="VD: SS400, SUS 304, POM"></div>' +
      '    <div><label>Kích thước (mm)</label><input type="text" id="bomAddDims" placeholder="VD: T10×1220×2440 hoặc Φ60×150"></div>' +
      '    <div><label>Khối lượng (kg)</label><input type="number" id="bomAddKg" step="0.01" min="0" value="0"></div>' +
      '    <div><label>Số lượng cần *</label><input type="number" id="bomAddQty" step="0.01" min="0.01" value="1"></div>' +
      '    <div><label>Đơn vị</label><input type="text" id="bomAddUnit" value="tấm" placeholder="tấm, cây, cục, kg..."></div>' +
      '    <div><label>Ghi chú / NCC gợi ý</label><input type="text" id="bomAddNote" placeholder="Ghi chú thêm..."></div>' +
      '  </div>' +
      '  <div style="display:flex;justify-content:flex-end;margin-top:10px;">' +
      '    <button type="button" class="btn btn-sm btn-p" id="btnAddBomRow">➕ Lưu vào Đề nghị Vật tư</button>' +
      '  </div>' +
      '</div>'
    ) : '';

    var attListHtml = STATE.attachments.length ? STATE.attachments.map(function (a) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;background:#fff;border:1px solid #E2E8F0;border-radius:8px;">' +
        '<div style="min-width:0;">' +
        '<div style="font-size:12.5px;font-weight:700;color:#0B3B38;word-break:break-word;">📎 ' + escapeHtml(a.fileName) + '</div>' +
        '<div style="font-size:11px;color:#64748B;">' + formatBytes(a.fileSize) + ' · ' + escapeHtml(a.uploadedBy || '') + ' · ' + formatShortDate(a.createdAt) + (a.note ? ' · ' + escapeHtml(a.note) : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button type="button" class="btn btn-sm btn-soft bom-dl-att" data-path="' + escapeHtml(a.storagePath) + '">⬇️</button>' +
        (editable ? '<button type="button" class="btn btn-sm btn-danger bom-del-att" data-id="' + escapeHtml(a.id) + '" data-path="' + escapeHtml(a.storagePath) + '">🗑️</button>' : '') +
        '</div></div>';
    }).join('') : '<div style="font-size:12px;color:#64748B;">Chưa có bản vẽ hoặc file đính kèm nào.</div>';

    $('bomModalBody').innerHTML = [
      '<div class="xp-modal-fixed-top" id="bomStickyEntry">',
      '  <div class="bom-toolbar" style="margin-bottom:8px;">',
      '    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">',
      '      <select id="bomStageFilter" style="padding:6px 10px;border:1px solid #CBD5E1;border-radius:8px;font-size:12.5px;">',
      '        <option value="all">Tất cả công đoạn (' + STATE.requests.length + ')</option>' + stageOpts,
      '      </select>',
      editable ? '<button type="button" class="btn btn-sm btn-soft" id="btnBomDlTemplate">📥 File mẫu Excel</button>' : '',
      editable ? '<label class="btn btn-sm btn-soft" style="cursor:pointer;margin:0;">📤 Nhập Excel<input type="file" id="inpBomImportExcel" accept=".xlsx,.xls,.csv" style="display:none;"></label>' : '',
      '    </div>',
      '    <div style="display:flex;gap:6px;flex-wrap:wrap;">',
      canPxk ? '<button type="button" class="btn btn-sm btn-p" id="btnBomCreatePxk">📤 Tạo Phiếu Xuất Kho (PXK)</button>' : '',
      '<button type="button" class="btn btn-sm btn-cta" id="btnBomPurchaseReq">🛒 Xuất Đề nghị Mua hàng</button>',
      '<button type="button" class="btn btn-sm btn-soft" id="btnBomPrintReqA4">🖨️ In Đề nghị Vật tư (A4)</button>',
      '    </div>',
      '  </div>',
      addFormHtml,
      importPreviewHtml,
      '</div>',
      '<div class="xp-modal-table-scroll">',
      '  <div style="border:1px solid #E2E8F0;border-radius:10px;margin:10px 0 14px;">',
      '    <table class="bom-table" id="bomRequestsTable">',
      '      <thead><tr>',
      '        <th style="width:28px;"><input type="checkbox" id="bomChkAll"></th>',
      '        <th>Công đoạn</th>',
      '        <th>Tên vật tư / Quy cách</th>',
      '        <th>Mác</th>',
      '        <th>Liên kết Kho</th>',
      '        <th style="text-align:right;">Cần</th>',
      '        <th style="text-align:right;">Đã xuất</th>',
      '        <th style="text-align:right;">Thiếu</th>',
      '        <th>Trạng thái</th>',
      '        <th></th>',
      '      </tr></thead>',
      '      <tbody>' + tableRowsHtml + '</tbody>',
      '    </table>',
      '  </div>',
      '  <div class="bom-card">',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">',
      '    <strong style="font-size:13.5px;color:#0B3B38;">📁 Bản vẽ &amp; Hồ sơ đính kèm (' + STATE.attachments.length + ')</strong>',
      editable ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><input type="text" id="bomAttNote" placeholder="Ghi chú file..." style="padding:5px 8px;border:1px solid #CBD5E1;border-radius:7px;font-size:12px;"><label class="btn btn-sm btn-p" style="cursor:pointer;margin:0;">⬆️ Tải file lên (<=10MB)<input type="file" id="inpBomAttFile" accept=".pdf,.dxf,.dwg,.step,.stp,.igs,.iges,.xlsx,.xls,.png,.jpg,.jpeg" style="display:none;"></label></div>' : '',
      '  </div>',
      '  <div style="display:flex;flex-direction:column;gap:6px;">' + attListHtml + '</div>',
      '  </div>',
      '</div>'
    ].join('');

    bindBomEvents();
  }

  function updateWeightCalcPreview() {
    var shape = ($('wcShape') && $('wcShape').value) || 'plate';
    var grade = ($('wcGrade') && $('wcGrade').value) || 'SS400';
    var isRound = shape === 'round';
    if ($('wcWidthWrap')) $('wcWidthWrap').style.display = isRound ? 'none' : '';
    if ($('wcThickWrap')) $('wcThickWrap').style.display = isRound ? 'none' : '';
    if ($('wcDiaWrap')) $('wcDiaWrap').style.display = isRound ? '' : 'none';
    if ($('wcCustomDensityWrap')) $('wcCustomDensityWrap').style.display = grade === 'custom' ? '' : 'none';

    var L = Number(($('wcLength') && $('wcLength').value) || 0);
    var W = Number(($('wcWidth') && $('wcWidth').value) || 0);
    var T = Number(($('wcThick') && $('wcThick').value) || 0);
    var D = Number(($('wcDia') && $('wcDia').value) || 0);
    var customD = Number(($('wcCustomDensity') && $('wcCustomDensity').value) || 7.85);

    var kg = 0;
    if (window.SharedUI && typeof window.SharedUI.calcMaterialWeightKg === 'function') {
      kg = window.SharedUI.calcMaterialWeightKg({
        shape: shape, lengthMm: L, widthMm: W, thicknessMm: T, diameterMm: D,
        grade: grade, customDensity: customD
      });
    }
    var spec = isRound ? ('Φ' + D + '×' + L) : ('T' + T + '×' + W + '×' + L);
    if ($('wcResultKg')) $('wcResultKg').textContent = numVN(kg) + ' kg';
    if ($('wcResultSpec')) $('wcResultSpec').textContent = '(' + spec + ')';
  }

  function bindBomEvents() {
    var filterEl = $('bomStageFilter');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        STATE.stageFilter = filterEl.value;
        renderBomTab();
      });
    }

    var chkAll = $('bomChkAll');
    if (chkAll) {
      chkAll.addEventListener('change', function () {
        var rows = getFilteredRequests();
        rows.forEach(function (r) { STATE.selectedIds[r.id] = chkAll.checked; });
        renderBomTab();
      });
    }

    document.querySelectorAll('.bom-row-chk').forEach(function (chk) {
      chk.addEventListener('change', function () {
        STATE.selectedIds[chk.getAttribute('data-id')] = chk.checked;
      });
    });

    document.querySelectorAll('.bom-del-req').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Xóa dòng đề nghị vật tư này?')) return;
        try {
          await window.SupabaseDB.deleteProjectMaterialRequest(btn.getAttribute('data-id'));
          await refreshData();
          renderModal();
          toast('✓ Đã xóa dòng vật tư');
        } catch (err) {
          toast('❌ ' + err.message);
        }
      });
    });

    var btnToggleWc = $('btnToggleWeightCalc');
    if (btnToggleWc) {
      btnToggleWc.addEventListener('click', function () {
        var box = $('bomWeightCalcBox');
        if (!box) return;
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
        updateWeightCalcPreview();
      });
    }

    ['wcShape', 'wcGrade', 'wcCustomDensity', 'wcLength', 'wcWidth', 'wcThick', 'wcDia'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', updateWeightCalcPreview);
      if (el) el.addEventListener('change', updateWeightCalcPreview);
    });

    var btnApplyWc = $('btnApplyWeightCalc');
    if (btnApplyWc) {
      btnApplyWc.addEventListener('click', function () {
        var shape = $('wcShape').value;
        var grade = $('wcGrade').value;
        var L = Number($('wcLength').value || 0);
        var W = Number($('wcWidth').value || 0);
        var T = Number($('wcThick').value || 0);
        var D = Number($('wcDia').value || 0);
        var customD = Number($('wcCustomDensity').value || 7.85);
        var kg = window.SharedUI.calcMaterialWeightKg({
          shape: shape, lengthMm: L, widthMm: W, thicknessMm: T, diameterMm: D,
          grade: grade, customDensity: customD
        });
        var spec = shape === 'round' ? ('Φ' + D + '×' + L) : ('T' + T + '×' + W + '×' + L);
        if ($('bomAddDims')) $('bomAddDims').value = spec;
        if ($('bomAddKg')) $('bomAddKg').value = String(kg);
        if ($('bomAddGrade') && grade !== 'custom') $('bomAddGrade').value = grade;
        if ($('bomAddName') && !$('bomAddName').value.trim()) {
          $('bomAddName').value = (shape === 'round' ? 'Phôi tròn ' : 'Tấm ') + (grade !== 'custom' ? grade + ' ' : '') + spec;
        }
        toast('✓ Đã áp dụng ' + spec + ' (' + numVN(kg) + ' kg)');
      });
    }

    var addInvSel = $('bomAddInvId');
    if (addInvSel) {
      addInvSel.addEventListener('change', function () {
        var inv = getInventoryById(addInvSel.value);
        if (!inv) return;
        if ($('bomAddName') && !$('bomAddName').value.trim()) $('bomAddName').value = inv.profileName;
        if ($('bomAddUnit')) $('bomAddUnit').value = inv.unit || 'cây';
      });
    }

    var btnAdd = $('btnAddBomRow');
    if (btnAdd) {
      btnAdd.addEventListener('click', async function () {
        var itemName = ($('bomAddName').value || '').trim();
        var reqQty = Number($('bomAddQty').value || 0);
        if (!itemName || reqQty <= 0) {
          alert('Vui lòng nhập Tên vật tư và Số lượng > 0.');
          return;
        }
        try {
          await window.SupabaseDB.addProjectMaterialRequest({
            projectId: STATE.project.id,
            workStage: $('bomAddStage').value,
            inventoryId: $('bomAddInvId').value || null,
            itemName: itemName,
            materialGrade: $('bomAddGrade').value.trim(),
            specDimensions: $('bomAddDims').value.trim(),
            calcWeightKg: Number($('bomAddKg').value || 0),
            unit: ($('bomAddUnit').value || 'cái').trim(),
            requiredQty: reqQty,
            note: $('bomAddNote').value.trim()
          });
          await refreshData();
          renderModal();
          toast('✓ Đã thêm "' + itemName + '"');
        } catch (err) {
          toast('❌ ' + err.message);
        }
      });
    }

    var btnDlTpl = $('btnBomDlTemplate');
    if (btnDlTpl) btnDlTpl.addEventListener('click', downloadExcelTemplate);

    var inpImport = $('inpBomImportExcel');
    if (inpImport) {
      inpImport.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) handleImportExcel(file);
      });
    }

    var btnCancelImp = $('btnCancelImportPreview');
    if (btnCancelImp) {
      btnCancelImp.addEventListener('click', function () {
        STATE.importPreviewRows = null;
        renderBomTab();
      });
    }

    var btnConfirmImp = $('btnConfirmImportPreview');
    if (btnConfirmImp) {
      btnConfirmImp.addEventListener('click', async function () {
        if (!STATE.importPreviewRows || !STATE.importPreviewRows.length) return;
        try {
          await window.SupabaseDB.bulkAddProjectMaterialRequests(STATE.importPreviewRows);
          var count = STATE.importPreviewRows.length;
          STATE.importPreviewRows = null;
          await refreshData();
          renderModal();
          toast('✓ Đã nhập ' + count + ' dòng vật tư từ Excel');
        } catch (err) {
          toast('❌ Lỗi nhập Excel: ' + err.message);
        }
      });
    }

    var inpAtt = $('inpBomAttFile');
    if (inpAtt) {
      inpAtt.addEventListener('change', async function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          alert('File vượt quá giới hạn 10MB.');
          return;
        }
        try {
          await window.SupabaseDB.uploadProjectAttachment(STATE.project.id, file, ($('bomAttNote') && $('bomAttNote').value) || '');
          await refreshData();
          renderModal();
          toast('✓ Đã tải lên ' + file.name);
        } catch (err) {
          toast('❌ Lỗi tải file: ' + err.message);
        }
      });
    }

    document.querySelectorAll('.bom-dl-att').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var url = await window.SupabaseDB.getProjectAttachmentSignedUrl(btn.getAttribute('data-path'), 3600);
        if (url) window.open(url, '_blank', 'noopener');
        else toast('❌ Không tạo được link tải file');
      });
    });

    document.querySelectorAll('.bom-del-att').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Xóa file đính kèm này?')) return;
        try {
          await window.SupabaseDB.deleteProjectAttachment(btn.getAttribute('data-id'), btn.getAttribute('data-path'));
          await refreshData();
          renderModal();
          toast('✓ Đã xóa file đính kèm');
        } catch (err) {
          toast('❌ ' + err.message);
        }
      });
    });

    var btnPxk = $('btnBomCreatePxk');
    if (btnPxk) btnPxk.addEventListener('click', handleCreatePxkFromBom);

    var btnPur = $('btnBomPurchaseReq');
    if (btnPur) btnPur.addEventListener('click', handlePurchaseExport);

    var btnPrt = $('btnBomPrintReqA4');
    if (btnPrt) btnPrt.addEventListener('click', printBomRequestA4);
  }

  function downloadExcelTemplate() {
    if (typeof XLSX === 'undefined') {
      alert('Chưa tải được thư viện Excel (SheetJS).');
      return;
    }
    var rows = [
      ['Công đoạn', 'Mã SKU kho', 'Tên vật tư', 'Mác', 'Kích thước', 'Khối lượng (kg)', 'Số lượng', 'Đơn vị', 'Ghi chú'],
      ['laser_sheet', '', 'Thép tấm SS400 10mm', 'SS400', 'T10×1220×2440', 233.68, 2, 'tấm', 'Cắt bản mã'],
      ['cnc_mill_turn', '', 'Phôi tròn đặc SUS 304', 'SUS 304', 'Φ60×150', 3.36, 4, 'cục', 'Tiện trục'],
      ['consumable_tooling', '', 'Que hàn Kim Tín 3.2', '', '', 0, 5, 'kg', 'Hàn khung']
    ];
    var ws = XLSX.utils.aoa_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DeNghiVatTu');
    XLSX.writeFile(wb, 'Mau_De_Nghi_Vat_Tu_Du_An.xlsx');
  }

  function normalizeStageFromCell(raw) {
    var s = String(raw || '').trim().toLowerCase();
    var stages = getWorkStages();
    var found = stages.find(function (st) {
      return st.key === s || st.label.toLowerCase() === s || st.shortLabel.toLowerCase() === s;
    });
    if (found) return found.key;
    if (s.indexOf('tấm') >= 0 || s.indexOf('tam') >= 0 || s.indexOf('sheet') >= 0) return 'laser_sheet';
    if (s.indexOf('cnc') >= 0 || s.indexOf('phay') >= 0 || s.indexOf('tiện') >= 0) return 'cnc_mill_turn';
    if (s.indexOf('hàn') >= 0 || s.indexOf('lắp') >= 0) return 'welding_assembly';
    if (s.indexOf('dao') >= 0 || s.indexOf('phụ') >= 0) return 'consumable_tooling';
    if (s.indexOf('ngoài') >= 0) return 'outsourced';
    return 'laser_tube';
  }

  function handleImportExcel(file) {
    if (typeof XLSX === 'undefined') {
      alert('Chưa tải được thư viện Excel (SheetJS).');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(ev.target.result, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var jsonRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        var parsed = [];
        jsonRows.forEach(function (row) {
          var itemName = String(row['Tên vật tư'] || row['item_name'] || row['Ten vat tu'] || '').trim();
          var qty = Number(row['Số lượng'] || row['required_qty'] || row['So luong'] || 0);
          if (!itemName || qty <= 0) return;

          var sku = String(row['Mã SKU kho'] || row['sku'] || '').trim().toLowerCase();
          var matchedInv = STATE.inventory.find(function (inv) {
            return (sku && String(inv.sku || '').trim().toLowerCase() === sku) ||
              String(inv.profileName || '').trim().toLowerCase() === itemName.toLowerCase();
          });

          parsed.push({
            projectId: STATE.project.id,
            workStage: normalizeStageFromCell(row['Công đoạn'] || row['work_stage'] || ''),
            inventoryId: matchedInv ? matchedInv.id : null,
            itemName: itemName,
            materialGrade: String(row['Mác'] || row['material_grade'] || '').trim(),
            specDimensions: String(row['Kích thước'] || row['spec_dimensions'] || '').trim(),
            calcWeightKg: Number(row['Khối lượng (kg)'] || row['calc_weight_kg'] || 0),
            requiredQty: qty,
            unit: String(row['Đơn vị'] || row['unit'] || (matchedInv && matchedInv.unit) || 'cái').trim(),
            note: String(row['Ghi chú'] || row['note'] || '').trim()
          });
        });

        if (!parsed.length) {
          alert('Không đọc được dòng vật tư hợp lệ nào (cần cột "Tên vật tư" và "Số lượng" > 0).');
          return;
        }
        STATE.importPreviewRows = parsed;
        renderBomTab();
      } catch (err) {
        alert('Lỗi đọc file Excel: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleCreatePxkFromBom() {
    var chosen = getSelectedOrShortageRequests();
    var validItems = [];
    chosen.forEach(function (r) {
      var rem = Math.max(0, Number(r.requiredQty || 0) - Number(r.issuedQty || 0));
      var inv = getInventoryById(r.inventoryId);
      if (inv && rem > 0) {
        validItems.push({
          inventoryId: inv.id,
          profile: inv.profileName,
          materialGroup: inv.materialGroup || 'tube_1d',
          unit: inv.unit || r.unit || 'cái',
          qty: rem,
          unitPrice: Number(inv.avgCost || 0),
          projectRequestId: r.id,
          note: getStageMeta(r.workStage).shortLabel + (r.specDimensions ? ' · ' + r.specDimensions : '')
        });
      }
    });

    if (!validItems.length) {
      alert('Không có dòng vật tư nào (đã liên kết kho và còn thiếu) để tạo Phiếu Xuất Kho.');
      return;
    }

    try {
      var created = await window.SupabaseDB.createWarehouseVoucher({
        voucherType: 'OUT',
        status: 'pending',
        projectId: STATE.project.id,
        projectName: STATE.project.name,
        department: 'Sản xuất / Dự án',
        note: 'Xuất vật tư theo Đề nghị Dự án ' + STATE.project.name
      }, validItems);

      await refreshData();
      renderModal();

      if (window.SharedUI && typeof window.SharedUI.refreshPendingVouchersBadge === 'function') {
        window.SharedUI.refreshPendingVouchersBadge();
      }

      if (confirm('✅ Đã tạo Phiếu Xuất Kho ' + created.voucherCode + ' (' + validItems.length + ' dòng).\nMở trang Phiếu Kho (/vouchers) để duyệt xuất ngay?')) {
        window.location.href = '/vouchers?id=' + encodeURIComponent(created.id);
      }
    } catch (err) {
      toast('❌ Lỗi tạo PXK: ' + err.message);
    }
  }

  function handlePurchaseExport() {
    var chosen = getSelectedOrShortageRequests();
    var shortages = [];
    chosen.forEach(function (r) {
      var rem = Math.max(0, Number(r.requiredQty || 0) - Number(r.issuedQty || 0));
      if (rem <= 0) return;
      var inv = getInventoryById(r.inventoryId);
      var stockQty = inv ? Number(inv.qty || 0) : 0;
      var needBuy = inv ? Math.max(0, rem - stockQty) : rem;
      if (needBuy > 0) {
        shortages.push({ req: r, inv: inv, needBuy: needBuy });
      }
    });

    if (!shortages.length) {
      alert('Tất cả vật tư đã chọn đều đủ tồn kho hoặc đã xuất đủ!');
      return;
    }

    var msgLines = ['📋 ĐỀ NGHỊ MUA HÀNG - DỰ ÁN: ' + STATE.project.name];
    shortages.forEach(function (s, idx) {
      msgLines.push((idx + 1) + '. ' + s.req.itemName + (s.req.specDimensions ? ' (' + s.req.specDimensions + ')' : '') + ': ' + numVN(s.needBuy) + ' ' + s.req.unit);
    });
    var zaloText = msgLines.join('\n');

    var mode = prompt(
      'Tìm thấy ' + shortages.length + ' vật tư cần mua.\nChọn hành động:\n1 = Xuất file Excel Đề nghị mua hàng\n2 = Copy tin nhắn Zalo\n3 = Đẩy sang Phiếu Nhập Kho (PNK) nháp',
      '1'
    );
    if (!mode) return;
    if (mode.trim() === '2') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(zaloText).then(function () {
          toast('✓ Đã copy tin nhắn Zalo Đề nghị mua hàng!');
        });
      } else {
        alert(zaloText);
      }
      return;
    }
    if (mode.trim() === '3') {
      var draftItems = shortages.map(function (s) {
        return {
          inventoryId: s.inv ? s.inv.id : '',
          profile: s.inv ? s.inv.profileName : s.req.itemName,
          materialGroup: s.inv ? (s.inv.materialGroup || 'consumable') : 'consumable',
          unit: s.req.unit || (s.inv && s.inv.unit) || 'cái',
          qty: s.needBuy,
          unitPrice: s.inv ? Number(s.inv.avgCost || 0) : 0,
          note: 'Mua cho dự án ' + STATE.project.name + (s.req.specDimensions ? ' (' + s.req.specDimensions + ')' : '')
        };
      });
      localStorage.setItem('xp_reorder_draft_pnk', JSON.stringify({
        note: 'Nhập mua vật tư cho dự án ' + STATE.project.name,
        items: draftItems
      }));
      window.location.href = '/vouchers?new=IN&from=reorder';
      return;
    }
    if (typeof XLSX !== 'undefined') {
      var aoa = [['STT', 'Công đoạn', 'Tên vật tư', 'Mác', 'Kích thước', 'Khối lượng (kg)', 'SL cần mua', 'ĐVT', 'Ghi chú']];
      shortages.forEach(function (s, idx) {
        aoa.push([
          idx + 1,
          getStageMeta(s.req.workStage).label,
          s.req.itemName,
          s.req.materialGrade || '',
          s.req.specDimensions || '',
          s.req.calcWeightKg || 0,
          s.needBuy,
          s.req.unit,
          s.req.note || ''
        ]);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'DeNghiMuaHang');
      XLSX.writeFile(wb, 'DeNghiMuaHang_' + (STATE.project.name || 'DuAn').replace(/[^a-zA-Z0-9_-]/g, '_') + '.xlsx');
    }
  }

  function printBomRequestA4() {
    var rows = getFilteredRequests();
    var p = STATE.project || {};
    var w = window.open('', '_blank', 'width=960,height=720');
    if (!w) {
      alert('Trình duyệt đã chặn popup in A4. Vui lòng cho phép mở cửa sổ mới.');
      return;
    }
    var trs = rows.map(function (r, idx) {
      return '<tr>' +
        '<td style="text-align:center;">' + (idx + 1) + '</td>' +
        '<td>' + escapeHtml(getStageMeta(r.workStage).shortLabel) + '</td>' +
        '<td><b>' + escapeHtml(r.itemName) + '</b></td>' +
        '<td>' + escapeHtml(r.materialGrade || '—') + '</td>' +
        '<td>' + escapeHtml(r.specDimensions || '—') + '</td>' +
        '<td style="text-align:right;">' + (r.calcWeightKg > 0 ? numVN(r.calcWeightKg) : '—') + '</td>' +
        '<td style="text-align:right;"><b>' + numVN(r.requiredQty) + '</b> ' + escapeHtml(r.unit) + '</td>' +
        '<td style="text-align:right;">' + numVN(r.issuedQty) + '</td>' +
        '<td>' + escapeHtml(r.note || '') + '</td>' +
      '</tr>';
    }).join('');
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Phiếu Đề Nghị Vật Tư - ' + escapeHtml(p.name) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;padding:20px;color:#111}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}th,td{border:1px solid #333;padding:6px 8px}th{background:#f1f5f9}@media print{button{display:none}}</style>' +
      '</head><body>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><div><h2 style="margin:0;">PHIẾU ĐỀ NGHỊ VẬT TƯ DỰ ÁN</h2><div style="margin-top:4px;font-size:13px;">Dự án: <b>' + escapeHtml(p.name) + '</b>' + (p.customer ? ' · Khách hàng: <b>' + escapeHtml(p.customer) + '</b>' : '') + '</div></div><button onclick="window.print()" style="padding:8px 14px;cursor:pointer;">🖨️ In phiếu</button></div>' +
      '<table><thead><tr><th>STT</th><th>Công đoạn</th><th>Tên vật tư</th><th>Mác</th><th>Kích thước</th><th>KL (kg)</th><th>Yêu cầu</th><th>Đã xuất</th><th>Ghi chú</th></tr></thead><tbody>' + trs + '</tbody></table>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);text-align:center;margin-top:32px;font-size:13px;"><div><b>Người lập đề nghị</b><br><br><br>(Ký, họ tên)</div><div><b>Thủ kho</b><br><br><br>(Ký, họ tên)</div><div><b>Giám đốc / Quản lý</b><br><br><br>(Ký, duyệt)</div></div>' +
      '</body></html>');
    w.document.close();
  }

  function renderTubeTab() {
    var p = STATE.project || {};
    var d = p.data || {};
    var profs = Array.isArray(d.activeProfiles) ? d.activeProfiles : [];
    var parts = Array.isArray(d.parts) ? d.parts : [];
    var totalPcs = parts.reduce(function (a, b) { return a + (Number(b.qty) || 0); }, 0);

    $('bomModalBody').innerHTML = [
      '<div class="bom-card">',
      '  <h4 style="margin:0 0 8px;color:#0B3B38;">📏 Thông tin Xếp phôi Thép hình 1D</h4>',
      '  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">',
      '    <span class="pill pill-slate">Loại hộp/ống: <b>' + profs.length + '</b></span>',
      '    <span class="pill pill-slate">Số dòng chi tiết: <b>' + parts.length + '</b></span>',
      '    <span class="pill pill-slate">Tổng số đoạn cắt: <b>' + totalPcs + '</b></span>',
      '  </div>',
      profs.length ? '<div style="margin-bottom:12px;font-size:12.5px;color:#334155;">Quy cách đang cấu hình: <b>' + profs.map(escapeHtml).join(', ') + '</b></div>' : '',
      '  <div style="display:flex;gap:8px;flex-wrap:wrap;">',
      '    <button type="button" class="btn btn-sm btn-p" id="bomBtnOpenMain">🚀 Mở Bàn Xếp Phôi</button>',
      '    <button type="button" class="btn btn-sm btn-cta" id="bomBtnOpenCnc">⚡ Mở Sơ đồ CNC</button>',
      '    <button type="button" class="btn btn-sm btn-soft" id="bomBtnPrintA4">🖨️ In Phiếu Cắt A4</button>',
      '  </div>',
      '</div>'
    ].join('');

    if ($('bomBtnOpenMain')) {
      $('bomBtnOpenMain').addEventListener('click', function () {
        if (typeof STATE.opts.onOpenMain === 'function') STATE.opts.onOpenMain(p.id);
        else window.location.href = '/?project=' + encodeURIComponent(p.id);
      });
    }
    if ($('bomBtnOpenCnc')) {
      $('bomBtnOpenCnc').addEventListener('click', function () {
        if (typeof STATE.opts.onOpenCnc === 'function') STATE.opts.onOpenCnc(p.id);
        else window.location.href = '/cnc?project=' + encodeURIComponent(p.id);
      });
    }
    if ($('bomBtnPrintA4')) {
      $('bomBtnPrintA4').addEventListener('click', function () {
        if (typeof STATE.opts.onPrintA4 === 'function') STATE.opts.onPrintA4(p.id);
      });
    }
  }

  function renderVouchersTab() {
    var showPrice = canViewPrices();
    var approvedVouchers = STATE.vouchers.filter(function (v) { return v.status === 'approved'; });
    var outTotal = 0;
    var retTotal = 0;
    approvedVouchers.forEach(function (v) {
      var amt = (v.items || []).reduce(function (s, it) { return s + (Number(it.totalAmount) || (Number(it.qty) * Number(it.unitPrice || 0))); }, 0);
      if (v.voucherType === 'OUT') outTotal += amt;
      else if (v.voucherType === 'RETURN') retTotal += amt;
    });
    var netCost = outTotal - retTotal;

    var costCard = showPrice ? (
      '<div class="bom-card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;background:#F0FDFA;border-color:#99F6E4;">' +
      '  <div><div style="font-size:11.5px;color:#475569;">Tổng giá trị đã xuất (PXK)</div><strong style="font-size:17px;color:#0B3B38;">' + numVN(outTotal, 0) + ' đ</strong></div>' +
      '  <div><div style="font-size:11.5px;color:#475569;">Đã hoàn kho (PHK)</div><strong style="font-size:17px;color:#0F766E;">-' + numVN(retTotal, 0) + ' đ</strong></div>' +
      '  <div><div style="font-size:11.5px;color:#475569;">Giá vốn vật tư ròng</div><strong style="font-size:18px;color:#C2410C;">' + numVN(netCost, 0) + ' đ</strong></div>' +
      '</div>'
    ) : '';

    var rowsHtml = STATE.vouchers.length ? STATE.vouchers.map(function (v) {
      var amt = (v.items || []).reduce(function (s, it) { return s + (Number(it.totalAmount) || (Number(it.qty) * Number(it.unitPrice || 0))); }, 0);
      var itemDesc = (v.items || []).slice(0, 3).map(function (it) { return it.profile + ' (' + numVN(it.qty) + ' ' + it.unit + ')'; }).join(', ');
      return '<tr>' +
        '<td><a href="/vouchers?id=' + encodeURIComponent(v.id) + '" style="font-family:monospace;font-weight:700;color:#0F766E;">' + escapeHtml(v.voucherCode) + '</a></td>' +
        '<td>' + escapeHtml(v.voucherType) + '</td>' +
        '<td>' + escapeHtml(v.status) + '</td>' +
        '<td>' + escapeHtml(itemDesc || '—') + '</td>' +
        '<td>' + formatShortDate(v.createdAt) + '</td>' +
        (showPrice ? '<td style="text-align:right;font-weight:700;">' + numVN(amt, 0) + ' đ</td>' : '') +
      '</tr>';
    }).join('') : '<tr><td colspan="' + (showPrice ? 6 : 5) + '" style="text-align:center;padding:24px;color:#64748B;">Chưa có Phiếu Xuất / Hoàn kho nào gắn với dự án này.</td></tr>';

    $('bomModalBody').innerHTML = costCard +
      '<div class="table-responsive" style="border:1px solid #E2E8F0;border-radius:10px;">' +
      '<table class="bom-table"><thead><tr><th>Mã phiếu</th><th>Loại</th><th>Trạng thái</th><th>Vật tư</th><th>Ngày lập</th>' + (showPrice ? '<th style="text-align:right;">Giá trị</th>' : '') + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '</div>';
  }

  window.ProjectBomModal = {
    open: openModal,
    close: closeModal
  };
})();
