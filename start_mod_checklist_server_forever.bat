@echo off
setlocal
title Inspectra Server

cd /d "%~dp0"

echo Preparing Inspectra server...

if not exist "frontend\dist\index.html" (
  echo Frontend build not found. Installing frontend dependencies...
  call npm --prefix frontend install
  if errorlevel 1 exit /b 1

  echo Building frontend for production...
  call npm --prefix frontend run build
  if errorlevel 1 exit /b 1
)

echo Installing backend dependencies if needed...
call npm --prefix backend install
if errorlevel 1 exit /b 1

:loop
echo [%date% %time%] Starting Inspectra on port 4000...
node backend\server.js
echo [%date% %time%] Server stopped. Restarting in 5 seconds...
timeout /t 5 >nul
goto loop
