-- ============================================================================
-- SUPABASE MIGRATION ĐỢT 3 — KHO PHÔI ĐỀ-XÊ (stock_offcuts) & UX XƯỞNG CNC
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (Idempotent / An toàn chạy lại)
-- Yêu cầu tiên quyết: Đã chạy SQL Đợt 2 (có public.set_updated_at, is_workshop_member, is_admin_or_engineer)
-- ============================================================================

-- 1. Đảm bảo bảng public.cut_progress có đủ cột updated_by & pattern_hash
ALTER TABLE public.cut_progress
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS pattern_hash TEXT NOT NULL DEFAULT '';

-- 2. Tạo bảng Kho phôi dư tái sử dụng (public.stock_offcuts)
CREATE TABLE IF NOT EXISTS public.stock_offcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile TEXT NOT NULL,
  length_mm NUMERIC NOT NULL CHECK (length_mm > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  source_project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
  source_project_name TEXT NOT NULL DEFAULT '',
  source_bar_key TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_offcuts_profile ON public.stock_offcuts (profile);
CREATE INDEX IF NOT EXISTS idx_stock_offcuts_created_at ON public.stock_offcuts (created_at DESC);

-- Chống bấm nhập kho đề-xê trùng lặp cho cùng 1 cây của cùng 1 dự án
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_offcuts_unique_source_bar
  ON public.stock_offcuts (source_project_id, source_bar_key)
  WHERE source_project_id IS NOT NULL AND source_bar_key <> '';

-- 3. Trigger tự động cập nhật updated_at & Replica Identity cho Realtime
DROP TRIGGER IF EXISTS trg_stock_offcuts_updated_at ON public.stock_offcuts;
CREATE TRIGGER trg_stock_offcuts_updated_at
  BEFORE UPDATE ON public.stock_offcuts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stock_offcuts REPLICA IDENTITY FULL;

-- 4. Bật Realtime publication cho public.stock_offcuts (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'stock_offcuts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_offcuts';
  END IF;
END;
$$;

-- 5. Khóa quyền anon & cấu hình Row Level Security (RLS) cho public.stock_offcuts
REVOKE ALL ON TABLE public.stock_offcuts FROM anon;
REVOKE ALL ON TABLE public.stock_offcuts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_offcuts TO authenticated;

ALTER TABLE public.stock_offcuts ENABLE ROW LEVEL SECURITY;

-- Mọi nhân sự xưởng đã đăng nhập (admin, engineer, operator) đều được xem kho đề-xê
DROP POLICY IF EXISTS "stock_offcuts_select_authenticated_member" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_select_authenticated_member"
  ON public.stock_offcuts FOR SELECT TO authenticated
  USING (public.is_workshop_member());

-- Cả thợ CNC (operator), kỹ sư (engineer) và admin đều được bấm nhập đề-xê mới
DROP POLICY IF EXISTS "stock_offcuts_insert_authenticated_member" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_insert_authenticated_member"
  ON public.stock_offcuts FOR INSERT TO authenticated
  WITH CHECK (public.is_workshop_member());

-- Chỉ kỹ sư (engineer) và admin mới được sửa số lượng / sử dụng hoặc thanh lý đề-xê
DROP POLICY IF EXISTS "stock_offcuts_update_engineer_admin" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_update_engineer_admin"
  ON public.stock_offcuts FOR UPDATE TO authenticated
  USING (public.is_admin_or_engineer())
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "stock_offcuts_delete_engineer_admin" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_delete_engineer_admin"
  ON public.stock_offcuts FOR DELETE TO authenticated
  USING (public.is_admin_or_engineer());
