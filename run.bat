@echo off
setlocal EnableDelayedExpansion

title Autotape 3000 Launcher

:: ── Check for Python ──────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python was not found on your system.
    echo.
    echo Please install Python 3.11 or later from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

:: ── Install dependencies only when requirements.txt has changed ───────────────
set STAMP_FILE=%~dp0.deps_hash
set REQ_FILE=%~dp0requirements.txt

:: Compute current hash of requirements.txt
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile "%REQ_FILE%" SHA256 2^>nul') do (
    if not defined CURRENT_HASH set CURRENT_HASH=%%H
)

:: Read previously stored hash (if any)
set STORED_HASH=
if exist "%STAMP_FILE%" set /p STORED_HASH=<"%STAMP_FILE%"

if "!CURRENT_HASH!" == "!STORED_HASH!" goto :launch

:: Get a carriage-return character for in-place spinner updates
for /f %%C in ('copy /Z "%~f0" nul') do set "CR=%%C"

set DONE_FILE=%TEMP%\autotape_install_done.tmp
if exist "%DONE_FILE%" del "%DONE_FILE%"

:: Use Python as the background worker — avoids cmd /c quote-nesting issues.
:: All pip output (including notices) is suppressed via subprocess redirection.
start /b python -c "import subprocess,sys; rc=subprocess.call([sys.executable,'-m','pip','install','-r',r'%REQ_FILE%','--quiet','--disable-pip-version-check'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); open(r'%DONE_FILE%','w').write(str(rc))"

:: Spinner frames
set "F[0]=[-]"
set "F[1]=[\]"
set "F[2]=[|]"
set "F[3]=[/]"
set /a IDX=0

:spin_loop
    if exist "%DONE_FILE%" goto :check_result
    <nul set /p "=Installing dependencies... !F[%IDX%]!!CR!"
    set /a IDX=(IDX+1) %% 4
    ping -n 1 -w 150 127.0.0.1 >nul
    goto :spin_loop

:check_result
set /p INSTALL_RC=<"%DONE_FILE%"
del "%DONE_FILE%"
echo Installing dependencies... [done]
if "!INSTALL_RC!" NEQ "0" (
    echo.
    echo [ERROR] Failed to install dependencies.
    echo Try running this script as Administrator, or install manually with:
    echo   pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

:: Save the hash so we skip this next time
echo !CURRENT_HASH!>"%STAMP_FILE%"

:launch

:: ── Launch the app ─────────────────────────────────────────────────────────────
echo Starting Autotape 3000...
python "%~dp0main.py"
