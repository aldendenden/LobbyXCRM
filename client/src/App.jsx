import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchVacancies, runScrape } from './api.js';
import StatsBar from './components/StatsBar.jsx';
import SearchBar from './components/SearchBar.jsx';
import VacancyTable from './components/VacancyTable.jsx';
import { MedalIcon, RefreshIcon, WarningIcon } from './components/Icons.jsx';

export default function App() {
    const [vacancies, setVacancies] = useState([]);
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isScraping, setIsScraping] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    const loadVacancies = useCallback(async () => {
        try {
            setLoading(true);
            const data = await fetchVacancies();
            setVacancies(data);
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadVacancies();
    }, [loadVacancies]);

    const updateVacancy = useCallback((url, patch) => {
        setVacancies(prev => prev.map(v => (v.url === url ? { ...v, ...patch } : v)));
    }, []);

    const onScrape = async () => {
        if (isScraping) return;
        setIsScraping(true);
        setError('');
        try {
            const data = await runScrape();
            window.alert(`Додано нових позицій: ${data.added}`);
            await loadVacancies();
        } catch (e) {
            setError(`Помилка оновлення: ${e.message}`);
        } finally {
            setIsScraping(false);
        }
    };

    const filtered = useMemo(() => {
        let list = vacancies;
        if (filterStatus !== 'all') {
            list = list.filter(v => v.status === filterStatus);
        }
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(v => {
                const haystack = ((v.title || '') + ' ' + (v.unit || '')).toLowerCase();
                return q.split(/\s+/).every(word => haystack.includes(word));
            });
        }
        return list;
    }, [vacancies, filterStatus, searchQuery]);

    const stats = useMemo(() => ({
        all: vacancies.length,
        interested: vacancies.filter(v => v.status === 'interested').length,
        applied: vacancies.filter(v => v.status === 'applied').length,
        feedback: vacancies.filter(v => v.status === 'feedback').length,
        ignored: vacancies.filter(v => v.status === 'ignored').length,
    }), [vacancies]);

    return (
        <div className="container">
            <header>
                <div className="header-left">
                    <h1><MedalIcon className="icon logo-icon" /> Alenev Lobby X IT CRM</h1>
                    <SearchBar
                        value={searchQuery}
                        onChange={setSearchQuery}
                    />
                </div>
                <button
                    id="scrapeBtn"
                    onClick={onScrape}
                    disabled={isScraping}
                    className="btn"
                >
                    <RefreshIcon className={`icon${isScraping ? ' spin' : ''}`} />
                    {isScraping ? ' Сканю Lobby X...' : ' Оновити з сайту'}
                </button>
            </header>

            {error && (
                <div className="error-banner">
                    <WarningIcon className="icon" /> {error}
                </div>
            )}

            <StatsBar
                stats={stats}
                filterStatus={filterStatus}
                onFilter={setFilterStatus}
            />

            {searchQuery.trim() && (
                <div className="results-info">
                    Знайдено: {filtered.length} / {vacancies.length}
                </div>
            )}

            <VacancyTable
                vacancies={filtered}
                loading={loading}
                searchQuery={searchQuery}
                updateVacancy={updateVacancy}
            />
        </div>
    );
}
