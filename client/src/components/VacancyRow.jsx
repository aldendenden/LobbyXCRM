import React, { useState } from 'react';
import StatusSelect from './StatusSelect.jsx';
import { ExternalIcon } from './Icons.jsx';
import { updateNotes, updateStatus } from '../api.js';

export default function VacancyRow({ vac, updateVacancy }) {
    const [notesDraft, setNotesDraft] = useState(vac.notes || '');
    const [saved, setSaved] = useState(false);
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

    return (
        <tr className={isIgnored ? 'ignored' : ''}>
            <td>
                <span className="unit-tag">{vac.unit || 'IT'}</span>
            </td>
            <td>
                <a
                    className="vac-link"
                    href={vac.url}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {(vac.title || 'Без назви')}{' '}
                    <ExternalIcon className="icon vac-ext" />
                </a>
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
        </tr>
    );
}
