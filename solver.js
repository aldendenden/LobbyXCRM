const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { Model, Recognizer } = require('vosk');
const { ensureModel } = require('./download-model');

const WORD_TO_DIGIT = {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    oh: '0', to: '2', too: '2', for: '4', ate: '8',
};

let cachedModel = null;

async function getModel(modelPath) {
    if (cachedModel) return cachedModel;
    const dir = modelPath || (await ensureModel());
    if (!fs.existsSync(dir)) throw new Error(`Vosk model dir not found: ${dir}`);
    cachedModel = new Model(dir);
    return cachedModel;
}

function wordsToDigits(text) {
    if (!text) return '';
    return text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).map(w => WORD_TO_DIGIT[w] ?? '').join('');
}

function mp3ToRawPcm(mp3Buffer) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) return reject(new Error('ffmpeg-static not found'));
        const chunks = [];
        const proc = spawn(ffmpegPath, [
            '-i', 'pipe:0',
            '-f', 's16le',
            '-acodec', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            'pipe:1',
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.stdout.on('data', c => chunks.push(c));
        let stderr = '';
        proc.stderr.on('data', c => { stderr += c.toString(); });
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 200)}`));
            resolve(Buffer.concat(chunks));
        });
        proc.on('error', reject);
        proc.stdin.write(mp3Buffer);
        proc.stdin.end();
    });
}

async function transcribeAudio(audioBuffer, model) {
    const pcm = await mp3ToRawPcm(audioBuffer);
    if (pcm.length < 320) throw new Error('PCM too short');
    const recognizer = new Recognizer({ model, sampleRate: 16000 });
    const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    recognizer.acceptWaveform(int16);
    const result = recognizer.finalResult();
    return result.text || '';
}

function findFrame(page, pattern) {
    return page.frames().find(f => f.url().includes(pattern)) || null;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function dumpBframe(bframe, _log, label) {
    try {
        const html = await bframe.evaluate(() => {
            return document.body ? document.body.innerHTML.substring(0, 4000) : '(no body)';
        });
        _log(`reCAPTCHA: [DUMP ${label}] ${html}`);
    } catch (e) {
        _log(`reCAPTCHA: dump ${label} failed — ${e.message}`);
    }
}

async function isSolved(page) {
    return page.evaluate(() => {
        const t = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
        return !!(t && t.value && t.value.length > 10);
    });
}

async function twoCaptcha({ apiKey, sitekey, pageUrl, maxWaitSec = 180, log } = {}) {
    const base = 'https://2captcha.com';
    log('2captcha: надсилаю запит на розв\'язання...');
    const submitParams = new URLSearchParams({
        key: apiKey,
        method: 'userrecaptcha',
        googlekey: sitekey,
        pageurl: pageUrl,
        json: '1',
    });
    const submitResp = await fetch(`${base}/in.php?${submitParams.toString()}`);
    const submitJson = await submitResp.json();
    if (submitJson.status !== 1 || !submitJson.request) {
        log(`2captcha: in.php помилка — ${JSON.stringify(submitJson)}`);
        return null;
    }
    const id = submitJson.request;
    log(`2captcha: завдання прийнято, id=${id}, чекаю розв'язання (до ${maxWaitSec}с)...`);
    const start = Date.now();
    let token = null;
    while (Date.now() - start < maxWaitSec * 1000) {
        await new Promise(r => setTimeout(r, 5000));
        const pollParams = new URLSearchParams({ key: apiKey, action: 'get', id, json: '1' });
        const pollResp = await fetch(`${base}/res.php?${pollParams.toString()}`);
        const pollJson = await pollResp.json();
        if (pollJson.status === 1) {
            token = pollJson.request;
            break;
        }
        if (pollJson.status === 0 && pollJson.request && !/CAPCHA_NOT_READY/.test(pollJson.request)) {
            log(`2captcha: res.php помилка — ${JSON.stringify(pollJson)}`);
            return null;
        }
    }
    if (token) log(`2captcha: отримано token (${token.length} символів)`);
    else log('2captcha: таймаут очікування розв\'язання');
    return token;
}

async function solveCaptcha2captcha(page, { apiKey, log } = {}) {
    const _log = log || console.log;
    _log('reCAPTCHA: використовую сервіс 2captcha.com...');

    // 1) Find sitekey
    let sitekey = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="recaptcha/api2/anchor"]');
        if (iframe && iframe.src) {
            const m = iframe.src.match(/[?&]k=([^&]+)/);
            if (m) return m[1];
        }
        const el = document.querySelector('.g-recaptcha[data-sitekey], [data-sitekey]');
        if (el) return el.getAttribute('data-sitekey');
        return null;
    }).catch(() => null);
    if (!sitekey) {
        const anchorFrame = findFrame(page, 'recaptcha/api2/anchor');
        if (anchorFrame) {
            const m = anchorFrame.url().match(/[?&]k=([^&]+)/);
            if (m) sitekey = m[1];
        }
    }
    if (!sitekey) {
        _log('reCAPTCHA: 2captcha — sitekey НЕ ЗНАЙДЕНО, пропускаю');
        return false;
    }
    _log(`reCAPTCHA: 2captcha — sitekey = ${sitekey}`);

    // 2) Get token from service
    let token;
    try {
        token = await twoCaptcha({ apiKey, sitekey, pageUrl: page.url(), log: _log });
    } catch (e) {
        _log(`reCAPTCHA: 2captcha помилка запиту — ${e.message}`);
        return false;
    }
    if (!token) return false;

    // 3) Inject token into response fields + notify the widget
    const injected = await page.evaluate((tok) => {
        const els = document.querySelectorAll('#g-recaptcha-response, textarea[name="g-recaptcha-response"], .g-recaptcha-response');
        let n = 0;
        els.forEach(el => {
            el.value = tok;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            n++;
        });
        try {
            const clients = (window.___grecaptcha_cfg || {}).clients || {};
            Object.values(clients).forEach(c => {
                if (typeof c.callback === 'function') { try { c.callback(tok); } catch (e) {} }
                if (c && c.R && typeof c.R.callback === 'function') { try { c.R.callback.call(c, tok); } catch (e) {} }
            });
        } catch (e) { /* ignore */ }
        return n;
    }, token).catch(() => 0);
    _log(`reCAPTCHA: 2captcha — token введено у ${injected} полів`);

    if (await isSolved(page)) {
        _log('reCAPTCHA: РОЗВ\'ЯЗАНО (2captcha)');
        return true;
    }
    _log('reCAPTCHA: 2captcha — токен НЕ видно в g-recaptcha-response');
    return injected > 0;
}

async function solveCaptcha(page, { maxAttempts = 5, modelPath, solver = 'local', apiKey = '', log } = {}) {
    const _log = log || console.log;

    if (solver === '2captcha') {
        if (!apiKey) {
            _log('reCAPTCHA: обрано 2captcha, але apiKey не задано — пропускаю');
            return false;
        }
        return solveCaptcha2captcha(page, { apiKey, log: _log });
    }

    // 0) Load model
    _log('reCAPTCHA: завантажую модель Vosk...');
    let model;
    try {
        model = await getModel(modelPath);
        _log('reCAPTCHA: модель завантажена');
    } catch (e) {
        _log(`reCAPTCHA: ПОМИЛКА завантаження моделі — ${e.message}`);
        return false;
    }

    // Helper: detect garbled / anti-bot challenge content
    function isGarbledText(text) {
        if (!text) return false;
        const stripped = text.replace(/\s/g, '');
        if (stripped.length === 0) return false;
        // Too many non-alpha symbols suggests anti-bot gibberish
        const nonAlpha = stripped.replace(/[a-zA-Z0-9]/g, '').length;
        return nonAlpha / stripped.length > 0.4;
    }

    // 1) List all frames for debug
    const allFrames = page.frames().map(f => f.url());
    _log(`reCAPTCHA: знайдено ${allFrames.length} frames`);
    allFrames.forEach((u, i) => _log(`  frame[${i}]: ${u.substring(0, 120)}`));

    // 2) Find anchor frame
    let anchor = findFrame(page, 'recaptcha/api2/anchor');
    if (!anchor) {
        _log('reCAPTCHA: anchor не знайдено, пробую scroll...');
        await page.evaluate(() => {
            const el = document.querySelector('.g-recaptcha, [data-sitekey]');
            if (el) el.scrollIntoView({ block: 'center' });
        });
        await delay(3000);
        anchor = findFrame(page, 'recaptcha/api2/anchor');
    }
    if (!anchor) {
        _log('reCAPTCHA: anchor iframe НЕ ЗНАЙДЕНО — пропускаю');
        return false;
    }
    _log(`reCAPTCHA: anchor знайдено — ${anchor.url().substring(0, 100)}`);

    // 3) Click checkbox
    try {
        await anchor.waitForSelector('#recaptcha-anchor', { timeout: 10000 });
        await anchor.click('#recaptcha-anchor');
        _log('reCAPTCHA: checkbox натиснуто');
    } catch (e) {
        _log(`reCAPTCHA: помилка checkbox — ${e.message}`);
        return false;
    }
    await delay(3000);

    if (await isSolved(page)) {
        _log('reCAPTCHA: вирішено без виклику!');
        return true;
    }

    // 4) Find bframe
    let bframe = null;
    for (let i = 0; i < 20; i++) {
        bframe = findFrame(page, 'bframe');
        if (bframe) break;
        await delay(1000);
    }
    if (!bframe) {
        _log('reCAPTCHA: bframe НЕ ЗНАЙДЕНО — пропускаю');
        return false;
    }
    _log(`reCAPTCHA: bframe знайдено — ${bframe.url().substring(0, 100)}`);

    // 5) Solving loop
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        _log(`reCAPTCHA: === спроба ${attempt}/${maxAttempts} ===`);

        // Check if already in audio mode (after reload)
        const inAudioMode = await bframe.evaluate(() => {
            return !!(
                document.querySelector('#audio-source, #audio-response, audio, video') ||
                document.querySelector('.fbc-audiochallenge') ||
                document.querySelector('.rc-audiochallenge-play-button, #rc-audiochallenge-play-button') ||
                document.querySelector('.rc-audiochallenge-tdownload-link, #rc-audiochallenge-tdownload-link')
            );
        }).catch(() => false);

        if (!inAudioMode) {
            // Click audio button via JS (Puppeteer .click() fails on hidden/overlay elements)
            const clicked = await bframe.evaluate(() => {
                const btn = document.querySelector('#recaptcha-audio-button');
                if (btn) { btn.click(); return true; }
                return false;
            }).catch(() => false);
            if (!clicked) {
                _log('reCAPTCHA: audio button НЕ ЗНАЙДЕНО');
                break;
            }
            _log('reCAPTCHA: audio button натиснуто (JS)');
            await delay(5000);
        } else {
            _log('reCAPTCHA: вже в audio mode');
        }

        // Detect garbled / anti-bot challenge text in the bframe
        const bframeText = await bframe.evaluate(() => {
            return document.body ? document.body.innerText : '';
        }).catch(() => '');
        if (isGarbledText(bframeText)) {
            _log(`reCAPTCHA: виявлено anti-bot контент, чекаю 15с...`);
            await delay(15000);
            try { await bframe.click('#recaptcha-reload-button'); } catch (e) { /* ignore */ }
            await delay(5000);
            continue;
        }

        // Find audio element and get src
        let audioSrc = null;
        try {
            audioSrc = await bframe.evaluate(() => {
                const audio = document.querySelector('audio#audio-source, audio');
                if (audio && audio.src) return audio.src;
                if (audio && audio.currentSrc) return audio.currentSrc;
                const source = document.querySelector('source[src]');
                if (source && source.src) return source.src;
                const lnk = document.querySelector('.rc-audiochallenge-tdownload-link, #rc-audiochallenge-tdownload-link, a[href*="audio"]');
                if (lnk) {
                    const a = lnk.tagName === 'A' ? lnk : lnk.querySelector('a');
                    if (a && a.href) return a.href;
                    if (lnk.href) return lnk.href;
                }
                return null;
            });
        } catch (e) {
            _log(`reCAPTCHA: помилка read audio src — ${e.message}`);
        }
        _log(`reCAPTCHA: audioSrc = ${audioSrc ? audioSrc.substring(0, 100) : 'NULL'}`);

        if (!audioSrc) {
            _log('reCAPTCHA: audio src не знайдено, натискаю кнопку відтворення...');
            const played = await bframe.evaluate(() => {
                const b = document.querySelector('.rc-audiochallenge-play-button, #rc-audiochallenge-play-button');
                if (b) { b.click(); return true; }
                return false;
            }).catch(() => false);
            if (played) _log('reCAPTCHA: кнопку відтворення натиснуто');
            await delay(3000);
            // Retry after wait
            try {
                audioSrc = await bframe.evaluate(() => {
                    const a = document.querySelector('audio');
                    if (a) return a.src || a.currentSrc || null;
                    const source = document.querySelector('source[src]');
                    if (source) return source.src || null;
                    const lnk = document.querySelector('.rc-audiochallenge-tdownload-link a, #rc-audiochallenge-tdownload-link a');
                    return lnk ? (lnk.href || null) : null;
                });
            } catch (e) { /* ignore */ }
            _log(`reCAPTCHA: audioSrc (retry) = ${audioSrc ? audioSrc.substring(0, 100) : 'NULL'}`);
            if (!audioSrc) {
                _log('reCAPTCHA: audio src досі null, пропускаю спробу');
                await dumpBframe(bframe, _log, 'audio-src-missing');
                try { await bframe.click('#recaptcha-reload-button'); } catch (e) { /* ignore */ }
                await delay(3000);
                continue;
            }
        }

        // Download audio
        let audioBase64 = null;
        try {
            audioBase64 = await bframe.evaluate(async (src) => {
                try {
                    const r = await fetch(src);
                    if (!r.ok) return 'FETCH_FAIL_' + r.status;
                    const b = await r.blob();
                    return new Promise(res => {
                        const fr = new FileReader();
                        fr.onloadend = () => res(fr.result.split(',')[1]);
                        fr.readAsDataURL(b);
                    });
                } catch (e) {
                    return 'FETCH_ERROR_' + e.message;
                }
            }, audioSrc);
        } catch (e) {
            _log(`reCAPTCHA: помилка fetch audio — ${e.message}`);
        }

        if (!audioBase64 || audioBase64.startsWith('FETCH_')) {
            _log(`reCAPTCHA: audio download failed — ${audioBase64}`);
            try { await bframe.click('#recaptcha-reload-button'); } catch (e) { /* ignore */ }
            await delay(3000);
            continue;
        }

        const audioBuffer = Buffer.from(audioBase64, 'base64');
        _log(`reCAPTCHA: аудіо ${audioBuffer.length} байт`);

        // Transcribe
        let rawText = '';
        try {
            rawText = await transcribeAudio(audioBuffer, model);
        } catch (e) {
            _log(`reCAPTCHA: транскрипція FAILED — ${e.message}`);
            try { await bframe.click('#recaptcha-reload-button'); } catch (err) { /* ignore */ }
            await delay(3000);
            continue;
        }
        _log(`reCAPTCHA: raw text = "${rawText}"`);
        const answer = rawText.trim();
        _log(`reCAPTCHA: answer = "${answer}"`);

        if (!answer || answer.length < 1) {
            _log('reCAPTCHA: відповідь занадто коротка');
            try { await bframe.click('#recaptcha-reload-button'); } catch (e) { /* ignore */ }
            await delay(5000);
            continue;
        }

        // Skip clearly garbled transcriptions (likely anti-bot audio)
        if (isGarbledText(answer)) {
            _log('reCAPTCHA: транскрипція виглядає як anti-bot шум, пропускаю...');
            try { await bframe.click('#recaptcha-reload-button'); } catch (e) { /* ignore */ }
            await delay(8000);
            continue;
        }

        // Type answer
        try {
            const input = await bframe.$('#audio-response, input[id*="audio"], .fbc-audiochallenge input, .rc-audiochallenge input, input[type="text"]');
            if (!input) {
                _log('reCAPTCHA: input (audio-response) НЕ ЗНАЙДЕНО');
                await dumpBframe(bframe, _log, 'input-missing');
                break;
            }
            await input.click({ clickCount: 3 });
            await input.type(answer, { delay: 80 });
            _log(`reCAPTCHA: введено "${answer}"`);
        } catch (e) {
            _log(`reCAPTCHA: помилка введення — ${e.message}`);
            continue;
        }
        await delay(500);

        // Click verify
        try {
            const verifyBtn = await bframe.$('#recaptcha-verify-button, [id*="verify"]');
            if (!verifyBtn) {
                _log('reCAPTCHA: verify button НЕ ЗНАЙДЕНО');
                break;
            }
            await verifyBtn.click();
            _log('reCAPTCHA: verify натиснуто');
        } catch (e) {
            _log(`reCAPTCHA: помилка verify — ${e.message}`);
            continue;
        }
        await delay(4000);

        if (await isSolved(page)) {
            _log('reCAPTCHA: РОЗВ\'ЯЗАНО!');
            return true;
        }

        _log('reCAPTCHA: не пройшло, новий виклик...');
        try { await bframe.click('#recaptcha-reload-button'); } catch (e) { /* ignore */ }
        await delay(5000);
    }

    _log(`reCAPTCHA: вичерпано ${maxAttempts} спроб`);
    return false;
}

module.exports = { solveCaptcha, getModel, transcribeAudio, wordsToDigits };
