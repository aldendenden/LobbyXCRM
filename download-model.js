const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { promisify } = require('util');

const MODELS_DIR = path.join(__dirname, 'vosk_models');
const MODEL_NAME = 'vosk-model-small-en-us-0.15';
const MODEL_DIR = path.join(MODELS_DIR, MODEL_NAME);
const ZIP_PATH = path.join(MODELS_DIR, `${MODEL_NAME}.zip`);
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;

const pipe = promisify(pipeline);

function log(msg) {
    console.log(`[download-model] ${msg}`);
}

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = (url.startsWith('https') ? https : require('http')).get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlinkSync(dest);
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.unlinkSync(dest);
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const total = parseInt(res.headers['content-length'], 10);
            let downloaded = 0;
            let lastPct = -1;
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total) {
                    const pct = Math.floor((downloaded / total) * 100);
                    if (pct !== lastPct) {
                        lastPct = pct;
                        process.stdout.write(`\r  Завантаження: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} МБ)`);
                    }
                }
            });
            res.pipe(file);
            file.on('finish', () => { file.close(); log(''); resolve(); });
        });
        request.on('error', (err) => { file.close(); fs.unlinkSync(dest); reject(err); });
        request.setTimeout(120000, () => { request.destroy(); reject(new Error('Timeout')); });
    });
}

function extractZip(zipPath, destDir) {
    log('Розпаковую архів...');
    try {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
    } catch (e) {
        log('PowerShell не спрацював, пробую tar...');
        execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'inherit' });
    }
}

async function ensureModel() {
    if (fs.existsSync(path.join(MODEL_DIR, 'conf', 'model.conf')) ||
        fs.existsSync(path.join(MODEL_DIR, 'am', 'final.mdl'))) {
        log(`Модель вже існує: ${MODEL_DIR}`);
        return MODEL_DIR;
    }

    log('Модель Vosk не знайдена. Завантажую...');
    if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

    log(`URL: ${MODEL_URL}`);
    await downloadFile(MODEL_URL, ZIP_PATH);

    extractZip(ZIP_PATH, MODELS_DIR);

    try { fs.unlinkSync(ZIP_PATH); } catch (e) { /* ignore */ }

    if (!fs.existsSync(MODEL_DIR)) {
        throw new Error(`Після розпаковки папка моделі не знайдена: ${MODEL_DIR}`);
    }

    log(`Модель готова: ${MODEL_DIR}`);
    return MODEL_DIR;
}

if (require.main === module) {
    ensureModel()
        .then((dir) => { log(`Готово: ${dir}`); process.exit(0); })
        .catch((err) => { log(`ПОМИЛКА: ${err.message}`); process.exit(1); });
}

module.exports = { ensureModel, MODEL_DIR, MODELS_DIR };
