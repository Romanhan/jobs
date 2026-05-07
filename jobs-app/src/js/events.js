import { COLUMNS, DATE_COLS, CHECKBOX_COLS, FORM_FIELDS } from './config.js';
import { formatDate, parseDate, autoGrowTextarea } from './utils.js';
import { getJobs, autoSave as doAutoSave, addJob as doAddJob, getColumnWidths, saveColumnWidths, loadFromFile as doLoadFromFile, saveCSV as doSaveCSV } from './data.js';
import { renderTableBody, updateStats, showStatus, filterTable, renderForm, renderTable } from './ui.js';
import { openDateCalendarDirect, closeCalendarPopup, selectDateCalendarDirect, setOnDateSelectedInEdit } from './calendar.js';

let editingCell = null;

export function setEditingCell(cell) {
    editingCell = cell;
}

export function getEditingCell() {
    return editingCell;
}

setOnDateSelectedInEdit((textarea, dateStr) => {
    const cell = editingCell;
    if (!cell) return;
    
    const jobsArr = getJobs();
    jobsArr[cell.index][cell.col] = dateStr;
    
    const floatingEditor = document.querySelector('.floating-editor');
    if (floatingEditor) floatingEditor.remove();
    cell.td.style.visibility = '';
    cell.td.classList.remove('editing');
    editingCell = null;
    
    doAutoSave(jobsArr);
    renderTableBody();
    updateStats();
});

export function editCell(td, index, col) {
    if (editingCell) finishEditing();
    const job = getJobs()[index];
    const value = job[col] || '';
    const isDate = DATE_COLS.includes(col);
    const textToMeasure = isDate ? formatDate(value) : value;
    
    const rect = td.getBoundingClientRect();
    const maxPopupWidth = 400;
    
    const floatingEditor = document.createElement('div');
    floatingEditor.className = 'floating-editor' + (isDate ? ' date-editor' : '');
    floatingEditor.style.position = 'fixed';
    floatingEditor.style.top = rect.top + 'px';
    floatingEditor.style.left = rect.left + 'px';
    floatingEditor.style.width = 'auto';
    floatingEditor.style.zIndex = '1000';
    
    const input = document.createElement('textarea');
    input.rows = 1;
    floatingEditor.appendChild(input);
    document.body.appendChild(floatingEditor);
    
    input.value = textToMeasure;
    
    requestAnimationFrame(() => {
        const measureDiv = document.createElement('div');
        measureDiv.style.position = 'absolute';
        measureDiv.style.visibility = 'hidden';
        measureDiv.style.whiteSpace = 'nowrap';
        measureDiv.style.fontSize = '12px';
        measureDiv.style.fontFamily = window.getComputedStyle(td).fontFamily;
        measureDiv.style.padding = '2px';
        measureDiv.textContent = textToMeasure;
        document.body.appendChild(measureDiv);
        
        let textWidth = measureDiv.scrollWidth;
        document.body.removeChild(measureDiv);
        
        let popupWidth;
        if (textWidth + 8 <= rect.width) {
            popupWidth = rect.width;
        } else {
            popupWidth = Math.min(textWidth + 8, maxPopupWidth);
        }
        if (isDate) {
            popupWidth += 18;
        }
        floatingEditor.style.width = popupWidth + 'px';
        if (isDate) {
            input.style.width = textWidth + 'px';
        }
        if (isDate) {
            input.style.whiteSpace = 'nowrap';
            input.style.flex = 'none';
        } else {
            input.style.whiteSpace = 'pre-wrap';
        }
        autoGrowTextarea(input);
    });
    
    if (isDate) {
        const calBtn = document.createElement('button');
        calBtn.className = 'calendar-edit-btn';
        calBtn.innerHTML = '📅';
        calBtn.onmousedown = function(e) {
            e.preventDefault();
            e.stopPropagation();
            openDateCalendarDirect(td, index, col.replace(/'/g, "\\'"), input.value);
        };
        floatingEditor.appendChild(calBtn);
    }
    
    input.addEventListener('blur', function() {
        setTimeout(() => {
            if (document.getElementById('calendar-popup')) return;
            saveEdited(input, index, col);
        }, 10);
    });
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
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
    
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    editingCell = { td, index, col, isDate };
    td.style.visibility = 'hidden';
    td.classList.add('editing');
}

export function saveEdited(input, index, col) {
    let value = input.value;
    if (DATE_COLS.includes(col) && !/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
        value = parseDate(value);
    }
    const jobsArr = getJobs();
    jobsArr[index][col] = value;

    const floatingEditor = document.querySelector('.floating-editor');
    if (floatingEditor) floatingEditor.remove();
    if (editingCell) {
        editingCell.td.style.visibility = '';
        editingCell.td.classList.remove('editing');
        editingCell = null;
    }

    doAutoSave(jobsArr);
    renderTableBody();
    updateStats();
}

export function finishEditing() {
    if (!editingCell) return;
    const floatingEditor = document.querySelector('.floating-editor');
    if (floatingEditor) floatingEditor.remove();
    if (editingCell.td) {
        editingCell.td.style.visibility = '';
        editingCell.td.classList.remove('editing');
    }
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
        editCell(td, index, col);
    });
    
    document.addEventListener('keydown', handleKeydown);
    
    document.getElementById('add-form').addEventListener('submit', addJob);
}