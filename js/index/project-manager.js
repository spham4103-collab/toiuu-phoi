/**
 * Module: project-manager.js - Project Persistence & State Management
 * Quản lý lưu/nạp dự án, khóa bảo vệ, đếm số lượng, snapshot dữ liệu
 */

    // ==========================================
    // Project Persistence & Management (Supabase Single Source of Truth)
    // ==========================================
    function buildActiveDataSnapshot() {
      const cleanSnap = {
        currentProjectId: state.currentProjectId,
        currentProjectName: state.currentProjectName,
        currentProjectCustomer: state.currentProjectCustomer,
        currentProjectNotes: state.currentProjectNotes,
        activeProfiles: [...state.activeProfiles],
        selectedTabProfile: state.selectedTabProfile,
        parts: JSON.parse(JSON.stringify(state.parts)),
        stock: JSON.parse(JSON.stringify(state.stock)),
        method: state.method,
        kerf: state.kerf,
        clamp: state.clamp,
        interlock: state.interlock,
        gap: state.gap,
        useWarehouseOffcuts: Boolean(state.useWarehouseOffcuts),
        offcutsDeducted: Boolean(state.offcutsDeducted),
        offcutsDeductedAt: state.offcutsDeductedAt || null,
        inventoryDeductedAt: state.inventoryDeductedAt || null,
        inventoryDeductedBy: state.inventoryDeductedBy || '',
        inventoryDeductedSnapshot: state.inventoryDeductedSnapshot || null,
        fusionProject: state.fusionProject || null,
        isBlankReset: !!state.isBlankReset
      };
      return window.SupabaseDB ? window.SupabaseDB.stripHeavyIgs(cleanSnap) : cleanSnap;
    }

    function saveActiveProject() {
      if (state.isApplyingRemoteChange || !window.SupabaseDB || !window.SupabaseDB.isConfigured()) return;
      if (!state.currentProjectId && state.initialSupabaseLoadFailed) return;
      if (state.currentProjectId) {
        const curProjCheck = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
        if (curProjCheck && curProjCheck.isLocked) return;
      }
      state.hasPendingActiveSave = true;
      clearTimeout(state.activeSaveTimer);
      state.activeSaveTimer = setTimeout(async () => {
        if (state.isApplyingRemoteChange) return;
        const snap = buildActiveDataSnapshot();
        state.lastLocalProjectWriteAt = Date.now();
        try {
          if (state.currentProjectId) {
            const curProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
            if (curProj && curProj.isLocked) {
              state.hasPendingActiveSave = false;
              return;
            }
            const updated = await window.SupabaseDB.updateProjectFields(state.currentProjectId, { data: snap });
            if (curProj && updated) Object.assign(curProj, updated);
          } else {
            await window.SupabaseDB.saveDraftProject(snap);
          }
          state.hasPendingActiveSave = false;
        } catch (err) {
          console.warn('Lỗi tự động lưu lên Supabase:', err);
        }
      }, 800);
    }

    function flushPendingActiveSave() {
      if (!state.hasPendingActiveSave || state.isApplyingRemoteChange) return;
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) return;
      if (!state.currentProjectId && state.initialSupabaseLoadFailed) return;
      if (state.currentProjectId) {
        const curProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
        if (curProj && curProj.isLocked) {
          state.hasPendingActiveSave = false;
          return;
        }
      }
      clearTimeout(state.activeSaveTimer);
      state.hasPendingActiveSave = false;
      state.lastLocalProjectWriteAt = Date.now();
      const snap = buildActiveDataSnapshot();
      window.SupabaseDB.saveProjectKeepalive(
        state.currentProjectId || window.SupabaseDB.DRAFT_PROJECT_ID,
        snap,
        !state.currentProjectId
      );
    }

    window.addEventListener('pagehide', flushPendingActiveSave);
    window.addEventListener('beforeunload', flushPendingActiveSave);

    function applyProjectPayloadToWorkspace(proj) {
      if (!proj) return false;
      const d = proj.data || proj;
      if (!d || !Array.isArray(d.parts)) return false;

      state.currentProjectId = (proj.id && !proj.isDraft && proj.id !== '__draft__') ? proj.id : null;
      state.currentProjectName = proj.name || d.currentProjectName || '';
      state.currentProjectCustomer = proj.customer || d.currentProjectCustomer || '';
      state.currentProjectNotes = proj.notes || d.currentProjectNotes || '';
      state.fusionProject = d.fusionProject || null;
      state.isBlankReset = !!d.isBlankReset;

      state.activeProfiles = (Array.isArray(d.activeProfiles) && d.activeProfiles.length) ? d.activeProfiles.slice() : ['Hộp 30x30x1.8'];
      state.selectedTabProfile = d.selectedTabProfile || state.activeProfiles[0];
      state.parts = Array.isArray(d.parts) ? JSON.parse(JSON.stringify(d.parts)) : [];
      state.stock = Array.isArray(d.stock) ? JSON.parse(JSON.stringify(d.stock)) : [];
      state.method = d.method || 'cnc';
      state.kerf = d.kerf != null ? d.kerf : 0;
      state.clamp = d.clamp != null ? d.clamp : 80;
      state.interlock = d.interlock != null ? d.interlock : true;
      state.gap = d.gap != null ? d.gap : 0;
      state.useWarehouseOffcuts = Boolean(d.useWarehouseOffcuts);
      state.offcutsDeducted = Boolean(d.offcutsDeducted);
      state.offcutsDeductedAt = d.offcutsDeductedAt || null;
      state.inventoryDeductedAt = proj.inventoryDeductedAt || d.inventoryDeductedAt || null;
      state.inventoryDeductedBy = d.inventoryDeductedBy || '';
      state.inventoryDeductedSnapshot = d.inventoryDeductedSnapshot || null;

      if (state.currentProjectId) {
        try { localStorage.setItem(LS_CURRENT_PROJ_ID, state.currentProjectId); } catch (e) {}
      }

      updateInputsFromState();
      ensureProfilesConsistency();
      renderProfileTabs();
      renderActiveProfileBanner();
      renderPartsList();
      renderStockList();
      calculateOptimization(false);
      updateProjectActiveBanner();
      updateProjectsBadge();
      return true;
    }

    async function loadActiveProject(urlProjId = null, draftProject = null) {
      let chosen = null;

      // 1. Ưu tiên ID từ query URL (?project=...)
      if (urlProjId) {
        chosen = (state.savedProjects || []).find(p => p.id === urlProjId) || null;
        if (!chosen && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
          try { chosen = await window.SupabaseDB.getProjectById(urlProjId); } catch (e) {}
        }
      }

      // 2. Dự án đã mở lần trước trên thiết bị này
      if (!chosen) {
        let curId = null;
        try { curId = localStorage.getItem(LS_CURRENT_PROJ_ID); } catch (e) {}
        if (curId) {
          chosen = (state.savedProjects || []).find(p => p.id === curId) || null;
        }
      }

      // 3. Dự án có chi tiết mới nhất trên Supabase
      if (!chosen) {
        chosen = (state.savedProjects || []).find(p => p.data && Array.isArray(p.data.parts) && p.data.parts.length > 0) || null;
      }

      // 4. Bản nháp chung (__draft__)
      if (!chosen && draftProject && draftProject.data && Array.isArray(draftProject.data.parts) && (draftProject.data.parts.length > 0 || draftProject.data.isBlankReset)) {
        chosen = draftProject;
      }

      if (chosen && chosen.isSummary && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        try {
          const fullChosen = await window.SupabaseDB.getProjectById(chosen.id);
          if (fullChosen) chosen = fullChosen;
        } catch (err) {
          state.initialSupabaseLoadFailed = true;
          console.warn('Không tải được chi tiết dự án từ Supabase:', err);
          return false;
        }
      }

      if (chosen && applyProjectPayloadToWorkspace(chosen)) {
        await loadCutProgressForActiveProject();
        return true;
      }
      return false;
    }

    async function loadCutProgressForActiveProject() {
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) {
        state.cutStatuses = {};
        return;
      }
      const pid = state.currentProjectId || window.SupabaseDB.DRAFT_PROJECT_ID;
      try {
        state.cutStatuses = await window.SupabaseDB.getCutProgress(pid);
        updateLiveCuttingProgressUI();
        if (state.result) renderPatternsGrouped(state.result);
      } catch (err) {
        console.warn('Lỗi tải tiến độ cắt:', err);
      }
    }

    // Khởi tạo hệ thống quản lý danh sách dự án từ Supabase
    async function initProjectsManager() {
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) {
        state.savedProjects = [];
        state.trashProjects = [];
        updateProjectsBadge();
        updateProjectActiveBanner();
        return null;
      }
      try {
        const allRows = await window.SupabaseDB.getProjectsSummary({ includeTrash: true, includeDraft: true });
        state.initialSupabaseLoadFailed = false;
        state.savedProjects = allRows.filter(p => !p.isTrashed && !p.isDraft);
        state.trashProjects = allRows.filter(p => p.isTrashed && !p.isDraft);
        const draftProject = allRows.find(p => p.isDraft || p.id === window.SupabaseDB.DRAFT_PROJECT_ID) || null;
        updateProjectsBadge();
        updateProjectActiveBanner();
        return draftProject;
      } catch (err) {
        state.initialSupabaseLoadFailed = true;
        console.error('Lỗi tải danh sách dự án từ Supabase:', err);
        window.SupabaseDB.showConnectionError('❌ Mất kết nối Supabase khi tải dự án: ' + err.message);
        return null;
      }
    }

    function updateProjectsBadge() {
      const countActive = Array.isArray(state.savedProjects) ? state.savedProjects.length : 0;
      const countTrash = Array.isArray(state.trashProjects) ? state.trashProjects.length : 0;
      const b1 = $('badgeProjectCount');
      const cntA = $('countActiveProjects');
      const cntT = $('countTrashProjects');
      if (b1) b1.textContent = countActive;
      if (cntA) cntA.textContent = countActive;
      if (cntT) cntT.textContent = countTrash;
    }

    function updateProjectActiveBanner() {
      const bar = $('projectActiveBar');
      const nameDisp = $('dispCurrentProjName');
      const custDisp = $('dispCurrentProjCustomer');
      const btnSave = $('btnBannerSave');
      const btnLock = $('btnBannerToggleLock');
      const lockIcon = $('bannerLockIcon');
      const lockText = $('bannerLockText');
      if (!bar || !nameDisp) return;

      const currentProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
      const isLocked = Boolean(currentProj && currentProj.isLocked);

      if (state.currentProjectId && state.currentProjectName) {
        nameDisp.textContent = state.currentProjectName;
        custDisp.textContent = state.currentProjectCustomer ? `• Khách hàng: ${state.currentProjectCustomer}` : '';
        if (btnSave) {
          btnSave.innerHTML = `<svg viewBox="0 0 24 24" style="width:13px; height:13px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Lưu cập nhật`;
          btnSave.title = `Lưu đè các số liệu mới nhất vào dự án "${state.currentProjectName}"`;
        }
      } else {
        nameDisp.textContent = 'Dự án nháp (Chưa lưu)';
        custDisp.textContent = '• Bấm "Lưu dự án" để đặt tên và lưu vào danh mục quản lý';
        if (btnSave) {
          btnSave.innerHTML = `<svg viewBox="0 0 24 24" style="width:13px; height:13px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Lưu dự án`;
          btnSave.title = 'Lưu dữ liệu hiện tại thành một dự án mới';
        }
      }

      if (btnLock) {
        if (!state.currentProjectId) {
          btnLock.style.display = 'none';
        } else {
          btnLock.style.display = 'inline-flex';
          if (isLocked) {
            if (lockIcon) lockIcon.textContent = '🔒';
            if (lockText) lockText.textContent = 'ĐÃ KHÓA SẢN XUẤT';
            btnLock.style.background = '#FEF3C7';
            btnLock.style.color = '#B45309';
            btnLock.style.borderColor = '#FCD34D';
            btnLock.title = 'Dự án đang KHÓA BẢO VỆ SẢN XUẤT. Bấm để MỞ KHÓA nếu cần chỉnh sửa!';
            bar.style.background = '#FFFBEB';
            bar.style.borderColor = '#FCD34D';
          } else {
            if (lockIcon) lockIcon.textContent = '🔓';
            if (lockText) lockText.textContent = 'Khóa bảo vệ';
            btnLock.style.background = '';
            btnLock.style.color = '';
            btnLock.style.borderColor = '';
            btnLock.title = 'Khóa dự án chống xóa nhầm hoặc sửa nhầm số liệu';
            bar.style.background = '#F0FDF4';
            bar.style.borderColor = '#BBF7D0';
          }
        }
      }
    }



    async function toggleProjectLock(projId) {
      const p = (state.savedProjects || []).find(x => x.id === projId);
      if (!p) return;
      const nextLocked = !p.isLocked;
      state.lastLocalProjectWriteAt = Date.now();

      if (nextLocked) {
        let targetProj = p;
        if (targetProj.isSummary && targetProj.id !== state.currentProjectId && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
          try {
            const fullP = await window.SupabaseDB.getProjectById(projId);
            if (fullP) { Object.assign(targetProj, fullP); }
          } catch (e) {}
        }
        const alreadyDispatched = (projId === state.currentProjectId && Boolean(state.inventoryDeductedAt))
          || Boolean(targetProj.inventoryDeductedAt || (targetProj.data && targetProj.data.inventoryDeductedAt));

        if (!alreadyDispatched) {
          const plan = computeDispatchNeedsForAnyProject(targetProj);
          const invByProf = {};
          (state.inventoryItems || []).forEach(r => { invByProf[r.profileName] = r; });
          const totalDeductibleFull = plan.fullBarsByProfile.reduce((sum, req) => {
            const avail = invByProf[req.profile] ? Math.max(0, Number(invByProf[req.profile].stockQty) || 0) : 0;
            return sum + Math.min(req.qty, avail);
          }, 0);

          if (totalDeductibleFull > 0 || plan.offcutCount > 0) {
            const wantDispatch = confirm(
              `📦 CHỐT KHÓA SẢN XUẤT "${targetProj.name}":\n\n` +
              (plan.fullSummaryLines.length ? plan.fullSummaryLines.join('\n') + '\n' : '') +
              (plan.offcutCount > 0 ? `• Phôi lẻ/đề-xê kho: dùng ${plan.offcutCount} đoạn\n` : '') +
              `\n• Bấm [OK] để XUẤT KHO & KHÓA BẢO VỆ DỰ ÁN (chống trừ trùng).\n` +
              `• Bấm [Cancel] để giữ nguyên kho (chỉ Khóa bảo vệ dự án).`
            );
            if (wantDispatch) {
              window.SupabaseDB.setLoading(true, 'Đang xuất kho trước khi khóa dự án...');
              try {
                const actor = state.currentUser ? state.currentUser.username : '';
                const dispRes = await window.SupabaseDB.dispatchProjectInventory({
                  projectId: projId,
                  projectName: targetProj.name || projId,
                  projectDeductedAt: null,
                  fullBarsByProfile: plan.fullBarsByProfile,
                  offcutsUsed: plan.offcutsUsed,
                  createdBy: actor
                });
                const snapObj = { fullBars: dispRes.fullBars, offcuts: dispRes.offcuts };
                if (projId === state.currentProjectId) {
                  state.inventoryDeductedAt = dispRes.deductedAt;
                  state.inventoryDeductedBy = actor;
                  state.inventoryDeductedSnapshot = snapObj;
                  if (dispRes.totalOffcutsDeducted > 0) {
                    state.offcutsDeducted = true;
                    state.offcutsDeductedAt = dispRes.deductedAt;
                  }
                  const snap = buildActiveDataSnapshot();
                  const updatedData = await window.SupabaseDB.updateProjectFields(projId, {
                    data: snap,
                    inventoryDeductedAt: dispRes.deductedAt
                  });
                  Object.assign(p, updatedData);
                } else {
                  const nextData = Object.assign({}, targetProj.data || {}, {
                    inventoryDeductedAt: dispRes.deductedAt,
                    inventoryDeductedBy: actor,
                    inventoryDeductedSnapshot: snapObj,
                    offcutsDeducted: dispRes.totalOffcutsDeducted > 0 ? true : Boolean(targetProj.data && targetProj.data.offcutsDeducted),
                    offcutsDeductedAt: dispRes.totalOffcutsDeducted > 0 ? dispRes.deductedAt : (targetProj.data && targetProj.data.offcutsDeductedAt) || null
                  });
                  const updatedData = await window.SupabaseDB.updateProjectFields(projId, {
                    data: nextData,
                    inventoryDeductedAt: dispRes.deductedAt
                  });
                  Object.assign(p, updatedData);
                }
                await Promise.all([initSavedProfiles(), initStockOffcuts()]);
                renderOffcutSuggestionBox();
                if (state.result) renderMaterialsGrouped(state.result);
                showToast(`📤 Đã xuất kho: -${dispRes.totalFullDeducted} cây nguyên${dispRes.totalOffcutsDeducted > 0 ? `, -${dispRes.totalOffcutsDeducted} đoạn lẻ` : ''}!`);
              } catch (err) {
                showToast('⚠️ Chưa xuất được kho: ' + err.message);
              } finally {
                window.SupabaseDB.setLoading(false);
              }
            }
          }
        }
      }

      window.SupabaseDB.setLoading(true, 'Đang cập nhật khóa dự án...');
      try {
        const updated = await window.SupabaseDB.updateProjectFields(projId, { isLocked: nextLocked });
        Object.assign(p, updated);
        if (state.currentProjectId === projId) {
          updateProjectActiveBanner();
          renderOffcutSuggestionBox();
        }
        renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
        if (p.isLocked) {
          showToast(`🔒 Đã KHÓA BẢO VỆ dự án "${p.name}"! Chống xóa và sửa nhầm.`);
        } else {
          showToast(`🔓 Đã MỞ KHÓA dự án "${p.name}".`);
        }
      } catch (err) {
        showToast('❌ Lỗi cập nhật khóa dự án: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    function toggleActiveProjectLock() {
      if (!state.currentProjectId) {
        showToast('Chưa mở dự án nào để khóa! Hãy lưu dự án trước.');
        return;
      }
      toggleProjectLock(state.currentProjectId);
    }


    async function quickSaveActiveProject() {
      if (!state.currentProjectId) {
        openSaveProjectModal();
        return;
      }
      const targetProj = state.savedProjects.find(p => p.id === state.currentProjectId);
      if (!targetProj) {
        openSaveProjectModal();
        return;
      }
      if (targetProj.isLocked) {
        alert(`🔒 DỰ ÁN "${targetProj.name}" ĐANG ĐƯỢC KHÓA BẢO VỆ!\n\nKhông thể ghi đè số liệu khi dự án đang khóa sản xuất.\nVui lòng bấm "🔓 Mở khóa" hoặc dùng "Lưu -> Lưu thành dự án mới".`);
        return;
      }
      state.isBlankReset = false;
      state.hasPendingActiveSave = false;
      state.lastLocalProjectWriteAt = Date.now();
      clearTimeout(state.activeSaveTimer);
      const snap = buildActiveDataSnapshot();

      window.SupabaseDB.setLoading(true, 'Đang lưu cập nhật lên Supabase...');
      try {
        const saved = await window.SupabaseDB.updateProjectFields(targetProj.id, { data: snap });
        Object.assign(targetProj, saved);
        updateProjectsBadge();
        showToast(`✓ Đã lưu cập nhật "${targetProj.name}" lên Supabase!`);
      } catch (err) {
        showToast('❌ Lỗi lưu dự án: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function confirmSaveProjectForm(forceNew = false) {
      const name = $('inpSaveProjName').value.trim();
      if (!name) {
        showToast('Vui lòng nhập tên dự án!');
        $('inpSaveProjName').focus();
        return;
      }
      const customer = $('inpSaveProjCustomer').value.trim();
      const notes = $('inpSaveProjNotes').value.trim();
      const nowStr = new Date().toISOString();
      state.isBlankReset = false;
      state.hasPendingActiveSave = false;
      state.lastLocalProjectWriteAt = Date.now();
      clearTimeout(state.activeSaveTimer);

      window.SupabaseDB.setLoading(true, 'Đang lưu dự án lên Supabase...');
      try {
        if (state.editingProjectId) {
          const target = state.savedProjects.find(p => p.id === state.editingProjectId);
          if (target && target.isLocked) {
            alert(`🔒 Dự án "${target.name}" đang được KHÓA BẢO VỆ! Vui lòng mở khóa trước khi chỉnh sửa.`);
            return;
          }
          const updated = await window.SupabaseDB.updateProjectFields(state.editingProjectId, { name, customer, notes });
          if (target) Object.assign(target, updated);
          if (state.currentProjectId === state.editingProjectId) {
            state.currentProjectName = name;
            state.currentProjectCustomer = customer;
            state.currentProjectNotes = notes;
            updateProjectActiveBanner();
          }
          showToast(`✓ Đã cập nhật dự án "${name}"!`);
        } else {
          const projectDataPayload = buildActiveDataSnapshot();
          let targetProj = (!forceNew && state.currentProjectId)
            ? state.savedProjects.find(p => p.id === state.currentProjectId)
            : null;

          // Nếu đặt tên khác dự án đang mở -> Tự động tạo thành dự án mới
          if (targetProj && String(targetProj.name || '').trim().toLowerCase() !== name.toLowerCase()) {
            targetProj = null;
          }

          if (targetProj && targetProj.isLocked) {
            alert(`🔒 DỰ ÁN "${targetProj.name}" ĐANG ĐƯỢC KHÓA BẢO VỆ!\n\nKhông thể ghi đè trực tiếp. Hãy đổi tên khác hoặc bấm "Lưu thành dự án mới".`);
            return;
          }

          if (targetProj) {
            const saved = await window.SupabaseDB.saveProject({
              ...targetProj,
              name, customer, notes,
              isDraft: false, isTrashed: false,
              updatedAt: nowStr,
              data: projectDataPayload
            });
            Object.assign(targetProj, saved);
            showToast(`✓ Đã lưu cập nhật dự án "${name}"! (Tổng: ${state.savedProjects.length} dự án)`);
          } else {
            const newId = makeId('proj');
            const newCopyData = Object.assign({}, projectDataPayload, {
              inventoryDeductedAt: null,
              inventoryDeductedBy: '',
              inventoryDeductedSnapshot: null
            });
            const saved = await window.SupabaseDB.saveProject({
              id: newId,
              name, customer, notes,
              isLocked: false, isTrashed: false, isDraft: false, source: 'web',
              createdAt: nowStr, updatedAt: nowStr,
              data: newCopyData,
              igsFiles: []
            });
            state.savedProjects.unshift(saved);
            state.currentProjectId = saved.id;
            state.inventoryDeductedAt = null;
            state.inventoryDeductedBy = '';
            state.inventoryDeductedSnapshot = null;
            try { localStorage.setItem(LS_CURRENT_PROJ_ID, saved.id); } catch (e) {}
            showToast(`✓ Đã thêm dự án mới "${name}"! (Tổng: ${state.savedProjects.length} dự án)`);
          }

          state.currentProjectName = name;
          state.currentProjectCustomer = customer;
          state.currentProjectNotes = notes;
          updateProjectActiveBanner();
        }

        updateProjectsBadge();
        closeSaveProjectModal();
        if ($('modalProjects').style.display === 'flex') {
          renderProjectsList($('inpSearchProjects').value.trim());
        }
      } catch (err) {
        showToast('❌ Lỗi lưu dự án lên Supabase: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function loadProjectById(projId) {
      let proj = state.savedProjects.find(p => p.id === projId);
      if ((!proj || proj.isSummary || !proj.data || !Array.isArray(proj.data.stock)) && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        try {
          const fullProj = await window.SupabaseDB.getProjectById(projId);
          if (fullProj) {
            proj = fullProj;
            const idx = state.savedProjects.findIndex(p => p.id === projId);
            if (idx >= 0) state.savedProjects[idx] = fullProj;
          }
        } catch (e) {}
      }
      if (!proj || !proj.data) {
        showToast('Không tìm thấy dữ liệu dự án!');
        return;
      }

      const d = proj.data;
      state.currentProjectId = proj.id;
      state.currentProjectName = proj.name;
      state.currentProjectCustomer = proj.customer || '';
      state.currentProjectNotes = proj.notes || '';
      state.fusionProject = d.fusionProject || null;
      state.isBlankReset = false;

      state.activeProfiles = (d.activeProfiles && d.activeProfiles.length) ? d.activeProfiles.slice() : ['Hộp 30x30x1.8'];
      state.selectedTabProfile = d.selectedTabProfile || state.activeProfiles[0];
      state.parts = Array.isArray(d.parts) ? JSON.parse(JSON.stringify(d.parts)) : [];
      state.stock = Array.isArray(d.stock) ? JSON.parse(JSON.stringify(d.stock)) : [];
      state.method = d.method || 'cnc';
      state.kerf = d.kerf != null ? d.kerf : 0;
      state.clamp = d.clamp != null ? d.clamp : 80;
      state.interlock = d.interlock != null ? d.interlock : true;
      state.gap = d.gap != null ? d.gap : 0;
      state.useWarehouseOffcuts = Boolean(d.useWarehouseOffcuts);
      state.offcutsDeducted = Boolean(d.offcutsDeducted);
      state.offcutsDeductedAt = d.offcutsDeductedAt || null;
      state.inventoryDeductedAt = proj.inventoryDeductedAt || d.inventoryDeductedAt || null;
      state.inventoryDeductedBy = d.inventoryDeductedBy || '';
      state.inventoryDeductedSnapshot = d.inventoryDeductedSnapshot || null;

      // Đảm bảo các loại hộp của dự án xuất hiện trong bộ nhớ mẫu
      let addedToMemory = false;
      state.activeProfiles.forEach(prof => {
        if (!state.savedProfiles.includes(prof)) {
          state.savedProfiles.push(prof);
          addedToMemory = true;
        }
      });
      if (addedToMemory) {
        saveProfilesLibrary();
        renderMemoryLibraryChips();
      }

      try { localStorage.setItem(LS_CURRENT_PROJ_ID, proj.id); } catch (e) {}

      updateInputsFromState();
      ensureProfilesConsistency();
      renderProfileTabs();
      renderActiveProfileBanner();
      renderPartsList();
      renderStockList();
      calculateOptimization(false);
      updateProjectActiveBanner();
      await loadCutProgressForActiveProject();

      closeProjectsManagerModal();
      showToast(`✓ Đã mở dự án "${proj.name}"!`);
    }


    async function resetToBlankNewProject(openSaveModalAfter = false) {
      if (state.userRole === 'operator') {
        alert('🔒 CHẾ ĐỘ THỢ CNC (KHÓA AN TOÀN):\n\nBạn không có quyền tạo mới hoặc xóa trắng bản vẽ!\nVui lòng liên hệ Kỹ sư thiết kế để mở khóa.');
        return;
      }
      clearTimeout(state.activeSaveTimer);
      state.hasPendingActiveSave = false;
      state.lastLocalProjectWriteAt = Date.now();
      state.isBlankReset = true;
      state.currentProjectId = null;
      state.currentProjectName = '';
      state.currentProjectCustomer = '';
      state.currentProjectNotes = '';
      state.fusionProject = null;
      state.result = null;
      state.cutStatuses = {};
      state.useWarehouseOffcuts = false;
      state.offcutsDeducted = false;
      state.offcutsDeductedAt = null;
      state.inventoryDeductedAt = null;
      state.inventoryDeductedBy = '';
      state.inventoryDeductedSnapshot = null;
      try { localStorage.removeItem(LS_CURRENT_PROJ_ID); } catch (e) {}

      state.activeProfiles = ['Hộp 30x30x1.8'];
      state.selectedTabProfile = 'Hộp 30x30x1.8';
      state.parts = [];
      state.stock = [
        { id: makeId('s'), name: 'Cây mới 6.000 (Hộp 30x30x1.8)', profile: 'Hộp 30x30x1.8', length: 6000, qty: null, clamp: state.clamp }
      ];
      renderProfileTabs();
      renderActiveProfileBanner();
      renderPartsList();
      renderStockList();
      calculateOptimization(false);
      updateProjectActiveBanner();
      updateProjectsBadge();
      if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        window.SupabaseDB.saveDraftProject(buildActiveDataSnapshot()).catch(() => {});
      }
      closeProjectsManagerModal();

      if (openSaveModalAfter) {
        openSaveProjectModal();
      } else {
        showToast('✓ Đã tạo bản vẽ mới hoàn toàn (Dự án nháp mới)!');
      }
    }

    function createNewBlankProject() {
      if (state.currentProjectId) {
        const curProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
        if (curProj && curProj.isLocked) {
          if (!confirm(`⚠️ Dự án "${curProj.name}" đang được KHÓA BẢO VỆ.\n\nBạn có muốn đóng dự án này để tạo dự án mới không?\n(Dự án đã khóa vẫn được bảo lưu an toàn trong danh mục).`)) return;
        }
      }
      if (state.parts.length > 0) {
        if (!confirm('Tạo một dự án mới hoàn toàn?\n\nDữ liệu chưa lưu của màn hình hiện tại sẽ được làm mới (Các dự án đã lưu trong danh sách vẫn giữ nguyên).')) return;
      }
      resetToBlankNewProject(true);
    }


    function sortProjectsDesc(list) {
      return list.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    }


// Expose on window
if (typeof window !== "undefined") {
  window.buildActiveDataSnapshot = buildActiveDataSnapshot;
  window.saveActiveProject = saveActiveProject;
  window.flushPendingActiveSave = flushPendingActiveSave;
  window.applyProjectPayloadToWorkspace = applyProjectPayloadToWorkspace;
  window.loadActiveProject = loadActiveProject;
  window.loadCutProgressForActiveProject = loadCutProgressForActiveProject;
  window.initProjectsManager = initProjectsManager;
  window.updateProjectsBadge = updateProjectsBadge;
  window.updateProjectActiveBanner = updateProjectActiveBanner;
  window.toggleProjectLock = toggleProjectLock;
  window.toggleActiveProjectLock = toggleActiveProjectLock;
  window.loadProjectById = loadProjectById;
  window.quickSaveActiveProject = quickSaveActiveProject;
  window.confirmSaveProjectForm = confirmSaveProjectForm;
  window.createNewBlankProject = createNewBlankProject;
  window.resetToBlankNewProject = resetToBlankNewProject;
  window.sortProjectsDesc = sortProjectsDesc;
}
