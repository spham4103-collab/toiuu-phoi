/**
 * Module: profile-memory.js - Profile Memory Library
 * Quản lý thư viện quy cách thép hộp (Supabase inventory / LocalStorage)
 */

    // Load & Save Memory Library (Supabase inventory)
    async function initSavedProfiles() {
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) {
        state.inventoryItems = DEFAULT_SAVED_PROFILES.map(n => ({ profileName: n, stockQty: 0, standardLengthMm: 6000 }));
        state.savedProfiles = DEFAULT_SAVED_PROFILES.slice();
        return;
      }
      try {
        const invRows = await window.SupabaseDB.getInventory();
        state.inventoryItems = Array.isArray(invRows) ? invRows : [];
        const names = state.inventoryItems.map(r => r.profileName).filter(Boolean);
        state.savedProfiles = names.length ? names : DEFAULT_SAVED_PROFILES.slice();
      } catch (err) {
        console.error('Lỗi tải thư viện quy cách từ Supabase:', err);
        state.inventoryItems = DEFAULT_SAVED_PROFILES.map(n => ({ profileName: n, stockQty: 0, standardLengthMm: 6000 }));
        state.savedProfiles = DEFAULT_SAVED_PROFILES.slice();
      }
    }

    function saveProfilesLibrary() {
      if (state.isApplyingRemoteChange || !window.SupabaseDB || !window.SupabaseDB.isConfigured()) return;
      window.SupabaseDB.addProfilesBulk(state.savedProfiles).catch(err => {
        console.warn('Lỗi đồng bộ quy cách lên Supabase:', err);
      });
    }

    async function addProfileToMemory(pName) {
      pName = String(pName || '').trim();
      if (!pName) return;
      if (!state.savedProfiles.includes(pName)) {
        state.savedProfiles.push(pName);
        if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
          window.SupabaseDB.addProfile(pName).catch(err => showToast('❌ Lỗi lưu quy cách: ' + err.message));
        }
      }
      if (!state.activeProfiles.includes(pName)) {
        state.activeProfiles.push(pName);
      }
      ensureStockForProfile(pName);
      state.selectedTabProfile = pName;
      renderMemoryLibraryChips();
      renderProfileTabs();
      renderPartsList();
      renderStockList();
      calculateOptimization(false);
      saveActiveProject();
      showToast(`Đã lưu "${pName}" lên Supabase & thêm vào bản vẽ!`);
    }

    async function removeProfileFromMemory(pName, e) {
      if (e) e.stopPropagation();
      if (!confirm(`Bạn có chắc muốn xóa quy cách "${pName}" khỏi danh sách bộ nhớ?`)) return;
      state.savedProfiles = state.savedProfiles.filter(p => p !== pName);
      renderMemoryLibraryChips();
      if (window.SupabaseDB && window.SupabaseDB.isConfigured()) {
        window.SupabaseDB.setLoading(true, 'Đang xóa quy cách...');
        try {
          await window.SupabaseDB.deleteProfile(pName);
          showToast(`Đã xóa "${pName}" khỏi thư viện Supabase!`);
        } catch (err) {
          showToast('❌ Lỗi xóa quy cách: ' + err.message);
        } finally {
          window.SupabaseDB.setLoading(false);
        }
      } else {
        showToast(`Đã xóa "${pName}" khỏi bộ nhớ!`);
      }
    }

    function renderMemoryLibraryChips() {
      const container = $('memoryChipsWrap');
      container.innerHTML = '';

      state.savedProfiles.forEach(pName => {
        const chip = document.createElement('div');
        chip.className = 'memory-chip-pill';
        chip.title = `Bấm để xếp phôi cho ${pName}`;
        chip.innerHTML = `
          <span>+ ${escapeHtml(pName)}</span>
          <span class="memory-chip-del" title="Xóa khỏi bộ nhớ">&times;</span>
        `;

        chip.querySelector('span:first-child').onclick = () => {
          if (!state.activeProfiles.includes(pName)) {
            state.activeProfiles.push(pName);
          }
          ensureStockForProfile(pName);
          state.selectedTabProfile = pName;
          renderProfileTabs();
          renderPartsList();
          renderStockList();
          calculateOptimization(false);
          saveActiveProject();
          showToast(`Đang xếp chi tiết cho "${pName}"`);
        };

        chip.querySelector('.memory-chip-del').onclick = (e) => removeProfileFromMemory(pName, e);

        container.appendChild(chip);
      });
    }


// Expose on window
if (typeof window !== "undefined") {
  window.initSavedProfiles = initSavedProfiles;
  window.saveProfilesLibrary = saveProfilesLibrary;
  window.addProfileToMemory = addProfileToMemory;
  window.removeProfileFromMemory = removeProfileFromMemory;
  window.renderMemoryLibraryChips = renderMemoryLibraryChips;
}
