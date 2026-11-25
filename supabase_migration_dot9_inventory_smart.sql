-- ============================================================================
-- Xếp Phôi An Bình · SQL Migration Đợt 9 (Smart Inventory & Safe Delete/Merge)
-- Chạy file này trong Supabase SQL Editor.
-- ============================================================================

-- 1. Thêm cột is_active để hỗ trợ ẩn/ngừng sử dụng quy cách cũ mà không làm sai lệch báo cáo NXT
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_inventory_is_active ON public.inventory (is_active);

-- 2. RPC kiểm tra mức độ sử dụng của 1 quy cách trước khi xóa / ẩn / gộp
CREATE OR REPLACE FUNCTION public.check_inventory_usage(p_inventory_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv RECORD;
  v_approved_vouchers INTEGER := 0;
  v_pending_vouchers INTEGER := 0;
  v_tx_count INTEGER := 0;
  v_non_zero_tx_count INTEGER := 0;
  v_project_req_count INTEGER := 0;
  v_offcut_count INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT id, profile_name, stock_qty, is_active, unit
  INTO v_inv
  FROM public.inventory
  WHERE id = p_inventory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy quy cách vật tư (id=%)', p_inventory_id;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE v.status = 'approved'),
    COUNT(*) FILTER (WHERE v.status IN ('draft', 'pending'))
  INTO v_approved_vouchers, v_pending_vouchers
  FROM public.warehouse_voucher_items vi
  JOIN public.warehouse_vouchers v ON v.id = vi.voucher_id
  WHERE vi.inventory_id = p_inventory_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE NOT (tx_type = 'opening_balance' AND COALESCE(qty_change, 0) = 0))
  INTO v_tx_count, v_non_zero_tx_count
  FROM public.inventory_transactions
  WHERE profile = v_inv.profile_name;

  IF to_regclass('public.project_material_requests') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM public.project_material_requests WHERE inventory_id = $1'
      INTO v_project_req_count
      USING p_inventory_id;
  END IF;

  SELECT COUNT(*)
  INTO v_offcut_count
  FROM public.stock_offcuts
  WHERE profile = v_inv.profile_name;

  RETURN jsonb_build_object(
    'id', v_inv.id,
    'profile_name', v_inv.profile_name,
    'stock_qty', COALESCE(v_inv.stock_qty, 0),
    'is_active', COALESCE(v_inv.is_active, TRUE),
    'unit', COALESCE(v_inv.unit, 'cây'),
    'approved_voucher_items', v_approved_vouchers,
    'pending_voucher_items', v_pending_vouchers,
    'tx_count', v_tx_count,
    'non_zero_opening_tx_count', v_non_zero_tx_count,
    'project_request_count', v_project_req_count,
    'offcut_count', v_offcut_count,
    'can_hard_delete', (
      COALESCE(v_inv.stock_qty, 0) = 0
      AND v_approved_vouchers = 0
      AND v_pending_vouchers = 0
      AND v_project_req_count = 0
    )
  );
END;
$$;

-- 3. RPC xóa an toàn 3 mức: archive (ẩn), restore (khôi phục), hard (xóa vĩnh viễn)
CREATE OR REPLACE FUNCTION public.safe_delete_inventory_item(
  p_inventory_id UUID,
  p_mode TEXT DEFAULT 'archive',
  p_force_clear_logs BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_inv RECORD;
  v_approved_vouchers INTEGER := 0;
  v_pending_vouchers INTEGER := 0;
  v_project_req_count INTEGER := 0;
  v_non_zero_tx_count INTEGER := 0;
  v_mode TEXT := LOWER(COALESCE(p_mode, 'archive'));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Permission denied: Chỉ Admin hoặc Thủ kho được xóa/ẩn quy cách';
  END IF;

  SELECT * INTO v_inv FROM public.inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy quy cách vật tư (id=%)', p_inventory_id;
  END IF;

  IF v_mode = 'archive' THEN
    UPDATE public.inventory
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = p_inventory_id;
    RETURN jsonb_build_object('ok', TRUE, 'mode', 'archive', 'id', p_inventory_id, 'is_active', FALSE);
  ELSIF v_mode = 'restore' THEN
    UPDATE public.inventory
    SET is_active = TRUE, updated_at = NOW()
    WHERE id = p_inventory_id;
    RETURN jsonb_build_object('ok', TRUE, 'mode', 'restore', 'id', p_inventory_id, 'is_active', TRUE);
  ELSIF v_mode = 'hard' THEN
    IF COALESCE(v_inv.stock_qty, 0) > 0 THEN
      RAISE EXCEPTION 'Không thể xóa vĩnh viễn vì tồn kho hiện tại vẫn còn % %', v_inv.stock_qty, COALESCE(v_inv.unit, 'đơn vị');
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE v.status = 'approved'),
      COUNT(*) FILTER (WHERE v.status IN ('draft', 'pending'))
    INTO v_approved_vouchers, v_pending_vouchers
    FROM public.warehouse_voucher_items vi
    JOIN public.warehouse_vouchers v ON v.id = vi.voucher_id
    WHERE vi.inventory_id = p_inventory_id;

    IF v_approved_vouchers > 0 OR v_pending_vouchers > 0 THEN
      RAISE EXCEPTION 'Quy cách đã gắn với % dòng phiếu kho (duyệt/chờ duyệt). Hãy chọn "Ngừng sử dụng (Ẩn)" hoặc "Gộp quy cách"!', (v_approved_vouchers + v_pending_vouchers);
    END IF;

    IF to_regclass('public.project_material_requests') IS NOT NULL THEN
      EXECUTE 'SELECT COUNT(*) FROM public.project_material_requests WHERE inventory_id = $1'
        INTO v_project_req_count
        USING p_inventory_id;
      IF v_project_req_count > 0 THEN
        RAISE EXCEPTION 'Quy cách đang được tham chiếu trong % dòng Đề nghị Vật tư Dự án. Hãy chọn "Ngừng sử dụng (Ẩn)" hoặc "Gộp quy cách"!', v_project_req_count;
      END IF;
    END IF;

    SELECT COUNT(*)
    INTO v_non_zero_tx_count
    FROM public.inventory_transactions
    WHERE profile = v_inv.profile_name
      AND NOT (tx_type = 'opening_balance' AND COALESCE(qty_change, 0) = 0);

    IF v_non_zero_tx_count > 0 AND NOT COALESCE(p_force_clear_logs, FALSE) THEN
      RAISE EXCEPTION 'Quy cách có % giao dịch trong sổ cái. Bật xác nhận dọn sạch log test hoặc chọn "Ngừng sử dụng (Ẩn)"!', v_non_zero_tx_count;
    END IF;

    DELETE FROM public.inventory_transactions WHERE profile = v_inv.profile_name;
    DELETE FROM public.inventory WHERE id = p_inventory_id;

    RETURN jsonb_build_object('ok', TRUE, 'mode', 'hard', 'id', p_inventory_id, 'deleted_profile', v_inv.profile_name);
  ELSE
    RAISE EXCEPTION 'Chế độ xóa không hợp lệ: %', p_mode;
  END IF;
END;
$$;

-- 4. RPC gộp quy cách trùng/gõ nhầm sang quy cách chuẩn
CREATE OR REPLACE FUNCTION public.merge_inventory_items(
  p_source_id UUID,
  p_target_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_uname TEXT;
  v_src RECORD;
  v_tgt RECORD;
  v_new_qty NUMERIC;
  v_new_cost NUMERIC;
  v_src_qty NUMERIC;
  v_tgt_qty NUMERIC;
  v_src_cost NUMERIC;
  v_tgt_cost NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  SELECT role, username INTO v_role, v_uname FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Permission denied: Chỉ Admin hoặc Thủ kho được gộp quy cách';
  END IF;

  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Mã nguồn và mã đích phải khác nhau';
  END IF;

  -- Khóa theo thứ tự UUID để tránh deadlock
  IF p_source_id < p_target_id THEN
    SELECT * INTO v_src FROM public.inventory WHERE id = p_source_id FOR UPDATE;
    SELECT * INTO v_tgt FROM public.inventory WHERE id = p_target_id FOR UPDATE;
  ELSE
    SELECT * INTO v_tgt FROM public.inventory WHERE id = p_target_id FOR UPDATE;
    SELECT * INTO v_src FROM public.inventory WHERE id = p_source_id FOR UPDATE;
  END IF;

  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy quy cách nguồn (id=%)', p_source_id;
  END IF;
  IF v_tgt.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy quy cách đích (id=%)', p_target_id;
  END IF;

  v_src_qty := GREATEST(0, COALESCE(v_src.stock_qty, 0));
  v_tgt_qty := GREATEST(0, COALESCE(v_tgt.stock_qty, 0));
  v_src_cost := GREATEST(0, COALESCE(v_src.avg_cost, v_src.unit_price, 0));
  v_tgt_cost := GREATEST(0, COALESCE(v_tgt.avg_cost, v_tgt.unit_price, 0));
  v_new_qty := v_tgt_qty + v_src_qty;

  IF v_new_qty > 0 THEN
    v_new_cost := ROUND(((v_tgt_qty * v_tgt_cost) + (v_src_qty * v_src_cost)) / v_new_qty, 2);
  ELSE
    v_new_cost := v_tgt_cost;
  END IF;

  UPDATE public.warehouse_voucher_items
  SET inventory_id = v_tgt.id,
      profile = v_tgt.profile_name
  WHERE inventory_id = v_src.id;

  UPDATE public.inventory_transactions
  SET profile = v_tgt.profile_name
  WHERE profile = v_src.profile_name;

  UPDATE public.stock_offcuts
  SET profile = v_tgt.profile_name
  WHERE profile = v_src.profile_name;

  IF to_regclass('public.project_material_requests') IS NOT NULL THEN
    EXECUTE 'UPDATE public.project_material_requests SET inventory_id = $1 WHERE inventory_id = $2'
      USING v_tgt.id, v_src.id;
  END IF;

  UPDATE public.inventory
  SET stock_qty = v_new_qty,
      avg_cost = v_new_cost,
      unit_price = v_new_cost,
      is_active = TRUE,
      updated_at = NOW()
  WHERE id = v_tgt.id;

  INSERT INTO public.inventory_transactions (
    tx_type, profile, length_mm, qty_change, balance_after, note, created_by
  ) VALUES (
    'stocktake_adjust',
    v_tgt.profile_name,
    COALESCE(v_tgt.standard_length_mm, 6000),
    0,
    v_new_qty,
    'Gộp quy cách "' || v_src.profile_name || '" sang "' || v_tgt.profile_name || '"',
    COALESCE(v_uname, 'system')
  );

  DELETE FROM public.inventory WHERE id = v_src.id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'source_id', v_src.id,
    'target_id', v_tgt.id,
    'target_profile', v_tgt.profile_name,
    'new_stock_qty', v_new_qty,
    'new_avg_cost', v_new_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_inventory_usage(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.safe_delete_inventory_item(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_inventory_items(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_inventory_usage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_delete_inventory_item(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_inventory_items(UUID, UUID) TO authenticated;
