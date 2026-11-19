-- ============================================================================
-- SUPABASE MIGRATION ĐỢT 2 — SUPABASE AUTH & SIẾT CHẶT RLS (xepphoi.cloud)
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (Idempotent / An toàn chạy lại)
-- LƯU Ý: Sau khi chạy file này, hãy tạo 3 tài khoản Auth bằng lệnh:
--        node scripts/setup_auth_users.js
-- ============================================================================

-- 1. Tạo bảng public.profiles liên kết chặt với auth.users(id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'engineer', 'operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles REPLICA IDENTITY FULL;

-- Thêm public.profiles vào supabase_realtime (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
  END IF;
END;
$$;

-- 2. Gỡ bỏ bảng workshop_users cũ chứa mật khẩu chữ rõ & cập nhật khóa ngoại projects.created_by
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_created_by_fkey;

UPDATE public.projects
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = created_by);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workshop_users'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.workshop_users';
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.workshop_users CASCADE;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Các hàm helper SECURITY DEFINER đọc role hiện tại (CHỐNG ĐỆ QUY RLS)
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

-- 4. Hàm ping nhẹ phục vụ GitHub Actions chống Auto-pause 7 ngày (không lộ bất kỳ dữ liệu nào)
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

-- 5. Thu hồi toàn bộ quyền anon trên mọi bảng dữ liệu & cấp quyền tối thiểu cho authenticated
REVOKE ALL ON TABLE public.profiles, public.projects, public.inventory, public.cut_progress FROM anon;
REVOKE ALL ON TABLE public.profiles, public.projects, public.inventory, public.cut_progress FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles, public.projects, public.inventory, public.cut_progress TO authenticated;

-- 6. Siết chặt Row Level Security (RLS) trên từng bảng
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cut_progress ENABLE ROW LEVEL SECURITY;

-- Xóa các policy mở tạm thời từ Đợt trước
DROP POLICY IF EXISTS "anon_full_access_inventory" ON public.inventory;
DROP POLICY IF EXISTS "anon_full_access_projects" ON public.projects;
DROP POLICY IF EXISTS "anon_full_access_cut_progress" ON public.cut_progress;

-- 6A. RLS bảng public.profiles
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

-- 6B. RLS bảng public.projects
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

-- 6C. RLS bảng public.inventory
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

-- 6D. RLS bảng public.cut_progress
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

-- 7. Chuyển Storage Bucket 'igs-files' sang PRIVATE & siết policy chỉ cho nhân sự xưởng đã đăng nhập
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('igs-files', 'igs-files', false, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS "igs_files_public_select" ON storage.objects;
DROP POLICY IF EXISTS "igs_files_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "igs_files_public_update" ON storage.objects;
DROP POLICY IF EXISTS "igs_files_public_delete" ON storage.objects;

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
