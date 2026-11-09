@echo off
setlocal
rem Pushes the current branch of this repository to GitHub.
rem Usage: double-click, or run "push-to-github.bat" from a command prompt.

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or not on PATH. Install it from https://git-scm.com and try again.
  goto :fail
)

set "REMOTE_URL=https://github.com/peb-ops/backlogmatters.git"

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo Adding remote origin: %REMOTE_URL%
  git remote add origin "%REMOTE_URL%" || goto :fail
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo Could not determine the current branch.
  goto :fail
)

git diff --quiet HEAD -- 2>nul
if errorlevel 1 (
  echo Note: you have uncommitted changes. Only committed work will be pushed.
  echo.
)

echo Pushing branch "%BRANCH%" to origin...
git push -u origin "%BRANCH%"
if errorlevel 1 (
  echo.
  echo Push failed. Common causes:
  echo  - Not signed in to GitHub: Git will open a sign-in window; complete it and run this again.
  echo  - The GitHub repository already has commits, for example a README.
  echo    Run: git pull --rebase origin %BRANCH%   then run this file again.
  goto :fail
)

echo.
echo Done.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
