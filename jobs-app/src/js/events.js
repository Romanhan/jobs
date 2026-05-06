import { COLUMNS, DATE_COLS, CHECKBOX_COLS, FORM_FIELDS } from './config.js';
import { formatDate, parseDate, autoGrowTextarea } from './utils.js';
import { getJobs, autoSave as doAutoSave, addJob as doAddJob, getColumnWidths, saveColumnWidths, loadFromFile as doLoadFromFile, saveCSV as doSaveCSV } from './data.js';
import { renderTableBody, updateStats, showStatus, filterTable, renderForm, renderTable } from './ui.js';
import { openDateCalendarDirect, closeCalendarPopup, selectDateCalendarDirect } from './calendar.js';

let editingCell = null;

export function setEditingCell(cell) {
    editingCell = cell;
}

export function getEditingCell() {
    return editingCell;
}

export function editCell(td, index, col) {
    if (editingCell) finishEditing();
    const job = getJobs()[index];
    const value = job[col] || '';
    const isDate = DATE_COLS.includes(col);
    if (isDate) {
        return;
    }
    td.classList.add('editing');
    
    const input = document.createElement('textarea');
    input.style.width = '100%';
    input.value = value;
    
    input.addEventListener('blur', function() {
        saveEdited(input, index, col);
    });
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdited(input, index, col);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEditing();
        }
    });
    
    input.addEventListener('input', function() {
        autoGrowTextarea(input);
    });
    
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    editingCell = { td, index, col, isDate };
}

export function saveEdited(input, index, col) {
    let value = input.value;
    if (DATE_COLS.includes(col) && !/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
        value = parseDate(value);
    }
    const jobsArr = getJobs();
    jobsArr[index][col] = value;
    editingCell.td.innerHTML = DATE_COLS.includes(col) ? formatDate(value) : (value || '');
    editingCell.td.classList.remove('editing');
    editingCell = null;
    doAutoSave(jobsArr);
    renderTableBody();
    updateStats();
}

export function finishEditing() {
    if (!editingCell) return;
    const value = getJobs()[editingCell.index][editingCell.col] || '';
    editingCell.td.innerHTML = value;
    editingCell.td.classList.remove('editing');
    editingCell = null;
}

export function toggleField(index, col, value) {
    const today = new Date().toISOString().split('T')[0];
    const jobsArr = getJobs();
    if (col === 'Valmis') jobsArr[index]['Valmis kpv'] = value ? today : '';
    if (col === 'Alustatud') jobsArr[index]['Alustamise kpv'] = value ? today : '';
    jobsArr[index][col] = value;
    doAutoSave(jobsArr);
    renderTableBody();
    updateStats();
}

export function openModal() {
    const form = document.getElementById('add-form');
    form.querySelectorAll('input[type="text"]').forEach(i => i.value = '');
    
    document.querySelectorAll('.table-wrap table td, .table-wrap table th').forEach(cell => {
        if (cell.classList.contains('row-indicator')) return;
        cell.style.pointerEvents = 'none';
    });
    
    document.body.classList.add('modal-open');
    document.getElementById('modal').classList.add('active');
}

export function closeModal() {
    document.querySelectorAll('.table-wrap table td, .table-wrap table th').forEach(cell => {
        if (cell.classList.contains('row-indicator')) return;
        cell.style.pointerEvents = '';
    });
    
    document.body.classList.remove('modal-open');
    document.getElementById('modal').classList.remove('active');
}

export function addJob(e) {
    e.preventDefault();
    const form = document.getElementById('add-form');
    const job = {};
    COLUMNS.forEach(col => job[col] = '');
    
    FORM_FIELDS.forEach(f => {
        const col = f.col;
        const input = form.querySelector('[name="' + col + '"]');
        if (input && input.value) job[col] = input.value;
    });
    
    const today = new Date().toISOString().split('T')[0];
    job['Info sisestamise kuupäev'] = today;
    
    doAddJob(job);
    closeModal();
    renderTableBody();
    updateStats();
    showStatus('Töö lisatud!', 'success');
}

export function handleKeydown(e) {
    if (editingCell && e.ctrlKey && e.key === ';') {
        if (!editingCell.isDate) {
            const input = editingCell.td.querySelector('textarea');
            if (input) {
                const today = new Date();
                const dd = String(today.getDate()).padStart(2, '0');
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const yyyy = today.getFullYear();
                input.value = dd + '.' + mm + '.' + yyyy;
            }
        }
        e.preventDefault();
        return;
    }
    if (editingCell) {
        if (e.key === 'Escape') {
            closeCalendarPopup();
            finishEditing();
            e.preventDefault();
        }
    } else if (document.getElementById('modal').classList.contains('active')) {
        if (e.key === 'Escape') {
            closeModal();
            e.preventDefault();
        }
    } else {
        if (e.key === 'Escape') {
            closeCalendarPopup();
            e.preventDefault();
        } else if (e.key === ' ') {
            const active = document.activeElement;
            if (active && active.tagName === 'TD') {
                const checkbox = active.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                    e.preventDefault();
                }
            }
        }
    }
}

export function attachEventListeners() {
    document.querySelector('thead').addEventListener('click', function(e) {
        const th = e.target.closest('th');
        if (!th) return;
        const col = th.getAttribute('data-col');
        if (col) {
            const { sortBy } = import('./ui.js');
            sortBy.then(fn => fn(col));
        }
    });
    
    const tbody = document.getElementById('table-body');
    tbody.addEventListener('click', function(e) {
        const td = e.target.closest('td');
        if (!td) return;
        if (td.querySelector('input')) return;
        const colAttr = td.getAttribute('data-col');
        if (!colAttr) return;
        const index = parseInt(td.getAttribute('data-index'));
        const col = colAttr.replace(/\\'/g, "'");
        if (DATE_COLS.includes(col)) {
            e.stopPropagation();
            const colVal = td.getAttribute('data-col').replace(/\\'/g, "'");
            const value = getJobs()[index][colVal] || '';
            const colEscaped = colVal.replace(/'/g, "\\'");
            openDateCalendarDirect(td, index, colEscaped, value);
            return;
        }
        editCell(td, index, col);
    });
    
    document.addEventListener('keydown', handleKeydown);
    
    document.getElementById('add-form').addEventListener('submit', addJob);
}