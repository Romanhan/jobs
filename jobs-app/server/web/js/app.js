import { loadData, saveCSV, autoSave as doAutoSave, loadColumnWidths, saveColumnWidths, loadHiddenColumns, getJobs, getColumnWidths, pushUndo, pollChanges, autoCalculateColumnWidths, reorderJobs, setSortingState, getSortingState, getConflicts, retrySave, resolveConflict, hasUnsavedChanges } from './data.js';
import { COLUMNS } from './config.js';
import { renderTable, renderTableBody, renderForm, updateStats, showStatus, filterTable, sortBy, startResize, setStatusFilter, getStatusFilter, updateStickyPositions } from './ui.js';
import { openModal, closeModal, addJob, editCell, finishEditing, toggleField, handleKeydown, attachEventListeners } from './events.js';
import { closeCalendarPopup, setSelectDateCallback } from './calendar.js';

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('btn-theme').innerHTML = '<span class="icon-sun">&#9728;</span>';
    } else {
        document.documentElement.removeAttribute('data-theme');
        document.getElementById('btn-theme').innerHTML = '<span class="icon-moon">&#9790;</span>';
    }
    localStorage.setItem('theme', theme);
}

function setRowFontSize(size) {
    document.documentElement.setAttribute('data-row-font-size', size);
    localStorage.setItem('fontSize', size);
    document.getElementById('font-size-display').textContent = size + ' px';
    document.getElementById('font-size-slider').value = size;
    updateStickyPositions();
}

let syncState = { state: 'checking' };
let mergingConflict = null;
const MERGEABLE_CONFLICT_FIELDS = new Set([
    'Kommentaar(tooriku/detaili seis, muu oluline info)'
]);

function addSyncAction(container, label, handler, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'btn-primary' : 'btn-secondary';
    button.textContent = label;
    button.addEventListener('click', handler);
    container.appendChild(button);
}

function closeConflictMerge() {
    const popup = document.getElementById('conflict-merge-popup');
    if (popup) popup.style.display = 'none';
    mergingConflict = null;
}

function openConflictMerge(conflict) {
    const popup = document.getElementById('conflict-merge-popup');
    const textarea = document.getElementById('conflict-merge-value');
    const jobLabel = document.getElementById('conflict-merge-job');
    if (!popup || !textarea || !jobLabel) return;
    const job = getJobs().find(item => item._id === conflict.jobId);
    jobLabel.textContent = 'Töö: ' + (job?.['Töö Nr'] || '');
    const shared = String(conflict.currentValue ?? '');
    const mine = String(conflict.userValue ?? '');
    textarea.value = shared === mine ? shared : [shared, mine].filter(Boolean).join('\n\n');
    mergingConflict = conflict;
    document.getElementById('sync-popup').style.display = 'none';
    document.getElementById('sync-indicator')?.setAttribute('aria-expanded', 'false');
    popup.style.display = 'flex';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function renderSyncPopup() {
    const message = document.getElementById('sync-popup-message');
    const details = document.getElementById('sync-popup-details');
    const actions = document.getElementById('sync-popup-actions');
    if (!message || !details || !actions) return;
    actions.replaceChildren();
    details.textContent = '';
    if (syncState.state === 'ok') {
        message.textContent = 'Kõik muudatused on salvestatud';
        details.textContent = syncState.savedAt ? 'Viimane salvestus: ' + new Date(syncState.savedAt).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }) : 'Server ja andmefail on saadaval';
    } else if (syncState.state === 'saving') {
        message.textContent = 'Salvestan muudatusi…';
        details.textContent = 'Palun oodake, kuni ühisketas vastab.';
    } else if (syncState.state === 'conflict') {
        const conflict = getConflicts()[0];
        message.textContent = 'Muudatuste konflikt';
        if (!conflict) return;
        const job = getJobs().find(item => item._id === conflict.jobId);
        const jobNumber = job?.['Töö Nr'] || conflict.currentValue?.['Töö Nr'] || '';
        details.textContent = conflict.field === '_deleted'
            ? `Töö ${jobNumber} muudeti või kustutati teise kasutaja poolt.`
            : `Töö: ${jobNumber}\nVäli: ${conflict.field}\n\nSalvestatud info:\n${String(conflict.currentValue ?? '')}\n\nTeie muudatus:\n${String(conflict.userValue ?? '')}`;
        addSyncAction(actions, 'Kasuta salvestatud', () => resolveConflict(conflict.jobId, conflict.field, 'shared'));
        if (MERGEABLE_CONFLICT_FIELDS.has(conflict.field) && typeof conflict.currentValue === 'string' && typeof conflict.userValue === 'string') {
            addSyncAction(actions, 'Ühenda mõlemad', () => openConflictMerge(conflict));
        }
        addSyncAction(actions, 'Kasuta minu väärtust', () => resolveConflict(conflict.jobId, conflict.field, 'mine'), true);
    } else if (syncState.state === 'error') {
        message.textContent = 'Salvestamine ebaõnnestus';
        details.textContent = syncState.message || 'Server või K: ketas ei ole saadaval. Muudatused hoitakse selles arvutis.';
        addSyncAction(actions, 'Proovi uuesti', retrySave, true);
    } else {
        message.textContent = 'Kontrollin ühendust…';
    }
}

function setSyncState(detail) {
    syncState = { ...syncState, ...detail };
    const indicator = document.getElementById('sync-indicator');
    if (!indicator) return;
    indicator.className = 'sync-indicator is-' + syncState.state;
    const labels = { ok: 'Kõik muudatused salvestatud', saving: 'Salvestan muudatusi', error: 'Salvestamine ebaõnnestus', conflict: 'Muudatuste konflikt', checking: 'Kontrollin ühendust' };
    indicator.setAttribute('aria-label', labels[syncState.state] || labels.checking);
    indicator.setAttribute('data-tooltip', labels[syncState.state] || labels.checking);
    indicator.removeAttribute('title');
    renderSyncPopup();
}

function setupSyncIndicator() {
    const indicator = document.getElementById('sync-indicator');
    const popup = document.getElementById('sync-popup');
    indicator?.addEventListener('click', event => {
        event.stopPropagation();
        indicator.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        const open = popup.style.display === 'block';
        popup.style.display = open ? 'none' : 'block';
        indicator.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (!open) renderSyncPopup();
    });
    popup?.addEventListener('click', event => event.stopPropagation());
    document.getElementById('conflict-merge-cancel')?.addEventListener('click', closeConflictMerge);
    document.getElementById('conflict-merge-save')?.addEventListener('click', () => {
        if (!mergingConflict) return;
        const value = document.getElementById('conflict-merge-value').value;
        const { jobId, field } = mergingConflict;
        closeConflictMerge();
        resolveConflict(jobId, field, 'merged', value);
    });
    document.addEventListener('click', () => {
        if (popup) popup.style.display = 'none';
        indicator?.setAttribute('aria-expanded', 'false');
    });
    window.addEventListener('jobs-sync', event => setSyncState(event.detail));
    window.addEventListener('jobs-data-updated', () => {
        renderTableBody();
        updateStats();
        renderSyncPopup();
        const addButton = document.getElementById('btn-add-job');
        if (addButton) addButton.disabled = false;
    });
    window.addEventListener('beforeunload', event => {
        if (!hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = '';
    });
}

setSelectDateCallback((rowIndex, colName, dateStr) => {
    const jobs = getJobs();
    pushUndo();
    if (rowIndex >= 0 && rowIndex < jobs.length) {
        jobs[rowIndex][colName] = dateStr;
    }
    doAutoSave();
    renderTableBody();
    updateStats();
});

function attachSortListener() {
    document.querySelector('thead').addEventListener('click', function(e) {
        if (e.target.classList.contains('resize-handle')) return;
        const th = e.target.closest('th');
        if (!th) return;
        const col = th.getAttribute('data-col');

        if (window._isResizing) {
            window._isResizing = false;
            return;
        }

        if (col) sortBy(col);
    });

}

async function init() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        setTheme('dark');
    }

    loadColumnWidths();
    loadHiddenColumns();

    const showHidden = localStorage.getItem('showHiddenDates');
    if (showHidden === 'true') {
        document.getElementById('show-hidden-dates').checked = true;
    }

    if (localStorage.getItem('showRowColors') === null) {
        localStorage.setItem('showRowColors', 'true');
    }
    const showRowColors = localStorage.getItem('showRowColors') !== 'false';
    document.getElementById('menu-row-colors').innerHTML = showRowColors ? 'Color rows <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--color-primary);vertical-align:middle;margin-left:6px"></span>' : 'Color rows';

    const savedFontSize = localStorage.getItem('fontSize') || '12';
    setRowFontSize(savedFontSize);
    autoCalculateColumnWidths(COLUMNS);
    saveColumnWidths();

    // First render — show UI shell immediately, populate after data loads
    const btnAddJob = document.getElementById('btn-add-job');
    const btnMenu = document.getElementById('btn-menu');
    if (btnAddJob) btnAddJob.disabled = true;
    if (btnMenu) btnMenu.disabled = true;

    renderForm();
    renderTable(true);

    const dataResult = await loadData();
    if (btnMenu) btnMenu.disabled = false;
    if (dataResult && dataResult.status === 'loaded') {
        if (btnAddJob) btnAddJob.disabled = false;
        setSyncState({ state: 'ok' });
        showStatus('Andmed laetud! (' + dataResult.count + ' tööd)', 'success');
    } else {
        setSyncState({ state: 'error', message: 'Serveriga puudub ühendus' });
        showStatus('Serveriga ühendamine ebaõnnestus', 'error');
    }

    document.getElementById('jobs-table').style.setProperty('table-layout', 'fixed', 'important');

    // Re-render with actual data
    renderTableBody();
    updateStats();

    const tabId = window.crypto?.randomUUID?.() ?? Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    fetch('/api/enter?tabId=' + tabId, { method: 'POST', keepalive: true }).catch(() => {});

    let lastKeepAlive = Date.now();
    setInterval(async () => {
        if (document.querySelector('.floating-editor')) {
            const now = Date.now();
            if (now - lastKeepAlive > 60000) {
                lastKeepAlive = now;
                fetch('/api/enter?tabId=' + tabId, { method: 'POST', keepalive: true }).catch(() => {});
            }
            return;
        }
        try {
            const changed = await pollChanges(tabId);
            if (changed) {
                const { sortColumn, sortDirection } = getSortingState();
                if (sortColumn && sortDirection) {
                    reorderJobs(sortColumn, sortDirection, false);
                }
                renderTableBody();
                updateStats();
            }
        } catch {}
    }, 2000);

    window.addEventListener('pagehide', () => {
        if (typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon('/api/exit?tabId=' + tabId);
        }
    });

}

attachSortListener();
attachEventListeners();
setupSyncIndicator();
setUpButtons();

window.toggleField = toggleField;
window.setRowFontSize = setRowFontSize;
window.openModal = openModal;
window.closeModal = closeModal;
window.renderTableBody = renderTableBody;
window.updateStats = updateStats;
window.showStatus = showStatus;
window.filterTable = filterTable;
window.saveCSV = saveCSV;
window.startResize = startResize;

function setUpButtons() {
    document.getElementById('btn-add-job').addEventListener('click', openModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);

    document.getElementById('btn-theme').addEventListener('click', function() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        setTheme(isDark ? 'light' : 'dark');
    });

    document.getElementById('filter-nr').addEventListener('input', filterTable);
    const filterKoht = document.getElementById('filter-koht');
    const btnTos = document.getElementById('btn-filter-tos');
    const btnKarusell = document.getElementById('btn-filter-karusel');

    if (filterKoht) {
        filterKoht.addEventListener('input', () => {
            const val = filterKoht.value.trim().toLowerCase();
            const isTos = val === 'tos';
            const isKarusell = val === 'karusel';

            btnTos?.classList.toggle('active', isTos);
            btnTos?.setAttribute('aria-pressed', isTos ? 'true' : 'false');
            btnKarusell?.classList.toggle('active', isKarusell);
            btnKarusell?.setAttribute('aria-pressed', isKarusell ? 'true' : 'false');
            filterTable();
        });
    }
    document.getElementById('show-blank-koht')?.addEventListener('change', filterTable);

    function setupLocationFilter(btn, otherBtn, value) {
        if (!btn || !filterKoht) return;
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
                filterKoht.value = '';
            } else {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                if (otherBtn) {
                    otherBtn.classList.remove('active');
                    otherBtn.setAttribute('aria-pressed', 'false');
                }
                filterKoht.value = value;
            }
            filterTable();
        });
    }

    setupLocationFilter(btnTos, btnKarusell, 'TOS');
    setupLocationFilter(btnKarusell, btnTos, 'Karusel');
    document.getElementById('show-hidden-dates').addEventListener('change', function() {
        localStorage.setItem('showHiddenDates', this.checked);
        renderTable();
    });
    document.getElementById('show-completed').addEventListener('change', filterTable);
    document.getElementById('show-allhankes').addEventListener('change', filterTable);

    document.querySelector('.status-boxes').addEventListener('click', function(e) {
        const box = e.target.closest('.status-box');
        if (!box) return;
        const filter = box.getAttribute('data-filter');
        if (filter === 'all') {
            setStatusFilter(null);
            document.querySelectorAll('.status-box.filter-active').forEach(el => el.classList.remove('filter-active'));
            const el = document.getElementById('filter-nr');
            if (el) el.value = '';
            const el2 = document.getElementById('filter-koht');
            if (el2) el2.value = '';
            document.querySelectorAll('.btn-filter-location.active').forEach(el3 => {
                el3.classList.remove('active');
                el3.setAttribute('aria-pressed', 'false');
            });
            const el4 = document.getElementById('show-hidden-dates');
            if (el4) el4.checked = false;
            const el5 = document.getElementById('show-completed');
            if (el5) el5.checked = false;
            const el6 = document.getElementById('show-allhankes');
            if (el6) el6.checked = false;
            const elBlank = document.getElementById('show-blank-koht');
            if (elBlank) elBlank.checked = false;
            localStorage.setItem('showHiddenDates', 'false');
            renderTable();
            updateStats();
            return;
        }
        if (getStatusFilter() === filter) {
            setStatusFilter(null);
            box.classList.remove('filter-active');
        } else {
            document.querySelectorAll('.status-box.filter-active').forEach(el => el.classList.remove('filter-active'));
            setStatusFilter(filter);
            box.classList.add('filter-active');
        }
    });
}

init();
