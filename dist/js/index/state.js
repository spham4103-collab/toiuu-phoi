/**
 * Module: state.js - Central State & Core Utilities
 * Hệ thống Quản lý Tối ưu Xếp phôi Thép hộp & Cắt ống · An Bình
 */

    // Palette
    const COLORS = [
      '#0F766E', '#C2410C', '#3A5BA0', '#A21CAF',
      '#4D7C0F', '#B4232C', '#0369A1', '#7C3AED',
      '#A16207', '#BE185D', '#15803D', '#475569'
    ];
    const getColor = i => COLORS[i % COLORS.length];

    // Storage Key cục bộ chỉ nhớ ID dự án đang chọn trên thiết bị này
    const LS_CURRENT_PROJ_ID = 'toiuu_current_proj_id_v1';

    // Default Saved Profiles Library (fallback khi chưa cấu hình Supabase)
    const DEFAULT_SAVED_PROFILES = [
      'Hộp 20x20x1.4', 'Hộp 25x25x1.4', 'Hộp 30x30x1.8', 'Hộp 40x40x1.8', 'Hộp 50x50x2.0',
      'Hộp 20x40x1.4', 'Hộp 25x50x1.8', 'Hộp 30x60x1.8', 'Hộp 40x80x2.0', 'Ống Ø27x1.4', 'Ống Ø34x1.4'
    ];

    // State
    const state = {
      savedProfiles: [],
      activeProfiles: ['Hộp 30x30x1.8'],
      selectedTabProfile: 'Hộp 30x30x1.8',
      resultFilterProfile: 'ALL',
      parts: [],
      stock: [],
      method: 'cnc',
      kerf: 0,
      clamp: 80,
      interlock: true,
      gap: 0,
      result: null,
      // Quản lý nhiều dự án
      currentProjectId: null,
      currentProjectName: '',
      currentProjectCustomer: '',
      currentProjectNotes: '',
      savedProjects: [],
      trashProjects: [],
      activeProjectsTab: 'active',
      editingProjectId: null,
      fusionProject: null,
      // Trạng thái Supabase Auth & Realtime
      cloudConnected: false,
      cloudSyncStatus: 'connecting',
      realtimeUnsub: null,
      authUnsub: null,
      hasBootstrappedWorkspace: false,
      activeSaveTimer: null,
      hasPendingActiveSave: false,
      initialSupabaseLoadFailed: false,
      inFlightCutKeys: new Set(),
      lastLocalProjectWriteAt: 0,
      isApplyingRemoteChange: false,
      userRole: "operator",
      cutStatuses: {},
      inventoryItems: [],
      stockOffcuts: [],
      useWarehouseOffcuts: false,
      offcutsDeducted: false,
      offcutsDeductedAt: null,
      inventoryDeductedAt: null,
      inventoryDeductedBy: '',
      inventoryDeductedSnapshot: null,
      users: [],
      currentUser: null
    };

    let HINH_CACHE = [];

    // Helpers
    const $ = id => document.getElementById(id);
    const makeId = prefix => (window.SupabaseDB && typeof window.SupabaseDB.uid === 'function')
      ? window.SupabaseDB.uid(prefix)
      : `${prefix || 'id'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const numVN = (n, dec) => {
      if (n == null || isNaN(n)) return '0';
      const num = Number(n);
      if (dec !== undefined && dec !== null) {
        return num.toLocaleString('vi-VN', { maximumFractionDigits: dec, minimumFractionDigits: dec });
      }
      if (Number.isInteger(num)) {
        return num.toLocaleString('vi-VN', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
      } else {
        return num.toLocaleString('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
      }
    };
    const parseVN = v => {
      if (v == null) return 0;
      let s = String(v).trim().replace(/\s/g, '');
      if (!s) return 0;
      if (s.includes('.') && s.includes(',')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
          s = s.replace(/\./g, '').replace(',', '.');
        } else {
          s = s.replace(/,/g, '');
        }
      } else if (s.includes(',')) {
        s = s.replace(',', '.');
      } else if (s.includes('.')) {
        const parts = s.split('.');
        if (parts.length === 2) {
          if (parts[1].length === 3 && (parts[1] === '000' || parts[1] === '100' || parts[1] === '500' || parts[1] === '200')) {
            s = parts[0] + parts[1];
          } else if (parts[1].length !== 3) {
            // Keep decimal dot like 728.5 or 1040.5
          } else {
            s = parts[0] + parts[1];
          }
        } else {
          s = s.replace(/\./g, '');
        }
      }
      return parseFloat(s) || 0;
    };

    // Smart Specification & Profile Detector
    // Detects box profile (e.g. "Hộp 25x25x1" -> "Hộp 25x25"), length ("L728.5" -> 728.5), qty ("x 4" -> 4), miter ("ke 1")
    function detectSpecsFromText(text) {
      if (!text || typeof text !== 'string') return null;
      const str = text.trim();
      if (!str) return null;

      const allAvailable = Array.from(new Set([...(state.activeProfiles || []), ...(state.savedProfiles || [])])).filter(Boolean);

      let detectedProfile = null;
      let detectedLength = null;
      let detectedQty = null;
      let detectedStyle = null;
      let detectedMat = null;

      let remainder = str;

      // 1. Detect Box Profile: WxH (xT)?
      // Matches "Hộp 25x25x1", "25x25x1", "Hộp 25x25", "20x40", "50*50", "25×25"
      const mBox = str.match(/(?:Hộp|Hop|hop|hộp)?\s*(\d{2,3})\s*(?:x|X|\*|×)\s*(\d{2,3})(?:\s*(?:x|X|\*|×)\s*(\d+(?:[.,]\d+)?))?/i);
      if (mBox) {
        remainder = remainder.replace(mBox[0], ' ');
        const w = parseInt(mBox[1]);
        const h = parseInt(mBox[2]);
        const t = mBox[3] ? parseFloat(mBox[3].replace(',', '.')) : null;

        // If thickness is explicitly specified (e.g. "Hộp 25x25x1", "20x40x1.4"), MUST preserve thickness!
        if (t !== null) {
          detectedProfile = allAvailable.find(p => {
            const pm = p.match(/(\d+)\s*(?:x|X|\*|×)\s*(\d+)(?:\s*(?:x|X|\*|×)\s*(\d+(?:[.,]\d+)?))?/i);
            return pm && parseInt(pm[1]) === w && parseInt(pm[2]) === h && pm[3] && parseFloat(pm[3].replace(',', '.')) === t;
          });
          if (!detectedProfile) {
            const rawT = mBox[3].replace(',', '.');
            detectedProfile = `Hộp ${w}x${h}x${rawT}`;
          }
        } else {
          // Thickness was not specified: match nominal profile or any with same WxH
          detectedProfile = allAvailable.find(p => {
            const pm = p.match(/(\d+)\s*(?:x|X|\*|×)\s*(\d+)(?:\s*(?:x|X|\*|×)\s*(\d+(?:[.,]\d+)?))?/i);
            return pm && parseInt(pm[1]) === w && parseInt(pm[2]) === h && !pm[3];
          });
          if (!detectedProfile) {
            detectedProfile = allAvailable.find(p => {
              const pm = p.match(/(\d+)\s*(?:x|X|\*|×)\s*(\d+)/i);
              return pm && parseInt(pm[1]) === w && parseInt(pm[2]) === h;
            });
          }
          if (!detectedProfile) {
            detectedProfile = `Hộp ${w}x${h}`;
          }
        }
        detectedMat = Math.max(w, h);
      }

      // 2. Detect Round Pipe: (Ống|Phi|Ø)? D(xT)?
      if (!detectedProfile) {
        const mRound = str.match(/(?:Ống|Ong|ong|ống|Phi|phi|Ø|D|d)\s*(\d{2,3})(?:\s*(?:x|X|\*|×)\s*(\d+(?:[.,]\d+)?))?/i);
        if (mRound) {
          remainder = remainder.replace(mRound[0], ' ');
          const d = parseInt(mRound[1]);
          const t = mRound[2] ? parseFloat(mRound[2].replace(',', '.')) : null;
          if (t !== null) {
            detectedProfile = allAvailable.find(p => {
              const pm = p.match(/(?:Ống|Phi|Ø|D)\s*(\d+)(?:\s*(?:x|X|\*|×)\s*(\d+(?:[.,]\d+)?))?/i);
              return pm && parseInt(pm[1]) === d && pm[2] && parseFloat(pm[2].replace(',', '.')) === t;
            });
            if (!detectedProfile) {
              const rawT = mRound[2].replace(',', '.');
              detectedProfile = `Ống Ø${d}x${rawT}`;
            }
          } else {
            detectedProfile = allAvailable.find(p => {
              const pm = p.match(/(?:Ống|Phi|Ø|D)\s*(\d+)/i);
              return pm && parseInt(pm[1]) === d;
            });
            if (!detectedProfile) {
              detectedProfile = `Ống Ø${d}`;
            }
          }
          detectedMat = d;
        }
      }

      // 3. Detect Length: L728.5 or dài 728.5 or L=728.5 or L 728,5
      const mLen = remainder.match(/(?:L|l|dài|Dài|dai|Dai)\s*[:=-]?\s*(\d+(?:[.,]\d+)?)/i);
      if (mLen) {
        detectedLength = parseFloat(mLen[1].replace(',', '.'));
        remainder = remainder.replace(mLen[0], ' ');
      }

      // 4. Detect Quantity from remainder: x 4, * 4, SL 4, SL: 3, SL3, 4 cây
      const mQty = remainder.match(/(?:x|X|\*|SL|sl|Số lượng|so luong)\s*[:=-]?\s*(\d+)/i) || remainder.match(/(\d+)\s*(?:cây|cay|chi tiết|chi tiet|ct)\b/i);
      if (mQty) {
        detectedQty = parseInt(mQty[1]);
        remainder = remainder.replace(mQty[0], ' ');
      }

      // 5. Detect Cut Style from remainder
      if (/ke\s*1|ke1|1\s*dau|1\s*đầu|vat\s*1|vát\s*1/i.test(remainder)) {
        detectedStyle = 'ke1';
      } else if (/ke\s*2|ke2|ke\b|2\s*dau|2\s*đầu|vat\s*2|vát\s*2/i.test(remainder)) {
        detectedStyle = 'ke';
      } else if (/thang|thẳng/i.test(remainder)) {
        detectedStyle = 'thang';
      }

      return { detectedProfile, detectedLength, detectedQty, detectedStyle, detectedMat };
    }
    const showToast = msg => {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2800);
    };

    // Extract default miter width from profile name (e.g. "Hộp 50x50" -> 50, "Hộp 20x40" -> 40)
    function extractMatFromProfile(pName) {
      if (!pName) return 30;
      const m = pName.match(/(?:Hộp|Ống|V|U)?\s*(\d+)(?:x|X)(\d+)/);
      if (m) {
        return Math.max(parseInt(m[1]), parseInt(m[2]));
      }
      const mRound = pName.match(/(?:Ø|D|Phi)\s*(\d+)/i);
      if (mRound) return parseInt(mRound[1]);
      return 30;
    }


    function formatShortCutTime(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
      const dd = String(d.getDate()).padStart(2, '0');
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mo} ${hh}:${mm}`;
    }

    // Chuyển đổi chuỗi tiếng Việt có dấu thành thuần ASCII chuẩn IGES
    function toAscii(str) {
      if (!str) return '';
      return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^\x20-\x7E]/g, '_');
    }


    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
    }



// Expose state and utilities globally
if (typeof window !== "undefined") {
  window.state = state;
  window.COLORS = COLORS;
  window.getColor = getColor;
  window.LS_CURRENT_PROJ_ID = LS_CURRENT_PROJ_ID;
  window.DEFAULT_SAVED_PROFILES = DEFAULT_SAVED_PROFILES;
  window.HINH_CACHE = HINH_CACHE;
  window.$ = $;
  window.makeId = makeId;
  window.numVN = numVN;
  window.parseVN = parseVN;
  window.detectSpecsFromText = detectSpecsFromText;
  window.showToast = showToast;
  window.extractMatFromProfile = extractMatFromProfile;
  window.formatShortCutTime = formatShortCutTime;
  window.toAscii = toAscii;
  window.escapeHtml = escapeHtml;
}
