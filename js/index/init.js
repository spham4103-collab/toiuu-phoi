/**
 * Module: init.js - DOM Initialization & Event Wiring
 * Gắn kết toàn bộ giao diện người dùng, phím tắt, menu thao tác và vòng đời ứng dụng
 */

    // 📶 NÂNG CẤP 3: PWA & TRẠNG THÁI MẠNG
    // ==========================================
    function initNetworkAndPWA() {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js?v=15').then(reg => {
          reg.update();
          console.log('PWA Service Worker registered & updated v14:', reg.scope);
        }).catch(err => {
          console.log('SW registration note:', err);
        });
      }

      const updateNetBadge = () => {
        const isOnline = navigator.onLine;
        const badge = $('networkStatusBadge');
        const dot = $('networkDot');
        const text = $('networkStatusText');
        if (!badge) return;

        if (isOnline) {
          badge.style.background = '#DCFCE7';
          badge.style.borderColor = '#BBF7D0';
          badge.style.color = '#15803D';
          if (dot) dot.style.background = '#10B981';
          if (text) text.textContent = 'Trực tuyến 24/7';
        } else {
          badge.style.background = '#FEF3C7';
          badge.style.borderColor = '#FDE68A';
          badge.style.color = '#B45309';
          if (dot) dot.style.background = '#F59E0B';
          if (text) text.textContent = 'Ngoại tuyến';
          showToast('📡 Mất kết nối Internet: Vui lòng kiểm tra Wi-Fi/4G để đồng bộ với Supabase!');
        }
      };

      window.addEventListener('online', async () => {
        updateNetBadge();
        showToast('🟢 Đã khôi phục mạng! Tự động làm mới dữ liệu từ Supabase.');
        if (state.currentUser && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
          window.SupabaseDB.clearConnectionError();
          await initProjectsManager();
          await loadCutProgressForActiveProject();
        }
      });
      window.addEventListener('offline', updateNetBadge);
      updateNetBadge();
    }


    // Attach Event Listeners & Khởi động xác thực Supabase Auth
    window.addEventListener('DOMContentLoaded', async () => {
      initNetworkAndPWA();
      if (window.SharedUI && typeof window.SharedUI.initStickySection === 'function') {
        window.SharedUI.initStickySection($('indexPartsStickyEntry'), document.querySelector('.parts-table-wrap'), null);
      }

      // Gắn sự kiện Hệ thống Tài khoản Supabase Auth (lắng nghe ngay cả khi chưa đăng nhập)
      if ($('btnRoleSelector')) {
        $('btnRoleSelector').onclick = () => openRoleSwitchModal();
      }
      if ($('btnHeaderQuickLogout')) {
        $('btnHeaderQuickLogout').onclick = () => {
          if (confirm('Bạn có chắc muốn Đăng Xuất khỏi hệ thống không?')) {
            logoutCurrentAccount();
          }
        };
      }
      if ($('btnCloseRoleModal')) {
        $('btnCloseRoleModal').onclick = () => closeRoleSwitchModal();
      }
      if ($('btnCloseRoleSwitchModal')) {
        $('btnCloseRoleSwitchModal').onclick = () => closeRoleSwitchModal();
      }
      if ($('btnToggleLoginPassVis')) {
        $('btnToggleLoginPassVis').onclick = () => {
          const inp = $('inpLoginPassword');
          if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
        };
      }
      if ($('btnSubmitGateLogin')) {
        $('btnSubmitGateLogin').onclick = () => handleGateLogin();
      }
      if ($('inpLoginUsername')) {
        $('inpLoginUsername').onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if ($('inpLoginPassword')) $('inpLoginPassword').focus();
          }
        };
      }
      if ($('inpLoginPassword')) {
        $('inpLoginPassword').onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleGateLogin();
          }
        };
      }
      if ($('btnLogoutAccount')) {
        $('btnLogoutAccount').onclick = () => logoutCurrentAccount();
      }
      if ($('btnSaveSelfPassword')) {
        $('btnSaveSelfPassword').onclick = () => saveSelfNewPassword();
      }

      if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        state.authUnsub = window.SupabaseDB.onAuthStateChange((event) => {
          if (event === 'SIGNED_OUT' && state.currentUser) {
            clearTimeout(state.activeSaveTimer);
            state.hasPendingActiveSave = false;
            if (state.realtimeUnsub) {
              try { state.realtimeUnsub(); } catch (e) {}
              state.realtimeUnsub = null;
            }
            state.hasBootstrappedWorkspace = false;
            state.currentUser = null;
            state.userRole = 'operator';
            applyUserRoleUI();
            if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'flex';
            const errBox = $('loginErrorAlert');
            if (errBox) {
              errBox.textContent = '🔒 Phiên đăng nhập đã hết hạn hoặc vừa đăng xuất. Vui lòng đăng nhập lại!';
              errBox.style.display = 'block';
            }
          }
        });
      }

      // Kiểm tra phiên Supabase Auth trước — chỉ nạp dữ liệu xưởng khi đã đăng nhập hợp lệ
      if (window.SupabaseDB) window.SupabaseDB.setLoading(true, 'Đang kiểm tra phiên đăng nhập...');
      let isAuthed = false;
      try {
        isAuthed = await initUserRole();
      } finally {
        if (window.SupabaseDB) window.SupabaseDB.setLoading(false);
      }

      // Gắn sự kiện nạp phôi IGS và Fusion 360 trước khi bootstrap (?open=igs)
      if (typeof initIgsFusionEvents === "function") {
        initIgsFusionEvents();
      }

      if (isAuthed) {
        await bootstrapWorkspaceAfterAuth();
      }
      if ($('btnResetCutProgress')) {
        $('btnResetCutProgress').onclick = async () => {
          if (!confirm('Đặt lại toàn bộ tiến độ cắt của dự án này về 0% (Chưa cắt)?')) return;
          const activePid = state.currentProjectId || (window.SupabaseDB && window.SupabaseDB.DRAFT_PROJECT_ID);
          state.cutStatuses = {};
          updateLiveCuttingProgressUI();
          if (state.result) renderPatternsGrouped(state.result);
          if (activePid && window.SupabaseDB && window.SupabaseDB.isConfigured()) {
            try {
              await window.SupabaseDB.resetCutProgress(activePid);
            } catch (err) {
              showToast('❌ Lỗi đặt lại tiến độ trên Supabase: ' + err.message);
            }
          }
          showToast('Đã đặt lại tiến độ cắt về 0%');
        };
      }

      // Dropdown Menus
      const setupDropdown = (toggleId, dropdownId) => {
        const toggle = $(toggleId);
        const dropdown = $(dropdownId);
        if (!toggle || !dropdown) return;
        toggle.onclick = e => {
          e.stopPropagation();
          const isOpen = dropdown.classList.contains('open');
          document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('open'));
          if (!isOpen) dropdown.classList.add('open');
        };
      };
      setupDropdown('btnDropdownImportToggle', 'dropdownImport');
      setupDropdown('btnDropdownSamplesToggle', 'dropdownSamples');
      document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('open'));
      });

      $('btnPresetMulti').onclick = () => loadMultiProfilePreset();
      $('btnPresetUser').onclick = () => loadUserCase();
      $('btnOptimizeHero').onclick = () => calculateOptimization(true); // Chỉ cuộn khi bấm nút Tính toán
      $('btnCalculate').onclick = () => calculateOptimization(true);    // Chỉ cuộn khi bấm nút Tính toán

      // Add Custom Profile to Memory & Project
      $('btnAddCustomProfile').onclick = () => {
        const val = $('inpCustomProfile').value.trim();
        if (val) {
          addProfileToMemory(val);
          $('inpCustomProfile').value = '';
        }
      };
      $('inpCustomProfile').onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          $('btnAddCustomProfile').click();
        }
      };

      // Reset (Nút "🔄 Tạo mới" trên thanh đầu trang)
      $('btnReset').onclick = () => {
        if (confirm('Tạo bản vẽ mới hoàn toàn?\n\nMàn hình sẽ được làm sạch về Dự án nháp mới (Các dự án đã lưu và bộ nhớ quy cách hộp vẫn được giữ nguyên).')) {
          resetToBlankNewProject(false);
        }
      };

      // Add Part
      $('btnAddPart').onclick = () => {
        const targetProf = state.selectedTabProfile !== 'ALL' ? state.selectedTabProfile : (state.activeProfiles[0] || 'Hộp 30x30x1.8');
        state.parts.push({
          id: makeId('p'),
          name: '',
          profile: targetProf,
          length: '',
          qty: 1,
          style: 'thang',
          mat: extractMatFromProfile(targetProf)
        });
        renderProfileTabs();
        renderActiveProfileBanner();
        renderPartsList();
        saveActiveProject();
        const rows = document.querySelectorAll('.parts-row');
        if (rows.length) {
          const last = rows[rows.length - 1];
          const inp = last.querySelector('[data-f="name"]') || last.querySelector('[data-f="length"]');
          if (inp) inp.focus();
        }
      };

      if ($('chkUseWarehouseOffcuts')) {
        $('chkUseWarehouseOffcuts').onchange = (e) => {
          if (checkProjectLockedForEdit()) {
            e.target.checked = Boolean(state.useWarehouseOffcuts);
            return;
          }
          const wantUse = Boolean(e.target.checked);
          syncOffcutsIntoProjectStock(wantUse);
          renderStockList();
          calculateOptimization(false);
          saveActiveProject();
          showToast(wantUse
            ? '♻️ Đã nạp phôi đề-xê từ kho — ưu tiên vét trước cây 6m mới!'
            : 'Đã tắt tận dụng đề-xê tự động cho dự án này.');
        };
      }

      // Add Stock for active box
      $('btnAddStock').onclick = () => {
        const targetProf = state.selectedTabProfile !== 'ALL' ? state.selectedTabProfile : (state.activeProfiles[0] || 'Hộp 30x30x1.8');
        state.stock.push({
          id: makeId('s'),
          profile: targetProf,
          name: `Cây tồn (${targetProf})`,
          length: 6000,
          qty: 1,
          clamp: state.clamp
        });
        renderStockList();
        saveActiveProject();
      };

      // Remove current profile from drawing
      $('btnRemoveCurrentProfile').onclick = () => {
        if (checkProjectLockedForEdit()) return;
        const cur = state.selectedTabProfile;
        if (cur === 'ALL') {
          showToast('Vui lòng chọn một loại hộp cụ thể để xóa khỏi bản vẽ!');
          return;
        }
        if (confirm(`Bạn có chắc muốn xóa loại hộp "${cur}" cùng toàn bộ chi tiết của nó khỏi bản vẽ?`)) {
          state.parts = state.parts.filter(p => p.profile !== cur);
          state.stock = state.stock.filter(s => s.profile !== cur);
          state.activeProfiles = state.activeProfiles.filter(p => p !== cur);
          if (!state.activeProfiles.length) state.activeProfiles = ['Hộp 30x30x1.8'];
          state.selectedTabProfile = state.activeProfiles[0];
          renderProfileTabs();
          renderActiveProfileBanner();
          renderPartsList();
          renderStockList();
          calculateOptimization(false);
          saveActiveProject();
          showToast(`Đã xóa loại hộp "${cur}" khỏi bản vẽ!`);
        }
      };

      // Clear all
      $('btnClearAll').onclick = () => {
        if (checkProjectLockedForEdit()) return;
        if (confirm('Bạn có chắc muốn xóa toàn bộ danh sách chi tiết của tất cả các loại hộp?')) {
          state.parts = [];
          state.result = null;
          renderProfileTabs();
          renderActiveProfileBanner();
          renderPartsList();
          calculateOptimization(false);
          saveActiveProject();
          showToast('Đã xóa sạch toàn bộ chi tiết bản vẽ!');
        }
      };

      // Cut Method Toggles
      $('btnMethodSaw').onclick = () => {
        state.method = 'da';
        state.kerf = 3;
        state.clamp = 0;
        state.stock.forEach(s => { s.clamp = 0; });
        updateInputsFromState();
        calculateOptimization(false);
      };
      $('btnMethodLaser').onclick = () => {
        state.method = 'cnc';
        state.kerf = 0;
        state.clamp = 80;
        state.stock.forEach(s => { s.clamp = 80; });
        updateInputsFromState();
        calculateOptimization(false);
      };

      $('chkInterlock').onchange = e => {
        state.interlock = e.target.checked;
        $('boxGap').style.display = state.interlock ? 'block' : 'none';
        calculateOptimization(false);
      };

      ['inpKerf', 'inpClamp', 'inpGap'].forEach(id => {
        const el = $(id);
        if (el) {
          el.oninput = autoRecalc;
          el.onkeydown = e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              calculateOptimization(true);
            }
          };
        }
      });

      // Copy Zalo
      $('btnCopyZalo').onclick = () => {
        const text = generateZaloText();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            showToast('✓ Đã sao chép! Dán trực tiếp vào Zalo là gửi được ngay.');
          }).catch(() => {
            fallbackCopy(text);
          });
        } else {
          fallbackCopy(text);
        }
      };

      function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('✓ Đã sao chép vào bộ nhớ tạm!');
      }

      // Print PDF / Phiếu A4 chuẩn xưởng có QR
      $('btnPrintPDF').onclick = () => {
        if (!state.result || !state.result.bars || !state.result.bars.length) {
          showToast('⚠️ Chưa có kết quả xếp phôi để in phiếu A4!');
          return;
        }
        const curProjRec = state.currentProjectId
          ? (state.savedProjects || []).find(p => p.id === state.currentProjectId)
          : null;
        if (window.WorkshopExport) {
          window.WorkshopExport.printProductionSheet({
            project: Object.assign({}, curProjRec || {}, {
              id: state.currentProjectId || '__draft__',
              name: state.currentProjectName || 'Dự án hiện hành (Nháp)',
              customer: state.currentProjectCustomer || '',
              notes: state.currentProjectNotes || '',
              kerf: state.kerf,
              clamp: state.clamp,
              interlock: state.interlock,
              gap: state.gap,
              inventoryDeductedAt: state.inventoryDeductedAt,
              inventoryDeductedBy: state.inventoryDeductedBy,
              inventoryDeductedSnapshot: state.inventoryDeductedSnapshot
            }),
            result: state.result,
            parts: state.parts || [],
            cutStatuses: state.cutStatuses || {},
            inventoryItems: state.inventoryItems || [],
            stockOffcuts: state.stockOffcuts || [],
            inventoryDeductedAt: state.inventoryDeductedAt,
            inventoryDeductedBy: state.inventoryDeductedBy,
            inventoryDeductedSnapshot: state.inventoryDeductedSnapshot,
            exportedBy: state.currentUser ? state.currentUser.username : ''
          });
        } else {
          window.print();
        }
      };

      // Export Excel (.xlsx) 2 sheet (BOM + Sơ đồ cắt)
      $('btnExportCSV').onclick = () => {
        if (!state.result || !state.result.bars || !state.result.bars.length) {
          showToast('⚠️ Chưa có kết quả xếp phôi để xuất Excel!');
          return;
        }
        if (window.WorkshopExport) {
          try {
            const curProjRec = state.currentProjectId
              ? (state.savedProjects || []).find(p => p.id === state.currentProjectId)
              : null;
            const expRes = window.WorkshopExport.exportExcelXlsx({
              project: Object.assign({}, curProjRec || {}, {
                id: state.currentProjectId || '__draft__',
                name: state.currentProjectName || 'Dự án hiện hành (Nháp)',
                customer: state.currentProjectCustomer || '',
                notes: state.currentProjectNotes || '',
                kerf: state.kerf,
                clamp: state.clamp,
                interlock: state.interlock,
                gap: state.gap,
                inventoryDeductedAt: state.inventoryDeductedAt,
                inventoryDeductedBy: state.inventoryDeductedBy,
                inventoryDeductedSnapshot: state.inventoryDeductedSnapshot
              }),
              result: state.result,
              parts: state.parts || [],
              cutStatuses: state.cutStatuses || {},
              inventoryItems: state.inventoryItems || [],
              stockOffcuts: state.stockOffcuts || [],
              inventoryDeductedAt: state.inventoryDeductedAt,
              inventoryDeductedBy: state.inventoryDeductedBy,
              inventoryDeductedSnapshot: state.inventoryDeductedSnapshot,
              exportedBy: state.currentUser ? state.currentUser.username : ''
            });
            showToast(`📊 Đã xuất ${expRes.format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV'}: ${expRes.fileName}`);
            return;
          } catch (err) {
            console.warn('Fallback exportCSV:', err);
          }
        }
        exportCSV();
      };

      // Paste Modal
      $('btnOpenPaste').onclick = () => { $('modalPaste').style.display = 'flex'; $('txtPaste').focus(); };
      $('btnQuickPaste').onclick = () => { $('modalPaste').style.display = 'flex'; $('txtPaste').focus(); };
      $('btnClosePaste').onclick = () => { $('modalPaste').style.display = 'none'; };
      $('btnCancelPaste').onclick = () => { $('modalPaste').style.display = 'none'; };
      $('btnApplyPaste').onclick = () => {
        const text = $('txtPaste').value;
        const parsed = parsePasteInput(text);
        if (parsed.length) {
          state.parts = state.parts.concat(parsed);
          ensureProfilesConsistency();
          renderProfileTabs();
          renderActiveProfileBanner();
          renderPartsList();
          renderStockList();
          calculateOptimization(false);
          saveActiveProject();
          $('modalPaste').style.display = 'none';
          $('txtPaste').value = '';
          showToast(`Đã nhận ${parsed.length} chi tiết từ dữ liệu dán!`);
        } else {
          showToast('Không tìm thấy dòng chi tiết hợp lệ!');
        }
      };

      // ==========================================
      // Project Management Event Listeners
      // ==========================================
      // Đồng bộ dữ liệu hoạt động tự động 100% trong nền (Realtime)

      // Header Top Action Buttons
      if ($('btnOpenSaveModal')) $('btnOpenSaveModal').onclick = () => openSaveProjectModal();

      // Active Project Banner Buttons
      if ($('btnBannerSave')) {
        $('btnBannerSave').onclick = () => {
          if (state.currentProjectId) {
            quickSaveActiveProject();
          } else {
            openSaveProjectModal();
          }
        };
      }
      if ($('btnBannerExportJson')) {
        $('btnBannerExportJson').onclick = () => {
          exportSingleProjectJson(state.currentProjectId);
        };
      }
      if ($('btnBannerToggleLock')) $('btnBannerToggleLock').onclick = toggleActiveProjectLock;
      if ($('btnBannerOpenManager')) $('btnBannerOpenManager').onclick = openProjectsManagerModal;

      // Projects Modal Controls
      if ($('btnCloseProjects')) $('btnCloseProjects').onclick = closeProjectsManagerModal;
      if ($('btnProjModalSaveCurrent')) $('btnProjModalSaveCurrent').onclick = () => openSaveProjectModal();
      if ($('btnProjModalNewBlank')) $('btnProjModalNewBlank').onclick = createNewBlankProject;
      if ($('btnTabActiveProjects')) $('btnTabActiveProjects').onclick = () => switchProjectsTab('active');
      if ($('btnTabTrashProjects')) $('btnTabTrashProjects').onclick = () => switchProjectsTab('trash');
      
      const inpProjFile = $('inpImportProjFile');
      if ($('btnProjModalImport') && inpProjFile) {
        $('btnProjModalImport').onclick = () => inpProjFile.click();
        inpProjFile.onchange = e => {
          if (e.target.files && e.target.files[0]) {
            importProjectFromFile(e.target.files[0]);
            e.target.value = '';
          }
        };
      }

      if ($('btnProjModalBackupAll')) $('btnProjModalBackupAll').onclick = exportAllProjectsBackup;

      if ($('inpSearchProjects')) {
        $('inpSearchProjects').oninput = e => {
          renderProjectsList(e.target.value);
        };
      }

      // Save/Edit Project Form Modal Controls
      if ($('btnCloseSaveProjForm')) $('btnCloseSaveProjForm').onclick = closeSaveProjectModal;
      if ($('btnCancelSaveProjForm')) $('btnCancelSaveProjForm').onclick = closeSaveProjectModal;
      if ($('btnConfirmSaveProjForm')) $('btnConfirmSaveProjForm').onclick = () => confirmSaveProjectForm(false);
      if ($('btnSaveAsNewProjForm')) $('btnSaveAsNewProjForm').onclick = () => confirmSaveProjectForm(true);
      if ($('inpSaveProjName')) {
        $('inpSaveProjName').onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmSaveProjectForm(false);
          }
        };
      }
    });

// Expose on window
if (typeof window !== "undefined") {
  window.initNetworkAndPWA = initNetworkAndPWA;
}
