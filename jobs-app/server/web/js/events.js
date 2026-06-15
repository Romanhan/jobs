import { COLUMNS, DATE_COLS, CHECKBOX_COLS, FORM_FIELDS } from './config.js';
import { APP_VERSION, APP_NAME, APP_AUTHOR } from './version.js';
import { formatDate, parseDate, autoGrowTextarea, wrapSelection } from './utils.js';
import { getJobs, autoSave as doAutoSave, addJob as doAddJob, deleteJob as doDeleteJob, getColumnWidths, saveColumnWidths, loadFromFile as doLoadFromFile, saveCSV as doSaveCSV, pushUndo, undo } from './data.js';
import { renderTableBody, updateStats, showStatus, filterTable, renderForm, renderTable, clearSort } from './ui.js';
import { openDateCalendarDirect, closeCalendarPopup, selectDateCalendarDirect, setOnDateSelectedInEdit, setEditingCellState } from './calendar.js';

let editingCell = null;
let tooltipEl = null;
let tooltipTimeout = null;
let activeDeleteKeydownHandler = null;

function hideTooltip() {
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
    }
    if (tooltipEl) tooltipEl.classList.remove('visible');
}

export function setEditingCell(cell) {
    editingCell = cell;
}

export function getEditingCell() {
    return editingCell;
}

setOnDateSelectedInEdit((textarea, dateStr) => {
    const cell = editingCell;
    if (!cell) return;
    
    pushUndo();
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
    hideTooltip();

    if (editingCell) {
        const activeInput = document.querySelector('.floating-editor textarea');
        if (activeInput) {
            saveEdited(activeInput, editingCell.index, editingCell.col);
        } else {
            finishEditing();
        }
        const colEscaped = col.replace(/'/g, "\\'");
        td = document.querySelector(`#table-body tr[data-index="${index}"] td[data-col="${colEscaped}"]`);
        if (!td) return;
    }
    const job = getJobs()[index];
    const value = job[col] || '';
    const isDate = DATE_COLS.includes(col) || col === 'Tooriku saabumise kuupäev EE';
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
        measureDiv.style.fontSize = getComputedStyle(document.documentElement).getPropertyValue('--font-row-size');
        measureDiv.style.fontFamily = window.getComputedStyle(td).fontFamily;
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
            popupWidth = Math.max(popupWidth, Math.max(textWidth, 60) + 8 + 2 + 22 + 8);
        }
        floatingEditor.style.width = popupWidth + 'px';
        if (isDate) {
            input.style.width = (Math.max(textWidth, 60) + 8) + 'px';
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
        calBtn.type = 'button';
        calBtn.onmousedown = function(e) {
            e.preventDefault();
            e.stopPropagation();
            openDateCalendarDirect(td, index, col, input.value, calBtn);
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
        } else if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            wrapSelection(input, '**');
            autoGrowTextarea(input);
        } else if (e.ctrlKey && e.key === 'i') {
            e.preventDefault();
            wrapSelection(input, '!!');
            autoGrowTextarea(input);
        } else if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            wrapSelection(input, '~~');
            autoGrowTextarea(input);
        }
    });
    
    input.addEventListener('input', function() {
        autoGrowTextarea(input);
    });
    
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    editingCell = { td, index, col, isDate };
    const onCalendarClose = isDate
        ? () => saveEdited(input, index, col)
        : finishEditing;
    setEditingCellState(() => editingCell, onCalendarClose);
    td.style.visibility = 'hidden';
    td.classList.add('editing');
}

export function saveEdited(input, index, col) {
    if (!editingCell || editingCell.index !== index || editingCell.col !== col) return;
    pushUndo();
    let value = input.value;
    if (DATE_COLS.includes(col) && value) {
        if (/^\d{1,2}\.\d{1,2}$/.test(value)) {
            const [d, m] = value.split('.');
            value = d.padStart(2, '0') + '.' + m.padStart(2, '0') + '.' + new Date().getFullYear();
        }
        const parsed = parseDate(value);
        if (parsed && !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
            showStatus('Vigane kuupäeva vorming (Kasuta: PP.KK.AAAA)', 'error');
            finishEditing();
            return;
        }
        value = parsed;
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

    setEditingCellState(null, null);
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
    setEditingCellState(null, null);
}

export function deleteRow(index) {
    const jobToDelete = getJobs()[index];
    if (!jobToDelete) {
        showStatus('Viga: Tööd ei leitud', 'error');
        return;
    }
    hideTooltip();

    const popup = document.getElementById('confirm-popup');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');

    popup.style.display = 'flex';
    cancelBtn.focus();
    document.removeEventListener('keydown', handleKeydown);

    if (activeDeleteKeydownHandler) {
        document.removeEventListener('keydown', activeDeleteKeydownHandler, true);
    }

    function close() {
        popup.style.display = 'none';
        if (activeDeleteKeydownHandler) {
            document.removeEventListener('keydown', activeDeleteKeydownHandler, true);
            activeDeleteKeydownHandler = null;
        }
        document.addEventListener('keydown', handleKeydown);
        okBtn.onclick = null;
        cancelBtn.onclick = null;
    }

    function onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key === 'Tab') {
            const focusables = [cancelBtn, okBtn];
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first || !popup.contains(document.activeElement)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last || !popup.contains(document.activeElement)) {
                    e.preventDefault();
                    first.focus();
                }
            }
            e.stopPropagation();
            return;
        }
    }
    activeDeleteKeydownHandler = onKey;
    document.addEventListener('keydown', onKey, true);

    okBtn.onclick = function() {
        close();
        const currentJobs = getJobs();
        let targetIndex = index;
        if (currentJobs[index] !== jobToDelete) {
            targetIndex = currentJobs.indexOf(jobToDelete);
        }
        if (targetIndex !== -1) {
            doDeleteJob(targetIndex);
            renderTableBody();
            updateStats();
            showStatus('Töö kustutatud', 'success');
        } else {
            showStatus('Viga: Tööd ei leitud', 'error');
        }
    };
    cancelBtn.onclick = close;
}

export function toggleField(index, col, value) {
    pushUndo();
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    document.activeElement?.blur();
}

export function addJob(e) {
    e.preventDefault();
    const form = document.getElementById('add-form');
    const job = {};
    COLUMNS.forEach(col => job[col] = '');
    
    let hasError = false;
    FORM_FIELDS.forEach(f => {
        const col = f.col;
        const input = form.elements[col];
        if (input && input.value) {
            let val = input.value;
            if (DATE_COLS.includes(col)) {
                if (/^\d{1,2}\.\d{1,2}$/.test(val)) {
                    const [d, m] = val.split('.');
                    val = d.padStart(2, '0') + '.' + m.padStart(2, '0') + '.' + new Date().getFullYear();
                }
                val = parseDate(val);
                if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                    showStatus('Vigane kuupäev: ' + f.label, 'error');
                    hasError = true;
                    return;
                }
            }
            job[col] = val;
        }
    });
    if (hasError) return;
    
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    job['Info sisestamise kuupäev'] = today;
    
    doAddJob(job);
    closeModal();
    renderTableBody();
    updateStats();
    showStatus('Töö lisatud!', 'success');
}

export function handleKeydown(e) {
    const shortcutsPopup = document.getElementById('shortcuts-popup');
    const menuDropdown = document.getElementById('menu-dropdown');
    const fontPopup = document.getElementById('font-size-popup');
    const infoPopup = document.getElementById('info-popup');
    if (e.key === 'Escape' && fontPopup && fontPopup.style.display !== 'none') {
        fontPopup.style.display = 'none';
        e.preventDefault();
        return;
    }
    if (e.key === 'Escape' && shortcutsPopup && shortcutsPopup.style.display !== 'none') {
        shortcutsPopup.style.display = 'none';
        e.preventDefault();
        return;
    }
    if (e.key === 'Escape' && infoPopup && infoPopup.style.display !== 'none') {
        infoPopup.style.display = 'none';
        e.preventDefault();
        return;
    }
    if (e.key === 'Escape' && menuDropdown && menuDropdown.style.display !== 'none') {
        menuDropdown.style.display = 'none';
        e.preventDefault();
        return;
    }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !document.getElementById('modal').classList.contains('active')) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        if (undo()) {
            if (editingCell) finishEditing();
            clearSort();
            localStorage.removeItem('jobsSortState');
            renderTableBody();
            updateStats();
            showStatus('Tagasi võetud', 'success');
        }
        return;
    }
    if (e.ctrlKey && e.key === ';') {
        e.preventDefault();
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const dateStr = dd + '.' + mm + '.' + yyyy;
        if (editingCell) {
            const input = document.querySelector('.floating-editor textarea');
            if (input) {
                input.value = dateStr;
                input.dispatchEvent(new Event('input'));
            }
        } else if (document.getElementById('modal').classList.contains('active')) {
            const active = document.activeElement;
            if (active && active.tagName === 'INPUT' && active.closest('#add-form')) {
                active.value = dateStr;
                active.dispatchEvent(new Event('input'));
            }
        }
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
            if (document.getElementById('calendar-popup')) {
                closeCalendarPopup();
            } else {
                closeModal();
            }
            e.preventDefault();
        }
    } else {
        if (e.key === 'Escape') {
            closeCalendarPopup();
            e.preventDefault();
        } else if (e.key === 'Enter') {
            const active = document.activeElement;
            if (active && active.tagName === 'TD') {
                const colAttr = active.getAttribute('data-col');
                if (colAttr) {
                    const index = parseInt(active.getAttribute('data-index'));
                    editCell(active, index, colAttr.replace(/\\'/g, "'"));
                    e.preventDefault();
                }
            }
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
    
    const tbody = document.getElementById('table-body');
    tbody.addEventListener('click', function(e) {
        const btn = e.target.closest('.btn-delete');
        if (btn) {
            if (document.body.classList.contains('modal-open')) return;
            const index = parseInt(btn.getAttribute('data-index'), 10);
            deleteRow(index);
            return;
        }
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
    document.getElementById('add-form').addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            const input = e.target;
            const col = input.getAttribute('name');
            if (DATE_COLS.includes(col) && /^\d{1,2}\.\d{1,2}$/.test(input.value)) {
                e.preventDefault();
                const [d, m] = input.value.split('.');
                input.value = d.padStart(2, '0') + '.' + m.padStart(2, '0') + '.' + new Date().getFullYear();
            }
        }
    });
    
    const menuBtn = document.getElementById('btn-menu');
    const menuDropdown = document.getElementById('menu-dropdown');
    const shortcutsPopup = document.getElementById('shortcuts-popup');
    const infoPopup = document.getElementById('info-popup');
    
    function closeMenu() {
        menuDropdown.style.display = 'none';
    }
    
    menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        menuDropdown.style.display = menuDropdown.style.display === 'none' ? 'flex' : 'none';
    });
    
    menuDropdown.addEventListener('click', function(e) {
        e.stopPropagation();
        const item = e.target.closest('.menu-item');
        if (!item) return;
        const action = item.getAttribute('data-action');
        closeMenu();
        
        if (action === 'save-csv') {
            doSaveCSV();
        } else if (action === 'load-csv') {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.txt';
            input.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (!file) return;
                showStatus('Laen...', 'success');
                doLoadFromFile(file).then(result => {
                    renderTable();
                    renderForm();
                    updateStats();
                    const skipped = result.count - result.added;
                    let msg = 'CSV laetud! ';
                    if (result.added > 0) {
                        const uutStr = result.added === 1 ? 'uus' : 'uut';
                        msg += result.added + ' ' + uutStr;
                        if (skipped > 0) msg += ', ' + skipped + ' dubleeritud';
                    } else {
                        msg += 'uusi töid ei lisatud (' + skipped + ' dubleeritud)';
                    }
                    showStatus(msg, 'success');
                }).catch(err => {
                    showStatus('Viga: ' + err.message, 'error');
                });
            });
            input.click();
        } else if (action === 'shortcuts') {
            shortcutsPopup.style.display = shortcutsPopup.style.display === 'none' ? 'block' : 'none';
        } else if (action === 'info') {
            const grid = document.getElementById('info-grid');
            if (grid && infoPopup) {
                grid.innerHTML = '<div class="info-label">Application</div><div class="info-value">' + APP_NAME + '</div>'
                    + '<div class="info-label">Version</div><div class="info-value">' + APP_VERSION + '</div>'
                    + '<div class="info-label">Author</div><div class="info-value">' + APP_AUTHOR + '</div>';
                infoPopup.style.display = infoPopup.style.display === 'none' ? 'block' : 'none';
            }
        } else if (action === 'font-size') {
            const popup = document.getElementById('font-size-popup');
            const currentSize = parseInt(localStorage.getItem('fontSize') || '12');
            document.getElementById('font-size-slider').value = currentSize;
            document.getElementById('font-size-display').textContent = currentSize + ' px';
            popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
        } else if (action === 'row-colors') {
            const showRowColors = localStorage.getItem('showRowColors') !== 'false';
            localStorage.setItem('showRowColors', showRowColors ? 'false' : 'true');
            document.getElementById('menu-row-colors').innerHTML = localStorage.getItem('showRowColors') !== 'false' ? 'Color rows <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--color-primary);vertical-align:middle;margin-left:6px"></span>' : 'Color rows';
            renderTableBody();
        }
    });

    document.getElementById('font-size-slider').addEventListener('input', function() {
        const size = this.value;
        document.getElementById('font-size-display').textContent = size + ' px';
        setRowFontSize(size);
    });

    document.addEventListener('click', function(e) {
        if (menuDropdown.style.display !== 'none' && !menuDropdown.contains(e.target) && e.target !== menuBtn) {
            closeMenu();
        }
        if (shortcutsPopup.style.display !== 'none' && !shortcutsPopup.contains(e.target) && e.target !== menuBtn) {
            shortcutsPopup.style.display = 'none';
        }
        if (infoPopup && infoPopup.style.display !== 'none' && !infoPopup.contains(e.target) && e.target !== menuBtn) {
            infoPopup.style.display = 'none';
        }
        const fontPopup = document.getElementById('font-size-popup');
        if (fontPopup.style.display !== 'none' && !fontPopup.contains(e.target) && e.target !== menuBtn && e.target.getAttribute?.('data-action') !== 'font-size') {
            fontPopup.style.display = 'none';
        }
    });

    function showTooltip(target) {
        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'tooltip-popup';
            document.body.appendChild(tooltipEl);
        }
        tooltipEl.textContent = text;

        const rect = target.getBoundingClientRect();
        tooltipEl.classList.add('visible');
        const tooltipRect = tooltipEl.getBoundingClientRect();
        let left = rect.left + (rect.width - tooltipRect.width) / 2;
        let top = rect.bottom + 6;

        if (left < 4) left = 4;
        if (left + tooltipRect.width > window.innerWidth - 4) {
            left = window.innerWidth - tooltipRect.width - 4;
        }
        if (top + tooltipRect.height > window.innerHeight - 4) {
            top = rect.top - tooltipRect.height - 6;
        }

        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
    }

    document.addEventListener('mouseover', function(e) {
        const target = e.target.closest('[data-tooltip]');
        if (!target) {
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
            return;
        }
        const text = target.getAttribute('data-tooltip');
        if (!text) {
            hideTooltip();
            return;
        }

        if (target.tagName === 'TD' && target.scrollWidth <= target.clientWidth) {
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
            hideTooltip();
            return;
        }

        if (tooltipTimeout) clearTimeout(tooltipTimeout);
        tooltipEl?.classList.remove('visible');
        tooltipTimeout = setTimeout(() => showTooltip(target), 500);
    });

    document.addEventListener('mouseout', function(e) {
        const target = e.target.closest('[data-tooltip]');
        if (!target) {
            hideTooltip();
        }
    });
}