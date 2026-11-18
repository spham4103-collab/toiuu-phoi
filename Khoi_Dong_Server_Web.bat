@echo off
chcp 65001 >nul
title May Chu Web Toi Uu Xep Phoi - Co Khi An Binh
cd /d "C:\Users\Administrator\toiuu-phoi"

:: Kiem tra xem server port 3000 da chay chua
netstat -ano | findstr :3000 | findstr LISTENING >nul
if %errorlevel%==0 (
    echo May chu Web dang hoat dong! Dang mo trinh duyet...
    start http://localhost:3000
    exit /b 0
)

echo Dang khoi dong May chu Web Full-Stack (Port 3000)...
start "" http://localhost:3000
node "C:\Users\Administrator\toiuu-phoi\server.js"
pause
