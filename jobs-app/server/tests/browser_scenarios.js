// These functions run inside the real app page, not in Deno.
export async function setup() {
    window.testData = await import('/js/data.js');
    window.testUtils = await import('/js/utils.js');
    window.testConfig = await import('/js/config.js');
    window.testEvents = await import('/js/events.js');
    window.testUI = await import('/js/ui.js');
    window.check = (condition, message) => { if (!condition) throw new Error(message); };
    window.equal = (actual, expected) => check(JSON.stringify(actual) === JSON.stringify(expected), `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    window.waitFor = async fn => {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            if (await fn()) return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Timed out waiting for browser state');
    };
    window.realFetch = window.fetch.bind(window);
    window.saved = async () => {
        await waitFor(() => !testData.hasUnsavedChanges());
        const response = await realFetch('/api/data');
        return (await response.json()).jobs;
    };
    window.remoteEdit = async proposed => {
        const response = await realFetch('/api/data');
        const base = (await response.json()).jobs;
        return (await realFetch('/api/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, proposed: typeof proposed === 'function' ? proposed(base) : proposed }) })).json();
    };
}

export async function workflows() {
    document.getElementById('btn-add-job').click();
    const form = document.getElementById('add-form');
    form.elements['Töö Nr'].value = 'NEW-Õ';
    form.elements['Täitmise koht'].value = 'Karusel';
    form.querySelector('[type=submit]').click();
    let rows = await saved();
    equal(rows.length, 2);
    equal(rows[1]['Töö Nr'], 'NEW-Õ');
    const filter = document.getElementById('filter-nr');
    filter.value = 'NEW'; filter.dispatchEvent(new Event('input', { bubbles: true }));
    equal(document.querySelectorAll('#table-body tr').length, 1);
    const cell = document.querySelector('td[data-col="Täitmise koht"]');
    cell.click();
    const editor = document.querySelector('.floating-editor textarea, .floating-editor input');
    check(editor, 'Clicking a cell opens an editor');
    editor.value = 'Edited';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    rows = await saved();
    equal(rows[0]['Täitmise koht'], 'TOS');
    equal(rows[1]['Täitmise koht'], 'Edited');
    document.querySelector('.btn-delete').click();
    document.getElementById('confirm-ok').click();
    equal((await saved()).length, 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    equal((await saved()).length, 2);
    await testData.loadData();
    equal(testData.getJobs()[1]['Täitmise koht'], 'Edited');
    const theme = document.documentElement.getAttribute('data-theme');
    document.getElementById('btn-theme').click();
    check(document.documentElement.getAttribute('data-theme') !== theme, 'Theme changes');
    equal(localStorage.getItem('theme'), document.documentElement.getAttribute('data-theme'));
}

export async function datesAndFilters() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    testEvents.toggleField(0, 'Alustatud', true);
    equal((await saved())[0]['Alustamise kpv'], today);
    testEvents.toggleField(0, 'Valmis', true);
    equal((await saved())[0]['Valmis kpv'], today);
    equal(document.querySelectorAll('#table-body tr').length, 0);
    document.getElementById('show-completed').click();
    equal(document.querySelectorAll('#table-body tr').length, 1);
    testEvents.toggleField(0, 'Valmis', false);
    equal((await saved())[0]['Valmis kpv'], '');
    const deadline = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
    equal(testUI.getStatus({ [deadline]: today }), null);
    equal(testUI.getStatus({ [deadline]: '2000-01-01' }), 'overdue');
    equal(testUI.getStatus({ [deadline]: '2000-01-01', Valmis: true }), 'completed');
    equal(testUI.getStatus({ [deadline]: '31.02.2026' }), null);
    equal(testUI.getStatus({ Alustatud: true, 'Töötlus allhankes': true }), 'allhanke');
}

export async function invalidDate() {
    document.getElementById('show-hidden-dates').click();
    const cell = document.querySelector('td[data-col="Valmis kpv"]');
    testEvents.editCell(cell, 0, 'Valmis kpv');
    testEvents.saveEdited({ value: '31.02.2026' }, 0, 'Valmis kpv');
    check(!testData.getJobs()[0]['Valmis kpv'], 'Impossible calendar date must not be saved');
}

export async function csvRoundTrip() {
    const { COLUMNS, DATE_COLS, CHECKBOX_COLS } = testConfig;
    const row = Object.fromEntries(COLUMNS.map((col, index) => [col,
        CHECKBOX_COLS.includes(col) ? index % 2 === 0 : DATE_COLS.includes(col) ? '2024-02-29' : `Õäöü; "${index}"\nsecond line`]));
    row['Tooriku saabumise kuupäev EE'] = '29.02.2024';
    testData.setJobs([row]);
    let blob;
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = value => { blob = value; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try { testData.saveCSV(); }
    finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click; }
    testData.setJobs([]);
    const file = new File([blob], 'roundtrip.csv');
    const result = await testData.loadFromFile(file);
    equal(result.added, 1);
    for (const col of COLUMNS) equal(testData.getJobs()[0][col], row[col]);
    equal((await testData.loadFromFile(file)).added, 0);
    await saved();
}

export async function delayedSave() {
    let release, entered = false;
    const gate = new Promise(resolve => { release = resolve; });
    window.fetch = async (...args) => {
        if (args[0] === '/api/merge' && !entered) { entered = true; await gate; }
        return realFetch(...args);
    };
    testData.getJobs()[0]['Täitmise koht'] = 'first';
    testData.autoSave();
    await waitFor(() => entered);
    testData.getJobs()[0]['Täitmise koht'] = 'second';
    testData.autoSave();
    release();
    equal((await saved())[0]['Täitmise koht'], 'second');
    equal(testData.getJobs()[0]['Täitmise koht'], 'second');
}

export async function delayedPoll() {
    let release, entered = false;
    const gate = new Promise(resolve => { release = resolve; });
    await remoteEdit(base => base.map(j => ({ ...j, 'Tegevuse sisestaja nimi': 'Remote' })));
    window.fetch = async (...args) => {
        const response = await realFetch(...args);
        if (String(args[0]).startsWith('/api/poll') && !entered) { entered = true; await gate; }
        return response;
    };
    const poll = testData.pollChanges();
    await waitFor(() => entered);
    testData.getJobs()[0]['Täitmise koht'] = 'Local';
    testData.autoSave();
    await saved();
    release(); await poll;
    equal(testData.getJobs()[0]['Täitmise koht'], 'Local');
    equal(testData.getJobs()[0]['Tegevuse sisestaja nimi'], 'Remote');
}

export async function failedSaveRetry() {
    window.fetch = (...args) => args[0] === '/api/merge' ? Promise.reject(new Error('Simulated offline')) : realFetch(...args);
    testData.getJobs()[0]['Täitmise koht'] = 'Offline edit';
    testData.autoSave();
    await waitFor(() => document.getElementById('sync-indicator').classList.contains('is-error'));
    check(localStorage.getItem('jobsPendingChanges'), 'Pending work persisted');
    equal((await (await realFetch('/api/data')).json()).jobs[0]['Täitmise koht'], 'TOS');
    window.fetch = realFetch;
    await testData.retrySave();
    equal((await saved())[0]['Täitmise koht'], 'Offline edit');
    equal(localStorage.getItem('jobsPendingChanges'), null);
}

export async function prepareRecovery() {
    window.fetch = (...args) => args[0] === '/api/merge' ? Promise.reject(new Error('Simulated offline')) : realFetch(...args);
    testData.getJobs()[0]['Täitmise koht'] = 'Offline edit';
    testData.autoSave();
    await waitFor(() => document.getElementById('sync-indicator').classList.contains('is-error'));
    await remoteEdit(base => base.map(j => ({ ...j, 'Täitmise koht': 'Remote edit' })));
}

export async function recoveredConflict() {
    await waitFor(() => testData.getConflicts().length > 0 || !testData.hasUnsavedChanges());
    equal(testData.getConflicts().length, 1);
    equal(testData.getConflicts()[0].userValue, 'Offline edit');
    equal((await (await realFetch('/api/data')).json()).jobs[0]['Täitmise koht'], 'Remote edit');
}

export async function prepareConflict() {
    await remoteEdit(base => base.map(j => ({ ...j, 'Täitmise koht': 'Remote edit' })));
    testData.getJobs()[0]['Täitmise koht'] = 'Local edit';
    testData.autoSave();
    await waitFor(() => testData.getConflicts().length === 1);
    equal(testData.getConflicts()[0].currentValue, 'Remote edit');
}

export async function resolveShared() {
    document.getElementById('sync-indicator').click();
    [...document.querySelectorAll('#sync-popup-actions button')].find(b => b.textContent === 'Kasuta salvestatud').click();
    equal((await saved())[0]['Täitmise koht'], 'Remote edit');
    equal(testData.getJobs()[0]['Täitmise koht'], 'Remote edit');
}

export async function resolveMine() {
    document.getElementById('sync-indicator').click();
    [...document.querySelectorAll('#sync-popup-actions button')].find(b => b.textContent === 'Kasuta minu väärtust').click();
    equal((await saved())[0]['Täitmise koht'], 'Local edit');
}

export async function resolveComment() {
    const field = 'Kommentaar(tooriku/detaili seis, muu oluline info)';
    await remoteEdit(base => base.map(j => ({ ...j, [field]: 'Remote comment' })));
    testData.getJobs()[0][field] = 'Local comment'; testData.autoSave();
    await waitFor(() => testData.getConflicts().length === 1);
    document.getElementById('sync-indicator').click();
    [...document.querySelectorAll('#sync-popup-actions button')].find(b => b.textContent === 'Ühenda mõlemad').click();
    const input = document.getElementById('conflict-merge-value');
    equal(input.value, 'Remote comment\n\nLocal comment');
    input.value = 'Reviewed combined comment';
    document.getElementById('conflict-merge-save').click();
    equal((await saved())[0][field], 'Reviewed combined comment');
}

export async function acceptSharedDeletion() {
    await remoteEdit([]);
    testData.getJobs()[0]['Täitmise koht'] = 'Local edit'; testData.autoSave();
    await waitFor(() => testData.getConflicts().length === 1);
    testData.resolveConflict('a', '_deleted', 'shared');
    equal(testData.getJobs(), []);
    equal(await saved(), []);
}

export async function keepLocalDeletion() {
    await remoteEdit(base => base.map(j => ({ ...j, 'Täitmise koht': 'Remote edit' })));
    testData.deleteJob(0);
    await waitFor(() => testData.getConflicts().length === 1);
    testData.resolveConflict('a', '_deleted', 'mine');
    equal(await saved(), []);
    equal(testData.getJobs(), []);
}

export async function escapedContent() {
    const payload = '<img src=x onerror="window.injected=true">';
    testData.getJobs()[0]['Detaili/koostu nimetus või joonise Nr'] = payload;
    testData.getJobs()[0]['Valmis kpv'] = payload;
    document.getElementById('show-hidden-dates').checked = true;
    testUI.renderTableBody();
    equal(document.querySelectorAll('#table-body img').length, 0);
    equal(window.injected, undefined);
}

export async function conflictSurvivesOtherSave() {
    testData.getJobs()[0]['Tegevuse sisestaja nimi'] = 'Another edit';
    testData.autoSave();
    await waitFor(async () => (await (await realFetch('/api/data')).json()).jobs[0]['Tegevuse sisestaja nimi'] === 'Another edit');
    await new Promise(resolve => setTimeout(resolve, 50));
    equal(testData.getConflicts().length, 1);
    equal(testData.getJobs()[0]['Täitmise koht'], 'Local edit');
    const stored = JSON.parse(localStorage.getItem('jobsPendingChanges'));
    equal(stored.proposed[0]['Täitmise koht'], 'Local edit');
}

export async function conflictSurvivesReload() {
    await waitFor(() => testData.getConflicts().length === 1);
    equal(testData.getJobs()[0]['Täitmise koht'], 'Local edit');
    await waitFor(() => document.getElementById('sync-indicator').classList.contains('is-conflict'));
    await new Promise(resolve => setTimeout(resolve, 100));
    equal(testData.getJobs()[0]['Täitmise koht'], 'Local edit');
    equal((await (await realFetch('/api/data')).json()).jobs[0]['Täitmise koht'], 'Remote edit');
}

export async function retainLocalRow() {
    await remoteEdit([]);
    testData.getJobs()[0]['Täitmise koht'] = 'Restored edit'; testData.autoSave();
    await waitFor(() => testData.getConflicts().length === 1);
    testData.resolveConflict('a', '_deleted', 'mine');
    equal((await saved())[0]['Täitmise koht'], 'Restored edit');
}

export async function retainSharedRow() {
    await remoteEdit(base => base.map(j => ({ ...j, 'Täitmise koht': 'Remote edit' })));
    testData.deleteJob(0);
    await waitFor(() => testData.getConflicts().length === 1);
    testData.resolveConflict('a', '_deleted', 'shared');
    equal((await saved())[0]['Täitmise koht'], 'Remote edit');
    equal(testData.getJobs()[0]['Täitmise koht'], 'Remote edit');
}

export async function validateAddForm() {
    document.getElementById('btn-add-job').click();
    const form = document.getElementById('add-form');
    form.querySelector('[type=submit]').click();
    equal(testData.getJobs().length, 1);
    form.elements['Töö Nr'].value = 'DATES';
    const field = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
    form.elements[field].value = '31.02.2026';
    form.querySelector('[type=submit]').click();
    equal(testData.getJobs().length, 1);
    form.elements[field].value = '29.02.2024';
    form.querySelector('[type=submit]').click();
    equal((await saved())[1][field], '2024-02-29');
}

export async function sorting() {
    const column = 'EE kuupäev tarne';
    testData.setJobs([
        { _id: 'a', 'Töö Nr': 'A', [column]: '' },
        { _id: 'b', 'Töö Nr': 'B', [column]: '31.12.2025' },
        { _id: 'c', 'Töö Nr': 'C', [column]: '2026-01-01' },
    ]);
    testData.reorderJobs(column, 'asc');
    equal(testData.getJobs().map(j => j._id), ['b', 'c', 'a']);
    testData.reorderJobs(column, 'desc');
    equal(testData.getJobs().map(j => j._id), ['c', 'b', 'a']);
    testUI.renderTableBody();
    document.querySelector('.btn-delete').click();
    document.getElementById('confirm-ok').click();
    equal((await saved()).map(j => j._id).sort(), ['a', 'b']);
}
