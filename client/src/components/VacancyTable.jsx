import React from 'react';
import VacancyRow from './VacancyRow.jsx';

export default function VacancyTable({ vacancies, loading, searchQuery, updateVacancy }) {
    if (loading) {
        return (
            <div style={{ overflowX: 'auto' }}>
                <table>
                    <tbody>
                        <tr>
                            <td className="empty-row">Завантаження...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    }

    if (vacancies.length === 0) {
        return (
            <div style={{ overflowX: 'auto' }}>
                <table>
                    <tbody>
                        <tr>
                            <td className="empty-row">
                                {searchQuery.trim()
                                    ? `Нічого не знайдено за запитом «${searchQuery.trim()}». Спробуйте інші ключові слова або скиньте пошук.`
                                    : 'Вакансій не знайдено.'}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <div style={{ overflowX: 'auto' }}>
            <table>
                <thead>
                    <tr>
                        <th style={{ width: '22%' }}>Підрозділ</th>
                        <th style={{ width: '38%' }}>Посада (Посилання)</th>
                        <th style={{ width: '20%' }}>Нотатки</th>
                        <th style={{ width: '20%', textAlign: 'center' }}>Статус</th>
                    </tr>
                </thead>
                <tbody>
                    {vacancies.map(vac => (
                        <VacancyRow
                            key={vac.url}
                            vac={vac}
                            updateVacancy={updateVacancy}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
