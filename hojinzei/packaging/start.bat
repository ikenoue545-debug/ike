@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 法人税申告書AIアシスタント

echo ==============================================
echo  法人税申告書AIアシスタント を起動します
echo ==============================================
echo.

if exist "%~dp0data\houjinzei.db" goto db_ok
echo 初回の起動です。練習用の架空の会社データ3社を入れますか？
echo   Y：入れる（操作を試せます。あとで消せます）
echo   N：入れない（空の状態で始めます）
choice /c YN /n /m "Y か N を押してください: "
if errorlevel 2 (set "HOJINZEI_SEED_DEMO=0" & set "HOJINZEI_SEED_USERS_ONLY=1") else (set "HOJINZEI_SEED_DEMO=1")
:db_ok
if not defined HOJINZEI_SEED_DEMO set "HOJINZEI_SEED_DEMO=0"

set "HOJINZEI_HOME=%~dp0"
echo アプリを起動しています...
start "houjinzei-backend" /min /d "%~dp0backend" "%~dp0backend\houjinzei-backend.exe"
set "PORT=3000"
set "HOSTNAME=127.0.0.1"
start "houjinzei-frontend" /min /d "%~dp0frontend" "%~dp0frontend\node.exe" server.js

set /a n=0
:wait
set /a n+=1
if %n% GTR 90 goto fail_wait
curl -s -o nul http://127.0.0.1:3000/api/health
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)

start "" http://127.0.0.1:3000
echo.
echo ==============================================
echo  ブラウザが開きました。
echo  開かないときは http://127.0.0.1:3000 を開いてください。
echo.
echo  ログイン（練習用の利用者）
echo    admin@example.com / demo-pass-2026
echo.
echo  終わるときは、この画面で何かキーを押してください。
echo  （先にこの画面を閉じると、アプリが動いたままになります）
echo ==============================================
pause >nul

for %%P in (8000 3000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do taskkill /pid %%I /t /f >nul 2>nul
)
echo 終了しました。
timeout /t 2 >nul
exit /b 0

:fail_wait
echo.
echo 起動に時間がかかっています。しばらくしてから http://127.0.0.1:3000 を開いてください。
pause
exit /b 1
