@echo off
setlocal
set SCRIPT_DIR=%~dp0
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-windows.ps1" %*
) else (
  powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-windows.ps1" %*
)
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo ClaudeChrome launcher failed. Exit code: %EXIT_CODE%
  pause
)
exit /b %EXIT_CODE%
