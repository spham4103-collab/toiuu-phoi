-- ============================================================================
-- XEPPHOI.CLOUD — SQL MIGRATION ĐỢT 12 (2026)
-- Quy trình khép kín: PO Khách hàng -> Kỹ thuật giao bản vẽ -> Kinh doanh lập ĐNVT
-- & In phiếu QR kẹp bản vẽ -> Kho giữ phôi / Mua thêm -> Báo Zalo & SX quét QR lĩnh phôi
-- Chạy an toàn nhiều lần (idempotent) trên Supabase SQL Editor.
-- ============================================================================

-- 1. MỞ RỘNG 6 VAI TRÒ TRÊN public.profiles (THÊM 'sales')
DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'sales', 'engineer', 'warehouse', 'accountant', 'operator'));
END $$;

-- Cập nhật RLS cho vai trò 'sales' trên projects, project_material_requests, project_attachments
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'projects') THEN
    DROP POLICY IF EXISTS "projects_sales_write" ON public.projects;
    CREATE POLICY "projects_sales_write" ON public.projects
      FOR ALL TO authenticated
      USING (public.get_my_role() IN ('admin', 'engineer', 'sales'))
      WITH CHECK (public.get_my_role() IN ('admin', 'engineer', 'sales'));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_material_requests') THEN
    DROP POLICY IF EXISTS "pmr_sales_write" ON public.project_material_requests;
    CREATE POLICY "pmr_sales_write" ON public.project_material_requests
      FOR ALL TO authenticated
      USING (public.get_my_role() IN ('admin', 'engineer', 'sales'))
      WITH CHECK (public.get_my_role() IN ('admin', 'engineer', 'sales'));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_attachments') THEN
    DROP POLICY IF EXISTS "pa_sales_write" ON public.project_attachments;
    CREATE POLICY "pa_sales_write" ON public.project_attachments
      FOR ALL TO authenticated
      USING (public.get_my_role() IN ('admin', 'engineer', 'sales'))
      WITH CHECK (public.get_my_role() IN ('admin', 'engineer', 'sales'));
  END IF;
END $$;

-- 2. MỞ RỘNG BẢNG public.projects THEO DÕI LUỒNG BÀN GIAO HỒ SƠ
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS customer_po_no TEXT,
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'waiting_drawings',
  ADD COLUMN IF NOT EXISTS drawings_handed_over_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drawings_handed_over_by UUID,
  ADD COLUMN IF NOT EXISTS bom_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bom_submitted_by UUID;

DO $$
BEGIN
  ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_workflow_status_check;
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_workflow_status_check
    CHECK (workflow_status IN ('waiting_drawings', 'drawings_ready', 'bom_submitted', 'in_production', 'completed'));
END $$;

-- 3. MỞ RỘNG PHÂN LOẠI FILE ĐÍNH KÈM TRÊN public.project_attachments
ALTER TABLE public.project_attachments
  ADD COLUMN IF NOT EXISTS doc_category TEXT NOT NULL DEFAULT 'drawing';

-- 4. BỔ SUNG CỘT GIỮ HÀNG ĐÍCH DANH (ALLOCATION / RESERVATION)
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.project_material_requests
  ADD COLUMN IF NOT EXISTS allocated_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_date DATE,
  ADD COLUMN IF NOT EXISTS ready_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pmr_allocated_qty ON public.project_material_requests (allocated_qty) WHERE allocated_qty > 0;

-- 5. BẢNG THÔNG BÁO NỘI BỘ REALTIME (public.wms_notifications)
CREATE TABLE IF NOT EXISTS public.wms_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_roles TEXT[] NOT NULL DEFAULT ARRAY['operator', 'engineer', 'sales', 'admin'],
  type TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read_by UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.wms_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.wms_notifications DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;

  ALTER TABLE public.wms_notifications
    ADD CONSTRAINT wms_notifications_type_check
    CHECK (type IN ('drawings_ready', 'bom_submitted', 'material_ready', 'pr_pending', 'po_overdue'));
END $$;

CREATE INDEX IF NOT EXISTS idx_wms_notifications_created ON public.wms_notifications (created_at DESC);

ALTER TABLE public.wms_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_notif_select" ON public.wms_notifications;
CREATE POLICY "wms_notif_select" ON public.wms_notifications
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR public.get_my_role() = ANY(target_roles)
  );

DROP POLICY IF EXISTS "wms_notif_update_read" ON public.wms_notifications;
CREATE POLICY "wms_notif_update_read" ON public.wms_notifications
  FOR UPDATE TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "wms_notif_insert_auth" ON public.wms_notifications;
CREATE POLICY "wms_notif_insert_auth" ON public.wms_notifications
  FOR INSERT TO authenticated
  WITH CHECK (TRUE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wms_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_notifications;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 6. RPC ĐÁNH DẤU ĐÃ ĐỌC THÔNG BÁO
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.wms_notifications
  SET is_read_by = array_append(is_read_by, auth.uid())
  WHERE id = p_notification_id
    AND NOT (auth.uid() = ANY(COALESCE(is_read_by, '{}')));
END;
$$;

-- 7. RPC CHUYỂN TRẠNG THÁI BÀN GIAO HỒ SƠ DỰ ÁN (transition_project_workflow)
CREATE OR REPLACE FUNCTION public.transition_project_workflow(
  p_project_id TEXT,
  p_next_status TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_username TEXT;
  v_proj public.projects%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;
  v_username := COALESCE(public.get_my_username(), v_role);

  IF p_next_status NOT IN ('waiting_drawings', 'drawings_ready', 'bom_submitted', 'in_production', 'completed') THEN
    RAISE EXCEPTION 'Trạng thái quy trình "%" không hợp lệ.', p_next_status;
  END IF;

  SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng / dự án %', p_project_id;
  END IF;

  IF p_next_status = 'drawings_ready' THEN
    IF v_role NOT IN ('engineer', 'admin') THEN
      RAISE EXCEPTION 'Chỉ Kỹ thuật (engineer) hoặc Admin mới có quyền bàn giao bản vẽ cho Kinh doanh.';
    END IF;
    UPDATE public.projects
    SET workflow_status = 'drawings_ready',
        drawings_handed_over_at = v_now,
        drawings_handed_over_by = auth.uid(),
        updated_at = v_now
    WHERE id = p_project_id;

    INSERT INTO public.wms_notifications (
      target_roles, type, project_id, title, message, payload_json
    ) VALUES (
      ARRAY['sales', 'admin'],
      'drawings_ready',
      p_project_id,
      '📐 Đã có bản vẽ KT: ' || COALESCE(v_proj.name, p_project_id),
      'Kỹ thuật (' || v_username || ') đã bàn giao bản vẽ' ||
        CASE WHEN COALESCE(v_proj.customer_po_no, '') <> '' THEN ' · PO: ' || v_proj.customer_po_no ELSE '' END ||
        '. Mời Kinh doanh lập Đề nghị vật tư!',
      jsonb_build_object(
        'project_id', p_project_id,
        'project_name', COALESCE(v_proj.name, p_project_id),
        'customer_po_no', COALESCE(v_proj.customer_po_no, ''),
        'note', COALESCE(p_note, '')
      )
    );

  ELSIF p_next_status = 'bom_submitted' THEN
    IF v_role NOT IN ('sales', 'admin', 'engineer') THEN
      RAISE EXCEPTION 'Chỉ Kinh doanh (sales), Kỹ thuật hoặc Admin mới có quyền chuyển Đề nghị vật tư sang Kho & SX.';
    END IF;
    UPDATE public.projects
    SET workflow_status = 'bom_submitted',
        bom_submitted_at = v_now,
        bom_submitted_by = auth.uid(),
        updated_at = v_now
    WHERE id = p_project_id;

    INSERT INTO public.wms_notifications (
      target_roles, type, project_id, title, message, payload_json
    ) VALUES (
      ARRAY['warehouse', 'operator', 'admin'],
      'bom_submitted',
      p_project_id,
      '📤 Có Đề nghị VT mới: ' || COALESCE(v_proj.name, p_project_id),
      'Kinh doanh (' || v_username || ') đã chuyển ĐNVT' ||
        CASE WHEN COALESCE(v_proj.customer_po_no, '') <> '' THEN ' · PO: ' || v_proj.customer_po_no ELSE '' END ||
        '. Mời Kho kiểm tra giữ phôi / lập PR mua thêm!',
      jsonb_build_object(
        'project_id', p_project_id,
        'project_name', COALESCE(v_proj.name, p_project_id),
        'customer_po_no', COALESCE(v_proj.customer_po_no, ''),
        'note', COALESCE(p_note, '')
      )
    );

  ELSIF p_next_status IN ('in_production', 'completed') THEN
    IF v_role NOT IN ('warehouse', 'admin') THEN
      RAISE EXCEPTION 'Chỉ Thủ kho hoặc Admin mới có quyền cập nhật trạng thái sản xuất / hoàn thành.';
    END IF;
    UPDATE public.projects
    SET workflow_status = p_next_status,
        updated_at = v_now
    WHERE id = p_project_id;
  ELSE
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'Chỉ Admin mới có quyền đặt lại trạng thái chờ bản vẽ.';
    END IF;
    UPDATE public.projects
    SET workflow_status = p_next_status,
        updated_at = v_now
    WHERE id = p_project_id;
  END IF;

  PERFORM public._write_wms_audit_log(
    'transition_project_workflow',
    'projects',
    p_project_id,
    v_username,
    jsonb_build_object('next_status', p_next_status, 'note', COALESCE(p_note, ''))
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'project_id', p_project_id,
    'workflow_status', p_next_status
  );
END;
$$;

-- 8. RPC GIỮ PHÔI CÓ SẴN CHO ĐƠN HÀNG (allocate_free_stock_to_request)
CREATE OR REPLACE FUNCTION public.allocate_free_stock_to_request(
  p_request_id UUID,
  p_qty NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_username TEXT;
  v_req public.project_material_requests%ROWTYPE;
  v_inv public.inventory%ROWTYPE;
  v_proj public.projects%ROWTYPE;
  v_free NUMERIC;
  v_need NUMERIC;
  v_new_alloc NUMERIC;
  v_new_res NUMERIC;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Chỉ Admin hoặc Thủ kho mới có quyền giữ phôi cho đơn hàng.';
  END IF;
  v_username := COALESCE(public.get_my_username(), v_role);

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Số lượng giữ phôi phải lớn hơn 0.';
  END IF;

  SELECT * INTO v_req FROM public.project_material_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy dòng đề nghị vật tư ID %', p_request_id;
  END IF;
  IF v_req.inventory_id IS NULL THEN
    RAISE EXCEPTION 'Dòng "%" chưa liên kết mã vật tư trong kho WMS.', v_req.item_name;
  END IF;

  SELECT * INTO v_inv FROM public.inventory WHERE id = v_req.inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy vật tư trong kho.';
  END IF;

  v_free := GREATEST(0, COALESCE(v_inv.stock_qty, 0) - COALESCE(v_inv.reserved_qty, 0));
  IF v_free < p_qty THEN
    RAISE EXCEPTION 'Tồn tự do khả dụng của "%" chỉ còn % % (Tổng tồn: %, Đang giữ đơn khác: %), không đủ giữ % %!',
      v_inv.profile_name, v_free, COALESCE(v_inv.unit, ''), COALESCE(v_inv.stock_qty, 0), COALESCE(v_inv.reserved_qty, 0), p_qty, COALESCE(v_inv.unit, '');
  END IF;

  v_need := GREATEST(0, COALESCE(v_req.required_qty, 0) - COALESCE(v_req.issued_qty, 0) - COALESCE(v_req.allocated_qty, 0));
  IF p_qty > v_need THEN
    RAISE EXCEPTION 'Số lượng giữ (%) vượt quá phần còn thiếu của đơn (%).', p_qty, v_need;
  END IF;

  v_new_alloc := COALESCE(v_req.allocated_qty, 0) + p_qty;
  v_new_res := COALESCE(v_inv.reserved_qty, 0) + p_qty;

  UPDATE public.project_material_requests
  SET allocated_qty = v_new_alloc,
      updated_at = now()
  WHERE id = v_req.id;

  UPDATE public.inventory
  SET reserved_qty = v_new_res,
      updated_at = now()
  WHERE id = v_inv.id;

  SELECT * INTO v_proj FROM public.projects WHERE id = v_req.project_id;

  INSERT INTO public.wms_notifications (
    target_roles, type, project_id, title, message, payload_json
  ) VALUES (
    ARRAY['operator', 'engineer', 'sales', 'admin'],
    'material_ready',
    v_req.project_id,
    '🟢 Phôi sẵn sàng lĩnh: ' || COALESCE(v_proj.name, v_req.project_id),
    v_inv.profile_name || ' × ' || p_qty || ' ' || COALESCE(v_req.unit, v_inv.unit, '') ||
      CASE WHEN COALESCE(v_inv.rack_location, '') <> '' THEN ' (Kệ: ' || v_inv.rack_location || ')' ELSE '' END,
    jsonb_build_object(
      'project_id', v_req.project_id,
      'project_name', COALESCE(v_proj.name, v_req.project_id),
      'customer_po_no', COALESCE(v_proj.customer_po_no, ''),
      'customer', COALESCE(v_proj.customer, ''),
      'items', jsonb_build_array(jsonb_build_object(
        'request_id', v_req.id,
        'inventory_id', v_inv.id,
        'item_name', v_inv.profile_name,
        'qty', p_qty,
        'unit', COALESCE(v_req.unit, v_inv.unit, ''),
        'rack_location', COALESCE(v_inv.rack_location, '')
      ))
    )
  );

  PERFORM public._write_wms_audit_log(
    'allocate_stock',
    'project_material_requests',
    v_req.id::TEXT,
    v_username,
    jsonb_build_object('inventory_id', v_inv.id, 'qty', p_qty, 'project_id', v_req.project_id)
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'request_id', v_req.id,
    'inventory_id', v_inv.id,
    'project_id', v_req.project_id,
    'allocated_qty', v_new_alloc,
    'reserved_qty', v_new_res
  );
END;
$$;

-- 9. RPC HỦY GIỮ PHÔI (release_request_allocation)
CREATE OR REPLACE FUNCTION public.release_request_allocation(
  p_request_id UUID,
  p_qty NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_username TEXT;
  v_req public.project_material_requests%ROWTYPE;
  v_rel NUMERIC;
  v_new_alloc NUMERIC;
  v_new_res NUMERIC := 0;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Chỉ Admin hoặc Thủ kho mới có quyền hủy giữ phôi.';
  END IF;
  v_username := COALESCE(public.get_my_username(), v_role);

  SELECT * INTO v_req FROM public.project_material_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy dòng đề nghị vật tư ID %', p_request_id;
  END IF;

  v_rel := LEAST(COALESCE(v_req.allocated_qty, 0), GREATEST(0, COALESCE(p_qty, 0)));
  v_new_alloc := GREATEST(0, COALESCE(v_req.allocated_qty, 0) - v_rel);

  UPDATE public.project_material_requests
  SET allocated_qty = v_new_alloc,
      updated_at = now()
  WHERE id = v_req.id;

  IF v_req.inventory_id IS NOT NULL AND v_rel > 0 THEN
    UPDATE public.inventory
    SET reserved_qty = GREATEST(0, COALESCE(reserved_qty, 0) - v_rel),
        updated_at = now()
    WHERE id = v_req.inventory_id
    RETURNING reserved_qty INTO v_new_res;
  END IF;

  PERFORM public._write_wms_audit_log(
    'release_allocation',
    'project_material_requests',
    v_req.id::TEXT,
    v_username,
    jsonb_build_object('released_qty', v_rel, 'project_id', v_req.project_id)
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'request_id', v_req.id,
    'released_qty', v_rel,
    'allocated_qty', v_new_alloc,
    'reserved_qty', COALESCE(v_new_res, 0)
  );
END;
$$;

-- 10. RPC ĐÁNH DẤU ĐÃ BÁO NHÓM ZALO
CREATE OR REPLACE FUNCTION public.mark_requests_zalo_notified(p_request_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_cnt INTEGER := 0;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Chỉ Admin hoặc Thủ kho mới có quyền xác nhận đã báo Zalo.';
  END IF;
  IF p_request_ids IS NULL OR array_length(p_request_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'count', 0);
  END IF;

  UPDATE public.project_material_requests
  SET ready_notified_at = now(),
      updated_at = now()
  WHERE id = ANY(p_request_ids);

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN jsonb_build_object('ok', TRUE, 'count', v_cnt);
END;
$$;

-- 11. TỰ ĐỘNG ĐỒNG BỘ NGÀY DỰ KIẾN HÀNG VỀ TỪ PO -> PROJECT_MATERIAL_REQUESTS
CREATE OR REPLACE FUNCTION public._sync_po_expected_date(p_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
BEGIN
  IF p_po_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_po.status IN ('cancelled', 'completed') THEN
    RETURN;
  END IF;

  UPDATE public.project_material_requests pmr
  SET expected_date = v_po.expected_date,
      updated_at = now()
  FROM public.purchase_order_items poi
  JOIN public.purchase_request_items pri ON pri.id = poi.pr_item_id
  WHERE poi.po_id = v_po.id
    AND pri.project_request_id = pmr.id;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_sync_po_expected_date_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    PERFORM public._sync_po_expected_date(NEW.id);
  ELSIF TG_TABLE_NAME = 'purchase_order_items' THEN
    PERFORM public._sync_po_expected_date(NEW.po_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_po_expected_date ON public.purchase_orders;
CREATE TRIGGER trg_sync_po_expected_date
  AFTER INSERT OR UPDATE OF expected_date, status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_po_expected_date_fn();

DROP TRIGGER IF EXISTS trg_sync_po_item_expected_date ON public.purchase_order_items;
CREATE TRIGGER trg_sync_po_item_expected_date
  AFTER INSERT OR UPDATE OF pr_item_id ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_po_expected_date_fn();

-- 12. CẬP NHẬT approve_warehouse_voucher (BẢO TOÀN ĐỢT 5/7/8/11 + GIỮ HÀNG ĐÍCH DANH & CHUYỂN TRẠNG THÁI in_production)
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
  v_req public.project_material_requests%ROWTYPE;
  v_proj public.projects%ROWTYPE;
  v_req_id UUID;
  v_alloc NUMERIC;
  v_rel NUMERIC;
  v_free NUMERIC;
  v_ready_items JSONB := '[]'::jsonb;
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

      v_req_id := v_item.project_request_id;
      IF v_req_id IS NULL AND v_item.po_item_id IS NOT NULL THEN
        SELECT pri.project_request_id INTO v_req_id
        FROM public.purchase_order_items poi
        JOIN public.purchase_request_items pri ON pri.id = poi.pr_item_id
        WHERE poi.id = v_item.po_item_id;
      END IF;

      IF v_req_id IS NOT NULL THEN
        SELECT * INTO v_req FROM public.project_material_requests WHERE id = v_req_id FOR UPDATE;
        IF FOUND THEN
          v_alloc := LEAST(
            v_item.qty,
            GREATEST(0, COALESCE(v_req.required_qty, 0) - COALESCE(v_req.issued_qty, 0) - COALESCE(v_req.allocated_qty, 0))
          );
          IF v_alloc > 0 THEN
            UPDATE public.project_material_requests
            SET allocated_qty = COALESCE(allocated_qty, 0) + v_alloc,
                inventory_id = COALESCE(inventory_id, v_inv.id),
                updated_at = v_approved_at
            WHERE id = v_req.id;

            UPDATE public.inventory
            SET reserved_qty = COALESCE(reserved_qty, 0) + v_alloc,
                updated_at = v_approved_at
            WHERE id = v_inv.id;

            SELECT * INTO v_proj FROM public.projects WHERE id = v_req.project_id;
            v_ready_items := v_ready_items || jsonb_build_array(jsonb_build_object(
              'request_id', v_req.id,
              'project_id', v_req.project_id,
              'project_name', COALESCE(v_proj.name, v_req.project_id),
              'customer_po_no', COALESCE(v_proj.customer_po_no, ''),
              'customer', COALESCE(v_proj.customer, ''),
              'inventory_id', v_inv.id,
              'item_name', v_inv.profile_name,
              'qty', v_alloc,
              'unit', COALESCE(v_req.unit, v_inv.unit, ''),
              'rack_location', COALESCE(v_inv.rack_location, '')
            ));
          END IF;
        END IF;
      END IF;

    ELSIF v_voucher.voucher_type = 'OUT' THEN
      IF NOT v_voucher.allow_negative AND v_old_qty < v_item.qty THEN
        RAISE EXCEPTION 'Không đủ tồn kho "%": hiện còn % %, yêu cầu xuất % %',
          v_inv.profile_name, v_old_qty, v_inv.unit, v_item.qty, v_inv.unit;
      END IF;

      IF v_item.project_request_id IS NOT NULL THEN
        SELECT * INTO v_req FROM public.project_material_requests WHERE id = v_item.project_request_id FOR UPDATE;
        IF FOUND AND COALESCE(v_req.allocated_qty, 0) > 0 THEN
          v_rel := LEAST(COALESCE(v_req.allocated_qty, 0), v_item.qty);
          UPDATE public.project_material_requests
          SET allocated_qty = GREATEST(0, COALESCE(allocated_qty, 0) - v_rel),
              updated_at = v_approved_at
          WHERE id = v_req.id;

          UPDATE public.inventory
          SET reserved_qty = GREATEST(0, COALESCE(reserved_qty, 0) - v_rel),
              updated_at = v_approved_at
          WHERE id = v_inv.id
          RETURNING * INTO v_inv;
        END IF;
        IF FOUND THEN
          UPDATE public.projects
          SET workflow_status = 'in_production',
              updated_at = v_approved_at
          WHERE id = v_req.project_id
            AND workflow_status IN ('waiting_drawings', 'drawings_ready', 'bom_submitted');
        END IF;
      ELSE
        v_free := GREATEST(0, v_old_qty - COALESCE(v_inv.reserved_qty, 0));
        IF NOT v_voucher.allow_negative AND v_role <> 'admin' AND v_free < v_item.qty THEN
          RAISE EXCEPTION 'Vật tư "%" chỉ còn % % tự do (đang giữ % % cho đơn hàng khác). Không thể xuất tự do % %!',
            v_inv.profile_name, v_free, v_inv.unit, COALESCE(v_inv.reserved_qty, 0), v_inv.unit, v_item.qty, v_inv.unit;
        END IF;
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

  IF jsonb_array_length(v_ready_items) > 0 THEN
    INSERT INTO public.wms_notifications (
      target_roles, type, project_id, title, message, payload_json
    ) VALUES (
      ARRAY['operator', 'engineer', 'sales', 'admin'],
      'material_ready',
      COALESCE(v_ready_items->0->>'project_id', v_voucher.project_id),
      '🟢 Phôi vừa về kho: ' || COALESCE(v_ready_items->0->>'project_name', v_voucher.voucher_code),
      'Đã giữ ' || jsonb_array_length(v_ready_items) || ' dòng phôi từ phiếu ' || v_voucher.voucher_code || '. Mời Sản xuất cầm phiếu kẹp bản vẽ ra kho lĩnh phôi.',
      jsonb_build_object(
        'voucher_id', p_voucher_id,
        'voucher_code', v_voucher.voucher_code,
        'project_id', v_ready_items->0->>'project_id',
        'project_name', v_ready_items->0->>'project_name',
        'customer_po_no', v_ready_items->0->>'customer_po_no',
        'customer', v_ready_items->0->>'customer',
        'items', v_ready_items
      )
    );
  END IF;

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
    'items_processed', v_item_count,
    'ready_items', v_ready_items
  );
END;
$$;

-- 13. CẬP NHẬT cancel_warehouse_voucher (ĐẢO NGƯỢC CHÍNH XÁC allocated_qty & reserved_qty)
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
  v_req public.project_material_requests%ROWTYPE;
  v_req_id UUID;
  v_rel NUMERIC;
  v_restore NUMERIC;
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
      SELECT * INTO v_req FROM public.project_material_requests WHERE id = v_item.project_request_id FOR UPDATE;
      IF FOUND THEN
        v_restore := LEAST(v_item.qty, GREATEST(0, COALESCE(v_req.required_qty, 0) - COALESCE(v_req.issued_qty, 0) - COALESCE(v_req.allocated_qty, 0)));
        IF v_restore > 0 THEN
          UPDATE public.project_material_requests
          SET allocated_qty = COALESCE(allocated_qty, 0) + v_restore, updated_at = v_now
          WHERE id = v_req.id;
          IF v_item.inventory_id IS NOT NULL THEN
            UPDATE public.inventory
            SET reserved_qty = COALESCE(reserved_qty, 0) + v_restore, updated_at = v_now
            WHERE id = v_item.inventory_id;
          END IF;
        END IF;
      END IF;
    ELSIF v_voucher.voucher_type = 'RETURN' THEN
      PERFORM public._sync_project_request_issued(v_item.project_request_id, v_item.qty);
    END IF;
  END LOOP;

  IF v_voucher.voucher_type = 'IN' THEN
    FOR v_item IN
      SELECT * FROM public.warehouse_voucher_items
      WHERE voucher_id = p_voucher_id
    LOOP
      IF v_item.po_item_id IS NOT NULL THEN
        PERFORM public._sync_po_item_received(v_item.po_item_id, -v_item.qty);
      END IF;

      v_req_id := v_item.project_request_id;
      IF v_req_id IS NULL AND v_item.po_item_id IS NOT NULL THEN
        SELECT pri.project_request_id INTO v_req_id
        FROM public.purchase_order_items poi
        JOIN public.purchase_request_items pri ON pri.id = poi.pr_item_id
        WHERE poi.id = v_item.po_item_id;
      END IF;

      IF v_req_id IS NOT NULL THEN
        SELECT * INTO v_req FROM public.project_material_requests WHERE id = v_req_id FOR UPDATE;
        IF FOUND AND COALESCE(v_req.allocated_qty, 0) > 0 THEN
          v_rel := LEAST(COALESCE(v_req.allocated_qty, 0), v_item.qty);
          UPDATE public.project_material_requests
          SET allocated_qty = GREATEST(0, COALESCE(allocated_qty, 0) - v_rel), updated_at = v_now
          WHERE id = v_req.id;
          IF v_item.inventory_id IS NOT NULL THEN
            UPDATE public.inventory
            SET reserved_qty = GREATEST(0, COALESCE(reserved_qty, 0) - v_rel), updated_at = v_now
            WHERE id = v_item.inventory_id;
          END IF;
        END IF;
      END IF;
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
    'success', TRUE,
    'voucher_id', p_voucher_id,
    'voucher_code', v_voucher.voucher_code,
    'status', 'cancelled',
    'reversed', TRUE,
    'reason', v_clean_reason
  );
END;
$$;
