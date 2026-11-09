@echo off
rem Bootstraps and starts BacklogMatters from this folder.
rem
rem   BacklogMatters.bat            set up whatever is missing, then start
rem   BacklogMatters.bat rebuild    same, but rebuild the app first (use after changing the code)
rem
rem It uses the Node.js already on this PC if it is version 20 or newer. Otherwise it
rem downloads a private copy into the .runtime folder; nothing is installed system-wide.

setlocal
title BacklogMatters
cd /d "%~dp0"

set "NODE_VERSION=22.12.0"
set "RUNTIME=%~dp0.runtime"

rem ---- 1. Node.js ----

where node >nul 2>nul && node -e "process.exit(+process.versions.node.split('.')[0]>=20?0:1)" 2>nul && goto modules
if exist "%RUNTIME%\node.exe" goto use_private_node

echo.
echo   Node.js 20 or newer was not found on this PC.
echo   Downloading a private copy (v%NODE_VERSION%, about 30 MB)...
echo.
set "ZIP=node-v%NODE_VERSION%-win-x64.zip"
set "URL=https://nodejs.org/dist/v%NODE_VERSION%"
if not exist "%RUNTIME%" mkdir "%RUNTIME%"
curl.exe -fsSL -o "%RUNTIME%\%ZIP%" "%URL%/%ZIP%" || goto download_failed
curl.exe -fsSL -o "%RUNTIME%\SHASUMS256.txt" "%URL%/SHASUMS256.txt" || goto download_failed

rem Check the download against the checksum published by nodejs.org.
set "HASH="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%RUNTIME%\%ZIP%" SHA256') do if not defined HASH set "HASH=%%h"
if not defined HASH goto download_corrupt
findstr /i /c:"%HASH%  %ZIP%" "%RUNTIME%\SHASUMS256.txt" >nul || goto download_corrupt

tar.exe -xf "%RUNTIME%\%ZIP%" -C "%RUNTIME%" --strip-components=1 || goto download_corrupt
del "%RUNTIME%\%ZIP%" "%RUNTIME%\SHASUMS256.txt"

:use_private_node
set "PATH=%RUNTIME%;%PATH%"

rem ---- 2. Dependencies ----
rem The database driver is built for one Node version, so reinstall when Node has changed.

:modules
set "ABI="
for /f %%v in ('node -p "process.versions.modules"') do set "ABI=%%v"
if not defined ABI goto failed
set "INSTALLED_FOR="
if exist "node_modules\.bm-node-abi" set /p INSTALLED_FOR=<"node_modules\.bm-node-abi"
if "%INSTALLED_FOR%"=="%ABI%" goto build

echo.
echo   Installing dependencies. This takes a minute the first time...
echo.
call npm ci --no-fund --no-audit || goto failed
>"node_modules\.bm-node-abi" echo %ABI%
goto do_build

rem ---- 3. Build ----

:build
if /i "%~1"=="rebuild" goto do_build
if exist "dist\server.cjs" if exist "dist\client\index.html" goto start

:do_build
echo.
echo   Building BacklogMatters...
echo.
call npm run build || goto failed

rem ---- 4. Start ----

:start
rem Feature flag: remove "rem" from the next line to turn on sign-in, user management and administration.
rem set "BM_ACCOUNTS=1"
if not defined BM_OPEN_BROWSER set "BM_OPEN_BROWSER=1"
echo.
echo   BacklogMatters is starting. Your browser will open in a moment.
echo.
echo   Keep this window open while you work.
echo   Close this window to stop BacklogMatters.
echo.
node dist\server.cjs
if errorlevel 1 goto failed
goto :eof

:download_failed
echo.
echo   Node.js could not be downloaded. Check the internet connection and try again,
echo   or install Node.js from https://nodejs.org and run this file again.
goto pause_and_exit

:download_corrupt
echo.
echo   The Node.js download was incomplete or did not match its published checksum.
echo   Delete the .runtime folder and run this file again.
goto pause_and_exit

:failed
echo.
echo   BacklogMatters could not start. The messages above explain why.

:pause_and_exit
echo.
pause
exit /b 1
