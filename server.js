const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const db = require('./db');
const settings = require('./settings');
const autofill = require('./autofill');

const app = express();
app.use(express.json());

const LOG_PATH = path.join(__dirname, 'debug.log');
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');
const AUTOFILL_FILES_DIR = path.join(__dirname, 'autofill_files');

if (!fs.existsSync(AUTOFILL_FILES_DIR)) {
    fs.mkdirSync(AUTOFILL_FILES_DIR, { recursive: true });
}

const autofillStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, AUTOFILL_FILES_DIR),
    filename: (req, file, cb) => {
        const clean = String(file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
        cb(null, Date.now() + '-' + clean);
    },
});
const autofillUpload = multer({
    storage: autofillStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
});

// Ініціалізація БД: створює локальні файли або підключається до Turso
const ready = (async () => {
    try {
        await db.init();
        console.log(`База даних: ${settings.getSettings().mode === 'turso' ? 'Turso (хмарна)' : 'SQLite (локальна)'}`);
        await db.migrateLegacyDB();
    } catch (e) {
        console.error('Помилка ініціалізації бази даних:', e.message);
        console.log('Перевірте налаштування в settings.json або видаліть його для скидання на локальну SQLite.');
        process.exit(1);
    }
})();

// Функція запису повідомлень у лог-файл
function logToFile(message) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_PATH, `[${timestamp}] ${message}\n`, 'utf8');
}

// АРІ для фронтенду
app.get('/api/vacancies', async (req, res) => {
    try {
        res.json(await db.getVacancies());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Налаштування програми (режим БД + доступ до Turso)
app.get('/api/settings', (req, res) => {
    res.json(settings.getSettings());
});

app.post('/api/settings', async (req, res) => {
    const body = req.body || {};
    const mode = body.mode === 'turso' ? 'turso' : 'local';
    const turso = {
        url: String(body.turso?.url || '').trim(),
        authToken: String(body.turso?.authToken || '').trim(),
    };

    // Спершу тестуємо підключення, щоб не зламати поточний режим
    try {
        await db.testConnection(mode, turso);
    } catch (e) {
        return res.status(400).json({ error: 'Не вдалося підключитись до хмарної БД: ' + e.message });
    }

    settings.saveSettings({ mode, turso, autofill: body.autofill });

    try {
        await db.switchBackend();
        res.json({ success: true, settings: settings.getSettings() });
    } catch (e) {
        res.status(500).json({ error: 'Налаштування збережено, але не вдалося переключити БД: ' + e.message });
    }
});

// Збереження лише даних автозаявки (без зайвого підключення до хмари)
app.post('/api/settings/autofill', (req, res) => {
    const data = (req.body || {}).autofill;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ error: 'Некоректні дані автозаявки' });
    }
    settings.saveSettings({ ...settings.getSettings(), autofill: data });
    res.json({ success: true, settings: settings.getSettings() });
});

// Збереження налаштувань reCAPTCHA solver
app.post('/api/settings/captcha', (req, res) => {
    const data = (req.body || {}).captcha;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ error: 'Некоректні дані captcha' });
    }
    settings.saveSettings({ ...settings.getSettings(), captcha: data });
    res.json({ success: true, settings: settings.getSettings() });
});

// Завантаження файлу для автозаявки (CV / додатковий файл)
app.post('/api/autofill/files', autofillUpload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не отримано' });
    }
    res.json({ success: true, fileName: req.file.filename, originalName: req.file.originalname });
});

// Автозаявка: відкриває вікно Chrome, відкриває форму та заповнює її даними з налаштувань
app.post('/api/autofill', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Не вказано адресу вакансії' });
    }
    try {
        const result = await autofill.runAutofill({ url });
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: 'Автозаявку не вдалося створити: ' + e.message });
    }
});

// Двостороння синхронізація локальної та хмарної БД
app.post('/api/sync', async (req, res) => {
    try {
        const result = await db.syncDatabases();
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Статус — це дані користувача, зберігаються окремо від даних парсера
// і не можуть бути затерті при оновленні вакансій.
app.post('/api/vacancies/status', async (req, res) => {
    const { url, status } = req.body;
    if (!url || !['new', 'interested', 'applied', 'feedback', 'ignored'].includes(status)) {
        return res.status(400).json({ error: 'Некоректний запит' });
    }
    if (!(await db.hasVacancy(url))) {
        return res.status(404).json({ error: "Вакансію не знайдено" });
    }
    await db.setStatus(url, status);
    res.json({ success: true });
});

app.post('/api/vacancies/notes', async (req, res) => {
    const { url, notes } = req.body;
    if (!url || typeof notes !== 'string') {
        return res.status(400).json({ error: 'Некоректний запит' });
    }
    if (!(await db.hasVacancy(url))) {
        return res.status(404).json({ error: "Вакансію не знайдено" });
    }
    await db.setNotes(url, notes);
    res.json({ success: true });
});

// Головний парсер. Додає/оновлює тільки дані парсера (url/title/unit)
// через upsert, який за дизайном не торкається таблиці vacancy_meta.
app.get('/api/scrape', async (req, res) => {
    fs.writeFileSync(LOG_PATH, '', 'utf8');
    logToFile('=== ЗАПУСК НОВОГО АНАЛІЗУ АРІ ===');

    // Бекап SQLite перед змінами (лише для локального режиму)
    try {
        await db.backup();
        logToFile('Створено резервну копію бази даних');
    } catch (e) {
        logToFile(`Помилка створення резервної копії: ${e.message}`);
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--disable-blink-features=AutomationControlled']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        let allScrapedUrls = [];
        let pageNum = 1;
        let offset = 0;
        let hasMoreData = true;

        console.log('Розпочинаю завантаження з API Lobby X...');

        while (hasMoreData) {
            // Надійний конструктор параметрів згідно з еталоном
            const queryParams = new URLSearchParams({
                action: 'loadmore',
                offset: offset.toString(),
                page: pageNum.toString(),
                category: '',
                category_sector: '',
                category_sphere: '27', // Сфера IT
                category_event: '',
                category_conditions: '',
                category_rank: '',
                category_unit: '',
                category_contracts: '',
                category_busy_time: '',
                category_format: '',
                search: '',
                language: 'uk',
                ver: '2026.06.12'
            });

            const ajaxUrl = 'https://lobbyx.army/wp-json/internal-api/home-page/get-tors-card?' + queryParams.toString();

            console.log(`Завантажую: Сторінка ${pageNum} (Offset: ${offset})...`);
            logToFile(`Запит на лінк: ${ajaxUrl}`);

            await page.goto(ajaxUrl, { waitUntil: 'networkidle2' });

            let rawContent = await page.evaluate(() => document.body.textContent || document.body.innerText);
            rawContent = rawContent.trim();

            logToFile(`--- СИРИЙ ВМІСТ СЕРВЕРА (СТОРІНКА ${pageNum}) ---`);
            logToFile(rawContent.substring(0, 400));
            logToFile(`--- КІНЕЦЬ СИРОГО ВМІСТУ СТОРІНКИ ${pageNum} ---`);

            // АРІ повертає JSON-рядок з подвійним екрануванням: "{\"html\":\"\\r\\n <div ... \\\" ...\"}"
            // Тому знімаємо екранування двома послідовними парсингами JSON
            let htmlContent = '';
            try {
                const decoded = JSON.parse(rawContent);
                htmlContent = JSON.parse(decoded).html || '';
            } catch (jsonErr) {
                try {
                    htmlContent = JSON.parse(rawContent).html || '';
                } catch (e) {
                    logToFile(`Помилка десеріалізації JSON на сторінці ${pageNum}: ${jsonErr.message}`);
                    htmlContent = rawContent;
                }
            }

            // Усередині HTML посилання мають екрановані слеші (https:\/\/lobbyx.army\/tor\/...)
            // та шлях /tor/ або /vacancy/. Чистимо URL від похилих рисок.
            const urlRegex = /href="(https:[^"]+)"/g;
            let match;
            let pageLinks = [];

            while ((match = urlRegex.exec(htmlContent)) !== null) {
                let cleanUrl = match[1].replace(/\\/g, '');
                if (/^https:\/\/lobbyx\.army\/(tor|vacancy)\//.test(cleanUrl) && !pageLinks.includes(cleanUrl)) {
                    pageLinks.push(cleanUrl);
                }
            }

            logToFile(`Кількість виявлених лінків через Regex: ${pageLinks.length}`);

            if (pageLinks.length === 0) {
                console.log('Нових вакансій не знайдено. Викачування завершено.');
                hasMoreData = false;
                break;
            }

            let pageAddedLinksCount = 0;
            for (const href of pageLinks) {
                if (!allScrapedUrls.includes(href)) {
                    allScrapedUrls.push(href);
                    pageAddedLinksCount++;
                }
            }

            logToFile(`Додано унікальних посилань зі сторінки ${pageNum}: ${pageAddedLinksCount}`);

            // Крокуємо пагінацією далі на основі знайдених лінків
            offset += pageLinks.length;
            pageNum++;

            if (pageNum > 50) {
                logToFile('Досягнуто ліміту безпеки у 50 сторінок.');
                break;
            }

            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`Всього знайдено унікальних URL: ${allScrapedUrls.length}. Збір заголовків...`);
        logToFile(`Унікальних URL адрес у масиві для обходу: ${allScrapedUrls.length}`);

        let addedCount = 0;

        for (const url of allScrapedUrls) {
            if (await db.hasVacancy(url)) continue;

            try {
                logToFile(`Перехід на внутрішню сторінку: ${url}`);
                await page.goto(url, { waitUntil: 'networkidle2' });
                await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {});

                const details = await page.evaluate(() => {
                    const h1Element = document.querySelector('h1.vacancy-name') || document.querySelector('h1');
                    let title = h1Element ? h1Element.innerText.trim() : '';

                    // Підрозділ: беремо лінк сторінки батальйону, якщо він є
                    let unitUrl = '';
                    const unitLink = document.querySelector('a.about__unit--button');
                    if (unitLink) {
                        unitUrl = unitLink.getAttribute('href') || '';
                    }

                    // Запасний варіант: абзац «Огляд», перше речення після «службу …»
                    let overview = '';
                    const oglyad = Array.from(document.querySelectorAll('h2')).find(h => h.innerText.trim().toLowerCase().startsWith('огляд'));
                    if (oglyad && oglyad.nextElementSibling) {
                        overview = oglyad.nextElementSibling.innerText.trim();
                    }

                    return { title, unitUrl, overview };
                });

                let unit = 'Сили Оборони України';

                // 1) Офіційна назва підрозділу зі сторінки батальйону
                if (details.unitUrl && /lobbyx\.army\/battalions\//.test(details.unitUrl)) {
                    try {
                        const batResponse = await fetch(details.unitUrl);
                        const batHtml = await batResponse.text();
                        const batMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(batHtml);
                        if (batMatch) {
                            const batName = batMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                            if (batName) unit = batName;
                        }
                    } catch (batErr) {
                        logToFile(`Помилка отримання назви підрозділу ${details.unitUrl}: ${batErr.message}`);
                    }
                }

                // 2) Запасний варіант: назва з абзацу «Огляд»
                if (unit === 'Сили Оборони України' && details.overview) {
                    const unitMatch = /(?:службу|служби)\s+(?:у складі\s+|у\s+|в\s+|до\s+)?([^.,!\n]{4,140}?)(?=\s+(?:Повітряного|у місті|у Києві|на території|у складі)|\s*[.,]|\s*$)/i.exec(details.overview);
                    if (unitMatch) unit = unitMatch[1].trim();
                }

                if (details.title && details.title.length > 2) {
                    // Upsert: додає нову вакансію або оновлює title/unit.
                    // Статус та нотатки у таблиці vacancy_meta не чіпаються.
                    await db.upsertVacancy(url, details.title, unit);
                    addedCount++;
                    console.log(`[ДОДАНО] ${unit} -> ${details.title}`);
                    logToFile(`Base updated: ${unit} -> ${details.title}`);
                }

                await new Promise(r => setTimeout(r, 800));
            } catch (e) {
                console.log(`Помилка сторінки ${url}:`, e.message);
                logToFile(`Помилка парсингу URL ${url}: ${e.message}`);
            }
        }

        await browser.close();
        console.log(`Процес завершено. Додано: ${addedCount}`);
        logToFile(`=== РОБОТУ ЗАВЕРШЕНО. Успішно внесено позицій: ${addedCount} ===`);
        res.json({ success: true, added: addedCount });

    } catch (err) {
        console.error('Помилка парсингу:', err);
        logToFile(`КРИТИЧНА ПОМИЛКА СКРИПТА: ${err.message}`);
        if (browser) await browser.close();
        res.status(500).json({ error: err.message, added: 0 });
    }
});

// SSE: пуш змін статусів у реальному часі
app.get('/api/events', (req, res) => {
    console.log('[SSE] клієнт підключився');
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders();
    res.write(':\n\n');
    const onStatus = ({ url, status }) => {
        console.log(`[SSE] пуш: ${url} -> ${status}`);
        res.write(`data: ${JSON.stringify({ url, status })}\n\n`);
    };
    db.bus.on('statusChanged', onStatus);
    req.on('close', () => {
        console.log('[SSE] клієнт відключився');
        db.bus.off('statusChanged', onStatus);
    });
});

// Статика React-фронтенду (client/dist)
app.use(express.static(CLIENT_DIST));
app.get('/', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));

// Сервер стартує лише після успішної ініціалізації БД
ready.then(() => {
    app.listen(3000, () => console.log('Сервер працює: http://localhost:3000'));
});