@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Houjinzei AI Assistant

echo ==============================================
echo  法人税申告書AIアシスタント を起動します
echo  （初回は準備に10分ほどかかります）
echo ==============================================
echo.

rem ---- 1 Python
py -3 --version >nul 2>nul
if errorlevel 1 goto need_python
rem ---- 2 Node.js
where node >nul 2>nul
if errorlevel 1 goto need_node
where npm >nul 2>nul
if errorlevel 1 goto need_node

rem ---- 3 バックエンドの準備
if exist "backend\.venv\Scripts\python.exe" goto venv_ok
echo [1/3] Python の部品を入れています...
py -3 -m venv backend\.venv
if errorlevel 1 goto fail
backend\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
backend\.venv\Scripts\python.exe -m pip install --quiet -r backend\requirements.txt
if errorlevel 1 goto fail
:venv_ok

rem ---- 4 画面の準備
if exist "frontend\node_modules" goto nm_ok
echo [2/3] 画面の部品を入れています...
pushd frontend
call npm ci
if errorlevel 1 goto fail_pop
popd
:nm_ok
if exist "frontend\.next\BUILD_ID" goto build_ok
echo [3/3] 画面を組み立てています...
pushd frontend
call npm run build
if errorlevel 1 goto fail_pop
popd
:build_ok

rem ---- 5 初回だけ：デモデータを入れるか
if exist "backend\hojinzei-dev.db" goto db_ok
echo.
echo 初回の起動です。練習用の架空の会社データ3社を入れますか？
echo   Y：入れる（操作を試せます。あとで消せます）
echo   N：入れない（空の状態で始めます）
choice /c YN /n /m "Y か N を押してください: "
if errorlevel 2 (set "HOJINZEI_SEED_DEMO=0" & set "HOJINZEI_SEED_USERS_ONLY=1") else (set "HOJINZEI_SEED_DEMO=1")
:db_ok

rem ---- 6 起動
set "HOJINZEI_ENV=dev"
if not defined HOJINZEI_SEED_DEMO set "HOJINZEI_SEED_DEMO=0"
echo.
echo アプリを起動しています...
start "houjinzei-backend" /min cmd /c "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000"
start "houjinzei-frontend" /min cmd /c "cd /d %~dp0frontend && npm run start -- -p 3000"

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

rem ---- 7 停止
for %%P in (8000 3000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do taskkill /pid %%I /t /f >nul 2>nul
)
echo 終了しました。
timeout /t 2 >nul
exit /b 0

:need_python
echo Python が入っていません。インストールします...
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
echo.
echo インストールが終わったら、この画面を閉じて、もう一度 start.bat を押してください。
pause
exit /b 1

:need_node
echo Node.js が入っていません。インストールします...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo インストールが終わったら、この画面を閉じて、もう一度 start.bat を押してください。
pause
exit /b 1

:fail_pop
popd
:fail
echo.
echo 準備の途中でエラーになりました。上のメッセージを控えて相談してください。
pause
exit /b 1

:fail_wait
echo.
echo 起動に時間がかかっています。しばらくしてから http://127.0.0.1:3000 を開いてください。
echo 開けないときは、最小化されている2つの黒い画面のメッセージを確認してください。
pause
exit /b 1
