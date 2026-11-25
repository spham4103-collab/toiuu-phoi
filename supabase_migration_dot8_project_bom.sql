-- ============================================================================
-- MIGRATION ĐỢT 8: DỰ ÁN ĐA CÔNG ĐOẠN, ĐỀ NGHỊ VẬT TƯ DỰ ÁN (BOM),
--                  FILE ĐÍNH KÈM DỰ ÁN & ĐỒNG BỘ XUẤT KHO NGUYÊN TỬ
-- Chạy 1 lần trong Supabase SQL Editor (Idempotent / An toàn chạy lại)
-- ============================================================================

-- ============================================================================
-- 1. BẢNG ĐỀ NGHỊ VẬT TƯ THEO DỰ ÁN (public.project_material_requests)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_material_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_stage TEXT NOT NULL DEFAULT 'laser_sheet'
    CHECK (work_stage IN ('laser_sheet', 'cnc_mill_turn', 'laser_tube', 'welding_assembly', 'consumable_tooling', 'outsourced')),
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  material_grade TEXT NOT NULL DEFAULT '',
  spec_dimensions TEXT NOT NULL DEFAULT '',
  calc_weight_kg NUMERIC NOT NULL DEFAULT 0 CHECK (calc_weight_kg >= 0),
  unit TEXT NOT NULL DEFAULT 'cái',
  required_qty NUMERIC NOT NULL CHECK (required_qty > 0),
  issued_qty NUMERIC NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'fulfilled', 'need_purchase', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmr_project_id ON public.project_material_requests (project_id);
CREATE INDEX IF NOT EXISTS idx_pmr_status ON public.project_material_requests (status);
CREATE INDEX IF NOT EXISTS idx_pmr_inventory_id ON public.project_material_requests (inventory_id) WHERE inventory_id IS NOT NULL;

ALTER TABLE public.project_material_requests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_material_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_material_requests;
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.project_material_requests FROM anon;
REVOKE ALL ON TABLE public.project_material_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_material_requests TO authenticated;

ALTER TABLE public.project_material_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pmr_select_member" ON public.project_material_requests;
CREATE POLICY "pmr_select_member"
  ON public.project_material_requests FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "pmr_insert_eng_admin" ON public.project_material_requests;
CREATE POLICY "pmr_insert_eng_admin"
  ON public.project_material_requests FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'engineer'));

DROP POLICY IF EXISTS "pmr_update_eng_admin" ON public.project_material_requests;
CREATE POLICY "pmr_update_eng_admin"
  ON public.project_material_requests FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'engineer'))
  WITH CHECK (public.get_my_role() IN ('admin', 'engineer'));

DROP POLICY IF EXISTS "pmr_delete_eng_admin_unissued" ON public.project_material_requests;
CREATE POLICY "pmr_delete_eng_admin_unissued"
  ON public.project_material_requests FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'engineer') AND COALESCE(issued_qty, 0) = 0);

-- ============================================================================
-- 2. BẢNG FILE ĐÍNH KÈM DỰ ÁN (public.project_attachments) & STORAGE BUCKET
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.project_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'other' CHECK (file_type IN ('excel', 'pdf', 'cad', 'image', 'other')),
  storage_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proj_att_project_id ON public.project_attachments (project_id);

REVOKE ALL ON TABLE public.project_attachments FROM anon;
REVOKE ALL ON TABLE public.project_attachments FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_attachments TO authenticated;

ALTER TABLE public.project_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proj_att_select_member" ON public.project_attachments;
CREATE POLICY "proj_att_select_member"
  ON public.project_attachments FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "proj_att_write_eng_admin" ON public.project_attachments;
CREATE POLICY "proj_att_write_eng_admin"
  ON public.project_attachments FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'engineer'))
  WITH CHECK (public.get_my_role() IN ('admin', 'engineer'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-attachments', 'project-attachments', false, 10485760, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS "proj_att_storage_select" ON storage.objects;
CREATE POLICY "proj_att_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-attachments' AND public.is_workshop_member());

DROP POLICY IF EXISTS "proj_att_storage_insert" ON storage.objects;
CREATE POLICY "proj_att_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-attachments' AND public.get_my_role() IN ('admin', 'engineer'));

DROP POLICY IF EXISTS "proj_att_storage_delete" ON storage.objects;
CREATE POLICY "proj_att_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-attachments' AND public.get_my_role() IN ('admin', 'engineer'));

-- ============================================================================
-- 3. LIÊN KẾT warehouse_voucher_items.project_request_id & CẬP NHẬT RPC
-- ============================================================================
ALTER TABLE public.warehouse_voucher_items
  ADD COLUMN IF NOT EXISTS project_request_id UUID REFERENCES public.project_material_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voucher_items_proj_req_id
  ON public.warehouse_voucher_items (project_request_id)
  WHERE project_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._sync_project_request_issued(
  p_req_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.project_material_requests%ROWTYPE;
  v_next_issued NUMERIC;
  v_next_status TEXT;
BEGIN
  IF p_req_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_req
  FROM public.project_material_requests
  WHERE id = p_req_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next_issued := GREATEST(0, COALESCE(v_req.issued_qty, 0) + p_delta);
  IF v_next_issued >= v_req.required_qty THEN
    v_next_status := 'fulfilled';
  ELSIF v_next_issued > 0 THEN
    v_next_status := 'partial';
  ELSE
    v_next_status := 'pending';
  END IF;

  UPDATE public.project_material_requests
  SET issued_qty = v_next_issued,
      status = CASE WHEN v_req.status = 'cancelled' THEN 'cancelled' ELSE v_next_status END
  WHERE id = p_req_id;
END;
$$;

-- Cập nhật approve_warehouse_voucher để cộng/trừ issued_qty trên project_material_requests
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

-- Cập nhật cancel_warehouse_voucher để đảo ngược issued_qty trên project_material_requests
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

  -- Đảo ngược issued_qty trên project_material_requests nếu phiếu gắn project_request_id
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

  UPDATE public.warehouse_vouchers
  SET status = 'cancelled', cancel_reason = v_clean_reason, updated_at = v_now
  WHERE id = p_voucher_id;

  RETURN jsonb_build_object(
    'success', TRUE, 'voucher_id', p_voucher_id, 'voucher_code', v_voucher.voucher_code,
    'status', 'cancelled', 'reversed', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public._sync_project_request_issued(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_warehouse_voucher(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_warehouse_voucher(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_warehouse_voucher(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_warehouse_voucher(UUID, TEXT) TO authenticated;
