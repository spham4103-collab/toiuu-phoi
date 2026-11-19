-- ============================================================================
-- SUPABASE MIGRATION ĐỢT 1 — CƠ KHÍ AN BÌNH (xepphoi.cloud)
-- Chạy 1 lần trong Supabase Dashboard -> SQL Editor (Idempotent / An toàn chạy lại)
-- ============================================================================

-- 1. Thêm cột pattern_hash cho bảng tiến độ cắt CNC (public.cut_progress)
--    Giúp phát hiện ngay khi kỹ sư thay đổi sơ đồ cây cắt sau khi thợ đã bắt đầu cắt
ALTER TABLE public.cut_progress
  ADD COLUMN IF NOT EXISTS pattern_hash TEXT NOT NULL DEFAULT '';

-- 2. Đổi public.projects sang REPLICA IDENTITY DEFAULT để tối ưu băng thông WAL/Realtime
--    (Tránh gửi nguyên cột data JSONB cũ cồng kềnh qua Realtime khi UPDATE/DELETE)
ALTER TABLE public.projects REPLICA IDENTITY DEFAULT;
