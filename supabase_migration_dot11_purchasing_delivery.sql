-- ============================================================================
-- Xếp Phôi An Bình · SQL Migration Đợt 11 (Khép kín Chuỗi Cung Ứng WMS)
-- Phân hệ Mua hàng (PR -> PO -> PNK) & Kho Thành phẩm / Giao hàng (PNTP -> PXGH)
-- Chạy file này trong Supabase SQL Editor.
-- ============================================================================

-- 0. Nền tảng Khóa kỳ kế toán & Audit Log (IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS public.wms_period_locks (
  period_ym TEXT PRIMARY KEY,
  is_locked BOOLEAN NOT NULL DEFAULT TRUE,
  locked_by TEXT DEFAULT '',
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.wms_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  actor_username TEXT DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wms_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_period_locks_select ON public.wms_period_locks;
CREATE POLICY wms_period_locks_select ON public.wms_period_locks
  FOR SELECT TO authenticated USING (public.is_workshop_member());

DROP POLICY IF EXISTS wms_period_locks_admin ON public.wms_period_locks;
CREATE POLICY wms_period_locks_admin ON public.wms_period_locks
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant'))
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS wms_audit_logs_select ON public.wms_audit_logs;
CREATE POLICY wms_audit_logs_select ON public.wms_audit_logs
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('admin', 'accountant'));

CREATE OR REPLACE FUNCTION public._assert_period_unlocked(p_ts TIMESTAMPTZ DEFAULT NOW())
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ym TEXT := to_char(COALESCE(p_ts, NOW()) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM');
  v_locked BOOLEAN := FALSE;
BEGIN
  SELECT is_locked INTO v_locked
  FROM public.wms_period_locks
  WHERE period_ym = v_ym;

  IF COALESCE(v_locked, FALSE) THEN
    RAISE EXCEPTION 'Kỳ kế toán % đã bị khóa sổ, không thể duyệt hoặc hủy chứng từ!', v_ym;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._write_wms_audit_log(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_actor TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.wms_audit_logs (action, entity_type, entity_id, actor_username, details)
  VALUES (
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(NULLIF(btrim(p_actor), ''), public.get_my_username(), 'system'),
    COALESCE(p_details, '{}'::jsonb)
  );
END;
$$;

-- ============================================================================
-- A. QUY TRÌNH MUA HÀNG (PR -> PO -> PNK)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  department TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  needed_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'ordered', 'rejected', 'cancelled')),
  reject_reason TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE SET NULL,
  project_request_id UUID,
  item_name TEXT NOT NULL,
  spec_text TEXT DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'cái',
  requested_qty NUMERIC NOT NULL CHECK (requested_qty > 0),
  ordered_qty NUMERIC NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  estimated_price NUMERIC NOT NULL DEFAULT 0 CHECK (estimated_price >= 0),
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_code TEXT NOT NULL UNIQUE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  pr_id UUID REFERENCES public.purchase_requests(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'partial_received', 'completed', 'cancelled')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  payment_terms TEXT DEFAULT '',
  delivery_terms TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  pr_item_id UUID REFERENCES public.purchase_request_items(id) ON DELETE SET NULL,
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'cái',
  ordered_qty NUMERIC NOT NULL CHECK (ordered_qty > 0),
  received_qty NUMERIC NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_price NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note TEXT DEFAULT ''
);

ALTER TABLE public.warehouse_vouchers
  ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE public.warehouse_voucher_items
  ADD COLUMN IF NOT EXISTS po_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pr_status ON public.purchase_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders (status, expected_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_po_id ON public.warehouse_vouchers (po_id);
CREATE INDEX IF NOT EXISTS idx_voucher_items_po_item_id ON public.warehouse_voucher_items (po_item_id);

-- Helper đồng bộ số lượng đã nhận trên purchase_order_items & trạng thái purchase_orders
CREATE OR REPLACE FUNCTION public._sync_po_item_received(
  p_po_item_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_id UUID;
  v_total_items INTEGER := 0;
  v_completed_items INTEGER := 0;
  v_any_received BOOLEAN := FALSE;
  v_next_status TEXT;
BEGIN
  IF p_po_item_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.purchase_order_items
  SET received_qty = GREATEST(0, COALESCE(received_qty, 0) + COALESCE(p_delta, 0))
  WHERE id = p_po_item_id
  RETURNING po_id INTO v_po_id;

  IF v_po_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE COALESCE(received_qty, 0) >= COALESCE(ordered_qty, 0)),
    BOOL_OR(COALESCE(received_qty, 0) > 0)
  INTO v_total_items, v_completed_items, v_any_received
  FROM public.purchase_order_items
  WHERE po_id = v_po_id;

  IF v_total_items > 0 AND v_completed_items = v_total_items THEN
    v_next_status := 'completed';
  ELSIF v_any_received THEN
    v_next_status := 'partial_received';
  ELSE
    v_next_status := 'sent';
  END IF;

  UPDATE public.purchase_orders
  SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE v_next_status END,
      updated_at = NOW()
  WHERE id = v_po_id;
END;
$$;

-- Cập nhật approve_warehouse_voucher để hỗ trợ Khóa kỳ + PO + Audit Log (giữ nguyên toàn bộ logic Đợt 5/7/8)
CREATE OR REPLACE FUNCTION public.approve_warehouse_voucher(p_voucher_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_username TEXT;
  v_voucher public.warehouse_vouchers%ROWTYPE;
  v_item public.warehouse_voucher_items%ROWTYPE;
  v_inv public.inventory%ROWTYPE;
  v_off public.stock_offcuts%ROWTYPE;
  v_item_count INTEGER := 0;
  v_old_qty NUMERIC;
  v_new_qty NUMERIC;
  v_old_cost NUMERIC;
  v_new_avg_cost NUMERIC;
  v_eff_price NUMERIC;
  v_delta NUMERIC;
  v_std_len NUMERIC;
  v_approved_at TIMESTAMPTZ := now();
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Chỉ Admin hoặc Thủ kho mới có quyền duyệt phiếu kho (vai trò hiện tại: %)', COALESCE(v_role, 'chưa đăng nhập');
  END IF;

  v_username := COALESCE(public.get_my_username(), 'warehouse');

  SELECT * INTO v_voucher
  FROM public.warehouse_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy chứng từ ID %', p_voucher_id;
  END IF;

  PERFORM public._assert_period_unlocked(v_approved_at);

  IF v_voucher.status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'Phiếu % đang ở trạng thái "%" — không thể duyệt lại!', v_voucher.voucher_code, v_voucher.status;
  END IF;

  SELECT COUNT(*) INTO v_item_count
  FROM public.warehouse_voucher_items
  WHERE voucher_id = p_voucher_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Phiếu % chưa có dòng vật tư nào!', v_voucher.voucher_code;
  END IF;

  FOR v_item IN
    SELECT * FROM public.warehouse_voucher_items
    WHERE voucher_id = p_voucher_id
    ORDER BY created_at ASC, id ASC
  LOOP
    IF v_voucher.voucher_type = 'OUT' AND v_item.offcut_id IS NOT NULL THEN
      SELECT * INTO v_off FROM public.stock_offcuts WHERE id = v_item.offcut_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy đoạn phôi đề-xê % để xuất kho', COALESCE(v_item.profile, v_item.offcut_id::TEXT);
      END IF;
      v_old_qty := COALESCE(v_off.quantity, 0);
      IF NOT v_voucher.allow_negative AND v_old_qty < v_item.qty THEN
        RAISE EXCEPTION 'Phôi đề-xê "%" (% mm) chỉ còn %, không đủ xuất %',
          v_off.profile, v_off.length_mm, v_old_qty, v_item.qty;
      END IF;
      v_new_qty := GREATEST(0, v_old_qty - v_item.qty);
      UPDATE public.stock_offcuts
      SET quantity = v_new_qty::INTEGER,
          status = CASE WHEN v_new_qty <= 0 THEN 'used' ELSE 'available' END,
          updated_at = v_approved_at
      WHERE id = v_off.id;

      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'offcut_out', v_off.profile, COALESCE(v_off.length_mm, 1000), -v_item.qty, v_new_qty,
        v_voucher.project_id, p_voucher_id, COALESCE(v_item.unit_price, 0),
        COALESCE(NULLIF(v_item.note, ''), 'Xuất đề-xê theo ' || v_voucher.voucher_code), v_username
      );
      IF v_item.project_request_id IS NOT NULL THEN
        PERFORM public._sync_project_request_issued(v_item.project_request_id, v_item.qty);
      END IF;
      CONTINUE;
    END IF;

    v_inv := NULL;
    IF v_item.inventory_id IS NOT NULL THEN
      SELECT * INTO v_inv FROM public.inventory WHERE id = v_item.inventory_id FOR UPDATE;
    END IF;
    IF v_inv.id IS NULL AND COALESCE(btrim(v_item.profile), '') <> '' THEN
      SELECT * INTO v_inv FROM public.inventory WHERE profile_name = btrim(v_item.profile) FOR UPDATE;
    END IF;

    IF v_inv.id IS NULL THEN
      IF v_voucher.voucher_type IN ('IN', 'RETURN', 'ADJUST') THEN
        v_std_len := COALESCE(NULLIF(v_item.length_mm, 0), 6000);
        INSERT INTO public.inventory (
          profile_name, category, material_group, unit,
          standard_length, standard_length_mm, stock_qty,
          unit_price, avg_cost, notes, is_default
        ) VALUES (
          btrim(v_item.profile),
          CASE WHEN v_item.profile ~* '(Ø|phi|ống|ong)' THEN 'round' ELSE 'other' END,
          COALESCE(v_item.material_group, 'tube_1d'),
          COALESCE(v_item.unit, 'cây'),
          v_std_len, v_std_len, 0,
          COALESCE(v_item.unit_price, 0), COALESCE(v_item.unit_price, 0),
          'Tự động tạo từ chứng từ ' || v_voucher.voucher_code, FALSE
        )
        ON CONFLICT (profile_name) DO UPDATE SET updated_at = v_approved_at
        RETURNING * INTO v_inv;
      ELSE
        RAISE EXCEPTION 'Vật tư "%" chưa có trong kho để xuất!', v_item.profile;
      END IF;
    END IF;

    v_old_qty := COALESCE(v_inv.stock_qty, 0);
    v_old_cost := COALESCE(NULLIF(v_inv.avg_cost, 0), v_inv.unit_price, 0);
    v_std_len := COALESCE(NULLIF(v_item.length_mm, 0), v_inv.standard_length_mm, v_inv.standard_length, 6000);

    IF v_voucher.voucher_type = 'IN' THEN
      v_new_qty := v_old_qty + v_item.qty;
      v_eff_price := COALESCE(v_item.unit_price, 0);
      IF v_eff_price > 0 THEN
        v_new_avg_cost := ROUND(((GREATEST(v_old_qty, 0) * v_old_cost) + (v_item.qty * v_eff_price)) / NULLIF(GREATEST(v_old_qty, 0) + v_item.qty, 0), 2);
      ELSE
        v_new_avg_cost := v_old_cost;
      END IF;
      UPDATE public.inventory
      SET stock_qty = v_new_qty, avg_cost = COALESCE(v_new_avg_cost, 0),
          unit_price = CASE WHEN v_eff_price > 0 THEN v_eff_price ELSE unit_price END,
          updated_at = v_approved_at
      WHERE id = v_inv.id;
      UPDATE public.warehouse_voucher_items
      SET inventory_id = v_inv.id, total_amount = ROUND(v_item.qty * v_eff_price, 2)
      WHERE id = v_item.id;
      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'voucher_in', v_inv.profile_name, v_std_len, v_item.qty, v_new_qty,
        v_voucher.project_id, p_voucher_id, v_eff_price,
        COALESCE(NULLIF(v_item.note, ''), 'Nhập kho theo ' || v_voucher.voucher_code), v_username
      );

      IF v_item.po_item_id IS NOT NULL THEN
        PERFORM public._sync_po_item_received(v_item.po_item_id, v_item.qty);
      END IF;

    ELSIF v_voucher.voucher_type = 'OUT' THEN
      IF NOT v_voucher.allow_negative AND v_old_qty < v_item.qty THEN
        RAISE EXCEPTION 'Không đủ tồn kho "%": hiện còn % %, yêu cầu xuất % %',
          v_inv.profile_name, v_old_qty, v_inv.unit, v_item.qty, v_inv.unit;
      END IF;
      v_new_qty := GREATEST(0, v_old_qty - v_item.qty);
      v_eff_price := v_old_cost;
      UPDATE public.inventory SET stock_qty = v_new_qty, updated_at = v_approved_at WHERE id = v_inv.id;
      UPDATE public.warehouse_voucher_items
      SET inventory_id = v_inv.id, unit_price = v_eff_price, total_amount = ROUND(v_item.qty * v_eff_price, 2)
      WHERE id = v_item.id;
      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'voucher_out', v_inv.profile_name, v_std_len, -v_item.qty, v_new_qty,
        v_voucher.project_id, p_voucher_id, v_eff_price,
        COALESCE(NULLIF(v_item.note, ''), 'Xuất kho theo ' || v_voucher.voucher_code), v_username
      );
      IF v_item.project_request_id IS NOT NULL THEN
        PERFORM public._sync_project_request_issued(v_item.project_request_id, v_item.qty);
      END IF;

    ELSIF v_voucher.voucher_type = 'RETURN' THEN
      IF v_inv.material_group = 'tube_1d' AND v_item.length_mm IS NOT NULL AND v_item.length_mm < COALESCE(v_inv.standard_length_mm, 6000) THEN
        INSERT INTO public.stock_offcuts (
          profile, length_mm, quantity, source_project_id, source_project_name,
          source_bar_key, source_type, rack_location, status, note, notes, created_by
        ) VALUES (
          v_inv.profile_name, v_item.length_mm, GREATEST(1, ROUND(v_item.qty)::INTEGER),
          v_voucher.project_id, COALESCE(v_voucher.department, ''), '', 'cnc_return',
          v_inv.rack_location, 'available', 'Hoàn kho đề-xê theo ' || v_voucher.voucher_code,
          'Hoàn kho đề-xê theo ' || v_voucher.voucher_code, v_username
        ) RETURNING * INTO v_off;
        UPDATE public.warehouse_voucher_items
        SET inventory_id = v_inv.id, offcut_id = v_off.id, unit_price = v_old_cost, total_amount = ROUND(v_item.qty * v_old_cost, 2)
        WHERE id = v_item.id;
        INSERT INTO public.inventory_transactions (
          tx_type, profile, length_mm, qty_change, balance_after,
          project_id, voucher_id, unit_price, note, created_by
        ) VALUES (
          'offcut_in', v_inv.profile_name, v_item.length_mm, v_item.qty, GREATEST(1, ROUND(v_item.qty)::INTEGER),
          v_voucher.project_id, p_voucher_id, v_old_cost,
          COALESCE(NULLIF(v_item.note, ''), 'Hoàn phôi đề-xê theo ' || v_voucher.voucher_code), v_username
        );
      ELSE
        v_new_qty := v_old_qty + v_item.qty;
        UPDATE public.inventory SET stock_qty = v_new_qty, updated_at = v_approved_at WHERE id = v_inv.id;
        UPDATE public.warehouse_voucher_items
        SET inventory_id = v_inv.id, unit_price = v_old_cost, total_amount = ROUND(v_item.qty * v_old_cost, 2)
        WHERE id = v_item.id;
        INSERT INTO public.inventory_transactions (
          tx_type, profile, length_mm, qty_change, balance_after,
          project_id, voucher_id, unit_price, note, created_by
        ) VALUES (
          'voucher_return', v_inv.profile_name, v_std_len, v_item.qty, v_new_qty,
          v_voucher.project_id, p_voucher_id, v_old_cost,
          COALESCE(NULLIF(v_item.note, ''), 'Hoàn kho nguyên vật tư theo ' || v_voucher.voucher_code), v_username
        );
      END IF;
      IF v_item.project_request_id IS NOT NULL THEN
        PERFORM public._sync_project_request_issued(v_item.project_request_id, -v_item.qty);
      END IF;

    ELSIF v_voucher.voucher_type = 'ADJUST' THEN
      v_new_qty := GREATEST(0, v_item.qty);
      v_delta := v_new_qty - v_old_qty;
      UPDATE public.inventory SET stock_qty = v_new_qty, updated_at = v_approved_at WHERE id = v_inv.id;
      UPDATE public.warehouse_voucher_items
      SET inventory_id = v_inv.id, unit_price = v_old_cost, total_amount = ROUND(ABS(v_delta) * v_old_cost, 2)
      WHERE id = v_item.id;
      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'voucher_adjust', v_inv.profile_name, v_std_len, v_delta, v_new_qty,
        v_voucher.project_id, p_voucher_id, v_old_cost,
        COALESCE(NULLIF(v_item.note, ''), 'Điều chỉnh kiểm kê theo ' || v_voucher.voucher_code), v_username
      );
    END IF;
  END LOOP;

  UPDATE public.warehouse_vouchers
  SET status = 'approved',
      approved_by = v_username,
      approved_by_uid = auth.uid(),
      approved_at = v_approved_at,
      updated_at = v_approved_at
  WHERE id = p_voucher_id;

  PERFORM public._write_wms_audit_log(
    'approve_voucher',
    'warehouse_vouchers',
    p_voucher_id::TEXT,
    v_username,
    jsonb_build_object('voucher_code', v_voucher.voucher_code, 'voucher_type', v_voucher.voucher_type, 'po_id', v_voucher.po_id)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'voucher_id', p_voucher_id,
    'voucher_code', v_voucher.voucher_code,
    'status', 'approved',
    'approved_by', v_username,
    'approved_at', v_approved_at,
    'items_processed', v_item_count
  );
END;
$$;

-- Cập nhật cancel_warehouse_voucher để hỗ trợ Khóa kỳ + đảo PO + Audit Log
CREATE OR REPLACE FUNCTION public.cancel_warehouse_voucher(
  p_voucher_id UUID,
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_username TEXT;
  v_voucher public.warehouse_vouchers%ROWTYPE;
  v_tx public.inventory_transactions%ROWTYPE;
  v_item public.warehouse_voucher_items%ROWTYPE;
  v_inv public.inventory%ROWTYPE;
  v_off public.stock_offcuts%ROWTYPE;
  v_rev_qty NUMERIC;
  v_new_qty NUMERIC;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT := COALESCE(NULLIF(btrim(p_reason), ''), 'Hủy phiếu kho');
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR NOT public.is_workshop_member() THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập hoặc không thuộc nhân sự xưởng.';
  END IF;
  v_username := COALESCE(public.get_my_username(), '');

  SELECT * INTO v_voucher FROM public.warehouse_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy chứng từ ID %', p_voucher_id;
  END IF;
  IF v_voucher.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu % đã bị hủy trước đó.', v_voucher.voucher_code;
  END IF;

  IF v_voucher.status IN ('draft', 'pending') THEN
    IF v_role NOT IN ('admin', 'warehouse', 'engineer') AND v_voucher.created_by_uid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Bạn không có quyền hủy phiếu chờ duyệt này.';
    END IF;
    UPDATE public.warehouse_vouchers
    SET status = 'cancelled', cancel_reason = v_clean_reason, updated_at = v_now
    WHERE id = p_voucher_id;
    RETURN jsonb_build_object(
      'success', TRUE, 'voucher_id', p_voucher_id, 'voucher_code', v_voucher.voucher_code,
      'status', 'cancelled', 'reversed', FALSE
    );
  END IF;

  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Phiếu % đã được duyệt hạch toán — chỉ Admin mới có quyền hủy và đảo ngược tồn kho!', v_voucher.voucher_code;
  END IF;

  PERFORM public._assert_period_unlocked(COALESCE(v_voucher.approved_at, v_now));

  FOR v_tx IN
    SELECT * FROM public.inventory_transactions
    WHERE voucher_id = p_voucher_id AND tx_type <> 'voucher_cancel_reversal'
    ORDER BY created_at DESC, id DESC
  LOOP
    v_rev_qty := -v_tx.qty_change;
    IF v_tx.tx_type = 'offcut_out' THEN
      SELECT * INTO v_off FROM public.stock_offcuts
      WHERE id IN (SELECT offcut_id FROM public.warehouse_voucher_items WHERE voucher_id = p_voucher_id AND offcut_id IS NOT NULL)
        AND profile = v_tx.profile LIMIT 1 FOR UPDATE;
      IF v_off.id IS NOT NULL THEN
        v_new_qty := GREATEST(0, COALESCE(v_off.quantity, 0) + ABS(v_tx.qty_change));
        UPDATE public.stock_offcuts
        SET quantity = v_new_qty::INTEGER, status = CASE WHEN v_new_qty > 0 THEN 'available' ELSE 'used' END, updated_at = v_now
        WHERE id = v_off.id;
      ELSE
        v_new_qty := ABS(v_tx.qty_change);
      END IF;
    ELSIF v_tx.tx_type = 'offcut_in' THEN
      SELECT * INTO v_off FROM public.stock_offcuts
      WHERE id IN (SELECT offcut_id FROM public.warehouse_voucher_items WHERE voucher_id = p_voucher_id AND offcut_id IS NOT NULL)
        AND profile = v_tx.profile LIMIT 1 FOR UPDATE;
      IF v_off.id IS NOT NULL THEN
        v_new_qty := GREATEST(0, COALESCE(v_off.quantity, 0) - ABS(v_tx.qty_change));
        UPDATE public.stock_offcuts
        SET quantity = v_new_qty::INTEGER, status = CASE WHEN v_new_qty > 0 THEN 'available' ELSE 'used' END, updated_at = v_now
        WHERE id = v_off.id;
      ELSE
        v_new_qty := 0;
      END IF;
    ELSE
      SELECT * INTO v_inv FROM public.inventory WHERE profile_name = v_tx.profile FOR UPDATE;
      IF v_inv.id IS NOT NULL THEN
        v_new_qty := GREATEST(0, COALESCE(v_inv.stock_qty, 0) + v_rev_qty);
        UPDATE public.inventory SET stock_qty = v_new_qty, updated_at = v_now WHERE id = v_inv.id;
      ELSE
        v_new_qty := NULL;
      END IF;
    END IF;

    INSERT INTO public.inventory_transactions (
      tx_type, profile, length_mm, qty_change, balance_after,
      project_id, voucher_id, unit_price, note, created_by
    ) VALUES (
      'voucher_cancel_reversal', v_tx.profile, v_tx.length_mm, v_rev_qty, v_new_qty,
      v_tx.project_id, p_voucher_id, v_tx.unit_price,
      'Đảo kho do Admin hủy phiếu ' || v_voucher.voucher_code || ': ' || v_clean_reason, v_username
    );
  END LOOP;

  FOR v_item IN
    SELECT * FROM public.warehouse_voucher_items
    WHERE voucher_id = p_voucher_id AND project_request_id IS NOT NULL
  LOOP
    IF v_voucher.voucher_type = 'OUT' THEN
      PERFORM public._sync_project_request_issued(v_item.project_request_id, -v_item.qty);
    ELSIF v_voucher.voucher_type = 'RETURN' THEN
      PERFORM public._sync_project_request_issued(v_item.project_request_id, v_item.qty);
    END IF;
  END LOOP;

  -- Đảo ngược received_qty trên purchase_order_items nếu phiếu IN gắn PO
  IF v_voucher.voucher_type = 'IN' THEN
    FOR v_item IN
      SELECT * FROM public.warehouse_voucher_items
      WHERE voucher_id = p_voucher_id AND po_item_id IS NOT NULL
    LOOP
      PERFORM public._sync_po_item_received(v_item.po_item_id, -v_item.qty);
    END LOOP;
  END IF;

  UPDATE public.warehouse_vouchers
  SET status = 'cancelled', cancel_reason = v_clean_reason, updated_at = v_now
  WHERE id = p_voucher_id;

  PERFORM public._write_wms_audit_log(
    'cancel_voucher',
    'warehouse_vouchers',
    p_voucher_id::TEXT,
    v_username,
    jsonb_build_object('voucher_code', v_voucher.voucher_code, 'reason', v_clean_reason)
  );

  RETURN jsonb_build_object(
    'success', TRUE, 'voucher_id', p_voucher_id, 'voucher_code', v_voucher.voucher_code,
    'status', 'cancelled', 'reversed', TRUE
  );
END;
$$;

-- ============================================================================
-- B. KHO THÀNH PHẨM & XUẤT GIAO HÀNG
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.finished_goods_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  fg_code TEXT NOT NULL,
  name TEXT NOT NULL,
  drawing_no TEXT DEFAULT '',
  spec_text TEXT DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'bộ',
  planned_qty NUMERIC NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  produced_qty NUMERIC NOT NULL DEFAULT 0 CHECK (produced_qty >= 0),
  delivered_qty NUMERIC NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
  stock_qty NUMERIC NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  rack_location TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fg_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_code TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  department TEXT DEFAULT '',
  qc_by TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fg_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.fg_receipts(id) ON DELETE CASCADE,
  fg_item_id UUID NOT NULL REFERENCES public.finished_goods_items(id) ON DELETE RESTRICT,
  qty NUMERIC NOT NULL CHECK (qty > 0),
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_code TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  delivery_address TEXT DEFAULT '',
  vehicle_no TEXT DEFAULT '',
  driver_name TEXT DEFAULT '',
  delivery_date DATE DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'delivered', 'cancelled')),
  attachment_url TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_id UUID NOT NULL REFERENCES public.delivery_notes(id) ON DELETE CASCADE,
  fg_item_id UUID NOT NULL REFERENCES public.finished_goods_items(id) ON DELETE RESTRICT,
  fg_code TEXT DEFAULT '',
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'bộ',
  qty NUMERIC NOT NULL CHECK (qty > 0),
  note TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_fg_items_project ON public.finished_goods_items (project_id);
CREATE INDEX IF NOT EXISTS idx_fg_receipts_status ON public.fg_receipts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_status ON public.delivery_notes (status, delivery_date DESC);

-- RPC Nhập kho Thành phẩm (PNTP)
CREATE OR REPLACE FUNCTION public.approve_fg_receipt(p_receipt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.get_my_role();
  v_username TEXT := COALESCE(public.get_my_username(), 'warehouse');
  v_rec public.fg_receipts%ROWTYPE;
  v_it public.fg_receipt_items%ROWTYPE;
  v_cnt INTEGER := 0;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Chỉ Admin hoặc Thủ kho mới được duyệt Nhập kho Thành phẩm';
  END IF;

  SELECT * INTO v_rec FROM public.fg_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu nhập thành phẩm ID %', p_receipt_id;
  END IF;

  PERFORM public._assert_period_unlocked(v_now);

  IF v_rec.status <> 'draft' THEN
    RAISE EXCEPTION 'Phiếu % đang ở trạng thái "%" — không thể duyệt lại!', v_rec.receipt_code, v_rec.status;
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.fg_receipt_items WHERE receipt_id = p_receipt_id;
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'Phiếu % chưa có dòng thành phẩm nào!', v_rec.receipt_code;
  END IF;

  FOR v_it IN SELECT * FROM public.fg_receipt_items WHERE receipt_id = p_receipt_id LOOP
    UPDATE public.finished_goods_items
    SET produced_qty = produced_qty + v_it.qty,
        stock_qty = stock_qty + v_it.qty,
        updated_at = v_now
    WHERE id = v_it.fg_item_id;
  END LOOP;

  UPDATE public.fg_receipts
  SET status = 'approved', approved_by = v_username, approved_at = v_now, updated_at = v_now
  WHERE id = p_receipt_id;

  PERFORM public._write_wms_audit_log('approve_fg_receipt', 'fg_receipts', p_receipt_id::TEXT, v_username,
    jsonb_build_object('receipt_code', v_rec.receipt_code, 'items', v_cnt));

  RETURN jsonb_build_object('success', TRUE, 'id', p_receipt_id, 'status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_fg_receipt(p_receipt_id UUID, p_reason TEXT DEFAULT '')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.get_my_role();
  v_username TEXT := COALESCE(public.get_my_username(), 'admin');
  v_rec public.fg_receipts%ROWTYPE;
  v_it public.fg_receipt_items%ROWTYPE;
  v_fg public.finished_goods_items%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin mới được hủy phiếu Nhập kho Thành phẩm!';
  END IF;

  SELECT * INTO v_rec FROM public.fg_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu nhập thành phẩm ID %', p_receipt_id;
  END IF;
  IF v_rec.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu % đã bị hủy trước đó', v_rec.receipt_code;
  END IF;

  IF v_rec.status = 'approved' THEN
    PERFORM public._assert_period_unlocked(COALESCE(v_rec.approved_at, v_now));
    FOR v_it IN SELECT * FROM public.fg_receipt_items WHERE receipt_id = p_receipt_id LOOP
      SELECT * INTO v_fg FROM public.finished_goods_items WHERE id = v_it.fg_item_id FOR UPDATE;
      IF COALESCE(v_fg.stock_qty, 0) < v_it.qty THEN
        RAISE EXCEPTION 'Thành phẩm "%" chỉ còn tồn % %, không đủ để hủy phiếu nhập %!', v_fg.name, v_fg.stock_qty, v_fg.unit, v_it.qty;
      END IF;
      UPDATE public.finished_goods_items
      SET produced_qty = GREATEST(0, produced_qty - v_it.qty),
          stock_qty = GREATEST(0, stock_qty - v_it.qty),
          updated_at = v_now
      WHERE id = v_fg.id;
    END LOOP;
  END IF;

  UPDATE public.fg_receipts
  SET status = 'cancelled', note = COALESCE(note, '') || CASE WHEN btrim(COALESCE(p_reason, '')) <> '' THEN ' [Hủy: ' || p_reason || ']' ELSE '' END, updated_at = v_now
  WHERE id = p_receipt_id;

  PERFORM public._write_wms_audit_log('cancel_fg_receipt', 'fg_receipts', p_receipt_id::TEXT, v_username,
    jsonb_build_object('receipt_code', v_rec.receipt_code, 'reason', p_reason));

  RETURN jsonb_build_object('success', TRUE, 'id', p_receipt_id, 'status', 'cancelled');
END;
$$;

-- RPC Xuất Giao Hàng (PXGH)
CREATE OR REPLACE FUNCTION public.approve_delivery_note(p_dn_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.get_my_role();
  v_username TEXT := COALESCE(public.get_my_username(), 'warehouse');
  v_dn public.delivery_notes%ROWTYPE;
  v_it public.delivery_note_items%ROWTYPE;
  v_fg public.finished_goods_items%ROWTYPE;
  v_cnt INTEGER := 0;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Chỉ Admin hoặc Thủ kho mới được duyệt Xuất Giao Hàng';
  END IF;

  SELECT * INTO v_dn FROM public.delivery_notes WHERE id = p_dn_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu xuất giao hàng ID %', p_dn_id;
  END IF;

  PERFORM public._assert_period_unlocked(v_now);

  IF v_dn.status <> 'draft' THEN
    RAISE EXCEPTION 'Phiếu % đang ở trạng thái "%" — không thể duyệt lại!', v_dn.dn_code, v_dn.status;
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.delivery_note_items WHERE dn_id = p_dn_id;
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'Phiếu % chưa có dòng thành phẩm nào!', v_dn.dn_code;
  END IF;

  FOR v_it IN SELECT * FROM public.delivery_note_items WHERE dn_id = p_dn_id LOOP
    SELECT * INTO v_fg FROM public.finished_goods_items WHERE id = v_it.fg_item_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Không tìm thấy thành phẩm "%"', v_it.name;
    END IF;
    IF COALESCE(v_fg.stock_qty, 0) < v_it.qty THEN
      RAISE EXCEPTION 'Thành phẩm "%" chỉ còn tồn % %, không đủ xuất giao %!', v_fg.name, v_fg.stock_qty, v_fg.unit, v_it.qty;
    END IF;
    UPDATE public.finished_goods_items
    SET stock_qty = stock_qty - v_it.qty,
        delivered_qty = delivered_qty + v_it.qty,
        updated_at = v_now
    WHERE id = v_fg.id;
  END LOOP;

  UPDATE public.delivery_notes
  SET status = 'approved', approved_by = v_username, approved_at = v_now, updated_at = v_now
  WHERE id = p_dn_id;

  PERFORM public._write_wms_audit_log('approve_delivery_note', 'delivery_notes', p_dn_id::TEXT, v_username,
    jsonb_build_object('dn_code', v_dn.dn_code, 'items', v_cnt));

  RETURN jsonb_build_object('success', TRUE, 'id', p_dn_id, 'status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_delivery_note(p_dn_id UUID, p_reason TEXT DEFAULT '')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.get_my_role();
  v_username TEXT := COALESCE(public.get_my_username(), 'admin');
  v_dn public.delivery_notes%ROWTYPE;
  v_it public.delivery_note_items%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ Admin mới được hủy phiếu Xuất Giao Hàng!';
  END IF;

  SELECT * INTO v_dn FROM public.delivery_notes WHERE id = p_dn_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu xuất giao hàng ID %', p_dn_id;
  END IF;
  IF v_dn.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu % đã bị hủy trước đó', v_dn.dn_code;
  END IF;

  IF v_dn.status IN ('approved', 'delivered') THEN
    PERFORM public._assert_period_unlocked(COALESCE(v_dn.approved_at, v_now));
    FOR v_it IN SELECT * FROM public.delivery_note_items WHERE dn_id = p_dn_id LOOP
      UPDATE public.finished_goods_items
      SET stock_qty = stock_qty + v_it.qty,
          delivered_qty = GREATEST(0, delivered_qty - v_it.qty),
          updated_at = v_now
      WHERE id = v_it.fg_item_id;
    END LOOP;
  END IF;

  UPDATE public.delivery_notes
  SET status = 'cancelled', note = COALESCE(note, '') || CASE WHEN btrim(COALESCE(p_reason, '')) <> '' THEN ' [Hủy: ' || p_reason || ']' ELSE '' END, updated_at = v_now
  WHERE id = p_dn_id;

  PERFORM public._write_wms_audit_log('cancel_delivery_note', 'delivery_notes', p_dn_id::TEXT, v_username,
    jsonb_build_object('dn_code', v_dn.dn_code, 'reason', p_reason));

  RETURN jsonb_build_object('success', TRUE, 'id', p_dn_id, 'status', 'cancelled');
END;
$$;

-- RPC Tổng hợp Dashboard Công ty
CREATE OR REPLACE FUNCTION public.get_company_dashboard_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_skus INTEGER := 0;
  v_low_stock INTEGER := 0;
  v_pending_vouchers INTEGER := 0;
  v_active_projects INTEGER := 0;
  v_pending_prs INTEGER := 0;
  v_open_pos INTEGER := 0;
  v_overdue_pos INTEGER := 0;
  v_fg_stock NUMERIC := 0;
  v_fg_backlog NUMERIC := 0;
BEGIN
  IF NOT public.is_workshop_member() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE COALESCE(is_active, TRUE)),
    COUNT(*) FILTER (WHERE COALESCE(is_active, TRUE) AND (COALESCE(stock_qty, 0) = 0 OR (COALESCE(min_stock_qty, 0) > 0 AND COALESCE(stock_qty, 0) <= min_stock_qty)))
  INTO v_active_skus, v_low_stock
  FROM public.inventory;

  SELECT COUNT(*) INTO v_pending_vouchers FROM public.warehouse_vouchers WHERE status = 'pending';
  SELECT COUNT(*) INTO v_active_projects FROM public.projects WHERE COALESCE(is_trashed, FALSE) = FALSE AND COALESCE(is_draft, FALSE) = FALSE;
  SELECT COUNT(*) INTO v_pending_prs FROM public.purchase_requests WHERE status = 'pending';
  SELECT
    COUNT(*) FILTER (WHERE status IN ('sent', 'partial_received')),
    COUNT(*) FILTER (WHERE status IN ('sent', 'partial_received') AND expected_date IS NOT NULL AND expected_date < CURRENT_DATE)
  INTO v_open_pos, v_overdue_pos
  FROM public.purchase_orders;

  SELECT
    COALESCE(SUM(COALESCE(stock_qty, 0)), 0),
    COALESCE(SUM(GREATEST(0, COALESCE(planned_qty, 0) - COALESCE(delivered_qty, 0))), 0)
  INTO v_fg_stock, v_fg_backlog
  FROM public.finished_goods_items;

  RETURN jsonb_build_object(
    'active_skus', v_active_skus,
    'low_stock', v_low_stock,
    'pending_vouchers', v_pending_vouchers,
    'active_projects', v_active_projects,
    'pending_prs', v_pending_prs,
    'open_pos', v_open_pos,
    'overdue_pos', v_overdue_pos,
    'fg_stock_qty', v_fg_stock,
    'fg_backlog_qty', v_fg_backlog
  );
END;
$$;

-- ============================================================================
-- C. RLS POLICIES & REALTIME
-- ============================================================================
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_goods_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fg_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fg_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_note_items ENABLE ROW LEVEL SECURITY;

-- PR
DROP POLICY IF EXISTS pr_select ON public.purchase_requests;
CREATE POLICY pr_select ON public.purchase_requests FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant', 'warehouse', 'engineer'));
DROP POLICY IF EXISTS pr_insert ON public.purchase_requests;
CREATE POLICY pr_insert ON public.purchase_requests FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant', 'warehouse', 'engineer'));
DROP POLICY IF EXISTS pr_update ON public.purchase_requests;
CREATE POLICY pr_update ON public.purchase_requests FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant', 'warehouse', 'engineer'))
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant', 'warehouse', 'engineer'));
DROP POLICY IF EXISTS pr_delete ON public.purchase_requests;
CREATE POLICY pr_delete ON public.purchase_requests FOR DELETE TO authenticated
  USING (public.get_my_role() = 'admin' OR (public.get_my_role() IN ('accountant', 'warehouse', 'engineer') AND status IN ('draft', 'pending')));

DROP POLICY IF EXISTS pr_items_all ON public.purchase_request_items;
CREATE POLICY pr_items_all ON public.purchase_request_items FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant', 'warehouse', 'engineer'))
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant', 'warehouse', 'engineer'));

-- PO (warehouse được SELECT để đối chiếu xe hàng về; admin & accountant toàn quyền)
DROP POLICY IF EXISTS po_select ON public.purchase_orders;
CREATE POLICY po_select ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant', 'warehouse'));
DROP POLICY IF EXISTS po_write ON public.purchase_orders;
CREATE POLICY po_write ON public.purchase_orders FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant'))
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS po_items_select ON public.purchase_order_items;
CREATE POLICY po_items_select ON public.purchase_order_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant', 'warehouse'));
DROP POLICY IF EXISTS po_items_write ON public.purchase_order_items;
CREATE POLICY po_items_write ON public.purchase_order_items FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant'))
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

-- Kho Thành phẩm & Giao hàng
DROP POLICY IF EXISTS fg_items_select ON public.finished_goods_items;
CREATE POLICY fg_items_select ON public.finished_goods_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse', 'accountant', 'engineer'));
DROP POLICY IF EXISTS fg_items_write ON public.finished_goods_items;
CREATE POLICY fg_items_write ON public.finished_goods_items FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse', 'engineer'))
  WITH CHECK (public.get_my_role() IN ('admin', 'warehouse', 'engineer'));

DROP POLICY IF EXISTS fg_receipts_select ON public.fg_receipts;
CREATE POLICY fg_receipts_select ON public.fg_receipts FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse', 'accountant', 'engineer'));
DROP POLICY IF EXISTS fg_receipts_write ON public.fg_receipts;
CREATE POLICY fg_receipts_write ON public.fg_receipts FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse'))
  WITH CHECK (public.get_my_role() IN ('admin', 'warehouse'));

DROP POLICY IF EXISTS fg_receipt_items_select ON public.fg_receipt_items;
CREATE POLICY fg_receipt_items_select ON public.fg_receipt_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse', 'accountant', 'engineer'));
DROP POLICY IF EXISTS fg_receipt_items_write ON public.fg_receipt_items;
CREATE POLICY fg_receipt_items_write ON public.fg_receipt_items FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse'))
  WITH CHECK (public.get_my_role() IN ('admin', 'warehouse'));

DROP POLICY IF EXISTS dn_select ON public.delivery_notes;
CREATE POLICY dn_select ON public.delivery_notes FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse', 'accountant', 'engineer'));
DROP POLICY IF EXISTS dn_write ON public.delivery_notes;
CREATE POLICY dn_write ON public.delivery_notes FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse'))
  WITH CHECK (public.get_my_role() IN ('admin', 'warehouse'));

DROP POLICY IF EXISTS dn_items_select ON public.delivery_note_items;
CREATE POLICY dn_items_select ON public.delivery_note_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse', 'accountant', 'engineer'));
DROP POLICY IF EXISTS dn_items_write ON public.delivery_note_items;
CREATE POLICY dn_items_write ON public.delivery_note_items FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'warehouse'))
  WITH CHECK (public.get_my_role() IN ('admin', 'warehouse'));

-- Realtime
ALTER TABLE public.purchase_requests REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_orders REPLICA IDENTITY FULL;
ALTER TABLE public.fg_receipts REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_notes REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'purchase_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_requests;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'purchase_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'fg_receipts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fg_receipts;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'delivery_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_notes;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._assert_period_unlocked(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._write_wms_audit_log(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_po_item_received(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_warehouse_voucher(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_warehouse_voucher(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_fg_receipt(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_fg_receipt(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_delivery_note(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_delivery_note(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company_dashboard_summary() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_warehouse_voucher(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_warehouse_voucher(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_fg_receipt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_fg_receipt(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_delivery_note(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_delivery_note(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_dashboard_summary() TO authenticated;
