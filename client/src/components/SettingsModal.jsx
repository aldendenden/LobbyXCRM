import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchSettings, saveSettings, syncDatabases } from '../api.js';
import { RefreshIcon, XIcon } from './Icons.jsx';

export default function SettingsModal({ open, onClose, onSaved }) {
    const [mode, setMode] = useState('local');
    const [url, setUrl] = useState('');
    const [authToken, setAuthToken] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState('');
    const [syncError, setSyncError] = useState('');

    const load = useCallback(async () => {
        setError('');
        try {
            const s = await fetchSettings();
            setMode(s.mode || 'local');
            setUrl(s.turso?.url || '');
            setAuthToken(s.turso?.authToken || '');
        } catch (e) {
            setError('Не вдалося завантажити налаштування: ' + e.message);
        }
    }, []);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    useEffect(() => {
        if (!open) return undefined;
        const onEsc = e => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onEsc);
        return () => document.removeEventListener('keydown', onEsc);
    }, [open, onClose]);

    if (!open) return null;

    const handleSave = async () => {
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            await saveSettings({ mode, turso: { url, authToken } });
            setSuccess(true);
            setTimeout(() => {
                onClose();
                onSaved();
            }, 600);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncError('');
        setSyncResult('');
        try {
            await saveSettings({ mode, turso: { url, authToken } });
            const r = await syncDatabases();
            setSyncResult(
                `Синхронізацію завершено: вакансій ${r.vacancies}, оновлено ${r.vacanciesChanged}. ` +
                `Статусів: ${r.meta}, оновлено ${r.metaChanged}.`
            );
        } catch (e) {
            setSyncError(e.message);
        } finally {
            setSyncing(false);
        }
    };

    return createPortal(
        <div className="modal-overlay" onMouseDown={e => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div className="settings-modal" role="dialog" aria-modal="true">
                <div className="modal-header">
                    <h2>Налаштування</h2>
                    <button type="button" className="modal-close" onClick={onClose} title="Закрити">
                        <XIcon className="icon" />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="field-label">База даних</div>
                    <div className="mode-cards">
                        <button
                            type="button"
                            className={`mode-card ${mode === 'local' ? 'selected' : ''}`}
                            onClick={() => setMode('local')}
                        >
                            <div className="mode-card-title">Локальна SQLite</div>
                            <div className="mode-card-desc">Дані зберігаються на цьому комп&apos;ютері у файлі lobbyx.db. Працює без інтернету.</div>
                        </button>
                        <button
                            type="button"
                            className={`mode-card ${mode === 'turso' ? 'selected' : ''}`}
                            onClick={() => setMode('turso')}
                        >
                            <div className="mode-card-title">Turso (хмарна)</div>
                            <div className="mode-card-desc">Спільний доступ до даних для кількох користувачів через хмарну БД Turso.</div>
                        </button>
                    </div>

                    {mode === 'turso' && (
                        <div className="turso-fields">
                            <div className="field-label">Доступ до хмарної БД Turso</div>
                            <label className="settings-field">
                                <span>URL бази (libsql://...)</span>
                                <input
                                    type="text"
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    placeholder="libsql://my-db.turso.io"
                                    autoComplete="off"
                                />
                            </label>
                            <label className="settings-field">
                                <span>Auth-токен</span>
                                <input
                                    type="password"
                                    value={authToken}
                                    onChange={e => setAuthToken(e.target.value)}
                                    placeholder="eyJ... (токен з панелі Turso)"
                                    autoComplete="off"
                                />
                            </label>
                            <div className="settings-hint">
                                Створіть безкоштовний акаунт на turso.tech (реєстрація по email або GitHub, без телефона),
                                створіть базу та скопіюйте URL і токен у ці поля.
                            </div>
                        </div>
                    )}

                    {error && <div className="error-banner modal-error">⚠️ {error}</div>}
                    {success && <div className="modal-success">✓ Налаштування збережено</div>}

                    <div className="sync-section">
                        <div>
                            <div className="field-label">Синхронізація</div>
                            <div className="sync-desc">
                                Зливає локальну та хмарну БД в обидва боки (об&apos;єднання, нічого не видаляє).
                                Вакансії — за свіжістю оновлення, статуси/нотатки — за часом зміни.
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn sync-btn"
                            onClick={handleSync}
                            disabled={syncing || saving}
                        >
                            <RefreshIcon className={`icon${syncing ? ' spin' : ''}`} />
                            {syncing ? ' Синхронізую...' : ' Синхронізувати'}
                        </button>
                    </div>

                    {syncError && <div className="error-banner modal-error">⚠️ {syncError}</div>}
                    {syncResult && <div className="modal-success">✓ {syncResult}</div>}
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>
                        Скасувати
                    </button>
                    <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                        {saving ? 'Збереження...' : 'Зберегти'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
