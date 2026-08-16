import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon, MessageIcon, SendIcon, StarIcon, XIcon, ZapIcon } from './Icons.jsx';

const OPTIONS = [
    { value: 'ignored', label: 'Не цікаво', Icon: XIcon, className: 'opt-ignored' },
    { value: 'new', label: 'Нова', Icon: ZapIcon, className: 'opt-new' },
    { value: 'interested', label: 'Цікаво', Icon: StarIcon, className: 'opt-interested' },
    { value: 'applied', label: 'Є заявка', Icon: SendIcon, className: 'opt-applied' },
    { value: 'feedback', label: 'Є фідбек', Icon: MessageIcon, className: 'opt-feedback' },
];

export default function StatusSelect({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState({});
    const btnRef = useRef(null);
    const menuRef = useRef(null);
    const current = OPTIONS.find(o => o.value === value) || OPTIONS[0];
    const CurrentIcon = current.Icon;

    const close = useCallback(() => setOpen(false), []);

    const updatePosition = useCallback(() => {
        if (!btnRef.current) return;
        const rect = btnRef.current.getBoundingClientRect();
        setMenuStyle({
            top: rect.bottom + 6,
            left: rect.left,
            width: rect.width,
        });
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        updatePosition();
        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        const onDocClick = e => {
            if (btnRef.current && btnRef.current.contains(e.target)) return;
            if (menuRef.current && menuRef.current.contains(e.target)) return;
            close();
        };
        const onEsc = e => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open, close, updatePosition]);

    const pick = opt => {
        setOpen(false);
        onChange(opt.value);
    };

    return (
        <>
            <div className="status-select">
                <button
                    type="button"
                    ref={btnRef}
                    className={`status-btn ${current.className}`}
                    onClick={() => setOpen(o => !o)}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                >
                    <CurrentIcon className="icon" />
                    <span>{current.label}</span>
                    <ChevronDownIcon className={`icon chevron${open ? ' up' : ''}`} />
                </button>
            </div>
            {open && createPortal(
                <ul
                    ref={menuRef}
                    className="status-menu"
                    style={menuStyle}
                    role="listbox"
                >
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
                </ul>,
                document.body
            )}
        </>
    );
}
