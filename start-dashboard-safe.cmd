@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "PORT=5173"
set "URL=http://127.0.0.1:%PORT%"
set "NODE_EXE="

echo ===============================================
echo Fund Manager Timing Lab
echo ===============================================
echo Folder: %CD%
echo URL:    %URL%
echo.

if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"

echo "%NODE_EXE%" | findstr /I "\\WindowsApps\\node.exe" >nul
if not errorlevel 1 (
  set "NODE_EXE="
)

if not defined NODE_EXE (
  echo Node.js was not found.
  echo Install Node.js from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Node: %NODE_EXE%
echo.
echo Starting server in a separate window...
echo Keep the new "Fund Manager Server" window open while using the site.
echo.

netstat -ano | findstr /C:":%PORT% " | findstr /I "LISTENING" >nul
if errorlevel 1 (
  start "Fund Manager Server" /D "%~dp0" "%NODE_EXE%" "%~dp0server.js"
  timeout /t 3 /nobreak >nul
) else (
  echo Server is already running on port %PORT%.
)

echo Opening dashboard in your browser...
start "" "%URL%"
echo.
echo If the page still says connection refused, wait two seconds and refresh.
echo URL: %URL%
echo.
pause
