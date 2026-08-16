import React from 'react';

const CARDS = [
    { id: 'all', label: 'Всього в базі', key: 'all', activeClass: 'active-all' },
    { id: 'interested', label: '👍 Цікаво', key: 'interested', activeClass: 'active-interested' },
    { id: 'applied', label: '✉️ Є заявка', key: 'applied', activeClass: 'active-applied' },
    { id: 'ignored', label: '👎 Не цікаво', key: 'ignored', activeClass: 'active-ignored' },
];

export default function StatsBar({ stats, filterStatus, onFilter }) {
    return (
        <div className="grid">
            {CARDS.map(card => {
                const active = filterStatus === card.id;
                return (
                    <div
                        key={card.id}
                        id={`card-${card.id}`}
                        onClick={() => onFilter(card.id)}
                        className={`card ${active ? card.activeClass : ''}`}
                    >
                        <div>{card.label}</div>
                        <div className="card-num">{stats[card.key]}</div>
                    </div>
                );
            })}
        </div>
    );
}
