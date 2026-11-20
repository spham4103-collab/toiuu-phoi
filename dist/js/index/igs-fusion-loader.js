/**
 * Module: igs-fusion-loader.js - IGS & Autodesk Fusion 360 Loader
 * Quét phân tích hình học chi tiết cắt laser 3D từ tệp .igs và xuất tự động từ Fusion 360
 */

let stagedIgsParts = [];

      function renderIgsPreview() {
        const wrap = $('igsPreviewWrap');
        const list = $('igsPreviewList');
        const badge = $('igsCountBadge');
        const btnApply = $('btnApplyIgs');

        if (!stagedIgsParts.length) {
          wrap.style.display = 'none';
          btnApply.disabled = true;
          btnApply.style.opacity = '0.5';
          return;
        }

        wrap.style.display = 'block';
        btnApply.disabled = false;
        btnApply.style.opacity = '1';
        badge.textContent = `${stagedIgsParts.length} mục (${stagedIgsParts.reduce((a, b) => a + b.qty, 0)} chi tiết)`;

        list.innerHTML = stagedIgsParts.map(p => `
          <div class="igs-item-row">
            <span style="font-weight:600; color:var(--dark); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            <span style="font-weight:700; color:var(--p);">${escapeHtml(p.profile)}</span>
            <span style="text-align:right; font-weight:600;">${numVN(p.length)}</span>
            <span style="text-align:center;">
              <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:${p.style === 'ke' ? '#FEF3C7;color:#B45309' : (p.style === 'ke1' ? '#E0F2FE;color:#0369A1' : '#F1F5F9;color:#475569')};">
                ${p.style === 'ke' ? 'Ke 2 đầu' : (p.style === 'ke1' ? 'Ke 1 đầu' : 'Thẳng 90°')}
              </span>
            </span>
            <span style="text-align:right; font-weight:700;">× ${p.qty}</span>
          </div>
        `).join('');
      }

      function processIgsFileList(files) {
        if (!files || !files.length) return;
        let pending = files.length;
        const newlyParsed = [];

        Array.from(files).forEach(file => {
          if (!file.name.toLowerCase().endsWith('.igs') && !file.name.toLowerCase().endsWith('.iges')) {
            pending--;
            if (pending === 0) finishProcessing(newlyParsed);
            return;
          }
          const reader = new FileReader();
          reader.onload = e => {
            const parsed = parseIGESFile(e.target.result, file.name);
            if (parsed) newlyParsed.push(parsed);
            pending--;
            if (pending === 0) finishProcessing(newlyParsed);
          };
          reader.onerror = () => {
            pending--;
            if (pending === 0) finishProcessing(newlyParsed);
          };
          reader.readAsText(file);
        });

        function finishProcessing(items) {
          if (!items.length) {
            showToast('Không đọc được hình học từ file .IGS đã chọn!');
            return;
          }
          items.forEach(it => {
            // Chỉ gộp khi trùng cả tên (hậu tố lỗ/ghi chú), quy cách, chiều dài và góc vát
            const exist = stagedIgsParts.find(p => 
              p.name.toLowerCase() === it.name.toLowerCase() &&
              p.profile === it.profile && 
              Math.abs(p.length - it.length) < 0.5 && 
              p.style === it.style
            );
            if (exist) {
              exist.qty += it.qty;
            } else {
              stagedIgsParts.push(it);
            }
          });
          renderIgsPreview();
          const totalCount = stagedIgsParts.reduce((a, b) => a + b.qty, 0);
          showToast(`✓ Đã nhận diện thành công ${stagedIgsParts.length} mục (Tổng ${totalCount} thanh phôi)!`);
        }
      }


const openIgsModal = () => {
  $('modalIgs').style.display = 'flex';
};

const closeIgsModal = () => {
  $('modalIgs').style.display = 'none';
  stagedIgsParts = [];
  renderIgsPreview();
};

const openFusionModal = () => {
  $('modalFusion').style.display = 'flex';
};

const closeFusionModal = () => {
  $('modalFusion').style.display = 'none';
};

      async function loadFusionDataPayload(data) {
        state.fusionProject = data;
        const partsList = Array.isArray(data) ? data : (data.parts || []);
        if (!partsList.length) {
          showToast('Không có chi tiết hợp lệ trong dữ liệu Fusion 360!');
          return;
        }

        if (data.clamp_tail != null) {
          state.clamp = Number(data.clamp_tail);
          if ($('inpClamp')) $('inpClamp').value = state.clamp;
        }
        if (data.kerf != null) {
          state.kerf = Number(data.kerf);
          if ($('inpKerf')) $('inpKerf').value = state.kerf;
        }

        const newParts = partsList.map((p, idx) => ({
          id: makeId('p_f360_' + idx),
          name: p.name || `Chi tiết ${idx + 1}`,
          profile: p.profile,
          length: p.length,
          qty: p.qty || 1,
          style: p.style || 'thang',
          mat: p.mat || extractMatFromProfile(p.profile),
          igs_url: p.igs_url || p.pieceIgsUrl || p.igs_path || null,
          _autoDetected: true
        }));

        state.parts = newParts;
        state.activeProfiles = [];
        state.stock = [];
        const newProfsToSave = [];
        newParts.forEach(p => {
          if (!state.activeProfiles.includes(p.profile)) state.activeProfiles.push(p.profile);
          if (!state.savedProfiles.includes(p.profile)) {
            state.savedProfiles.push(p.profile);
            newProfsToSave.push(p.profile);
          }
          ensureStockForProfile(p.profile);
        });

        renderMemoryLibraryChips();
        ensureProfilesConsistency();
        state.selectedTabProfile = 'ALL';
        state.resultFilterProfile = 'ALL';

        const baseProjName = data.project_name || ('Bản vẽ Fusion 360 ' + new Date().toLocaleDateString('vi-VN'));
        let existingProj = state.savedProjects.find(p => p.name.toLowerCase() === baseProjName.toLowerCase());
        let fProjName = baseProjName;
        if (existingProj && existingProj.isLocked) {
          const d = new Date();
          const pad2 = n => String(n).padStart(2, '0');
          fProjName = `${baseProjName} (v2 - ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())})`;
          existingProj = null;
          showToast(`🔒 Bản "${baseProjName}" đang khóa -> Tự tạo bản mới "${fProjName}"`, 5000);
        }
        const projId = existingProj ? existingProj.id : makeId('proj_f360');
        state.currentProjectId = projId;
        state.currentProjectName = fProjName;
        state.currentProjectCustomer = 'Autodesk Fusion 360';
        state.currentProjectNotes = `Xuất lúc: ${data.timestamp || new Date().toLocaleString('vi-VN')}`;
        try { localStorage.setItem(LS_CURRENT_PROJ_ID, projId); } catch (e) {}

        renderProfileTabs();
        renderActiveProfileBanner();
        renderPartsList();
        renderStockList();
        calculateOptimization(true);
        updateProjectActiveBanner();

        const cleanDataPayload = window.SupabaseDB ? window.SupabaseDB.stripHeavyIgs({
          activeProfiles: [...state.activeProfiles],
          selectedTabProfile: 'ALL',
          parts: JSON.parse(JSON.stringify(state.parts)),
          stock: JSON.parse(JSON.stringify(state.stock)),
          method: state.method,
          kerf: state.kerf,
          clamp: state.clamp,
          interlock: state.interlock,
          gap: state.gap,
          fusionProject: data
        }) : {};

        const projEntry = {
          id: projId,
          name: fProjName,
          customer: state.currentProjectCustomer,
          notes: state.currentProjectNotes,
          isLocked: false,
          isTrashed: false,
          isDraft: false,
          source: 'fusion360',
          createdAt: existingProj ? existingProj.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: cleanDataPayload,
          igsFiles: existingProj ? (existingProj.igsFiles || []) : []
        };

        if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
          state.lastLocalProjectWriteAt = Date.now();
          window.SupabaseDB.setLoading(true, 'Đang lưu bản vẽ Fusion 360 lên Supabase...');
          try {
            if (newProfsToSave.length) {
              await window.SupabaseDB.addProfilesBulk(newProfsToSave);
            }
            const saved = await window.SupabaseDB.saveProject(projEntry);
            state.savedProjects = [saved, ...state.savedProjects.filter(x => x.id !== saved.id)];
            await loadCutProgressForActiveProject();
          } catch (err) {
            showToast('❌ Lỗi lưu dự án lên Supabase: ' + err.message);
          } finally {
            window.SupabaseDB.setLoading(false);
          }
        } else {
          state.savedProjects = [projEntry, ...state.savedProjects.filter(x => x.id !== projEntry.id)];
        }

        updateProjectsBadge();
        const projName = data.project_name ? `từ bản vẽ "${data.project_name}"` : '';
        showToast(`✓ Đã nạp thành công ${newParts.length} mục (${state.activeProfiles.length} loại hộp) ${projName}!`);
      }

function initIgsFusionEvents() {
  // Gắn sự kiện Hộp thoại IGS
  if ($('btnOpenIgs')) $('btnOpenIgs').onclick = openIgsModal;
  if ($('btnCloseIgs')) $('btnCloseIgs').onclick = closeIgsModal;
  if ($('btnCancelIgs')) $('btnCancelIgs').onclick = closeIgsModal;

  const igsDropZone = $('igsDropZone');
  const inpIgs = $('inpIgsFiles');
  if (igsDropZone && inpIgs) {
    igsDropZone.onclick = () => inpIgs.click();
    igsDropZone.ondragover = e => { e.preventDefault(); igsDropZone.style.borderColor = 'var(--p)'; };
    igsDropZone.ondragleave = () => { igsDropZone.style.borderColor = ''; };
    igsDropZone.ondrop = e => {
      e.preventDefault();
      igsDropZone.style.borderColor = '';
      processIgsFileList(e.dataTransfer.files);
    };
    inpIgs.onchange = e => processIgsFileList(e.target.files);
  }

  if ($('btnApplyIgs')) {
    $('btnApplyIgs').onclick = () => {
      if (!stagedIgsParts.length) return;
      const newParts = stagedIgsParts.map((p, idx) => ({
        id: makeId('p_igs_' + idx),
        name: p.name,
        profile: p.profile,
        length: p.length,
        qty: p.qty,
        style: p.style,
        mat: p.mat,
        _autoDetected: true
      }));
      state.parts = newParts;
      state.activeProfiles = [];
      state.stock = [];
      const newProfsToSave = [];
      newParts.forEach(p => {
        if (!state.activeProfiles.includes(p.profile)) state.activeProfiles.push(p.profile);
        if (!state.savedProfiles.includes(p.profile)) {
          state.savedProfiles.push(p.profile);
          newProfsToSave.push(p.profile);
        }
        ensureStockForProfile(p.profile);
      });
      if (newProfsToSave.length) {
        saveProfilesLibrary();
      }
      renderMemoryLibraryChips();
      ensureProfilesConsistency();
      state.selectedTabProfile = 'ALL';
      state.resultFilterProfile = 'ALL';
      renderProfileTabs();
      renderActiveProfileBanner();
      renderPartsList();
      renderStockList();
      calculateOptimization(false);
      saveActiveProject();
      $('modalIgs').style.display = 'none';
      showToast(`✓ Đã nạp thành công ${newParts.length} mục (${newParts.reduce((a, b) => a + b.qty, 0)} chi tiết) từ file .IGS!`);
    };
  }

  // Gắn sự kiện Hộp thoại Fusion 360
  if ($('btnLoadFusion')) $('btnLoadFusion').onclick = openFusionModal;
  if ($('btnCloseFusion')) $('btnCloseFusion').onclick = closeFusionModal;
  if ($('btnCancelFusion')) $('btnCancelFusion').onclick = closeFusionModal;

  const fusionDropZone = $('fusionDropZone');
  const inpFusion = $('inpFusionFile');
  if (fusionDropZone && inpFusion) {
    fusionDropZone.onclick = () => inpFusion.click();
    fusionDropZone.ondragover = e => { e.preventDefault(); fusionDropZone.style.borderColor = 'var(--p)'; };
    fusionDropZone.ondragleave = () => { fusionDropZone.style.borderColor = ''; };
    fusionDropZone.ondrop = e => {
      e.preventDefault();
      fusionDropZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async ev => {
        try {
          const data = JSON.parse(ev.target.result);
          await loadFusionDataPayload(data);
          $('modalFusion').style.display = 'none';
        } catch (err) {
          showToast('File JSON không hợp lệ!');
        }
      };
      reader.readAsText(file);
    };
    inpFusion.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async ev => {
        try {
          const data = JSON.parse(ev.target.result);
          await loadFusionDataPayload(data);
          $('modalFusion').style.display = 'none';
        } catch (err) {
          showToast('File JSON không hợp lệ!');
        }
      };
      reader.readAsText(file);
    };
  }
}

// Expose on window
if (typeof window !== "undefined") {
  window.stagedIgsParts = stagedIgsParts;
  window.renderIgsPreview = renderIgsPreview;
  window.processIgsFileList = processIgsFileList;
  window.finishProcessing = finishProcessing;
  window.openIgsModal = openIgsModal;
  window.closeIgsModal = closeIgsModal;
  window.openFusionModal = openFusionModal;
  window.closeFusionModal = closeFusionModal;
  window.loadFusionDataPayload = loadFusionDataPayload;
  window.initIgsFusionEvents = initIgsFusionEvents;
}
