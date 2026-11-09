@echo off
title BacklogMatters
cd /d "%~dp0"
set "BM_DATA_DIR=%~dp0data"
set "BM_OPEN_BROWSER=1"
rem Feature flag: remove "rem" from the next line to turn on sign-in, user management and administration.
rem set "BM_ACCOUNTS=1"

echo.
echo   BacklogMatters is starting. Your browser will open in a moment.
echo.
echo   Keep this window open while you work.
echo   Close this window to stop BacklogMatters.
echo.

"%~dp0runtime\node.exe" "%~dp0app\server.cjs"
if errorlevel 1 (
  echo.
  echo   BacklogMatters stopped because of a problem. The message above explains why.
  pause
)
