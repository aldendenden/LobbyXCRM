import React, { useRef } from 'react';
import { SearchIcon } from './Icons.jsx';

export default function SearchBar({ value, onChange }) {
    const inputRef = useRef(null);
    const hasQuery = value.trim().length > 0;

    const handleClear = () => {
        onChange('');
        inputRef.current?.focus();
    };

    return (
        <div className="search-box">
            <span className="search-icon"><SearchIcon className="icon" /></span>
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
