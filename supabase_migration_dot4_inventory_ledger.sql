-- ============================================================================
-- SUPABASE MIGRATION ĐỢT 4 — HỆ THỐNG KHO PHÔI VẬT TƯ & SỔ CÁI XUẤT-NHẬP
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (Idempotent / An toàn chạy lại)
-- Yêu cầu tiên quyết: Đã chạy SQL Đợt 2 & Đợt 3
--   (có public.set_updated_at, is_workshop_member, is_admin_or_engineer, stock_offcuts)
-- ============================================================================

-- 1. MỞ RỘNG BẢNG public.inventory (KHO CÂY NGUYÊN TIÊU CHUẨN & THƯ VIỆN QUY CÁCH)
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS standard_length_mm NUMERIC NOT NULL DEFAULT 6000,
  ADD COLUMN IF NOT EXISTS min_stock_qty INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight_per_m NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rack_location TEXT NOT NULL DEFAULT '';

-- Đồng bộ chiều dài chuẩn từ cột cũ standard_length (nếu đã từng tùy chỉnh trước đó)
UPDATE public.inventory
SET standard_length_mm = COALESCE(standard_length, 6000)
WHERE standard_length_mm IS NULL
   OR (standard_length IS NOT NULL AND standard_length <> 6000 AND standard_length_mm = 6000);

-- Chuyển toàn bộ stock_qty NULL thành 0 để chuẩn hóa tồn kho cây nguyên thực tế
UPDATE public.inventory
SET stock_qty = 0
WHERE stock_qty IS NULL;

ALTER TABLE public.inventory
  ALTER COLUMN stock_qty SET DEFAULT 0,
  ALTER COLUMN stock_qty SET NOT NULL;

-- Thêm các ràng buộc không âm (Idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_stock_qty_nonneg'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_stock_qty_nonneg CHECK (stock_qty >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_min_stock_qty_nonneg'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_min_stock_qty_nonneg CHECK (min_stock_qty >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_weight_per_m_nonneg'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_weight_per_m_nonneg CHECK (weight_per_m >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_unit_price_nonneg'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_unit_price_nonneg CHECK (unit_price >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_inventory_std_len_pos'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT chk_inventory_std_len_pos CHECK (standard_length_mm > 0);
  END IF;
END;
$$;

-- 2. MỞ RỘNG BẢNG public.stock_offcuts (KHO PHÔI LẺ & ĐỀ-XÊ)
ALTER TABLE public.stock_offcuts
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS rack_location TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_stock_offcuts_source_type'
      AND conrelid = 'public.stock_offcuts'::regclass
  ) THEN
    ALTER TABLE public.stock_offcuts
      ADD CONSTRAINT chk_stock_offcuts_source_type
      CHECK (source_type IN ('opening_stock', 'cnc_return', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_stock_offcuts_status'
      AND conrelid = 'public.stock_offcuts'::regclass
  ) THEN
    ALTER TABLE public.stock_offcuts
      ADD CONSTRAINT chk_stock_offcuts_status
      CHECK (status IN ('available', 'reserved', 'used'));
  END IF;
END;
$$;

-- Đồng bộ dữ liệu cũ sang các cột mới
UPDATE public.stock_offcuts
SET note = notes
WHERE note = '' AND notes <> '';

UPDATE public.stock_offcuts
SET source_type = 'cnc_return'
WHERE source_type = 'manual'
  AND (source_bar_key <> '' OR source_project_id IS NOT NULL);

UPDATE public.stock_offcuts
SET status = 'used'
WHERE quantity = 0 AND status = 'available';

CREATE INDEX IF NOT EXISTS idx_stock_offcuts_status ON public.stock_offcuts (status);
CREATE INDEX IF NOT EXISTS idx_stock_offcuts_source_type ON public.stock_offcuts (source_type);

-- 3. MỞ RỘNG BẢNG public.projects (CHỐNG TRỪ KHO TRÙNG LẶP)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS inventory_deducted_at TIMESTAMPTZ;

-- 4. TẠO BẢNG SỔ CÁI GIAO DỊCH KHO (public.inventory_transactions)
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_type TEXT NOT NULL CHECK (tx_type IN (
    'opening_balance',
    'purchase_in',
    'project_out',
    'offcut_in',
    'offcut_out',
    'stocktake_adjust',
    'project_return'
  )),
  profile TEXT NOT NULL,
  length_mm NUMERIC NOT NULL DEFAULT 6000 CHECK (length_mm > 0),
  qty_change INTEGER NOT NULL,
  balance_after INTEGER,
  project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_created_at ON public.inventory_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_tx_profile ON public.inventory_transactions (profile);
CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON public.inventory_transactions (tx_type);
CREATE INDEX IF NOT EXISTS idx_inv_tx_project_id ON public.inventory_transactions (project_id)
  WHERE project_id IS NOT NULL;

-- 5. BẬT REPLICA IDENTITY & REALTIME CHO public.inventory_transactions
ALTER TABLE public.inventory_transactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'inventory_transactions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_transactions';
  END IF;
END;
$$;

-- 6. BẢO MẬT RLS CHẶT CHẼ CHO CÁC BẢNG KHO & SỔ CÁI
REVOKE ALL ON TABLE public.inventory, public.stock_offcuts, public.inventory_transactions FROM anon;
REVOKE ALL ON TABLE public.inventory_transactions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_transactions TO authenticated;

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_offcuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Chính sách RLS cho public.inventory_transactions:
-- + authenticated (admin, engineer, operator): được SELECT
DROP POLICY IF EXISTS "inventory_transactions_select_member" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_select_member"
  ON public.inventory_transactions FOR SELECT TO authenticated
  USING (public.is_workshop_member());

-- + admin & engineer: toàn quyền INSERT
-- + operator (Thợ CNC): CHỈ được INSERT khi tx_type = 'offcut_in' và qty_change > 0 (nhập đề-xê từ /cnc)
DROP POLICY IF EXISTS "inventory_transactions_insert_role_scoped" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_insert_role_scoped"
  ON public.inventory_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_engineer()
    OR (
      public.is_workshop_member()
      AND tx_type = 'offcut_in'
      AND qty_change > 0
    )
  );

-- + Chỉ admin & engineer mới được UPDATE / DELETE sổ cái
DROP POLICY IF EXISTS "inventory_transactions_update_engineer_admin" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_update_engineer_admin"
  ON public.inventory_transactions FOR UPDATE TO authenticated
  USING (public.is_admin_or_engineer())
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "inventory_transactions_delete_engineer_admin" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_delete_engineer_admin"
  ON public.inventory_transactions FOR DELETE TO authenticated
  USING (public.is_admin_or_engineer());
