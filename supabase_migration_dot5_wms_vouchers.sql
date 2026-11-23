-- ============================================================================
-- SUPABASE MIGRATION ĐỢT 5 — NÂNG CẤP KHO NGUYÊN VẬT LIỆU (WMS) & CHỨNG TỪ KHO
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (Idempotent / An toàn chạy lại)
-- Yêu cầu tiên quyết: Đã chạy SQL Đợt 2, Đợt 3 và Đợt 4
-- ============================================================================

-- 1. MỞ RỘNG BẢNG public.inventory HỖ TRỢ 4 NHÓM VẬT TƯ XƯỞNG CƠ KHÍ
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS material_group TEXT NOT NULL DEFAULT 'tube_1d',
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'cây',
  ADD COLUMN IF NOT EXISTS spec_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS avg_cost NUMERIC NOT NULL DEFAULT 0;

-- Cho phép tồn kho chứa số thập phân (kg, m...) nhưng vẫn giữ toàn vẹn với cây/tấm nguyên
ALTER TABLE public.inventory
  ALTER COLUMN stock_qty TYPE NUMERIC USING COALESCE(stock_qty, 0)::NUMERIC;

-- Chuẩn hóa dữ liệu cũ
UPDATE public.inventory
SET material_group = 'tube_1d'
WHERE material_group IS NULL OR btrim(material_group) = '';

UPDATE public.inventory
SET unit = 'cây'
WHERE unit IS NULL OR btrim(unit) = '';

UPDATE public.inventory
SET avg_cost = COALESCE(unit_price, 0)
WHERE COALESCE(avg_cost, 0) = 0 AND COALESCE(unit_price, 0) > 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_material_group'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_material_group
      CHECK (material_group IN ('tube_1d', 'sheet_2d', 'solid_cnc', 'consumable'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_unit'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_unit
      CHECK (unit IN ('cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_avg_cost_nonneg'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_avg_cost_nonneg CHECK (avg_cost >= 0);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_sku_unique
  ON public.inventory (sku)
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

CREATE INDEX IF NOT EXISTS idx_inventory_material_group
  ON public.inventory (material_group);

-- ============================================================================
-- 2. MỞ RỘNG 5 VAI TRÒ TRONG public.profiles & HÀM HELPER RBAC
-- Vai trò: admin | engineer | warehouse (Thủ kho) | accountant (Kế toán/Mua hàng) | operator (Thợ CNC)
-- ============================================================================
DO $$
DECLARE
  c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;

  ALTER TABLE public.profiles
    ADD CONSTRAINT chk_profiles_role_v5
    CHECK (role IN ('admin', 'engineer', 'warehouse', 'accountant', 'operator'));
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workshop_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin', 'engineer', 'warehouse', 'accountant', 'operator'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_warehouse_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin', 'warehouse'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_inventory()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin', 'engineer', 'warehouse'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.can_create_vouchers()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin', 'engineer', 'warehouse', 'accountant'), FALSE);
$$;

REVOKE ALL ON FUNCTION public.is_workshop_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_warehouse_or_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_inventory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_vouchers() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_workshop_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_warehouse_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_inventory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_vouchers() TO authenticated;

-- Cập nhật policy kho cho phép Thủ kho (warehouse) thao tác cùng Admin & Kỹ sư
DROP POLICY IF EXISTS "inventory_insert_engineer_admin" ON public.inventory;
CREATE POLICY "inventory_insert_engineer_admin"
  ON public.inventory FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_inventory());

DROP POLICY IF EXISTS "inventory_update_engineer_admin" ON public.inventory;
CREATE POLICY "inventory_update_engineer_admin"
  ON public.inventory FOR UPDATE TO authenticated
  USING (public.can_manage_inventory())
  WITH CHECK (public.can_manage_inventory());

DROP POLICY IF EXISTS "inventory_delete_engineer_admin" ON public.inventory;
CREATE POLICY "inventory_delete_engineer_admin"
  ON public.inventory FOR DELETE TO authenticated
  USING (public.can_manage_inventory());

DROP POLICY IF EXISTS "stock_offcuts_update_engineer_admin" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_update_engineer_admin"
  ON public.stock_offcuts FOR UPDATE TO authenticated
  USING (public.can_manage_inventory())
  WITH CHECK (public.can_manage_inventory());

DROP POLICY IF EXISTS "stock_offcuts_delete_engineer_admin" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_delete_engineer_admin"
  ON public.stock_offcuts FOR DELETE TO authenticated
  USING (public.can_manage_inventory());

-- ============================================================================
-- 3. TẠO BỘ BẢNG CHỨNG TỪ KHO (SUPPLIERS, WAREHOUSE VOUCHERS, ITEMS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers (name);

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.warehouse_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_code TEXT NOT NULL UNIQUE,
  voucher_type TEXT NOT NULL CHECK (voucher_type IN ('IN', 'OUT', 'RETURN', 'ADJUST')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'cancelled')),
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  department TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  attachment_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL DEFAULT '',
  created_by_uid UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_by_uid UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vouchers_created_at ON public.warehouse_vouchers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_type_status ON public.warehouse_vouchers (voucher_type, status);
CREATE INDEX IF NOT EXISTS idx_vouchers_project_id ON public.warehouse_vouchers (project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vouchers_supplier_id ON public.warehouse_vouchers (supplier_id)
  WHERE supplier_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_warehouse_vouchers_updated_at ON public.warehouse_vouchers;
CREATE TRIGGER trg_warehouse_vouchers_updated_at
  BEFORE UPDATE ON public.warehouse_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hàm & Trigger tự sinh mã chứng từ chuẩn PNK-YYYYMMDD-XXX, PXK-..., PHK-..., KKK-...
CREATE OR REPLACE FUNCTION public.generate_voucher_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_date_str TEXT;
  v_full_prefix TEXT;
  v_seq INTEGER;
BEGIN
  IF NEW.voucher_code IS NOT NULL AND btrim(NEW.voucher_code) <> '' THEN
    RETURN NEW;
  END IF;

  v_prefix := CASE NEW.voucher_type
    WHEN 'IN' THEN 'PNK'
    WHEN 'OUT' THEN 'PXK'
    WHEN 'RETURN' THEN 'PHK'
    WHEN 'ADJUST' THEN 'KKK'
    ELSE 'PKK'
  END;

  v_date_str := to_char(timezone('Asia/Ho_Chi_Minh', COALESCE(NEW.created_at, now())), 'YYYYMMDD');
  v_full_prefix := v_prefix || '-' || v_date_str || '-';

  -- Khóa mức transaction tránh trùng số thứ tự khi 2 người cùng lập phiếu đồng thời
  PERFORM pg_advisory_xact_lock(hashtext('voucher_code_' || v_full_prefix));

  SELECT COALESCE(
    MAX(
      CASE
        WHEN substring(voucher_code FROM length(v_full_prefix) + 1) ~ '^[0-9]+$'
        THEN substring(voucher_code FROM length(v_full_prefix) + 1)::INTEGER
        ELSE 0
      END
    ),
    0
  ) + 1
  INTO v_seq
  FROM public.warehouse_vouchers
  WHERE voucher_code LIKE v_full_prefix || '%';

  NEW.voucher_code := v_full_prefix || lpad(v_seq::TEXT, 3, '0');
  IF NEW.created_by_uid IS NULL THEN
    NEW.created_by_uid := auth.uid();
  END IF;
  IF COALESCE(btrim(NEW.created_by), '') = '' THEN
    NEW.created_by := COALESCE(public.get_my_username(), '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouse_vouchers_code ON public.warehouse_vouchers;
CREATE TRIGGER trg_warehouse_vouchers_code
  BEFORE INSERT ON public.warehouse_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.generate_voucher_code();

CREATE TABLE IF NOT EXISTS public.warehouse_voucher_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.warehouse_vouchers(id) ON DELETE CASCADE,
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE SET NULL,
  offcut_id UUID REFERENCES public.stock_offcuts(id) ON DELETE SET NULL,
  profile TEXT NOT NULL,
  material_group TEXT NOT NULL DEFAULT 'tube_1d' CHECK (material_group IN ('tube_1d', 'sheet_2d', 'solid_cnc', 'consumable')),
  unit TEXT NOT NULL DEFAULT 'cây' CHECK (unit IN ('cây', 'tấm', 'kg', 'cái', 'bộ', 'hộp', 'm')),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  length_mm NUMERIC CHECK (length_mm IS NULL OR length_mm > 0),
  unit_price NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_items_voucher_id ON public.warehouse_voucher_items (voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_items_inventory_id ON public.warehouse_voucher_items (inventory_id)
  WHERE inventory_id IS NOT NULL;

-- ============================================================================
-- 4. MỞ RỘNG SỔ CÁI public.inventory_transactions LIÊN KẾT CHỨNG TỪ
-- ============================================================================
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES public.warehouse_vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.inventory_transactions
  ALTER COLUMN qty_change TYPE NUMERIC USING qty_change::NUMERIC,
  ALTER COLUMN balance_after TYPE NUMERIC USING balance_after::NUMERIC;

CREATE INDEX IF NOT EXISTS idx_inv_tx_voucher_id
  ON public.inventory_transactions (voucher_id)
  WHERE voucher_id IS NOT NULL;

DO $$
DECLARE
  c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.inventory_transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tx_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.inventory_transactions DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;

  ALTER TABLE public.inventory_transactions
    ADD CONSTRAINT chk_inv_tx_type CHECK (tx_type IN (
      'opening_balance',
      'purchase_in',
      'project_out',
      'offcut_in',
      'offcut_out',
      'stocktake_adjust',
      'project_return',
      'voucher_in',
      'voucher_out',
      'voucher_return',
      'voucher_adjust',
      'voucher_cancel_reversal'
    ));
END;
$$;

DROP POLICY IF EXISTS "inventory_transactions_insert_role_scoped" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_insert_role_scoped"
  ON public.inventory_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_inventory()
    OR (
      public.is_workshop_member()
      AND tx_type = 'offcut_in'
      AND qty_change > 0
    )
  );

DROP POLICY IF EXISTS "inventory_transactions_update_engineer_admin" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_update_engineer_admin"
  ON public.inventory_transactions FOR UPDATE TO authenticated
  USING (public.can_manage_inventory())
  WITH CHECK (public.can_manage_inventory());

DROP POLICY IF EXISTS "inventory_transactions_delete_engineer_admin" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_delete_engineer_admin"
  ON public.inventory_transactions FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============================================================================
-- 5. BẬT REALTIME & BẢO MẬT RLS CHO BỘ BẢNG CHỨNG TỪ + STORAGE BUCKET
-- ============================================================================
ALTER TABLE public.suppliers REPLICA IDENTITY FULL;
ALTER TABLE public.warehouse_vouchers REPLICA IDENTITY FULL;
ALTER TABLE public.warehouse_voucher_items REPLICA IDENTITY FULL;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['suppliers', 'warehouse_vouchers', 'warehouse_voucher_items']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.suppliers, public.warehouse_vouchers, public.warehouse_voucher_items FROM anon;
REVOKE ALL ON TABLE public.suppliers, public.warehouse_vouchers, public.warehouse_voucher_items FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers, public.warehouse_vouchers, public.warehouse_voucher_items TO authenticated;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_voucher_items ENABLE ROW LEVEL SECURITY;

-- RLS suppliers
DROP POLICY IF EXISTS "suppliers_select_member" ON public.suppliers;
CREATE POLICY "suppliers_select_member"
  ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "suppliers_write_creators" ON public.suppliers;
CREATE POLICY "suppliers_write_creators"
  ON public.suppliers FOR ALL TO authenticated
  USING (public.can_create_vouchers())
  WITH CHECK (public.can_create_vouchers());

-- RLS warehouse_vouchers
DROP POLICY IF EXISTS "vouchers_select_member" ON public.warehouse_vouchers;
CREATE POLICY "vouchers_select_member"
  ON public.warehouse_vouchers FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "vouchers_insert_creators" ON public.warehouse_vouchers;
CREATE POLICY "vouchers_insert_creators"
  ON public.warehouse_vouchers FOR INSERT TO authenticated
  WITH CHECK (
    public.can_create_vouchers()
    AND status IN ('draft', 'pending')
  );

DROP POLICY IF EXISTS "vouchers_update_draft_or_pending" ON public.warehouse_vouchers;
CREATE POLICY "vouchers_update_draft_or_pending"
  ON public.warehouse_vouchers FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR (public.can_create_vouchers() AND status IN ('draft', 'pending'))
  )
  WITH CHECK (
    public.is_admin()
    OR (public.can_create_vouchers() AND status IN ('draft', 'pending'))
  );

DROP POLICY IF EXISTS "vouchers_delete_admin_or_draft" ON public.warehouse_vouchers;
CREATE POLICY "vouchers_delete_admin_or_draft"
  ON public.warehouse_vouchers FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR (public.can_create_vouchers() AND status IN ('draft', 'pending'))
  );

-- RLS warehouse_voucher_items
DROP POLICY IF EXISTS "voucher_items_select_member" ON public.warehouse_voucher_items;
CREATE POLICY "voucher_items_select_member"
  ON public.warehouse_voucher_items FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "voucher_items_write_pending" ON public.warehouse_voucher_items;
CREATE POLICY "voucher_items_write_pending"
  ON public.warehouse_voucher_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.warehouse_vouchers v
      WHERE v.id = voucher_id
        AND (public.is_admin() OR (public.can_create_vouchers() AND v.status IN ('draft', 'pending')))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.warehouse_vouchers v
      WHERE v.id = voucher_id
        AND (public.is_admin() OR (public.can_create_vouchers() AND v.status IN ('draft', 'pending')))
    )
  );

-- Storage bucket 'voucher-attachments' cho ảnh phiếu giao hàng / hóa đơn (< 5MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voucher-attachments', 'voucher-attachments', false, 5242880, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880;

DROP POLICY IF EXISTS "voucher_att_auth_select" ON storage.objects;
CREATE POLICY "voucher_att_auth_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'voucher-attachments' AND public.is_workshop_member());

DROP POLICY IF EXISTS "voucher_att_auth_insert" ON storage.objects;
CREATE POLICY "voucher_att_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voucher-attachments' AND public.can_create_vouchers());

DROP POLICY IF EXISTS "voucher_att_auth_update" ON storage.objects;
CREATE POLICY "voucher_att_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'voucher-attachments' AND public.can_create_vouchers())
  WITH CHECK (bucket_id = 'voucher-attachments' AND public.can_create_vouchers());

DROP POLICY IF EXISTS "voucher_att_auth_delete" ON storage.objects;
CREATE POLICY "voucher_att_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'voucher-attachments' AND public.is_admin());

-- ============================================================================
-- 6. POSTGRESQL ATOMIC RPC: DUYỆT PHIẾU & HỦY PHIẾU KHO
-- ============================================================================
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

  -- Khóa chứng từ chống bấm duyệt trùng 2 lần đồng thời
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
    -- Tìm hoặc khóa bản ghi vật tư tương ứng
    IF v_voucher.voucher_type = 'OUT' AND v_item.offcut_id IS NOT NULL THEN
      SELECT * INTO v_off
      FROM public.stock_offcuts
      WHERE id = v_item.offcut_id
      FOR UPDATE;

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
        'offcut_out',
        v_off.profile,
        COALESCE(v_off.length_mm, 1000),
        -v_item.qty,
        v_new_qty,
        v_voucher.project_id,
        p_voucher_id,
        COALESCE(v_item.unit_price, 0),
        COALESCE(NULLIF(v_item.note, ''), 'Xuất đề-xê theo ' || v_voucher.voucher_code),
        v_username
      );
      CONTINUE;
    END IF;

    -- Tìm dòng inventory (theo inventory_id hoặc profile_name)
    v_inv := NULL;
    IF v_item.inventory_id IS NOT NULL THEN
      SELECT * INTO v_inv
      FROM public.inventory
      WHERE id = v_item.inventory_id
      FOR UPDATE;
    END IF;

    IF v_inv.id IS NULL AND COALESCE(btrim(v_item.profile), '') <> '' THEN
      SELECT * INTO v_inv
      FROM public.inventory
      WHERE profile_name = btrim(v_item.profile)
      FOR UPDATE;
    END IF;

    -- Nếu phiếu NHẬP / HOÀN KHO vật tư chưa từng có trong thư viện -> tự tạo dòng inventory
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
          v_std_len,
          v_std_len,
          0,
          COALESCE(v_item.unit_price, 0),
          COALESCE(v_item.unit_price, 0),
          'Tự động tạo từ chứng từ ' || v_voucher.voucher_code,
          FALSE
        )
        ON CONFLICT (profile_name) DO UPDATE
          SET updated_at = v_approved_at
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
        v_new_avg_cost := ROUND(
          ((GREATEST(v_old_qty, 0) * v_old_cost) + (v_item.qty * v_eff_price))
          / NULLIF(GREATEST(v_old_qty, 0) + v_item.qty, 0),
          2
        );
      ELSE
        v_new_avg_cost := v_old_cost;
      END IF;

      UPDATE public.inventory
      SET stock_qty = v_new_qty,
          avg_cost = COALESCE(v_new_avg_cost, 0),
          unit_price = CASE WHEN v_eff_price > 0 THEN v_eff_price ELSE unit_price END,
          updated_at = v_approved_at
      WHERE id = v_inv.id;

      UPDATE public.warehouse_voucher_items
      SET inventory_id = v_inv.id,
          total_amount = ROUND(v_item.qty * v_eff_price, 2)
      WHERE id = v_item.id;

      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'voucher_in',
        v_inv.profile_name,
        v_std_len,
        v_item.qty,
        v_new_qty,
        v_voucher.project_id,
        p_voucher_id,
        v_eff_price,
        COALESCE(NULLIF(v_item.note, ''), 'Nhập kho theo ' || v_voucher.voucher_code),
        v_username
      );

    ELSIF v_voucher.voucher_type = 'OUT' THEN
      IF NOT v_voucher.allow_negative AND v_old_qty < v_item.qty THEN
        RAISE EXCEPTION 'Không đủ tồn kho "%": hiện còn % %, yêu cầu xuất % %',
          v_inv.profile_name, v_old_qty, v_inv.unit, v_item.qty, v_inv.unit;
      END IF;

      v_new_qty := GREATEST(0, v_old_qty - v_item.qty);
      v_eff_price := v_old_cost;

      UPDATE public.inventory
      SET stock_qty = v_new_qty,
          updated_at = v_approved_at
      WHERE id = v_inv.id;

      -- Chốt giá vốn bình quân hiện hành vào dòng chứng từ xuất
      UPDATE public.warehouse_voucher_items
      SET inventory_id = v_inv.id,
          unit_price = v_eff_price,
          total_amount = ROUND(v_item.qty * v_eff_price, 2)
      WHERE id = v_item.id;

      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'voucher_out',
        v_inv.profile_name,
        v_std_len,
        -v_item.qty,
        v_new_qty,
        v_voucher.project_id,
        p_voucher_id,
        v_eff_price,
        COALESCE(NULLIF(v_item.note, ''), 'Xuất kho theo ' || v_voucher.voucher_code),
        v_username
      );

    ELSIF v_voucher.voucher_type = 'RETURN' THEN
      -- Nếu là thép hộp/ống 1D và chiều dài trả ngắn hơn cây chuẩn -> đưa vào kho đề-xê
      IF v_inv.material_group = 'tube_1d' AND v_item.length_mm IS NOT NULL AND v_item.length_mm < COALESCE(v_inv.standard_length_mm, 6000) THEN
        INSERT INTO public.stock_offcuts (
          profile, length_mm, quantity, source_project_id, source_project_name,
          source_bar_key, source_type, rack_location, status, note, notes, created_by
        ) VALUES (
          v_inv.profile_name,
          v_item.length_mm,
          GREATEST(1, ROUND(v_item.qty)::INTEGER),
          v_voucher.project_id,
          COALESCE(v_voucher.department, ''),
          '',
          'cnc_return',
          v_inv.rack_location,
          'available',
          'Hoàn kho đề-xê theo ' || v_voucher.voucher_code,
          'Hoàn kho đề-xê theo ' || v_voucher.voucher_code,
          v_username
        )
        RETURNING * INTO v_off;

        UPDATE public.warehouse_voucher_items
        SET inventory_id = v_inv.id,
            offcut_id = v_off.id,
            unit_price = v_old_cost,
            total_amount = ROUND(v_item.qty * v_old_cost, 2)
        WHERE id = v_item.id;

        INSERT INTO public.inventory_transactions (
          tx_type, profile, length_mm, qty_change, balance_after,
          project_id, voucher_id, unit_price, note, created_by
        ) VALUES (
          'offcut_in',
          v_inv.profile_name,
          v_item.length_mm,
          v_item.qty,
          GREATEST(1, ROUND(v_item.qty)::INTEGER),
          v_voucher.project_id,
          p_voucher_id,
          v_old_cost,
          COALESCE(NULLIF(v_item.note, ''), 'Hoàn phôi đề-xê theo ' || v_voucher.voucher_code),
          v_username
        );
      ELSE
        v_new_qty := v_old_qty + v_item.qty;
        UPDATE public.inventory
        SET stock_qty = v_new_qty,
            updated_at = v_approved_at
        WHERE id = v_inv.id;

        UPDATE public.warehouse_voucher_items
        SET inventory_id = v_inv.id,
            unit_price = v_old_cost,
            total_amount = ROUND(v_item.qty * v_old_cost, 2)
        WHERE id = v_item.id;

        INSERT INTO public.inventory_transactions (
          tx_type, profile, length_mm, qty_change, balance_after,
          project_id, voucher_id, unit_price, note, created_by
        ) VALUES (
          'voucher_return',
          v_inv.profile_name,
          v_std_len,
          v_item.qty,
          v_new_qty,
          v_voucher.project_id,
          p_voucher_id,
          v_old_cost,
          COALESCE(NULLIF(v_item.note, ''), 'Hoàn kho nguyên vật tư theo ' || v_voucher.voucher_code),
          v_username
        );
      END IF;

    ELSIF v_voucher.voucher_type = 'ADJUST' THEN
      -- Với phiếu kiểm kê ADJUST: qty trên dòng item chính là tồn thực tế sau kiểm kê
      v_new_qty := GREATEST(0, v_item.qty);
      v_delta := v_new_qty - v_old_qty;

      UPDATE public.inventory
      SET stock_qty = v_new_qty,
          updated_at = v_approved_at
      WHERE id = v_inv.id;

      UPDATE public.warehouse_voucher_items
      SET inventory_id = v_inv.id,
          unit_price = v_old_cost,
          total_amount = ROUND(ABS(v_delta) * v_old_cost, 2)
      WHERE id = v_item.id;

      INSERT INTO public.inventory_transactions (
        tx_type, profile, length_mm, qty_change, balance_after,
        project_id, voucher_id, unit_price, note, created_by
      ) VALUES (
        'voucher_adjust',
        v_inv.profile_name,
        v_std_len,
        v_delta,
        v_new_qty,
        v_voucher.project_id,
        p_voucher_id,
        v_old_cost,
        COALESCE(NULLIF(v_item.note, ''), 'Điều chỉnh kiểm kê theo ' || v_voucher.voucher_code),
        v_username
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

  SELECT * INTO v_voucher
  FROM public.warehouse_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

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
    SET status = 'cancelled',
        cancel_reason = v_clean_reason,
        updated_at = v_now
    WHERE id = p_voucher_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'voucher_id', p_voucher_id,
      'voucher_code', v_voucher.voucher_code,
      'status', 'cancelled',
      'reversed', FALSE
    );
  END IF;

  -- Với phiếu đã hạch toán ('approved'): CHỈ Admin mới được hủy & đảo ngược kho
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'Phiếu % đã được duyệt hạch toán — chỉ Admin mới có quyền hủy và đảo ngược tồn kho!', v_voucher.voucher_code;
  END IF;

  -- Đảo ngược từng bút toán trong inventory_transactions của phiếu này
  FOR v_tx IN
    SELECT * FROM public.inventory_transactions
    WHERE voucher_id = p_voucher_id
      AND tx_type <> 'voucher_cancel_reversal'
    ORDER BY created_at DESC, id DESC
  LOOP
    v_rev_qty := -v_tx.qty_change;

    IF v_tx.tx_type = 'offcut_out' THEN
      -- Cộng lại phôi đề-xê đã xuất theo item hoặc tìm khớp profile + length_mm
      SELECT * INTO v_off
      FROM public.stock_offcuts
      WHERE id IN (
        SELECT offcut_id FROM public.warehouse_voucher_items
        WHERE voucher_id = p_voucher_id AND offcut_id IS NOT NULL
      )
      AND profile = v_tx.profile
      LIMIT 1
      FOR UPDATE;

      IF v_off.id IS NOT NULL THEN
        v_new_qty := GREATEST(0, COALESCE(v_off.quantity, 0) + ABS(v_tx.qty_change));
        UPDATE public.stock_offcuts
        SET quantity = v_new_qty::INTEGER,
            status = CASE WHEN v_new_qty > 0 THEN 'available' ELSE 'used' END,
            updated_at = v_now
        WHERE id = v_off.id;
      ELSE
        v_new_qty := ABS(v_tx.qty_change);
      END IF;
    ELSIF v_tx.tx_type = 'offcut_in' THEN
      -- Trừ bớt đoạn đề-xê từng nhập hoàn kho
      SELECT * INTO v_off
      FROM public.stock_offcuts
      WHERE id IN (
        SELECT offcut_id FROM public.warehouse_voucher_items
        WHERE voucher_id = p_voucher_id AND offcut_id IS NOT NULL
      )
      AND profile = v_tx.profile
      LIMIT 1
      FOR UPDATE;

      IF v_off.id IS NOT NULL THEN
        v_new_qty := GREATEST(0, COALESCE(v_off.quantity, 0) - ABS(v_tx.qty_change));
        UPDATE public.stock_offcuts
        SET quantity = v_new_qty::INTEGER,
            status = CASE WHEN v_new_qty > 0 THEN 'available' ELSE 'used' END,
            updated_at = v_now
        WHERE id = v_off.id;
      ELSE
        v_new_qty := 0;
      END IF;
    ELSE
      SELECT * INTO v_inv
      FROM public.inventory
      WHERE profile_name = v_tx.profile
      FOR UPDATE;

      IF v_inv.id IS NOT NULL THEN
        v_new_qty := GREATEST(0, COALESCE(v_inv.stock_qty, 0) + v_rev_qty);
        UPDATE public.inventory
        SET stock_qty = v_new_qty,
            updated_at = v_now
        WHERE id = v_inv.id;
      ELSE
        v_new_qty := NULL;
      END IF;
    END IF;

    INSERT INTO public.inventory_transactions (
      tx_type, profile, length_mm, qty_change, balance_after,
      project_id, voucher_id, unit_price, note, created_by
    ) VALUES (
      'voucher_cancel_reversal',
      v_tx.profile,
      v_tx.length_mm,
      v_rev_qty,
      v_new_qty,
      v_tx.project_id,
      p_voucher_id,
      v_tx.unit_price,
      'Đảo kho do Admin hủy phiếu ' || v_voucher.voucher_code || ': ' || v_clean_reason,
      v_username
    );
  END LOOP;

  UPDATE public.warehouse_vouchers
  SET status = 'cancelled',
      cancel_reason = v_clean_reason,
      updated_at = v_now
  WHERE id = p_voucher_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'voucher_id', p_voucher_id,
    'voucher_code', v_voucher.voucher_code,
    'status', 'cancelled',
    'reversed', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_warehouse_voucher(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_warehouse_voucher(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_warehouse_voucher(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_warehouse_voucher(UUID, TEXT) TO authenticated;
