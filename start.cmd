@echo off
REM ============================================================
REM  RuelzMusify Web - launcher stabil
REM  - port tetap 7788 (tidak pernah nabrak 9router di 20128)
REM  - matikan instance lama dulu biar tidak dobel
REM  - log ke file supaya kalau mati bisa ditelusuri
REM ============================================================
setlocal
cd /d "%~dp0"

set PORT=7788

echo [1/3] membersihkan instance lama di port %PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo     kill PID %%p
  taskkill /F /PID %%p >nul 2>&1
)

echo [2/3] cek dependensi...
if not exist "node_modules\express" (
  echo     express belum ada, installing...
  call npm install express --silent
)

echo [3/3] menjalankan server di http://localhost:%PORT%
echo.
set PORT=%PORT%
node server.mjs 1>>"%~dp0server.log" 2>>"%~dp0server.err"

echo.
echo server berhenti. cek server.err untuk detail.
pause
