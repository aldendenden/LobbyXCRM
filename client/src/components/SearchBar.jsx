import React, { useRef } from 'react';

export default function SearchBar({ value, onChange }) {
    const inputRef = useRef(null);
    const hasQuery = value.trim().length > 0;

    const handleClear = () => {
        onChange('');
        inputRef.current?.focus();
    };

    return (
        <div className="search-box">
            <input
                id="searchInput"
                ref={inputRef}
                type="text"
                placeholder="Пошук за посадою чи підрозділом..."
                autoComplete="off"
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        handleClear();
                    }
                }}
            />
            {hasQuery && (
                <button
                    className="search-clear"
                    title="Скинути пошук"
                    onClick={handleClear}
                >
                    ✕
                </button>
            )}
        </div>
    );
}
