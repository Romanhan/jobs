import { loadData, saveCSV, autoSave as doAutoSave, loadColumnWidths, saveColumnWidths, loadHiddenColumns, getJobs, getColumnWidths, pushUndo, pollChanges, autoCalculateColumnWidths, reorderJobs, setSortingState, getSortingState } from './data.js';
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
    renderForm();
    renderTable(true);

    const dataResult = await loadData();
    if (dataResult && dataResult.status === 'loaded') {
        showStatus('Andmed laetud! (' + dataResult.count + ' tööd)', 'success');
    } else {
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
