/**
 * Module: project-modals.js - Project Dialogs & Backup Export/Import
 * Hộp thoại Danh sách dự án, Thùng rác, Sao lưu JSON & Phục hồi
 */

    function switchProjectsTab(tabName) {
      state.activeProjectsTab = tabName;
      const btnActive = $('btnTabActiveProjects');
      const btnTrash = $('btnTabTrashProjects');
      if (tabName === 'active') {
        if (btnActive) { btnActive.className = 'btn btn-sm btn-p btn-tab-proj'; btnActive.style.background = ''; btnActive.style.borderColor = ''; btnActive.style.color = ''; }
        if (btnTrash) { btnTrash.className = 'btn btn-sm btn-soft btn-tab-proj'; btnTrash.style.background = ''; btnTrash.style.borderColor = ''; btnTrash.style.color = '#DC2626'; }
      } else {
        if (btnActive) { btnActive.className = 'btn btn-sm btn-soft btn-tab-proj'; }
        if (btnTrash) { btnTrash.className = 'btn btn-sm btn-p btn-tab-proj'; btnTrash.style.background = '#DC2626'; btnTrash.style.borderColor = '#DC2626'; btnTrash.style.color = '#FFF'; }
      }
      renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
    }

    function openProjectsManagerModal() {
      const modal = $('modalProjects');
      if (!modal) return;
      $('inpSearchProjects').value = '';
      switchProjectsTab('active');
      modal.style.display = 'flex';
    }

    function closeProjectsManagerModal() {
      const modal = $('modalProjects');
      if (modal) modal.style.display = 'none';
    }

    function renderProjectsList(filterText = '') {
      const wrap = $('projectsListWrap');
      if (!wrap) return;

      const q = String(filterText || '').toLowerCase().trim();
      const isTrashTab = state.activeProjectsTab === 'trash';
      const sourceList = isTrashTab ? (state.trashProjects || []) : (state.savedProjects || []);

      const filtered = sourceList.filter(p => {
        if (!q) return true;
        const name = String(p.name || '').toLowerCase();
        const cust = String(p.customer || '').toLowerCase();
        const note = String(p.notes || '').toLowerCase();
        return name.includes(q) || cust.includes(q) || note.includes(q);
      });

      if (!filtered.length) {
        if (isTrashTab) {
          wrap.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:#64748B;">
              <svg style="width:48px; height:48px; stroke:#CBD5E1; fill:none; stroke-width:1.5; margin-bottom:12px;" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <div style="font-size:15px; font-weight:600; color:#475569; margin-bottom:6px;">
                ${q ? 'Không tìm thấy dự án trong thùng rác!' : 'Thùng rác trống'}
              </div>
              <div style="font-size:13px; max-width:400px; margin:0 auto;">
                Chưa có dự án nào bị xóa gần đây. Các dự án xóa trong danh mục sẽ được giữ tạm an toàn ở đây để bạn có thể khôi phục lại bất kỳ lúc nào.
              </div>
            </div>
          `;
        } else {
          wrap.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:#64748B;">
              <svg style="width:48px; height:48px; stroke:#CBD5E1; fill:none; stroke-width:1.5; margin-bottom:12px;" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <div style="font-size:15px; font-weight:600; color:#475569; margin-bottom:6px;">
                ${q ? 'Không tìm thấy dự án phù hợp với từ khóa!' : 'Chưa có dự án nào được lưu trong bộ nhớ'}
              </div>
              <div style="font-size:13px; max-width:400px; margin:0 auto 16px;">
                ${q ? 'Hãy thử tìm bằng tên dự án, khách hàng hoặc từ khóa khác.' : 'Bấm nút "Lưu dự án hiện tại" bên trên hoặc nạp dữ liệu từ file .json / Fusion 360 để quản lý.'}
              </div>
            </div>
          `;
        }
        return;
      }

      if (isTrashTab) {
        // Tab Thùng rác
        const trashHeader = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px 14px; background:#FEF2F2; border-radius:8px; border:1px solid #FECACA;">
            <div style="font-size:13px; color:#991B1B; font-weight:600;">
              🗑️ Thùng rác chứa <strong>${filtered.length}</strong> dự án (Có thể khôi phục lại bất cứ lúc nào)
            </div>
            <button class="btn btn-sm btn-soft" id="btnEmptyTrashAll" style="color:#DC2626; border-color:#FCA5A5; font-weight:700;">
              🧹 Xóa sạch thùng rác
            </button>
          </div>
        `;

        const cardsHtml = filtered.map(p => {
          const partCount = p.data && Array.isArray(p.data.parts) ? p.data.parts.reduce((a, b) => a + (Number(b.qty) || 0), 0) : 0;
          const profCount = p.data && Array.isArray(p.data.activeProfiles) ? p.data.activeProfiles.length : 0;
          const dateStr = p.deletedAt ? new Date(p.deletedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Không rõ';

          return `
            <div class="project-card" data-id="${p.id}" style="border-left: 4px solid #EF4444;">
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:8px;">
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span style="font-size:16px; font-weight:700; color:var(--dark); word-break:break-word;">
                      ${escapeHtml(p.name)}
                    </span>
                    <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:#FEE2E2; color:#B91C1C;">Đã xóa</span>
                  </div>
                  ${p.customer ? `<div style="font-size:13px; color:#475569; margin-top:2px; font-weight:500;">Khách hàng: <strong>${escapeHtml(p.customer)}</strong></div>` : ''}
                  ${p.notes ? `<div style="font-size:12px; color:#64748B; margin-top:3px; font-style:italic;">${escapeHtml(p.notes)}</div>` : ''}
                </div>
              </div>

              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:10px; padding-top:10px; border-top:1px dashed #E2E8F0;">
                <div style="display:flex; align-items:center; gap:12px; font-size:12px; color:#64748B;">
                  <span>Xóa lúc: <strong>${dateStr}</strong></span>
                  <span>• <strong>${profCount}</strong> loại hộp</span>
                  <span>• <strong>${partCount}</strong> chi tiết</span>
                </div>

                <div class="project-card-actions">
                  <button class="btn btn-sm btn-p btn-restore-proj" data-id="${p.id}" style="background:#059669; border-color:#059669; font-weight:700;" title="Khôi phục dự án này về danh mục làm việc">
                    ↩️ Khôi phục
                  </button>
                  <button class="btn btn-sm btn-soft btn-perm-del-proj" data-id="${p.id}" style="color:#DC2626; font-weight:700;" title="Xóa vĩnh viễn không thể khôi phục">
                    ❌ Xóa vĩnh viễn
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        wrap.innerHTML = trashHeader + cardsHtml;

        const btnEmpty = $('btnEmptyTrashAll');
        if (btnEmpty) btnEmpty.onclick = emptyTrashProjects;
        wrap.querySelectorAll('.btn-restore-proj').forEach(btn => {
          btn.onclick = () => restoreProjectFromTrash(btn.getAttribute('data-id'));
        });
        wrap.querySelectorAll('.btn-perm-del-proj').forEach(btn => {
          btn.onclick = () => permanentDeleteProject(btn.getAttribute('data-id'));
        });
        return;
      }

      // Tab Danh mục hoạt động
      wrap.innerHTML = filtered.map(p => {
        const isActive = p.id === state.currentProjectId;
        const partCount = p.data && Array.isArray(p.data.parts) ? p.data.parts.reduce((a, b) => a + (Number(b.qty) || 0), 0) : 0;
        const profCount = p.data && Array.isArray(p.data.activeProfiles) ? p.data.activeProfiles.length : 0;
        const dateStr = p.updatedAt ? new Date(p.updatedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Không rõ';

        return `
          <div class="project-card ${isActive ? 'active-proj' : ''}" data-id="${p.id}" ${p.isLocked ? 'style="border-left: 4px solid #F59E0B;"' : ''}>
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:8px;">
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span style="font-size:16px; font-weight:700; color:var(--dark); word-break:break-word;">
                    ${escapeHtml(p.name)}
                  </span>
                  ${isActive ? '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:#DCFCE7; color:#15803D;">● Đang làm việc</span>' : ''}
                  ${p.isLocked ? '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:#FEF3C7; color:#B45309; border:1px solid #FCD34D;">🔒 ĐÃ KHÓA BẢO VỆ</span>' : ''}
                </div>
                ${p.customer ? `<div style="font-size:13px; color:#475569; margin-top:2px; font-weight:500;">Khách hàng: <strong>${escapeHtml(p.customer)}</strong></div>` : ''}
                ${p.notes ? `<div style="font-size:12px; color:#64748B; margin-top:3px; font-style:italic;">${escapeHtml(p.notes)}</div>` : ''}
              </div>
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:10px; padding-top:10px; border-top:1px dashed #E2E8F0;">
              <div style="display:flex; align-items:center; gap:12px; font-size:12px; color:#64748B;">
                <span>Cập nhật: <strong>${dateStr}</strong></span>
                <span>• <strong>${profCount}</strong> loại hộp</span>
                <span>• <strong>${partCount}</strong> chi tiết</span>
              </div>

              <div class="project-card-actions">
                ${isActive ? `
                  <button class="btn btn-sm btn-soft" disabled style="opacity:0.75; cursor:default; background:#DCFCE7; color:#15803D; border-color:#BBF7D0;">
                    ✓ Đang mở
                  </button>
                ` : `
                  <button class="btn btn-sm btn-p btn-load-proj" data-id="${p.id}" title="Mở dự án này ra màn hình làm việc">
                    Mở dự án
                  </button>
                `}
                <button class="btn btn-sm btn-soft btn-lock-proj" data-id="${p.id}" style="${p.isLocked ? 'background:#FEF3C7; color:#B45309; border-color:#FCD34D; font-weight:700;' : ''}" title="${p.isLocked ? 'Mở khóa dự án để chỉnh sửa hoặc xóa' : 'Khóa bảo vệ dự án chống xóa hoặc sửa nhầm'}">
                  ${p.isLocked ? '🔓 Mở khóa' : '🔒 Khóa'}
                </button>
                <button class="btn btn-sm btn-soft btn-edit-proj" data-id="${p.id}" ${p.isLocked ? 'disabled style="opacity:0.45; cursor:not-allowed;" title="Dự án đang khóa bảo vệ"' : 'title="Đổi tên / Khách hàng / Ghi chú"'}>
                  Sửa
                </button>
                <button class="btn btn-sm btn-soft btn-duplicate-proj" data-id="${p.id}" title="Nhân bản (sao chép) dự án này">
                  Nhân bản
                </button>
                <button class="btn btn-sm btn-soft btn-export-proj" data-id="${p.id}" title="Tải file .json của dự án này về máy">
                  Xuất file
                </button>
                <button class="btn btn-sm btn-soft btn-del-proj" data-id="${p.id}" ${p.isLocked ? 'disabled style="opacity:0.4; cursor:not-allowed; color:#94A3B8;" title="Dự án đang khóa bảo vệ. Cần mở khóa trước khi xóa!"' : 'style="color:#DC2626;" title="Chuyển vào thùng rác"'}>
                  Xóa
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Gắn sự kiện cho các nút trong thẻ dự án
      wrap.querySelectorAll('.btn-load-proj').forEach(btn => {
        btn.onclick = () => loadProjectById(btn.getAttribute('data-id'));
      });
      wrap.querySelectorAll('.btn-lock-proj').forEach(btn => {
        btn.onclick = () => toggleProjectLock(btn.getAttribute('data-id'));
      });
      wrap.querySelectorAll('.btn-edit-proj').forEach(btn => {
        btn.onclick = () => openSaveProjectModal(btn.getAttribute('data-id'));
      });
      wrap.querySelectorAll('.btn-duplicate-proj').forEach(btn => {
        btn.onclick = () => duplicateProject(btn.getAttribute('data-id'));
      });
      wrap.querySelectorAll('.btn-export-proj').forEach(btn => {
        btn.onclick = () => exportSingleProjectJson(btn.getAttribute('data-id'));
      });
      wrap.querySelectorAll('.btn-del-proj').forEach(btn => {
        btn.onclick = () => deleteProject(btn.getAttribute('data-id'));
      });
    }

    function openSaveProjectModal(targetId = null) {
      state.editingProjectId = targetId;
      const modal = $('modalSaveProjectForm');
      const title = $('saveProjModalTitle');
      const inpName = $('inpSaveProjName');
      const inpCust = $('inpSaveProjCustomer');
      const inpNotes = $('inpSaveProjNotes');
      const btnConfirm = $('btnConfirmSaveProjForm');
      const btnSaveAsNew = $('btnSaveAsNewProjForm');

      if (targetId) {
        const found = state.savedProjects.find(p => p.id === targetId);
        if (found) {
          title.textContent = 'Chỉnh sửa thông tin Dự án';
          inpName.value = found.name || '';
          inpCust.value = found.customer || '';
          inpNotes.value = found.notes || '';
          btnConfirm.textContent = 'Cập nhật';
          if (btnSaveAsNew) btnSaveAsNew.style.display = 'none';
        }
      } else {
        const hasOpenSavedProj = state.currentProjectId && state.savedProjects.some(p => p.id === state.currentProjectId);
        if (hasOpenSavedProj) {
          title.textContent = 'Lưu Dự Án (Cập nhật hoặc Tạo mới)';
          inpName.value = state.currentProjectName || '';
          inpCust.value = state.currentProjectCustomer || '';
          inpNotes.value = state.currentProjectNotes || '';
          btnConfirm.textContent = 'Lưu (Đổi tên = Tạo mới)';
          if (btnSaveAsNew) btnSaveAsNew.style.display = 'inline-flex';
        } else {
          title.textContent = 'Lưu Dự Án Mới Vào Bộ Nhớ';
          const nextNum = (state.savedProjects ? state.savedProjects.length : 0) + 1;
          inpName.value = state.currentProjectName || `Dự án #${nextNum} (${new Date().toLocaleDateString('vi-VN')})`;
          inpCust.value = state.currentProjectCustomer || '';
          inpNotes.value = state.currentProjectNotes || '';
          btnConfirm.textContent = 'Lưu vào bộ nhớ';
          if (btnSaveAsNew) btnSaveAsNew.style.display = 'none';
        }
      }

      modal.style.display = 'flex';
      setTimeout(() => { inpName.focus(); inpName.select(); }, 50);
    }

    function closeSaveProjectModal() {
      const modal = $('modalSaveProjectForm');
      if (modal) modal.style.display = 'none';
      state.editingProjectId = null;
    }


    async function deleteProject(projId) {
      if (state.userRole === 'operator') {
        alert('🔒 CHẾ ĐỘ THỢ CNC (KHÓA AN TOÀN):\n\nBạn không có quyền xóa dự án!\nVui lòng liên hệ Kỹ sư thiết kế để mở khóa.');
        return;
      }
      const proj = state.savedProjects.find(p => p.id === projId);
      if (!proj) return;
      if (proj.isLocked) {
        alert(`⚠️ DỰ ÁN ĐANG ĐƯỢC KHÓA BẢO VỆ!\n\nDự án "${proj.name}" đang được bật khóa an toàn chống xóa.\nVui lòng bấm nút "Mở khóa" nếu bạn thực sự muốn xóa.`);
        return;
      }
      if (!confirm(`Bạn có muốn chuyển dự án "${proj.name}" vào Thùng rác không?\n(Dự án sẽ được lưu trữ an toàn trong Thùng rác và bạn có thể khôi phục lại bất kỳ lúc nào).`)) return;

      state.lastLocalProjectWriteAt = Date.now();
      window.SupabaseDB.setLoading(true, 'Đang chuyển vào thùng rác...');
      try {
        const trashed = await window.SupabaseDB.trashProject(projId);
        if (!Array.isArray(state.trashProjects)) state.trashProjects = [];
        state.trashProjects.unshift(trashed);
        state.savedProjects = state.savedProjects.filter(p => p.id !== projId);

        if (state.currentProjectId === projId) {
          state.currentProjectId = null;
          state.currentProjectName = '';
          state.currentProjectCustomer = '';
          state.currentProjectNotes = '';
          try { localStorage.removeItem(LS_CURRENT_PROJ_ID); } catch (e) {}
          updateProjectActiveBanner();
        }
        updateProjectsBadge();
        renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
        showToast(`🗑️ Đã chuyển "${proj.name}" vào Thùng rác! (Bấm tab Thùng rác để khôi phục)`, 4500);
      } catch (err) {
        showToast('❌ Lỗi xóa dự án: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function restoreProjectFromTrash(projId) {
      if (!Array.isArray(state.trashProjects)) state.trashProjects = [];
      const proj = state.trashProjects.find(p => p.id === projId);
      if (!proj) return;
      state.lastLocalProjectWriteAt = Date.now();
      window.SupabaseDB.setLoading(true, 'Đang khôi phục dự án...');
      try {
        const restored = await window.SupabaseDB.restoreProject(projId);
        state.trashProjects = state.trashProjects.filter(p => p.id !== projId);
        state.savedProjects = [restored, ...state.savedProjects.filter(p => p.id !== restored.id)];
        updateProjectsBadge();
        renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
        showToast(`↩️ Đã khôi phục dự án "${restored.name}"!`);
      } catch (err) {
        showToast('❌ Lỗi khôi phục: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function permanentDeleteProject(projId) {
      if (!Array.isArray(state.trashProjects)) state.trashProjects = [];
      const target = state.trashProjects.find(p => p.id === projId);
      if (!target) return;
      if (!confirm(`Xóa vĩnh viễn dự án "${target.name}"? Thao tác này không thể hoàn tác.`)) return;

      state.lastLocalProjectWriteAt = Date.now();
      window.SupabaseDB.setLoading(true, 'Đang xóa vĩnh viễn...');
      try {
        await window.SupabaseDB.permanentDeleteProject(projId);
        state.trashProjects = state.trashProjects.filter(p => p.id !== projId);
        updateProjectsBadge();
        renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
        showToast(`❌ Đã xóa vĩnh viễn dự án "${target.name}"!`);
      } catch (err) {
        showToast('❌ Lỗi xóa vĩnh viễn: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function emptyTrashProjects() {
      if (!Array.isArray(state.trashProjects) || !state.trashProjects.length) return;
      if (!confirm(`Bạn có chắc muốn dọn sạch toàn bộ ${state.trashProjects.length} dự án trong Thùng rác?`)) return;

      state.lastLocalProjectWriteAt = Date.now();
      window.SupabaseDB.setLoading(true, 'Đang dọn sạch thùng rác...');
      try {
        await window.SupabaseDB.emptyTrash();
        state.trashProjects = [];
        updateProjectsBadge();
        renderProjectsList($('inpSearchProjects') ? $('inpSearchProjects').value.trim() : '');
        showToast(`🗑️ Đã dọn sạch Thùng rác!`);
      } catch (err) {
        showToast('❌ Lỗi dọn thùng rác: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }


    async function duplicateProject(projId) {
      let src = state.savedProjects.find(p => p.id === projId);
      if (!src) return;
      if (src.isSummary && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        try {
          const fullSrc = await window.SupabaseDB.getProjectById(projId);
          if (fullSrc) src = fullSrc;
        } catch (e) {}
      }

      const clonedData = JSON.parse(JSON.stringify(src.data || {}));
      delete clonedData.inventoryDeductedAt;
      delete clonedData.inventory_deducted_at;
      delete clonedData.inventoryDeductedBy;
      delete clonedData.inventory_deducted_by;
      delete clonedData.inventoryDeductedSnapshot;
      delete clonedData.inventory_deducted_snapshot;
      clonedData.offcutsDeducted = false;
      clonedData.offcutsDeductedAt = null;

      const clone = {
        id: makeId('proj'),
        name: src.name + ' (Bản sao)',
        customer: src.customer || '',
        notes: src.notes || '',
        isLocked: false,
        isTrashed: false,
        isDraft: false,
        source: src.source || 'web',
        inventoryDeductedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: clonedData,
        igsFiles: JSON.parse(JSON.stringify(src.igsFiles || []))
      };

      state.lastLocalProjectWriteAt = Date.now();
      window.SupabaseDB.setLoading(true, 'Đang nhân bản dự án...');
      try {
        const saved = await window.SupabaseDB.saveProject(clone);
        state.savedProjects.unshift(saved);
        updateProjectsBadge();
        renderProjectsList($('inpSearchProjects').value.trim());
        showToast(`✓ Đã nhân bản dự án thành "${saved.name}"!`);
      } catch (err) {
        showToast('❌ Lỗi nhân bản dự án: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    function downloadJsonFile(filename, dataObj) {
      const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async function exportSingleProjectJson(projId) {
      let proj = state.savedProjects.find(p => p.id === projId);
      if (proj && proj.isSummary && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        try {
          const fullProj = await window.SupabaseDB.getProjectById(projId);
          if (fullProj) proj = fullProj;
        } catch (e) {}
      }
      if (!proj) {
        // Xuất trực tiếp dữ liệu hiện hành trên màn hình
        proj = {
          id: state.currentProjectId || makeId('proj_cur'),
          name: state.currentProjectName || `Dự án ngày ${new Date().toLocaleDateString('vi-VN')}`,
          customer: state.currentProjectCustomer || '',
          notes: state.currentProjectNotes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: {
            activeProfiles: [...state.activeProfiles],
            selectedTabProfile: state.selectedTabProfile,
            parts: JSON.parse(JSON.stringify(state.parts)),
            stock: JSON.parse(JSON.stringify(state.stock)),
            method: state.method,
            kerf: state.kerf,
            clamp: state.clamp,
            interlock: state.interlock,
            gap: state.gap,
            fusionProject: state.fusionProject
          }
        };
      }
      if (!proj) return;

      const exportPayload = {
        generator: 'PhanMemToiUuPhoi_ToanThang',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        project: proj
      };

      const safeName = (proj.name || 'Du_An').replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF-]/g, '_');
      downloadJsonFile(`${safeName}.json`, exportPayload);
      showToast(`✓ Đã xuất file dự án "${proj.name}.json"!`);
    }

    async function exportAllProjectsBackup() {
      if (!state.savedProjects || !state.savedProjects.length) {
        showToast('Chưa có dự án nào trong bộ nhớ để sao lưu!');
        return;
      }

      let fullProjects = state.savedProjects;
      if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        window.SupabaseDB.setLoading(true, 'Đang tải đầy đủ dữ liệu để sao lưu...');
        try {
          fullProjects = await window.SupabaseDB.getProjects({ includeTrash: false, includeDraft: false });
        } catch (err) {
          showToast('❌ Không tải được dữ liệu đầy đủ để sao lưu: ' + err.message);
          return;
        } finally {
          window.SupabaseDB.setLoading(false);
        }
      }

      const backupPayload = {
        generator: 'PhanMemToiUuPhoi_ToanThang',
        version: '2.0',
        exportedAt: new Date().toISOString(),
        total_projects: fullProjects.length,
        saved_projects: fullProjects,
        saved_profiles: state.savedProfiles
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      downloadJsonFile(`sao_luu_toan_bo_du_an_${dateStr}.json`, backupPayload);
      showToast(`✓ Đã sao lưu toàn bộ ${fullProjects.length} dự án vào máy!`);
    }

    function importProjectFromFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          state.lastLocalProjectWriteAt = Date.now();

          // Trường hợp 1: File sao lưu toàn bộ (chứa saved_projects)
          if (parsed && Array.isArray(parsed.saved_projects) && parsed.saved_projects.length > 0) {
            const count = parsed.saved_projects.length;
            const overwrite = confirm(`File sao lưu này chứa ${count} dự án.\n\nBấm [OK] để GỘP thêm vào danh sách hiện tại.\nBấm [Cancel] để GHI ĐÈ / cập nhật danh mục dự án trên Supabase.`);
            window.SupabaseDB.setLoading(true, 'Đang nhập dự án lên Supabase...');
            try {
              const toSave = [];
              parsed.saved_projects.forEach(p => {
                const cloned = JSON.parse(JSON.stringify(p));
                const exist = state.savedProjects.find(sp => sp.id === cloned.id || sp.name === cloned.name);
                if (overwrite && exist) {
                  cloned.id = makeId('proj');
                  cloned.name = cloned.name + ' (Nhập)';
                }
                cloned.source = 'import';
                toSave.push(cloned);
              });
              for (const p of toSave) {
                const saved = await window.SupabaseDB.saveProject(p);
                state.savedProjects = [saved, ...state.savedProjects.filter(x => x.id !== saved.id)];
              }
              if (Array.isArray(parsed.saved_profiles) && parsed.saved_profiles.length) {
                await window.SupabaseDB.addProfilesBulk(parsed.saved_profiles);
                parsed.saved_profiles.forEach(pr => {
                  if (!state.savedProfiles.includes(pr)) state.savedProfiles.push(pr);
                });
                renderMemoryLibraryChips();
              }
              updateProjectsBadge();
              renderProjectsList('');
              showToast(`✓ Đã nhập thành công ${toSave.length} dự án lên Supabase!`);
            } finally {
              window.SupabaseDB.setLoading(false);
            }
            return;
          }

          // Trường hợp 2: File xuất 1 dự án riêng (chứa parsed.project)
          if (parsed && parsed.project && parsed.project.data) {
            const p = parsed.project;
            p.id = makeId('proj');
            p.source = 'import';
            window.SupabaseDB.setLoading(true, 'Đang nhập dự án...');
            try {
              const saved = await window.SupabaseDB.saveProject(p);
              state.savedProjects.unshift(saved);
              updateProjectsBadge();
              renderProjectsList('');
              if (confirm(`Đã nạp dự án "${saved.name}". Bạn có muốn mở dự án này ra làm việc ngay không?`)) {
                await loadProjectById(saved.id);
              } else {
                showToast(`✓ Đã thêm dự án "${saved.name}" vào Supabase!`);
              }
            } finally {
              window.SupabaseDB.setLoading(false);
            }
            return;
          }

          // Trường hợp 3: File JSON xuất từ Fusion 360 (có parts, clamp_tail, project_name)
          if (parsed && (parsed.parts || Array.isArray(parsed))) {
            await loadFusionDataPayload(parsed);
            closeProjectsManagerModal();
            showToast('✓ Đã nạp thành công dữ liệu từ file JSON!');
            return;
          }

          showToast('Cấu trúc file JSON không được hỗ trợ!');
        } catch (err) {
          showToast('Lỗi đọc/nhập file JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    }


// Expose on window
if (typeof window !== "undefined") {
  window.switchProjectsTab = switchProjectsTab;
  window.openProjectsManagerModal = openProjectsManagerModal;
  window.closeProjectsManagerModal = closeProjectsManagerModal;
  window.renderProjectsList = renderProjectsList;
  window.openSaveProjectModal = openSaveProjectModal;
  window.closeSaveProjectModal = closeSaveProjectModal;
  window.deleteProject = deleteProject;
  window.restoreProjectFromTrash = restoreProjectFromTrash;
  window.permanentDeleteProject = permanentDeleteProject;
  window.emptyTrashProjects = emptyTrashProjects;
  window.duplicateProject = duplicateProject;
  window.downloadJsonFile = downloadJsonFile;
  window.exportSingleProjectJson = exportSingleProjectJson;
  window.exportAllProjectsBackup = exportAllProjectsBackup;
  window.importProjectFromFile = importProjectFromFile;
}
