@echo off
title BacklogMatters - Reset administrator password
cd /d "%~dp0"
set "BM_DATA_DIR=%~dp0data"

echo.
echo   This sets a new password for an administrator account.
echo.

"%~dp0runtime\node.exe" "%~dp0app\server.cjs" --reset-admin
echo.
pause
