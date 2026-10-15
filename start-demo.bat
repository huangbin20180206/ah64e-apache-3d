@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Apache 3D Demo Server

echo ============================================
echo   Apache 3D Demo - Local Server Launcher
echo ============================================
echo.
echo   URL: http://localhost:8642
echo   Keep this window OPEN while testing.
echo   Close this window to stop the server.
echo.

if not exist "dist\index.html" (
  echo [ERROR] Cannot find dist\index.html
  echo Make sure this file sits in the apache_web folder.
  pause
  exit /b 1
)

set "PY="
where uv >nul 2>nul && set "PY=uv run python"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY ( where py >nul 2>nul && set "PY=py" )

if not defined PY (
  echo [ERROR] uv / python / py not found.
  echo Install Python from https://www.python.org/downloads/
  echo and check "Add Python to PATH" during install.
  pause
  exit /b 1
)

echo Using: %PY%
echo Starting server...
echo.

rem 后台看门进程：轮询 HTTP 200（最多 30 秒），服务就绪后再打开浏览器。
rem 避免"2 秒后开浏览器但服务还没起来"的 404/连接失败（P15-B 发布启动收口）。
rem curl --noproxy *：本机 VPN 代理会拦 localhost（历史教训）。
start "" /b cmd /c "for /L %%i in (1,1,30) do @(curl.exe -s --noproxy * -o NUL http://localhost:8642/index.html >nul 2>&1 && (start "" http://localhost:8642 & exit /b 0) || timeout /t 1 >nul)"

%PY% -m http.server 8642 --directory dist
pause
