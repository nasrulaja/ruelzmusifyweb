@echo off
REM ============================================================
REM  9router - launcher STABIL
REM
REM  Kenapa ECONNREFUSED 127.0.0.1:20128?
REM  Launcher 9router mematikan server lama lalu menyalakan yang baru
REM  setiap kali ada auto-update / self-heal. UI yang masih terbuka
REM  langsung kehilangan koneksi -> ECONNREFUSED sesaat.
REM
REM  Solusi:
REM    --skip-update  : jangan auto-update (penyebab restart #1)
REM    --no-browser   : jangan buka tab baru tiap start
REM  Port tetap di 20128 supaya TIDAK pernah nabrak web kita (7788).
REM ============================================================
setlocal

echo [1/2] mematikan 9router lama (kalau ada)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":20128" ^| findstr "LISTENING"') do (
  echo     kill PID %%p
  taskkill /F /T /PID %%p >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [2/2] menjalankan 9router di port 20128 (auto-update MATI)...
echo.
call 9router --port 20128 --skip-update --no-browser

echo.
echo 9router berhenti.
pause
