@echo off
setlocal
chcp 65001 >nul
"%~dp0runtime\node.exe" "%~dp0start.mjs"
if errorlevel 1 pause
