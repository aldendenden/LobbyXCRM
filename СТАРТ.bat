@echo off
title LobbyX CRM
cd /d "%~dp0"

echo [INFO] Cleaning up background processes...
taskkill /f /im node.exe >nul 2>&1

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo Download from: https://nodejs.org
    pause
    exit /b 1
)

:: --- 1. Server deps ---
if not exist "node_modules\" goto :install_server
goto :skip_server
:install_server
echo [INFO] Installing server dependencies...
call npm install --ignore-scripts
if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)
echo [OK] Server dependencies installed.
:skip_server

:: --- 1b. ffmpeg binary ---
if exist "node_modules\ffmpeg-static\ffmpeg.exe" goto :skip_ffmpeg
echo [INFO] Downloading ffmpeg binary...
node "node_modules\ffmpeg-static\install.js"
:skip_ffmpeg

:: --- 2. Chrome for Puppeteer ---
if exist "%USERPROFILE%\.cache\puppeteer\chrome\" goto :skip_chrome
echo [INFO] Downloading Chrome for Puppeteer...
call npx --yes puppeteer browsers install chrome
if errorlevel 1 (
    echo [WARN] Chrome download failed. Autofill may not work.
) else (
    echo [OK] Chrome downloaded.
)
:skip_chrome

:: --- 3. React deps ---
if not exist "client\node_modules\" goto :install_react
goto :skip_react
:install_react
echo [INFO] Installing React dependencies...
cd /d "%~dp0client"
call npm install
if errorlevel 1 (
    cd /d "%~dp0"
    echo [ERROR] React npm install failed.
    pause
    exit /b 1
)
cd /d "%~dp0"
echo [OK] React dependencies installed.
:skip_react

:: --- 4. Vosk model ---
if exist "vosk_models\vosk-model-small-en-us-0.15\" goto :skip_vosk
echo [INFO] Downloading Vosk model (~40 MB)...
call node download-model.js
if errorlevel 1 (
    echo [WARN] Vosk model download failed. Captcha solver disabled.
) else (
    echo [OK] Vosk model downloaded.
)
:skip_vosk

:: --- 5. Build React ---
echo [INFO] Building frontend...
cd /d "%~dp0client"
call npm run build
if errorlevel 1 (
    cd /d "%~dp0"
    echo [ERROR] React build failed.
    pause
    exit /b 1
)
cd /d "%~dp0"

:: --- 6. Start ---
echo [INFO] Starting server...
start "LobbyX Backend Server" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 5 /nobreak >nul
start http://localhost:3000
exit /b 0
