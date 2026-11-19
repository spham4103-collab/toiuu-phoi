# Quy Tắc Dự Án `xepphoi.cloud` (toiuu-phoi)

## 1. Tự động đẩy code lên GitHub (`origin/main`)
- Khi người dùng yêu cầu chỉnh sửa, nâng cấp hoặc sửa lỗi cho dự án `xepphoi.cloud` tại `C:\Users\Administrator\toiuu-phoi`, sau khi hoàn tất:
  1. Chạy đồng bộ `python sync_all.py`.
  2. Chạy kiểm thử (syntax `node --check`, `python -m py_compile`, unit test nếu có) và quét bảo mật thư mục Frontend + `dist/`.
  3. Xác nhận `.env`, `database/workshop_db.json` và `dist/database/workshop_db.json` không bị track trên Git và không lộ `sb_secret_` vào mã nguồn/frontend/`dist/`.
  4. Tạo `git commit` và **tự động chạy luôn** lệnh đẩy lên GitHub Pages:
     ```powershell
     & "C:\Program Files\Git\bin\git.exe" push origin main
     ```
- **Không** dừng lại để yêu cầu người dùng tự push code lên GitHub thủ công.
- Nếu đợt thay đổi có kèm file SQL migration trên Supabase, ưu tiên thiết kế Frontend tương thích ngược (fallback an toàn nếu bảng/cột mới chưa được tạo), vẫn tự `git push origin main` ngay sau khi test xong, rồi gửi link file `.sql` để người dùng chạy trong Supabase SQL Editor.

## 2. Môi trường Windows / PowerShell
- `git` không nằm trong `PATH` mặc định — luôn gọi `"C:\Program Files\Git\bin\git.exe"`.
- Trong PowerShell, nối nhiều lệnh bằng `;` (không dùng `&&`).
