-- ============================================================================
-- SUPABASE DATABASE SCHEMA CHO HỆ THỐNG XẾP PHÔI CƠ KHÍ AN BÌNH (xepphoi.cloud)
-- Single Source of Truth: Supabase Auth + PostgreSQL + Realtime + Private Storage
-- Đã cập nhật hoàn chỉnh theo Đợt 2 (Auth + RLS theo vai trò admin / engineer / operator)
-- An toàn khi chạy lại nhiều lần (Idempotent) trong Supabase SQL Editor
-- ============================================================================

-- 1. Extension hỗ trợ gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Trigger function tự động cập nhật cột updated_at khi UPDATE dòng dữ liệu
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. BẢNG PROFILES NHÂN SỰ XƯỞNG (public.profiles) LIÊN KẾT auth.users(id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'engineer', 'operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. BẢNG THƯ VIỆN QUY CÁCH THÉP HỘP / ỐNG & KHO PHÔI (public.inventory)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('square', 'rect', 'round', 'other')),
  standard_length NUMERIC NOT NULL DEFAULT 6000,
  stock_qty INTEGER, -- NULL = mua mới không giới hạn số lượng
  notes TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. BẢNG DỰ ÁN & ĐƠN HÀNG CẮT PHÔI (public.projects)
-- Lưu danh sách dự án, bản nháp (__draft__), thùng rác (is_trashed) & metadata IGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
  is_draft BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'fusion360', 'import')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  igs_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON public.projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_active_filter ON public.projects (is_trashed, is_draft);

-- ============================================================================
-- 6. BẢNG TIẾN ĐỘ CẮT CNC THEO TỪNG CÂY (public.cut_progress)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cut_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bar_key TEXT NOT NULL, -- Ví dụ: 'Hộp 30x30x1.8__A'
  profile_name TEXT NOT NULL DEFAULT '',
  bar_letter TEXT NOT NULL DEFAULT '',
  cut_count INTEGER NOT NULL DEFAULT 0 CHECK (cut_count >= 0),
  total_count INTEGER NOT NULL DEFAULT 1 CHECK (total_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cutting', 'done')),
  pattern_hash TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, bar_key)
);

CREATE INDEX IF NOT EXISTS idx_cut_progress_project_id ON public.cut_progress (project_id);

-- ============================================================================
-- 6B. BẢNG KHO PHÔI DƯ TÁI SỬ DỤNG / ĐỀ-XÊ (public.stock_offcuts)
-- ============================================================================
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_offcuts_unique_source_bar
  ON public.stock_offcuts (source_project_id, source_bar_key)
  WHERE source_project_id IS NOT NULL AND source_bar_key <> '';

-- ============================================================================
-- 7. GẮN TRIGGER updated_at & REPLICA IDENTITY CHO REALTIME
-- ============================================================================
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_updated_at ON public.inventory;
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cut_progress_updated_at ON public.cut_progress;
CREATE TRIGGER trg_cut_progress_updated_at
  BEFORE UPDATE ON public.cut_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_stock_offcuts_updated_at ON public.stock_offcuts;
CREATE TRIGGER trg_stock_offcuts_updated_at
  BEFORE UPDATE ON public.stock_offcuts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.inventory REPLICA IDENTITY FULL;
ALTER TABLE public.projects REPLICA IDENTITY DEFAULT;
ALTER TABLE public.cut_progress REPLICA IDENTITY FULL;
ALTER TABLE public.stock_offcuts REPLICA IDENTITY FULL;

-- ============================================================================
-- 8. BẬT REALTIME PUBLICATION CHO CẢ 5 BẢNG
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['profiles', 'inventory', 'projects', 'cut_progress', 'stock_offcuts']
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

-- ============================================================================
-- 9. HÀM HELPER SECURITY DEFINER (TRÁNH ĐỆ QUY RLS) & HÀM PING KEEPALIVE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_username()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT username FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_workshop_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin', 'engineer', 'operator'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_engineer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin', 'engineer'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() = 'admin', FALSE);
$$;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_username() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workshop_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_or_engineer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_username() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workshop_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_engineer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.ping()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'ok'::text;
$$;

REVOKE ALL ON FUNCTION public.ping() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ping() TO anon, authenticated;

-- ============================================================================
-- 10. STORAGE BUCKET PRIVATE 'igs-files' & POLICY CHO NHÂN SỰ ĐÃ ĐĂNG NHẬP
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('igs-files', 'igs-files', false, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS "igs_files_auth_select" ON storage.objects;
CREATE POLICY "igs_files_auth_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'igs-files' AND public.is_workshop_member());

DROP POLICY IF EXISTS "igs_files_auth_insert" ON storage.objects;
CREATE POLICY "igs_files_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'igs-files' AND public.is_admin_or_engineer());

DROP POLICY IF EXISTS "igs_files_auth_update" ON storage.objects;
CREATE POLICY "igs_files_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'igs-files' AND public.is_admin_or_engineer())
  WITH CHECK (bucket_id = 'igs-files' AND public.is_admin_or_engineer());

DROP POLICY IF EXISTS "igs_files_auth_delete" ON storage.objects;
CREATE POLICY "igs_files_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'igs-files' AND public.is_admin_or_engineer());

-- ============================================================================
-- 11. THU HỒI QUYỀN ANON & SIẾT ROW LEVEL SECURITY (RLS) THEO VAI TRÒ
-- ============================================================================
REVOKE ALL ON TABLE public.profiles, public.projects, public.inventory, public.cut_progress, public.stock_offcuts FROM anon;
REVOKE ALL ON TABLE public.profiles, public.projects, public.inventory, public.cut_progress, public.stock_offcuts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles, public.projects, public.inventory, public.cut_progress, public.stock_offcuts TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cut_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_offcuts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_self_or_admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_admin_or_self_name" ON public.profiles;
CREATE POLICY "profiles_update_admin_or_self_name"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (
    public.is_admin()
    OR (
      id = auth.uid()
      AND role = public.get_my_role()
      AND username = public.get_my_username()
    )
  );

DROP POLICY IF EXISTS "projects_select_authenticated_member" ON public.projects;
CREATE POLICY "projects_select_authenticated_member"
  ON public.projects FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "projects_insert_engineer_admin" ON public.projects;
CREATE POLICY "projects_insert_engineer_admin"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "projects_update_engineer_admin" ON public.projects;
CREATE POLICY "projects_update_engineer_admin"
  ON public.projects FOR UPDATE TO authenticated
  USING (public.is_admin_or_engineer())
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "projects_delete_engineer_admin" ON public.projects;
CREATE POLICY "projects_delete_engineer_admin"
  ON public.projects FOR DELETE TO authenticated
  USING (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "inventory_select_authenticated_member" ON public.inventory;
CREATE POLICY "inventory_select_authenticated_member"
  ON public.inventory FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "inventory_insert_engineer_admin" ON public.inventory;
CREATE POLICY "inventory_insert_engineer_admin"
  ON public.inventory FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "inventory_update_engineer_admin" ON public.inventory;
CREATE POLICY "inventory_update_engineer_admin"
  ON public.inventory FOR UPDATE TO authenticated
  USING (public.is_admin_or_engineer())
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "inventory_delete_engineer_admin" ON public.inventory;
CREATE POLICY "inventory_delete_engineer_admin"
  ON public.inventory FOR DELETE TO authenticated
  USING (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "cut_progress_select_authenticated_member" ON public.cut_progress;
CREATE POLICY "cut_progress_select_authenticated_member"
  ON public.cut_progress FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "cut_progress_insert_authenticated_member" ON public.cut_progress;
CREATE POLICY "cut_progress_insert_authenticated_member"
  ON public.cut_progress FOR INSERT TO authenticated
  WITH CHECK (public.is_workshop_member());

DROP POLICY IF EXISTS "cut_progress_update_authenticated_member" ON public.cut_progress;
CREATE POLICY "cut_progress_update_authenticated_member"
  ON public.cut_progress FOR UPDATE TO authenticated
  USING (public.is_workshop_member())
  WITH CHECK (public.is_workshop_member());

DROP POLICY IF EXISTS "cut_progress_delete_engineer_admin" ON public.cut_progress;
CREATE POLICY "cut_progress_delete_engineer_admin"
  ON public.cut_progress FOR DELETE TO authenticated
  USING (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "stock_offcuts_select_authenticated_member" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_select_authenticated_member"
  ON public.stock_offcuts FOR SELECT TO authenticated
  USING (public.is_workshop_member());

DROP POLICY IF EXISTS "stock_offcuts_insert_authenticated_member" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_insert_authenticated_member"
  ON public.stock_offcuts FOR INSERT TO authenticated
  WITH CHECK (public.is_workshop_member());

DROP POLICY IF EXISTS "stock_offcuts_update_engineer_admin" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_update_engineer_admin"
  ON public.stock_offcuts FOR UPDATE TO authenticated
  USING (public.is_admin_or_engineer())
  WITH CHECK (public.is_admin_or_engineer());

DROP POLICY IF EXISTS "stock_offcuts_delete_engineer_admin" ON public.stock_offcuts;
CREATE POLICY "stock_offcuts_delete_engineer_admin"
  ON public.stock_offcuts FOR DELETE TO authenticated
  USING (public.is_admin_or_engineer());

-- ============================================================================
-- 12. DỮ LIỆU MẶC ĐỊNH BAN ĐẦU (INVENTORY SEED)
-- Tài khoản đăng nhập được tạo qua Supabase Auth bằng script:
--   node scripts/setup_auth_users.js
-- ============================================================================
INSERT INTO public.inventory (profile_name, category, standard_length, is_default)
VALUES
  ('Hộp 20x20x1.4', 'square', 6000, true),
  ('Hộp 25x25x1.4', 'square', 6000, true),
  ('Hộp 30x30x1.8', 'square', 6000, true),
  ('Hộp 40x40x1.8', 'square', 6000, true),
  ('Hộp 50x50x2.0', 'square', 6000, true),
  ('Hộp 20x40x1.4', 'rect', 6000, true),
  ('Hộp 25x50x1.8', 'rect', 6000, true),
  ('Hộp 30x60x1.8', 'rect', 6000, true),
  ('Hộp 40x80x2.0', 'rect', 6000, true),
  ('Ống Ø27x1.4', 'round', 6000, true),
  ('Ống Ø34x1.4', 'round', 6000, true)
ON CONFLICT (profile_name) DO NOTHING;
