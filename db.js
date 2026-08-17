const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@libsql/client');
const settings = require('./settings');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const DB_PATH = path.join(__dirname, 'lobbyx.db');
const BACKUP_PATH = path.join(__dirname, 'lobbyx_backup.db');
const LEGACY_DB_PATH = path.join(__dirname, 'db.json');

let localDb = null;
let tursoClient = null;

const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS vacancies (
        url         TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        unit        TEXT NOT NULL DEFAULT '',
        scraped_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS vacancy_meta (
        url        TEXT PRIMARY KEY REFERENCES vacancies(url) ON DELETE CASCADE,
        status     TEXT NOT NULL DEFAULT 'new',
        notes      TEXT NOT NULL DEFAULT '',
        updated_at TEXT
    );`,
];

const VACANCIES_SQL = `
    SELECT v.url, v.title, v.unit, v.scraped_at,
           COALESCE(m.status, 'new') AS status,
           COALESCE(m.notes, '')    AS notes
    FROM vacancies v
    LEFT JOIN vacancy_meta m ON m.url = v.url
    ORDER BY v.rowid ASC
`;

function isLocal() {
    return settings.getSettings().mode === 'local';
}

// ---------- Локальний SQLite (node:sqlite) ----------
let localMetaColReady = false;

function ensureLocalMetaColumn() {
    if (localMetaColReady) return;
    const db = ensureLocal();
    const cols = db.prepare("PRAGMA table_info('vacancy_meta')").all();
    if (!cols.some(c => c.name === 'updated_at')) {
        db.exec('ALTER TABLE vacancy_meta ADD COLUMN updated_at TEXT');
    }
    db.exec("UPDATE vacancy_meta SET updated_at = datetime('now') WHERE updated_at IS NULL");
    localMetaColReady = true;
}

function ensureLocal() {
    if (localDb) return localDb;
    // Якщо файлів немає — DatabaseSync створює їх автоматично.
    localDb = new DatabaseSync(DB_PATH);
    localDb.exec('PRAGMA journal_mode = WAL;');
    localDb.exec('PRAGMA foreign_keys = ON;');
    for (const sql of SCHEMA_STATEMENTS) localDb.exec(sql);
    ensureLocalMetaColumn();
    return localDb;
}

function openDatabase() {
    return ensureLocal();
}

// ---------- Хмарна БД (Turso / libSQL) ----------
function turso() {
    if (tursoClient) return tursoClient;
    const cfg = settings.getSettings().turso;
    tursoClient = createClient({ url: cfg.url, authToken: cfg.authToken });
    return tursoClient;
}

async function ensureTursoSchema() {
    const client = turso();
    for (const sql of SCHEMA_STATEMENTS) {
        await client.execute(sql);
    }
    // Міграція існуючих таблиць: додаємо updated_at для синхронізації
    const { rows } = await client.execute("PRAGMA table_info('vacancy_meta')");
    if (!rows.some(r => r.name === 'updated_at')) {
        await client.execute('ALTER TABLE vacancy_meta ADD COLUMN updated_at TEXT');
    }
    await client.execute("UPDATE vacancy_meta SET updated_at = datetime('now') WHERE updated_at IS NULL");
}

// Тест підключення без зміни поточного бекенду
async function testConnection(mode, config) {
    if (mode !== 'turso') return;
    if (!config.url || !config.authToken) {
        throw new Error('URL та auth-токен обов’язкові');
    }
    const client = createClient({ url: config.url, authToken: config.authToken });
    try {
        await client.execute('SELECT 1');
    } finally {
        try { client.close(); } catch (e) { /* ignore */ }
    }
}

// Застосовує збережені налаштування: закриває поточний бекенд і відкриває новий.
async function switchBackend() {
    closeAll();
    if (isLocal()) {
        ensureLocal();
    } else {
        await ensureTursoSchema();
    }
    return settings.getSettings().mode;
}

function closeAll() {
    try { if (localDb) localDb.close(); } catch (e) { /* ignore */ }
    try { if (tursoClient) tursoClient.close(); } catch (e) { /* ignore */ }
    localDb = null;
    tursoClient = null;
}

async function init() {
    return switchBackend();
}

// ---------- Схема запитів (спільна для обох бекендів) ----------
async function queryAll(sql, params = []) {
    if (isLocal()) return ensureLocal().prepare(sql).all(...params);
    const { rows } = await turso().execute(sql, params);
    return rows;
}

async function queryGet(sql, params = []) {
    if (isLocal()) return ensureLocal().prepare(sql).get(...params);
    const { rows } = await turso().execute(sql, params);
    return rows[0] || undefined;
}

async function queryRun(sql, params = []) {
    if (isLocal()) {
        const result = ensureLocal().prepare(sql).run(...params);
        return { changes: Number(result.changes) };
    }
    const { rowCount } = await turso().execute(sql, params);
    return { changes: rowCount };
}

// ---------- Одноразова міграція старого db.json (лише локально) ----------
async function migrateLegacyDB() {
    if (!isLocal() || !fs.existsSync(LEGACY_DB_PATH)) return;
    const database = ensureLocal();
    const count = database.prepare('SELECT COUNT(*) AS c FROM vacancies').get().c;
    if (count > 0) return;

    let data;
    try {
        data = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
    } catch (e) {
        console.error('db.json не читається, пропускаю міграцію:', e.message);
        return;
    }

    const vacStmt = database.prepare('INSERT OR IGNORE INTO vacancies (url, title, unit) VALUES (?, ?, ?)');
    const metaStmt = database.prepare('INSERT OR IGNORE INTO vacancy_meta (url, status) VALUES (?, ?)');

    database.exec('BEGIN');
    try {
        let migrated = 0;
        for (const v of (data.vacancies || [])) {
            if (!v.url) continue;
            vacStmt.run(v.url, v.title || '', v.unit || '');
            metaStmt.run(v.url, v.status || 'new');
            migrated++;
        }
        database.exec('COMMIT');
        console.log(`Міграцію завершено: перенесено ${migrated} вакансій з db.json`);
    } catch (e) {
        database.exec('ROLLBACK');
        throw e;
    }
}

// Копіювання локального SQLite-файлу (тільки для локального режиму).
async function backup() {
    if (!isLocal()) return false;
    const database = ensureLocal();
    const count = database.prepare('SELECT COUNT(*) AS c FROM vacancies').get().c;
    if (count === 0) return false;
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    database.close();
    localDb = null;
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    ensureLocal();
    return true;
}

async function getVacancies() {
    return queryAll(VACANCIES_SQL);
}

async function upsertVacancy(url, title, unit) {
    await queryRun(`
        INSERT INTO vacancies (url, title, unit) VALUES (?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            title      = excluded.title,
            unit       = excluded.unit,
            scraped_at = datetime('now')
    `, [url, title, unit]);
}

async function hasVacancy(url) {
    const row = await queryGet('SELECT 1 AS x FROM vacancies WHERE url = ?', [url]);
    return !!row;
}

async function setStatus(url, status) {
    const result = await queryRun(`
        INSERT INTO vacancy_meta (url, status, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(url) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `, [url, status]);
    console.log(`[DB] setStatus: ${url} -> ${status} (changes: ${result.changes})`);
    bus.emit('statusChanged', { url, status });
    return result.changes > 0;
}

async function setNotes(url, notes) {
    const result = await queryRun(`
        INSERT INTO vacancy_meta (url, notes, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(url) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
    `, [url, notes]);
    return result.changes > 0;
}

async function getVacancyMeta(url) {
    return (await queryGet('SELECT * FROM vacancy_meta WHERE url = ?', [url])) || null;
}

// ---------- Двостороння синхронізація локальної SQLite і хмари Turso ----------
// Зливає дані в обидва боки (об'єднання, без видалення):
//  - вакансії: перемагає новіший scraped_at;
//  - статуси/нотатки: перемагає новіший updated_at (при однаковому часі — не-'new' статус).
async function syncDatabases() {
    const cfg = settings.getSettings().turso;
    if (!cfg.url || !cfg.authToken) {
        throw new Error('Спершу вкажіть URL та auth-токен Turso в налаштуваннях');
    }

    const local = ensureLocal();
    ensureLocalMetaColumn();
    const cloud = turso();
    await ensureTursoSchema();

    // --- Зчитування обох сторін ---
    const localVac = local.prepare('SELECT url, title, unit, scraped_at FROM vacancies').all();
    const { rows: cloudVacRows } = await cloud.execute('SELECT url, title, unit, scraped_at FROM vacancies');
    const localMeta = local.prepare('SELECT url, status, notes, updated_at FROM vacancy_meta').all();
    const { rows: cloudMetaRows } = await cloud.execute('SELECT url, status, notes, updated_at FROM vacancy_meta');

    const cloudVac = new Map(cloudVacRows.map(r => [r.url, r]));
    const cloudMeta = new Map(cloudMetaRows.map(r => [r.url, r]));
    const localVacMap = new Map(localVac.map(r => [r.url, r]));
    const localMetaMap = new Map(localMeta.map(r => [r.url, r]));

    const localUpsert = local.prepare(`
        INSERT INTO vacancies (url, title, unit, scraped_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET title = excluded.title, unit = excluded.unit, scraped_at = excluded.scraped_at
    `);
    const localMetaUpsert = local.prepare(`
        INSERT INTO vacancy_meta (url, status, notes, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at
    `);

    const VAC_UPSERT_SQL = `
        INSERT INTO vacancies (url, title, unit, scraped_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET title = excluded.title, unit = excluded.unit, scraped_at = excluded.scraped_at
    `;
    const META_UPSERT_SQL = `
        INSERT INTO vacancy_meta (url, status, notes, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at
    `;

    // --- Вакансії ---
    const vacUrls = new Set([...localVacMap.keys(), ...cloudVac.keys()]);
    let vacanciesChanged = 0;
    const cloudVacWrites = [];

    for (const url of vacUrls) {
        const l = localVacMap.get(url);
        const c = cloudVac.get(url);
        let merged;
        if (!l) merged = c;
        else if (!c) merged = l;
        else merged = (c.scraped_at || '') > (l.scraped_at || '') ? c : l;

        const localOk = l && l.title === merged.title && l.unit === merged.unit;
        const cloudOk = c && c.title === merged.title && c.unit === merged.unit;

        if (!localOk) localUpsert.run(merged.url, merged.title || '', merged.unit || '', merged.scraped_at || '');
        if (!cloudOk) {
            cloudVacWrites.push({ sql: VAC_UPSERT_SQL, args: [merged.url, merged.title || '', merged.unit || '', merged.scraped_at || ''] });
        }
        if (!localOk || !cloudOk) vacanciesChanged++;
    }
    await runCloudBatch(cloud, cloudVacWrites);

    // --- Статуси та нотатки ---
    const metaUrls = new Set([...localMetaMap.keys(), ...cloudMeta.keys()]);
    let metaChanged = 0;
    const cloudMetaWrites = [];

    const mergeMeta = (l, c) => {
        if (!l) return c;
        if (!c) return l;
        const lt = l.updated_at || '';
        const ct = c.updated_at || '';
        if (lt !== ct) return ct > lt ? c : l;
        if (l.status !== 'new' && c.status === 'new') return l;
        if (c.status !== 'new' && l.status === 'new') return c;
        return l;
    };

    for (const url of metaUrls) {
        if (!vacUrls.has(url)) continue; // не чіпаємо мету без вакансії (захист FK)
        const merged = mergeMeta(localMetaMap.get(url), cloudMeta.get(url));
        const l = localMetaMap.get(url);
        const c = cloudMeta.get(url);
        const localOk = l && l.status === merged.status && l.notes === merged.notes;
        const cloudOk = c && c.status === merged.status && c.notes === merged.notes;

        if (!localOk) {
            localMetaUpsert.run(merged.url, merged.status || 'new', merged.notes || '', merged.updated_at || '');
        }
        if (!cloudOk) {
            cloudMetaWrites.push({ sql: META_UPSERT_SQL, args: [merged.url, merged.status || 'new', merged.notes || '', merged.updated_at || ''] });
        }
        if (!localOk || !cloudOk) metaChanged++;
    }
    await runCloudBatch(cloud, cloudMetaWrites);

    return {
        vacancies: vacUrls.size,
        vacanciesChanged,
        meta: metaUrls.size,
        metaChanged,
        localVacancies: localVacMap.size,
        cloudVacancies: cloudVac.size,
    };
}

// Виконує запити до хмари пакетами по 100, щоб не робити HTTP-запит на кожен рядок
async function runCloudBatch(client, statements) {
    if (!statements.length) return;
    const CHUNK = 100;
    for (let i = 0; i < statements.length; i += CHUNK) {
        await client.batch(statements.slice(i, i + CHUNK), 'write');
    }
}

module.exports = {
    DB_PATH,
    BACKUP_PATH,
    openDatabase,
    init,
    switchBackend,
    testConnection,
    closeAll,
    migrateLegacyDB,
    backup,
    getVacancies,
    upsertVacancy,
    hasVacancy,
    setStatus,
    setNotes,
    getVacancyMeta,
    syncDatabases,
    bus,
};
