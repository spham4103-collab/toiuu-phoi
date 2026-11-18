@echo off
chcp 65001 >nul
title DAY CODE LEN GITHUB PAGES - XEP PHOI AN BINH
cd /d "C:\Users\Administrator\toiuu-phoi"
set "PATH=C:\Program Files\Git\cmd;%PATH%"

echo ============================================================
echo   HE THONG TU DONG DAY CODE LEN GITHUB & GITHUB PAGES
echo   Tên miền: xepphoi.cloud ^| Repo: spham4103-collab/toiuu-phoi
echo ============================================================
echo.

echo [1/4] Dong bo du lieu & kiem tra file CNAME...
python sync_all.py

if not exist CNAME (
    echo xepphoi.cloud > CNAME
)
if not exist dist\CNAME (
    echo xepphoi.cloud > dist\CNAME
)
type nul > .nojekyll
type nul > dist\.nojekyll

echo [2/4] Dong goi tat ca thay doi vao Git...
git add .
git commit -m "Cap nhat web toi uu phoi An Binh - xepphoi.cloud"

echo [3/4] Kiem tra ket noi den GitHub...
git remote remove origin 2>nul
git remote add origin https://github.com/spham4103-collab/toiuu-phoi.git
git branch -M main

echo [4/4] Dang day code len GitHub...
echo (Neu co hop thoai dang nhap GitHub hien len, anh chi can bam 'Sign in with browser' de xac nhan)
echo.
git push -u origin main --force

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================
    echo   THANH CONG 100%! CODE DA DUOC DAY LEN GITHUB!
    echo   Xem ma nguon: https://github.com/spham4103-collab/toiuu-phoi
    echo   Web se tu dong cap nhat tai: https://xepphoi.cloud
    echo ============================================================
) else (
    echo.
    echo [THONG BAO] Neu lan dau chua day duoc:
    echo 1. Hay chac chan anh da bam tao Repo ten la 'toiuu-phoi' tai:
    echo    https://github.com/new
    echo 2. Sau khi tao xong tren web, chay lai file nay la thanh cong 100%!
)
echo.
pause
