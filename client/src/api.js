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

export function fetchSettings() {
    return request('/api/settings');
}

export function saveSettings(payload) {
    return request('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

export function saveAutofillSettings(autofill) {
    return request('/api/settings/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autofill }),
    });
}

export function uploadAutofillFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    return request('/api/autofill/files', {
        method: 'POST',
        body: fd,
    });
}

export function runAutofill(url) {
    return request('/api/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
}

export function syncDatabases() {
    return request('/api/sync', { method: 'POST' });
}
