@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  humanovo — headed Playwright E2E sweep on the installed Windows app
REM
REM  One-shot driver. Steps:
REM    1. Locate humanovo.exe in the standard install dirs.
REM    2. Launch it with the WebView2 CDP debug flag (port 9222).
REM    3. Wait for the CDP endpoint to come up.
REM    4. Run desktop-mock-auth-sweep.mjs against it.
REM    5. Report exit code; leave the app running so the developer
REM       can keep poking at it.
REM
REM  Prerequisite: a humanovo build compiled with mock-auth ENABLED
REM  (VITE_ENABLE_MOCK_AUTH=true). Vite dev builds default to that;
REM  the GitHub-Actions production release explicitly disables it.
REM ─────────────────────────────────────────────────────────────────────

setlocal enableextensions

REM  Standard Tauri install paths on Windows (per-user / per-machine).
set "EXE1=%LOCALAPPDATA%\Programs\humanovo\humanovo.exe"
set "EXE2=%LOCALAPPDATA%\humanovo\humanovo.exe"
set "EXE3=%PROGRAMFILES%\humanovo\humanovo.exe"
set "EXE4=%PROGRAMFILES(X86)%\humanovo\humanovo.exe"

set "EXE="
if exist "%EXE1%" set "EXE=%EXE1%"
if not defined EXE if exist "%EXE2%" set "EXE=%EXE2%"
if not defined EXE if exist "%EXE3%" set "EXE=%EXE3%"
if not defined EXE if exist "%EXE4%" set "EXE=%EXE4%"

if not defined EXE (
    echo [run-headed-e2e] humanovo.exe not found in any of:
    echo   %EXE1%
    echo   %EXE2%
    echo   %EXE3%
    echo   %EXE4%
    echo.
    echo Install the latest build first: download Humanovo-Setup-1.0.0.exe
    echo from https://github.com/satvikOS/humanovo/releases/latest
    exit /b 4
)

echo [run-headed-e2e] Found humanovo.exe at: %EXE%
echo [run-headed-e2e] Launching with CDP debug port 9222...

REM  Set the WebView2 flag so the embedded Chrome accepts CDP attach.
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"

REM  Launch the app detached so this script can wait + run the sweep
REM  in parallel.
start "" "%EXE%"

REM  Poll the CDP endpoint up to 60 seconds.
echo [run-headed-e2e] Waiting for CDP at http://localhost:9222 ...
set /a TRIES=0
:wait_cdp
set /a TRIES+=1
if %TRIES% GTR 30 (
    echo [run-headed-e2e] CDP did not come up within 60s. Aborting.
    exit /b 5
)
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:9222/json/version' -TimeoutSec 1 -UseBasicParsing).StatusCode -eq 200 | %% { exit 0 } } catch { exit 1 }"
if errorlevel 1 (
    timeout /t 2 /nobreak > nul
    goto wait_cdp
)

echo [run-headed-e2e] CDP ready. Running headed sweep...
echo.

REM  Run the headed sweep. cd into frontend so node_modules resolution works.
pushd "%~dp0\.."
node ./e2e/desktop-mock-auth-sweep.mjs
set "SWEEP_EXIT=%ERRORLEVEL%"
popd

echo.
echo [run-headed-e2e] Sweep finished with exit code %SWEEP_EXIT%.
echo [run-headed-e2e] humanovo.exe still running. Close it normally when done.
exit /b %SWEEP_EXIT%
