@echo off
chcp 65001 >nul
echo ====================================================
echo   ĐẨY MÃ NGUỒN LÊN GITHUB & TỰ ĐỘNG CẬP NHẬT NETLIFY
echo ====================================================
echo.

set "PATH=C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;%PATH%"

cd /d "C:\Users\Administrator\toiuu-phoi"

echo 1. Kiểm tra trạng thái mã nguồn...
git status -s

echo.
echo 2. Thêm toàn bộ thay đổi...
git add .

set /p msg="Nhập ghi chú cập nhật (hoặc nhấn Enter để dùng mặc định): "
if "%msg%"=="" set msg=Cap nhat ma nguon tu dong

echo 3. Đang tạo bản lưu (Commit)...
git commit -m "%msg%"

echo.
echo 4. Đang đẩy code lên GitHub...
git push origin master
if %errorlevel% neq 0 (
    echo.
    echo [!] Chưa kết nối remote GitHub hoặc chưa đăng nhập.
    echo Hãy chạy lệnh: gh auth login
    echo Hoặc: git remote add origin https://github.com/<tai_khoan>/toiuu-phoi.git
) else (
    echo.
    echo ====================================================
    echo [OK] ĐÃ ĐẨY CODE LÊN GITHUB THÀNH CÔNG!
    echo Netlify đang tự động cập nhật web chỉ sau 5-10 giây!
    echo ====================================================
)

echo.
pause
