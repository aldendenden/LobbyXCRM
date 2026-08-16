import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSettings, saveAutofillSettings, uploadAutofillFile } from '../api.js';

const ACCEPT = '.pdf,.doc,.docx,.pages,.jpg,.jpeg,.png,.rtf';

const RANK_OPTIONS = [
    'Немає',
    'Солдат / Матрос',
    'Старший солдат / Старший матрос',
    'Молодший сержант / Старшина ІІ статті',
    'Сержант / Старшина І статті',
    'Старший сержант / Головний старшина',
    'Головний сержант / Головний корабельний старшина',
    'Штаб-сержант / Штаб-старшина',
    'Майстер-сержант / Майстер-старшина',
    'Старший майстер-сержант / Старший майстер-старшина',
    'Головний майстер-сержант / Головний майстер-старшина',
    'Молодший лейтенант',
    'Лейтенант',
    'Старший лейтенант',
    'Капітан / Капітан-лейтенант',
    'Майор / Капітан ІІІ рангу',
    'Підполковник / Капітан ІІ рангу',
    'Полковник / Капітан І рангу',
    'Бригадний генерал / Коммодор',
    'Генерал-майор / Контрадмірал',
    'Генерал-лейтенант / Віцеадмірал',
    'Генерал / Адмірал',
];

const DEFAULT_DATA = {
    personName: '',
    gender: 'Чоловік',
    age: '',
    email: '',
    phone: '',
    status: 'Цивільний',
    newContract: false,
    combatExperience: false,
    szch: false,
    militaryTraining: false,
    rank: 'Немає',
    cvText: '',
    cvFileName: '',
    extraFileName: '',
    newsletterConsent: false,
    privacyConsent: true,
};

function Field({ label, children }) {
    return (
        <label className="settings-field">
            <span>{label}</span>
            {children}
        </label>
    );
}

function RadioGroup({ label, options, value, onChange }) {
    return (
        <div className="settings-field">
            <span>{label}</span>
            <div className="autofill-radio-group">
                {options.map(opt => (
                    <label key={opt} className={`autofill-radio${value === opt ? ' selected' : ''}`}>
                        <input
                            type="radio"
                            checked={value === opt}
                            onChange={() => onChange(opt)}
                        />
                        {opt}
                    </label>
                ))}
            </div>
        </div>
    );
}

function Check({ label, checked, onChange }) {
    return (
        <label className="autofill-check">
            <input
                type="checkbox"
                checked={checked}
                onChange={e => onChange(e.target.checked)}
            />
            {label}
        </label>
    );
}

function FileField({ label, fileName, onUploaded, onRemove }) {
    const inputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const handleChange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            const res = await uploadAutofillFile(file);
            onUploaded(res.fileName);
            if (inputRef.current) inputRef.current.value = '';
        } catch (err) {
            setError(err.message || 'Не вдалося завантажити файл');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="autofill-file-row">
            <div className="settings-field autofill-file-field">
                <span>{label}</span>
                <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={handleChange}
                    disabled={busy}
                />
            </div>
            {fileName ? (
                <div className="autofill-file-info">
                    <span className="autofill-file-name">✓ {fileName}</span>
                    <button type="button" className="btn btn-small btn-secondary" onClick={onRemove}>
                        Видалити
                    </button>
                </div>
            ) : (
                busy && <div className="autofill-file-info"><span className="auto-msg">Завантаження...</span></div>
            )}
            {error && <div className="auto-error">{error}</div>}
        </div>
    );
}

export default function AutofillTab({ open, onSaved }) {
    const [data, setData] = useState(DEFAULT_DATA);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const load = useCallback(async () => {
        setError('');
        try {
            const s = await fetchSettings();
            setData({ ...DEFAULT_DATA, ...(s.autofill || {}) });
            setLoaded(true);
        } catch (e) {
            setError('Не вдалося завантажити дані автозаявки: ' + e.message);
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
            await saveAutofillSettings(data);
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
                        <div className="field-label">Контактні дані</div>
                        <div className="autofill-grid">
                            <Field label="Ім'я та прізвище *">
                                <input
                                    type="text"
                                    value={data.personName}
                                    onChange={e => set('personName')(e.target.value)}
                                    placeholder="Ім'я та прізвище"
                                />
                            </Field>
                            <Field label="Вік *">
                                <input
                                    type="number"
                                    min="18"
                                    max="99"
                                    value={data.age}
                                    onChange={e => set('age')(e.target.value)}
                                    placeholder="Вік"
                                />
                            </Field>
                            <Field label="Електронна адреса *">
                                <input
                                    type="email"
                                    value={data.email}
                                    onChange={e => set('email')(e.target.value)}
                                    placeholder="email@example.com"
                                />
                            </Field>
                            <Field label="Номер телефону *">
                                <input
                                    type="tel"
                                    value={data.phone}
                                    onChange={e => set('phone')(e.target.value)}
                                    placeholder="+380..."
                                />
                            </Field>
                        </div>
                        <RadioGroup
                            label="Стать"
                            options={['Чоловік', 'Жінка']}
                            value={data.gender}
                            onChange={set('gender')}
                        />
                    </div>

                    <div className="autofill-section">
                        <div className="field-label">Статус та військовий досвід</div>
                        <RadioGroup
                            label="Статус *"
                            options={['Цивільний', 'Військовослужбовець']}
                            value={data.status}
                            onChange={set('status')}
                        />
                        <div className="autofill-checks">
                            <Check label="Хочу підписати новий контракт" checked={data.newContract} onChange={set('newContract')} />
                            <Check label="Маю бойовий досвід" checked={data.combatExperience} onChange={set('combatExperience')} />
                            <Check label="Перебуваю в СЗЧ" checked={data.szch} onChange={set('szch')} />
                            <Check label="Маю завершене навчання в одній із військових сфер" checked={data.militaryTraining} onChange={set('militaryTraining')} />
                        </div>
                        <Field label="Звання *">
                            <select value={data.rank} onChange={e => set('rank')(e.target.value)}>
                                {RANK_OPTIONS.map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <div className="autofill-section">
                        <div className="field-label">Резюме</div>
                        <Field label="Опис досвіду та мотивації">
                            <textarea
                                rows="6"
                                maxLength="2000"
                                value={data.cvText}
                                onChange={e => set('cvText')(e.target.value)}
                                placeholder="Опишіть свій досвід, мотивацію та іншу важливу інформацію про себе"
                            />
                        </Field>
                        <FileField
                            label="Файл з CV або резюме"
                            fileName={data.cvFileName}
                            onUploaded={f => set('cvFileName')(f)}
                            onRemove={() => set('cvFileName')('')}
                        />
                        <FileField
                            label="Додатковий файл"
                            fileName={data.extraFileName}
                            onUploaded={f => set('extraFileName')(f)}
                            onRemove={() => set('extraFileName')('')}
                        />
                    </div>

                    <div className="autofill-section">
                        <div className="field-label">Згоди</div>
                        <div className="autofill-checks">
                            <Check label="Даю згоду на отримання інформаційних розсилок від Lobby X" checked={data.newsletterConsent} onChange={set('newsletterConsent')} />
                            <Check label="Приймаю умови Політики конфіденційності та даю згоду на обробку персональних даних *" checked={data.privacyConsent} onChange={set('privacyConsent')} />
                        </div>
                        <div className="settings-hint">
                            reCAPTCHA неможливо пройти автоматично — після відкриття форми залишиться натиснути капчу та «Відправити».
                        </div>
                    </div>

                    {error && <div className="error-banner modal-error">⚠️ {error}</div>}
                    {success && <div className="modal-success">✓ Дані автозаявки збережено</div>}

                    <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                        {saving ? 'Збереження...' : 'Зберегти дані автозаявки'}
                    </button>
                </>
            )}
        </div>
    );
}
