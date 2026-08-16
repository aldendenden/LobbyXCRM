@echo off
title LobbyX CRM - Автономний запуск
chcp 65001 > nul
cd /d "%~dp0"

echo [ІНФО] Перевірка та очищення фонових процесів...
:: Цей рядок примусово закриває будь-який старий сервер Node, що застряг у пам'яті
taskkill /f /im node.exe >nul 2>&1

:: Додаткове очищення порту 3000, якщо він заблокований
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    taskkill /f /pid %%a >nul 2>&1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ПОМИЛКА] Node.js не знайдено в системі!
    echo Будь ласка, встановіть Node.js з офіційного сайту: https://nodejs.org
    pause
    exit
)

if not exist "node_modules\" (
    echo [ІНФО] Перший запуск програми. Встановлюю серверні компоненти...
    call npm install express puppeteer cheerio
    if errorlevel 1 (
        echo [ПОМИЛКА] Не вдалося встановити модулі.
        pause
        exit
    )
    echo [УСПІХ] Серверні компоненти успішно встановлено!
)

if not exist "client\node_modules\" (
    echo [ІНФО] Встановлюю React-компоненти фронтенду...
    cd client
    call npm install
    if errorlevel 1 (
        echo [ПОМИЛКА] Не вдалося встановити React-модулі.
        pause
        exit
    )
    cd ..
    echo [УСПІХ] React-компоненти успішно встановлено!
)

echo [ІНФО] Збираю React-фронтенд (client\dist)...
cd client
call npm run build
if errorlevel 1 (
    echo [ПОМИЛКА] Помилка збірки React-фронтенду.
    pause
    exit
)
cd ..

echo [ІНФО] Запускаю локальний сервер Node.js...
:: Запускаємо сервер в окремому вікні
start "LobbyX Backend Server" cmd /k "node server.js"

echo [ІНФО] Очікування стабілізації сервера...
timeout /t 5 > nul

echo [ІНФО] Відкриваю CRM-інтерфейс...
start http://localhost:3000
exit
