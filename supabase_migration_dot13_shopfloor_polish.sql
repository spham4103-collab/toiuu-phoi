-- ============================================================================
-- XEPPHOI.CLOUD — SQL MIGRATION ĐỢT 13 (TỐI ƯU THỰC CHIẾN NGOÀI XƯỞNG)
-- 1. Quản lý phiên bản bản vẽ & ĐNVT (bom_revision, rev_label, is_superseded, priority)
-- 2. RPC bump_project_revision(p_project_id, p_reason) + Thông báo Realtime
-- 3. Tách Xuất bù phôi hỏng (rework_ng, ng_reason, ng_reported_by) & cập nhật get_project_cost_report
-- 4. Chế độ Xuất khẩn cấp (is_emergency, emergency_confirmed_at/by) & confirm_emergency_voucher
-- Chạy an toàn nhiều lần (idempotent) trên Supabase SQL Editor.
-- ============================================================================

-- 1. MỞ RỘNG BẢNG public.projects (PHIÊN BẢN BOM & ĐỘ ƯU TIÊN ĐƠN GẤP)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS bom_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_priority_check;
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_priority_check
    CHECK (priority IN ('normal', 'urgent'));
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_priority ON public.projects (priority);

-- 2. MỞ RỘNG BẢNG public.project_attachments (NHÃN REV & ĐÃ THAY THẾ)
ALTER TABLE public.project_attachments
  ADD COLUMN IF NOT EXISTS rev_label TEXT DEFAULT 'Rev 01',
  ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. MỞ RỘNG CHECK CONSTRAINT LOẠI THÔNG BÁO TRÊN public.wms_notifications
DO $$
DECLARE
  v_con RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'wms_notifications') THEN
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
      CHECK (type IN (
        'po_pushed', 'drawings_ready', 'bom_submitted', 'material_ready',
        'pr_pending', 'po_overdue', 'workflow_returned', 'revision_bumped'
      ));
  END IF;
END $$;

-- 4. RPC BUMP PHIÊN BẢN DỰ ÁN / ĐNVT (bump_project_revision)
CREATE OR REPLACE FUNCTION public.bump_project_revision(
  p_project_id TEXT,
  p_reason TEXT
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
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_now TIMESTAMPTZ := now();
  v_next_rev INTEGER;
  v_rev_lbl TEXT;
  v_entry JSONB;
  v_history JSONB;
BEGIN
  v_role := public.get_my_role();
  IF v_role NOT IN ('admin', 'engineer', 'sales') THEN
    RAISE EXCEPTION 'Chỉ Admin, Kỹ thuật hoặc Kinh doanh mới được cập nhật phiên bản (Rev) đơn hàng.';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do cập nhật phiên bản mới.';
  END IF;

  SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng / dự án %', p_project_id;
  END IF;

  v_username := COALESCE(public.get_my_username(), v_role);
  v_next_rev := COALESCE(v_proj.bom_revision, 1) + 1;
  v_rev_lbl := 'Rev ' || lpad(v_next_rev::TEXT, 2, '0');

  v_entry := jsonb_build_object(
    'type', 'revision_bumped',
    'from', COALESCE(v_proj.workflow_status, 'po_draft'),
    'to', COALESCE(v_proj.workflow_status, 'po_draft'),
    'rev', v_next_rev,
    'rev_label', v_rev_lbl,
    'at', v_now,
    'by', v_username,
    'by_id', auth.uid(),
    'role', v_role,
    'note', v_reason,
    'direction', 'revision'
  );

  UPDATE public.projects
  SET bom_revision = v_next_rev,
      workflow_history = COALESCE(workflow_history, '[]'::jsonb) || jsonb_build_array(v_entry),
      updated_at = v_now
  WHERE id = p_project_id
  RETURNING workflow_history INTO v_history;

  IF to_regprocedure('public._write_wms_audit_log(text,text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public._write_wms_audit_log(
      'bump_project_revision',
      'projects',
      p_project_id,
      v_username,
      jsonb_build_object('bom_revision', v_next_rev, 'rev_label', v_rev_lbl, 'reason', v_reason)
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'wms_notifications') THEN
    INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
    VALUES (
      ARRAY['warehouse', 'operator', 'sales', 'engineer', 'admin'],
      'revision_bumped',
      p_project_id,
      format('⚠️ %s cập nhật lên %s', COALESCE(v_proj.name, p_project_id), v_rev_lbl),
      format('⚠️ Đơn hàng %s đã cập nhật lên %s — Lý do: %s', COALESCE(v_proj.name, p_project_id), v_rev_lbl, v_reason),
      jsonb_build_object(
        'project_id', p_project_id,
        'project_name', COALESCE(v_proj.name, p_project_id),
        'bom_revision', v_next_rev,
        'rev_label', v_rev_lbl,
        'reason', v_reason
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'project_id', p_project_id,
    'bom_revision', v_next_rev,
    'rev_label', v_rev_lbl,
    'reason', v_reason,
    'workflow_history', COALESCE(v_history, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bump_project_revision(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_project_revision(TEXT, TEXT) TO authenticated;

-- 5. TÁCH RIÊNG XUẤT BÙ PHÔI HỎNG / LÀM LẠI (NG) TRÊN project_material_requests
ALTER TABLE public.project_material_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS ng_reason TEXT,
  ADD COLUMN IF NOT EXISTS ng_reported_by TEXT;

DO $$
BEGIN
  ALTER TABLE public.project_material_requests DROP CONSTRAINT IF EXISTS project_material_requests_type_check;
  ALTER TABLE public.project_material_requests
    ADD CONSTRAINT project_material_requests_type_check
    CHECK (request_type IN ('standard', 'rework_ng'));
END $$;

-- Cho phép Kho (warehouse) liên kết mã kho/đề-xê và thêm bù hỏng; Tổ sản xuất (operator) báo thêm dòng rework_ng
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_material_requests') THEN
    DROP POLICY IF EXISTS "pmr_warehouse_insert" ON public.project_material_requests;
    CREATE POLICY "pmr_warehouse_insert" ON public.project_material_requests
      FOR INSERT TO authenticated
      WITH CHECK (public.get_my_role() IN ('admin', 'engineer', 'sales', 'warehouse'));

    DROP POLICY IF EXISTS "pmr_warehouse_update" ON public.project_material_requests;
    CREATE POLICY "pmr_warehouse_update" ON public.project_material_requests
      FOR UPDATE TO authenticated
      USING (public.get_my_role() IN ('admin', 'engineer', 'sales', 'warehouse'))
      WITH CHECK (public.get_my_role() IN ('admin', 'engineer', 'sales', 'warehouse'));

    DROP POLICY IF EXISTS "pmr_operator_rework_ng_insert" ON public.project_material_requests;
    CREATE POLICY "pmr_operator_rework_ng_insert" ON public.project_material_requests
      FOR INSERT TO authenticated
      WITH CHECK (public.get_my_role() = 'operator' AND request_type = 'rework_ng');
  END IF;
END $$;

-- 6. NÂNG CẤP RPC get_project_cost_report TÁCH standard_cost & ng_rework_cost
DROP FUNCTION IF EXISTS public.get_project_cost_report(TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.get_project_cost_report(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  project_id TEXT,
  project_name TEXT,
  customer TEXT,
  out_voucher_count INTEGER,
  return_voucher_count INTEGER,
  out_value NUMERIC,
  return_value NUMERIC,
  standard_cost NUMERIC,
  ng_rework_cost NUMERIC,
  net_cost NUMERIC,
  total_net_cost NUMERIC,
  items_json JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_view_wms_prices() THEN
    RAISE EXCEPTION 'Permission denied: Bạn không có quyền xem báo cáo Giá vốn Dự án';
  END IF;

  RETURN QUERY
  WITH proj_vouchers AS (
    SELECT
      v.id AS voucher_id,
      v.voucher_code,
      v.voucher_type,
      v.project_id,
      v.approved_at,
      v.created_at
    FROM public.warehouse_vouchers v
    WHERE v.status = 'approved'
      AND v.project_id IS NOT NULL
      AND v.voucher_type IN ('OUT', 'RETURN')
      AND (p_from IS NULL OR COALESCE(v.approved_at, v.created_at) >= p_from)
      AND (p_to IS NULL OR COALESCE(v.approved_at, v.created_at) <= p_to)
  ),
  proj_items AS (
    SELECT
      pv.project_id,
      pv.voucher_id,
      pv.voucher_code,
      pv.voucher_type,
      COALESCE(pv.approved_at, pv.created_at) AS tx_at,
      vi.profile,
      vi.material_group,
      vi.unit,
      vi.length_mm,
      vi.qty,
      CASE
        WHEN vi.unit_price > 0 THEN vi.unit_price
        ELSE COALESCE(inv.avg_cost, inv.unit_price, 0)
      END AS eff_unit_price,
      CASE
        WHEN vi.total_amount > 0 THEN vi.total_amount
        ELSE ROUND(vi.qty * CASE WHEN vi.unit_price > 0 THEN vi.unit_price ELSE COALESCE(inv.avg_cost, inv.unit_price, 0) END, 0)
      END AS eff_total_amount,
      COALESCE(pmr.request_type, 'standard') AS request_type,
      COALESCE(pmr.ng_reason, '') AS ng_reason,
      COALESCE(pmr.ng_reported_by, '') AS ng_reported_by,
      vi.note
    FROM proj_vouchers pv
    JOIN public.warehouse_voucher_items vi ON vi.voucher_id = pv.voucher_id
    LEFT JOIN public.inventory inv ON inv.id = vi.inventory_id OR inv.profile_name = vi.profile
    LEFT JOIN public.project_material_requests pmr ON pmr.id = vi.project_request_id
  ),
  agg AS (
    SELECT
      pi.project_id,
      COUNT(DISTINCT CASE WHEN pi.voucher_type = 'OUT' THEN pi.voucher_id END)::INTEGER AS out_cnt,
      COUNT(DISTINCT CASE WHEN pi.voucher_type = 'RETURN' THEN pi.voucher_id END)::INTEGER AS ret_cnt,
      COALESCE(SUM(CASE WHEN pi.voucher_type = 'OUT' THEN pi.eff_total_amount ELSE 0 END), 0)::NUMERIC AS out_val,
      COALESCE(SUM(CASE WHEN pi.voucher_type = 'RETURN' THEN pi.eff_total_amount ELSE 0 END), 0)::NUMERIC AS ret_val,
      COALESCE(SUM(
        CASE
          WHEN pi.voucher_type = 'OUT' AND pi.request_type = 'rework_ng' THEN pi.eff_total_amount
          ELSE 0
        END
      ), 0)::NUMERIC AS ng_val,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'voucher_code', pi.voucher_code,
            'voucher_type', pi.voucher_type,
            'tx_at', pi.tx_at,
            'profile', pi.profile,
            'material_group', pi.material_group,
            'unit', pi.unit,
            'length_mm', pi.length_mm,
            'qty', pi.qty,
            'unit_price', pi.eff_unit_price,
            'total_amount', pi.eff_total_amount,
            'request_type', pi.request_type,
            'ng_reason', pi.ng_reason,
            'ng_reported_by', pi.ng_reported_by,
            'note', pi.note
          )
          ORDER BY pi.tx_at DESC, pi.profile ASC
        ),
        '[]'::jsonb
      ) AS items_json
    FROM proj_items pi
    GROUP BY pi.project_id
  )
  SELECT
    a.project_id,
    COALESCE(p.name, a.project_id) AS project_name,
    COALESCE(p.customer, '') AS customer,
    a.out_cnt AS out_voucher_count,
    a.ret_cnt AS return_voucher_count,
    ROUND(a.out_val, 0) AS out_value,
    ROUND(a.ret_val, 0) AS return_value,
    ROUND((a.out_val - a.ret_val) - a.ng_val, 0) AS standard_cost,
    ROUND(a.ng_val, 0) AS ng_rework_cost,
    ROUND(a.out_val - a.ret_val, 0) AS net_cost,
    ROUND(a.out_val - a.ret_val, 0) AS total_net_cost,
    a.items_json
  FROM agg a
  LEFT JOIN public.projects p ON p.id = a.project_id
  ORDER BY (a.out_val - a.ret_val) DESC, project_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_project_cost_report(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_cost_report(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- 7. CHẾ ĐỘ XUẤT KHẨN CẤP — HỢP THỨC HÓA TRONG NGÀY TRÊN public.warehouse_vouchers
ALTER TABLE public.warehouse_vouchers
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emergency_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS emergency_confirmed_by UUID;

CREATE INDEX IF NOT EXISTS idx_wv_emergency_unconfirmed
  ON public.warehouse_vouchers (is_emergency, emergency_confirmed_at)
  WHERE is_emergency = TRUE AND emergency_confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION public.confirm_emergency_voucher(
  p_voucher_id UUID,
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
  v_v public.warehouse_vouchers%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_note TEXT := btrim(COALESCE(p_note, ''));
BEGIN
  v_role := public.get_my_role();
  IF v_role NOT IN ('admin', 'warehouse', 'accountant') THEN
    RAISE EXCEPTION 'Chỉ Admin, Thủ kho hoặc Kế toán mới được xác nhận hợp thức hóa phiếu xuất khẩn cấp.';
  END IF;

  SELECT * INTO v_v FROM public.warehouse_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu kho %', p_voucher_id;
  END IF;
  IF NOT COALESCE(v_v.is_emergency, FALSE) THEN
    RAISE EXCEPTION 'Phiếu % không phải phiếu xuất khẩn cấp.', v_v.voucher_code;
  END IF;

  v_username := COALESCE(public.get_my_username(), v_role);

  UPDATE public.warehouse_vouchers
  SET emergency_confirmed_at = v_now,
      emergency_confirmed_by = auth.uid(),
      note = CASE
        WHEN v_note <> '' THEN trim(both ' ' FROM concat_ws(' | ', NULLIF(note, ''), 'Đã hợp thức hóa (' || v_username || '): ' || v_note))
        ELSE note
      END,
      updated_at = v_now
  WHERE id = p_voucher_id;

  IF to_regprocedure('public._write_wms_audit_log(text,text,text,text,jsonb)') IS NOT NULL THEN
    PERFORM public._write_wms_audit_log(
      'confirm_emergency_voucher',
      'warehouse_vouchers',
      p_voucher_id::TEXT,
      v_username,
      jsonb_build_object(
        'voucher_code', v_v.voucher_code,
        'confirmed_at', v_now,
        'note', v_note
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'id', p_voucher_id,
    'voucher_code', v_v.voucher_code,
    'emergency_confirmed_at', v_now,
    'emergency_confirmed_by', auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_emergency_voucher(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_emergency_voucher(UUID, TEXT) TO authenticated;
