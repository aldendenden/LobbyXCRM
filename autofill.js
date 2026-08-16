const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const settings = require('./settings');

const FILES_DIR = path.join(__dirname, 'autofill_files');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getStoredFilePath(fileName) {
    if (!fileName) return null;
    const p = path.join(FILES_DIR, path.basename(fileName));
    return fs.existsSync(p) ? p : null;
}

// Встановлення значення текстового поля
async function fillText(page, name, value) {
    if (value === undefined || value === null || String(value) === '') return;
    await page.evaluate(({ name, value }) => {
        const el = document.querySelector(`input[name="${name}"], textarea[name="${name}"]`);
        if (!el) return;
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name, value });
}

// Вибір радіокнопки за значенням
async function pickRadio(page, name, value) {
    if (!value) return;
    await page.evaluate(({ name, value }) => {
        const el = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
        if (!el) return;
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name, value });
}

// Чекбокс: вмикаємо якщо треба (назва поля без [] — кілька чекбоксів під одним ім'ям)
async function setCheckbox(page, name, on) {
    if (!on) return;
    await page.evaluate(({ name }) => {
        document.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach(el => {
            if (!el.checked) {
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }, { name });
}

// Вибір значення у випадаючому списку
async function pickSelect(page, name, value) {
    if (!value) return;
    await page.evaluate(({ name, value }) => {
        const el = document.querySelector(`select[name="${name}"]`);
        if (!el) return;
        const exists = Array.from(el.options).some(o => o.value === value);
        if (exists) el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name, value });
}

// Прикріплення файлів через input[type=file]
async function attachFile(page, name, fileName) {
    const p = getStoredFilePath(fileName);
    if (!p) return;
    const input = await page.$(`input[type="file"][name="${name}"]`);
    if (!input) return;
    await input.uploadFile(p);
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
        args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
    });

    let page;
    try {
        page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

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

        // Файли (CV та додатковий файл)
        await attachFile(page, 'file-755', cfg.cvFileName);
        await attachFile(page, 'file-760', cfg.extraFileName);

        // Згода на розсилку (необов'язково)
        await setCheckbox(page, 'checkbox-290[]', cfg.newsletterConsent);
        // Політика конфіденційності (обов'язково для відправки)
        await setCheckbox(page, 'checkbox-717[]', cfg.privacyConsent);

        // Прокрутка до кнопки «Відправити», щоб запустити reCAPTCHA
        await page.evaluate(() => {
            const btn = document.querySelector('.wpcf7-form input[type="submit"]');
            if (btn) btn.scrollIntoView({ block: 'center' });
        });

        // Тримаємо вікно відкритим — користувач вирішує капчу й надсилає заявку сам.
        // Відпускаємо керування, не закриваючи браузер.
        browser.disconnect();

        return { success: true, url };
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
