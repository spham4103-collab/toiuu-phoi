/**
 * Module: nesting-ui.js - Nesting UI Renderer & SVG Visualization
 * Hiển thị thanh tiến độ, sơ đồ cắt trực quan SVG, bảng BOM vật tư & bộ lọc
 */


    function ensureStockForProfile(prof) {
      const exist = state.stock.find(s => s.profile === prof);
      if (!exist) {
        state.stock.push({
          id: makeId('s_auto'),
          profile: prof,
          name: `Cây mới 6.000 (${prof})`,
          length: 6000,
          qty: null,
          clamp: state.clamp
        });
      }
    }

    // Presets
    function loadMultiProfilePreset(opts = {}) {
      state.activeProfiles = ['Hộp 50x50x2.0', 'Hộp 30x30x1.8', 'Hộp 20x40x1.4'];
      state.selectedTabProfile = 'Hộp 50x50x2.0';

      state.parts = [
        // Hộp 50x50x2.0
        { id: 'p1', name: 'Chân cột chính', profile: 'Hộp 50x50x2.0', length: 1500, qty: 4, style: 'thang', mat: 0 },
        { id: 'p2', name: 'Khung giằng trên', profile: 'Hộp 50x50x2.0', length: 1000, qty: 4, style: 'ke', mat: 50 },

        // Hộp 30x30x1.8 (Bộ 18 chi tiết thực tế của bạn)
        { id: 'p3', name: 'Hộp 30x30 L835', profile: 'Hộp 30x30x1.8', length: 835, qty: 4, style: 'ke1', mat: 30 },
        { id: 'p4', name: 'Hộp 30x30 L1100', profile: 'Hộp 30x30x1.8', length: 1100, qty: 2, style: 'ke', mat: 30 },
        { id: 'p5', name: 'Hộp 30x30 L640', profile: 'Hộp 30x30x1.8', length: 640, qty: 8, style: 'thang', mat: 0 },
        { id: 'p6', name: 'Hộp 30x30 L1040', profile: 'Hộp 30x30x1.8', length: 1040, qty: 3, style: 'thang', mat: 0 },
        { id: 'p7', name: 'Hộp 30x30 L453', profile: 'Hộp 30x30x1.8', length: 453, qty: 1, style: 'thang', mat: 0 },

        // Hộp 20x40x1.4
        { id: 'p8', name: 'Thanh đỡ sàn', profile: 'Hộp 20x40x1.4', length: 950, qty: 6, style: 'thang', mat: 0 },
        { id: 'p9', name: 'Nan bảo vệ', profile: 'Hộp 20x40x1.4', length: 420, qty: 8, style: 'thang', mat: 0 }
      ];

      state.stock = [
        { id: 's1', name: 'Cây tồn 2.400', profile: 'Hộp 50x50x2.0', length: 2400, qty: 1, clamp: 80 },
        { id: 's2', name: 'Cây mới 6.000 (Hộp 50x50x2.0)', profile: 'Hộp 50x50x2.0', length: 6000, qty: null, clamp: 80 },

        { id: 's3', name: 'Cây tồn 6.000', profile: 'Hộp 30x30x1.8', length: 6000, qty: 3, clamp: 80 },
        { id: 's4', name: 'Cây mới 6.000 (Hộp 30x30x1.8)', profile: 'Hộp 30x30x1.8', length: 6000, qty: null, clamp: 80 },

        { id: 's5', name: 'Cây tồn 1.800', profile: 'Hộp 20x40x1.4', length: 1800, qty: 1, clamp: 80 },
        { id: 's6', name: 'Cây mới 6.000 (Hộp 20x40x1.4)', profile: 'Hộp 20x40x1.4', length: 6000, qty: null, clamp: 80 }
      ];

      state.method = 'cnc';
      state.kerf = 0;
      state.clamp = 80;
      state.interlock = true;
      state.gap = 0;
      state.useWarehouseOffcuts = false;
      state.offcutsDeducted = false;
      state.offcutsDeductedAt = null;
      state.inventoryDeductedAt = null;
      state.inventoryDeductedBy = '';
      state.inventoryDeductedSnapshot = null;

      updateInputsFromState();
      renderProfileTabs();
      renderPartsList();
      renderStockList();
      calculateOptimization(false, Boolean(opts && opts.skipSave));
      if (!opts || !opts.skipSave) {
        saveActiveProject();
        showToast('Đã nạp mẫu bản vẽ đa loại hộp (50x50, 30x30, 20x40)!');
      }
    }

    function loadUserCase() {
      state.activeProfiles = ['Hộp 30x30x1.8'];
      state.selectedTabProfile = 'Hộp 30x30x1.8';

      state.parts = [
        { id: 'p1', name: 'Hộp 30x30x1.8 L835', profile: 'Hộp 30x30x1.8', length: 835, qty: 4, style: 'ke1', mat: 30 },
        { id: 'p2', name: 'Hộp 30x30x1.8 L1100', profile: 'Hộp 30x30x1.8', length: 1100, qty: 2, style: 'ke', mat: 30 },
        { id: 'p3', name: 'Hộp 30x30x1.8 L640', profile: 'Hộp 30x30x1.8', length: 640, qty: 8, style: 'thang', mat: 0 },
        { id: 'p4', name: 'Hộp 30x30x1.8 L1040', profile: 'Hộp 30x30x1.8', length: 1040, qty: 3, style: 'thang', mat: 0 },
        { id: 'p5', name: 'Hộp 30x30x1.8 L453', profile: 'Hộp 30x30x1.8', length: 453, qty: 1, style: 'thang', mat: 0 }
      ];
      state.stock = [
        { id: 's1', name: 'Cây tồn 6.000', profile: 'Hộp 30x30x1.8', length: 6000, qty: 5, clamp: 80 }
      ];
      state.method = 'cnc';
      state.kerf = 0;
      state.clamp = 80;
      state.interlock = true;
      state.gap = 0;
      state.useWarehouseOffcuts = false;
      state.offcutsDeducted = false;
      state.offcutsDeductedAt = null;
      state.inventoryDeductedAt = null;
      state.inventoryDeductedBy = '';
      state.inventoryDeductedSnapshot = null;

      updateInputsFromState();
      renderProfileTabs();
      renderPartsList();
      renderStockList();
      calculateOptimization(false);
      saveActiveProject();
      showToast('Đã nạp đúng 100% dữ liệu từ ảnh mẫu bạn đã gửi!');
    }

    function updateInputsFromState() {
      $('inpKerf').value = state.kerf;
      $('inpClamp').value = state.clamp;
      $('chkInterlock').checked = state.interlock;
      $('inpGap').value = state.gap;
      $('boxGap').style.display = state.interlock ? 'block' : 'none';

      if (state.method === 'cnc') {
        $('btnMethodLaser').classList.add('active');
        $('btnMethodSaw').classList.remove('active');
      } else {
        $('btnMethodSaw').classList.add('active');
        $('btnMethodLaser').classList.remove('active');
      }
    }

    function ensureProfilesConsistency() {
      const set = new Set(state.activeProfiles);
      state.parts.forEach(p => { if (p.profile) set.add(p.profile); });
      state.activeProfiles = Array.from(set).filter(Boolean);
      if (!state.activeProfiles.length) state.activeProfiles = ['Hộp 30x30x1.8'];
      if (!state.activeProfiles.includes(state.selectedTabProfile) && state.selectedTabProfile !== 'ALL') {
        state.selectedTabProfile = state.activeProfiles[0];
      }
    }

    // Render Profile Filter Tabs (Shows Bars Needed badge on each tab!)
    function renderProfileTabs() {
      ensureProfilesConsistency();
      const container = $('profileTabsBar');
      container.innerHTML = '';

      // Tab 'Tất cả'
      const totalParts = state.parts.length;
      const allTab = document.createElement('button');
      allTab.type = 'button';
      allTab.className = `profile-tab ${state.selectedTabProfile === 'ALL' ? 'active' : ''}`;
      allTab.innerHTML = `<span>Tất cả quy cách</span> <span class="profile-tab-badge">${totalParts} mục</span>`;
      allTab.onclick = () => {
        state.selectedTabProfile = 'ALL';
        renderProfileTabs();
        renderActiveProfileBanner();
        renderPartsList();
        renderStockList();
      };
      container.appendChild(allTab);

      // Tabs for each box type
      state.activeProfiles.forEach(prof => {
        const partsOfProf = state.parts.filter(p => p.profile === prof);
        const count = partsOfProf.length;
        const totalPcs = partsOfProf.reduce((a, b) => a + (+b.qty || 0), 0);

        // Calculate bars needed for this profile from current result
        let barsNeededText = '';
        if (totalPcs > 0 && state.result && state.result.summaryByProfile) {
          const sp = state.result.summaryByProfile.find(s => s.profile === prof);
          if (sp && sp.totalBars > 0) {
            barsNeededText = `<span class="profile-tab-bars-needed">Cần ${sp.totalBars} cây</span>`;
          }
        }

        const tab = document.createElement('button');
        tab.type = 'button';
        tab.dataset.prof = prof;
        tab.className = `profile-tab ${state.selectedTabProfile === prof ? 'active' : ''}`;
        tab.innerHTML = `
          <span>${escapeHtml(prof)}</span>
          <span class="profile-tab-badge">${count} mục (${totalPcs} ct)</span>
          ${barsNeededText}
        `;
        tab.onclick = () => {
          state.selectedTabProfile = prof;
          renderProfileTabs();
          renderActiveProfileBanner();
          renderPartsList();
          renderStockList();
        };
        container.appendChild(tab);
      });
    }

    // Render Active Profile Banner & Mini KPI
    function renderActiveProfileBanner() {
      const container = $('activeProfileBannerWrap');
      const cur = state.selectedTabProfile;

      if (cur === 'ALL') {
        const totalPcs = state.parts.reduce((a, b) => a + (+b.qty || 0), 0);
        let totalBars = (totalPcs > 0 && state.result && state.result.bars) ? state.result.bars.length : 0;
        container.innerHTML = `
          <div class="active-profile-header-banner" style="background:#F8FAFC;border-color:#CBD5E1;">
            <div class="active-profile-title" style="color:var(--dark);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              Toàn bộ bản vẽ (${state.activeProfiles.length} loại hộp)
            </div>
            <div class="active-profile-kpis" style="color:var(--mut);">
              <span>Tổng ${state.parts.length} mục · ${totalPcs} chi tiết</span>
              <span class="active-kpi-highlight" style="background:var(--dark);">Tổng cần: ${totalBars} cây</span>
            </div>
          </div>
        `;
        $('stockCardTitle').textContent = 'Cây vật tư (Toàn bộ bản vẽ)';
        $('stockCardSub').textContent = 'Hiển thị cây phôi của tất cả các loại hộp trong bản vẽ.';
        return;
      }

      // Specific box profile selected
      const partsOfProf = state.parts.filter(p => p.profile === cur);
      const totalPcs = partsOfProf.reduce((a, b) => a + (+b.qty || 0), 0);
      const miterPcs = partsOfProf.filter(p => p.style === 'ke' || p.style === 'ke1').reduce((a, b) => a + (+b.qty || 0), 0);

      let barKpiHTML = '<span style="color:#64748B;">Chưa có chi tiết</span>';
      if (totalPcs > 0 && state.result && state.result.summaryByProfile) {
        const sp = state.result.summaryByProfile.find(s => s.profile === cur);
        if (sp && sp.totalBars > 0) {
          const wasteM = (sp.usageStats.totalWasteLength / 1000).toFixed(2);
          const savingM = (sp.usageStats.totalInterlockSaving / 1000).toFixed(2);
          barKpiHTML = `
            <span class="active-kpi-highlight">Cần ${sp.totalBars} cây</span>
            <span>(Mua mới: ${sp.newBars}, Tồn: ${sp.totalBars - sp.newBars})</span>
            <span>· Dư ${wasteM} m</span>
            ${sp.usageStats.totalInterlockSaving > 0 ? `<span style="color:#0F766E;">· Bớt ${savingM} m ke</span>` : ''}
          `;
        }
      }

      container.innerHTML = `
        <div class="active-profile-header-banner">
          <div class="active-profile-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            Đang xếp phôi cho: <span style="text-decoration:underline;">${escapeHtml(cur)}</span>
          </div>
          <div class="active-profile-kpis">
            <span>${partsOfProf.length} mục (${totalPcs} chi tiết)</span>
            ${miterPcs > 0 ? `<span style="background:#E0F2FE; color:#0369A1; font-weight:700; padding:2px 8px; border-radius:12px; font-size:11px;">⚡ ${miterPcs} thanh ghép mòi 45°</span>` : ''}
            ${barKpiHTML}
          </div>
        </div>
      `;

      $('stockCardTitle').textContent = `Cây vật tư cho: ${cur}`;
      $('stockCardSub').textContent = `Cây phôi tồn kho và cây mua mới 6m dùng riêng cho ${cur}.`;
    }

    function checkProjectLockedForEdit() {
      if (state.userRole === 'operator') {
        alert('🔒 CHẾ ĐỘ THỢ CNC (KHÓA AN TOÀN):\n\nBạn đang ở chế độ xem sơ đồ cắt của Thợ vận hành máy.\nToàn bộ tính năng xóa, sửa và nhập liệu đã được khóa an toàn để tránh nhầm lẫn.\n\nNếu bạn là Kỹ sư thiết kế, vui lòng bấm vào nút [👷 Thợ CNC 🔒] trên thanh đầu trang và nhập mã PIN để mở khóa.');
        return true;
      }
      if (!state.currentProjectId) return false;
      const p = (state.savedProjects || []).find(x => x.id === state.currentProjectId);
      if (p && p.isLocked) {
        alert(`⚠️ DỰ ÁN "${p.name}" ĐANG ĐƯỢC KHÓA BẢO VỆ!\n\nKhông thể thay đổi hoặc xóa chi tiết khi dự án đang khóa sản xuất.\nVui lòng bấm nút "Mở khóa" trên thanh dự án nếu bạn muốn chỉnh sửa.`);
        return true;
      }
      return false;
    }

    // Render Parts List
    function renderPartsList() {
      const container = $('partsList');
      container.innerHTML = '';

      const filteredParts = state.selectedTabProfile === 'ALL'
        ? state.parts
        : state.parts.filter(p => p.profile === state.selectedTabProfile);

      let totalPieces = 0;
      state.parts.forEach(p => totalPieces += (+p.qty || 0));

      if (!filteredParts.length) {
        container.innerHTML = `
          <div style="padding:24px 16px;text-align:center;color:var(--mut);font-size:14px;background:#F8FAFC;border-radius:8px;margin-top:8px;">
            Chưa có chi tiết nào cho <b>${escapeHtml(state.selectedTabProfile)}</b>.<br>
            Bấm <b>"+ Thêm chi tiết"</b> ở dưới để bắt đầu nhập.
          </div>
        `;
        $('lblPartCount').textContent = `${state.activeProfiles.length} loại hộp · ${state.parts.length} mục · ${totalPieces} chi tiết`;
        return;
      }

      function getProfileOptionsHtml(currentProfile) {
        const allProfs = Array.from(new Set([...state.activeProfiles, currentProfile])).filter(Boolean);
        return allProfs.map(p => `<option value="${escapeHtml(p)}" ${p === currentProfile ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
      }

      filteredParts.forEach(part => {
        const originalIndex = state.parts.findIndex(x => x.id === part.id);
        const color = getColor(originalIndex);
        const row = document.createElement('div');
        row.className = 'parts-row';
        row.dataset.id = part.id;

        row.innerHTML = `
          <div class="color-dot" style="--c: ${color};" title="Màu chi tiết ${originalIndex + 1}"></div>
          <div>
            <input type="text" value="${escapeHtml(part.name || '')}" placeholder="Tên (vd: Hộp 25x25x1 L728.5)" data-f="name">
            <div style="display:flex; align-items:center; gap:5px; margin-top:3px; flex-wrap:wrap;">
              <span style="font-size:10px; color:var(--mut); font-weight:600;">Hộp:</span>
              <select class="row-profile-select" data-id="${part.id}" style="height:21px; padding:0 4px; font-size:11px; font-weight:700; border-radius:4px; border:1px solid #CBD5E1; background:#F8FAFC; color:var(--p); cursor:pointer;">
                ${getProfileOptionsHtml(part.profile)}
              </select>
              <span class="row-auto-badge" style="font-size:10px; font-weight:700; color:#047857; background:#D1FAE5; border-radius:3px; padding:1px 5px; display:${part._autoDetected ? 'inline-flex' : 'none'}; align-items:center;">
                ✓ ${escapeHtml(part.profile)}
              </span>
              ${part.style === 'ke' ? '<span style="font-size:10px; font-weight:700; color:#0369A1; background:#E0F2FE; border-radius:3px; padding:1px 5px;">⧉ Ghép mòi 45° (2 đầu)</span>' : (part.style === 'ke1' ? '<span style="font-size:10px; font-weight:700; color:#0369A1; background:#E0F2FE; border-radius:3px; padding:1px 5px;">⧉ Ghép mòi 45° (1 đầu)</span>' : '<span style="font-size:10px; color:#64748B; background:#F1F5F9; border-radius:3px; padding:1px 5px;">⊥ Ghép 90°</span>')}
              ${part.igs_url ? `
                <a href="#" class="btn-download-part-igs"
                   data-url="${escapeHtml(part.igs_url)}"
                   data-name="${escapeHtml(part.name || ('Chi_tiet_' + (originalIndex + 1)))}"
                   style="display:inline-flex; align-items:center; gap:3px; padding:1px 6px; background:#ECFDF5; color:#047857; border:1px solid #A7F3D0; border-radius:4px; font-size:10.5px; font-weight:700; text-decoration:none;" 
                   title="Tải file 3D .IGS của riêng chi tiết này về máy CNC">
                  <svg viewBox="0 0 24 24" style="width:11px; height:11px; stroke:currentColor; stroke-width:2.2; fill:none;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Tải .IGS
                </a>
              ` : ''}
            </div>
          </div>
          <div>
            <input type="text" class="so" value="${part.length || ''}" placeholder="Dài" data-f="length">
          </div>
          <div>
            <input type="number" min="1" class="so" value="${part.qty || ''}" placeholder="SL" data-f="qty">
          </div>
          <div>
            <div class="miter-btns">
              <button type="button" class="miter-btn ${part.style === 'thang' ? 'active' : ''}" data-style="thang" title="Cắt thẳng 90°">
                <svg viewBox="0 0 24 12"><path d="M2 1h20v10H2z"/></svg>
                Thẳng
              </button>
              <button type="button" class="miter-btn ${part.style === 'ke1' ? 'active' : ''}" data-style="ke1" title="Vát 45° một đầu">
                <svg viewBox="0 0 24 12"><path d="M2 1h14l6 10H2z"/></svg>
                Ke 1
              </button>
              <button type="button" class="miter-btn ${part.style === 'ke' ? 'active' : ''}" data-style="ke" title="Vát 45° hai đầu (hình thang)">
                <svg viewBox="0 0 24 12"><path d="M4 1h16l4 10H0z"/></svg>
                Ke 2
              </button>
            </div>
          </div>
          <div>
            <input type="text" class="so" value="${part.style === 'thang' ? '' : ((part.mat && part.mat >= 5) ? part.mat : extractMatFromProfile(part.profile))}" 
                   placeholder="Mặt vát" title="Bề rộng cạnh bị vát mòi 45° (mm) - Không phải độ dày thành hộp" data-f="mat" ${part.style === 'thang' ? 'disabled style="opacity:0.4;"' : ''}>
          </div>
          <div>
            <button type="button" class="btn-del" title="Xóa dòng">&times;</button>
          </div>
        `;

        const inpName = row.querySelector('[data-f="name"]');
        const inpLen = row.querySelector('[data-f="length"]');
        const inpQty = row.querySelector('[data-f="qty"]');
        const inpMat = row.querySelector('[data-f="mat"]');
        const selProf = row.querySelector('.row-profile-select');
        const autoBadge = row.querySelector('.row-auto-badge');

        inpName.oninput = e => {
          part.name = e.target.value;
          const specs = detectSpecsFromText(part.name);
          if (specs) {
            let changedProfile = false;
            if (specs.detectedProfile && specs.detectedProfile !== part.profile) {
              part.profile = specs.detectedProfile;
              part._autoDetected = true;
              changedProfile = true;
              if (!state.activeProfiles.includes(part.profile)) {
                state.activeProfiles.push(part.profile);
              }
              if (!state.savedProfiles.includes(part.profile)) {
                state.savedProfiles.push(part.profile);
                saveProfilesLibrary();
                renderMemoryLibraryChips();
              }
              ensureStockForProfile(part.profile);
            }
            if (specs.detectedMat) {
              part.mat = specs.detectedMat;
              if (inpMat && part.style !== 'thang') inpMat.value = part.mat;
            }
            if (specs.detectedLength && (!part.length || part._autoLength)) {
              part.length = specs.detectedLength;
              part._autoLength = true;
              if (inpLen) inpLen.value = numVN(part.length);
            }
            if (specs.detectedQty && (!part.qty || part.qty === 1)) {
              part.qty = specs.detectedQty;
              if (inpQty) inpQty.value = part.qty;
            }
            if (specs.detectedStyle) {
              part.style = specs.detectedStyle;
              row.querySelectorAll('.miter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.style === part.style);
              });
              if (inpMat) {
                inpMat.disabled = (part.style === 'thang');
                inpMat.style.opacity = (part.style === 'thang') ? '0.4' : '1';
                if (part.style !== 'thang') inpMat.value = part.mat;
              }
            }

            if (changedProfile) {
              selProf.innerHTML = getProfileOptionsHtml(part.profile);
              selProf.value = part.profile;
              if (autoBadge) {
                autoBadge.style.display = 'inline-flex';
                autoBadge.textContent = `✓ ${part.profile}`;
              }
              renderProfileTabs();
              renderActiveProfileBanner();
            }
          }
          autoRecalc();
        };

        selProf.onchange = e => {
          part.profile = e.target.value;
          part._autoDetected = false;
          if (autoBadge) autoBadge.style.display = 'none';
          part.mat = extractMatFromProfile(part.profile);
          if (inpMat && part.style !== 'thang') inpMat.value = part.mat;
          ensureProfilesConsistency();
          ensureStockForProfile(part.profile);
          renderProfileTabs();
          renderActiveProfileBanner();
          autoRecalc();
        };

        inpLen.oninput = e => {
          part.length = parseVN(e.target.value);
          part._autoLength = false;
          autoRecalc();
        };
        inpQty.oninput = e => { part.qty = parseInt(e.target.value) || 0; autoRecalc(); };
        inpMat.oninput = e => {
          part.mat = parseVN(e.target.value);
          autoRecalc();
        };
        inpMat.onblur = e => {
          const val = parseVN(e.target.value);
          if (part.style !== 'thang' && val > 0 && val < 5) {
            const defM = extractMatFromProfile(part.profile);
            part.mat = defM;
            inpMat.value = defM;
            showToast(`ℹ Hộp ${part.profile} có mặt vát 45° là ${defM}mm (không phải độ dày ${val}mm)`);
            autoRecalc();
          }
        };

        row.querySelectorAll('.miter-btn').forEach(btn => {
          btn.onclick = () => {
            part.style = btn.dataset.style;
            if (part.style !== 'thang' && !part.mat) {
              part.mat = extractMatFromProfile(part.profile);
            }
            renderPartsList();
            autoRecalc();
          };
        });

        row.querySelector('.btn-del').onclick = () => {
          if (checkProjectLockedForEdit()) return;
          state.parts = state.parts.filter(p => p.id !== part.id);
          renderProfileTabs();
          renderActiveProfileBanner();
          renderPartsList();
          autoRecalc();
        };

        const btnPartIgs = row.querySelector('.btn-download-part-igs');
        if (btnPartIgs) {
          btnPartIgs.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const igsSrc = btnPartIgs.getAttribute('data-url');
            const partName = btnPartIgs.getAttribute('data-name') || 'chi_tiet';
            try {
              showToast('⏳ Đang tải file 3D .IGS bảo mật...');
              await window.SupabaseDB.downloadIgsFile(igsSrc, `${toAscii(partName).replace(/[^\w.\-]/g, '_')}.igs`);
              showToast(`✓ Đã tải file .IGS chi tiết: ${partName}`);
            } catch (err) {
              showToast('❌ Không tải được file .IGS: ' + err.message);
            }
          };
        }

        container.appendChild(row);
      });

      $('lblPartCount').textContent = `${state.activeProfiles.length} loại hộp · ${state.parts.length} mục · ${totalPieces} chi tiết`;
    }

    // Render Stock List organized for current box profile
    function renderStockList() {
      ensureProfilesConsistency();
      const container = $('stockList');
      container.innerHTML = '';

      const targetProf = state.selectedTabProfile;
      const stocksToShow = targetProf === 'ALL'
        ? state.stock
        : state.stock.filter(s => s.profile === targetProf);

      // Make sure there is at least one 6m new stock for the profile
      if (targetProf !== 'ALL') {
        const has6m = stocksToShow.some(s => s.profile === targetProf && s.qty === null);
        if (!has6m) {
          state.stock.push({
            id: makeId('s_auto'),
            profile: targetProf,
            name: `Cây mới 6m (${targetProf})`,
            length: 6000,
            qty: null,
            clamp: state.clamp
          });
          renderStockList();
          return;
        }
      }

      stocksToShow.forEach(stock => {
        const row = document.createElement('div');
        row.className = 'stock-row';
        if (stock._fromOffcut) {
          row.style.background = '#F0FDFA';
          row.style.borderLeft = '3px solid #0F766E';
          row.style.borderRadius = '6px';
          row.title = 'Phôi đề-xê lấy từ Kho Đề-xê dùng chung';
        }

        row.innerHTML = `
          <div>
            <input type="text" value="${escapeHtml(stock.name || '')}" placeholder="Tên phôi" data-f="name">
          </div>
          <div>
            <input type="text" class="so" value="${stock.length || ''}" placeholder="Dài" data-f="length">
          </div>
          <div>
            <input type="text" class="so" value="${stock.qty === null ? '' : stock.qty}" placeholder="Mới" title="Để trống = mua mới không giới hạn" data-f="qty">
          </div>
          <div>
            <button type="button" class="btn-del" title="Xóa">&times;</button>
          </div>
        `;

        row.querySelector('[data-f="name"]').oninput = e => { stock.name = e.target.value; autoRecalc(); };
        row.querySelector('[data-f="length"]').oninput = e => { stock.length = parseVN(e.target.value); autoRecalc(); };
        row.querySelector('[data-f="qty"]').oninput = e => {
          const v = e.target.value.trim();
          stock.qty = v === '' ? null : parseInt(v) || 0;
          autoRecalc();
        };
        row.querySelector('.btn-del').onclick = () => {
          if (checkProjectLockedForEdit()) return;
          state.stock = state.stock.filter(s => s.id !== stock.id);
          renderStockList();
          autoRecalc();
        };

        container.appendChild(row);
      });

      renderOffcutSuggestionBox();
    }

    // Optimization Calculation (Guaranteed NO auto-scroll while typing!)
    function calculateOptimization(shouldScroll = false, skipSave = false) {
      const validParts = state.parts.filter(p => p.length > 0 && p.qty > 0);
      if (!validParts.length) {
        state.result = null;
        renderResults(null);
        renderProfileTabs();
        renderActiveProfileBanner();
        if (!skipSave) saveActiveProject();
        if (shouldScroll) showToast('Vui lòng nhập ít nhất 1 chi tiết có chiều dài và số lượng!');
        return;
      }

      // Check stock for all part profiles
      const partProfiles = new Set(validParts.map(p => p.profile || 'Chung'));
      let addedStock = false;
      partProfiles.forEach(prof => {
        const hasStock = state.stock.some(s => s.profile === prof && s.length > 0);
        if (!hasStock) {
          state.stock.push({
            id: makeId('s_auto'),
            profile: prof,
            name: `Cây mới 6m (${prof})`,
            length: 6000,
            qty: null,
            clamp: state.clamp
          });
          addedStock = true;
        }
      });
      if (addedStock) {
        renderStockList();
      }

      const kerf = parseVN($('inpKerf').value);
      const clampTail = parseVN($('inpClamp').value);
      const interlock = $('chkInterlock').checked;
      const gap = parseVN($('inpGap').value);

      state.kerf = kerf;
      state.clamp = clampTail;
      state.interlock = interlock;
      state.gap = gap;

      // Luôn cập nhật thông số kẹp đuôi cho tất cả các cây phôi trong kho
      state.stock.forEach(s => { s.clamp = clampTail; });

      // Prepare Engine Data with accurate Profile mappings
      const engineData = {
        kerf,
        interlock,
        gap,
        stock: state.stock.filter(s => s.length > 0).map((s, idx) => ({
          label: s.name || (s.qty === null ? `Cây mới ${numVN(s.length)}` : `Cây tồn ${numVN(s.length)}`),
          length: s.length,
          clampTail: clampTail,
          qty: s.qty,
          priority: s._fromOffcut ? (-1000 + idx) : idx,
          profile: s.profile || 'Chung'
        })),
        parts: validParts.map(p => ({
          label: p.id,
          length: p.length,
          qty: p.qty,
          end_style: p.style || 'thang',
          mat: p.style === 'thang' ? 0 : ((p.mat && p.mat >= 5) ? p.mat : extractMatFromProfile(p.profile)),
          profile: p.profile || 'Chung'
        }))
      };

      try {
        const result = RC.solve(engineData);
        state.result = result;
        renderResults(result);
        renderProfileTabs();
        renderActiveProfileBanner();
        if (!skipSave) saveActiveProject();

        $('resultsSection').style.display = 'block';
        if (shouldScroll) {
          $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (err) {
        console.error(err);
        if (shouldScroll) showToast('Lỗi tính toán: ' + err.message);
      }
    }

    let recalcTimeout = null;
    function autoRecalc() {
      clearTimeout(recalcTimeout);
      recalcTimeout = setTimeout(() => {
        calculateOptimization(false); // DO NOT SCROLL on autoRecalc - luôn tính toán Live Preview trực tiếp!
      }, 100);
    }

    // Render Results View
    function renderResults(res) {
      $('resultsSection').style.display = 'block';

      if (!res || !res.bars || !res.bars.length) {
        $('kpiContainer').innerHTML = `
          <div class="kpi-card highlight">
            <div class="kpi-val">0</div>
            <div class="kpi-label">tổng số cây cần dùng</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">0</div>
            <div class="kpi-label">0 loại hộp · 0 mục</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">0</div>
            <div class="kpi-label">cây mua mới</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">0</div>
            <div class="kpi-label">cây tồn kho dùng</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">0.0%</div>
            <div class="kpi-label">hiệu suất · dư 0.00 m</div>
          </div>
          <div class="kpi-card interlock">
            <div class="kpi-val">${state.interlock ? '0 m' : 'Tắt'}</div>
            <div class="kpi-label">xếp xen kẽ ke 45°</div>
          </div>
        `;
        $('warningsContainer').innerHTML = '';
        if ($('warehouseComparisonSummary')) $('warehouseComparisonSummary').style.display = 'none';
        if ($('projectDispatchBar')) $('projectDispatchBar').innerHTML = '';
        $('materialsContainer').innerHTML = '<div style="padding:24px;text-align:center;color:var(--mut);font-size:14px;background:#F8FAFC;border-radius:8px;">Chưa có dữ liệu vật tư.</div>';
        $('resultFilterTabs').innerHTML = '';
        $('patternsContainer').innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--mut);background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:12px;margin:15px 0;font-size:14px;">Chưa có sơ đồ cắt nào. Vui lòng nhập chi tiết ở trên để hiển thị sơ đồ trực tiếp (Live Preview).</div>';
        $('printDate').textContent = '';
        return;
      }

      const u = res.usageStats;
      const efficiency = u.totalNominalLength > 0 ? (u.totalCutLength / u.totalNominalLength * 100) : 0;
      const savingM = (u.totalInterlockSaving || 0) / 1000;
      const wasteM = (u.totalWasteLength || 0) / 1000;
      const diffBars = res.compare ? (res.compare.bars - res.bars.length) : 0;

      const totalPartsReq = state.parts.reduce((a, b) => a + (+b.qty || 0), 0);
      const missingParts = totalPartsReq - res.totalPiecesCut;
      const numProfiles = res.summaryByProfile ? res.summaryByProfile.length : 1;

      // KPI Header
      $('kpiContainer').innerHTML = `
        <div class="kpi-card highlight">
          <div class="kpi-val">${numVN(res.bars.length)}</div>
          <div class="kpi-label">tổng số cây cần dùng</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">${numVN(res.totalPiecesCut)}</div>
          <div class="kpi-label">${numProfiles} loại hộp · ${state.parts.length} mục ${missingParts > 0 ? `· <span style="color:var(--bad)">thiếu ${missingParts}</span>` : ''}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">${numVN(res.totalNewBars)}</div>
          <div class="kpi-label">cây mua mới</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">${numVN(res.totalExistingUsed)}</div>
          <div class="kpi-label">cây tồn kho dùng</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val">${numVN(efficiency, 1)}%</div>
          <div class="kpi-label">hiệu suất · dư ${numVN(wasteM, 2)} m</div>
        </div>
        <div class="kpi-card interlock">
          <div class="kpi-val">${state.interlock ? (diffBars > 0 ? `−${diffBars} cây` : `${numVN(savingM, 2)} m`) : 'Tắt'}</div>
          <div class="kpi-label">${state.interlock ? (diffBars > 0 ? `tiết kiệm ${diffBars} cây nhờ xen kẽ` : 'tiết kiệm nhờ xếp xen kẽ ke') : 'xếp xen kẽ ke 45°'}</div>
        </div>
      `;

      // Warnings
      let warnHTML = '';
      if (res.unfulfilled && res.unfulfilled.length > 0) {
        warnHTML += `
          <div class="err-box">
            <b>Cảnh báo không xếp vừa:</b> ${res.unfulfilled.map(u => `[${u.profile}] ${numVN(u.length)} mm (thiếu ${u.qtyMissing})`).join(', ')}.
            Vui lòng kiểm tra chiều dài phôi hoặc thêm cây mua mới dài hơn.
          </div>
        `;
      }
      if (res.interlockWarnings && res.interlockWarnings.length > 0) {
        warnHTML += `
          <div class="warn-box">
            <b>Lưu ý ke 45°:</b> ${res.interlockWarnings.map(w => `${numVN(w.length)} mm`).join(', ')} không xếp xen kẽ được (cắt rời thông thường).
          </div>
        `;
      }
      $('warningsContainer').innerHTML = warnHTML;

      // Grouped Materials Table (Order / Purchasing BOM)
      renderMaterialsGrouped(res);

      // Result Filter Tabs
      renderResultFilterTabs(res);

      // Grouped Patterns with SVG
      renderPatternsGrouped(res);
      renderOffcutSuggestionBox();

      $('printDate').textContent = `Ngày tính: ${new Date().toLocaleDateString('vi-VN')} · Tổng ${res.totalPiecesCut} chi tiết · ${numProfiles} loại hộp · ${res.bars.length} cây`;
    }

    // Render Filter Tabs on Results
    function renderResultFilterTabs(res) {
      const container = $('resultFilterTabs');
      container.innerHTML = '';

      const profiles = res.summaryByProfile ? res.summaryByProfile.map(s => s.profile) : [];
      
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = `profile-tab ${state.resultFilterProfile === 'ALL' ? 'active' : ''}`;
      allBtn.innerHTML = `<span>Tất cả loại hộp (${res.bars.length} cây)</span>`;
      allBtn.onclick = () => {
        state.resultFilterProfile = 'ALL';
        renderResultFilterTabs(res);
        renderPatternsGrouped(res);
      };
      container.appendChild(allBtn);

      profiles.forEach(prof => {
        const profSummary = res.summaryByProfile.find(s => s.profile === prof);
        const barCount = profSummary ? profSummary.totalBars : 0;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `profile-tab ${state.resultFilterProfile === prof ? 'active' : ''}`;
        btn.innerHTML = `<span>${escapeHtml(prof)} (${barCount} cây)</span>`;
        btn.onclick = () => {
          state.resultFilterProfile = prof;
          renderResultFilterTabs(res);
          renderPatternsGrouped(res);
        };
        container.appendChild(btn);
      });
    }

    // Render Patterns Grouped by Profile
    function renderPatternsGrouped(res) {
      const container = $('patternsContainer');
      container.innerHTML = '';
      HINH_CACHE = [];
      window.HINH_CACHE = HINH_CACHE;
      let globalPatternIdx = 0;

      const profiles = res.summaryByProfile ? res.summaryByProfile.map(s => s.profile) : ['Chung'];
      const targetProfiles = state.resultFilterProfile === 'ALL' ? profiles : [state.resultFilterProfile];

      targetProfiles.forEach(prof => {
        const patternsOfProfile = res.patterns.filter(p => (p.profile || 'Chung') === prof);
        if (!patternsOfProfile.length) return;

        const profSummary = res.summaryByProfile ? res.summaryByProfile.find(s => s.profile === prof) : null;
        const totalBars = profSummary ? profSummary.totalBars : patternsOfProfile.reduce((a, b) => a + b.count, 0);
        const newBars = profSummary ? profSummary.newBars : 0;
        const usedExisting = totalBars - newBars;
        const wasteM = profSummary ? (profSummary.usageStats.totalWasteLength / 1000) : 0;
        const savingM = profSummary ? (profSummary.usageStats.totalInterlockSaving / 1000) : 0;

        const section = document.createElement('div');
        section.className = 'profile-group-section';

        let sectionHeaderHTML = `
          <div class="profile-group-title">
            <h3>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              ${escapeHtml(prof)}
            </h3>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span class="profile-badge-pill">Cần: ${totalBars} cây (Mua mới: ${newBars}, Tồn: ${usedExisting})</span>
              <span style="font-size:13px;color:var(--mut);">Dư: ${numVN(wasteM, 2)} m ${savingM > 0 ? `· Tiết kiệm ke: ${numVN(savingM, 2)} m` : ''}</span>
              <button type="button" class="btn btn-soft btn-sm btn-export-all-bars" data-prof="${escapeHtml(prof)}" style="font-size:11px; padding:3px 9px; margin-left:6px; display:inline-flex; align-items:center; gap:4px; border:1px solid #0F766E; color:#0F766E;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Tải tất cả file .IGS cây ghép (${totalBars} cây)
              </button>
            </div>
          </div>
        `;

        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let patternsHTML = '';

        patternsOfProfile.forEach((p, pSubIdx) => {
          const letter = alphabet[pSubIdx % alphabet.length];
          const cacheIdx = globalPatternIdx++;
          const L = RC.layoutBar(p, res.kerf, res.gap, extractMatFromProfile(prof));
          const ke = L.pieces.filter(g => g.eL !== 'S' || g.eR !== 'S');
          L.H = Math.max(40, ...ke.map(g => g.w));
          L.pieces.forEach(g => { g.ti = 1; });
          HINH_CACHE[cacheIdx] = { p, L };

          // Group pieces by part for the footer
          const grouped = new Map();
          L.pieces.forEach(g => {
            const partId = g.c.label;
            const exist = grouped.get(partId);
            if (exist) exist.count++;
            else {
              const originalPart = state.parts.find(x => x.id === partId);
              grouped.set(partId, {
                part: originalPart,
                length: g.c.length,
                style: g.c.endStyle,
                count: 1,
                color: getColor(state.parts.findIndex(x => x.id === partId))
              });
            }
          });

          const pillsHTML = Array.from(grouped.values()).map(item => {
            const styleName = item.style === 'ke1' ? 'ke 1 đầu' : (item.style === 'ke' ? 'ke 2 đầu' : '');
            return `
              <span class="pattern-item-pill">
                <i style="--c: ${item.color};"></i>
                ${item.part && item.part.name ? `${escapeHtml(item.part.name)} ` : ''}${numVN(item.length)} ${styleName ? `· ${styleName}` : ''}
                <b>× ${item.count}</b>
              </span>
            `;
          }).join('');

          // SVG geometry
          const stockW = p.stockLength;
          const usableW = p.usableLength;
          const clampW = p.clampTail || 0;
          const H = L.H;

          let svgPolygons = '';
          let labelsHTML = '';

          L.pieces.forEach((g, kIdx) => {
            const originalPartIdx = state.parts.findIndex(x => x.id === g.c.label);
            const color = getColor(originalPartIdx >= 0 ? originalPartIdx : 0);

            const yTop = 0;
            const yBot = H;
            const pts = `${g.xt0},${yTop} ${g.xt1},${yTop} ${g.xb1},${yBot} ${g.xb0},${yBot}`;

            svgPolygons += `<polygon data-k="${kIdx}" points="${pts}" fill="${color}" stroke="#FFFFFF" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;

            const minX = Math.min(g.xb0, g.xt0);
            const maxX = Math.max(g.xb1, g.xt1);
            const leftPercent = (minX / stockW) * 100;
            const widthPercent = ((maxX - minX) / stockW) * 100;

            if (widthPercent > 3.8) {
              labelsHTML += `
                <div class="cut-label" style="left:${leftPercent}%;width:${widthPercent}%;">
                  ${numVN(g.c.length)}
                </div>
              `;
            }
          });

          const wasteW = Math.max(0, p.waste);
          const wasteLeft = (L.end / stockW) * 100;
          const wasteWidth = (wasteW / stockW) * 100;
          if (wasteWidth > 5) {
            labelsHTML += `
              <div class="cut-label waste-label" style="left:${wasteLeft}%;width:${wasteWidth}%;">
                dư ${numVN(wasteW)}
              </div>
            `;
          }

          if (clampW > 0 && (clampW / stockW) * 100 > 1.0) {
            const clampLeft = (usableW / stockW) * 100;
            const clampWidth = (clampW / stockW) * 100;
            labelsHTML += `
              <div class="cut-label waste-label" style="left:${clampLeft}%;width:${clampWidth}%;color:#64748B;" title="Kẹp đuôi: ${numVN(clampW)} mm">
                kẹp ${numVN(clampW)}
              </div>
            `;
          }

          const barKey = `${prof}__${letter}`;
          const patternHash = (window.SupabaseDB && typeof window.SupabaseDB.computePatternHash === 'function')
            ? window.SupabaseDB.computePatternHash(p)
            : '';
          const cutRecord = (state.cutStatuses && state.cutStatuses[barKey]) || null;
          const currentCut = cutRecord ? (cutRecord.cutCount || 0) : 0;
          const savedHash = cutRecord ? (cutRecord.patternHash || '') : '';
          const isHashMismatch = currentCut > 0 && Boolean(savedHash && patternHash && savedHash !== patternHash);
          const isDone = currentCut >= p.count;
          const isPartiallyDone = currentCut > 0 && currentCut < p.count;

          const normP = s => String(s || '').toLowerCase().replace(/[\s_]+/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const curProjForIgs = state.currentProjectId ? (state.savedProjects || []).find(x => x.id === state.currentProjectId) : null;
          const hasIgsMeta = Boolean(curProjForIgs && Array.isArray(curProjForIgs.igsFiles) && curProjForIgs.igsFiles.some(f => f.letter === letter && (!f.profile || normP(f.profile) === normP(prof))));
          const hasFusionNested = Boolean(state.fusionProject && Array.isArray(state.fusionProject.nested_bars) && state.fusionProject.nested_bars.some(b => b.letter === letter && (normP(b.profile) === normP(prof) || normP(b.profile).startsWith(normP(prof)) || normP(prof).startsWith(normP(b.profile)))));
          const igsOriginBadge = (hasIgsMeta || hasFusionNested)
            ? '<span style="font-size:11px; font-weight:800; padding:2px 8px; border-radius:999px; background:#DCFCE7; color:#166534; border:1px solid #86EFAC;">🟢 File Solid Fusion 360</span>'
            : '<span style="font-size:11px; font-weight:800; padding:2px 8px; border-radius:999px; background:#FEF9C3; color:#854D0E; border:1px solid #FDE047;">🟡 Sinh tự động từ web</span>';
          const cutByLine = (cutRecord && (cutRecord.updatedBy || cutRecord.updatedAt))
            ? `<div style="margin-top:6px; font-size:11.5px; color:#475569; font-weight:600;">👤 Cập nhật bởi <b>@${escapeHtml(cutRecord.updatedBy || 'xưởng')}</b>${cutRecord.updatedAt ? ' · ' + escapeHtml(formatShortCutTime(cutRecord.updatedAt)) : ''}</div>`
            : '';

          patternsHTML += `
            <div class="pattern-card ${isDone ? 'pattern-card-done' : ''}" style="${isHashMismatch ? 'border:2px solid #DC2626; background:#FEF2F2;' : (isDone ? 'border:2px solid #16A34A; background:#F0FDF4;' : '')}">
              ${isHashMismatch ? `<div style="margin-bottom:8px; padding:7px 11px; border-radius:8px; background:#FEE2E2; border:1px solid #FCA5A5; color:#991B1B; font-size:12px; font-weight:700;">⚠️ CẢNH BÁO LỆCH SƠ ĐỒ CẮT: Sơ đồ cây ${letter} đã thay đổi sau khi bắt đầu cắt (${currentCut}/${p.count} cây). Vui lòng kiểm tra lại trước khi cắt tiếp!</div>` : ''}
              <div class="pattern-header" style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                <span class="pattern-letter">${letter}</span>
                <span class="pattern-multiplier">× ${p.count} cây</span>
                <span class="pattern-meta" style="flex:1;">
                  ${escapeHtml(p.stockLabel)} · ${numVN(p.stockLength)} mm ${p.isNewPurchase ? '' : '(tồn)'} · cắt ${p.cuts.length} chi tiết · dư ${numVN(Math.max(0, p.waste))} mm ${clampW > 0 ? `· kẹp đuôi ${numVN(clampW)} mm` : ''}
                  ${p.interlockSaving > 0 ? `· <span class="saving-badge">xen kẽ bớt ${numVN(p.interlockSaving)} mm</span>` : ''}
                </span>
                ${igsOriginBadge}

                <!-- Nút Tích Hoàn Thành Cắt Thực Tế (Live Cut Tracker) -->
                <button type="button" class="btn btn-sm btn-cut-toggle" data-key="${barKey}" data-total="${p.count}" data-hash="${escapeHtml(patternHash)}" style="font-size:12px; padding:4px 12px; display:inline-flex; align-items:center; gap:5px; font-weight:800; border-radius:8px; cursor:pointer; ${isDone ? 'background:#DCFCE7; color:#15803D; border:1.5px solid #16A34A;' : (isPartiallyDone ? 'background:#FEF3C7; color:#B45309; border:1.5px solid #F59E0B;' : 'background:#FFFFFF; color:#334155; border:1.5px solid #CBD5E1;')}">
                  ${isDone ? '✅ ĐÃ CẮT XONG (' + currentCut + '/' + p.count + ')' : (isPartiallyDone ? '⏳ ĐANG CẮT (' + currentCut + '/' + p.count + ')' : '⚪ Chưa cắt (' + currentCut + '/' + p.count + ')')}
                </button>

                <button type="button" class="btn btn-sm btn-p btn-export-bar" data-letter="${letter}" data-prof="${escapeHtml(prof)}" data-len="${p.stockLength}" data-idx="${cacheIdx}" data-count="${p.count}" style="font-size:11.5px; padding:3px 9px; display:inline-flex; align-items:center; gap:4px; margin-left:auto;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Lưu file .IGS cây ghép (${letter})
                </button>
              </div>

              <div class="bar-visual-wrap" data-i="${cacheIdx}">
                <svg viewBox="0 0 ${stockW} ${H}" preserveAspectRatio="none">
                  <rect x="0" y="0" width="${usableW}" height="${H}" fill="var(--steel2)"/>
                  ${clampW > 0 ? `<rect x="${usableW}" y="0" width="${clampW}" height="${H}" fill="var(--steel3)"/>` : ''}
                  ${svgPolygons}
                </svg>
                <div class="bar-labels-layer">
                  ${labelsHTML}
                </div>
              </div>

              <div class="bar-ruler">
                <span>0</span>
                <span>${numVN(p.stockLength)} mm</span>
              </div>

              <div class="pattern-items-list">
                ${pillsHTML}
              </div>
              ${cutByLine}
            </div>
          `;
        });

        section.innerHTML = sectionHeaderHTML + patternsHTML;
        container.appendChild(section);
      });

      // Gắn sự kiện xuất file .IGS cho từng cây ghép hoặc toàn bộ cây
      document.querySelectorAll('.btn-export-bar').forEach(btn => {
        btn.onclick = () => {
          const letter = btn.dataset.letter;
          const prof = btn.dataset.prof;
          const len = parseFloat(btn.dataset.len) || 6000;
          const count = parseInt(btn.dataset.count) || 1;
          const cache = HINH_CACHE[+btn.dataset.idx];
          const pieces = cache && cache.L ? cache.L.pieces : null;

          const normP = s => String(s || '').toLowerCase().replace(/[\s_]+/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const cleanProf = toAscii(prof).replace(/[^\w\.\-]/g, '_');
          const defaultFileName = `Cay_${letter}_${cleanProf}_L${Math.round(len)}_SL_${count}.igs`;

          const fusionBar = state.fusionProject && Array.isArray(state.fusionProject.nested_bars)
            ? (state.fusionProject.nested_bars.find(b => b.letter === letter && normP(b.profile) === normP(prof)) ||
               state.fusionProject.nested_bars.find(b => b.letter === letter && (normP(b.profile).startsWith(normP(prof)) || normP(prof).startsWith(normP(b.profile)))))
            : null;

          // Kiểm tra tính đồng bộ
          let isMatch = false;
          if (fusionBar) {
            if (Array.isArray(fusionBar.pieces) && fusionBar.pieces.length > 0 && pieces && pieces.length > 0) {
              isMatch = (fusionBar.pieces.length === pieces.length) && fusionBar.pieces.every((fb, i) => {
                const cp = pieces[i];
                const cpLen = cp.c ? cp.c.length : cp.length;
                return Math.abs(fb.length - cpLen) < 1.0;
              });
            } else if (pieces && pieces.length > 0) {
              isMatch = (!fusionBar.cuts_count || fusionBar.cuts_count === pieces.length || fusionBar.letter === letter);
            } else {
              isMatch = true;
            }
          }

          const curProjRec = state.currentProjectId
            ? (state.savedProjects || []).find(p => p.id === state.currentProjectId)
            : null;
          const igsMetaFile = (curProjRec && Array.isArray(curProjRec.igsFiles))
            ? curProjRec.igsFiles.find(f => f.letter === letter && (!f.profile || normP(f.profile) === normP(prof)))
            : null;

          const rawBarName = (fusionBar && fusionBar.name) || (igsMetaFile && igsMetaFile.name) || defaultFileName;
          const dlName = (toAscii(rawBarName).replace(/[^\w\.\-]/g, '_') + '.igs').replace(/\.igs\.igs$/i, '.igs');

          // 1. Ưu tiên tải file 3D Solid .IGS từ Supabase Storage bảo mật hoặc URL cục bộ
          const candidateSources = [];
          if (igsMetaFile && (igsMetaFile.storage_path || igsMetaFile.public_url)) {
            candidateSources.push(igsMetaFile.storage_path || igsMetaFile.public_url);
          }
          if (isMatch && fusionBar && fusionBar.igs_url && !/^\/api\//i.test(fusionBar.igs_url)) {
            candidateSources.push(fusionBar.igs_url);
          }
          if (window.SupabaseDB && window.SupabaseDB.isConfigured() && state.currentProjectId) {
            candidateSources.push(`storage://${window.SupabaseDB.toAsciiSafe(state.currentProjectId)}/${dlName}`);
          }
          if (isMatch && fusionBar && fusionBar.igs_url && /^\/api\//i.test(fusionBar.igs_url)) {
            candidateSources.push(fusionBar.igs_url);
          }

          const uniqueSources = Array.from(new Set(candidateSources.filter(Boolean)));
          if (uniqueSources.length && (isMatch || igsMetaFile)) {
            const tryFetch = async (idx) => {
              if (idx >= uniqueSources.length) {
                exportNestedBarIGES(dlName, prof, len, pieces);
                return;
              }
              try {
                const blob = await window.SupabaseDB.downloadIgsBlob(uniqueSources[idx]);
                if (!blob || blob.size < 100) throw new Error('Empty blob');
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = dlName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast(`✓ Đã tải file 3D Solid từ Supabase Storage: ${dlName}`);
              } catch (err) {
                tryFetch(idx + 1);
              }
            };
            tryFetch(0);
            return;
          }

          // 2. Fallback: Tự sinh file 3D IGES B-Spline Surfaces (Entity 128) chuẩn ASCII
          exportNestedBarIGES(defaultFileName, prof, len, pieces);
        };
      });

      document.querySelectorAll('.btn-export-all-bars').forEach(btn => {
        btn.onclick = () => {
          const prof = btn.dataset.prof;
          const barBtns = document.querySelectorAll(`.btn-export-bar[data-prof="${prof}"]`);
          if (!barBtns.length) {
            showToast('Không có cây ghép nào để xuất!');
            return;
          }
          barBtns.forEach((b, idx) => {
            setTimeout(() => b.click(), idx * 400);
          });
        };
      });

      // Gắn sự kiện nút đánh dấu tiến độ cắt thực tế
      document.querySelectorAll('.btn-cut-toggle').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const key = btn.dataset.key;
          const total = parseInt(btn.dataset.total) || 1;
          const patternHash = btn.dataset.hash || '';
          toggleBarCuttingStatus(key, total, patternHash);
        };
      });

      updateLiveCuttingProgressUI();
      requestAnimationFrame(applyMiterAngleAdjustment);
    }


    // Apply Miter visual angles on SVG polygons
    function applyMiterAngleAdjustment() {
      document.querySelectorAll('.bar-visual-wrap[data-i]').forEach(wrap => {
        const svg = wrap.querySelector('svg');
        const cache = HINH_CACHE[+wrap.dataset.i];
        if (!svg || !cache || !svg.clientWidth) return;

        const { p, L } = cache;
        const H = L.H;
        const ps = L.pieces;
        const mmPx = p.stockLength / svg.clientWidth;
        const cao = svg.clientHeight;

        const chung = k => k > 0 && k < ps.length && ps[k].run >= 0 && ps[k].run === ps[k - 1].run && ps[k].c.pos > 0;
        const X = ps.map(g => Math.min(cao * mmPx, Math.abs((g.xt1 + g.xb1) / 2 - (g.xt0 + g.xb0) / 2) * 0.45));

        ps.forEach((g, k) => {
          let t0 = g.xt0, b0 = g.xb0, t1 = g.xt1, b1 = g.xb1;
          const dL = Math.sign(b0 - t0), dR = Math.sign(b1 - t1);
          if (dL && chung(k)) {
            const m = (t0 + b0) / 2, h = Math.min(X[k], X[k - 1]) / 2;
            t0 = m - dL * h; b0 = m + dL * h;
          } else if (dL > 0) b0 = t0 + X[k];
          else if (dL < 0) t0 = b0 + X[k];

          if (dR && chung(k + 1)) {
            const m = (t1 + b1) / 2, h = Math.min(X[k], X[k + 1]) / 2;
            t1 = m - dR * h; b1 = m + dR * h;
          } else if (dR > 0) t1 = b1 - X[k];
          else if (dR < 0) b1 = t1 - X[k];

          const po = svg.querySelector(`polygon[data-k="${k}"]`);
          if (po) po.setAttribute('points', `${t0},0 ${t1},0 ${b1},${H} ${b0},${H}`);
        });
      });
    }

    window.addEventListener('resize', applyMiterAngleAdjustment);


    // Grouped Materials Table (BOM for Purchasing + Live Warehouse Comparison & Dispatch)
    function renderMaterialsGrouped(res) {
      const container = $('materialsContainer');
      const cmpBox = $('warehouseComparisonSummary');
      const dispatchBar = $('projectDispatchBar');
      if (!container) return;

      const cmp = (window.WorkshopExport && typeof window.WorkshopExport.computeWarehouseBomComparison === 'function')
        ? window.WorkshopExport.computeWarehouseBomComparison({
            result: res,
            inventoryItems: state.inventoryItems,
            stockOffcuts: state.stockOffcuts,
            inventoryDeductedAt: state.inventoryDeductedAt,
            inventoryDeductedBy: state.inventoryDeductedBy,
            inventoryDeductedSnapshot: state.inventoryDeductedSnapshot
          })
        : null;

      if (dispatchBar) {
        const activeVoucher = state.activeProjectOutVoucher || null;
        const canApprove = window.SharedUI && window.SharedUI.canApproveVouchers(state.currentUser);
        const canCreate = window.SharedUI ? window.SharedUI.canCreateVouchers(state.currentUser) : (state.userRole !== 'operator');

        if (activeVoucher && activeVoucher.status === 'pending') {
          dispatchBar.innerHTML = `
            <span style="display:inline-flex; align-items:center; gap:5px; padding:5px 11px; border-radius:999px; background:#FEF3C7; color:#B45309; border:1px solid #FDE68A; font-size:12px; font-weight:800;">
              ⏳ Đang chờ thủ kho duyệt ${escapeHtml(activeVoucher.voucherCode || '')}
            </span>
            <a href="/vouchers?id=${encodeURIComponent(activeVoucher.id)}" class="btn btn-soft btn-sm" style="min-height:32px;">🧾 Mở phiếu ↗</a>
            ${canApprove ? `<button type="button" class="btn btn-p btn-sm" id="btnApproveProjectVoucher" style="min-height:32px;">✅ Duyệt xuất ngay</button>` : ''}
            ${canCreate ? `<button type="button" class="btn btn-soft btn-sm" id="btnReturnProjectInventory" style="min-height:32px; border-color:#FCA5A5; color:#B91C1C;">✕ Hủy phiếu</button>` : ''}
          `;
          if ($('btnApproveProjectVoucher')) {
            $('btnApproveProjectVoucher').onclick = () => approvePendingProjectOutVoucher();
          }
          if ($('btnReturnProjectInventory')) {
            $('btnReturnProjectInventory').onclick = () => returnActiveProjectToWarehouse();
          }
        } else if (state.inventoryDeductedAt || (activeVoucher && activeVoucher.status === 'approved')) {
          const byWho = state.inventoryDeductedBy ? ` · @${escapeHtml(state.inventoryDeductedBy)}` : '';
          const vCode = activeVoucher && activeVoucher.voucherCode ? `${escapeHtml(activeVoucher.voucherCode)} · ` : '';
          const tsTxt = state.inventoryDeductedAt ? escapeHtml(formatShortCutTime(state.inventoryDeductedAt)) : '';
          dispatchBar.innerHTML = `
            <span style="display:inline-flex; align-items:center; gap:5px; padding:5px 11px; border-radius:999px; background:#DCFCE7; color:#15803D; border:1px solid #86EFAC; font-size:12px; font-weight:800;">
              ✅ Đã xuất kho ${vCode}(${tsTxt}${byWho})
            </span>
            ${activeVoucher ? `<a href="/vouchers?id=${encodeURIComponent(activeVoucher.id)}" class="btn btn-soft btn-sm" style="min-height:32px;">🧾 Xem phiếu ↗</a>` : ''}
            ${canCreate ? `<button type="button" class="btn btn-soft btn-sm" id="btnReturnProjectInventory" style="min-height:32px; border-color:#FCA5A5; color:#B91C1C;">↩️ Hoàn kho</button>` : ''}
          `;
          if ($('btnReturnProjectInventory')) {
            $('btnReturnProjectInventory').onclick = () => returnActiveProjectToWarehouse();
          }
        } else if (canCreate) {
          if (canApprove) {
            dispatchBar.innerHTML = `
              <button type="button" class="btn btn-p btn-sm" id="btnDispatchProjectNow" style="min-height:32px;">✅ Tạo &amp; Duyệt xuất ngay</button>
              <button type="button" class="btn btn-soft btn-sm" id="btnDispatchProjectPending" style="min-height:32px;">📝 Tạo phiếu chờ duyệt</button>
            `;
            if ($('btnDispatchProjectNow')) $('btnDispatchProjectNow').onclick = () => dispatchActiveProjectToWarehouse(false, true);
            if ($('btnDispatchProjectPending')) $('btnDispatchProjectPending').onclick = () => dispatchActiveProjectToWarehouse(false, false);
          } else {
            dispatchBar.innerHTML = `
              <button type="button" class="btn btn-p btn-sm" id="btnDispatchProjectInventory" style="min-height:32px;">📤 Yêu cầu xuất vật tư (Tạo PXK)</button>
            `;
            if ($('btnDispatchProjectInventory')) {
              $('btnDispatchProjectInventory').onclick = () => dispatchActiveProjectToWarehouse(false, false);
            }
          }
        } else {
          dispatchBar.innerHTML = '';
        }
      }

      if (cmpBox) {
        if (cmp && cmp.summaryLines && cmp.summaryLines.length) {
          cmpBox.style.display = 'block';
          cmpBox.innerHTML = cmp.summaryLines.join('<br>');
        } else {
          cmpBox.style.display = 'none';
        }
      }

      let tableHTML = `
        <table class="mat-table">
          <thead>
            <tr>
              <th>Loại hộp / Quy cách</th>
              <th>Cây vật tư</th>
              <th class="r">Dài (mm)</th>
              <th class="r">Cần dùng</th>
              <th class="r">Tồn kho xưởng</th>
              <th class="r">Cần mua thêm / Trạng thái</th>
            </tr>
          </thead>
          <tbody>
      `;

      if (cmp && cmp.items && cmp.items.length) {
        const profGroups = {};
        cmp.items.forEach(it => {
          if (!profGroups[it.profile]) profGroups[it.profile] = [];
          profGroups[it.profile].push(it);
        });

        Object.keys(profGroups).forEach(prof => {
          const group = profGroups[prof];
          const first = group[0];
          group.forEach((it, idx) => {
            tableHTML += `
              <tr>
                ${idx === 0 ? `<td rowspan="${group.length}" style="vertical-align:top;font-weight:800;color:var(--dark);background:#F8FAFC;border-right:1px solid var(--edge);">${escapeHtml(prof)}</td>` : ''}
                <td><b>${escapeHtml(it.label)}</b></td>
                <td class="r">${numVN(it.length)}</td>
                <td class="r"><b>${numVN(it.usedQty)}</b></td>
                ${idx === 0 ? `<td rowspan="${group.length}" class="r" style="vertical-align:top;font-weight:700;color:#0F766E;">${numVN(first.warehouseFullQty)} cây<br><span style="font-size:11px;color:#0369A1;">+${numVN(first.warehouseOffcutQty)} lẻ</span></td>` : ''}
                <td class="r">${it.sourceBadgeHtml}</td>
              </tr>
            `;
          });
        });
      }

      tableHTML += `
          </tbody>
        </table>
      `;

      const u = res.usageStats;
      const summaryNote = `
        <div class="mat-summary">
          Tổng chiều dài cắt: <b>${numVN(u.totalCutLength / 1000, 2)} m</b> · 
          Mạch cắt: <b>${numVN(u.totalKerfLength / 1000, 2)} m</b> · 
          Kẹp đuôi: <b>${numVN(u.totalClampTailLength / 1000, 2)} m</b> · 
          Phôi dư: <b>${numVN(u.totalWasteLength / 1000, 2)} m</b>
          ${res.compare ? `<br>Nếu cắt rời không xen kẽ: <b>${numVN(res.compare.bars)} cây</b> (dư thừa ${numVN(res.compare.waste / 1000, 2)} m).` : ''}
        </div>
      `;

      container.innerHTML = tableHTML + summaryNote;
    }


// Expose on window
if (typeof window !== "undefined") {
  window.ensureStockForProfile = ensureStockForProfile;
  window.loadMultiProfilePreset = loadMultiProfilePreset;
  window.loadUserCase = loadUserCase;
  window.updateInputsFromState = updateInputsFromState;
  window.ensureProfilesConsistency = ensureProfilesConsistency;
  window.renderProfileTabs = renderProfileTabs;
  window.renderActiveProfileBanner = renderActiveProfileBanner;
  window.checkProjectLockedForEdit = checkProjectLockedForEdit;
  window.renderPartsList = renderPartsList;
  window.getProfileOptionsHtml = getProfileOptionsHtml;
  window.renderStockList = renderStockList;
  window.calculateOptimization = calculateOptimization;
  window.autoRecalc = autoRecalc;
  window.renderResults = renderResults;
  window.renderResultFilterTabs = renderResultFilterTabs;
  window.renderPatternsGrouped = renderPatternsGrouped;
  window.applyMiterAngleAdjustment = applyMiterAngleAdjustment;
  window.renderMaterialsGrouped = renderMaterialsGrouped;
}
