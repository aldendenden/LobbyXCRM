import React from 'react';
import VacancyRow from './VacancyRow.jsx';

export default function VacancyTable({ vacancies, loading, searchQuery, updateVacancy }) {
    if (loading) {
        return (
            <div style={{ overflowX: 'auto' }}>
                <table>
                    <tbody>
                        <tr>
                            <td className="empty-row">
                                <span className="loading-spinner"></span>
                                Завантаження...
                            </td>
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
                        <th style={{ width: '10%' }}>Підрозділ</th>
                        <th style={{ width: '33%' }}>Посада (Посилання)</th>
                        <th style={{ width: '24%' }}>Нотатки</th>
                        <th style={{ width: '15%', textAlign: 'center' }}>Статус</th>
                        <th style={{ width: '18%', textAlign: 'center' }}>Автозаявка</th>
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
