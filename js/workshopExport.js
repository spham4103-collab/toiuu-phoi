/**
 * ============================================================================
 * WORKSHOP EXPORT HELPER - PHIẾU LỆNH SẢN XUẤT A4 (CÓ QR) & EXCEL (.XLSX)
 * Dùng chung cho cả /, /projects, /inventory, /cnc (xepphoi.cloud)
 * ============================================================================
 */
(function (global) {
  'use strict';

  var COLORS = [
    '#0F766E', '#C2410C', '#3A5BA0', '#A21CAF', '#4D7C0F', '#B4232C',
    '#0369A1', '#7C3AED', '#A16207', '#BE185D', '#15803D', '#475569'
  ];

  var _printStylesInjected = false;

  function getColor(idx) {
    return COLORS[Math.abs(idx || 0) % COLORS.length];
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (s) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s];
    });
  }

  function toAsciiSafe(str) {
    return String(str || 'DonHang')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'DonHang';
  }

  function numVN(n, dec) {
    if (n == null || isNaN(n)) return '0';
    var num = Number(n);
    if (dec !== undefined && dec !== null) {
      return num.toLocaleString('vi-VN', { maximumFractionDigits: dec, minimumFractionDigits: dec });
    }
    return Number.isInteger(num)
      ? num.toLocaleString('vi-VN')
      : num.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }

  function extractMatFromProfile(pName) {
    if (!pName) return 30;
    var m = String(pName).match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X|\*)(\d+)/);
    if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
    var mR = String(pName).match(/(?:Ø|D|Phi)\s*(\d+)/i);
    return mR ? parseInt(mR[1], 10) : 30;
  }

  function formatDateTimeVN(isoOrDate) {
    var d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    var hh = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min;
  }

  function formatRevisionCode(isoOrDate) {
    var d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return 'Rev ' + yyyy + mm + dd + '-' + hh + min;
  }

  function formatShortTime(isoOrDate, user) {
    if (!isoOrDate) return '';
    var d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
    if (isNaN(d.getTime())) return '';
    var hh = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    var timePart = hh + ':' + min;
    var byPart = user ? (' · @' + String(user).replace(/^@/, '')) : '';
    return timePart + byPart;
  }

  function neutralizeStockLabel(label, isOffcut, length) {
    var raw = String(label || '').trim();
    var clean = raw
      .replace(/^Cây mới 6m\b/i, 'Cây chuẩn 6.000')
      .replace(/^Cây mới 6000\b/i, 'Cây chuẩn 6.000')
      .replace(/^Cây mới\b/i, 'Cây chuẩn')
      .replace(/^Cay moi\b/i, 'Cây chuẩn');
    if (!clean) {
      clean = isOffcut ? ('Phôi lẻ ' + numVN(length)) : ('Cây chuẩn ' + numVN(length || 6000));
    }
    return clean;
  }

  function normalizeExportContext(opts) {
    var o = opts || {};
    var rawProj = o.project || {};
    var d = (rawProj.data && typeof rawProj.data === 'object') ? rawProj.data : {};
    var projectId = rawProj.id || rawProj.currentProjectId || o.projectId || '';
    var projectName = rawProj.name || rawProj.currentProjectName || o.projectName || 'Bản vẽ cắt phôi CNC';
    var customer = rawProj.customer != null ? rawProj.customer : (rawProj.currentProjectCustomer || o.customer || '');
    var notes = rawProj.notes != null ? rawProj.notes : (rawProj.currentProjectNotes || o.notes || '');
    var updatedAt = rawProj.updatedAt || rawProj.updated_at || o.updatedAt || new Date().toISOString();
    var isLocked = Boolean(rawProj.isLocked || rawProj.is_locked);
    var kerf = o.kerf != null ? Number(o.kerf) : (rawProj.kerf != null ? Number(rawProj.kerf) : (d.kerf != null ? Number(d.kerf) : 0));
    var clamp = o.clamp != null ? Number(o.clamp) : (rawProj.clamp != null ? Number(rawProj.clamp) : (d.clamp != null ? Number(d.clamp) : 80));
    var interlock = o.interlock != null ? Boolean(o.interlock) : (rawProj.interlock != null ? Boolean(rawProj.interlock) : (d.interlock != null ? Boolean(d.interlock) : true));
    var gap = o.gap != null ? Number(o.gap) : (rawProj.gap != null ? Number(rawProj.gap) : (d.gap != null ? Number(d.gap) : 0));
    var parts = Array.isArray(o.parts)
      ? o.parts
      : (Array.isArray(rawProj.parts) ? rawProj.parts : (Array.isArray(d.parts) ? d.parts : []));
    var cutStatuses = o.cutStatuses || {};
    var exportedBy = o.exportedBy || '';
    var result = o.result || null;

    var winState = (typeof window !== 'undefined' && window.state && typeof window.state === 'object') ? window.state : null;

    var inventoryDeductedAt = o.inventoryDeductedAt ||
      rawProj.inventoryDeductedAt ||
      rawProj.inventory_deducted_at ||
      (d && (d.inventoryDeductedAt || d.inventory_deducted_at)) ||
      (winState && winState.inventoryDeductedAt) ||
      null;

    var inventoryDeductedBy = o.inventoryDeductedBy ||
      rawProj.inventoryDeductedBy ||
      rawProj.inventory_deducted_by ||
      (d && (d.inventoryDeductedBy || d.inventory_deducted_by)) ||
      (winState && winState.inventoryDeductedBy) ||
      '';

    var inventoryDeductedSnapshot = o.inventoryDeductedSnapshot ||
      rawProj.inventoryDeductedSnapshot ||
      rawProj.inventory_deducted_snapshot ||
      (d && (d.inventoryDeductedSnapshot || d.inventory_deducted_snapshot)) ||
      (winState && winState.inventoryDeductedSnapshot) ||
      null;

    var inventoryItems = Array.isArray(o.inventoryItems)
      ? o.inventoryItems
      : (winState && Array.isArray(winState.inventoryItems) ? winState.inventoryItems : []);

    var stockOffcuts = Array.isArray(o.stockOffcuts)
      ? o.stockOffcuts
      : (winState && Array.isArray(winState.stockOffcuts) ? winState.stockOffcuts : []);

    var isDispatched = Boolean(inventoryDeductedAt);

    var isRealProj = Boolean(projectId && projectId !== '__draft__');
    var cncUrl = isRealProj
      ? ('https://xepphoi.cloud/cnc?project=' + encodeURIComponent(String(projectId)))
      : 'https://xepphoi.cloud/cnc';

    return {
      projectId: projectId || '__draft__',
      isRealProj: isRealProj,
      projectName: projectName,
      customer: customer,
      notes: notes,
      updatedAt: updatedAt,
      isLocked: isLocked,
      kerf: kerf,
      clamp: clamp,
      interlock: interlock,
      gap: gap,
      parts: parts,
      cutStatuses: cutStatuses,
      exportedBy: exportedBy,
      result: result,
      cncUrl: cncUrl,
      inventoryDeductedAt: inventoryDeductedAt,
      inventoryDeductedBy: inventoryDeductedBy,
      inventoryDeductedSnapshot: inventoryDeductedSnapshot,
      inventoryItems: inventoryItems,
      stockOffcuts: stockOffcuts,
      isDispatched: isDispatched
    };
  }

  function injectPrintStyles() {
    if (_printStylesInjected || typeof document === 'undefined' || !document.head) return;
    _printStylesInjected = true;
    var style = document.createElement('style');
    style.id = 'a4PrintSheetStyles';
    style.textContent = [
      '@page { size: A4 portrait; margin: 10mm 11mm; }',
      '#a4PrintSheetRoot { display: none; }',
      '@media print {',
      '  body.printing-a4-sheet { margin: 0 !important; padding: 0 !important; background: #FFFFFF !important; }',
      '  body.printing-a4-sheet > *:not(#a4PrintSheetRoot) { display: none !important; }',
      '  body.printing-a4-sheet #a4PrintSheetRoot {',
      '    display: block !important;',
      '    width: 100% !important;',
      '    color: #0F172A !important;',
      '    font-family: "Plus Jakarta Sans", system-ui, -apple-system, sans-serif !important;',
      '    font-size: 11px !important;',
      '    line-height: 1.4 !important;',
      '    -webkit-print-color-adjust: exact !important;',
      '    print-color-adjust: exact !important;',
      '  }',
      '  .a4-header { display: flex; justify-content: space-between; align-items: stretch; gap: 12px; border: 1.5px solid #0B3B38; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; background: #F8FAFC !important; break-inside: avoid; }',
      '  .a4-header-left { flex: 1; min-width: 0; }',
      '  .a4-brand-row { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #CBD5E1; padding-bottom: 6px; margin-bottom: 7px; }',
      '  .a4-brand-row img { height: 34px; object-fit: contain; border-radius: 3px; }',
      '  .a4-title { font-size: 15px; font-weight: 800; color: #0B3B38; letter-spacing: -0.01em; margin: 0; }',
      '  .a4-subtitle { font-size: 10.5px; font-weight: 700; color: #0F766E; }',
      '  .a4-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; font-size: 10.5px; }',
      '  .a4-qr-box { width: 106px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border-left: 1px dashed #CBD5E1; padding-left: 10px; text-align: center; }',
      '  .a4-qr-svg { width: 78px; height: 78px; background: #FFFFFF; padding: 3px; border: 1px solid #CBD5E1; border-radius: 4px; }',
      '  .a4-qr-svg svg { width: 100%; height: 100%; display: block; }',
      '  .a4-qr-cap { font-size: 8.5px; font-weight: 700; color: #334155; margin-top: 3px; line-height: 1.2; }',
      '  .a4-kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; break-inside: avoid; }',
      '  .a4-kpi-cell { border: 1px solid #CBD5E1; border-radius: 5px; padding: 5px 7px; background: #FFFFFF; text-align: center; }',
      '  .a4-kpi-cell strong { display: block; font-size: 13.5px; font-weight: 800; color: #0B3B38; }',
      '  .a4-kpi-cell span { font-size: 9.5px; color: #475569; font-weight: 600; }',
      '  .a4-sec-title { font-size: 12px; font-weight: 800; color: #0B3B38; text-transform: uppercase; letter-spacing: 0.02em; margin: 10px 0 6px; border-left: 4px solid #0F766E; padding-left: 7px; }',
      '  .a4-bom-table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 10px; }',
      '  .a4-bom-table th { background: #E2E8F0 !important; color: #0F172A; font-weight: 700; padding: 5px 7px; border: 1px solid #94A3B8; text-align: left; }',
      '  .a4-bom-table td { padding: 4px 7px; border: 1px solid #CBD5E1; }',
      '  .a4-bom-table th.r, .a4-bom-table td.r { text-align: right; }',
      '  .a4-prof-block { margin-bottom: 10px; }',
      '  .a4-prof-head { background: #CCFBF1 !important; color: #0B3B38; font-weight: 800; font-size: 11.5px; padding: 5px 9px; border: 1px solid #5EEAD4; border-radius: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; }',
      '  .a4-pattern-card { border: 1px solid #94A3B8; border-radius: 5px; padding: 7px 9px; margin-bottom: 7px; background: #FFFFFF; break-inside: avoid; page-break-inside: avoid; }',
      '  .a4-pat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }',
      '  .a4-pat-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; border-radius: 4px; background: #0B3B38 !important; color: #FFFFFF !important; font-weight: 800; font-size: 11.5px; padding: 0 5px; }',
      '  .a4-checklist { display: inline-flex; flex-wrap: wrap; gap: 5px; align-items: center; font-size: 10px; font-weight: 700; }',
      '  .a4-check-item { display: inline-flex; align-items: center; gap: 3px; border: 1px solid #94A3B8; border-radius: 3px; padding: 1px 5px; background: #F8FAFC; }',
      '  .a4-box { display: inline-block; width: 10px; height: 10px; border: 1.3px solid #0F172A; background: #FFFFFF; }',
      '  .a4-svg-wrap { position: relative; margin: 4px 0 2px; border: 1px solid #CBD5E1; border-radius: 3px; overflow: hidden; }',
      '  .a4-svg-wrap svg { display: block; width: 100%; height: 32px; background: #E2E8F0; }',
      '  .a4-labels-layer { position: absolute; inset: 0; height: 32px; pointer-events: none; }',
      '  .a4-cut-lbl { position: absolute; top: 0; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #FFFFFF; text-shadow: 0 1px 1px rgba(0,0,0,0.7); overflow: hidden; white-space: nowrap; }',
      '  .a4-cut-lbl.waste { color: #334155; text-shadow: none; font-size: 9px; font-weight: 700; }',
      '  .a4-pills { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 5px; font-size: 10px; }',
      '  .a4-pill { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }',
      '  .a4-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }',
      '  .a4-sign-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; border-top: 1.5px dashed #94A3B8; padding-top: 10px; break-inside: avoid; page-break-inside: avoid; }',
      '  .a4-sign-col { text-align: center; font-size: 10.5px; }',
      '  .a4-sign-title { font-weight: 800; color: #0B3B38; text-transform: uppercase; }',
      '  .a4-sign-sub { font-size: 9.5px; color: #64748B; font-style: italic; margin-bottom: 42px; }',
      '  .a4-sign-line { border-top: 1px dotted #94A3B8; width: 72%; margin: 0 auto; padding-top: 3px; font-size: 9.5px; color: #64748B; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function generateQrSvg(url) {
    var target = String(url || 'https://xepphoi.cloud/cnc');
    try {
      if (typeof global.qrcode === 'function') {
        var qr = global.qrcode(0, 'M');
        qr.addData(target);
        qr.make();
        return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
      }
    } catch (e) {}
    return '<div style="font-size:8px;word-break:break-all;padding:4px;color:#0F172A;font-weight:700;">QR CNC:<br>' + escapeHtml(target) + '</div>';
  }

  function detectSourceTag(stockType) {
    var lbl = String((stockType && stockType.label) || '');
    if (stockType && stockType.availableQty === null) {
      return { text: 'Mua mới 6m', color: '#C2410C' };
    }
    if (lbl.indexOf('♻️') !== -1 || /đề-xê|de-xe|offcut/i.test(lbl)) {
      return { text: '♻️ Kho đề-xê', color: '#0F766E' };
    }
    return { text: 'Lấy tồn kho lẻ', color: '#0369A1' };
  }

  function computeWarehouseBomComparison(opts) {
    var o = opts || {};
    var res = o.result || null;
    if (!res || !Array.isArray(res.bars) || !res.bars.length) {
      return {
        isValid: false,
        items: [],
        profiles: [],
        summaryLines: [],
        kpis: {
          totalBars: 0,
          totalFullBars: 0,
          totalOffcuts: 0,
          totalWarehouseBarsTaken: 0,
          totalToBuyBars: 0,
          totalPiecesCut: 0,
          efficiency: 0,
          wasteM: 0,
          savingM: 0
        },
        isDispatched: false,
        deductedAt: null,
        deductedBy: ''
      };
    }

    var rawProj = o.project || {};
    var d = (rawProj.data && typeof rawProj.data === 'object') ? rawProj.data : {};
    var winState = (typeof window !== 'undefined' && window.state && typeof window.state === 'object') ? window.state : null;

    var deductedAt = o.inventoryDeductedAt ||
      rawProj.inventoryDeductedAt ||
      rawProj.inventory_deducted_at ||
      (d && (d.inventoryDeductedAt || d.inventory_deducted_at)) ||
      (winState && winState.inventoryDeductedAt) ||
      null;

    var deductedBy = o.inventoryDeductedBy ||
      rawProj.inventoryDeductedBy ||
      rawProj.inventory_deducted_by ||
      (d && (d.inventoryDeductedBy || d.inventory_deducted_by)) ||
      (winState && winState.inventoryDeductedBy) ||
      '';

    var isDispatched = Boolean(deductedAt);

    var invList = Array.isArray(o.inventoryItems)
      ? o.inventoryItems
      : (winState && Array.isArray(winState.inventoryItems) ? winState.inventoryItems : []);
    var invMap = {};
    invList.forEach(function (r) {
      if (!r) return;
      var name = r.profileName || r.profile_name || r.name;
      if (name) invMap[name] = r;
    });

    var offcutsList = Array.isArray(o.stockOffcuts)
      ? o.stockOffcuts
      : (winState && Array.isArray(winState.stockOffcuts) ? winState.stockOffcuts : []);
    var offcutCountMap = {};
    offcutsList.filter(function (off) {
      if (!off) return false;
      var qty = Number(off.quantity != null ? off.quantity : off.qty) || 0;
      var st = String(off.status || 'available');
      return qty > 0 && (st === 'available' || st === 'opening_stock');
    }).forEach(function (off) {
      var p = off.profile || 'Chung';
      var qty = Number(off.quantity != null ? off.quantity : off.qty) || 0;
      offcutCountMap[p] = (offcutCountMap[p] || 0) + qty;
    });

    var profiles = (res.summaryByProfile && res.summaryByProfile.length)
      ? res.summaryByProfile.map(function (s) { return s.profile; })
      : ['Chung'];

    var usedStocks = (res.byStockType || []).filter(function (s) { return (s.usedQty || 0) > 0; });

    var profileComparisons = [];
    var comparisonLines = [];
    var items = [];
    var totalWarehouseBarsTaken = 0;
    var totalToBuyBars = 0;
    var totalFullBarsNeeded = 0;
    var totalOffcutsUsed = 0;

    profiles.forEach(function (prof) {
      var profStocks = usedStocks.filter(function (s) { return (s.profile || 'Chung') === prof; });
      if (!profStocks.length) return;

      var invRow = invMap[prof];
      var hasInvData = invList.length > 0;
      var whFullQty = invRow ? Math.max(0, Number(invRow.stockQty != null ? invRow.stockQty : invRow.stock_qty) || 0) : 0;
      var whOffPieces = offcutCountMap[prof] || 0;

      var needFullBarsInProf = profStocks.filter(function (s) { return s.availableQty === null; })
        .reduce(function (a, b) { return a + (Number(b.usedQty) || 0); }, 0);
      var offcutsUsedInProf = profStocks.filter(function (s) { return s.availableQty !== null; })
        .reduce(function (a, b) { return a + (Number(b.usedQty) || 0); }, 0);

      totalFullBarsNeeded += needFullBarsInProf;
      totalOffcutsUsed += offcutsUsedInProf;

      var toBuyInProf = 0;
      var takenFromWhInProf = 0;

      if (isDispatched) {
        toBuyInProf = 0;
        takenFromWhInProf = needFullBarsInProf + offcutsUsedInProf;
      } else if (!hasInvData) {
        toBuyInProf = needFullBarsInProf;
        takenFromWhInProf = offcutsUsedInProf;
      } else {
        toBuyInProf = Math.max(0, needFullBarsInProf - whFullQty);
        var takenFull = Math.min(needFullBarsInProf, whFullQty);
        takenFromWhInProf = takenFull + offcutsUsedInProf;
      }

      totalToBuyBars += toBuyInProf;
      totalWarehouseBarsTaken += takenFromWhInProf;

      var summaryLine = '';
      if (isDispatched) {
        summaryLine = '• <b>' + escapeHtml(prof) + ':</b> ✅ Đã xuất kho đủ ' + numVN(needFullBarsInProf) + ' cây cho dự án' +
          (whOffPieces > 0 ? ' (kho còn ' + numVN(whOffPieces) + ' đoạn đề-xê)' : '');
      } else if (!hasInvData) {
        summaryLine = '• <b>' + escapeHtml(prof) + ':</b> Cần dùng ' + numVN(needFullBarsInProf) + ' cây 6m' +
          (offcutsUsedInProf > 0 ? ' + ' + numVN(offcutsUsedInProf) + ' đoạn đề-xê' : '');
      } else {
        summaryLine = '• <b>' + escapeHtml(prof) + ':</b> Trong kho có: <b style="color:#0F766E;">' + numVN(whFullQty) + ' cây nguyên</b> + <b>' + numVN(whOffPieces) + ' đoạn lẻ</b> → ' +
          (toBuyInProf > 0
            ? '<b style="color:#C2410C;">Cần mua thêm: ' + numVN(toBuyInProf) + ' cây</b>'
            : '<b style="color:#15803D;">Đủ trong kho (0 cần mua)</b>');
      }
      comparisonLines.push(summaryLine);

      var remainingWhForItems = whFullQty;

      profStocks.forEach(function (st) {
        var used = Number(st.usedQty) || 0;
        var len = Number(st.length) || 0;
        var meters = (len * used) / 1000;
        var isOff = st.availableQty !== null || /đề-xê|de-xe|offcut|tồn|ton/i.test(st.label || '');
        var cleanLbl = neutralizeStockLabel(st.label, isOff, len);

        var itemTakenWh = 0;
        var itemToBuy = 0;
        var sourceText = '';
        var sourceColor = '';
        var sourceBadgeHtml = '';
        var whDisplay = '';

        if (isOff) {
          itemTakenWh = used;
          itemToBuy = 0;
          sourceText = '♻️ Kho đề-xê';
          sourceColor = '#0F766E';
          sourceBadgeHtml = '<span style="color:#0F766E;font-weight:700;">♻️ Kho đề-xê</span>';
          whDisplay = whOffPieces > 0 ? (numVN(whOffPieces) + ' đoạn') : (st.availableQty != null ? (numVN(st.availableQty) + ' đoạn') : 'Kho đề-xê');
        } else if (isDispatched) {
          itemTakenWh = used;
          itemToBuy = 0;
          sourceText = '✅ Đã xuất kho';
          sourceColor = '#15803D';
          sourceBadgeHtml = '<span style="color:#15803D;font-weight:800;">✅ Đã xuất kho</span>';
          whDisplay = hasInvData ? (numVN(whFullQty) + ' cây') : 'Đã xuất';
        } else if (!hasInvData) {
          itemTakenWh = 0;
          itemToBuy = used;
          sourceText = 'Mua mới 6m';
          sourceColor = '#C2410C';
          sourceBadgeHtml = '<span style="color:#C2410C;font-weight:700;">Mua mới 6m</span>';
          whDisplay = '—';
        } else {
          whDisplay = whOffPieces > 0 ? (numVN(whFullQty) + ' cây (+' + numVN(whOffPieces) + ' lẻ)') : (numVN(whFullQty) + ' cây');
          if (toBuyInProf === 0) {
            itemTakenWh = used;
            itemToBuy = 0;
            sourceText = '✅ Lấy từ kho (Đủ)';
            sourceColor = '#15803D';
            sourceBadgeHtml = '<span style="color:#15803D;font-weight:800;">✅ Lấy từ kho (Đủ)</span>';
          } else if (whFullQty > 0) {
            itemTakenWh = Math.min(used, remainingWhForItems);
            remainingWhForItems = Math.max(0, remainingWhForItems - itemTakenWh);
            itemToBuy = used - itemTakenWh;
            if (itemTakenWh > 0 && itemToBuy > 0) {
              sourceText = 'Kho: ' + itemTakenWh + ' cây · Mua thêm: ' + itemToBuy + ' cây';
              sourceColor = '#C2410C';
              sourceBadgeHtml = '<span style="color:#C2410C;font-weight:800;">Kho: ' + numVN(itemTakenWh) + ' · Mua: ' + numVN(itemToBuy) + '</span>';
            } else if (itemTakenWh > 0 && itemToBuy === 0) {
              sourceText = '✅ Lấy từ kho (' + itemTakenWh + ' cây)';
              sourceColor = '#15803D';
              sourceBadgeHtml = '<span style="color:#15803D;font-weight:800;">✅ Lấy từ kho</span>';
            } else {
              sourceText = '🛒 Mua mới 6m (' + itemToBuy + ' cây)';
              sourceColor = '#C2410C';
              sourceBadgeHtml = '<span style="color:#C2410C;font-weight:800;">🛒 Mua mới ' + numVN(itemToBuy) + ' cây</span>';
            }
          } else {
            itemTakenWh = 0;
            itemToBuy = used;
            sourceText = '🛒 Mua mới 6m';
            sourceColor = '#C2410C';
            sourceBadgeHtml = '<span style="color:#C2410C;font-weight:800;">🛒 Mua mới ' + numVN(used) + ' cây</span>';
          }
        }

        var itemObj = {
          profile: prof,
          rawLabel: st.label || '',
          label: cleanLbl,
          length: len,
          usedQty: used,
          totalMeters: meters,
          isOffcut: isOff,
          warehouseFullQty: whFullQty,
          warehouseOffcutQty: whOffPieces,
          warehouseDisplay: whDisplay,
          takenFromWarehouseQty: itemTakenWh,
          toBuyQty: itemToBuy,
          sourceText: sourceText,
          sourceColor: sourceColor,
          sourceBadgeHtml: sourceBadgeHtml,
          isDispatched: isDispatched
        };
        items.push(itemObj);
      });

      profileComparisons.push({
        profile: prof,
        warehouseFullQty: whFullQty,
        warehouseOffcutQty: whOffPieces,
        needFullBars: needFullBarsInProf,
        offcutsUsed: offcutsUsedInProf,
        toBuy: toBuyInProf,
        takenFromWarehouse: takenFromWhInProf,
        isDispatched: isDispatched
      });
    });

    var u = res.usageStats || {};
    var eff = u.totalNominalLength > 0 ? (u.totalCutLength / u.totalNominalLength * 100) : 0;
    var wasteM = (u.totalWasteLength || 0) / 1000;
    var savingM = (u.totalInterlockSaving || 0) / 1000;

    return {
      isValid: true,
      items: items,
      profiles: profileComparisons,
      summaryLines: comparisonLines,
      kpis: {
        totalBars: res.bars.length,
        totalFullBars: totalFullBarsNeeded,
        totalOffcuts: totalOffcutsUsed,
        totalWarehouseBarsTaken: totalWarehouseBarsTaken,
        totalToBuyBars: totalToBuyBars,
        totalPiecesCut: Number(res.totalPiecesCut) || 0,
        efficiency: eff,
        wasteM: wasteM,
        savingM: savingM
      },
      isDispatched: isDispatched,
      deductedAt: deductedAt,
      deductedBy: deductedBy
    };
  }

  function buildA4SheetHtml(opts) {
    var ctx = normalizeExportContext(opts);
    var res = ctx.result;
    if (!res || !Array.isArray(res.bars) || !res.bars.length) {
      return '<div style="padding:20px;text-align:center;">Chưa có dữ liệu kết quả xếp phôi để in phiếu lệnh sản xuất.</div>';
    }

    var cmp = computeWarehouseBomComparison({
      result: res,
      inventoryItems: ctx.inventoryItems,
      stockOffcuts: ctx.stockOffcuts,
      inventoryDeductedAt: ctx.inventoryDeductedAt,
      inventoryDeductedBy: ctx.inventoryDeductedBy,
      inventoryDeductedSnapshot: ctx.inventoryDeductedSnapshot
    });

    var qrSvg = generateQrSvg(ctx.cncUrl);
    var exportedAtStr = formatDateTimeVN(new Date());

    var dispatchBadgeHtml = '';
    if (ctx.isDispatched) {
      var shortDeductStr = formatShortTime(ctx.inventoryDeductedAt, ctx.inventoryDeductedBy);
      dispatchBadgeHtml = ' <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:#DCFCE7;color:#15803D;border:1.2px solid #86EFAC;font-size:10px;font-weight:800;vertical-align:middle;">✅ Đã xuất kho (' + escapeHtml(shortDeductStr) + ')</span>';
    }

    var headerHtml = [
      '<div class="a4-header">',
      '  <div class="a4-header-left">',
      '    <div class="a4-brand-row">',
      '      <img src="/logo_an_binh.jpg" onerror="this.style.display=\'none\'" alt="An Bình">',
      '      <div>',
      '        <h1 class="a4-title">CƠ KHÍ AN BÌNH — PHIẾU LỆNH SẢN XUẤT &amp; SƠ ĐỒ CẮT CNC</h1>',
      '        <div class="a4-subtitle">Hệ thống quản lý xếp phôi 1D · xepphoi.cloud</div>',
      '      </div>',
      '    </div>',
      '    <div class="a4-meta-grid">',
      '      <div><b>Đơn hàng / Dự án:</b> ' + escapeHtml(ctx.projectName) + (ctx.isLocked ? ' 🔒' : '') + dispatchBadgeHtml + '</div>',
      '      <div><b>Ngày xuất phiếu:</b> ' + escapeHtml(exportedAtStr) + (ctx.exportedBy ? ' (@' + escapeHtml(ctx.exportedBy) + ')' : '') + '</div>',
      '      <div style="grid-column:1/-1;"><b>Khách hàng:</b> ' + escapeHtml(ctx.customer || '—') + ' · <b>Thông số máy cắt:</b> Mạch cắt ' + numVN(ctx.kerf) + ' mm · Kẹp đuôi ' + numVN(ctx.clamp) + ' mm · Xen kẽ ke 45°: ' + (ctx.interlock ? 'BẬT' : 'TẮT') + (ctx.interlock && ctx.gap > 0 ? ' (Hở ' + numVN(ctx.gap) + ' mm)' : '') + '</div>',
      (ctx.notes ? '      <div style="grid-column:1/-1;"><b>Ghi chú:</b> ' + escapeHtml(ctx.notes) + '</div>' : ''),
      '    </div>',
      '  </div>',
      '  <div class="a4-qr-box">',
      '    <div class="a4-qr-svg">' + qrSvg + '</div>',
      '    <div class="a4-qr-cap">Quét QR mở trực tiếp<br>màn hình Thợ CNC</div>',
      '  </div>',
      '</div>'
    ].join('');

    var toBuyColor = cmp.kpis.totalToBuyBars > 0 ? '#C2410C' : '#15803D';
    var kpiHtml = [
      '<div class="a4-kpi-row">',
      '  <div class="a4-kpi-cell"><strong>' + numVN(cmp.kpis.totalBars) + ' cây</strong><span>Tổng cây phôi</span></div>',
      '  <div class="a4-kpi-cell"><strong style="color:' + toBuyColor + ';">' + numVN(cmp.kpis.totalToBuyBars) + ' cây</strong><span>Cần mua thêm</span></div>',
      '  <div class="a4-kpi-cell"><strong style="color:#0F766E;">' + numVN(cmp.kpis.totalWarehouseBarsTaken) + ' cây</strong><span>Lấy từ kho (Nguyên / Đề-xê)</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(cmp.kpis.totalPiecesCut) + ' thanh</strong><span>Tổng chi tiết</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(cmp.kpis.efficiency, 1) + '%</strong><span>Hiệu suất cắt</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(cmp.kpis.wasteM, 2) + ' m</strong><span>Dư (' + (cmp.kpis.savingM > 0 ? 'bớt ke ' + numVN(cmp.kpis.savingM, 2) + 'm' : 'tổng phôi dư') + ')</span></div>',
      '</div>'
    ].join('');

    var bomRowsHtml = '';
    cmp.items.forEach(function (it, idx) {
      var toBuyStr = it.toBuyQty > 0 ? ('<b style="color:#C2410C;">' + numVN(it.toBuyQty) + ' cây</b>') : '0 cây';
      bomRowsHtml += '<tr>' +
        '<td class="c">' + (idx + 1) + '</td>' +
        '<td><b>' + escapeHtml(it.profile || 'Chung') + '</b></td>' +
        '<td>' + escapeHtml(it.label || '') + '</td>' +
        '<td class="r">' + numVN(it.length) + '</td>' +
        '<td class="r"><b>' + numVN(it.usedQty) + '</b><br><span style="font-size:9px;color:#64748B;">' + numVN(it.totalMeters, 2) + 'm</span></td>' +
        '<td class="r" style="color:#0F766E;font-weight:700;">' + escapeHtml(it.warehouseDisplay) + '</td>' +
        '<td class="r">' + toBuyStr + '</td>' +
        '<td style="font-weight:700;color:' + it.sourceColor + ';">' + escapeHtml(it.sourceText) + '</td>' +
      '</tr>';
    });

    var bomTableHtml = [
      '<div class="a4-sec-title">1. Bảng Tổng Hợp Vật Tư &amp; Đối Chiếu Tồn Kho (BOM)</div>',
      '<table class="a4-bom-table">',
      '  <thead><tr><th style="width:28px;" class="c">STT</th><th style="width:115px;">Quy cách thép</th><th>Tên phôi vật tư</th><th class="r" style="width:62px;">Dài (mm)</th><th class="r" style="width:58px;">Cần dùng</th><th class="r" style="width:72px;">Tồn kho</th><th class="r" style="width:65px;">Cần mua</th><th style="width:145px;">Nguồn cấp</th></tr></thead>',
      '  <tbody>' + (bomRowsHtml || '<tr><td colspan="8" style="text-align:center;">Không có dữ liệu vật tư</td></tr>') + '</tbody>',
      '</table>'
    ].join('');

    var profiles = (res.summaryByProfile && res.summaryByProfile.length)
      ? res.summaryByProfile.map(function (s) { return s.profile; })
      : ['Chung'];
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var patternsSectionHtml = '<div class="a4-sec-title">2. Sơ Đồ Cắt Chi Tiết Từng Cây &amp; Tích Tiến Độ Tại Xưởng</div>';

    profiles.forEach(function (prof) {
      var pats = (res.patterns || []).filter(function (p) { return (p.profile || 'Chung') === prof; });
      if (!pats.length) return;
      var profTotalBars = pats.reduce(function (a, b) { return a + (b.count || 0); }, 0);
      patternsSectionHtml += '<div class="a4-prof-block">';
      patternsSectionHtml += '<div class="a4-prof-head"><span>📦 ' + escapeHtml(prof) + '</span><span>Tổng cộng: ' + numVN(profTotalBars) + ' cây</span></div>';

      pats.forEach(function (p, idx) {
        var letter = alphabet[idx % alphabet.length];
        var barKey = prof + '__' + letter;
        var cutRec = ctx.cutStatuses[barKey] || null;
        var cutDone = cutRec ? (Number(cutRec.cutCount) || 0) : 0;

        var layout = (global.RC && typeof global.RC.layoutBar === 'function')
          ? global.RC.layoutBar(p, res.kerf || 0, res.gap || 0, extractMatFromProfile(prof))
          : { pieces: [], end: 0 };
        var keList = (layout.pieces || []).filter(function (g) { return g.eL !== 'S' || g.eR !== 'S'; });
        var H = Math.max(36, Math.max.apply(null, [36].concat(keList.map(function (g) { return g.w || 36; }))));
        var stockW = Number(p.stockLength) || 6000;
        var usableW = Number(p.usableLength) || stockW;
        var clampW = Number(p.clampTail) || 0;
        var wasteW = Math.max(0, Number(p.waste) || 0);

        var svgPolys = '';
        var labelsHtml = '';
        (layout.pieces || []).forEach(function (g) {
          var origIdx = ctx.parts.findIndex(function (x) { return x && x.id === g.c.label; });
          var col = getColor(origIdx >= 0 ? origIdx : 0);
          svgPolys += '<polygon points="' + g.xt0 + ',0 ' + g.xt1 + ',0 ' + g.xb1 + ',' + H + ' ' + g.xb0 + ',' + H + '" fill="' + col + '" stroke="#FFFFFF" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
          var minX = Math.min(g.xb0, g.xt0);
          var maxX = Math.max(g.xb1, g.xt1);
          var leftPct = (minX / stockW) * 100;
          var wPct = ((maxX - minX) / stockW) * 100;
          if (wPct > 3.6) {
            labelsHtml += '<div class="a4-cut-lbl" style="left:' + leftPct.toFixed(3) + '%;width:' + wPct.toFixed(3) + '%;">' + numVN(g.c.length) + '</div>';
          }
        });
        if ((wasteW / stockW) * 100 > 5) {
          labelsHtml += '<div class="a4-cut-lbl waste" style="left:' + (((layout.end || 0) / stockW) * 100).toFixed(3) + '%;width:' + ((wasteW / stockW) * 100).toFixed(3) + '%;">dư ' + numVN(wasteW) + '</div>';
        }
        if (clampW > 0 && (clampW / stockW) * 100 > 1.4) {
          labelsHtml += '<div class="a4-cut-lbl waste" style="left:' + ((usableW / stockW) * 100).toFixed(3) + '%;width:' + ((clampW / stockW) * 100).toFixed(3) + '%;">kẹp ' + numVN(clampW) + '</div>';
        }

        // Nhóm chi tiết hiển thị dưới thanh SVG
        var grouped = [];
        var grpMap = {};
        (layout.pieces || []).forEach(function (g) {
          var pid = g.c.label;
          if (grpMap[pid]) {
            grpMap[pid].count++;
          } else {
            var origIdx = ctx.parts.findIndex(function (x) { return x && x.id === pid; });
            var partObj = origIdx >= 0 ? ctx.parts[origIdx] : null;
            var obj = {
              part: partObj,
              length: g.c.length,
              style: g.c.endStyle,
              count: 1,
              color: getColor(origIdx >= 0 ? origIdx : 0)
            };
            grpMap[pid] = obj;
            grouped.push(obj);
          }
        });
        var pillsHtml = grouped.map(function (it) {
          var stLabel = it.style === 'ke1' ? ' (ke 1 đầu)' : (it.style === 'ke' ? ' (ke 2 đầu)' : '');
          var namePart = (it.part && it.part.name) ? (escapeHtml(it.part.name) + ': ') : '';
          return '<span class="a4-pill"><span class="a4-dot" style="background:' + it.color + ';"></span>' + namePart + numVN(it.length) + ' mm' + stLabel + ' <b>× ' + it.count + '</b></span>';
        }).join('');

        // Ô tích tay cho thợ đứng máy
        var checklistHtml = '';
        if (p.count <= 8) {
          for (var cIdx = 1; cIdx <= p.count; cIdx++) {
            var checkedMark = cIdx <= cutDone ? '✓' : '';
            checklistHtml += '<span class="a4-check-item"><span class="a4-box">' + checkedMark + '</span>#' + cIdx + '</span>';
          }
        } else {
          checklistHtml = '<span class="a4-check-item">☐ Đã cắt: ' + (cutDone > 0 ? ('<b>' + cutDone + '</b>') : '_____') + ' / ' + p.count + ' cây</span>';
        }

        var cleanPatStockLabel = neutralizeStockLabel(p.stockLabel, false, stockW);
        patternsSectionHtml += [
          '<div class="a4-pattern-card">',
          '  <div class="a4-pat-top">',
          '    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">',
          '      <span class="a4-pat-badge">Mẫu ' + letter + '</span>',
          '      <b>× ' + p.count + ' cây</b>',
          '      <span style="color:#475569;font-size:10px;">' + escapeHtml(cleanPatStockLabel) + ' · ' + numVN(stockW) + ' mm · cắt ' + (p.cuts ? p.cuts.length : 0) + ' ct · dư <b>' + numVN(wasteW) + ' mm</b>' + (p.interlockSaving > 0 ? ' · bớt ke ' + numVN(p.interlockSaving) + ' mm' : '') + '</span>',
          '    </div>',
          '    <div class="a4-checklist">' + checklistHtml + '</div>',
          '  </div>',
          '  <div class="a4-svg-wrap">',
          '    <svg viewBox="0 0 ' + stockW + ' ' + H + '" preserveAspectRatio="none">',
          '      <rect x="0" y="0" width="' + usableW + '" height="' + H + '" fill="#DCE2E8"/>',
          (clampW > 0 ? '<rect x="' + usableW + '" y="0" width="' + clampW + '" height="' + H + '" fill="#B8C2CC"/>' : ''),
          svgPolys,
          '    </svg>',
          '    <div class="a4-labels-layer">' + labelsHtml + '</div>',
          '  </div>',
          '  <div class="a4-pills">' + pillsHtml + '</div>',
          '</div>'
        ].join('');
      });

      patternsSectionHtml += '</div>';
    });

    var signHtml = [
      '<div class="a4-sign-grid">',
      '  <div class="a4-sign-col"><div class="a4-sign-title">Kỹ Sư Thiết Kế</div><div class="a4-sign-sub">(Lập lệnh &amp; kiểm tra bản vẽ)</div><div class="a4-sign-line">Ký &amp; ghi rõ họ tên</div></div>',
      '  <div class="a4-sign-col"><div class="a4-sign-title">Thợ Vận Hành CNC</div><div class="a4-sign-sub">(Xác nhận cắt đủ phôi &amp; nhập đề-xê)</div><div class="a4-sign-line">Ký &amp; ghi rõ họ tên</div></div>',
      '  <div class="a4-sign-col"><div class="a4-sign-title">Kiểm Tra Chất Lượng (QC)</div><div class="a4-sign-sub">(Nghiệm thu kích thước &amp; góc vát)</div><div class="a4-sign-line">Ký &amp; ghi rõ họ tên</div></div>',
      '</div>'
    ].join('');

    return headerHtml + kpiHtml + bomTableHtml + patternsSectionHtml + signHtml;
  }

  function printProductionSheet(opts) {
    if (typeof document === 'undefined' || !document.body) return false;
    var ctx = normalizeExportContext(opts);
    if (!ctx.result || !Array.isArray(ctx.result.bars) || !ctx.result.bars.length) {
      return false;
    }

    injectPrintStyles();
    var root = document.getElementById('a4PrintSheetRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'a4PrintSheetRoot';
      document.body.appendChild(root);
    }
    root.innerHTML = buildA4SheetHtml(opts);

    document.body.classList.add('printing-a4-sheet');
    var cleaned = false;
    var cleanup = function () {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-a4-sheet');
      if (typeof global.removeEventListener === 'function') {
        global.removeEventListener('afterprint', cleanup);
      }
    };
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('afterprint', cleanup);
    }
    setTimeout(cleanup, 15000);
    if (typeof global.print === 'function') {
      global.print();
    }
    return true;
  }

  function buildExcelSheetsData(opts) {
    var ctx = normalizeExportContext(opts);
    var res = ctx.result;
    if (!res || !Array.isArray(res.bars) || !res.bars.length) {
      throw new Error('Chưa có dữ liệu tối ưu xếp phôi để xuất Excel!');
    }

    var cmp = computeWarehouseBomComparison({
      result: res,
      inventoryItems: ctx.inventoryItems,
      stockOffcuts: ctx.stockOffcuts,
      inventoryDeductedAt: ctx.inventoryDeductedAt,
      inventoryDeductedBy: ctx.inventoryDeductedBy,
      inventoryDeductedSnapshot: ctx.inventoryDeductedSnapshot
    });

    var u = res.usageStats || {};
    var eff = u.totalNominalLength > 0 ? Math.round((u.totalCutLength / u.totalNominalLength) * 1000) / 10 : 0;

    var dispatchStatusExcel = ctx.isDispatched
      ? ('✅ Đã xuất kho (' + formatShortTime(ctx.inventoryDeductedAt, ctx.inventoryDeductedBy) + ')')
      : 'Chưa xuất kho';

    // Sheet 1: Tổng hợp BOM vật tư & Đối chiếu tồn kho
    var sheet1Rows = [
      ['CƠ KHÍ AN BÌNH — PHIẾU TỔNG HỢP VẬT TƯ (BOM) & ĐỐI CHIẾU TỒN KHO'],
      ['Đơn hàng / Dự án:', ctx.projectName, '', 'Mã dự án:', ctx.isRealProj ? ctx.projectId : 'Nháp'],
      ['Khách hàng:', ctx.customer || '—', '', 'Ngày xuất:', formatDateTimeVN(new Date())],
      ['Thông số cắt:', 'Mạch ' + ctx.kerf + 'mm | Kẹp đuôi ' + ctx.clamp + 'mm | Xen kẽ ke: ' + (ctx.interlock ? 'Bật' : 'Tắt'), '', 'Trạng thái kho:', dispatchStatusExcel],
      ['Link CNC:', ctx.cncUrl, '', 'Người xuất:', ctx.exportedBy ? ('@' + ctx.exportedBy) : '—'],
      [],
      ['STT', 'Quy cách thép', 'Tên phôi vật tư', 'Chiều dài (mm)', 'Cần dùng (cây)', 'Tồn kho xưởng', 'Lấy từ kho', 'Cần mua thêm', 'Nguồn cấp', 'Tổng chiều dài (m)']
    ];

    var sumMeters = 0;
    cmp.items.forEach(function (it, idx) {
      sumMeters += it.totalMeters;
      sheet1Rows.push([
        idx + 1,
        it.profile || 'Chung',
        it.label || '',
        Number(it.length) || 0,
        Number(it.usedQty) || 0,
        it.warehouseDisplay,
        Number(it.takenFromWarehouseQty) || 0,
        Number(it.toBuyQty) || 0,
        it.sourceText,
        Math.round(it.totalMeters * 100) / 100
      ]);
    });

    sheet1Rows.push([]);
    sheet1Rows.push([
      'TỔNG CỘNG', '', '', '',
      cmp.kpis.totalBars,
      '',
      cmp.kpis.totalWarehouseBarsTaken,
      cmp.kpis.totalToBuyBars,
      'Lấy từ kho: ' + cmp.kpis.totalWarehouseBarsTaken + ' | Cần mua: ' + cmp.kpis.totalToBuyBars,
      Math.round(sumMeters * 100) / 100
    ]);
    sheet1Rows.push([
      'HIỆU SUẤT CẮT (%)', eff,
      'Tổng chi tiết:', cmp.kpis.totalPiecesCut,
      'Tổng phôi dư (m):', Math.round(((u.totalWasteLength || 0) / 1000) * 100) / 100,
      'Tiết kiệm ke (m):', Math.round(((u.totalInterlockSaving || 0) / 1000) * 100) / 100
    ]);

    // Sheet 2: Chi tiết sơ đồ cắt từng cây
    var sheet2Rows = [
      ['CHI TIẾT SƠ ĐỒ CẮT TỪNG CÂY — ' + ctx.projectName],
      ['STT', 'Quy cách thép', 'Mã mẫu', 'SL cây', 'Loại phôi', 'Dài phôi (mm)', 'Số chi tiết/cây', 'Chi tiết cắt (Tên & mm)', 'Phôi dư (mm)', 'Kẹp đuôi (mm)', 'Tiết kiệm ke (mm)', 'Đã cắt (cây)', 'Trạng thái', 'Cập nhật bởi']
    ];

    var profiles = (res.summaryByProfile && res.summaryByProfile.length)
      ? res.summaryByProfile.map(function (s) { return s.profile; })
      : ['Chung'];
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var stt = 1;

    profiles.forEach(function (prof) {
      var pats = (res.patterns || []).filter(function (p) { return (p.profile || 'Chung') === prof; });
      pats.forEach(function (p, idx) {
        var letter = alphabet[idx % alphabet.length];
        var barKey = prof + '__' + letter;
        var cutRec = ctx.cutStatuses[barKey] || null;
        var cutDone = cutRec ? (Number(cutRec.cutCount) || 0) : 0;
        var stText = cutDone >= p.count ? 'Đã xong' : (cutDone > 0 ? 'Đang cắt' : 'Chưa cắt');

        var cutsSummary = (p.cuts || []).map(function (c) {
          var partObj = ctx.parts.find(function (pt) { return pt && pt.id === c.label; });
          var namePrefix = (partObj && partObj.name) ? (partObj.name + ' ') : '';
          var styleTxt = c.endStyle && c.endStyle !== 'thang' ? ('(' + c.endStyle + ')') : '';
          return namePrefix + c.length + styleTxt;
        }).join(' + ');

        var cleanPStockLabel = neutralizeStockLabel(p.stockLabel, false, p.stockLength);

        sheet2Rows.push([
          stt++,
          prof,
          'Mẫu ' + letter,
          Number(p.count) || 1,
          cleanPStockLabel,
          Number(p.stockLength) || 0,
          (p.cuts || []).length,
          cutsSummary,
          Math.max(0, Math.round((Number(p.waste) || 0) * 100) / 100),
          Number(p.clampTail) || 0,
          Number(p.interlockSaving) || 0,
          cutDone,
          stText,
          cutRec && cutRec.updatedBy ? ('@' + cutRec.updatedBy) : ''
        ]);
      });
    });

    return {
      ctx: ctx,
      sheet1Rows: sheet1Rows,
      sheet2Rows: sheet2Rows
    };
  }

  function exportExcelXlsx(opts) {
    var data = buildExcelSheetsData(opts);
    var safeProj = toAsciiSafe(data.ctx.projectName).slice(0, 40);
    var dateStr = new Date().toISOString().slice(0, 10);

    if (typeof global.XLSX !== 'undefined' && global.XLSX && global.XLSX.utils) {
      var XLSX = global.XLSX;
      var wb = XLSX.utils.book_new();
      var ws1 = XLSX.utils.aoa_to_sheet(data.sheet1Rows);
      ws1['!cols'] = [
        { wch: 6 },  // STT
        { wch: 20 }, // Quy cách thép
        { wch: 28 }, // Tên phôi vật tư
        { wch: 14 }, // Chiều dài (mm)
        { wch: 14 }, // Cần dùng (cây)
        { wch: 16 }, // Tồn kho xưởng
        { wch: 13 }, // Lấy từ kho
        { wch: 14 }, // Cần mua thêm
        { wch: 26 }, // Nguồn cấp
        { wch: 18 }  // Tổng chiều dài (m)
      ];
      var ws2 = XLSX.utils.aoa_to_sheet(data.sheet2Rows);
      ws2['!cols'] = [
        { wch: 6 }, { wch: 18 }, { wch: 10 }, { wch: 9 }, { wch: 24 },
        { wch: 14 }, { wch: 14 }, { wch: 48 }, { wch: 13 }, { wch: 13 },
        { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 16 }
      ];
      XLSX.utils.book_append_sheet(wb, ws1, 'TongHop_BOM');
      XLSX.utils.book_append_sheet(wb, ws2, 'SoDo_CatChiTiet');
      var xlsxName = 'LenhSanXuat_' + safeProj + '_' + dateStr + '.xlsx';
      XLSX.writeFile(wb, xlsxName);
      return { ok: true, format: 'xlsx', fileName: xlsxName };
    }

    // Fallback CSV khi mất mạng không tải được SheetJS CDN
    var allCsvRows = []
      .concat(data.sheet1Rows)
      .concat([[]])
      .concat(data.sheet2Rows);
    var csvText = '\uFEFF' + allCsvRows.map(function (row) {
      return (row || []).map(function (cell) {
        return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    var csvName = 'LenhSanXuat_' + safeProj + '_' + dateStr + '.csv';
    if (typeof Blob !== 'undefined' && typeof document !== 'undefined' && typeof URL !== 'undefined') {
      var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = csvName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    return { ok: true, format: 'csv', fileName: csvName };
  }

  // =========================================================================
  // KHO PHÔI ĐỢT 4: EXCEL MẪU PHÔI LẺ, PARSE COPY-PASTE & BÁO CÁO KHO (.XLSX)
  // =========================================================================
  var TX_TYPE_LABELS = {
    opening_balance: 'Tồn đầu kỳ',
    purchase_in: 'Nhập mua mới',
    project_out: 'Xuất cho dự án',
    project_return: 'Hoàn kho dự án',
    offcut_in: 'Nhập đề-xê CNC',
    offcut_out: 'Xuất phôi lẻ',
    stocktake_adjust: 'Kiểm kê điều chỉnh'
  };

  var OFFCUT_SOURCE_LABELS = {
    opening_stock: 'Phôi cũ đầu kỳ',
    cnc_return: 'Đề-xê từ CNC',
    manual: 'Nhập tay'
  };

  function _downloadCsvFallback(rows, fileName) {
    var csvText = '\uFEFF' + rows.map(function (row) {
      return (row || []).map(function (cell) {
        return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    if (typeof Blob !== 'undefined' && typeof document !== 'undefined' && typeof URL !== 'undefined') {
      var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
  }

  function _parseSpreadsheetNumber(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return NaN;
    s = s.replace(/\s*(?:mm|m|cây|cay|đoạn|doan)\s*$/i, '').trim();
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) {
      s = s.replace(/[.,]/g, '');
    } else if (/^\d+,\d{1,2}$/.test(s)) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  function parseOffcutsArrayRows(aoaRows) {
    var input = Array.isArray(aoaRows) ? aoaRows : [];
    var rows = [];
    var skipped = [];

    for (var i = 0; i < input.length; i++) {
      var rawRow = input[i];
      if (!Array.isArray(rawRow)) continue;
      var cells = rawRow.map(function (c) { return String(c == null ? '' : c).trim(); });
      if (!cells.some(Boolean)) continue;

      var c0Lower = (cells[0] || '').toLowerCase();
      var c1Lower = (cells[1] || '').toLowerCase();
      var isHeader = /quy\s*cách|quy\s*cach|profile|loại\s*hộp|loai\s*hop|^stt$/i.test(c0Lower) ||
        /chiều\s*dài|chieu\s*dai|length/i.test(c1Lower);
      if (isHeader) continue;

      // Hỗ trợ tự động nếu file Excel có cột STT ở đầu (col 0 = số thứ tự nhỏ, col 1 = tên hộp chữ)
      var offset = 0;
      if (/^\d{1,4}$/.test(cells[0]) && cells.length >= 4 && isNaN(_parseSpreadsheetNumber(cells[1])) && !isNaN(_parseSpreadsheetNumber(cells[2]))) {
        offset = 1;
      }

      var profile = String(cells[offset] || '').trim();
      var lenVal = _parseSpreadsheetNumber(cells[offset + 1]);
      var qtyRaw = _parseSpreadsheetNumber(cells[offset + 2]);
      var rackLoc = String(cells[offset + 3] || '').trim();
      var noteStr = String(cells[offset + 4] || '').trim();

      if (!profile || !(lenVal > 0)) {
        skipped.push({ line: i + 1, raw: cells.join(' | '), reason: !profile ? 'Thiếu quy cách' : 'Chiều dài không hợp lệ' });
        continue;
      }
      var qty = (!isNaN(qtyRaw) && qtyRaw >= 1) ? Math.round(qtyRaw) : 1;
      rows.push({
        profile: profile,
        lengthMm: Math.round(lenVal * 100) / 100,
        quantity: qty,
        rackLocation: rackLoc,
        note: noteStr
      });
    }
    return { rows: rows, skipped: skipped };
  }

  function parseOffcutsPasteText(text) {
    var str = String(text || '');
    if (!str.trim()) return { rows: [], skipped: [] };
    var lines = str.split(/\r?\n/);
    var aoa = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      var parts;
      if (line.indexOf('\t') !== -1) {
        parts = line.split('\t');
      } else if (line.indexOf(';') !== -1) {
        parts = line.split(';');
      } else if (line.indexOf('|') !== -1) {
        parts = line.split('|');
      } else {
        parts = line.split(',');
      }
      aoa.push(parts);
    }
    return parseOffcutsArrayRows(aoa);
  }

  function downloadOpeningOffcutsTemplateXlsx() {
    var sheet1Rows = [
      ['Quy cách', 'Chiều dài (mm)', 'Số lượng', 'Vị trí kệ', 'Ghi chú'],
      ['Hộp 30x30x1.8', 2450, 3, 'Kệ B1', 'Phôi lẻ cũ trước khi dùng web'],
      ['Hộp 40x80x2.0', 1850, 2, 'Kệ A2', 'Khúc thừa lan can dự án cũ'],
      ['Ống Ø27x1.4', 1200, 5, 'Kệ C1', 'Đoạn ống còn tồn kho']
    ];
    var guideRows = [
      ['HƯỚNG DẪN NHẬP FILE EXCEL PHÔI LẺ / ĐỀ-XÊ TỒN ĐẦU KỲ'],
      ['Cột A - Quy cách', 'Nhập tên quy cách thép (ví dụ: Hộp 30x30x1.8). Nên trùng tên thư viện xưởng.'],
      ['Cột B - Chiều dài (mm)', 'Nhập số nguyên mm (ví dụ: 2450, không gõ chữ mm).'],
      ['Cột C - Số lượng', 'Số đoạn phôi có cùng quy cách và chiều dài này (mặc định 1 nếu bỏ trống).'],
      ['Cột D - Vị trí kệ', 'Tên giá/kệ ngoài xưởng (ví dụ: Kệ B1) để thợ dễ tìm lấy cắt.'],
      ['Cột E - Ghi chú', 'Ghi chú thêm nếu có. Có thể Copy trực tiếp 5 cột từ Excel và Dán vào web!']
    ];

    if (typeof global.XLSX !== 'undefined' && global.XLSX && global.XLSX.utils) {
      var XLSX = global.XLSX;
      var wb = XLSX.utils.book_new();
      var ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows);
      ws1['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 36 }];
      var ws2 = XLSX.utils.aoa_to_sheet(guideRows);
      ws2['!cols'] = [{ wch: 24 }, { wch: 70 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'PhoiLe_DauKy');
      XLSX.utils.book_append_sheet(wb, ws2, 'HuongDan');
      var fileName = 'Mau_Nhap_Phoi_Le_Dau_Ky_AnBinh.xlsx';
      XLSX.writeFile(wb, fileName);
      return { ok: true, format: 'xlsx', fileName: fileName };
    }
    var csvName = 'Mau_Nhap_Phoi_Le_Dau_Ky_AnBinh.csv';
    _downloadCsvFallback(sheet1Rows, csvName);
    return { ok: true, format: 'csv', fileName: csvName };
  }

  function buildInventoryReportSheetsData(opts) {
    var o = opts || {};
    var invItems = Array.isArray(o.inventoryItems) ? o.inventoryItems : [];
    var offcuts = Array.isArray(o.stockOffcuts) ? o.stockOffcuts : [];
    var txs = Array.isArray(o.transactions) ? o.transactions : [];
    var nowStr = formatDateTimeVN(new Date());

    var sheetBars = [
      ['CƠ KHÍ AN BÌNH — BÁO CÁO TỒN KHO CÂY NGUYÊN'],
      ['Ngày xuất báo cáo:', nowStr, 'Người xuất:', o.exportedBy ? '@' + o.exportedBy : '—'],
      [],
      ['STT', 'Quy cách thép', 'Loại', 'Dài chuẩn (mm)', 'Tồn kho (cây)', 'Định mức tối thiểu', 'Trạng thái tồn', 'Kg/m', 'Tổng khối lượng (kg)', 'Đơn giá (đ)', 'Vị trí kệ']
    ];
    invItems.forEach(function (item, idx) {
      var qty = Math.max(0, Number(item.stockQty) || 0);
      var stdLen = Number(item.standardLengthMm || item.standardLength) || 6000;
      var minQty = Math.max(0, Number(item.minStockQty) || 0);
      var wPerM = Math.max(0, Number(item.weightPerM) || 0);
      var totalKg = Math.round(qty * (stdLen / 1000) * wPerM * 100) / 100;
      var statusTxt = qty === 0 ? 'Hết hàng' : (minQty > 0 && qty <= minQty ? 'Sắp hết hàng' : 'Đủ tồn');
      sheetBars.push([
        idx + 1,
        item.profileName || '',
        item.category || '',
        stdLen,
        qty,
        minQty,
        statusTxt,
        wPerM,
        totalKg,
        Number(item.unitPrice) || 0,
        item.rackLocation || ''
      ]);
    });

    var sheetOffcuts = [
      ['CƠ KHÍ AN BÌNH — BÁO CÁO KHO PHÔI LẺ & ĐỀ-XÊ'],
      ['Ngày xuất báo cáo:', nowStr],
      [],
      ['STT', 'Quy cách thép', 'Chiều dài (mm)', 'Số đoạn', 'Tổng dài (m)', 'Nguồn nhập', 'Trạng thái', 'Vị trí kệ', 'Dự án tạo', 'Ghi chú', 'Người nhập', 'Ngày nhập']
    ];
    offcuts.forEach(function (off, idx) {
      var qty = Math.max(0, Number(off.quantity) || 0);
      var meters = Math.round(((Number(off.lengthMm) || 0) * qty) / 10) / 100;
      sheetOffcuts.push([
        idx + 1,
        off.profile || '',
        Number(off.lengthMm) || 0,
        qty,
        meters,
        OFFCUT_SOURCE_LABELS[off.sourceType] || off.sourceType || 'Nhập tay',
        off.status === 'used' ? 'Đã dùng hết' : (off.status === 'reserved' ? 'Đã giữ' : 'Khả dụng'),
        off.rackLocation || '',
        off.sourceProjectName || '',
        off.note || off.notes || '',
        off.createdBy ? ('@' + off.createdBy) : '',
        off.createdAt ? formatDateTimeVN(off.createdAt) : ''
      ]);
    });

    var sheetLedger = [
      ['CƠ KHÍ AN BÌNH — SỔ CÁI XUẤT NHẬP KHO'],
      ['Ngày xuất báo cáo:', nowStr, 'Bộ lọc:', o.filtersLabel || 'Tất cả'],
      [],
      ['STT', 'Thời gian', 'Loại giao dịch', 'Quy cách thép', 'Chiều dài (mm)', 'Thay đổi (+/-)', 'Tồn sau GD', 'Mã dự án', 'Ghi chú', 'Người thực hiện']
    ];
    txs.forEach(function (tx, idx) {
      sheetLedger.push([
        idx + 1,
        tx.createdAt ? formatDateTimeVN(tx.createdAt) : '',
        TX_TYPE_LABELS[tx.txType] || tx.txType || '',
        tx.profile || '',
        Number(tx.lengthMm) || 6000,
        Number(tx.qtyChange) || 0,
        tx.balanceAfter != null ? Number(tx.balanceAfter) : '',
        tx.projectId || '',
        tx.note || '',
        tx.createdBy ? ('@' + tx.createdBy) : ''
      ]);
    });

    return {
      sheetBars: sheetBars,
      sheetOffcuts: sheetOffcuts,
      sheetLedger: sheetLedger
    };
  }

  function exportInventoryReportXlsx(opts) {
    var data = buildInventoryReportSheetsData(opts);
    var dateStr = new Date().toISOString().slice(0, 10);
    if (typeof global.XLSX !== 'undefined' && global.XLSX && global.XLSX.utils) {
      var XLSX = global.XLSX;
      var wb = XLSX.utils.book_new();
      var ws1 = XLSX.utils.aoa_to_sheet(data.sheetBars);
      ws1['!cols'] = [
        { wch: 6 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
        { wch: 16 }, { wch: 15 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 14 }
      ];
      var ws2 = XLSX.utils.aoa_to_sheet(data.sheetOffcuts);
      ws2['!cols'] = [
        { wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
        { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 30 }, { wch: 14 }, { wch: 18 }
      ];
      var ws3 = XLSX.utils.aoa_to_sheet(data.sheetLedger);
      ws3['!cols'] = [
        { wch: 6 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 14 },
        { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 36 }, { wch: 16 }
      ];
      XLSX.utils.book_append_sheet(wb, ws1, 'TonKho_CayNguyen');
      XLSX.utils.book_append_sheet(wb, ws2, 'Kho_PhoiLe_DeXe');
      XLSX.utils.book_append_sheet(wb, ws3, 'SoCai_XuatNhap');
      var fileName = 'BaoCao_KhoPhoi_AnBinh_' + dateStr + '.xlsx';
      XLSX.writeFile(wb, fileName);
      return { ok: true, format: 'xlsx', fileName: fileName };
    }
    var csvName = 'BaoCao_KhoPhoi_AnBinh_' + dateStr + '.csv';
    _downloadCsvFallback([].concat(data.sheetBars).concat([[]]).concat(data.sheetOffcuts).concat([[]]).concat(data.sheetLedger), csvName);
    return { ok: true, format: 'csv', fileName: csvName };
  }

  global.WorkshopExport = {
    TX_TYPE_LABELS: TX_TYPE_LABELS,
    OFFCUT_SOURCE_LABELS: OFFCUT_SOURCE_LABELS,
    neutralizeStockLabel: neutralizeStockLabel,
    computeWarehouseBomComparison: computeWarehouseBomComparison,
    generateQrSvg: generateQrSvg,
    buildA4SheetHtml: buildA4SheetHtml,
    printProductionSheet: printProductionSheet,
    buildExcelSheetsData: buildExcelSheetsData,
    exportExcelXlsx: exportExcelXlsx,
    parseOffcutsArrayRows: parseOffcutsArrayRows,
    parseOffcutsPasteText: parseOffcutsPasteText,
    downloadOpeningOffcutsTemplateXlsx: downloadOpeningOffcutsTemplateXlsx,
    buildInventoryReportSheetsData: buildInventoryReportSheetsData,
    exportInventoryReportXlsx: exportInventoryReportXlsx
  };
})(typeof window !== 'undefined' ? window : globalThis);
