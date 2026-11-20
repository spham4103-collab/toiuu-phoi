/**
 * Module: warehouse-dispatch.js - Live Warehouse Stock & Offcuts Dispatch
 * Đối chiếu tồn kho thực tế xưởng, trừ kho phôi lẻ / cây nguyên & hoàn kho
 */


    async function initStockOffcuts() {
      if (!window.SupabaseDB || !window.SupabaseDB.isConfigured()) {
        state.stockOffcuts = [];
        return [];
      }
      try {
        const rows = await window.SupabaseDB.getStockOffcuts({ onlyAvailable: true });
        state.stockOffcuts = Array.isArray(rows) ? rows : [];
        return state.stockOffcuts;
      } catch (err) {
        console.warn('Lỗi tải kho đề-xê:', err);
        return state.stockOffcuts || [];
      }
    }

    function getUsedOffcutsFromResult(resultObj, stockArr) {
      const res = resultObj || state.result;
      const stList = Array.isArray(stockArr) ? stockArr : state.stock;
      if (!res || !Array.isArray(res.byStockType) || !Array.isArray(stList)) return [];

      const out = [];
      const seenProfiles = new Set(res.byStockType.map(b => b.profile || 'Chung'));
      seenProfiles.forEach(prof => {
        const ps = stList.filter(s => Number(s.length) > 0 && (s.profile || 'Chung') === prof);
        const bts = res.byStockType.filter(b => (b.profile || 'Chung') === prof);
        for (let i = 0; i < Math.min(ps.length, bts.length); i++) {
          const srcStock = ps[i];
          const resStock = bts[i];
          if (srcStock && srcStock._fromOffcut && srcStock.offcutId && resStock && (Number(resStock.usedQty) || 0) > 0) {
            out.push({
              id: srcStock.offcutId,
              profile: prof,
              lengthMm: Number(srcStock.length) || 0,
              usedQty: Number(resStock.usedQty) || 0
            });
          }
        }
      });
      return out;
    }

    function computeUsedOffcutsForAnyProject(projRec) {
      if (!projRec) return [];
      if (projRec.id === state.currentProjectId && state.result) {
        return getUsedOffcutsFromResult(state.result, state.stock);
      }
      const d = projRec.data || {};
      const parts = Array.isArray(d.parts) ? d.parts.filter(p => Number(p.length) > 0 && Number(p.qty) > 0) : [];
      const stList = Array.isArray(d.stock) ? d.stock : [];
      if (!parts.length || !stList.some(s => s._fromOffcut && s.offcutId) || typeof RC === 'undefined') return [];

      const clampTail = d.clamp != null ? Number(d.clamp) : 80;
      const stockForEngine = stList.filter(s => Number(s.length) > 0).map((s, idx) => ({
        label: s.name || (s.qty === null ? `Cây mới ${numVN(s.length)}` : `Cây tồn ${numVN(s.length)}`),
        length: Number(s.length),
        clampTail,
        qty: s.qty,
        priority: s._fromOffcut ? (-1000 + idx) : idx,
        profile: s.profile || 'Chung'
      }));
      try {
        const simRes = RC.solve({
          kerf: Number(d.kerf) || 0,
          interlock: d.interlock != null ? Boolean(d.interlock) : true,
          gap: Number(d.gap) || 0,
          stock: stockForEngine,
          parts: parts.map(p => ({
            label: p.id,
            length: Number(p.length),
            qty: Number(p.qty),
            end_style: p.style || 'thang',
            mat: p.style === 'thang' ? 0 : ((p.mat && p.mat >= 5) ? Number(p.mat) : extractMatFromProfile(p.profile)),
            profile: p.profile || 'Chung'
          }))
        });
        return getUsedOffcutsFromResult(simRes, stList);
      } catch (e) {
        return [];
      }
    }

    function syncOffcutsIntoProjectStock(enable) {
      const keepManual = (state.stock || []).filter(s => !s._fromOffcut);
      if (!enable) {
        state.stock = keepManual;
        state.useWarehouseOffcuts = false;
        return;
      }
      state.useWarehouseOffcuts = true;
      const targetProfiles = new Set([
        ...(state.activeProfiles || []),
        ...((state.parts || []).map(p => p.profile || 'Chung'))
      ]);
      const matchedOffcuts = (state.stockOffcuts || []).filter(o => Number(o.quantity) > 0 && targetProfiles.has(o.profile));
      const offcutRows = matchedOffcuts.map(off => ({
        id: 'off_' + off.id,
        offcutId: off.id,
        _fromOffcut: true,
        profile: off.profile,
        name: `♻️ Đề-xê kho (${numVN(off.lengthMm)}mm${off.sourceBarKey ? ' · ' + off.sourceBarKey.split('__').pop() : ''})`,
        length: Number(off.lengthMm),
        qty: Number(off.quantity),
        clamp: state.clamp
      }));
      state.stock = offcutRows.concat(keepManual);
    }

    function renderOffcutSuggestionBox() {
      const box = $('offcutSuggestionBox');
      const detail = $('offcutSuggestionDetail');
      const chk = $('chkUseWarehouseOffcuts');
      const actRow = $('offcutActionRow');
      if (!box || !detail || !chk) return;

      const curProfiles = (state.selectedTabProfile && state.selectedTabProfile !== 'ALL')
        ? [state.selectedTabProfile]
        : (state.activeProfiles || []);
      const allRelevantProfiles = new Set([
        ...curProfiles,
        ...(state.activeProfiles || []),
        ...((state.parts || []).map(p => p.profile || 'Chung'))
      ]);

      const availableAll = (state.stockOffcuts || []).filter(o => Number(o.quantity) > 0 && allRelevantProfiles.has(o.profile));
      const hasExistingOffcutInStock = (state.stock || []).some(s => s._fromOffcut);

      if (!availableAll.length && !hasExistingOffcutInStock && !state.useWarehouseOffcuts && !state.offcutsDeducted) {
        box.style.display = 'none';
        return;
      }

      box.style.display = 'block';
      chk.checked = Boolean(state.useWarehouseOffcuts);

      const curProj = state.currentProjectId ? (state.savedProjects || []).find(p => p.id === state.currentProjectId) : null;
      const locked = Boolean(curProj && curProj.isLocked) || state.userRole === 'operator';
      chk.disabled = locked || Boolean(state.offcutsDeducted);

      if (availableAll.length) {
        const byProf = {};
        availableAll.forEach(o => {
          if (!byProf[o.profile]) byProf[o.profile] = [];
          byProf[o.profile].push(`${o.quantity}×${numVN(o.lengthMm)}mm`);
        });
        detail.innerHTML = Object.keys(byProf).map(p => `• <b>${escapeHtml(p)}:</b> ${escapeHtml(byProf[p].join(', '))}`).join('<br>');
      } else {
        detail.innerHTML = '<span style="color:#64748B;">Hiện kho đề-xê cho quy cách này đang trống.</span>';
      }

      if (actRow) {
        const usedItems = getUsedOffcutsFromResult();
        if (state.offcutsDeducted) {
          actRow.style.display = 'block';
          actRow.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; color:#15803D;">✅ Đã trừ đề-xê sử dụng khỏi kho chung${state.offcutsDeductedAt ? ' (' + formatShortCutTime(state.offcutsDeductedAt) + ')' : ''}</span>`;
        } else if (usedItems.length > 0 && state.userRole !== 'operator') {
          const totalUsed = usedItems.reduce((a, b) => a + b.usedQty, 0);
          actRow.style.display = 'flex';
          actRow.style.alignItems = 'center';
          actRow.style.gap = '8px';
          actRow.style.flexWrap = 'wrap';
          actRow.innerHTML = `
            <span style="font-size:12px; font-weight:700; color:#0F766E;">✓ Đang tận dụng <b>${totalUsed}</b> đoạn đề-xê cho phương án này.</span>
            <button type="button" class="btn btn-p btn-sm" id="btnDeductUsedOffcuts" style="min-height:30px; padding:3px 10px; font-size:12px;">✅ Trừ ${totalUsed} đoạn khỏi kho</button>
          `;
          const btnDed = $('btnDeductUsedOffcuts');
          if (btnDed) btnDed.onclick = () => deductUsedOffcutsFromWarehouse();
        } else {
          actRow.style.display = 'none';
          actRow.innerHTML = '';
        }
      }
    }

    async function deductUsedOffcutsFromWarehouse(skipAlert = false) {
      if (state.offcutsDeducted || state.inventoryDeductedAt) return true;
      const usedItems = getUsedOffcutsFromResult();
      if (!usedItems.length) {
        if (!skipAlert) showToast('Phương án hiện tại chưa sử dụng đoạn đề-xê nào!');
        return false;
      }
      const totalUsed = usedItems.reduce((a, b) => a + b.usedQty, 0);
      if (!skipAlert && !confirm(`Xác nhận trừ ${totalUsed} đoạn đề-xê đã dùng khỏi Kho Đề-xê chung trên Supabase?`)) {
        return false;
      }
      window.SupabaseDB.setLoading(true, 'Đang trừ kho đề-xê trên Supabase...');
      try {
        await window.SupabaseDB.consumeStockOffcuts(usedItems, {
          projectId: state.currentProjectId,
          projectName: state.currentProjectName,
          createdBy: state.currentUser ? state.currentUser.username : ''
        });
        state.offcutsDeducted = true;
        state.offcutsDeductedAt = new Date().toISOString();
        await initStockOffcuts();
        state.hasPendingActiveSave = false;
        clearTimeout(state.activeSaveTimer);
        state.lastLocalProjectWriteAt = Date.now();
        const snap = buildActiveDataSnapshot();
        if (state.currentProjectId) {
          const curProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
          if (!curProj || !curProj.isLocked) {
            const updated = await window.SupabaseDB.updateProjectFields(state.currentProjectId, { data: snap });
            if (curProj && updated) Object.assign(curProj, updated);
          }
        } else {
          await window.SupabaseDB.saveDraftProject(snap);
        }
        renderOffcutSuggestionBox();
        if (state.result) renderMaterialsGrouped(state.result);
        showToast(`♻️ Đã trừ ${totalUsed} đoạn đề-xê khỏi kho chung!`);
        return true;
      } catch (err) {
        showToast('❌ Lỗi trừ kho đề-xê: ' + err.message);
        return false;
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    function computeDispatchPlanForResult(resObj, stockList, alreadyOffcutsDeducted) {
      const res = resObj || state.result;
      if (!res || !Array.isArray(res.byStockType)) {
        return { fullBarsByProfile: [], offcutsUsed: [], fullSummaryLines: [], offcutCount: 0 };
      }
      const stList = Array.isArray(stockList) ? stockList : state.stock;
      const offDed = alreadyOffcutsDeducted !== undefined ? Boolean(alreadyOffcutsDeducted) : Boolean(state.offcutsDeducted);
      const offcutsUsed = offDed ? [] : getUsedOffcutsFromResult(res, stList);
      const offcutUsedIds = new Set(offcutsUsed.map(o => 'off_' + o.id));
      const invByProf = {};
      (state.inventoryItems || []).forEach(r => { invByProf[r.profileName] = r; });

      // Cây nguyên cần xuất kho = tất cả cây không phải _fromOffcut (chỉ lọc usedQty > 0 SAU khi căn chỉnh index với stList)
      const fullByProfMap = {};
      const profiles = (res.summaryByProfile || []).map(s => s.profile);
      profiles.forEach(prof => {
        const bts = res.byStockType.filter(s => (s.profile || 'Chung') === prof);
        const ps = stList.filter(s => Number(s.length) > 0 && (s.profile || 'Chung') === prof);
        let fullQty = 0;
        let stdLen = (invByProf[prof] && invByProf[prof].standardLengthMm) || 6000;
        for (let i = 0; i < bts.length; i++) {
          const st = bts[i];
          const used = Number(st && st.usedQty) || 0;
          if (used <= 0) continue;
          const matchingPs = i < ps.length ? ps[i] : null;
          const isOffcut = Boolean(matchingPs && (matchingPs._fromOffcut || offcutUsedIds.has(matchingPs.id)));
          if (!isOffcut) {
            fullQty += used;
            if (st.length) stdLen = Number(st.length);
          }
        }
        if (fullQty > 0) {
          fullByProfMap[prof] = { profile: prof, qty: fullQty, lengthMm: stdLen };
        }
      });

      const fullBarsByProfile = Object.values(fullByProfMap);
      const fullSummaryLines = fullBarsByProfile.map(f => {
        const whQty = invByProf[f.profile] ? Math.max(0, Number(invByProf[f.profile].stockQty) || 0) : 0;
        const deductQty = Math.min(f.qty, whQty);
        return `• ${f.profile}: cần ${f.qty} cây (trong kho còn ${whQty} → sẽ trừ ${deductQty} cây)`;
      });
      const offcutCount = offcutsUsed.reduce((a, b) => a + (Number(b.usedQty) || 0), 0);
      return { fullBarsByProfile, offcutsUsed, fullSummaryLines, offcutCount };
    }

    function computeDispatchNeedsForAnyProject(projRec) {
      if (!projRec) return { fullBarsByProfile: [], offcutsUsed: [], fullSummaryLines: [], offcutCount: 0 };
      if (projRec.id === state.currentProjectId && state.result) {
        return computeDispatchPlanForResult(state.result, state.stock, state.offcutsDeducted);
      }
      const d = projRec.data || {};
      const parts = Array.isArray(d.parts) ? d.parts.filter(p => Number(p.length) > 0 && Number(p.qty) > 0) : [];
      const stList = Array.isArray(d.stock) ? d.stock : [];
      if (!parts.length || typeof RC === 'undefined') {
        return { fullBarsByProfile: [], offcutsUsed: [], fullSummaryLines: [], offcutCount: 0 };
      }
      const clampTail = d.clamp != null ? Number(d.clamp) : 80;
      const partProfiles = new Set(parts.map(p => p.profile || 'Chung'));
      const stockForEngine = stList.filter(s => Number(s.length) > 0).map((s, idx) => ({
        label: s.name || (s.qty === null ? `Cây mới ${numVN(s.length)}` : `Cây tồn ${numVN(s.length)}`),
        length: Number(s.length),
        clampTail,
        qty: s.qty,
        priority: s._fromOffcut ? (-1000 + idx) : idx,
        profile: s.profile || 'Chung'
      }));
      partProfiles.forEach(prof => {
        if (!stockForEngine.some(s => s.profile === prof)) {
          stockForEngine.push({ label: `Cây mới 6m (${prof})`, length: 6000, clampTail, qty: null, priority: 99, profile: prof });
        }
      });
      try {
        const simRes = RC.solve({
          kerf: Number(d.kerf) || 0,
          interlock: d.interlock != null ? Boolean(d.interlock) : true,
          gap: Number(d.gap) || 0,
          stock: stockForEngine,
          parts: parts.map(p => ({
            label: p.id,
            length: Number(p.length),
            qty: Number(p.qty),
            end_style: p.style || 'thang',
            mat: p.style === 'thang' ? 0 : ((p.mat && p.mat >= 5) ? Number(p.mat) : extractMatFromProfile(p.profile)),
            profile: p.profile || 'Chung'
          }))
        });
        return computeDispatchPlanForResult(simRes, stList, Boolean(d.offcutsDeducted));
      } catch (e) {
        return { fullBarsByProfile: [], offcutsUsed: [], fullSummaryLines: [], offcutCount: 0 };
      }
    }

    async function dispatchActiveProjectToWarehouse(skipConfirm = false) {
      if (state.userRole === 'operator') {
        alert('🔒 Thợ CNC không có quyền Xuất kho dự án.');
        return false;
      }
      if (!state.currentProjectId) {
        alert('⚠️ Vui lòng bấm [Lưu dự án] thành đơn hàng chính thức trước khi Xuất kho, để Sổ cái lưu đúng mã dự án và khóa chống trừ trùng!');
        openSaveProjectModal();
        return false;
      }
      if (state.inventoryDeductedAt) {
        showToast('🔒 Dự án này đã xuất kho rồi! Nếu muốn điều chỉnh, vui lòng bấm "↩️ Hoàn kho" trước.');
        return false;
      }
      if (!state.result || !state.result.bars || !state.result.bars.length) {
        showToast('⚠️ Chưa có kết quả xếp phôi để xuất kho!');
        return false;
      }

      const plan = computeDispatchPlanForResult(state.result, state.stock);
      if (!plan.fullBarsByProfile.length && !plan.offcutsUsed.length) {
        showToast('⚠️ Dự án chưa có vật tư nào cần xuất kho!');
        return false;
      }

      const msgLines = [
        `📤 XÁC NHẬN XUẤT KHO CHO DỰ ÁN "${state.currentProjectName || state.currentProjectId}":`,
        '',
        ...plan.fullSummaryLines,
        ...(plan.offcutCount > 0 ? [`• Phôi lẻ / Đề-xê kho: đánh dấu đã dùng ${plan.offcutCount} đoạn.`] : []),
        '',
        'Thao tác sẽ ghi Sổ cái xuất kho và KHÓA chống trừ kho lần 2 cho dự án này.'
      ];
      if (!skipConfirm && !confirm(msgLines.join('\n'))) {
        return false;
      }

      window.SupabaseDB.setLoading(true, 'Đang xuất kho & ghi Sổ cái giao dịch...');
      try {
        const actor = state.currentUser ? state.currentUser.username : '';
        const res = await window.SupabaseDB.dispatchProjectInventory({
          projectId: state.currentProjectId,
          projectName: state.currentProjectName || state.currentProjectId,
          projectDeductedAt: state.inventoryDeductedAt,
          fullBarsByProfile: plan.fullBarsByProfile,
          offcutsUsed: plan.offcutsUsed,
          createdBy: actor
        });

        state.inventoryDeductedAt = res.deductedAt;
        state.inventoryDeductedBy = actor;
        state.inventoryDeductedSnapshot = { fullBars: res.fullBars, offcuts: res.offcuts };
        if (res.totalOffcutsDeducted > 0) {
          state.offcutsDeducted = true;
          state.offcutsDeductedAt = res.deductedAt;
        }

        state.hasPendingActiveSave = false;
        clearTimeout(state.activeSaveTimer);
        state.lastLocalProjectWriteAt = Date.now();
        const snap = buildActiveDataSnapshot();
        const curProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
        const updatedProj = await window.SupabaseDB.updateProjectFields(state.currentProjectId, {
          data: snap,
          inventoryDeductedAt: res.deductedAt
        });
        if (curProj && updatedProj) Object.assign(curProj, updatedProj);

        await Promise.all([initSavedProfiles(), initStockOffcuts()]);
        renderOffcutSuggestionBox();
        renderMaterialsGrouped(state.result);
        showToast(`📤 Đã xuất kho: -${res.totalFullDeducted} cây nguyên${res.totalOffcutsDeducted > 0 ? ` và -${res.totalOffcutsDeducted} đoạn lẻ` : ''}!`);
        return true;
      } catch (err) {
        showToast('❌ Không xuất được kho: ' + err.message);
        return false;
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

    async function returnActiveProjectToWarehouse() {
      if (state.userRole === 'operator') return false;
      if (!state.currentProjectId || !state.inventoryDeductedAt) {
        showToast('Dự án này chưa xuất kho nên không cần hoàn kho!');
        return false;
      }
      const snap = state.inventoryDeductedSnapshot || { fullBars: [], offcuts: [] };
      const fullQty = (snap.fullBars || []).reduce((a, b) => a + (Number(b.deductedQty) || 0), 0);
      const offQty = (snap.offcuts || []).reduce((a, b) => a + (Number(b.usedQty) || 0), 0);

      if (!confirm(
        `↩️ XÁC NHẬN HOÀN KHO DỰ ÁN "${state.currentProjectName}":\n\n` +
        `• Trả lại kho: +${fullQty} cây nguyên${offQty > 0 ? ` và +${offQty} đoạn phôi lẻ` : ''}.\n` +
        `• Ghi bút toán 'project_return' vào Sổ cái kho và mở lại trạng thái Chưa xuất kho.`
      )) {
        return false;
      }

      window.SupabaseDB.setLoading(true, 'Đang hoàn kho & ghi Sổ cái...');
      try {
        const actor = state.currentUser ? state.currentUser.username : '';
        const retRes = await window.SupabaseDB.returnProjectInventory({
          projectId: state.currentProjectId,
          projectName: state.currentProjectName || state.currentProjectId,
          snapshot: snap,
          createdBy: actor
        });

        state.inventoryDeductedAt = null;
        state.inventoryDeductedBy = '';
        state.inventoryDeductedSnapshot = null;
        state.offcutsDeducted = false;
        state.offcutsDeductedAt = null;

        state.hasPendingActiveSave = false;
        clearTimeout(state.activeSaveTimer);
        state.lastLocalProjectWriteAt = Date.now();
        const projSnap = buildActiveDataSnapshot();
        const curProj = (state.savedProjects || []).find(p => p.id === state.currentProjectId);
        const updatedProj = await window.SupabaseDB.updateProjectFields(state.currentProjectId, {
          data: projSnap,
          inventoryDeductedAt: null
        });
        if (curProj && updatedProj) Object.assign(curProj, updatedProj);

        await Promise.all([initSavedProfiles(), initStockOffcuts()]);
        renderOffcutSuggestionBox();
        if (state.result) renderMaterialsGrouped(state.result);
        showToast(`↩️ Đã hoàn kho +${retRes.totalFullReturned} cây nguyên${retRes.totalOffcutsReturned > 0 ? ` và +${retRes.totalOffcutsReturned} đoạn lẻ` : ''}!`);
        return true;
      } catch (err) {
        showToast('❌ Lỗi hoàn kho: ' + err.message);
        return false;
      } finally {
        window.SupabaseDB.setLoading(false);
      }
    }

// Expose on window
if (typeof window !== "undefined") {
  window.initStockOffcuts = initStockOffcuts;
  window.getUsedOffcutsFromResult = getUsedOffcutsFromResult;
  window.computeUsedOffcutsForAnyProject = computeUsedOffcutsForAnyProject;
  window.syncOffcutsIntoProjectStock = syncOffcutsIntoProjectStock;
  window.renderOffcutSuggestionBox = renderOffcutSuggestionBox;
  window.deductUsedOffcutsFromWarehouse = deductUsedOffcutsFromWarehouse;
  window.computeDispatchPlanForResult = computeDispatchPlanForResult;
  window.computeDispatchNeedsForAnyProject = computeDispatchNeedsForAnyProject;
  window.dispatchActiveProjectToWarehouse = dispatchActiveProjectToWarehouse;
  window.returnActiveProjectToWarehouse = returnActiveProjectToWarehouse;
}
