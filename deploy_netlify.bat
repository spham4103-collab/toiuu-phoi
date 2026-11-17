@echo off
chcp 65001 >nul
echo ====================================================
echo   TRIỂN KHAI TRỰC TIẾP LÊN NETLIFY BẰNG NETLIFY CLI
echo ====================================================
echo.

set "PATH=C:\Program Files\Git\cmd;C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"

cd /d "C:\Users\Administrator\toiuu-phoi"

echo Đang tải lên Netlify...
call netlify deploy --prod --dir .

echo.
echo ====================================================
echo Hoàn thành!
echo ====================================================
pause
