import React, { useState } from 'react';
import StatusSelect from './StatusSelect.jsx';
import { ExternalIcon, XIcon, ZapIcon } from './Icons.jsx';
import { updateNotes, updateStatus, runAutofill } from '../api.js';

export default function VacancyRow({ vac, updateVacancy }) {
    const [notesDraft, setNotesDraft] = useState(vac.notes || '');
    const [saved, setSaved] = useState(false);
    const [autoBusy, setAutoBusy] = useState(false);
    const [autoMsg, setAutoMsg] = useState('');
    const [autoError, setAutoError] = useState('');
    const isIgnored = vac.status === 'ignored';

    const handleStatus = async (status) => {
        updateVacancy(vac.url, { status });
        try {
            await updateStatus(vac.url, status);
        } catch (e) {
            console.error(e);
        }
    };

    const saveNotes = async () => {
        const value = notesDraft.trim();
        if (value === (vac.notes || '')) return;
        updateVacancy(vac.url, { notes: value });
        try {
            await updateNotes(vac.url, value);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
        } catch (e) {
            console.error(e);
        }
    };

    const handleAutofill = async () => {
        if (autoBusy) return;
        setAutoBusy(true);
        setAutoMsg('');
        setAutoError('');
        try {
            const res = await runAutofill(vac.url);
            const files = (res.files || []).map(f => f.name).join(', ');
            setAutoMsg(
                files
                    ? `Форма відкрита та заповнена. Файли у формі: ${files}`
                    : 'Форма відкрита та заповнена'
            );
            setTimeout(() => setAutoMsg(''), 8000);
        } catch (e) {
            setAutoError(e.message || 'Помилка автозаявки');
            setTimeout(() => setAutoError(''), 6000);
        } finally {
            setAutoBusy(false);
        }
    };

    return (
        <tr className={isIgnored ? 'ignored' : ''}>
            <td>
                <span className="unit-tag">{vac.unit || 'IT'}</span>
            </td>
            <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                        type="button"
                        className={`ignore-btn${isIgnored ? ' active' : ''}`}
                        onClick={() => handleStatus(isIgnored ? 'new' : 'ignored')}
                        title={isIgnored ? 'Повернути у статус «Нова»' : 'Позначити як «Не цікаво»'}
                    >
                        <XIcon className="icon" />
                    </button>
                    <a
                        className="vac-link"
                        href={vac.url}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {(vac.title || 'Без назви')}{' '}
                        <ExternalIcon className="icon vac-ext" />
                    </a>
                </div>
            </td>
            <td>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                        className="notes-input"
                        type="text"
                        placeholder="Нотатки..."
                        value={notesDraft}
                        onChange={e => setNotesDraft(e.target.value)}
                        onBlur={saveNotes}
                        onKeyDown={e => {
                            if (e.key === 'Enter') e.target.blur();
                        }}
                    />
                    {saved && <span className="notes-saved">✓</span>}
                </div>
            </td>
            <td style={{ textAlign: 'center' }}>
                <StatusSelect
                    value={vac.status}
                    onChange={handleStatus}
                />
            </td>
            <td style={{ textAlign: 'center' }}>
                <button
                    type="button"
                    className={`btn btn-auto${autoBusy ? ' disabled' : ''}`}
                    onClick={handleAutofill}
                    disabled={autoBusy}
                    title="Відкрити форму заявки та заповнити даними автозаявки"
                >
                    <ZapIcon className={`icon${autoBusy ? ' spin' : ''}`} />
                    {autoBusy ? ' Відкриваю...' : ' Автозаявка'}
                </button>
                {autoMsg && <div className="auto-msg">{autoMsg}</div>}
                {autoError && <div className="auto-error">{autoError}</div>}
            </td>
        </tr>
    );
}
