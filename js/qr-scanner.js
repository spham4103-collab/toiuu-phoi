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

  global.WorkshopQrScanner = {
    parseQrPayload: parseQrPayload,
    open: open,
    close: closeScanner,
    playBeep: playBeep
  };
})(typeof window !== 'undefined' ? window : globalThis);
