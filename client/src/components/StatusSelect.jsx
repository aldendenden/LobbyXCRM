import React from 'react';

const OPTIONS = [
    { value: 'new', label: '🆕 Нова', className: 'sel-new' },
    { value: 'interested', label: '👍 Цікаво', className: 'sel-interested' },
    { value: 'applied', label: '✉️ Є заявка', className: 'sel-applied' },
    { value: 'ignored', label: '👎 Не цікаво', className: 'sel-ignored' },
];

export default function StatusSelect({ value, onChange }) {
    const current = OPTIONS.find(o => o.value === value) || OPTIONS[0];
    return (
        <select
            value={value}
            className={current.className}
            onChange={e => onChange(e.target.value)}
        >
            {OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
}
