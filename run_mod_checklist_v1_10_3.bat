@echo off
title MOD-Check-List V1.10.4 TEST

echo Starting MOD-Check-List...

REM BACKEND
echo Starting Backend...
start cmd /k "cd /d C:\Projects\MOD-Check-List-V1.10.4-TEST\backend && npm install && npm start"

timeout /t 3 >nul

REM FRONTEND
echo Starting Frontend...
start cmd /k "cd /d C:\Projects\MOD-Check-List-V1.10.4-TEST\frontend && npm install && npm run dev -- --host"

timeout /t 5 >nul

REM Browser aç
start http://localhost:5173

echo TEST system started successfully.
pause
