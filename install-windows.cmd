@echo off
setlocal
chcp 65001 >nul

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
set "PLAINIFY_EXIT_CODE=%ERRORLEVEL%"

if not "%PLAINIFY_NONINTERACTIVE%"=="1" pause
exit /b %PLAINIFY_EXIT_CODE%
