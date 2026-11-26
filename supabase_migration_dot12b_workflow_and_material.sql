-- ============================================================================
-- XEPPHOI.CLOUD — SQL MIGRATION ĐỢT 12B (2026)
-- 1. Quy chuẩn Luồng chuyển tiếp 6 bước chặt chẽ theo phòng ban + Lịch sử bàn giao
-- 2. Bổ sung cột material_grade trên purchase_request_items & purchase_order_items
-- Chạy an toàn nhiều lần (idempotent) trên Supabase SQL Editor.
-- ============================================================================

-- 1. MỞ RỘNG CỘT QUY TRÌNH & LỊCH SỬ CHUYỂN GIAO TRÊN public.projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS po_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_pushed_by UUID,
  ADD COLUMN IF NOT EXISTS workflow_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.projects
  ALTER COLUMN workflow_status SET DEFAULT 'po_draft';

DO $$
BEGIN
  ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_workflow_status_check;
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_workflow_status_check
    CHECK (workflow_status IN ('po_draft', 'waiting_drawings', 'drawings_ready', 'bom_submitted', 'in_production', 'completed'));
END $$;

-- Mở rộng loại thông báo trên public.wms_notifications
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
      CHECK (type IN ('po_pushed', 'drawings_ready', 'bom_submitted', 'material_ready', 'pr_pending', 'po_overdue', 'workflow_returned'));
  END IF;
END $$;

-- 2. BỔ SUNG CỘT material_grade TRÊN CÁC BẢNG MUA HÀNG (PR / PO)
ALTER TABLE public.purchase_request_items
  ADD COLUMN IF NOT EXISTS material_grade TEXT NOT NULL DEFAULT '';

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS material_grade TEXT NOT NULL DEFAULT '';

-- Backfill dữ liệu cũ từ project_material_requests -> purchase_request_items -> purchase_order_items
UPDATE public.purchase_request_items AS pri
SET material_grade = COALESCE(pmr.material_grade, '')
FROM public.project_material_requests AS pmr
WHERE pri.project_request_id = pmr.id
  AND COALESCE(pri.material_grade, '') = ''
  AND COALESCE(pmr.material_grade, '') <> '';

UPDATE public.purchase_order_items AS poi
SET material_grade = COALESCE(pri.material_grade, '')
FROM public.purchase_request_items AS pri
WHERE poi.pr_item_id = pri.id
  AND COALESCE(poi.material_grade, '') = ''
  AND COALESCE(pri.material_grade, '') <> '';

-- 3. NÂNG CẤP RPC transition_project_workflow(p_project_id, p_next_status, p_note)
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
  v_prev TEXT;
  v_prev_ord INT;
  v_next_ord INT;
  v_bom_cnt INT := 0;
  v_note TEXT := btrim(COALESCE(p_note, ''));
  v_history JSONB;
  v_new_entry JSONB;
  v_po_label TEXT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Bạn chưa đăng nhập.';
  END IF;
  v_username := COALESCE(public.get_my_username(), v_role);

  IF p_next_status NOT IN ('po_draft', 'waiting_drawings', 'drawings_ready', 'bom_submitted', 'in_production', 'completed') THEN
    RAISE EXCEPTION 'Trạng thái quy trình "%" không hợp lệ.', p_next_status;
  END IF;

  SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn hàng / dự án %', p_project_id;
  END IF;

  v_prev := COALESCE(v_proj.workflow_status, 'po_draft');
  IF v_prev = p_next_status THEN
    RAISE EXCEPTION 'Đơn hàng đang ở trạng thái "%" rồi.', p_next_status;
  END IF;

  v_prev_ord := CASE v_prev
    WHEN 'po_draft' THEN 1
    WHEN 'waiting_drawings' THEN 2
    WHEN 'drawings_ready' THEN 3
    WHEN 'bom_submitted' THEN 4
    WHEN 'in_production' THEN 5
    WHEN 'completed' THEN 6
    ELSE 0
  END;

  v_next_ord := CASE p_next_status
    WHEN 'po_draft' THEN 1
    WHEN 'waiting_drawings' THEN 2
    WHEN 'drawings_ready' THEN 3
    WHEN 'bom_submitted' THEN 4
    WHEN 'in_production' THEN 5
    WHEN 'completed' THEN 6
    ELSE 0
  END;

  IF v_next_ord <> v_prev_ord + 1 AND v_next_ord <> v_prev_ord - 1 THEN
    RAISE EXCEPTION 'Không thể chuyển nhảy cóc từ "%" sang "%". Vui lòng đi đúng từng bước quy trình.', v_prev, p_next_status;
  END IF;

  v_po_label := CASE WHEN COALESCE(v_proj.customer_po_no, '') <> '' THEN ' · PO: ' || v_proj.customer_po_no ELSE '' END;

  -- CHUYỂN TIẾP TIẾN (FORWARD)
  IF v_next_ord = v_prev_ord + 1 THEN
    IF v_prev = 'po_draft' AND p_next_status = 'waiting_drawings' THEN
      IF v_role NOT IN ('sales', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Kinh doanh (sales) hoặc Admin mới được đẩy PO sang Phòng Kỹ thuật.';
      END IF;
      UPDATE public.projects
      SET workflow_status = 'waiting_drawings',
          po_pushed_at = v_now,
          po_pushed_by = auth.uid(),
          updated_at = v_now
      WHERE id = p_project_id;

      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['engineer', 'admin'],
        'po_pushed',
        p_project_id,
        '📐 Yêu cầu bản vẽ KT: ' || COALESCE(v_proj.name, p_project_id),
        'Đơn hàng ' || COALESCE(v_proj.name, p_project_id) || v_po_label || ' cần Phòng Kỹ thuật gửi bản vẽ.',
        jsonb_build_object('project_id', p_project_id, 'project_name', COALESCE(v_proj.name, p_project_id), 'customer_po_no', COALESCE(v_proj.customer_po_no, ''), 'note', v_note)
      );

    ELSIF v_prev = 'waiting_drawings' AND p_next_status = 'drawings_ready' THEN
      IF v_role NOT IN ('engineer', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Kỹ thuật (engineer) hoặc Admin mới được bàn giao bản vẽ cho Kinh doanh.';
      END IF;
      UPDATE public.projects
      SET workflow_status = 'drawings_ready',
          drawings_handed_over_at = v_now,
          drawings_handed_over_by = auth.uid(),
          updated_at = v_now
      WHERE id = p_project_id;

      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['sales', 'admin'],
        'drawings_ready',
        p_project_id,
        '📐 Đã có bản vẽ KT: ' || COALESCE(v_proj.name, p_project_id),
        'Phòng Kỹ thuật đã giao bản vẽ đơn ' || COALESCE(v_proj.name, p_project_id) || v_po_label || ', mời Kinh doanh lập ĐNVT.',
        jsonb_build_object('project_id', p_project_id, 'project_name', COALESCE(v_proj.name, p_project_id), 'customer_po_no', COALESCE(v_proj.customer_po_no, ''), 'note', v_note)
      );

    ELSIF v_prev = 'drawings_ready' AND p_next_status = 'bom_submitted' THEN
      IF v_role NOT IN ('sales', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Kinh doanh (sales) hoặc Admin mới được chuyển ĐNVT sang Kho & Sản xuất.';
      END IF;
      SELECT COUNT(*) INTO v_bom_cnt FROM public.project_material_requests WHERE project_id = p_project_id;
      IF COALESCE(v_bom_cnt, 0) < 1 THEN
        RAISE EXCEPTION 'Đơn hàng chưa có dòng Đề nghị vật tư nào! Vui lòng lập hoặc nhập Excel ĐNMVT01 trước khi chuyển sang Kho.';
      END IF;

      UPDATE public.projects
      SET workflow_status = 'bom_submitted',
          bom_submitted_at = v_now,
          bom_submitted_by = auth.uid(),
          updated_at = v_now
      WHERE id = p_project_id;

      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['warehouse', 'operator', 'admin'],
        'bom_submitted',
        p_project_id,
        '📤 Có Đề nghị VT mới: ' || COALESCE(v_proj.name, p_project_id),
        'Phòng Kinh doanh đã chuyển ĐNVT đơn ' || COALESCE(v_proj.name, p_project_id) || v_po_label || ' sang Kho & Sản xuất.',
        jsonb_build_object('project_id', p_project_id, 'project_name', COALESCE(v_proj.name, p_project_id), 'customer_po_no', COALESCE(v_proj.customer_po_no, ''), 'note', v_note)
      );

    ELSIF v_prev = 'bom_submitted' AND p_next_status = 'in_production' THEN
      IF v_role NOT IN ('warehouse', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Bộ phận Kho (warehouse) hoặc Admin mới được chuyển sang Đang sản xuất.';
      END IF;
      UPDATE public.projects
      SET workflow_status = 'in_production',
          updated_at = v_now
      WHERE id = p_project_id;

    ELSIF v_prev = 'in_production' AND p_next_status = 'completed' THEN
      IF v_role NOT IN ('warehouse', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Bộ phận Kho (warehouse) hoặc Admin mới được xác nhận Hoàn thành đơn hàng.';
      END IF;
      UPDATE public.projects
      SET workflow_status = 'completed',
          updated_at = v_now
      WHERE id = p_project_id;
    ELSE
      RAISE EXCEPTION 'Chuyển trạng thái từ "%" sang "%" không hợp lệ.', v_prev, p_next_status;
    END IF;

  -- TRẢ VỀ BƯỚC TRƯỚC (RETURN)
  ELSE
    IF v_note = '' THEN
      RAISE EXCEPTION 'Vui lòng nhập lý do bắt buộc khi trả về bước trước.';
    END IF;

    IF v_prev = 'waiting_drawings' AND p_next_status = 'po_draft' THEN
      IF v_role NOT IN ('engineer', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Kỹ thuật hoặc Admin mới được trả bước Chờ bản vẽ về Kinh doanh.';
      END IF;
      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['sales', 'admin'],
        'workflow_returned',
        p_project_id,
        '↩️ Trả lại hồ sơ PO: ' || COALESCE(v_proj.name, p_project_id),
        'Kỹ thuật (' || v_username || ') trả về bước Tạo PO. Lý do: ' || v_note,
        jsonb_build_object('project_id', p_project_id, 'from', v_prev, 'to', p_next_status, 'reason', v_note)
      );

    ELSIF v_prev = 'drawings_ready' AND p_next_status = 'waiting_drawings' THEN
      IF v_role NOT IN ('sales', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Kinh doanh hoặc Admin mới được trả lại Kỹ thuật chỉnh sửa bản vẽ.';
      END IF;
      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['engineer', 'admin'],
        'workflow_returned',
        p_project_id,
        '↩️ Yêu cầu sửa bản vẽ: ' || COALESCE(v_proj.name, p_project_id),
        'Kinh doanh (' || v_username || ') trả về bước Kỹ thuật. Lý do: ' || v_note,
        jsonb_build_object('project_id', p_project_id, 'from', v_prev, 'to', p_next_status, 'reason', v_note)
      );

    ELSIF v_prev = 'bom_submitted' AND p_next_status = 'drawings_ready' THEN
      IF v_role NOT IN ('warehouse', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Bộ phận Kho hoặc Admin mới được trả ĐNVT về Kinh doanh.';
      END IF;
      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['sales', 'admin'],
        'workflow_returned',
        p_project_id,
        '↩️ Trả lại ĐNVT: ' || COALESCE(v_proj.name, p_project_id),
        'Kho (' || v_username || ') trả ĐNVT về Kinh doanh sửa. Lý do: ' || v_note,
        jsonb_build_object('project_id', p_project_id, 'from', v_prev, 'to', p_next_status, 'reason', v_note)
      );

    ELSIF v_prev = 'in_production' AND p_next_status = 'bom_submitted' THEN
      IF v_role NOT IN ('warehouse', 'admin') THEN
        RAISE EXCEPTION 'Chỉ Bộ phận Kho hoặc Admin mới được hoàn trạng thái về Chờ rà phôi.';
      END IF;
      INSERT INTO public.wms_notifications (target_roles, type, project_id, title, message, payload_json)
      VALUES (
        ARRAY['warehouse', 'admin'],
        'workflow_returned',
        p_project_id,
        '↩️ Quay lại bước Rà phôi: ' || COALESCE(v_proj.name, p_project_id),
        v_username || ' chuyển về bước Rà phôi. Lý do: ' || v_note,
        jsonb_build_object('project_id', p_project_id, 'from', v_prev, 'to', p_next_status, 'reason', v_note)
      );

    ELSE
      RAISE EXCEPTION 'Không hỗ trợ trả ngược từ "%" về "%".', v_prev, p_next_status;
    END IF;

    UPDATE public.projects
    SET workflow_status = p_next_status,
        updated_at = v_now
    WHERE id = p_project_id;
  END IF;

  -- Ghi lịch sử chuyển giao vào projects.workflow_history
  v_new_entry := jsonb_build_object(
    'from', v_prev,
    'to', p_next_status,
    'at', v_now,
    'by', v_username,
    'by_id', auth.uid(),
    'role', v_role,
    'note', v_note,
    'direction', CASE WHEN v_next_ord < v_prev_ord THEN 'return' ELSE 'forward' END
  );

  UPDATE public.projects
  SET workflow_history = COALESCE(workflow_history, '[]'::jsonb) || jsonb_build_array(v_new_entry)
  WHERE id = p_project_id
  RETURNING workflow_history INTO v_history;

  PERFORM public._write_wms_audit_log(
    'transition_project_workflow',
    'projects',
    p_project_id,
    v_username,
    v_new_entry
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'project_id', p_project_id,
    'from_status', v_prev,
    'workflow_status', p_next_status,
    'workflow_history', COALESCE(v_history, '[]'::jsonb)
  );
END;
$$;
