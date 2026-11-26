/**
 * ============================================================================
 * MOBILE CAMERA QR SCANNER - XẾP PHÔI AN BÌNH (xepphoi.cloud)
 * Dùng html5-qrcode (ưu tiên camera sau, hỗ trợ bật đèn flash, bíp & rung).
 * Hỗ trợ mã: XP:INV:<id>, XP:OFF:<id>, XP:RACK:<rack_code>
 * ============================================================================
 */
(function (global) {
  'use strict';

  var HTML5_QRCODE_CDN = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  var _libPromise = null;
  var _activeScanner = null;
  var _torchOn = false;
  var _audioCtx = null;

  function loadHtml5QrCodeLib() {
    if (typeof global.Html5Qrcode !== 'undefined') return Promise.resolve(global.Html5Qrcode);
    if (_libPromise) return _libPromise;
    _libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = HTML5_QRCODE_CDN;
      s.async = true;
      s.onload = function () {
        if (typeof global.Html5Qrcode !== 'undefined') resolve(global.Html5Qrcode);
        else reject(new Error('Không khởi tạo được thư viện Html5Qrcode'));
      };
      s.onerror = function () {
        _libPromise = null;
        reject(new Error('Không tải được thư viện quét QR (kiểm tra kết nối mạng)'));
      };
      document.head.appendChild(s);
    });
    return _libPromise;
  }

  function playBeep() {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(65);
      }
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      if (!_audioCtx) _audioCtx = new Ctx();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      var osc = _audioCtx.createOscillator();
      var gain = _audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046, _audioCtx.currentTime);
      gain.gain.setValueAtTime(0.14, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.start();
      osc.stop(_audioCtx.currentTime + 0.13);
    } catch (e) {}
  }

  function parseQrPayload(text) {
    var raw = String(text || '').trim();
    if (!raw) return { kind: 'EMPTY', raw: '' };
    if (raw.indexOf('XP:INV:') === 0) {
      return { kind: 'INV', id: raw.slice(7).trim(), raw: raw };
    }
    if (raw.indexOf('XP:OFF:') === 0) {
      return { kind: 'OFF', id: raw.slice(7).trim(), raw: raw };
    }
    if (raw.indexOf('XP:RACK:') === 0) {
      return { kind: 'RACK', rack: raw.slice(8).trim(), raw: raw };
    }
    if (raw.indexOf('XP:PROJ:') === 0) {
      var projRest = raw.slice(8).trim();
      var revMatch = projRest.match(/^(.+?):R(\d+)$/i);
      if (revMatch) {
        return { kind: 'PROJ', id: revMatch[1].trim(), rev: Number(revMatch[2]) || 1, raw: raw };
      }
      return { kind: 'PROJ', id: projRest, rev: null, raw: raw };
    }
    if (raw.indexOf('XP:FG:') === 0) {
      return { kind: 'FG', id: raw.slice(6).trim(), raw: raw };
    }
    return { kind: 'RAW', raw: raw };
  }

  function ensureModalDom() {
    var existing = document.getElementById('xpQrScannerModal');
    if (existing) return existing;

    var wrap = document.createElement('div');
    wrap.id = 'xpQrScannerModal';
    wrap.className = 'inv-modal-backdrop no-print';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.zIndex = '450';
    wrap.innerHTML = [
      '<div class="inv-modal narrow" style="width:min(480px, 100%);">',
      '  <div class="inv-modal-head">',
      '    <div>',
      '      <h3 id="xpQrTitle" style="font-size:16px; margin:0;">📷 Quét Mã QR Kho Xưởng</h3>',
      '      <div id="xpQrSubtitle" style="font-size:12px; color:#475569; margin-top:2px;">Đưa camera về phía tem QR vật tư hoặc vị trí kệ</div>',
      '    </div>',
      '    <button type="button" class="btn btn-soft btn-sm" id="xpQrBtnClose">✕ Đóng</button>',
      '  </div>',
      '  <div class="inv-modal-body" style="padding:14px;">',
      '    <div id="xpQrReaderBox" style="width:100%; min-height:260px; background:#0F172A; border-radius:12px; overflow:hidden; position:relative;"></div>',
      '    <div id="xpQrStatus" style="margin-top:10px; font-size:12.5px; font-weight:700; color:#0F766E; text-align:center;">Đang khởi động camera sau...</div>',
      '    <div style="display:flex; gap:8px; justify-content:center; margin-top:10px; flex-wrap:wrap;">',
      '      <button type="button" class="btn btn-soft btn-sm" id="xpQrBtnTorch" style="display:none;">🔦 Bật đèn Flash</button>',
      '      <button type="button" class="btn btn-soft btn-sm" id="xpQrBtnDone">✓ Hoàn tất quét</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');
    document.body.appendChild(wrap);
    return wrap;
  }

  async function closeScanner() {
    var modal = document.getElementById('xpQrScannerModal');
    if (modal) modal.classList.remove('open');
    _torchOn = false;
    var btnTorch = document.getElementById('xpQrBtnTorch');
    if (btnTorch) {
      btnTorch.style.display = 'none';
      btnTorch.textContent = '🔦 Bật đèn Flash';
    }
    if (_activeScanner) {
      var sc = _activeScanner;
      _activeScanner = null;
      try {
        if (sc.isScanning) await sc.stop();
      } catch (e) {}
      try {
        await sc.clear();
      } catch (e) {}
    }
  }

  async function open(opts) {
    var o = opts || {};
    var modal = ensureModalDom();
    var titleEl = document.getElementById('xpQrTitle');
    var subEl = document.getElementById('xpQrSubtitle');
    var statusEl = document.getElementById('xpQrStatus');
    var btnClose = document.getElementById('xpQrBtnClose');
    var btnDone = document.getElementById('xpQrBtnDone');
    var btnTorch = document.getElementById('xpQrBtnTorch');

    if (titleEl) titleEl.textContent = o.title || '📷 Quét Mã QR Kho Xưởng';
    if (subEl) subEl.textContent = o.subtitle || 'Đưa camera về phía tem QR vật tư hoặc vị trí kệ';
    if (statusEl) {
      statusEl.style.color = '#0F766E';
      statusEl.textContent = 'Đang tải bộ giải mã & mở camera sau...';
    }

    await closeScanner();
    modal.classList.add('open');

    var handleClose = async function () {
      await closeScanner();
      if (typeof o.onClose === 'function') o.onClose();
    };
    if (btnClose) btnClose.onclick = handleClose;
    if (btnDone) btnDone.onclick = handleClose;
    modal.onclick = function (e) { if (e.target === modal) handleClose(); };

    try {
      var Html5Qrcode = await loadHtml5QrCodeLib();
      var scanner = new Html5Qrcode('xpQrReaderBox');
      _activeScanner = scanner;

      var lastText = '';
      var lastScanAt = 0;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 230, height: 230 },
          aspectRatio: 1.0
        },
        function (decodedText) {
          var now = Date.now();
          if (decodedText === lastText && (now - lastScanAt) < 1500) return;
          lastText = decodedText;
          lastScanAt = now;
          playBeep();
          var parsed = parseQrPayload(decodedText);
          if (statusEl) {
            statusEl.style.color = '#15803D';
            statusEl.textContent = '✓ Đã quét: ' + decodedText;
          }
          if (!o.continuous) {
            closeScanner().then(function () {
              if (typeof o.onScan === 'function') o.onScan(parsed, decodedText);
            });
          } else {
            if (typeof o.onScan === 'function') o.onScan(parsed, decodedText);
          }
        },
        function () {}
      );

      if (statusEl) {
        statusEl.style.color = '#0F766E';
        statusEl.textContent = o.continuous
          ? '📷 Sẵn sàng quét liên tục — Đưa tem QR vào khung'
          : '📷 Camera đã sẵn sàng — Đưa tem QR vào khung';
      }

      try {
        var caps = scanner.getRunningTrackCapabilities ? scanner.getRunningTrackCapabilities() : null;
        if (caps && caps.torch && btnTorch) {
          btnTorch.style.display = 'inline-flex';
          btnTorch.onclick = async function () {
            try {
              _torchOn = !_torchOn;
              await scanner.applyVideoConstraints({ advanced: [{ torch: _torchOn }] });
              btnTorch.textContent = _torchOn ? '🔦 Tắt đèn Flash' : '🔦 Bật đèn Flash';
            } catch (tErr) {
              btnTorch.style.display = 'none';
            }
          };
        }
      } catch (e) {}
    } catch (err) {
      if (statusEl) {
        statusEl.style.color = '#B91C1C';
        statusEl.textContent = '❌ Không mở được camera: ' + (err && err.message ? err.message : String(err)) + '. Vui lòng cấp quyền Camera trên trình duyệt (HTTPS).';
      }
    }
  }

  async function openProjectLookupModal(projectId, currentUser, scannedRev) {
    if (!projectId || !global.SupabaseDB) return;
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }
    function fmtRev(r) {
      var n = Math.max(1, Number(r) || 1);
      return 'Rev ' + (n < 10 ? '0' + n : String(n));
    }
    var modal = document.getElementById('xpQrProjLookupModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'xpQrProjLookupModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.58);z-index:3600;display:none;align-items:center;justify-content:center;padding:14px;';
      modal.innerHTML =
        '<div style="background:#fff;border-radius:16px;border:1.5px solid #5EEAD4;width:min(820px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.28);">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#F0FDFA;border-bottom:1px solid #CCFBF1;">' +
        '    <h3 id="xpQrProjTitle" style="margin:0;font-size:16px;color:#0B3B38;">📋 Trạng Thái Vật Tư Đơn Hàng</h3>' +
        '    <button type="button" id="xpQrProjClose" class="btn btn-soft btn-sm">✕ Đóng</button>' +
        '  </div>' +
        '  <div id="xpQrProjBody" style="padding:16px 18px;overflow-y:auto;font-size:13px;">Đang tải dữ liệu...</div>' +
        '  <div id="xpQrProjFoot" style="padding:12px 18px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;"></div>' +
        '</div>';
      document.body.appendChild(modal);
      document.getElementById('xpQrProjClose').onclick = function () { modal.style.display = 'none'; };
    }
    modal.style.display = 'flex';
    var bodyEl = document.getElementById('xpQrProjBody');
    var footEl = document.getElementById('xpQrProjFoot');
    bodyEl.innerHTML = 'Đang tải thông tin đơn hàng & tồn kho...';
    footEl.innerHTML = '';

    try {
      var resAll = await Promise.all([
        global.SupabaseDB.getProjectById(projectId).catch(function () { return null; }),
        global.SupabaseDB.getProjectMaterialRequests(projectId).catch(function () { return []; }),
        global.SupabaseDB.getInventory().catch(function () { return []; }),
        global.SupabaseDB.getProjectAttachments(projectId).catch(function () { return []; })
      ]);
      var proj = resAll[0] || { id: projectId, name: projectId };
      var reqs = resAll[1] || [];
      var invs = resAll[2] || [];
      var atts = resAll[3] || [];
      var invMap = {};
      invs.forEach(function (i) { invMap[String(i.id)] = i; });

      document.getElementById('xpQrProjTitle').textContent = '📋 Đơn hàng: ' + (proj.name || projectId) + ' (' + fmtRev(proj.bomRevision || 1) + ')';
      var currentRev = Math.max(1, Number(proj.bomRevision) || 1);
      var isOldPrint = scannedRev != null && Number(scannedRev) < currentRev;
      var revAlertHtml = '';
      if (isOldPrint) {
        try {
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([200, 100, 200]);
          }
        } catch (_) {}
        var wfHist = Array.isArray(proj.workflowHistory) ? proj.workflowHistory : [];
        var revEntry = wfHist.slice().reverse().find(function (h) {
          return h && (h.type === 'revision_bumped' || h.direction === 'revision');
        });
        var reasonTxt = (revEntry && revEntry.note) ? (' (' + esc(revEntry.note) + ')') : '';
        revAlertHtml =
          '<div id="xpQrOldRevAlert" style="margin-bottom:12px;padding:12px 14px;border-radius:12px;background:#FEF2F2;border:2px solid #DC2626;color:#991B1B;">' +
          '  <div style="font-size:15px;font-weight:900;color:#B91C1C;margin-bottom:4px;">⚠️ CẢNH BÁO BẢN IN CŨ (' + fmtRev(scannedRev) + ')!</div>' +
          '  <div style="font-size:13px;line-height:1.45;">Đơn hàng này đã được cập nhật lên <b>' + fmtRev(currentRev) + '</b>' + reasonTxt + '. Vui lòng <b>dừng cắt phôi</b> và liên hệ Phòng Kinh doanh / Kỹ thuật lấy bản vẽ &amp; phiếu <b>ĐNMVT01</b> mới nhất!</div>' +
          '</div>';
      }

      var readyItems = [];
      var rowsHtml = reqs.length ? reqs.map(function (r) {
        var inv = r.inventoryId ? invMap[String(r.inventoryId)] : null;
        var alloc = Number(r.allocatedQty || 0);
        var issued = Number(r.issuedQty || 0);
        var reqQ = Number(r.requiredQty || 0);
        var rack = inv ? (inv.rackLocation || 'Kho') : '—';
        var ngPill = r.requestType === 'rework_ng'
          ? ' <span style="background:#FEE2E2;color:#B91C1C;padding:1px 6px;border-radius:999px;font-size:10.5px;font-weight:800;">⚠️ Bù hỏng (NG)</span>'
          : '';
        var stHtml = '';
        if (issued >= reqQ && reqQ > 0) {
          stHtml = '<span style="background:#F1F5F9;color:#475569;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11.5px;">⚪ Đã xuất SX</span>';
        } else if (alloc > 0) {
          stHtml = '<span style="background:#DCFCE7;color:#15803D;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11.5px;">🟢 Sẵn sàng lĩnh (' + alloc + ') · Kệ: ' + esc(rack) + '</span>';
          readyItems.push({
            request_id: r.id,
            inventory_id: r.inventoryId,
            item_name: r.itemName,
            qty: alloc,
            unit: r.unit,
            rack_location: rack
          });
        } else if (r.expectedDate) {
          var pp = String(r.expectedDate).split('-');
          stHtml = '<span style="background:#FEF3C7;color:#B45309;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11.5px;">🟡 Đang về ' + (pp.length === 3 ? pp[2] + '/' + pp[1] : esc(r.expectedDate)) + '</span>';
        } else {
          stHtml = '<span style="background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:999px;font-weight:700;font-size:11.5px;">🔴 Thiếu kho – Chờ mua</span>';
        }
        return '<tr><td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;"><b>' + esc(r.itemName) + '</b>' + ngPill + '</td>' +
          '<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;text-align:right;">' + reqQ + ' ' + esc(r.unit) + '</td>' +
          '<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;text-align:right;">' + issued + '</td>' +
          '<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;">' + stHtml + '</td></tr>';
      }).join('') : '<tr><td colspan="4" style="padding:14px;text-align:center;color:#64748B;">Chưa có dòng vật tư nào.</td></tr>';

      var attHtml = atts.length ? '<div style="margin-top:12px;"><b>📐 Hồ sơ / Bản vẽ đính kèm:</b><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' +
        atts.map(function (a) {
          var revTag = a.revLabel ? (' [' + esc(a.revLabel) + ']') : '';
          var supTag = a.isSuperseded ? ' (Đã thay thế)' : '';
          return '<button type="button" class="btn btn-soft btn-sm xp-qr-att-dl" data-path="' + esc(a.storagePath) + '"' + (a.isSuperseded ? ' style="opacity:0.6;text-decoration:line-through;"' : '') + '>⬇️ ' + esc(a.fileName) + revTag + supTag + '</button>';
        }).join('') + '</div></div>' : '';

      bodyEl.innerHTML =
        revAlertHtml +
        '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px;padding:10px;background:#F8FAFC;border-radius:10px;align-items:center;">' +
        '  <span><b>Phiên bản:</b> <span style="background:#E0F2FE;color:#0369A1;padding:2px 8px;border-radius:999px;font-weight:800;">' + fmtRev(currentRev) + '</span></span>' +
        (proj.priority === 'urgent' ? '  <span style="background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:999px;font-weight:800;">🔥 GẤP</span>' : '') +
        '  <span><b>PO Khách hàng:</b> ' + esc(proj.customerPoNo || '—') + '</span>' +
        '  <span><b>Khách hàng:</b> ' + esc(proj.customer || '—') + '</span>' +
        '</div>' +
        '<div style="overflow-x:auto;border:1px solid #E2E8F0;border-radius:10px;">' +
        '  <table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
        '    <thead><tr style="background:#F1F5F9;"><th style="padding:8px;text-align:left;">Vật tư / Quy cách</th><th style="padding:8px;text-align:right;">Yêu cầu</th><th style="padding:8px;text-align:right;">Đã xuất</th><th style="padding:8px;text-align:left;">Trạng thái &amp; Vị trí kệ</th></tr></thead>' +
        '    <tbody>' + rowsHtml + '</tbody>' +
        '  </table>' +
        '</div>' + attHtml;

      bodyEl.querySelectorAll('.xp-qr-att-dl').forEach(function (b) {
        b.onclick = async function () {
          var url = await global.SupabaseDB.getProjectAttachmentSignedUrl(b.getAttribute('data-path'), 3600);
          if (url) window.open(url, '_blank', 'noopener');
        };
      });

      var isWh = currentUser && (currentUser.role === 'warehouse' || currentUser.role === 'admin');
      var fHtml = '<a href="/projects?id=' + encodeURIComponent(projectId) + '" class="btn btn-soft btn-sm">📁 Mở chi tiết dự án</a>';
      if (isWh && readyItems.length > 0) {
        fHtml = '<button type="button" id="xpQrBtnCreatePxk" class="btn btn-cta btn-sm">⚡ Tạo Phiếu Xuất Kho (PXK) giao Sản xuất</button> ' + fHtml;
      }
      footEl.innerHTML = fHtml;
      var btnPxk = document.getElementById('xpQrBtnCreatePxk');
      if (btnPxk) {
        btnPxk.onclick = function () {
          try {
            sessionStorage.setItem('xp_crossdock_pxk', JSON.stringify({
              projectId: projectId,
              projectName: proj.name || projectId,
              items: readyItems
            }));
          } catch (_) {}
          window.location.href = '/vouchers?new=OUT&from=crossdock';
        };
      }
    } catch (err) {
      bodyEl.innerHTML = '<div style="color:#B91C1C;">❌ Không tải được thông tin đơn hàng: ' + esc(err.message || err) + '</div>';
    }
  }

  async function openFinishedGoodsLookupModal(fgId) {
    if (!fgId || !global.SupabaseDB) return;
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }
    var items = await global.SupabaseDB.getFinishedGoodsItems().catch(function () { return []; });
    var fg = (items || []).find(function (x) { return String(x.id) === String(fgId); });
    var modal = document.getElementById('xpQrProjLookupModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'xpQrProjLookupModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.58);z-index:3600;display:none;align-items:center;justify-content:center;padding:14px;';
      modal.innerHTML =
        '<div style="background:#fff;border-radius:16px;border:1.5px solid #5EEAD4;width:min(620px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,0.28);">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#F0FDFA;border-bottom:1px solid #CCFBF1;">' +
        '    <h3 id="xpQrProjTitle" style="margin:0;font-size:16px;color:#0B3B38;">🏭 Thông Tin Kiện Thành Phẩm</h3>' +
        '    <button type="button" id="xpQrProjClose" class="btn btn-soft btn-sm">✕ Đóng</button>' +
        '  </div>' +
        '  <div id="xpQrProjBody" style="padding:16px 18px;overflow-y:auto;font-size:13.5px;"></div>' +
        '  <div id="xpQrProjFoot" style="padding:12px 18px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;gap:8px;justify-content:flex-end;"></div>' +
        '</div>';
      document.body.appendChild(modal);
      document.getElementById('xpQrProjClose').onclick = function () { modal.style.display = 'none'; };
    }
    document.getElementById('xpQrProjTitle').textContent = fg ? ('🏭 Thành phẩm: ' + fg.name) : '⚠️ Không tìm thấy Thành phẩm';
    document.getElementById('xpQrProjBody').innerHTML = fg ? (
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;">' +
      '  <div><div style="font-size:11.5px;color:#475569;">Mã TP</div><b>' + esc(fg.fgCode || '—') + '</b></div>' +
      '  <div><div style="font-size:11.5px;color:#475569;">Dự án</div><b>' + esc(fg.projectName || fg.projectId || '—') + '</b></div>' +
      '  <div><div style="font-size:11.5px;color:#475569;">Tồn sẵn sàng giao</div><b style="color:#0F766E;font-size:18px;">' + fg.stockQty + ' ' + esc(fg.unit) + '</b></div>' +
      '  <div><div style="font-size:11.5px;color:#475569;">Vị trí bãi / kệ</div><b>' + esc(fg.rackLocation || 'Chưa gán') + '</b></div>' +
      '  <div><div style="font-size:11.5px;color:#475569;">Kế hoạch / Đã giao</div><b>' + fg.plannedQty + ' / ' + fg.deliveredQty + ' ' + esc(fg.unit) + '</b></div>' +
      '</div>'
    ) : '<p style="color:#B91C1C;">Không tìm thấy kiện thành phẩm ID <code>' + esc(fgId) + '</code>.</p>';
    document.getElementById('xpQrProjFoot').innerHTML = '<a href="/delivery" class="btn btn-p btn-sm">🚚 Mở Kho Thành Phẩm &amp; Giao Hàng</a>';
    modal.style.display = 'flex';
  }

  global.WorkshopQrScanner = {
    parseQrPayload: parseQrPayload,
    open: open,
    close: closeScanner,
    playBeep: playBeep,
    openProjectLookupModal: openProjectLookupModal,
    openFinishedGoodsLookupModal: openFinishedGoodsLookupModal
  };
})(typeof window !== 'undefined' ? window : globalThis);
