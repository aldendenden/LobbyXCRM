const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'lobbyx.db');
const BACKUP_PATH = path.join(__dirname, 'lobbyx_backup.db');
const LEGACY_DB_PATH = path.join(__dirname, 'db.json');

let db = null;

function openDatabase() {
    if (db) return db;
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(`
        CREATE TABLE IF NOT EXISTS vacancies (
            url         TEXT PRIMARY KEY,
            title       TEXT NOT NULL DEFAULT '',
            unit        TEXT NOT NULL DEFAULT '',
            scraped_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS vacancy_meta (
            url        TEXT PRIMARY KEY REFERENCES vacancies(url) ON DELETE CASCADE,
            status     TEXT NOT NULL DEFAULT 'new',
            notes      TEXT NOT NULL DEFAULT ''
        );
    `);
    return db;
}

// Одноразова міграція зі старого db.json. Статуси зберігаються без втрат.
// Після міграції db.json більше ніколи не використовується парсером.
function migrateLegacyDB() {
    const database = openDatabase();
    if (!fs.existsSync(LEGACY_DB_PATH)) return;
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

// Копіювання SQLite-файлу вимагає закриття дескриптора. Спочатку робимо
// checkpoint WAL, закриваємо БД, копіюємо файл, відкриваємо БД знову.
function backup() {
    const database = openDatabase();
    const count = database.prepare('SELECT COUNT(*) AS c FROM vacancies').get().c;
    if (count === 0) return;
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    database.close();
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    db = null;
    openDatabase();
}

function getVacancies() {
    return openDatabase().prepare(`
        SELECT v.url, v.title, v.unit, v.scraped_at,
               COALESCE(m.status, 'new') AS status,
               COALESCE(m.notes, '')    AS notes
        FROM vacancies v
        LEFT JOIN vacancy_meta m ON m.url = v.url
        ORDER BY v.rowid ASC
    `).all();
}

function upsertVacancy(url, title, unit) {
    openDatabase().prepare(`
        INSERT INTO vacancies (url, title, unit) VALUES (?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            title      = excluded.title,
            unit       = excluded.unit,
            scraped_at = datetime('now')
    `).run(url, title, unit);
}

function hasVacancy(url) {
    return !!openDatabase().prepare('SELECT 1 AS x FROM vacancies WHERE url = ?').get(url);
}

function setStatus(url, status) {
    const result = openDatabase().prepare(`
        INSERT INTO vacancy_meta (url, status) VALUES (?, ?)
        ON CONFLICT(url) DO UPDATE SET status = excluded.status
    `).run(url, status);
    return result.changes > 0;
}

function setNotes(url, notes) {
    const result = openDatabase().prepare(`
        INSERT INTO vacancy_meta (url, notes) VALUES (?, ?)
        ON CONFLICT(url) DO UPDATE SET notes = excluded.notes
    `).run(url, notes);
    return result.changes > 0;
}

function getVacancyMeta(url) {
    return openDatabase().prepare('SELECT * FROM vacancy_meta WHERE url = ?').get(url) || null;
}

module.exports = {
    DB_PATH,
    BACKUP_PATH,
    openDatabase,
    migrateLegacyDB,
    backup,
    getVacancies,
    upsertVacancy,
    hasVacancy,
    setStatus,
    setNotes,
    getVacancyMeta,
};
