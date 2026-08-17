import React, { useCallback, useEffect, useState } from 'react';
import { fetchSettings, saveCaptchaSettings } from '../api.js';

const DEFAULT_DATA = {
    enabled: false,
    maxAttempts: 5,
};

export default function CaptchaTab({ open, onSaved }) {
    const [data, setData] = useState(DEFAULT_DATA);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const load = useCallback(async () => {
        setError('');
        try {
            const s = await fetchSettings();
            setData({ ...DEFAULT_DATA, ...(s.captcha || {}) });
            setLoaded(true);
        } catch (e) {
            setError('Не вдалося завантажити налаштування captcha: ' + e.message);
        }
    }, []);

    useEffect(() => {
        if (open) {
            setLoaded(false);
            setSuccess(false);
            load();
        }
    }, [open, load]);

    const set = (key) => (value) => setData(prev => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        setSaving(true);
        setError('');
        setSuccess(false);
        try {
            await saveCaptchaSettings({
                enabled: !!data.enabled,
                maxAttempts: Math.max(1, Math.min(10, Number(data.maxAttempts) || 5)),
            });
            setSuccess(true);
            setTimeout(() => setSuccess(false), 2500);
            if (onSaved) onSaved();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="autofill-tab">
            {!loaded && !error && <div className="settings-hint">Завантаження...</div>}

            {loaded && (
                <>
                    <div className="autofill-section">
                        <div className="field-label">reCAPTCHA Solver (Vosk)</div>
                        <div className="settings-hint" style={{ marginBottom: 16 }}>
                            Автоматичне розв&apos;язання reCAPTCHA v2 через аудіо-виклик та розпізнавання мовлення.
                            Модель завантажується автоматично при першому запуску.
                        </div>

                        <label className="autofill-check">
                            <input
                                type="checkbox"
                                checked={data.enabled}
                                onChange={e => set('enabled')(e.target.checked)}
                            />
                            Увімкнути автоматичне розв&apos;язання reCAPTCHA
                        </label>

                        <label className="settings-field" style={{ marginTop: 16 }}>
                            <span>Максимальна кількість спроб</span>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={data.maxAttempts}
                                onChange={e => set('maxAttempts')(e.target.value)}
                            />
                        </label>
                    </div>

                    {error && <div className="error-banner modal-error">⚠️ {error}</div>}
                    {success && <div className="modal-success">✓ Налаштування captcha збережено</div>}

                    <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                        {saving ? 'Збереження...' : 'Зберегти налаштування captcha'}
                    </button>
                </>
            )}
        </div>
    );
}
