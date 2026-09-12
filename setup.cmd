@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or 24 LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
node "%~dp0scripts\setup.mjs" %*
set "RINGO_SETUP_EXIT=%ERRORLEVEL%"
pause
exit /b %RINGO_SETUP_EXIT%
