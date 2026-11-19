-- ============================================================================
-- SUPABASE DATABASE SCHEMA CHO HỆ THỐNG XẾP PHÔI CƠ KHÍ AN BÌNH (xepphoi.cloud)
-- Single Source of Truth: PostgreSQL + Supabase Realtime + Supabase Storage
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
-- 3. BẢNG NHÂN SỰ & PHÂN QUYỀN XƯỞNG (public.workshop_users)
-- Lưu ý: Tách biệt rõ ràng với auth.users của Supabase Auth
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workshop_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  -- Tạm giữ mật khẩu dạng văn bản phục vụ giai đoạn chuyển đổi từ localStorage.
  -- Khi siết bảo mật thực tế, hãy chuyển sang Supabase Auth (supabase.auth) hoặc băm bcrypt qua Edge Function.
  password TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('engineer', 'operator')),
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
  created_by UUID REFERENCES public.workshop_users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON public.projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_active_filter ON public.projects (is_trashed, is_draft);

-- ============================================================================
-- 6. BẢNG TIẾN ĐỘ CẮT CNC THEO TỪNG CÂY (public.cut_progress)
-- Tách biệt hoàn toàn khỏi projects để Thợ CNC cập nhật từng dòng (row-level)
-- không bao giờ ghi đè lên dữ liệu Kỹ sư đang chỉnh sửa ở bảng projects.
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
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, bar_key)
);

CREATE INDEX IF NOT EXISTS idx_cut_progress_project_id ON public.cut_progress (project_id);

-- ============================================================================
-- 7. GẮN TRIGGER updated_at & BẬT REPLICA IDENTITY FULL (Cho Realtime DELETE)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_workshop_users_updated_at ON public.workshop_users;
CREATE TRIGGER trg_workshop_users_updated_at
  BEFORE UPDATE ON public.workshop_users
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

ALTER TABLE public.workshop_users REPLICA IDENTITY FULL;
ALTER TABLE public.inventory REPLICA IDENTITY FULL;
ALTER TABLE public.projects REPLICA IDENTITY FULL;
ALTER TABLE public.cut_progress REPLICA IDENTITY FULL;

-- ============================================================================
-- 8. BẬT REALTIME PUBLICATION CHO CẢ 4 BẢNG
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['workshop_users', 'inventory', 'projects', 'cut_progress']
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
-- 9. TẠO STORAGE BUCKET 'igs-files' & POLICY TRUY CẬP
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('igs-files', 'igs-files', true, 52428800, NULL)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 52428800;

DROP POLICY IF EXISTS "igs_files_public_select" ON storage.objects;
CREATE POLICY "igs_files_public_select"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'igs-files');

DROP POLICY IF EXISTS "igs_files_public_insert" ON storage.objects;
CREATE POLICY "igs_files_public_insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'igs-files');

DROP POLICY IF EXISTS "igs_files_public_update" ON storage.objects;
CREATE POLICY "igs_files_public_update"
  ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'igs-files')
  WITH CHECK (bucket_id = 'igs-files');

DROP POLICY IF EXISTS "igs_files_public_delete" ON storage.objects;
CREATE POLICY "igs_files_public_delete"
  ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'igs-files');

-- ============================================================================
-- 10. CẤU HÌNH ROW LEVEL SECURITY (RLS) TẠM THỜI CHO TEST NHANH QUA ANON KEY
-- ============================================================================
ALTER TABLE public.workshop_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cut_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_full_access_workshop_users" ON public.workshop_users;
CREATE POLICY "anon_full_access_workshop_users"
  ON public.workshop_users FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_full_access_inventory" ON public.inventory;
CREATE POLICY "anon_full_access_inventory"
  ON public.inventory FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_full_access_projects" ON public.projects;
CREATE POLICY "anon_full_access_projects"
  ON public.projects FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_full_access_cut_progress" ON public.cut_progress;
CREATE POLICY "anon_full_access_cut_progress"
  ON public.cut_progress FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- ============================================================================
-- LƯU Ý SIẾT BẢO MẬT KHI ĐƯA VÀO VẬN HÀNH CHÍNH THỨC (PRODUCTION HARDENING):
-- 1. Không lưu mật khẩu dạng văn bản rõ trong workshop_users.password; hãy chuyển
--    sang dùng Supabase Auth (supabase.auth.signInWithPassword) hoặc Edge Function
--    kiểm tra mật khẩu đã băm bằng bcrypt và cấp JWT tùy chỉnh.
-- 2. Hạn chế quyền đọc bảng workshop_users (tuyệt đối không SELECT cột password
--    xuống trình duyệt ở phía public anon key; tạo VIEW public_users ẩn mật khẩu).
-- 3. Phân quyền RLS chặt chẽ theo vai trò (auth.jwt() ->> 'role'):
--    - 'engineer' / 'admin': được phép INSERT/UPDATE/DELETE trên projects, inventory.
--    - 'operator' (Thợ CNC): chỉ được SELECT trên projects/inventory và chỉ được
--      INSERT/UPDATE trên cut_progress; bị chặn xóa hoặc sửa dự án đang khóa.
-- 4. Trên Storage Bucket 'igs-files': chỉ cho phép 'authenticated' (engineer) hoặc
--    'service_role' (từ server.js Fusion 360) upload/xóa file .igs; 'anon' chỉ đọc.
-- ============================================================================

-- ============================================================================
-- 11. DỮ LIỆU MẶC ĐỊNH BAN ĐẦU (SEED DATA)
-- ============================================================================
INSERT INTO public.workshop_users (username, password, full_name, role, created_at)
VALUES
  ('admin', '123456', 'Kỹ Sư Thiết Kế (Admin)', 'engineer', '2026-01-01T00:00:00Z'),
  ('kt1', '12345', 'Sơn KT (Kỹ Sư)', 'engineer', '2026-01-01T00:00:00Z'),
  ('thocnc', '1234', 'Thợ Vận Hành Máy CNC', 'operator', '2026-01-01T00:00:00Z')
ON CONFLICT (username) DO NOTHING;

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
