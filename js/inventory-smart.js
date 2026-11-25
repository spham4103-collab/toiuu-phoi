// ============================================================================
// Xếp Phôi An Bình · js/inventory-smart.js
// Đợt 9: Form Nhập/Sửa Quy Cách Thông Minh (Smart Spec Parser + Dynamic UI)
// & Cơ chế Xóa An Toàn 3 mức (Hard Delete / Archive / Merge).
// ============================================================================

(function () {
  'use strict';

  var CTX = {
    mode: 'create',
    item: null,
    inventoryItems: [],
    currentUser: null,
    onSaved: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function numVN(val, dec) {
    var n = Number(val || 0);
    if (!isFinite(n)) return '0';
    var d = dec == null ? 2 : dec;
    return n.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    var el = $('toast');
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(el._smT);
      el._smT = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }
  }

  function populateDatalists(items) {
    var list = Array.isArray(items) ? items : [];
    var grades = new Set(Object.keys((window.SharedUI && window.SharedUI.MATERIAL_DENSITIES) || {}));
    var racks = new Set();
    var units = new Set((window.SharedUI && window.SharedUI.UNITS) || ['cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm']);
    var brands = new Set(['OSG', 'Mitsubishi', 'Korloy', 'Nachi', 'Bosch', 'Hòa Phát', 'Posco']);

    list.forEach(function (r) {
      if (r.specJson && r.specJson.material_grade) grades.add(String(r.specJson.material_grade).trim());
      if (r.rackLocation) racks.add(String(r.rackLocation).trim());
      if (r.unit) units.add(String(r.unit).trim());
      if (r.brand) brands.add(String(r.brand).trim());
    });

    function fillDl(id, setObj) {
      var dl = $(id);
      if (!dl) return;
      dl.innerHTML = Array.from(setObj).filter(Boolean).sort().map(function (v) {
        return '<option value="' + escapeHtml(v) + '"></option>';
      }).join('');
    }
    fillDl('dlSmartGrades', grades);
    fillDl('dlSmartRacks', racks);
    fillDl('dlSmartUnits', units);
    fillDl('dlSmartBrands', brands);
  }

  function ensureModalsInjected() {
    if ($('modalSmartInventoryItem')) return;

    var html = [
      '<datalist id="dlSmartGrades"></datalist>',
      '<datalist id="dlSmartRacks"></datalist>',
      '<datalist id="dlSmartUnits"></datalist>',
      '<datalist id="dlSmartBrands"></datalist>',
      '<div class="inv-modal-backdrop" id="modalSmartInventoryItem" aria-hidden="true">',
      '  <div class="inv-modal xp-modal-3tier" style="width:min(820px, 100%);">',
      '    <div class="inv-modal-head">',
      '      <div>',
      '        <h3 id="siModalTitle" style="font-size:17px;">✨ Thêm Quy Cách Vật Tư Mới</h3>',
      '        <div style="font-size:12px;color:#475569;margin-top:2px;">Gõ tự do theo thói quen (vd: <code>Tấm SUS 430 1.5x1220x2440</code>, <code>Láp tròn SUS 304 D50x1000</code>) để tự bóc tách.</div>',
      '      </div>',
      '      <button type="button" class="btn btn-soft btn-sm" id="btnCloseSmartItemModal">✕ Đóng</button>',
      '    </div>',
      '    <div class="xp-modal-fixed-top">',
      '      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:8px 10px;background:#F0FDFA;border:1.5px solid #99F6E4;border-radius:10px;">',
      '        <div style="flex:1;min-width:240px;">',
      '          <label style="font-size:12px;font-weight:700;display:block;margin-bottom:3px;">Tên / Quy cách vật tư *</label>',
      '          <input type="text" id="siName" placeholder="VD: Tấm SUS 430 1.5x1220x2440, Hộp 40x80x2, Láp tròn SUS 304 D50x1000...">',
      '        </div>',
      '        <button type="button" class="btn btn-p btn-sm" id="btnSmartParseSpec" style="min-height:36px;">✨ Phân tích nhanh</button>',
      '      </div>',
      '    </div>',
      '    <div class="inv-modal-body" style="flex:1;min-height:0;overflow-y:auto;">',
      '      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px;">',
      '        <div>',
      '          <label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Nhóm vật tư *</label>',
      '          <select id="siGroup">',
      '            <option value="tube_1d">🪵 Thép hình / Ống 1D</option>',
      '            <option value="sheet_2d">📐 Thép tấm 2D</option>',
      '            <option value="solid_cnc">🔩 Phôi đặc CNC</option>',
      '            <option value="tooling">🔧 Dao cụ CNC</option>',
      '            <option value="consumable">🧰 Vật tư phụ &amp; Tiêu hao</option>',
      '          </select>',
      '        </div>',
      '        <div>',
      '          <label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Phân loại con</label>',
      '          <select id="siSubCat"></select>',
      '        </div>',
      '        <div>',
      '          <label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Đơn vị tính *</label>',
      '          <input type="text" id="siUnit" list="dlSmartUnits" value="cây">',
      '        </div>',
      '        <div>',
      '          <label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Mã SKU nội bộ</label>',
      '          <input type="text" id="siSku" placeholder="Tự chọn hoặc để trống">',
      '        </div>',
      '      </div>',
      '      <!-- Panel động theo nhóm: 1D -->',
      '      <div id="siPaneTube" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:12px;">',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Quy cách mặt cắt</label><input type="text" id="siSectionSpec" placeholder="VD: 40x80x2, D60x3"></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Dài chuẩn (mm)</label><input type="number" id="siStdLen" value="6000" min="1" step="100"></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Mác vật liệu</label><input type="text" id="siTubeGrade" list="dlSmartGrades" placeholder="SS400, SUS 304..."></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Khối lượng (kg/m)</label><input type="number" id="siWeightPerM" value="0" min="0" step="0.01"></div>',
      '      </div>',
      '      <!-- Panel động theo nhóm: 2D Tấm -->',
      '      <div id="siPaneSheet" style="display:none;padding:10px 12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;margin-bottom:12px;">',
      '        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Dày T (mm) *</label><input type="number" id="siSheetT" value="2" min="0" step="0.1"></div>',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Rộng W (mm) *</label><input type="number" id="siSheetW" value="1220" min="0" step="10"></div>',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Dài L (mm) *</label><input type="number" id="siSheetL" value="2440" min="0" step="10"></div>',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Mác vật liệu</label><input type="text" id="siSheetGrade" list="dlSmartGrades" placeholder="SS400, SUS 430..."></div>',
      '        </div>',
      '        <div style="margin-top:8px;font-size:13px;color:#1E3A8A;">⚖️ Khối lượng lý thuyết: <strong id="siSheetWeightDisp">0 kg</strong> / tấm</div>',
      '      </div>',
      '      <!-- Panel động theo nhóm: Phôi đặc CNC -->',
      '      <div id="siPaneSolid" style="display:none;padding:10px 12px;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;margin-bottom:12px;">',
      '        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Hình dạng phôi</label><select id="siSolidShape"><option value="round">Tròn đặc (Φ × Dài)</option><option value="plate">Khối hộp (Dày × Rộng × Dài)</option></select></div>',
      '          <div id="siSolidDiaWrap"><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Đường kính Φ (mm)</label><input type="number" id="siSolidDia" value="50" min="0" step="0.5"></div>',
      '          <div id="siSolidTWrap" style="display:none;"><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Dày T (mm)</label><input type="number" id="siSolidT" value="50" min="0" step="0.5"></div>',
      '          <div id="siSolidWWrap" style="display:none;"><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Rộng W (mm)</label><input type="number" id="siSolidW" value="100" min="0" step="1"></div>',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Dài L (mm)</label><input type="number" id="siSolidL" value="1000" min="0" step="10"></div>',
      '          <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Mác vật liệu</label><input type="text" id="siSolidGrade" list="dlSmartGrades" placeholder="SUS 304, Nhôm 6061..."></div>',
      '        </div>',
      '        <div style="margin-top:8px;font-size:13px;color:#5B21B6;">⚖️ Khối lượng lý thuyết: <strong id="siSolidWeightDisp">0 kg</strong> / phôi</div>',
      '      </div>',
      '      <!-- Panel động theo nhóm: Dao cụ & Vật tư phụ -->',
      '      <div id="siPaneTooling" style="display:none;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;padding:10px 12px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;margin-bottom:12px;">',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Hãng sản xuất</label><input type="text" id="siBrand" list="dlSmartBrands" placeholder="OSG, Korloy..."></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Đường kính / Mã ISO</label><input type="text" id="siIsoDiam" placeholder="Ø10, APMT1604..."></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">ĐVT đóng gói</label><input type="text" id="siPackUnit" placeholder="Hộp, Vỉ..."></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">1 gói = ? lẻ</label><input type="number" id="siPackQty" value="1" min="1" step="1"></div>',
      '        <div style="display:flex;align-items:center;padding-top:16px;"><label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer;"><input type="checkbox" id="siReturnable" style="width:16px;height:16px;"> 🔄 Dụng cụ mượn–trả</label></div>',
      '      </div>',
      '      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">',
      '        <div id="siStockQtyWrap"><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Tồn ban đầu</label><input type="number" id="siStockQty" value="0" min="0" step="0.01"></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Định mức tối thiểu</label><input type="number" id="siMinStock" value="0" min="0"></div>',
      '        <div class="price-only"><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Giá vốn BQ (đ)</label><input type="number" id="siAvgCost" value="0" min="0" step="1000"></div>',
      '        <div><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Vị trí kệ / tủ</label><input type="text" id="siRack" list="dlSmartRacks" placeholder="Kệ A1, Tủ Dao..."></div>',
      '        <div style="grid-column:span 2;"><label style="font-size:11.5px;font-weight:700;display:block;margin-bottom:3px;">Ghi chú</label><input type="text" id="siNotes" placeholder="Ghi chú thêm..."></div>',
      '      </div>',
      '    </div>',
      '    <div class="inv-modal-foot">',
      '      <div style="font-size:12px;color:#64748B;">Trường Mác, ĐVT, Kệ tự nhớ theo dữ liệu kho.</div>',
      '      <div style="display:flex;gap:8px;">',
      '        <button type="button" class="btn btn-soft" id="btnCancelSmartItemModal">Hủy</button>',
      '        <button type="button" class="btn btn-p" id="btnSaveSmartItemModal">💾 Lưu quy cách</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="inv-modal-backdrop" id="modalSafeDeleteItem" aria-hidden="true">',
      '  <div class="inv-modal narrow" style="width:min(560px, 100%);">',
      '    <div class="inv-modal-head">',
      '      <div>',
      '        <h3 style="font-size:16.5px;">🗑️ Dọn Dẹp / Xóa / Gộp Quy Cách</h3>',
      '        <div id="sdItemName" style="font-size:12.5px;color:#0F766E;font-weight:700;margin-top:2px;"></div>',
      '      </div>',
      '      <button type="button" class="btn btn-soft btn-sm" id="btnCloseSafeDelete">✕</button>',
      '    </div>',
      '    <div class="inv-modal-body" id="sdBody">Đang kiểm tra lịch sử giao dịch...</div>',
      '    <div class="inv-modal-foot">',
      '      <span></span>',
      '      <button type="button" class="btn btn-soft" id="btnCancelSafeDelete">Đóng</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');

    var container = document.createElement('div');
    container.innerHTML = html;
    while (container.firstChild) {
      document.body.appendChild(container.firstChild);
    }

    $('btnCloseSmartItemModal').onclick = closeItemModal;
    $('btnCancelSmartItemModal').onclick = closeItemModal;
    $('siGroup').onchange = function () {
      syncSubCats($('siGroup').value);
      syncGroupPanes();
      var gMeta = window.SharedUI && window.SharedUI.getMaterialGroupMeta($('siGroup').value);
      if (CTX.mode === 'create' && gMeta && $('siUnit')) {
        $('siUnit').value = gMeta.defaultUnit;
      }
    };
    $('btnSmartParseSpec').onclick = runSmartParse;
    $('siName').addEventListener('blur', function () {
      if (CTX.mode === 'create' && $('siName').value.trim()) {
        runSmartParse();
      }
    });
    ['siSheetT', 'siSheetW', 'siSheetL', 'siSheetGrade'].forEach(function (id) {
      $(id).addEventListener('input', updateSheetWeightDisp);
    });
    $('siSolidShape').onchange = syncSolidShapeInputs;
    ['siSolidDia', 'siSolidT', 'siSolidW', 'siSolidL', 'siSolidGrade'].forEach(function (id) {
      $(id).addEventListener('input', updateSolidWeightDisp);
    });
    $('btnSaveSmartItemModal').onclick = handleSaveItemModal;

    $('btnCloseSafeDelete').onclick = closeSafeDeleteModal;
    $('btnCancelSafeDelete').onclick = closeSafeDeleteModal;
  }

  function syncSubCats(grp, preferred) {
    var sel = $('siSubCat');
    if (!sel) return;
    var map = (window.SharedUI && window.SharedUI.SUB_CATEGORIES) || {};
    var list = Object.values(map).filter(function (sc) {
      return sc.group === grp || sc.group === 'all';
    });
    sel.innerHTML = list.map(function (sc) {
      return '<option value="' + escapeHtml(sc.key) + '">' + escapeHtml(sc.label) + '</option>';
    }).join('');
    if (preferred && list.some(function (sc) { return sc.key === preferred; })) {
      sel.value = preferred;
    }
  }

  function syncSolidShapeInputs() {
    var shape = $('siSolidShape').value;
    var isRound = shape === 'round';
    $('siSolidDiaWrap').style.display = isRound ? '' : 'none';
    $('siSolidTWrap').style.display = isRound ? 'none' : '';
    $('siSolidWWrap').style.display = isRound ? 'none' : '';
    updateSolidWeightDisp();
  }

  function syncGroupPanes() {
    var grp = $('siGroup').value;
    $('siPaneTube').style.display = grp === 'tube_1d' ? 'grid' : 'none';
    $('siPaneSheet').style.display = grp === 'sheet_2d' ? 'block' : 'none';
    $('siPaneSolid').style.display = grp === 'solid_cnc' ? 'block' : 'none';
    $('siPaneTooling').style.display = (grp === 'tooling' || grp === 'consumable') ? 'grid' : 'none';
    if (grp === 'sheet_2d') updateSheetWeightDisp();
    if (grp === 'solid_cnc') syncSolidShapeInputs();
  }

  function updateSheetWeightDisp() {
    if (!window.SharedUI || !window.SharedUI.calcMaterialWeightKg) return;
    var kg = window.SharedUI.calcMaterialWeightKg({
      shape: 'plate',
      thicknessMm: Number($('siSheetT').value || 0),
      widthMm: Number($('siSheetW').value || 0),
      lengthMm: Number($('siSheetL').value || 0),
      grade: $('siSheetGrade').value.trim() || 'SS400'
    });
    $('siSheetWeightDisp').textContent = numVN(kg, 2) + ' kg';
  }

  function updateSolidWeightDisp() {
    if (!window.SharedUI || !window.SharedUI.calcMaterialWeightKg) return;
    var shape = $('siSolidShape').value;
    var kg = window.SharedUI.calcMaterialWeightKg({
      shape: shape,
      diameterMm: Number($('siSolidDia').value || 0),
      thicknessMm: Number($('siSolidT').value || 0),
      widthMm: Number($('siSolidW').value || 0),
      lengthMm: Number($('siSolidL').value || 0),
      grade: $('siSolidGrade').value.trim() || 'SS400'
    });
    $('siSolidWeightDisp').textContent = numVN(kg, 2) + ' kg';
  }

  function runSmartParse() {
    if (!window.SharedUI || typeof window.SharedUI.parseSmartMaterialSpec !== 'function') return;
    var raw = ($('siName').value || '').trim();
    if (!raw) return;
    var parsed = window.SharedUI.parseSmartMaterialSpec(raw);
    $('siGroup').value = parsed.materialGroup;
    syncSubCats(parsed.materialGroup, parsed.subCategory);
    syncGroupPanes();
    if (parsed.unit) $('siUnit').value = parsed.unit;

    if (parsed.materialGroup === 'sheet_2d') {
      if (parsed.thicknessMm > 0) $('siSheetT').value = String(parsed.thicknessMm);
      if (parsed.widthMm > 0) $('siSheetW').value = String(parsed.widthMm);
      if (parsed.lengthMm > 0) $('siSheetL').value = String(parsed.lengthMm);
      if (parsed.materialGrade) $('siSheetGrade').value = parsed.materialGrade;
      updateSheetWeightDisp();
    } else if (parsed.materialGroup === 'solid_cnc') {
      if (parsed.subCategory === 'phoi_khoi_cn') {
        $('siSolidShape').value = 'plate';
        if (parsed.thicknessMm > 0) $('siSolidT').value = String(parsed.thicknessMm);
        if (parsed.widthMm > 0) $('siSolidW').value = String(parsed.widthMm);
      } else {
        $('siSolidShape').value = 'round';
        if (parsed.diameterMm > 0) $('siSolidDia').value = String(parsed.diameterMm);
      }
      if (parsed.lengthMm > 0) $('siSolidL').value = String(parsed.lengthMm);
      if (parsed.materialGrade) $('siSolidGrade').value = parsed.materialGrade;
      syncSolidShapeInputs();
    } else if (parsed.materialGroup === 'tube_1d') {
      $('siSectionSpec').value = parsed.sectionSpec || '';
      $('siStdLen').value = String(parsed.standardLengthMm || 6000);
      if (parsed.materialGrade) $('siTubeGrade').value = parsed.materialGrade;
      if (window.SupabaseDB && typeof window.SupabaseDB.estimateSteelWeightPerM === 'function') {
        var est = window.SupabaseDB.estimateSteelWeightPerM(raw);
        if (est > 0) $('siWeightPerM').value = String(est);
      }
    }
    toast('✨ Đã phân tích quy cách: ' + (window.SharedUI.getMaterialGroupMeta(parsed.materialGroup).shortLabel));
  }

  function closeItemModal() {
    var m = $('modalSmartInventoryItem');
    if (m) m.classList.remove('open');
  }

  function openItemModal(mode, item, ctx) {
    ensureModalsInjected();
    CTX.mode = mode === 'edit' ? 'edit' : 'create';
    CTX.item = item || null;
    CTX.inventoryItems = (ctx && ctx.inventoryItems) || [];
    CTX.currentUser = (ctx && ctx.currentUser) || null;
    CTX.onSaved = (ctx && ctx.onSaved) || null;

    populateDatalists(CTX.inventoryItems);

    if (CTX.mode === 'edit' && CTX.item) {
      var r = CTX.item;
      var sp = r.specJson || {};
      $('siModalTitle').textContent = '✏️ Sửa Quy Cách: ' + r.profileName;
      $('siName').value = r.profileName || '';
      $('siGroup').value = r.materialGroup || 'tube_1d';
      syncSubCats($('siGroup').value, r.subCategory || '');
      $('siUnit').value = r.unit || 'cây';
      $('siSku').value = r.sku || '';
      $('siStockQtyWrap').style.display = 'none';
      $('siMinStock').value = String(Number(r.minStockQty) || 0);
      $('siAvgCost').value = String(Number(r.avgCost != null ? r.avgCost : r.unitPrice) || 0);
      $('siRack').value = r.rackLocation || '';
      $('siNotes').value = r.notes || '';

      $('siSectionSpec').value = sp.section_spec || '';
      $('siStdLen').value = String(Number(r.standardLengthMm || r.standardLength) || 6000);
      $('siTubeGrade').value = sp.material_grade || '';
      $('siWeightPerM').value = String(Number(r.weightPerM) || 0);

      $('siSheetT').value = String(Number(sp.thickness_mm) || 2);
      $('siSheetW').value = String(Number(sp.width_mm) || 1220);
      $('siSheetL').value = String(Number(sp.length_mm || r.standardLengthMm) || 2440);
      $('siSheetGrade').value = sp.material_grade || '';

      $('siSolidShape').value = sp.shape === 'plate' ? 'plate' : 'round';
      $('siSolidDia').value = String(Number(sp.diameter_mm) || 50);
      $('siSolidT').value = String(Number(sp.thickness_mm) || 50);
      $('siSolidW').value = String(Number(sp.width_mm) || 100);
      $('siSolidL').value = String(Number(sp.length_mm || r.standardLengthMm) || 1000);
      $('siSolidGrade').value = sp.material_grade || '';

      $('siBrand').value = r.brand || '';
      $('siIsoDiam').value = sp.diameter || sp.code_iso || '';
      $('siPackUnit').value = r.packUnit || '';
      $('siPackQty').value = String(Number(r.packQty) || 1);
      $('siReturnable').checked = Boolean(r.isReturnable);
    } else {
      $('siModalTitle').textContent = '✨ Thêm Quy Cách Vật Tư Mới';
      $('siName').value = '';
      $('siGroup').value = 'tube_1d';
      syncSubCats('tube_1d', 'hop_vuong_cn');
      $('siUnit').value = 'cây';
      $('siSku').value = '';
      $('siStockQtyWrap').style.display = '';
      $('siStockQty').value = '0';
      $('siMinStock').value = '0';
      $('siAvgCost').value = '0';
      $('siRack').value = '';
      $('siNotes').value = '';
      $('siSectionSpec').value = '';
      $('siStdLen').value = '6000';
      $('siTubeGrade').value = '';
      $('siWeightPerM').value = '0';
      $('siSheetT').value = '2';
      $('siSheetW').value = '1220';
      $('siSheetL').value = '2440';
      $('siSheetGrade').value = 'SS400';
      $('siSolidShape').value = 'round';
      $('siSolidDia').value = '50';
      $('siSolidT').value = '50';
      $('siSolidW').value = '100';
      $('siSolidL').value = '1000';
      $('siSolidGrade').value = 'SS400';
      $('siBrand').value = '';
      $('siIsoDiam').value = '';
      $('siPackUnit').value = '';
      $('siPackQty').value = '1';
      $('siReturnable').checked = false;
    }

    syncGroupPanes();
    $('modalSmartInventoryItem').classList.add('open');
    setTimeout(function () { $('siName').focus(); }, 40);
  }

  async function handleSaveItemModal() {
    var name = ($('siName').value || '').trim();
    if (!name) {
      alert('Vui lòng nhập Tên / Quy cách vật tư!');
      return;
    }
    var grp = $('siGroup').value;
    var subCat = $('siSubCat').value || '';
    var unit = ($('siUnit').value || '').trim() || 'cây';
    var sku = ($('siSku').value || '').trim();
    var minStock = Math.max(0, Math.round(Number($('siMinStock').value) || 0));
    var avgCost = Math.max(0, Number($('siAvgCost').value) || 0);
    var rack = ($('siRack').value || '').trim();
    var notes = ($('siNotes').value || '').trim();

    var stdLen = 6000;
    var weightPerM = 0;
    var specJson = {};
    var brand = '';
    var packUnit = '';
    var packQty = 1;
    var isReturnable = false;

    if (grp === 'tube_1d') {
      stdLen = Math.max(1, Number($('siStdLen').value) || 6000);
      weightPerM = Math.max(0, Number($('siWeightPerM').value) || 0);
      specJson = {
        shape: 'tube',
        section_spec: ($('siSectionSpec').value || '').trim(),
        material_grade: ($('siTubeGrade').value || '').trim()
      };
    } else if (grp === 'sheet_2d') {
      var t = Math.max(0, Number($('siSheetT').value) || 0);
      var w = Math.max(0, Number($('siSheetW').value) || 0);
      var l = Math.max(1, Number($('siSheetL').value) || 2440);
      var gSheet = ($('siSheetGrade').value || '').trim() || 'SS400';
      var kgSheet = window.SharedUI ? window.SharedUI.calcMaterialWeightKg({ shape: 'plate', thicknessMm: t, widthMm: w, lengthMm: l, grade: gSheet }) : 0;
      stdLen = l;
      weightPerM = kgSheet;
      specJson = { shape: 'plate', material_grade: gSheet, thickness_mm: t, width_mm: w, length_mm: l, weight_kg: kgSheet };
    } else if (grp === 'solid_cnc') {
      var solidShape = $('siSolidShape').value;
      var sL = Math.max(1, Number($('siSolidL').value) || 1000);
      var gSolid = ($('siSolidGrade').value || '').trim() || 'SS400';
      var sDia = Math.max(0, Number($('siSolidDia').value) || 0);
      var sT = Math.max(0, Number($('siSolidT').value) || 0);
      var sW = Math.max(0, Number($('siSolidW').value) || 0);
      var kgSolid = window.SharedUI ? window.SharedUI.calcMaterialWeightKg({
        shape: solidShape, diameterMm: sDia, thicknessMm: sT, widthMm: sW, lengthMm: sL, grade: gSolid
      }) : 0;
      stdLen = sL;
      weightPerM = kgSolid;
      specJson = solidShape === 'round'
        ? { shape: 'round', material_grade: gSolid, diameter_mm: sDia, length_mm: sL, weight_kg: kgSolid }
        : { shape: 'plate', material_grade: gSolid, thickness_mm: sT, width_mm: sW, length_mm: sL, weight_kg: kgSolid };
    } else {
      stdLen = 100;
      brand = ($('siBrand').value || '').trim();
      packUnit = ($('siPackUnit').value || '').trim();
      packQty = Math.max(1, Number($('siPackQty').value) || 1);
      isReturnable = Boolean($('siReturnable').checked);
      var iso = ($('siIsoDiam').value || '').trim();
      if (iso) specJson = { diameter: iso };
    }

    window.SupabaseDB.setLoading(true, 'Đang lưu quy cách vật tư...');
    try {
      if (CTX.mode === 'edit' && CTX.item) {
        await window.SupabaseDB.updateInventoryProfile(CTX.item.id || CTX.item.profileName, {
          profileName: name,
          materialGroup: grp,
          subCategory: subCat,
          unit: unit,
          sku: sku,
          standardLengthMm: stdLen,
          weightPerM: weightPerM,
          avgCost: avgCost,
          unitPrice: avgCost,
          minStockQty: minStock,
          rackLocation: rack,
          notes: notes,
          brand: brand,
          packUnit: packUnit,
          packQty: packQty,
          isReturnable: isReturnable,
          specJson: specJson
        });
        toast('✓ Đã cập nhật quy cách "' + name + '"');
      } else {
        var initQty = Math.max(0, Number($('siStockQty').value) || 0);
        await window.SupabaseDB.addProfile(name, {
          materialGroup: grp,
          subCategory: subCat,
          unit: unit,
          sku: sku,
          standardLengthMm: stdLen,
          weightPerM: weightPerM,
          avgCost: avgCost,
          unitPrice: avgCost,
          minStockQty: minStock,
          rackLocation: rack,
          notes: notes,
          brand: brand,
          packUnit: packUnit,
          packQty: packQty,
          isReturnable: isReturnable,
          specJson: specJson,
          stockQty: initQty,
          isActive: true
        });
        if (initQty > 0) {
          await window.SupabaseDB.addInventoryTransaction({
            txType: 'opening_balance',
            profile: name,
            lengthMm: stdLen,
            qtyChange: initQty,
            balanceAfter: initQty,
            note: 'Tồn ban đầu khi khai báo quy cách mới',
            createdBy: (CTX.currentUser && CTX.currentUser.username) || ''
          }).catch(function () {});
        }
        toast('✓ Đã thêm quy cách mới "' + name + '"');
      }
      closeItemModal();
      if (typeof CTX.onSaved === 'function') await CTX.onSaved();
    } catch (err) {
      toast('❌ Lỗi lưu quy cách: ' + err.message);
    } finally {
      window.SupabaseDB.setLoading(false);
    }
  }

  function closeSafeDeleteModal() {
    var m = $('modalSafeDeleteItem');
    if (m) m.classList.remove('open');
  }

  async function openSafeDeleteModal(item, ctx) {
    ensureModalsInjected();
    if (!item || !item.id) return;
    CTX.item = item;
    CTX.inventoryItems = (ctx && ctx.inventoryItems) || [];
    CTX.onSaved = (ctx && ctx.onSaved) || null;

    $('sdItemName').textContent = item.profileName + (item.sku ? ' (' + item.sku + ')' : '');
    $('sdBody').innerHTML = '<div style="text-align:center;padding:24px;color:#64748B;">⏳ Đang kiểm tra lịch sử chứng từ &amp; sổ cái...</div>';
    $('modalSafeDeleteItem').classList.add('open');

    try {
      var u = await window.SupabaseDB.checkInventoryUsage(item.id);
      var activeTargets = CTX.inventoryItems.filter(function (x) {
        return x.id !== item.id && x.isActive !== false;
      });
      var targetOpts = activeTargets.map(function (x) {
        return '<option value="' + escapeHtml(x.id) + '">' + escapeHtml(x.profileName) + ' (Tồn: ' + numVN(x.stockQty) + ' ' + escapeHtml(x.unit || 'cây') + ')</option>';
      }).join('');

      var vCount = Number(u.approved_voucher_items || 0) + Number(u.pending_voucher_items || 0);
      var reqCount = Number(u.project_request_count || 0);
      var nzTx = Number(u.non_zero_opening_tx_count || 0);

      $('sdBody').innerHTML = [
        '<div style="padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:12px;font-size:13px;line-height:1.6;">',
        '  <div>📦 Tồn kho hiện tại: <b>' + numVN(u.stock_qty) + ' ' + escapeHtml(u.unit || 'cây') + '</b></div>',
        '  <div>🧾 Chứng từ kho (PNK/PXK): <b>' + vCount + '</b> dòng · 📋 Dự án BOM: <b>' + reqCount + '</b> · 📒 Sổ cái: <b>' + (u.tx_count || 0) + '</b> dòng</div>',
        '</div>',
        '<div style="display:flex;flex-direction:column;gap:10px;">',
        '  <div style="padding:10px 12px;border:1px solid ' + (u.can_hard_delete ? '#FECACA' : '#E2E8F0') + ';border-radius:10px;background:' + (u.can_hard_delete ? '#FEF2F2' : '#F8FAFC') + ';">',
        '    <div style="font-weight:800;color:#991B1B;margin-bottom:4px;">1. Xóa vĩnh viễn (Hard Delete)</div>',
        u.can_hard_delete
          ? ('<div style="font-size:12px;color:#7F1D1D;margin-bottom:8px;">Tồn kho = 0 và chưa có chứng từ PNK/PXK hoặc BOM dự án.</div>' +
             (nzTx > 0 ? '<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="chkSdForceLogs"> Dọn sạch cả ' + nzTx + ' dòng sổ cái test/nhập sai cũ</label>' : '') +
             '<button type="button" class="btn btn-sm btn-danger" id="btnSdHardDelete">🗑️ Xóa vĩnh viễn khỏi hệ thống</button>')
          : '<div style="font-size:12px;color:#64748B;">Không thể xóa vĩnh viễn vì còn tồn kho hoặc đã phát sinh chứng từ/dự án. Hãy dùng mức 2 hoặc mức 3 bên dưới.</div>',
        '  </div>',
        '  <div style="padding:10px 12px;border:1px solid #FDE68A;border-radius:10px;background:#FFFBEB;">',
        '    <div style="font-weight:800;color:#92400E;margin-bottom:4px;">2. Ngừng sử dụng / Ẩn khỏi kho (Archive)</div>',
        '    <div style="font-size:12px;color:#78350F;margin-bottom:8px;">Ẩn khỏi bảng kho &amp; dropdown lập phiếu nhưng giữ nguyên 100% số liệu báo cáo NXT / Giá vốn dự án cũ.</div>',
        '    <button type="button" class="btn btn-sm btn-cta" id="btnSdArchive">🗄️ Ngừng sử dụng (Ẩn khỏi kho)</button>',
        '  </div>',
        '  <div style="padding:10px 12px;border:1px solid #99F6E4;border-radius:10px;background:#F0FDFA;">',
        '    <div style="font-weight:800;color:#0F766E;margin-bottom:4px;">3. Gộp sang quy cách chuẩn (Merge)</div>',
        '    <div style="font-size:12px;color:#134E4A;margin-bottom:8px;">Chuyển toàn bộ tồn kho, chứng từ &amp; lịch sử sang mã chuẩn rồi xóa mã cũ:</div>',
        '    <div style="display:flex;gap:8px;flex-wrap:wrap;">',
        '      <select id="selSdMergeTarget" style="flex:1;min-width:180px;">' + targetOpts + '</select>',
        '      <button type="button" class="btn btn-sm btn-p" id="btnSdMerge">🔀 Gộp &amp; Xóa mã này</button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');

      if ($('btnSdHardDelete')) {
        $('btnSdHardDelete').onclick = async function () {
          if (!confirm('Xác nhận XÓA VĨNH VIỄN "' + item.profileName + '"?')) return;
          var force = Boolean($('chkSdForceLogs') && $('chkSdForceLogs').checked);
          window.SupabaseDB.setLoading(true, 'Đang xóa vĩnh viễn...');
          try {
            await window.SupabaseDB.safeDeleteInventoryItem(item.id, 'hard', force);
            closeSafeDeleteModal();
            if (typeof CTX.onSaved === 'function') await CTX.onSaved();
            toast('🗑️ Đã xóa vĩnh viễn "' + item.profileName + '"');
          } catch (err) {
            toast('❌ ' + err.message);
          } finally {
            window.SupabaseDB.setLoading(false);
          }
        };
      }

      if ($('btnSdArchive')) {
        $('btnSdArchive').onclick = async function () {
          window.SupabaseDB.setLoading(true, 'Đang ẩn quy cách...');
          try {
            await window.SupabaseDB.safeDeleteInventoryItem(item.id, 'archive', false);
            closeSafeDeleteModal();
            if (typeof CTX.onSaved === 'function') await CTX.onSaved();
            toast('🗄️ Đã ngừng sử dụng "' + item.profileName + '"');
          } catch (err) {
            toast('❌ ' + err.message);
          } finally {
            window.SupabaseDB.setLoading(false);
          }
        };
      }

      if ($('btnSdMerge')) {
        $('btnSdMerge').onclick = async function () {
          var targetId = $('selSdMergeTarget') ? $('selSdMergeTarget').value : '';
          if (!targetId) return;
          if (!confirm('Gộp toàn bộ tồn kho & lịch sử của "' + item.profileName + '" sang mã đã chọn rồi xóa mã này?')) return;
          window.SupabaseDB.setLoading(true, 'Đang gộp quy cách...');
          try {
            await window.SupabaseDB.mergeInventoryItems(item.id, targetId);
            closeSafeDeleteModal();
            if (typeof CTX.onSaved === 'function') await CTX.onSaved();
            toast('🔀 Đã gộp quy cách thành công!');
          } catch (err) {
            toast('❌ ' + err.message);
          } finally {
            window.SupabaseDB.setLoading(false);
          }
        };
      }
    } catch (err) {
      $('sdBody').innerHTML = '<div style="padding:18px;color:#B4232C;">❌ Lỗi kiểm tra: ' + escapeHtml(err.message) + '</div>';
    }
  }

  async function handleBulkDelete(selectedIds, ctx) {
    var ids = Array.isArray(selectedIds) ? selectedIds.filter(Boolean) : [];
    if (!ids.length) {
      toast('⚠️ Vui lòng tick chọn ít nhất 1 quy cách để xóa/ẩn!');
      return;
    }
    window.SupabaseDB.setLoading(true, 'Đang kiểm tra ' + ids.length + ' quy cách...');
    try {
      var usages = await Promise.all(ids.map(function (id) {
        return window.SupabaseDB.checkInventoryUsage(id).catch(function () {
          return { id: id, can_hard_delete: false, stock_qty: 0 };
        });
      }));
      window.SupabaseDB.setLoading(false);

      var hardList = usages.filter(function (u) { return u.can_hard_delete; });
      var archiveList = usages.filter(function (u) { return !u.can_hard_delete; });
      var msg = 'Xử lý hàng loạt ' + ids.length + ' quy cách:\n' +
        '- ' + hardList.length + ' mã đủ điều kiện Xóa vĩnh viễn\n' +
        '- ' + archiveList.length + ' mã có tồn/lịch sử sẽ chuyển sang Ẩn (Ngừng sử dụng)\n\nTiếp tục?';
      if (!confirm(msg)) return;

      window.SupabaseDB.setLoading(true, 'Đang dọn dẹp quy cách...');
      for (var i = 0; i < usages.length; i++) {
        var u = usages[i];
        await window.SupabaseDB.safeDeleteInventoryItem(u.id, u.can_hard_delete ? 'hard' : 'archive', true);
      }
      if (ctx && typeof ctx.onSaved === 'function') await ctx.onSaved();
      toast('✓ Đã xử lý ' + usages.length + ' quy cách (Xóa: ' + hardList.length + ', Ẩn: ' + archiveList.length + ')');
    } catch (err) {
      toast('❌ Lỗi xóa hàng loạt: ' + err.message);
    } finally {
      window.SupabaseDB.setLoading(false);
    }
  }

  window.InventorySmart = {
    openItemModal: openItemModal,
    openSafeDeleteModal: openSafeDeleteModal,
    handleBulkDelete: handleBulkDelete
  };
})();
