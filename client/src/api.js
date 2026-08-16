async function request(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const body = await res.json();
            if (body.error) detail = body.error;
        } catch (e) { /* ignore */ }
        throw new Error(detail);
    }
    return res.json();
}

export function fetchVacancies() {
    return request('/api/vacancies');
}

export function updateStatus(url, status) {
    return request('/api/vacancies/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, status }),
    });
}

export function updateNotes(url, notes) {
    return request('/api/vacancies/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, notes }),
    });
}

export function runScrape() {
    return request('/api/scrape');
}
