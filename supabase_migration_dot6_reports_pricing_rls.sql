-- ============================================================================
-- MIGRATION ĐỢT 6: HỆ THỐNG BÁO CÁO NXT, GIÁ VỐN DỰ ÁN, NHÀ CUNG CẤP
--                  VÀ PHÂN QUYỀN ẨN/HIỆN ĐƠN GIÁ (WMS GIAI ĐOẠN 3)
-- Chạy 1 lần trong Supabase SQL Editor (an toàn, idempotent, tương thích ngược)
-- ============================================================================

-- ============================================================================
-- 1. BẢNG CẤU HÌNH HỆ THỐNG (public.wms_settings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.wms_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT ''
);

INSERT INTO public.wms_settings (key, value, updated_by)
VALUES ('allow_engineer_view_price', 'false'::jsonb, 'system')
ON CONFLICT (key) DO NOTHING;

REVOKE ALL ON TABLE public.wms_settings FROM anon;
REVOKE ALL ON TABLE public.wms_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wms_settings TO authenticated;

ALTER TABLE public.wms_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_settings_select_member" ON public.wms_settings;
CREATE POLICY "wms_settings_select_member"
  ON public.wms_settings FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "wms_settings_write_admin" ON public.wms_settings;
CREATE POLICY "wms_settings_write_admin"
  ON public.wms_settings FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- 2. MỞ RỘNG CHECK ĐƠN VỊ TÍNH ('đoạn') TRÊN warehouse_voucher_items
-- ============================================================================
DO $$
DECLARE
  c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.warehouse_voucher_items'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%unit%'
  LOOP
    EXECUTE format('ALTER TABLE public.warehouse_voucher_items DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;

  ALTER TABLE public.warehouse_voucher_items
    ADD CONSTRAINT chk_voucher_items_unit
    CHECK (unit IN ('cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm', 'đoạn'));
END;
$$;

-- ============================================================================
-- 3. HÀM KIỂM TRA QUYỀN XEM ĐƠN GIÁ & TÀI CHÍNH (can_view_wms_prices)
-- Chỉ TRUE cho: admin | accountant | (engineer KHI allow_engineer_view_price = true)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_view_wms_prices()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_eng_allow BOOLEAN := FALSE;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_role IN ('admin', 'accountant') THEN
    RETURN TRUE;
  END IF;
  IF v_role = 'engineer' THEN
    SELECT COALESCE((value)::boolean, FALSE)
    INTO v_eng_allow
    FROM public.wms_settings
    WHERE key = 'allow_engineer_view_price'
    LIMIT 1;
    RETURN COALESCE(v_eng_allow, FALSE);
  END IF;
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_wms_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_wms_prices() TO authenticated;

-- ============================================================================
-- 4. SIẾT CHẶT RLS BẢNG NHÀ CUNG CẤP & CHỨNG TỪ TÀI CHÍNH
-- ============================================================================
DROP POLICY IF EXISTS "suppliers_select_member" ON public.suppliers;
CREATE POLICY "suppliers_select_member"
  ON public.suppliers FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant', 'warehouse'));

DROP POLICY IF EXISTS "suppliers_write_creators" ON public.suppliers;
CREATE POLICY "suppliers_write_creators"
  ON public.suppliers FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'accountant'))
  WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "vouchers_select_member" ON public.warehouse_vouchers;
CREATE POLICY "vouchers_select_member"
  ON public.warehouse_vouchers FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'engineer', 'warehouse', 'accountant'));

DROP POLICY IF EXISTS "voucher_items_select_member" ON public.warehouse_voucher_items;
CREATE POLICY "voucher_items_select_member"
  ON public.warehouse_voucher_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'engineer', 'warehouse', 'accountant'));

-- ============================================================================
-- 5. RPC BÁO CÁO NHẬP – XUẤT – TỒN (get_nxt_report)
-- Đảm bảo bất biến: opening_qty + in_qty - out_qty = closing_qty
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_nxt_report(
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_material_group TEXT DEFAULT NULL
)
RETURNS TABLE (
  inventory_id UUID,
  profile_name TEXT,
  sku TEXT,
  material_group TEXT,
  unit TEXT,
  avg_cost NUMERIC,
  opening_qty NUMERIC,
  opening_value NUMERIC,
  in_qty NUMERIC,
  in_value NUMERIC,
  out_qty NUMERIC,
  out_value NUMERIC,
  closing_qty NUMERIC,
  closing_value NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from TIMESTAMPTZ := COALESCE(p_from, date_trunc('month', now()));
  v_to TIMESTAMPTZ := COALESCE(p_to, now());
  v_grp TEXT := NULLIF(btrim(COALESCE(p_material_group, '')), '');
BEGIN
  IF NOT public.can_view_wms_prices() THEN
    RAISE EXCEPTION 'Permission denied: Bạn không có quyền xem báo cáo Nhập - Xuất - Tồn & Giá vốn';
  END IF;

  RETURN QUERY
  WITH inv_base AS (
    SELECT
      i.id,
      i.profile_name,
      COALESCE(i.sku, '') AS sku,
      COALESCE(i.material_group, 'tube_1d') AS material_group,
      COALESCE(i.unit, 'cây') AS unit,
      COALESCE(i.avg_cost, i.unit_price, 0)::NUMERIC AS avg_cost,
      COALESCE(i.stock_qty, 0)::NUMERIC AS current_qty
    FROM public.inventory i
    WHERE v_grp IS NULL OR v_grp = 'ALL' OR COALESCE(i.material_group, 'tube_1d') = v_grp
  ),
  tx_agg AS (
    SELECT
      t.profile,
      COALESCE(SUM(CASE WHEN t.created_at > v_to THEN t.qty_change ELSE 0 END), 0)::NUMERIC AS net_after_to,
      COALESCE(SUM(CASE WHEN t.created_at >= v_from AND t.created_at <= v_to AND t.qty_change > 0 THEN t.qty_change ELSE 0 END), 0)::NUMERIC AS period_in_qty,
      COALESCE(SUM(CASE WHEN t.created_at >= v_from AND t.created_at <= v_to AND t.qty_change > 0 THEN t.qty_change * COALESCE(NULLIF(t.unit_price, 0), 0) ELSE 0 END), 0)::NUMERIC AS period_in_val,
      COALESCE(SUM(CASE WHEN t.created_at >= v_from AND t.created_at <= v_to AND t.qty_change < 0 THEN ABS(t.qty_change) ELSE 0 END), 0)::NUMERIC AS period_out_qty,
      COALESCE(SUM(CASE WHEN t.created_at >= v_from AND t.created_at <= v_to AND t.qty_change < 0 THEN ABS(t.qty_change) * COALESCE(NULLIF(t.unit_price, 0), 0) ELSE 0 END), 0)::NUMERIC AS period_out_val
    FROM public.inventory_transactions t
    WHERE COALESCE(t.tx_type, '') NOT IN ('offcut_in', 'offcut_out')
    GROUP BY t.profile
  ),
  calc AS (
    SELECT
      b.id AS inventory_id,
      b.profile_name,
      b.sku,
      b.material_group,
      b.unit,
      b.avg_cost,
      (b.current_qty - COALESCE(a.net_after_to, 0))::NUMERIC AS c_qty,
      COALESCE(a.period_in_qty, 0)::NUMERIC AS i_qty,
      COALESCE(a.period_in_val, 0)::NUMERIC AS i_val_raw,
      COALESCE(a.period_out_qty, 0)::NUMERIC AS o_qty,
      COALESCE(a.period_out_val, 0)::NUMERIC AS o_val_raw
    FROM inv_base b
    LEFT JOIN tx_agg a ON a.profile = b.profile_name
  )
  SELECT
    c.inventory_id,
    c.profile_name,
    c.sku,
    c.material_group,
    c.unit,
    ROUND(c.avg_cost, 2) AS avg_cost,
    ROUND(c.c_qty - c.i_qty + c.o_qty, 3) AS opening_qty,
    ROUND((c.c_qty - c.i_qty + c.o_qty) * c.avg_cost, 0) AS opening_value,
    ROUND(c.i_qty, 3) AS in_qty,
    ROUND(CASE WHEN c.i_val_raw > 0 THEN c.i_val_raw ELSE c.i_qty * c.avg_cost END, 0) AS in_value,
    ROUND(c.o_qty, 3) AS out_qty,
    ROUND(CASE WHEN c.o_val_raw > 0 THEN c.o_val_raw ELSE c.o_qty * c.avg_cost END, 0) AS out_value,
    ROUND(c.c_qty, 3) AS closing_qty,
    ROUND(c.c_qty * c.avg_cost, 0) AS closing_value
  FROM calc c
  ORDER BY c.material_group ASC, c.profile_name ASC;
END;
$$;

-- ============================================================================
-- 6. RPC BÁO CÁO GIÁ VỐN NGUYÊN VẬT LIỆU THEO DỰ ÁN (get_project_cost_report)
-- ============================================================================
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
  net_cost NUMERIC,
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
      vi.note
    FROM proj_vouchers pv
    JOIN public.warehouse_voucher_items vi ON vi.voucher_id = pv.voucher_id
    LEFT JOIN public.inventory inv ON inv.id = vi.inventory_id OR inv.profile_name = vi.profile
  ),
  agg AS (
    SELECT
      pi.project_id,
      COUNT(DISTINCT CASE WHEN pi.voucher_type = 'OUT' THEN pi.voucher_id END)::INTEGER AS out_cnt,
      COUNT(DISTINCT CASE WHEN pi.voucher_type = 'RETURN' THEN pi.voucher_id END)::INTEGER AS ret_cnt,
      COALESCE(SUM(CASE WHEN pi.voucher_type = 'OUT' THEN pi.eff_total_amount ELSE 0 END), 0)::NUMERIC AS out_val,
      COALESCE(SUM(CASE WHEN pi.voucher_type = 'RETURN' THEN pi.eff_total_amount ELSE 0 END), 0)::NUMERIC AS ret_val,
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
    ROUND(a.out_val - a.ret_val, 0) AS net_cost,
    a.items_json
  FROM agg a
  LEFT JOIN public.projects p ON p.id = a.project_id
  ORDER BY (a.out_val - a.ret_val) DESC, project_name ASC;
END;
$$;

-- ============================================================================
-- 7. RPC TỔNG HỢP NHÀ CUNG CẤP (get_supplier_purchase_summary)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_supplier_purchase_summary(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  supplier_id UUID,
  code TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  tax_code TEXT,
  address TEXT,
  note TEXT,
  pnk_count INTEGER,
  total_amount NUMERIC,
  last_purchase_at TIMESTAMPTZ,
  vouchers_json JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_view_wms_prices() THEN
    RAISE EXCEPTION 'Permission denied: Bạn không có quyền xem tổng hợp giá trị Nhà cung cấp';
  END IF;

  RETURN QUERY
  WITH voucher_totals AS (
    SELECT
      v.id AS voucher_id,
      v.supplier_id,
      v.voucher_code,
      v.invoice_no,
      COALESCE(v.approved_at, v.created_at) AS tx_at,
      COALESCE(SUM(CASE WHEN vi.total_amount > 0 THEN vi.total_amount ELSE ROUND(vi.qty * vi.unit_price, 0) END), 0)::NUMERIC AS v_amount
    FROM public.warehouse_vouchers v
    LEFT JOIN public.warehouse_voucher_items vi ON vi.voucher_id = v.id
    WHERE v.voucher_type = 'IN'
      AND v.status = 'approved'
      AND v.supplier_id IS NOT NULL
      AND (p_from IS NULL OR COALESCE(v.approved_at, v.created_at) >= p_from)
      AND (p_to IS NULL OR COALESCE(v.approved_at, v.created_at) <= p_to)
    GROUP BY v.id, v.supplier_id, v.voucher_code, v.invoice_no, COALESCE(v.approved_at, v.created_at)
  )
  SELECT
    s.id AS supplier_id,
    s.code,
    s.name,
    s.phone,
    s.email,
    s.tax_code,
    s.address,
    s.note,
    COUNT(vt.voucher_id)::INTEGER AS pnk_count,
    ROUND(COALESCE(SUM(vt.v_amount), 0), 0) AS total_amount,
    MAX(vt.tx_at) AS last_purchase_at,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'voucher_id', vt.voucher_id,
          'voucher_code', vt.voucher_code,
          'invoice_no', vt.invoice_no,
          'tx_at', vt.tx_at,
          'amount', vt.v_amount
        )
        ORDER BY vt.tx_at DESC
      ) FILTER (WHERE vt.voucher_id IS NOT NULL),
      '[]'::jsonb
    ) AS vouchers_json
  FROM public.suppliers s
  LEFT JOIN voucher_totals vt ON vt.supplier_id = s.id
  GROUP BY s.id, s.code, s.name, s.phone, s.email, s.tax_code, s.address, s.note
  ORDER BY total_amount DESC, s.name ASC;
END;
$$;

-- ============================================================================
-- 8. RPC ĐÓNG KÍN LUỒNG TRẢ ĐỀ-XÊ TỪ THỢ CNC (submit_cnc_offcut_return)
-- Cho phép cả Thợ CNC (operator) gửi Phiếu Hoàn Kho (RETURN) trạng thái pending
-- ============================================================================
CREATE OR REPLACE FUNCTION public.submit_cnc_offcut_return(
  p_project_id TEXT,
  p_profile TEXT,
  p_length_mm NUMERIC,
  p_qty NUMERIC,
  p_rack_location TEXT DEFAULT '',
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_username TEXT;
  v_profile TEXT := btrim(COALESCE(p_profile, ''));
  v_inv_id UUID;
  v_avg_cost NUMERIC := 0;
  v_std_len NUMERIC := 6000;
  v_unit_price NUMERIC := 0;
  v_voucher_id UUID;
  v_voucher_code TEXT;
  v_note TEXT;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'engineer', 'warehouse', 'operator') THEN
    RAISE EXCEPTION 'Permission denied: Chỉ thành viên xưởng mới có quyền trả đề-xê CNC';
  END IF;

  IF v_profile = '' THEN
    RAISE EXCEPTION 'Thiếu quy cách phôi đề-xê';
  END IF;
  IF COALESCE(p_length_mm, 0) <= 0 OR COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Chiều dài và số lượng đề-xê phải lớn hơn 0';
  END IF;

  v_username := COALESCE(public.get_my_username(), 'operator');

  SELECT id, COALESCE(avg_cost, unit_price, 0), COALESCE(NULLIF(standard_length_mm, 0), 6000)
  INTO v_inv_id, v_avg_cost, v_std_len
  FROM public.inventory
  WHERE profile_name = v_profile
  LIMIT 1;

  IF v_avg_cost > 0 AND v_std_len > 0 THEN
    v_unit_price := ROUND((v_avg_cost * p_length_mm) / v_std_len, 0);
  END IF;

  v_note := btrim(COALESCE(p_note, ''));
  IF btrim(COALESCE(p_rack_location, '')) <> '' THEN
    v_note := CASE WHEN v_note = '' THEN 'Kệ: ' || btrim(p_rack_location) ELSE v_note || ' · Kệ: ' || btrim(p_rack_location) END;
  END IF;

  INSERT INTO public.warehouse_vouchers (
    voucher_code,
    voucher_type,
    status,
    project_id,
    department,
    note,
    created_by,
    created_by_uid
  ) VALUES (
    '',
    'RETURN',
    'pending',
    NULLIF(btrim(COALESCE(p_project_id, '')), ''),
    'Tổ Laser CNC',
    COALESCE(NULLIF(v_note, ''), 'Thợ CNC báo trả đề-xê về kho'),
    v_username,
    auth.uid()
  )
  RETURNING id, voucher_code INTO v_voucher_id, v_voucher_code;

  INSERT INTO public.warehouse_voucher_items (
    voucher_id,
    inventory_id,
    profile,
    material_group,
    unit,
    qty,
    length_mm,
    unit_price,
    total_amount,
    note
  ) VALUES (
    v_voucher_id,
    v_inv_id,
    v_profile,
    'tube_1d',
    'đoạn',
    p_qty,
    p_length_mm,
    v_unit_price,
    ROUND(p_qty * v_unit_price, 0),
    v_note
  );

  RETURN jsonb_build_object(
    'voucher_id', v_voucher_id,
    'voucher_code', v_voucher_code,
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_nxt_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_cost_report(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_supplier_purchase_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_cnc_offcut_return(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_nxt_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_cost_report(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_purchase_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_cnc_offcut_return(TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
