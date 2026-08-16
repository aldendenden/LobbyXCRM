const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = path.join(__dirname, 'settings.json');

const DEFAULT_SETTINGS = {
    mode: 'local',
    turso: {
        url: '',
        authToken: '',
    },
};

let cached = null;

function loadSettings() {
    if (cached) return cached;
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            cached = {
                ...DEFAULT_SETTINGS,
                ...raw,
                turso: { ...DEFAULT_SETTINGS.turso, ...(raw.turso || {}) },
            };
            if (cached.mode !== 'local' && cached.mode !== 'turso') {
                cached.mode = 'local';
            }
            return cached;
        }
    } catch (e) {
        console.error('settings.json не читається, використовую значення за замовчуванням:', e.message);
    }
    cached = { ...DEFAULT_SETTINGS };
    // Файл налаштувань створюється автоматично при першому запуску
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(cached, null, 2), 'utf8');
    } catch (e) {
        console.error('Не вдалося створити settings.json:', e.message);
    }
    return cached;
}

function saveSettings(next) {
    const merged = {
        mode: next.mode === 'turso' ? 'turso' : 'local',
        turso: {
            url: String(next.turso?.url || '').trim(),
            authToken: String(next.turso?.authToken || '').trim(),
        },
    };
    cached = merged;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
}

function getSettings() {
    return loadSettings();
}

module.exports = {
    SETTINGS_PATH,
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    getSettings,
};
