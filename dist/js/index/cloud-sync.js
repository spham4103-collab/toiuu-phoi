/**
 * Module: cloud-sync.js - Supabase Realtime Sync & Bootstrapper
 * Đồng bộ đa thiết bị tức thì, thông báo cập nhật & khởi động dữ liệu sau đăng nhập
 */

    function showProjectUpdateNotice(remoteProj) {
      if (!remoteProj || !remoteProj.name) return;
      showToast(`🔔 Dự án "${remoteProj.name}" vừa được cập nhật từ thiết bị khác!`, 6000);
      const banner = $('projectActiveBar');
      if (banner && state.currentProjectId === remoteProj.id) {
        let updateBadge = $('badgeRemoteProjUpdate');
        if (!updateBadge) {
          updateBadge = document.createElement('span');
          updateBadge.id = 'badgeRemoteProjUpdate';
          updateBadge.style.cssText = 'margin-left: 10px; background: #ea580c; color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;';
          updateBadge.innerHTML = '⚡ Có bản cập nhật mới - Bấm để nạp lại';
          updateBadge.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Dự án "${remoteProj.name}" đã được cập nhật từ thiết bị khác. Bạn có muốn nạp lại bản mới nhất không?`)) {
              loadProjectById(remoteProj.id);
              updateBadge.remove();
            }
          };
          banner.appendChild(updateBadge);
        }
      }
    }


    function initCloudSyncSystem() {
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) {
        updateCloudUIState('error', 'Chưa cấu hình Supabase');
        return;
      }
      if (state.realtimeUnsub) return;
      updateCloudUIState('connecting');

      state.realtimeUnsub = window.SupabaseDB.subscribeTables({
        projects: async (ev) => {
          const rec = ev.newRecord;
          const old = ev.oldRecord;
          const isRecentSelfWrite = (Date.now() - (state.lastLocalProjectWriteAt || 0)) < 2500;

          if (ev.eventType === 'DELETE') {
            const delId = old && old.id;
            if (!delId) {
              await initProjectsManager();
              return;
            }
            state.savedProjects = state.savedProjects.filter(p => p.id !== delId);
            state.trashProjects = state.trashProjects.filter(p => p.id !== delId);
            updateProjectsBadge();
            if ($('modalProjects') && $('modalProjects').style.display === 'flex') {
              renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
            }
            return;
          }

          if (!rec || rec.isDraft) return;
          state.savedProjects = state.savedProjects.filter(p => p.id !== rec.id);
          state.trashProjects = state.trashProjects.filter(p => p.id !== rec.id);
          if (rec.isTrashed) {
            state.trashProjects.unshift(rec);
            sortProjectsDesc(state.trashProjects);
          } else {
            state.savedProjects.unshift(rec);
            sortProjectsDesc(state.savedProjects);
          }
          updateProjectsBadge();
          if ($('modalProjects') && $('modalProjects').style.display === 'flex') {
            renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
          }

          // Nếu là bản vẽ mới bắn từ Autodesk Fusion 360 -> nạp thẳng lên bàn xếp phôi
          if (!rec.isTrashed && rec.source === 'fusion360' && !isRecentSelfWrite) {
            state.isApplyingRemoteChange = true;
            try {
              applyProjectPayloadToWorkspace(rec);
              await loadCutProgressForActiveProject();
              showToast(`🚀 Đã tự động nhận bản vẽ "${rec.name}" từ Autodesk Fusion 360!`);
            } finally {
              setTimeout(() => { state.isApplyingRemoteChange = false; }, 120);
            }
            return;
          }

          // Nếu dự án đang mở bị chỉnh sửa từ thiết bị khác -> hiện thông báo không ghi đè mất dữ liệu đang nhập
          if (!rec.isTrashed && rec.id === state.currentProjectId && !isRecentSelfWrite) {
            showProjectUpdateNotice(rec);
          }
        },
        inventory: async () => {
          try {
            const invRows = await window.SupabaseDB.getInventory();
            state.inventoryItems = Array.isArray(invRows) ? invRows : [];
            const names = state.inventoryItems.map(r => r.profileName).filter(Boolean);
            if (names.length) {
              state.savedProfiles = names;
              renderMemoryLibraryChips();
            }
            if (state.result) renderMaterialsGrouped(state.result);
          } catch (e) {}
        },
        cut_progress: async (ev) => {
          const activePid = state.currentProjectId || window.SupabaseDB.DRAFT_PROJECT_ID;
          const rec = ev.newRecord;
          const old = ev.oldRecord;
          const targetPid = (rec && rec.projectId) || (old && old.projectId);
          if (targetPid && targetPid !== activePid) return;

          if (ev.eventType === 'DELETE') {
            if (old && old.barKey) {
              delete state.cutStatuses[old.barKey];
            } else {
              state.cutStatuses = await window.SupabaseDB.getCutProgress(activePid);
            }
          } else if (rec && rec.barKey) {
            if (!state.cutStatuses) state.cutStatuses = {};
            state.cutStatuses[rec.barKey] = {
              cutCount: rec.cutCount,
              totalCount: rec.totalCount,
              status: rec.status,
              patternHash: rec.patternHash || '',
              updatedBy: rec.updatedBy,
              updatedAt: rec.updatedAt
            };
          }
          updateLiveCuttingProgressUI();
          if (state.result) renderPatternsGrouped(state.result);
        },
        stock_offcuts: (ev) => {
          const rec = ev.newRecord;
          const old = ev.oldRecord;
          if (ev.eventType === 'DELETE' && old && old.id) {
            state.stockOffcuts = (state.stockOffcuts || []).filter(o => o.id !== old.id);
          } else if (rec && rec.id) {
            if (Number(rec.quantity) > 0 && (!rec.status || rec.status === 'available')) {
              state.stockOffcuts = [rec, ...(state.stockOffcuts || []).filter(o => o.id !== rec.id)];
            } else {
              state.stockOffcuts = (state.stockOffcuts || []).filter(o => o.id !== rec.id);
            }
          }
          renderOffcutSuggestionBox();
          if (state.result) renderMaterialsGrouped(state.result);
        },
        profiles: async (ev) => {
          if (!state.currentUser) return;
          const rec = ev.newRecord;
          if (rec && rec.id === state.currentUser.id) {
            state.currentUser = Object.assign({}, state.currentUser, rec);
            applyUserRoleUI();
          }
        }
      }, (status) => {
        if (status === 'SUBSCRIBED') {
          state.cloudConnected = true;
          updateCloudUIState('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          state.cloudConnected = false;
          updateCloudUIState('error');
        }
      }, {
        onResync: async () => {
          await Promise.all([
            initProjectsManager(),
            initStockOffcuts(),
            loadCutProgressForActiveProject()
          ]);
          renderOffcutSuggestionBox();
        }
      });
    }

    function updateCloudUIState(status, detailText = '') {
      state.cloudSyncStatus = status;
      const dot = $('cloudStatusDot');
      const text = $('cloudStatusText');
      if (!dot || !text) return;

      dot.className = 'cloud-status-dot';
      if (status === 'connected') {
        dot.classList.add('dot-green');
        text.textContent = detailText || 'Supabase Realtime';
      } else if (status === 'connecting' || status === 'syncing') {
        dot.classList.add('dot-orange');
        text.textContent = detailText || 'Đang kết nối Supabase...';
      } else {
        dot.classList.add('dot-red');
        text.textContent = detailText || 'Mất kết nối Supabase';
      }
    }

    async function bootstrapWorkspaceAfterAuth() {
      if (state.hasBootstrappedWorkspace || !state.currentUser) return;
      state.hasBootstrappedWorkspace = true;

      let draftProject = null;
      if (window.SupabaseDB) window.SupabaseDB.setLoading(true, 'Đang tải dữ liệu xưởng từ Supabase...');
      try {
        const results = await Promise.all([
          initSavedProfiles(),
          initProjectsManager(),
          initStockOffcuts()
        ]);
        draftProject = results[1];
        renderMemoryLibraryChips();
        renderOffcutSuggestionBox();
      } catch (err) {
        console.error('Lỗi khởi động dữ liệu Supabase:', err);
        if (window.SupabaseDB) window.SupabaseDB.showConnectionError('❌ Không thể tải dữ liệu ban đầu từ Supabase: ' + err.message);
      } finally {
        if (window.SupabaseDB) window.SupabaseDB.setLoading(false);
      }

      initCloudSyncSystem();

      const urlParams = new URLSearchParams(window.location.search);
      const paramProjId = urlParams.get('project');
      const paramOpen = urlParams.get('open');

      const embScript = $('embeddedFusionData');
      let loadedFromEmbedded = false;
      if (embScript && embScript.textContent.trim()) {
        try {
          const safeJson = embScript.textContent.trim().replace(/\\(?![/u"\\bfnrt])/g, '/');
          const embData = JSON.parse(safeJson);
          if (embData && (embData.parts || Array.isArray(embData))) {
            await loadFusionDataPayload(embData);
            loadedFromEmbedded = true;
          }
        } catch (e) {
          console.warn('Lỗi đọc embeddedFusionData:', e);
        }
      }

      if (!loadedFromEmbedded) {
        const loaded = await loadActiveProject(paramProjId, draftProject);
        if (!loaded) {
          const offlineOrErr = Boolean(state.initialSupabaseLoadFailed || !navigator.onLine);
          loadMultiProfilePreset({ skipSave: offlineOrErr });
          if (offlineOrErr) {
            showToast('📡 Mất kết nối Supabase: đang hiển thị tạm bản vẽ mẫu (không ghi đè dữ liệu trên máy chủ).', 5500);
          }
        }
      }

      if (!loadedFromEmbedded && urlParams.get('src') === 'fusion' && !paramProjId) {
        fetch('fusion_exported_project.json')
          .then(res => res.json())
          .then(data => loadFusionDataPayload(data))
          .catch(() => $('modalFusion') && ($('modalFusion').style.display = 'flex'));
      }

      if (paramOpen === 'igs' && $('btnOpenIgs')) {
        $('btnOpenIgs').click();
      } else if (paramOpen === 'fusion' && $('modalFusion')) {
        $('modalFusion').style.display = 'flex';
      } else if (paramOpen === 'paste' && $('modalPaste')) {
        $('modalPaste').style.display = 'flex';
        if ($('txtPaste')) $('txtPaste').focus();
      }
    }


// Expose on window
if (typeof window !== "undefined") {
  window.showProjectUpdateNotice = showProjectUpdateNotice;
  window.initCloudSyncSystem = initCloudSyncSystem;
  window.updateCloudUIState = updateCloudUIState;
  window.bootstrapWorkspaceAfterAuth = bootstrapWorkspaceAfterAuth;
}
