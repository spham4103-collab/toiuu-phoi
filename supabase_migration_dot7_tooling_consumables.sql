-- ============================================================================
-- MIGRATION ĐỢT 7: QUẢN LÝ CHUYÊN SÂU DAO CỤ CẮT GỌT CNC (tooling)
--                  & VẬT TƯ PHỤ CƠ KHÍ (consumable)
-- Chạy 1 lần trong Supabase SQL Editor (Idempotent / An toàn chạy lại)
-- ============================================================================

-- ============================================================================
-- 1. MỞ RỘNG BẢNG public.inventory HỖ TRỢ 5 NHÓM + DAO CỤ & QUY ĐỔI ĐÓNG GÓI
-- ============================================================================
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS sub_category TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS pack_unit TEXT,
  ADD COLUMN IF NOT EXISTS pack_qty NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_inventory_sub_category ON public.inventory (sub_category) WHERE sub_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_brand ON public.inventory (brand) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_returnable ON public.inventory (is_returnable) WHERE is_returnable = TRUE;

DO $$
DECLARE
  c_name TEXT;
BEGIN
  -- Mở rộng CHECK material_group trên inventory (5 nhóm)
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.inventory'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%material_group%'
  LOOP
    EXECUTE format('ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
  ALTER TABLE public.inventory
    ADD CONSTRAINT chk_inventory_material_group
    CHECK (material_group IN ('tube_1d', 'sheet_2d', 'solid_cnc', 'tooling', 'consumable'));

  -- Mở rộng CHECK unit trên inventory
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.inventory'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%unit%'
  LOOP
    EXECUTE format('ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
  ALTER TABLE public.inventory
    ADD CONSTRAINT chk_inventory_unit
    CHECK (unit IN ('cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm', 'đoạn', 'viên', 'mũi', 'cuộn', 'can', 'lít', 'vỉ', 'thùng'));

  -- Ràng buộc pack_qty > 0
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_pack_qty_pos' AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_pack_qty_pos CHECK (pack_qty > 0);
  END IF;
END;
$$;

-- ============================================================================
-- 2. MỞ RỘNG BẢNG public.warehouse_vouchers & public.warehouse_voucher_items
-- ============================================================================
ALTER TABLE public.warehouse_vouchers
  ADD COLUMN IF NOT EXISTS machine_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recipient_name TEXT NOT NULL DEFAULT '';

ALTER TABLE public.warehouse_voucher_items
  ADD COLUMN IF NOT EXISTS issue_reason TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS returned_old_qty NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_voucher_items_issue_reason ON public.warehouse_voucher_items (issue_reason);

DO $$
DECLARE
  c_name TEXT;
BEGIN
  -- Mở rộng CHECK material_group trên warehouse_voucher_items (5 nhóm)
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.warehouse_voucher_items'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%material_group%'
  LOOP
    EXECUTE format('ALTER TABLE public.warehouse_voucher_items DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
  ALTER TABLE public.warehouse_voucher_items
    ADD CONSTRAINT chk_voucher_items_material_group
    CHECK (material_group IN ('tube_1d', 'sheet_2d', 'solid_cnc', 'tooling', 'consumable'));

  -- Mở rộng CHECK unit trên warehouse_voucher_items
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.warehouse_voucher_items'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%unit%'
  LOOP
    EXECUTE format('ALTER TABLE public.warehouse_voucher_items DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
  ALTER TABLE public.warehouse_voucher_items
    ADD CONSTRAINT chk_voucher_items_unit
    CHECK (unit IN ('cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm', 'đoạn', 'viên', 'mũi', 'cuộn', 'can', 'lít', 'vỉ', 'thùng'));

  -- CHECK issue_reason & returned_old_qty
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_voucher_items_issue_reason' AND conrelid = 'public.warehouse_voucher_items'::regclass
  ) THEN
    ALTER TABLE public.warehouse_voucher_items
      ADD CONSTRAINT chk_voucher_items_issue_reason
      CHECK (issue_reason IN ('new', 'worn_exchange', 'broken_exchange', 'borrow', 'return_tool'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_voucher_items_returned_old_nonneg' AND conrelid = 'public.warehouse_voucher_items'::regclass
  ) THEN
    ALTER TABLE public.warehouse_voucher_items
      ADD CONSTRAINT chk_voucher_items_returned_old_nonneg CHECK (returned_old_qty >= 0);
  END IF;
END;
$$;

-- ============================================================================
-- 3. RPC THỐNG KÊ TIÊU HAO DAO CỤ & VẬT TƯ PHỤ (get_tooling_consumption_report)
-- Tự ẩn cột tiền nếu người gọi không đạt can_view_wms_prices()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_tooling_consumption_report(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  machine_name TEXT,
  recipient_name TEXT,
  material_group TEXT,
  sub_category TEXT,
  profile TEXT,
  brand TEXT,
  unit TEXT,
  total_qty NUMERIC,
  new_qty NUMERIC,
  worn_qty NUMERIC,
  broken_qty NUMERIC,
  borrow_qty NUMERIC,
  returned_old_qty NUMERIC,
  total_cost NUMERIC,
  broken_cost NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_can_price BOOLEAN;
BEGIN
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'accountant', 'warehouse', 'engineer') THEN
    RAISE EXCEPTION 'Permission denied: Chỉ thành viên quản lý kho/kỹ thuật/kế toán mới được xem thống kê dao cụ';
  END IF;

  v_can_price := public.can_view_wms_prices();

  RETURN QUERY
  SELECT
    COALESCE(NULLIF(btrim(v.machine_name), ''), COALESCE(NULLIF(btrim(v.department), ''), 'Chung')) AS machine_name,
    COALESCE(NULLIF(btrim(v.recipient_name), ''), '—') AS recipient_name,
    vi.material_group,
    COALESCE(inv.sub_category, 'khac') AS sub_category,
    vi.profile,
    COALESCE(inv.brand, '') AS brand,
    vi.unit,
    ROUND(SUM(vi.qty), 3) AS total_qty,
    ROUND(SUM(CASE WHEN COALESCE(vi.issue_reason, 'new') = 'new' THEN vi.qty ELSE 0 END), 3) AS new_qty,
    ROUND(SUM(CASE WHEN vi.issue_reason = 'worn_exchange' THEN vi.qty ELSE 0 END), 3) AS worn_qty,
    ROUND(SUM(CASE WHEN vi.issue_reason = 'broken_exchange' THEN vi.qty ELSE 0 END), 3) AS broken_qty,
    ROUND(SUM(CASE WHEN vi.issue_reason = 'borrow' THEN vi.qty ELSE 0 END), 3) AS borrow_qty,
    ROUND(SUM(COALESCE(vi.returned_old_qty, 0)), 3) AS returned_old_qty,
    CASE WHEN v_can_price THEN ROUND(SUM(CASE WHEN vi.total_amount > 0 THEN vi.total_amount ELSE vi.qty * vi.unit_price END), 0) ELSE 0 END AS total_cost,
    CASE WHEN v_can_price THEN ROUND(SUM(CASE WHEN vi.issue_reason = 'broken_exchange' THEN (CASE WHEN vi.total_amount > 0 THEN vi.total_amount ELSE vi.qty * vi.unit_price END) ELSE 0 END), 0) ELSE 0 END AS broken_cost
  FROM public.warehouse_vouchers v
  JOIN public.warehouse_voucher_items vi ON vi.voucher_id = v.id
  LEFT JOIN public.inventory inv ON inv.id = vi.inventory_id OR inv.profile_name = vi.profile
  WHERE v.status = 'approved'
    AND v.voucher_type = 'OUT'
    AND vi.material_group IN ('tooling', 'consumable')
    AND (p_from IS NULL OR COALESCE(v.approved_at, v.created_at) >= p_from)
    AND (p_to IS NULL OR COALESCE(v.approved_at, v.created_at) <= p_to)
  GROUP BY
    COALESCE(NULLIF(btrim(v.machine_name), ''), COALESCE(NULLIF(btrim(v.department), ''), 'Chung')),
    COALESCE(NULLIF(btrim(v.recipient_name), ''), '—'),
    vi.material_group,
    COALESCE(inv.sub_category, 'khac'),
    vi.profile,
    COALESCE(inv.brand, ''),
    vi.unit
  ORDER BY total_qty DESC, vi.profile ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tooling_consumption_report(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tooling_consumption_report(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
