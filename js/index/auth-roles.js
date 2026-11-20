/**
 * Module: auth-roles.js - Supabase Auth, RBAC & CNC Progress Tracking
 * Phân quyền Admin / Kỹ sư / Thợ CNC, chuyển vai trò & cập nhật tiến độ cắt từng cây
 */

    // ==========================================
    // 🛡️ NÂNG CẤP 1 & 4: HỆ THỐNG TÀI KHOẢN SUPABASE AUTH & PHÂN QUYỀN (ADMIN / KỸ SƯ / THỢ CNC)
    // ==========================================
    async function initUserRole() {
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) {
        state.currentUser = null;
        state.userRole = 'operator';
        if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'flex';
        applyUserRoleUI();
        return false;
      }

      try {
        const user = await window.SupabaseDB.getCurrentAuthUser();
        if (user) {
          state.currentUser = user;
          state.userRole = user.role === 'operator' ? 'operator' : 'engineer';
          if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'none';
          applyUserRoleUI();
          return true;
        }
      } catch (err) {
        console.warn('Không xác thực được phiên Supabase Auth:', err);
      }

      state.currentUser = null;
      state.userRole = 'operator';
      if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'flex';
      applyUserRoleUI();
      return false;
    }

    function applyUserRoleUI() {
      const user = state.currentUser;
      const isOp = !user || user.role === 'operator';
      const isSuperAdmin = Boolean(user && user.role === 'admin');
      state.userRole = isOp ? 'operator' : 'engineer';

      const roleBadge = $('btnRoleSelector');
      const roleIcon = $('roleBadgeIcon');
      const roleText = $('roleBadgeText');
      const roleLock = $('roleLockStatus');

      if (isOp) {
        document.body.classList.add('role-operator');
        document.body.classList.add('operator-mode');
        if (roleBadge) {
          roleBadge.style.background = '#FFF7ED';
          roleBadge.style.borderColor = '#FDBA74';
          roleBadge.style.color = '#C2410C';
        }
        if (roleIcon) roleIcon.textContent = '👷';
        if (roleText) roleText.textContent = user ? `${user.fullName || user.username} [Thợ CNC]` : 'Chưa đăng nhập';
        if (roleLock) roleLock.textContent = '🔒';
      } else {
        document.body.classList.remove('role-operator');
        document.body.classList.remove('operator-mode');
        if (roleBadge) {
          roleBadge.style.background = '#F0FDFA';
          roleBadge.style.borderColor = '#99F6E4';
          roleBadge.style.color = '#0F766E';
        }
        if (roleIcon) roleIcon.textContent = isSuperAdmin ? '👑' : '📐';
        if (roleText) roleText.textContent = `${user.fullName || user.username} [${isSuperAdmin ? 'Admin' : 'Kỹ sư'}]`;
        if (roleLock) roleLock.textContent = '🔓';
      }

      if (user) {
        if ($('accModalUserIcon')) $('accModalUserIcon').textContent = isOp ? '👷' : (isSuperAdmin ? '👑' : '📐');
        if ($('accModalFullName')) $('accModalFullName').textContent = user.fullName || user.username;
        if ($('accModalUsername')) $('accModalUsername').textContent = '@' + user.username;
        if ($('accModalRoleBadge')) {
          if (isSuperAdmin) {
            $('accModalRoleBadge').textContent = 'QUẢN TRỊ VIÊN TỐI CAO (ADMIN)';
            $('accModalRoleBadge').style.background = '#0F766E';
          } else if (isOp) {
            $('accModalRoleBadge').textContent = 'THỢ VẬN HÀNH CNC (KHÓA AN TOÀN)';
            $('accModalRoleBadge').style.background = '#C2410C';
          } else {
            $('accModalRoleBadge').textContent = 'KỸ SƯ THIẾT KẾ (TOÀN QUYỀN KỸ THUẬT)';
            $('accModalRoleBadge').style.background = '#0369A1';
          }
        }
        if ($('currentAccountCard')) {
          $('currentAccountCard').style.borderColor = isOp ? '#FDBA74' : (isSuperAdmin ? '#0F766E' : '#38BDF8');
          $('currentAccountCard').style.background = isOp ? '#FFF7ED' : (isSuperAdmin ? '#F0FDFA' : '#F0F9FF');
        }
        if ($('accModalRoleDesc')) {
          if (isSuperAdmin) {
            $('accModalRoleDesc').innerHTML = '• <strong>Quyền Quản trị viên (Admin):</strong> Toàn quyền tối cao quản lý nhân sự, phân quyền qua Supabase Auth, tính toán tối ưu và quản lý toàn bộ dự án.';
          } else if (isOp) {
            $('accModalRoleDesc').innerHTML = '• <strong>Quyền hạn Thợ CNC:</strong> Được xem sơ đồ cắt, tải file <code>.IGS</code> bảo mật cho máy laser và bấm tích <code>[✅ Đã cắt xong]</code>.<br>• <strong>Bảo vệ an toàn:</strong> Đã khóa toàn bộ nút Xóa dự án, Xóa phôi, Sửa kích thước cả ở giao diện lẫn Database RLS.';
          } else {
            $('accModalRoleDesc').innerHTML = '• <strong>Quyền hạn Kỹ sư Thiết kế:</strong> Toàn quyền tính toán tối ưu, thêm/sửa/xóa quy cách hộp, quản lý dự án và xuất nhập bản vẽ từ Autodesk Fusion 360.';
          }
        }
      }

      if ($('adminUsersManagerBox')) {
        $('adminUsersManagerBox').style.display = isSuperAdmin ? 'block' : 'none';
      }
      if ($('navLinkAdmin')) {
        $('navLinkAdmin').style.display = isSuperAdmin ? 'inline-flex' : 'none';
      }
      if (state.result) {
        renderMaterialsGrouped(state.result);
      }
      if ($('btnHeaderAdminPanel')) {
        $('btnHeaderAdminPanel').style.display = isSuperAdmin ? 'inline-flex' : 'none';
      }
      if ($('btnGoAdminSubpageWrap')) {
        $('btnGoAdminSubpageWrap').style.display = isSuperAdmin ? 'block' : 'none';
      }
    }

    async function handleGateLogin() {
      const uName = ($('inpLoginUsername') ? $('inpLoginUsername').value : '').trim();
      const uPass = ($('inpLoginPassword') ? $('inpLoginPassword').value : '').trim();
      const errBox = $('loginErrorAlert');

      if (!uName || !uPass) {
        if (errBox) {
          errBox.textContent = '⚠️ Vui lòng nhập đầy đủ Tên tài khoản và Mật khẩu!';
          errBox.style.display = 'block';
        }
        return;
      }

      window.SupabaseDB.setLoading(true, 'Đang xác thực qua Supabase Auth...');
      try {
        const user = await window.SupabaseDB.signInWithUsername(uName, uPass);
        if (errBox) errBox.style.display = 'none';
        state.currentUser = user;
        state.userRole = user.role === 'operator' ? 'operator' : 'engineer';

        if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'none';
        if ($('inpLoginPassword')) $('inpLoginPassword').value = '';
        applyUserRoleUI();

        const roleLabel = user.role === 'admin'
          ? '👑 Quản trị viên (Admin)'
          : (user.role === 'engineer' ? '📐 Kỹ Sư Thiết Kế (Toàn quyền)' : '👷 Thợ CNC (Khóa an toàn chống xóa)');
        showToast(`✓ Xin chào ${user.fullName || user.username} · Quyền: ${roleLabel}`);
        await bootstrapWorkspaceAfterAuth();
      } catch (err) {
        if (errBox) {
          errBox.textContent = '❌ ' + (err.message || 'Tên tài khoản hoặc Mật khẩu không chính xác!');
          errBox.style.display = 'block';
        }
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function logoutCurrentAccount() {
      clearTimeout(state.activeSaveTimer);
      state.hasPendingActiveSave = false;
      if (state.realtimeUnsub) {
        try { state.realtimeUnsub(); } catch (e) {}
        state.realtimeUnsub = null;
      }
      state.hasBootstrappedWorkspace = false;
      state.currentUser = null;
      state.userRole = 'operator';
      if (window.SupabaseDB) {
        await window.SupabaseDB.signOut();
      }
      closeRoleSwitchModal();
      applyUserRoleUI();
      if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'flex';
      showToast('👋 Đã đăng xuất tài khoản! Vui lòng đăng nhập để tiếp tục.');
    }

    async function saveSelfNewPassword() {
      if (!state.currentUser) return;
      const newPass = ($('inpNewSelfPassword') ? $('inpNewSelfPassword').value : '').trim();
      if (!newPass || newPass.length < 6) {
        alert('⚠️ Mật khẩu Supabase Auth mới phải có ít nhất 6 ký tự!');
        return;
      }
      window.SupabaseDB.setLoading(true, 'Đang cập nhật mật khẩu trên Supabase Auth...');
      try {
        await window.SupabaseDB.updateOwnPassword(newPass);
        if ($('inpNewSelfPassword')) $('inpNewSelfPassword').value = '';
        showToast('🔑 Đã cập nhật mật khẩu mới thành công!');
      } catch (err) {
        showToast('❌ Lỗi cập nhật mật khẩu: ' + err.message);
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    function openRoleSwitchModal() {
      if (!state.currentUser) {
        if ($('loginOverlayGate')) $('loginOverlayGate').style.display = 'flex';
        return;
      }
      const modal = $('modalRoleSwitch');
      if (!modal) return;
      applyUserRoleUI();
      modal.style.display = 'flex';
    }

    function closeRoleSwitchModal() {
      const modal = $('modalRoleSwitch');
      if (modal) modal.style.display = 'none';
    }

    // ==========================================
    // 📊 NÂNG CẤP 2: LIVE PRODUCTION TRACKING (TIẾN ĐỘ CẮT ROW-LEVEL SUPABASE)
    // ==========================================
    function playSuccessChime() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.1);
        osc.frequency.setValueAtTime(783.99, now + 0.2);
        osc.frequency.setValueAtTime(1046.50, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      } catch (e) {}
    }

    async function toggleBarCuttingStatus(key, total, patternHash = '') {
      if (!state.inFlightCutKeys) state.inFlightCutKeys = new Set();
      if (state.inFlightCutKeys.has(key)) return;
      state.inFlightCutKeys.add(key);

      if (!state.cutStatuses) state.cutStatuses = {};
      const prev = state.cutStatuses[key] ? Object.assign({}, state.cutStatuses[key]) : null;
      const cur = prev ? (prev.cutCount || 0) : 0;
      let next = cur + 1;
      if (next > total) next = 0;

      const nextStatus = next >= total ? 'done' : (next > 0 ? 'cutting' : 'pending');
      state.cutStatuses[key] = {
        cutCount: next,
        totalCount: total,
        status: nextStatus,
        patternHash: patternHash || '',
        updatedBy: state.currentUser ? state.currentUser.username : null,
        updatedAt: new Date().toISOString()
      };

      const cleanKey = key.replace('__', ' - ');
      if (next >= total) {
        playSuccessChime();
        showToast(`🎉 Đã hoàn thành toàn bộ cây ${cleanKey} (${next}/${total} cây)!`);
      } else if (next > 0) {
        showToast(`✂️ Cập nhật: Đã cắt ${next}/${total} cây ${cleanKey}`);
      } else {
        showToast(`🔄 Đặt lại trạng thái cây ${cleanKey} về Chưa cắt`);
      }

      updateLiveCuttingProgressUI();
      if (state.result) renderPatternsGrouped(state.result);

      try {
        if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
          const activePid = state.currentProjectId || window.SupabaseDB.DRAFT_PROJECT_ID;
          if (activePid === window.SupabaseDB.DRAFT_PROJECT_ID) {
            await window.SupabaseDB.saveDraftProject(buildActiveDataSnapshot());
          }
          await window.SupabaseDB.updateCutStatus(activePid, key, {
            cutCount: next,
            totalCount: total,
            status: nextStatus,
            patternHash: patternHash || '',
            updatedBy: state.currentUser ? state.currentUser.username : null
          });
        }
      } catch (err) {
        if (prev) state.cutStatuses[key] = prev;
        else delete state.cutStatuses[key];
        updateLiveCuttingProgressUI();
        if (state.result) renderPatternsGrouped(state.result);
        showToast('❌ Không lưu được tiến độ lên Supabase: ' + err.message);
      } finally {
        state.inFlightCutKeys.delete(key);
      }
    }

    function updateLiveCuttingProgressUI() {
      const card = $('liveCuttingProgressCard');
      if (!card || !state.result || !state.result.patterns) return;

      let totalStockBars = 0;
      let completedBars = 0;
      let inProgressBars = 0;

      const profiles = state.result.summaryByProfile ? state.result.summaryByProfile.map(s => s.profile) : ['Chung'];
      profiles.forEach(prof => {
        const patternsOfProfile = state.result.patterns.filter(p => (p.profile || 'Chung') === prof);
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        patternsOfProfile.forEach((p, pSubIdx) => {
          const letter = alphabet[pSubIdx % alphabet.length];
          const barKey = `${prof}__${letter}`;
          const count = p.count;
          totalStockBars += count;

          const cur = state.cutStatuses && state.cutStatuses[barKey] ? (state.cutStatuses[barKey].cutCount || 0) : 0;
          if (cur >= count) {
            completedBars += count;
          } else if (cur > 0) {
            completedBars += cur;
            inProgressBars += 1;
          }
        });
      });

      const remainingBars = Math.max(0, totalStockBars - completedBars);
      const percent = totalStockBars > 0 ? Math.round((completedBars / totalStockBars) * 100) : 0;

      if ($('liveProgressPercentBadge')) $('liveProgressPercentBadge').textContent = percent + '%';
      if ($('liveProgressRatioText')) $('liveProgressRatioText').textContent = `Đã cắt: ${completedBars}/${totalStockBars} cây`;
      if ($('liveProgressBarFill')) $('liveProgressBarFill').style.width = percent + '%';
      if ($('statCutCompleted')) $('statCutCompleted').textContent = completedBars;
      if ($('statCutInProgress')) $('statCutInProgress').textContent = inProgressBars;
      if ($('statCutRemaining')) $('statCutRemaining').textContent = remainingBars;

      if ($('liveProgressBarFill')) {
        if (percent === 100) {
          $('liveProgressBarFill').style.background = 'linear-gradient(90deg, #10B981, #059669)';
        } else if (percent > 50) {
          $('liveProgressBarFill').style.background = 'linear-gradient(90deg, #3B82F6, #10B981)';
        } else {
          $('liveProgressBarFill').style.background = 'linear-gradient(90deg, #F59E0B, #10B981)';
        }
      }
    }

    // ==========================================

// Expose on window
if (typeof window !== "undefined") {
  window.initUserRole = initUserRole;
  window.applyUserRoleUI = applyUserRoleUI;
  window.handleGateLogin = handleGateLogin;
  window.logoutCurrentAccount = logoutCurrentAccount;
  window.saveSelfNewPassword = saveSelfNewPassword;
  window.openRoleSwitchModal = openRoleSwitchModal;
  window.closeRoleSwitchModal = closeRoleSwitchModal;
  window.playSuccessChime = playSuccessChime;
  window.toggleBarCuttingStatus = toggleBarCuttingStatus;
  window.updateLiveCuttingProgressUI = updateLiveCuttingProgressUI;
}
