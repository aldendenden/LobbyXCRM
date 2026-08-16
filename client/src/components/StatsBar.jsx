import React from 'react';
import { ListIcon, MessageIcon, SendIcon, StarIcon, XIcon, ZapIcon } from './Icons.jsx';

const CARDS = [
    { id: 'all', label: 'Всього в базі', key: 'all', activeClass: 'active-all', Icon: ListIcon },
    { id: 'new', label: 'Нові', key: 'new', activeClass: 'active-new', Icon: ZapIcon },
    { id: 'interested', label: 'Цікаво', key: 'interested', activeClass: 'active-interested', Icon: StarIcon },
    { id: 'applied', label: 'Є заявка', key: 'applied', activeClass: 'active-applied', Icon: SendIcon },
    { id: 'feedback', label: 'Є фідбек', key: 'feedback', activeClass: 'active-feedback', Icon: MessageIcon },
    { id: 'ignored', label: 'Не цікаво', key: 'ignored', activeClass: 'active-ignored', Icon: XIcon },
];

export default function StatsBar({ stats, filterStatus, onFilter }) {
    return (
        <div className="grid">
            {CARDS.map(card => {
                const active = filterStatus === card.id;
                const Icon = card.Icon;
                return (
                    <div
                        key={card.id}
                        id={`card-${card.id}`}
                        onClick={() => onFilter(card.id)}
                        className={`card ${active ? card.activeClass : ''}`}
                    >
                        <Icon className="icon card-icon" />
                        <div className="card-label">{card.label}</div>
                        <div className="card-num">{stats[card.key]}</div>
                    </div>
                );
            })}
        </div>
    );
}
