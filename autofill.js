const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const settings = require('./settings');
const db = require('./db');
const { solveCaptcha } = require('./solver');

const FILES_DIR = path.join(__dirname, 'autofill_files');
const LOG_PATH = path.join(__dirname, 'debug.log');

// Таймаут, скільки тримаємо Chrome відкритим, чекаючи на відправку заявки
const OBSERVE_TIMEOUT_MS = 30 * 60 * 1000;

// Хук на сторінці: перехоплюємо FormData, що надсилається через XHR/fetch,
// бо тіло multipart-запиту браузер не віддає через postData().
// Збережений у window.__afCapturedRequests — це точний склад заявки.
function injectCaptureHook() {
    const push = (entries) => {
        (window.__afCapturedRequests = window.__afCapturedRequests || []).push({
            t: Date.now(),
            entries,
            files: entries.filter(e => e.file).map(e => ({ field: e.field, name: e.file, size: e.size })),
        });
    };
    const scan = (body) => {
        const entries = [];
        if (body && typeof body.forEach === 'function') {
            body.forEach((v, k) => {
                const isFile = typeof File !== 'undefined' && v instanceof File;
                entries.push({ field: k, file: isFile ? v.name : '', size: isFile ? v.size : null });
            });
        }
        return entries;
    };
    const hookXHR = () => {
        const XHR = window.XMLHttpRequest;
        if (!XHR || !XHR.prototype) return;
        const orig = XHR.prototype.send;
        XHR.prototype.send = function (body) {
            try {
                const entries = scan(body);
                if (entries.length) push(entries);
            } catch (e) { /* ignore */ }
            return orig.apply(this, arguments);
        };
    };
    const hookFetch = () => {
        if (!window.fetch) return;
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                const entries = scan(init && init.body);
                if (entries.length) push(entries);
            } catch (e) { /* ignore */ }
            return origFetch.apply(this, arguments);
        };
    };
    hookXHR();
    hookFetch();
}

function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try { fs.appendFileSync(LOG_PATH, line, 'utf8'); } catch (e) { /* ignore */ }
    console.log(message);
}

function getStoredFilePath(fileName) {
    if (!fileName) return null;
    const p = path.join(FILES_DIR, path.basename(fileName));
    return fs.existsSync(p) ? p : null;
}

// Встановлення значення текстового поля
async function fillText(page, name, value) {
    if (value === undefined || value === null || String(value) === '') return;
    const ok = await page.evaluate(({ name, value }) => {
        const el = document.querySelector(`input[name="${name}"], textarea[name="${name}"]`);
        if (!el) return false;
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, { name, value });
    log(ok ? `ПОЛЕ ЗАПОВНЕНО: ${name} = "${value}"` : `ПОПЕРЕДЖЕННЯ: поле не знайдено: ${name}`);
}

// Вибір радіокнопки за значенням
async function pickRadio(page, name, value) {
    if (!value) return;
    const ok = await page.evaluate(({ name, value }) => {
        const el = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
        if (!el) return false;
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, { name, value });
    log(ok ? `РАДІО: ${name} = "${value}"` : `ПОПЕРЕДЖЕННЯ: радіо ${name} не знайдено (значення "${value}")`);
}

// Чекбокс: вмикаємо якщо треба (назва поля без [] — кілька чекбоксів під одним ім'ям)
async function setCheckbox(page, name, on) {
    if (!on) return;
    const count = await page.evaluate(({ name }) => {
        const els = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
        els.forEach(el => {
            if (!el.checked) {
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        return els.length;
    }, { name });
    log(count > 0 ? `ЧЕКБОКС: ${name} = увімкнено` : `ПОПЕРЕДЖЕННЯ: чекбокс не знайдено: ${name}`);
}

// Вибір значення у випадаючому списку
async function pickSelect(page, name, value) {
    if (!value) return;
    const ok = await page.evaluate(({ name, value }) => {
        const el = document.querySelector(`select[name="${name}"]`);
        if (!el) return false;
        const exists = Array.from(el.options).some(o => o.value === value);
        if (exists) el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, { name, value });
    log(ok ? `СЕЛЕКТ: ${name} = "${value}"` : `ПОПЕРЕДЖЕННЯ: селект не знайдено: ${name}`);
}

// Підсумкова перевірка: зчитуємо назад реальний стан форми
async function verifyForm(page) {
    const summary = await page.evaluate(() => {
        const val = sel => {
            const el = document.querySelector(sel);
            return el ? el.value : '';
        };
        const checkedVal = name => {
            const el = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
            return el ? el.value : '';
        };
        const checkedBox = name =>
            Array.from(document.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`)).map(e => e.value);
        const fileInfo = name => {
            const el = document.querySelector(`input[type="file"][name="${name}"]`);
            const f = el && el.files && el.files[0];
            return f ? `${f.name} (${f.size} байт)` : '';
        };
        return {
            personName: val('input[name="person-name"]'),
            gender: checkedVal('radio-gender'),
            age: val('input[name="number-age"]'),
            email: val('input[name="person-contact-mail"]'),
            phone: val('input[name="person-contact-tel"]'),
            status: checkedVal('current-status'),
            contract: checkedBox('interested-in-new-contracts[]'),
            combat: checkedBox('military-experience[]'),
            szch: checkedBox('current-szch[]'),
            training: checkedBox('military-training[]'),
            rank: val('select[name="dropdown-rank"]'),
            cvText: val('textarea[name="person-cv-textarea"]'),
            file755: fileInfo('file-755'),
            file760: fileInfo('file-760'),
            newsletter: checkedBox('checkbox-290[]'),
            privacy: checkedBox('checkbox-717[]'),
        };
    });
    log(`ПЕРЕВІРКА ФОРМИ: ${JSON.stringify(summary)}`);
}

// Прикріплення файлу і зчитування підтвердження з DOM
async function attachFile(page, name, fileName) {
    if (!fileName) return null;
    const p = getStoredFilePath(fileName);
    if (!p) {
        log(`ПОПЕРЕДЖЕННЯ: файл не знайдено на диску для поля ${name}: ${fileName}`);
        return null;
    }
    const diskSize = fs.statSync(p).size;
    const input = await page.$(`input[type="file"][name="${name}"]`);
    if (!input) {
        log(`ПОПЕРЕДЖЕННЯ: поле завантаження файлу не знайдено: ${name}`);
        return null;
    }
    await input.uploadFile(p);

    // Читаємо назад, що реально опинилося в input.files
    const info = await page.evaluate(({ name }) => {
        const el = document.querySelector(`input[type="file"][name="${name}"]`);
        const f = el && el.files && el.files[0];
        return f ? { name: f.name, size: f.size } : null;
    }, { name });

    if (info) {
        const intact = info.size === diskSize;
        log(`ФАЙЛ ДОДАНО ДО ФОРМИ: ${name} -> ${info.name} (у формі ${info.size} байт; на диску ${diskSize} байт; цілісність: ${intact ? 'ОК' : 'НЕ ЗБІГАЄТЬСЯ!'})`);
    } else {
        log(`ПОПЕРЕДЖЕННЯ: не вдалося підтвердити прикріплення файлу для ${name} (${fileName})`);
    }
    return info;
}

// Заповнення форми на сторінці вакансії з відкритою модалкою
async function runAutofill({ url }) {
    if (!/^https:\/\/lobbyx\.army\//.test(url)) {
        throw new Error('Некоректна адреса вакансії');
    }

    const cfg = settings.getSettings().autofill || {};

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
    });

    let page;
    try {
        page = await browser.newPage();
        await page.evaluateOnNewDocument(injectCaptureHook);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // 1) Відкриваємо модальне вікно з формою заявки
        await page.waitForSelector('a#open-modal.add-vacancy_btn', { timeout: 20000 });
        await page.click('a#open-modal.add-vacancy_btn');

        // 2) Дочекатися форми CF7 у модалці
        await page.waitForSelector('form.wpcf7-form', { timeout: 20000 });

        // 3) Заповнюємо поля відповідно до налаштувань
        await fillText(page, 'person-name', cfg.personName);
        await pickRadio(page, 'radio-gender', cfg.gender);
        await fillText(page, 'number-age', cfg.age);
        await fillText(page, 'person-contact-mail', cfg.email);
        await fillText(page, 'person-contact-tel', cfg.phone);

        await pickRadio(page, 'current-status', cfg.status);
        await setCheckbox(page, 'interested-in-new-contracts[]', cfg.newContract);
        await setCheckbox(page, 'military-experience[]', cfg.combatExperience);
        await setCheckbox(page, 'current-szch[]', cfg.szch);
        await setCheckbox(page, 'military-training[]', cfg.militaryTraining);
        await pickSelect(page, 'dropdown-rank', cfg.rank);
        await fillText(page, 'person-cv-textarea', cfg.cvText);

        // Файли (CV та додатковий файл) з підтвердженням
        const files = [];
        const cv = await attachFile(page, 'file-755', cfg.cvFileName);
        const extra = await attachFile(page, 'file-760', cfg.extraFileName);
        if (cv) files.push(cv);
        if (extra) files.push(extra);

        // Згода на розсилку (необов'язково)
        await setCheckbox(page, 'checkbox-290[]', cfg.newsletterConsent);
        // Політика конфіденційності (обов'язково для відправки)
        await setCheckbox(page, 'checkbox-717[]', cfg.privacyConsent);

        // Прокрутка до кнопки «Відправити», щоб запустити reCAPTCHA
        await page.evaluate(() => {
            const btn = document.querySelector('.wpcf7-form input[type="submit"]');
            if (btn) btn.scrollIntoView({ block: 'center' });
        });

        // Підсумкова перевірка: що реально опинилося у формі
        await verifyForm(page);

        // 3b) Спостерігаємо за надсиланням: момент відправки ловимо по POST-multipart.
        //    Реєструємо listener ЗАРАЗ, до натискання submit, щоб не пропустити запит.
        let seenCaptures = 0;
        let statusUpdated = false;
        const logSubmissions = async () => {
            let captured = [];
            try {
                captured = await page.evaluate(() => window.__afCapturedRequests || []);
            } catch (e) { captured = []; }
            while (seenCaptures < captured.length) {
                const c = captured[seenCaptures];
                seenCaptures++;
                const filesDesc = c.files.map(f => `${f.field} -> ${f.name} (${f.size} байт)`).join(', ') || 'немає';
                const fieldDesc = [...new Set(c.entries.map(e => e.field))].slice(0, 25).join(', ') || 'немає';
                log(`ЗАЯВКА НАДІСЛАНА | вакансія: ${url} | файли у запиті: ${filesDesc} | поля: ${fieldDesc}`);

                if (!statusUpdated) {
                    statusUpdated = true;
                    try {
                        await db.setStatus(url, 'applied');
                        log(`СТАТУС ОНОВЛЕНО: ${url} -> applied (є заявка)`);
                    } catch (e) {
                        log(`ПОПЕРЕДЖЕННЯ: не вдалося оновити статус — ${e.message}`);
                    }
                }
            }
        };
        page.on('request', (request) => {
            const method = request.method();
            const ct = (request.headers()['content-type'] || '');
            if (method !== 'POST' || !ct.includes('multipart/form-data')) return;
            logSubmissions();
        });

        // Автоматичне розв'язання reCAPTCHA (якщо увімкнено)
        const captchaCfg = settings.getSettings().captcha || {};
        if (captchaCfg.enabled) {
            log('reCAPTCHA: запускаю автоматичне розв\'язання...');
            const captchaSolved = await solveCaptcha(page, {
                maxAttempts: captchaCfg.maxAttempts || 5,
                modelPath: captchaCfg.modelPath || '',
                log,
            });
            if (captchaSolved) {
                log('reCAPTCHA: ВИРІШЕНО — натискаю "Відправити" автоматично...');
                try {
                    await page.click('.wpcf7-form input[type="submit"]');
                    log('reCAPTCHA: кнопку "Відправити" натиснуто');
                } catch (e) {
                    log(`reCAPTCHA: помилка натискання "Відправити" — ${e.message}`);
                }
            } else {
                log('reCAPTCHA: НЕ ВИРІШЕНО — вирішіть вручну та натисніть "Відправити"');
            }
        } else {
            log('reCAPTCHA: автоматичне розв\'язання вимкнено — вирішіть вручну');
        }

        log(`Автозаявку підготовлено: ${url}. Форма заповнена, файлів: ${files.length}. Чекаємо на відправку.`);

        // 5) Вікно залишається відкритим — чекаємо на відправку та фіксуємо результат у лог.
        const finish = async () => {
            clearTimeout(timer);
            try { await browser.close(); } catch (e) { /* ignore */ }
        };
        const timer = setTimeout(() => {
            log('Автозаявка: час очікування вичерпано (30 хв), вікно закрито.');
            finish();
        }, OBSERVE_TIMEOUT_MS);
        browser.once('disconnected', () => {
            clearTimeout(timer);
        });

        return { success: true, url, files };
    } catch (e) {
        try { await browser.close(); } catch (closeErr) { /* ignore */ }
        throw e;
    }
}

module.exports = {
    FILES_DIR,
    getStoredFilePath,
    runAutofill,
};
