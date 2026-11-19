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

    var isRealProj = Boolean(projectId && projectId !== '__draft__');
    var cncUrl = isRealProj
      ? ('https://xepphoi.cloud/cnc/?project=' + encodeURIComponent(String(projectId)))
      : 'https://xepphoi.cloud/cnc/';

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
      cncUrl: cncUrl
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
    var target = String(url || 'https://xepphoi.cloud/cnc/');
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
      return { text: '♻️ Tận dụng đề-xê kho', color: '#0F766E' };
    }
    return { text: 'Lấy tồn kho lẻ', color: '#0369A1' };
  }

  function buildA4SheetHtml(opts) {
    var ctx = normalizeExportContext(opts);
    var res = ctx.result;
    if (!res || !Array.isArray(res.bars) || !res.bars.length) {
      return '<div style="padding:20px;text-align:center;">Chưa có dữ liệu kết quả xếp phôi để in phiếu lệnh sản xuất.</div>';
    }

    var u = res.usageStats || {};
    var eff = u.totalNominalLength > 0 ? (u.totalCutLength / u.totalNominalLength * 100) : 0;
    var wasteM = (u.totalWasteLength || 0) / 1000;
    var savingM = (u.totalInterlockSaving || 0) / 1000;
    var qrSvg = generateQrSvg(ctx.cncUrl);
    var exportedAtStr = formatDateTimeVN(new Date());
    var revStr = formatRevisionCode(ctx.updatedAt);

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
      '      <div><b>Đơn hàng / Dự án:</b> ' + escapeHtml(ctx.projectName) + (ctx.isLocked ? ' 🔒' : '') + '</div>',
      '      <div><b>Mã &amp; Phiên bản:</b> ' + escapeHtml(ctx.isRealProj ? ctx.projectId : 'Nháp') + ' · ' + escapeHtml(revStr) + '</div>',
      '      <div><b>Khách hàng:</b> ' + escapeHtml(ctx.customer || '—') + '</div>',
      '      <div><b>Ngày xuất phiếu:</b> ' + escapeHtml(exportedAtStr) + (ctx.exportedBy ? ' (@' + escapeHtml(ctx.exportedBy) + ')' : '') + '</div>',
      '      <div style="grid-column:1/-1;"><b>Thông số máy cắt:</b> Mạch cắt ' + numVN(ctx.kerf) + ' mm · Kẹp đuôi ' + numVN(ctx.clamp) + ' mm · Xen kẽ ke 45°: ' + (ctx.interlock ? 'BẬT' : 'TẮT') + (ctx.interlock && ctx.gap > 0 ? ' (Hở ' + numVN(ctx.gap) + ' mm)' : '') + (ctx.notes ? ' · <b>Ghi chú:</b> ' + escapeHtml(ctx.notes) : '') + '</div>',
      '    </div>',
      '  </div>',
      '  <div class="a4-qr-box">',
      '    <div class="a4-qr-svg">' + qrSvg + '</div>',
      '    <div class="a4-qr-cap">Quét QR mở trực tiếp<br>màn hình Thợ CNC</div>',
      '  </div>',
      '</div>'
    ].join('');

    var kpiHtml = [
      '<div class="a4-kpi-row">',
      '  <div class="a4-kpi-cell"><strong>' + numVN(res.bars.length) + ' cây</strong><span>Tổng cây phôi</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(res.totalNewBars) + ' cây</strong><span>Mua mới 6m</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(res.totalExistingUsed) + ' cây</strong><span>Tồn / Đề-xê</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(res.totalPiecesCut) + ' thanh</strong><span>Tổng chi tiết</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(eff, 1) + '%</strong><span>Hiệu suất cắt</span></div>',
      '  <div class="a4-kpi-cell"><strong>' + numVN(wasteM, 2) + ' m</strong><span>Dư (' + (savingM > 0 ? 'bớt ke ' + numVN(savingM, 2) + 'm' : 'tổng phôi dư') + ')</span></div>',
      '</div>'
    ].join('');

    var bomRowsHtml = '';
    var usedStocks = (res.byStockType || []).filter(function (s) { return (s.usedQty || 0) > 0; });
    usedStocks.forEach(function (st, idx) {
      var srcInfo = detectSourceTag(st);
      var totalMeters = ((Number(st.length) || 0) * (Number(st.usedQty) || 0)) / 1000;
      bomRowsHtml += '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><b>' + escapeHtml(st.profile || 'Chung') + '</b></td>' +
        '<td>' + escapeHtml(st.label || '') + '</td>' +
        '<td class="r">' + numVN(st.length) + '</td>' +
        '<td class="r"><b>' + numVN(st.usedQty) + '</b></td>' +
        '<td class="r">' + numVN(totalMeters, 2) + ' m</td>' +
        '<td style="font-weight:700;color:' + srcInfo.color + ';">' + escapeHtml(srcInfo.text) + '</td>' +
      '</tr>';
    });

    var bomTableHtml = [
      '<div class="a4-sec-title">1. Bảng Tổng Hợp Vật Tư (BOM)</div>',
      '<table class="a4-bom-table">',
      '  <thead><tr><th style="width:32px;">STT</th><th>Quy cách thép</th><th>Tên phôi vật tư</th><th class="r">Dài (mm)</th><th class="r">SL dùng</th><th class="r">Tổng dài</th><th>Nguồn cấp</th></tr></thead>',
      '  <tbody>' + (bomRowsHtml || '<tr><td colspan="7" style="text-align:center;">Không có dữ liệu vật tư</td></tr>') + '</tbody>',
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

        patternsSectionHtml += [
          '<div class="a4-pattern-card">',
          '  <div class="a4-pat-top">',
          '    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">',
          '      <span class="a4-pat-badge">Mẫu ' + letter + '</span>',
          '      <b>× ' + p.count + ' cây</b>',
          '      <span style="color:#475569;font-size:10px;">' + escapeHtml(p.stockLabel || '') + ' · ' + numVN(stockW) + ' mm · cắt ' + (p.cuts ? p.cuts.length : 0) + ' ct · dư <b>' + numVN(wasteW) + ' mm</b>' + (p.interlockSaving > 0 ? ' · bớt ke ' + numVN(p.interlockSaving) + ' mm' : '') + '</span>',
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

    var u = res.usageStats || {};
    var eff = u.totalNominalLength > 0 ? Math.round((u.totalCutLength / u.totalNominalLength) * 1000) / 10 : 0;
    var usedStocks = (res.byStockType || []).filter(function (s) { return (s.usedQty || 0) > 0; });

    // Sheet 1: Tổng hợp BOM vật tư
    var sheet1Rows = [
      ['CƠ KHÍ AN BÌNH — PHIẾU TỔNG HỢP VẬT TƯ (BOM)'],
      ['Đơn hàng / Dự án:', ctx.projectName, '', 'Mã dự án:', ctx.isRealProj ? ctx.projectId : 'Nháp'],
      ['Khách hàng:', ctx.customer || '—', '', 'Ngày xuất:', formatDateTimeVN(new Date())],
      ['Thông số cắt:', 'Mạch ' + ctx.kerf + 'mm | Kẹp đuôi ' + ctx.clamp + 'mm | Xen kẽ ke: ' + (ctx.interlock ? 'Bật' : 'Tắt'), '', 'Link CNC:', ctx.cncUrl],
      [],
      ['STT', 'Quy cách thép', 'Tên phôi vật tư', 'Chiều dài (mm)', 'Đang có', 'Cần dùng (cây)', 'Nguồn cấp', 'Tổng chiều dài (m)']
    ];

    var sumMeters = 0;
    usedStocks.forEach(function (st, idx) {
      var srcInfo = detectSourceTag(st);
      var meters = Math.round(((Number(st.length) || 0) * (Number(st.usedQty) || 0)) / 10) / 100;
      sumMeters += meters;
      sheet1Rows.push([
        idx + 1,
        st.profile || 'Chung',
        st.label || '',
        Number(st.length) || 0,
        st.availableQty === null ? 'Không giới hạn' : Number(st.availableQty),
        Number(st.usedQty) || 0,
        srcInfo.text,
        meters
      ]);
    });

    sheet1Rows.push([]);
    sheet1Rows.push(['TỔNG CỘNG', '', '', '', '', res.bars.length, 'Mới: ' + res.totalNewBars + ' | Tồn/Đề-xê: ' + res.totalExistingUsed, Math.round(sumMeters * 100) / 100]);
    sheet1Rows.push(['HIỆU SUẤT CẮT (%)', eff, 'Tổng chi tiết:', res.totalPiecesCut, 'Tổng phôi dư (m):', Math.round(((u.totalWasteLength || 0) / 1000) * 100) / 100, 'Tiết kiệm ke (m):', Math.round(((u.totalInterlockSaving || 0) / 1000) * 100) / 100]);

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

        sheet2Rows.push([
          stt++,
          prof,
          'Mẫu ' + letter,
          Number(p.count) || 1,
          p.stockLabel || '',
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
        { wch: 10 }, { wch: 22 }, { wch: 28 }, { wch: 15 },
        { wch: 14 }, { wch: 15 }, { wch: 24 }, { wch: 18 }
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

  global.WorkshopExport = {
    generateQrSvg: generateQrSvg,
    buildA4SheetHtml: buildA4SheetHtml,
    printProductionSheet: printProductionSheet,
    buildExcelSheetsData: buildExcelSheetsData,
    exportExcelXlsx: exportExcelXlsx
  };
})(typeof window !== 'undefined' ? window : globalThis);
