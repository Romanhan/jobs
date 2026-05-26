import { loadData, loadFromFileLegacy, saveCSV, autoSave as doAutoSave, loadColumnWidths, saveColumnWidths, loadHiddenColumns, getJobs, pushUndo } from './data.js';
import { renderTable, renderTableBody, renderForm, updateStats, showStatus, filterTable, sortBy, startResize } from './ui.js';
import { openModal, closeModal, addJob, editCell, finishEditing, toggleField, handleKeydown, attachEventListeners } from './events.js';
import { closeCalendarPopup, setSelectDateCallback } from './calendar.js';

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
        if (e.target.tagName === 'SPAN') return;
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

function setUpForm() {
    const form = document.getElementById('add-form');
    form.addEventListener('submit', addJob);
}

async function init() {
    loadColumnWidths();
    loadHiddenColumns();
    
    const showHidden = localStorage.getItem('showHiddenDates');
    if (showHidden === 'true') {
        document.getElementById('show-hidden-dates').checked = true;
    }
    
    const dataResult = loadData();
    if (dataResult) {
        if (dataResult.status === 'fixed') {
            showStatus('Andmed parandatud! (' + dataResult.count + ' tööd)', 'success');
        } else if (dataResult.status === 'loaded') {
            showStatus('Andmed taastatud! (' + dataResult.count + ' tööd)', 'success');
        } else if (dataResult.status === 'error') {
            showStatus('Viga andmete laadimisel', 'error');
        }
        renderTable();
        renderForm();
        updateStats();
    } else {
        try {
            const result = await loadFromFileLegacy();
            if (result) {
                showStatus('Andmed laetud! (' + result.count + ' tööd)', 'success');
            } else {
                showStatus('Kasuta "Laadi" nupu andmete laadimiseks!', 'success');
            }
        } catch (e) {
            showStatus('Kasuta "Laadi" nupu andmete laadimiseks!', 'success');
        }
        renderTable();
        renderForm();
        updateStats();
    }
}

attachSortListener();
attachEventListeners();
setUpForm();
setUpButtons();

window.toggleField = toggleField;
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
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    
    document.getElementById('filter-nr').addEventListener('input', filterTable);
    document.getElementById('filter-koht').addEventListener('input', filterTable);
    document.getElementById('show-blank-koht').addEventListener('change', filterTable);
    document.getElementById('show-hidden-dates').addEventListener('change', function() {
        localStorage.setItem('showHiddenDates', this.checked);
        renderTable();
    });
    document.getElementById('show-completed').addEventListener('change', filterTable);
    document.getElementById('show-allhankes').addEventListener('change', filterTable);
}

init();