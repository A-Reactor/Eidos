@echo off
setlocal

where node >nul 2>&1
if errorlevel 1 (
    echo Install Node.js before starting Eidos: https://nodejs.org/
    exit /b 1
)

pushd "%~dp0eidos" || exit /b 1
if not exist node_modules (
    call npm ci
    if errorlevel 1 (
        popd
        exit /b 1
    )
)

echo Open http://localhost:3000 to use Eidos.
call npm run dev
set "result=%ERRORLEVEL%"
popd
exit /b %result%
