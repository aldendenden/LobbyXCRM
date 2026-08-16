import React, { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, MessageIcon, SendIcon, StarIcon, XIcon, ZapIcon } from './Icons.jsx';

const OPTIONS = [
    { value: 'new', label: 'Нова', Icon: ZapIcon, className: 'opt-new' },
    { value: 'interested', label: 'Цікаво', Icon: StarIcon, className: 'opt-interested' },
    { value: 'applied', label: 'Є заявка', Icon: SendIcon, className: 'opt-applied' },
    { value: 'feedback', label: 'Є фідбек', Icon: MessageIcon, className: 'opt-feedback' },
    { value: 'ignored', label: 'Не цікаво', Icon: XIcon, className: 'opt-ignored' },
];

export default function StatusSelect({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const current = OPTIONS.find(o => o.value === value) || OPTIONS[0];
    const CurrentIcon = current.Icon;

    useEffect(() => {
        const onDocClick = e => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const onEsc = e => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    const pick = opt => {
        setOpen(false);
        onChange(opt.value);
    };

    return (
        <div
            className={`status-select ${open ? 'open' : ''}`}
            ref={rootRef}
        >
            <button
                type="button"
                className={`status-btn ${current.className}`}
                onClick={() => setOpen(o => !o)}
            >
                <CurrentIcon className="icon" />
                <span>{current.label}</span>
                <ChevronDownIcon className="icon chevron" />
            </button>
            {open && (
                <ul className="status-menu">
                    {OPTIONS.map(opt => {
                        const Icon = opt.Icon;
                        const selected = opt.value === value;
                        return (
                            <li key={opt.value}>
                                <button
                                    type="button"
                                    className={`status-option ${opt.className}${selected ? ' selected' : ''}`}
                                    onClick={() => pick(opt)}
                                >
                                    <Icon className="icon" />
                                    <span>{opt.label}</span>
                                    {selected && <CheckIcon className="icon check" />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
