export async function filtersAndCounters() {
    const deadline = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
    testData.setJobs([
        { _id: 'a', 'Töö Nr': 'A', 'Täitmise koht': 'TOS', Alustatud: true },
        { _id: 'b', 'Töö Nr': 'B', 'Täitmise koht': 'Karusel', 'Töötlus allhankes': true },
        { _id: 'c', 'Töö Nr': 'C', 'Täitmise koht': '', [deadline]: '2000-01-01' },
        { _id: 'd', 'Töö Nr': 'D', 'Täitmise koht': 'TOS', Valmis: true },
    ]);
    testUI.renderTable(); testUI.updateStats();
    const count = () => document.querySelectorAll('#table-body tr').length;
    for (const [id, n] of Object.entries({ active: 3, 'in-progress': 1, allhanke: 1, overdue: 1, completed: 1 })) equal(document.getElementById('count-' + id).textContent, String(n));
    equal(count(), 2);
    document.getElementById('show-allhankes').click(); equal(count(), 3);
    document.getElementById('btn-filter-tos').click(); equal(count(), 1);
    document.getElementById('show-blank-koht').click(); equal(count(), 2);
    document.getElementById('btn-filter-karusel').click(); equal(count(), 2);
    const input = document.getElementById('filter-nr'); input.value = 'B'; input.dispatchEvent(new Event('input')); equal(count(), 1);
    document.querySelector('[data-filter="all"]').click(); equal(count(), 2);
    equal(document.getElementById('filter-koht').value, '');
    for (const status of ['in-progress', 'allhanke', 'overdue', 'completed']) {
        document.querySelector(`[data-filter="${status}"]`).click(); equal(count(), 1);
    }
    document.querySelector('[data-filter="all"]').click();
    document.getElementById('show-completed').click(); equal(count(), 3);
}

export async function calendarControls() {
    document.getElementById('btn-add-job').click();
    const form = document.getElementById('add-form');
    const field = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
    const input = form.elements[field]; input.value = '31.12.2025';
    input.parentElement.querySelector('button').click();
    equal(document.querySelector('.calendar-month-year').textContent, 'Detsember 2025');
    document.querySelector('[data-action="next-month"]').click();
    equal(document.querySelector('.calendar-month-year').textContent, 'Jaanuar 2026');
    document.querySelector('[data-action="prev-month"]').click();
    document.querySelector('[data-date="25.12.2025"]').click();
    equal(input.value, '25.12.2025'); equal(document.getElementById('calendar-popup'), null);
    input.value = '01.02.2024'; input.parentElement.querySelector('button').click();
    document.querySelector('[data-date="29.02.2024"]').click(); equal(input.value, '29.02.2024');
    document.getElementById('btn-cancel').click();
    equal(testData.getJobs().length, 1);
    document.querySelector('td[data-col="EE kuupäev tarne"]').click();
    document.querySelector('.calendar-edit-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.querySelector('[data-action="today"]').click();
    const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    equal((await saved())[0]['EE kuupäev tarne'], iso);
    equal(document.getElementById('calendar-popup'), null);
}

export async function keyboardAndCancel() {
    const field = 'Täitmise koht';
    const cell = document.querySelector(`td[data-col="${field}"]`);
    cell.focus(); cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    let input = document.querySelector('.floating-editor textarea'); check(input, 'Enter opens cell');
    input.value = 'discard'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    equal(testData.getJobs()[0][field], 'TOS');
    cell.click(); input = document.querySelector('.floating-editor textarea');
    input.value = 'bold'; input.setSelectionRange(0,4);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); equal(input.value, '**bold**');
    input.value += '\nsecond line';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    equal((await saved())[0][field], '**bold**\nsecond line');
    document.querySelector('.btn-delete').click(); document.getElementById('confirm-cancel').click(); equal((await saved()).length, 1);
    document.getElementById('btn-add-job').click();
    const number = document.getElementById('add-form').elements['Töö Nr']; number.focus();
    number.dispatchEvent(new KeyboardEvent('keydown', { key: ';', ctrlKey: true, bubbles: true }));
    check(/^\d{2}\.\d{2}\.\d{4}$/.test(number.value), 'Date shortcut inserts today');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(!document.getElementById('modal').classList.contains('active'), 'Escape closes modal');
}

export async function menusAndPreferences() {
    const menu = action => { document.getElementById('btn-menu').click(); document.querySelector(`[data-action="${action}"]`).click(); };
    menu('info');
    const version = await import('/js/version.js');
    check(document.getElementById('info-grid').textContent.includes(version.APP_VERSION), 'Version shown');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    equal(document.getElementById('info-popup').style.display, 'none');
    menu('shortcuts'); check(document.getElementById('shortcuts-popup').style.display !== 'none', 'Shortcuts open');
    document.body.click(); equal(document.getElementById('shortcuts-popup').style.display, 'none');
    menu('font-size'); const slider = document.getElementById('font-size-slider'); slider.value = '16'; slider.dispatchEvent(new Event('input'));
    equal(localStorage.getItem('fontSize'), '16'); document.body.click();
    menu('row-colors'); equal(localStorage.getItem('showRowColors'), 'false');
    document.getElementById('btn-theme').click();
    document.getElementById('show-hidden-dates').click();
    const header = document.querySelector('th[data-col="Töö Nr"]');
    const width = header.offsetWidth;
    header.querySelector('.resize-handle').dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    equal(testData.getColumnWidths()['Töö Nr'], width + 50);
}

export async function preferencesRestored() {
    equal(document.documentElement.getAttribute('data-theme'), 'dark');
    equal(localStorage.getItem('fontSize'), '16');
    equal(getComputedStyle(document.documentElement).getPropertyValue('--font-row-size').trim(), '16px');
    equal(document.getElementById('show-hidden-dates').checked, true);
    equal(localStorage.getItem('showRowColors'), 'false');
    check(testData.getColumnWidths()['Töö Nr'] > 100, 'Column width restored');
}

export async function lostResponse() {
    let first = true;
    window.fetch = async (...args) => {
        const response = await realFetch(...args);
        if (args[0] === '/api/merge' && first) { first = false; throw new Error('Response lost after server saved'); }
        return response;
    };
    testData.addJob({ 'Töö Nr': 'NEW', 'Täitmise koht': 'TOS' });
    await waitFor(() => document.getElementById('sync-indicator').classList.contains('is-error'));
    await testData.retrySave();
    const rows = await saved(); equal(rows.length, 2); equal(testData.getConflicts(), []);
}

export async function multipleConflicts() {
    await remoteEdit(base => base.map(j => ({ ...j, 'Täitmise koht': 'remote', 'Tegevuse sisestaja nimi': 'Remote author' })));
    Object.assign(testData.getJobs()[0], { 'Täitmise koht': 'local', 'Tegevuse sisestaja nimi': 'Local author' }); testData.autoSave();
    await waitFor(() => testData.getConflicts().length === 2);
    testData.resolveConflict('a', 'Täitmise koht', 'shared');
    equal(testData.getConflicts().length, 1);
    testData.resolveConflict('a', 'Tegevuse sisestaja nimi', 'mine');
    const rows = await saved(); equal(rows[0]['Täitmise koht'], 'remote'); equal(rows[0]['Tegevuse sisestaja nimi'], 'Local author');
}

export async function storageUnavailable() {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'jobsPendingChanges') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return original.call(this, key, value); };
    try {
        testData.getJobs()[0]['Täitmise koht'] = 'Saved despite quota';
        await testData.autoSave();
        equal((await saved())[0]['Täitmise koht'], 'Saved despite quota');
    } finally { Storage.prototype.setItem = original; }
}

export async function editingDuringPoll() {
    let release, entered = false;
    const gate = new Promise(resolve => { release = resolve; });
    await remoteEdit(base => base.map(j => ({ ...j, 'Täitmise koht': 'Remote' })));
    window.fetch = async (...args) => {
        const response = await realFetch(...args);
        if (String(args[0]).startsWith('/api/poll') && !entered) { entered = true; await gate; }
        return response;
    };
    // Same guard used by the app's periodic poll.
    const poll = testData.pollChanges(undefined, () => !document.querySelector('.floating-editor'));
    await waitFor(() => entered);
    document.querySelector('td[data-col="Täitmise koht"]').click();
    const input = document.querySelector('.floating-editor textarea'); input.value = 'Edited original';
    release(); await poll;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => testData.getConflicts().length > 0 || !testData.hasUnsavedChanges());
    equal(testData.getConflicts().length, 1);
    equal(testData.getConflicts()[0].userValue, 'Edited original');
    equal((await (await realFetch('/api/data')).json()).jobs[0]['Täitmise koht'], 'Remote');
}

export async function csvCompatibility() {
    const file = new File(['Täitmise koht;Töö Nr;Valmis\r\nKarusel;REORDERED;JAH\r\n'], 'reordered.csv');
    equal((await testData.loadFromFile(file)).added, 1);
    const row = testData.getJobs().find(j => j['Töö Nr'] === 'REORDERED'); equal(row['Täitmise koht'], 'Karusel'); equal(row.Valmis, true);
    // Whole-file Windows-1252 encoding, including header characters.
    const text = 'Töö Nr;Täitmise koht\nLEGACY;Õie';
    const legacy = new Uint8Array([...text].map(c => c.charCodeAt(0)));
    equal((await testData.loadFromFile(new File([legacy], 'legacy.csv'))).added, 1);
    equal(testData.getJobs().find(j => j['Töö Nr'] === 'LEGACY')['Täitmise koht'], 'Õie');
    let failed = false;
    try { await testData.loadFromFile(new File([], 'empty.csv')); } catch { failed = true; }
    check(failed, 'Empty CSV rejected');
    await saved();
}

export async function headerSortingAndScale() {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ _id: String(i), 'Töö Nr': String(1000-i).padStart(4,'0'), 'Täitmise koht': i % 2 ? 'TOS' : 'Karusel' }));
    testData.setJobs(rows); testUI.renderTable(); testUI.updateStats();
    equal(document.querySelectorAll('#table-body tr').length, 1000);
    document.querySelector('th[data-col="Töö Nr"] .header-label').click();
    equal(testData.getJobs()[0]['Töö Nr'], '0001');
    document.querySelector('th[data-col="Töö Nr"] .header-label').click();
    equal(testData.getJobs()[0]['Töö Nr'], '1000');
    document.getElementById('btn-filter-tos').click(); equal(document.querySelectorAll('#table-body tr').length, 500);
}

export async function startupRetry() {
    check(document.getElementById('btn-add-job').disabled, 'Adding disabled after failed initial load');
    window.startupOffline = false;
    document.getElementById('sync-indicator').click();
    [...document.querySelectorAll('#sync-popup-actions button')].find(b => b.textContent === 'Proovi uuesti').click();
    await waitFor(() => !document.getElementById('btn-add-job').disabled);
    equal(document.querySelectorAll('#table-body tr').length, 1);
    equal(testData.getJobs()[0]['Töö Nr'], 'A');
}

export async function startupAutomaticRecovery() {
    check(document.getElementById('btn-add-job').disabled, 'Adding disabled after failed initial load');
    // A successful poll endpoint must not bypass the failed full load.
    await testData.pollChanges('startup-test');
    check(document.getElementById('btn-add-job').disabled, 'Adding stays disabled while full load fails');
    equal(testData.getJobs().length, 0);
    window.startupOffline = false;
    await waitFor(() => !document.getElementById('btn-add-job').disabled);
    equal(testData.getJobs()[0]['Töö Nr'], 'A');
    document.getElementById('btn-add-job').click();
    const form = document.getElementById('add-form');
    form.elements['Töö Nr'].value = 'RECOVERED';
    form.querySelector('[type=submit]').click();
    const rows = await saved();
    equal(rows.map(j => j['Töö Nr']), ['A', 'RECOVERED']);
    equal(rows[1]['Meeldetuletus X päeva ennem'], '7');
}
