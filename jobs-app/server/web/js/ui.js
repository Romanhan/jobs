import { COLUMNS, DATE_COLS, CHECKBOX_COLS, HIDDEN_COLS, COLUMN_WRAP, FORM_FIELDS, STICKY_COLS } from './config.js';
import { formatDate, renderMarkdown, escapeHTML } from './utils.js';
import { getJobs, getColumnWidths, setColumnWidth, saveColumnWidths, getHiddenColumns, autoSave as doAutoSave, reorderJobs, setSortingState, getSortingState, pushUndo, getConflicts } from './data.js';
import { openDateCalendar } from './calendar.js';
import { t, columnLabel, columnTitle } from './i18n.js';

let statusFilter = null;

export function setStatusFilter(filter) {
    statusFilter = filter;
    renderTableBody();
    updateStats();
}

export function getStatusFilter() {
    return statusFilter;
}

function parseDeadline(str) {
    if (typeof str !== 'string') return null;
    let match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
        const date = new Date(match[3], match[2] - 1, match[1]);
        if (isNaN(date.getTime())) return null;
        if (date.getMonth() !== match[2] - 1 || date.getDate() !== Number(match[1])) return null;
        return date;
    }
    match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
        const date = new Date(match[1], match[2] - 1, match[3]);
        if (isNaN(date.getTime())) return null;
        if (date.getMonth() !== match[2] - 1 || date.getDate() !== Number(match[3])) return null;
        return date;
    }
    return null;
}

// Machining is finished and the part only waits for delivery, so it is no longer
// counted as in progress or subcontracted.
function isMachined(job) {
    return job['Töötlus Lõpetatud'] && !job['Valmis'];
}

function isInProgress(job) {
    return job['Alustatud'] && !job['Töötlus allhankes'] && !job['Valmis'] && !isMachined(job);
}

function isAllhanke(job) {
    return job['Töötlus allhankes'] && !job['Valmis'] && !isMachined(job);
}

function isOverdue(job, today) {
    if (job['Valmis']) return false;
    const deadline = parseDeadline(job['EE vajaduse kuupäev (koostamiseks valmis kujul)']);
    return !!deadline && deadline < today;
}

export function getStatus(job) {
    if (job['Valmis']) return 'completed';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (isOverdue(job, today)) return 'overdue';
    if (isMachined(job)) return 'machined';
    if (isAllhanke(job)) return 'allhanke';
    if (isInProgress(job)) return 'in-progress';
    return null;
}

// The left gutter holds the status dot; vim mode widens it for row numbers.
// The numbers scale with the row font, so their box is measured: the gutter
// grows by exactly that much and the dot keeps its gap to the first column.
export function rowGutterWidth() {
    if (!document.body.classList.contains('vim-on')) return 16;
    const probe = document.createElement('span');
    probe.className = 'row-number-probe';
    probe.textContent = '00';
    document.body.appendChild(probe);
    const numberWidth = probe.getBoundingClientRect().width;
    probe.remove();
    // The 16 px dot area loses 3 px of padding and gains the number box
    // plus its 2 px margin (see td.row-indicator in table.css).
    return Math.ceil(16 - 3 + numberWidth + 2);
}

export function renderTable(skipBody) {
    const thead = document.querySelector('thead');
    const showHidden = document.getElementById('show-hidden-dates')?.checked;
    const hiddenColumns = getHiddenColumns();
    
    const existingColgroup = document.querySelector('colgroup');
    if (existingColgroup) existingColgroup.remove();
    
    const colgroup = document.createElement('colgroup');
    const indicatorCol = document.createElement('col');
    const gutterWidth = rowGutterWidth();
    indicatorCol.style.width = gutterWidth + 'px';
    colgroup.appendChild(indicatorCol);
    
    let totalWidth = gutterWidth;
    const ths = [];
    const widths = getColumnWidths();
    const { sortColumn, sortDirection } = getSortingState();
    COLUMNS.forEach(col => {
        const isHidden = HIDDEN_COLS.includes(col) && !showHidden;
        if (isHidden) return;
        const label = escapeHTML(columnLabel(col)) + (sortColumn === col ? (sortDirection === 'asc' ? ' ▴' : ' ▾') : '');
        const hiddenClass = hiddenColumns[col] ? 'hidden-col' : '';
        const wrapClass = COLUMN_WRAP.includes(col) ? 'wrap-header' : '';
        const stickyClass = STICKY_COLS.includes(col) ? 'sticky-col' : '';
        const width = widths[col] || 40;
        totalWidth += width;
        
        const colEl = document.createElement('col');
        colEl.dataset.col = col;
        colEl.style.width = width + 'px';
        colgroup.appendChild(colEl);
        
        ths.push({ html: '<th class="' + hiddenClass + ' ' + wrapClass + ' ' + stickyClass + '" style="width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px" data-col="' + col + '" data-tooltip="' + escapeHTML(columnTitle(col)) + '"><span class="header-label">' + label + '</span><div class="resize-handle" onmousedown="startResize(event, this.parentElement)"></div></th>', hidden: !!hiddenColumns[col] });
    });
    
    const delCol = document.createElement('col');
    delCol.style.width = '28px';
    colgroup.appendChild(delCol);
    
    for (let i = ths.length - 1; i >= 0; i--) {
        if (!ths[i].hidden) {
            ths[i].html = ths[i].html.replace('<th class="', '<th class="last-visible-th ');
            break;
        }
    }
    
    const gutter = gutterWidth + 'px';
    let html = '<tr><th class="row-indicator" style="width: ' + gutter + '; min-width: ' + gutter + '; max-width: ' + gutter + '"></th>';
    ths.forEach(th => { html += th.html; });
    html += '<th class="cell-delete-header"></th></tr>';
    thead.innerHTML = html;
    thead.parentNode.insertBefore(colgroup, thead);
    document.getElementById('jobs-table').style.width = (totalWidth + 28) + 'px';
    if (!skipBody) {
        renderTableBody();
    } else {
        updateStickyPositions();
    }
}

export function renderTableBody() {
    const tbody = document.getElementById('table-body');
    const filterNr = document.getElementById('filter-nr').value.toLowerCase();
    const filterKoht = document.getElementById('filter-koht').value.toLowerCase();
    const showBlankKoht = document.getElementById('show-blank-koht').checked;
    const showCompleted = document.getElementById('show-completed').checked;
    const showAllhankes = document.getElementById('show-allhankes').checked;
    const onlyNoDate = document.getElementById('btn-filter-no-date')?.classList.contains('active');
    const showHidden = document.getElementById('show-hidden-dates')?.checked;
    const hiddenColumns = getHiddenColumns();
    
    const jobsArr = getJobs();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    
    let filteredJobs = jobsArr.map((job, index) => ({ job, index }))
        .filter(({ job }) => {
            if (statusFilter) {
                if (statusFilter === 'completed' && !job['Valmis']) return false;
                if (statusFilter === 'in-progress' && !isInProgress(job)) return false;
                if (statusFilter === 'allhanke' && !isAllhanke(job)) return false;
                if (statusFilter === 'machined' && !isMachined(job)) return false;
                if (statusFilter === 'overdue' && !isOverdue(job, today)) return false;
            } else {
                if (job['Valmis'] && !showCompleted) return false;
                const allhankes = job['Töötlus allhankes'];
                if (allhankes && !showAllhankes) return false;
            }
            if (onlyNoDate && String(job['EE vajaduse kuupäev (koostamiseks valmis kujul)'] || '').trim() !== '') return false;
            const nrMatch = !filterNr || (job['Töö Nr'] || '').toLowerCase().includes(filterNr);
            const kohtBlank = showBlankKoht && (!job['Täitmise koht'] || job['Täitmise koht'].trim() === '');
            const kohtMatch = kohtBlank || !filterKoht || (job['Täitmise koht'] || '').toLowerCase().includes(filterKoht);
            return nrMatch && kohtMatch;
        });
    
    const widths = getColumnWidths();
    const conflictedIds = new Set(getConflicts().map(conflict => conflict.jobId));
    let html = '';
    filteredJobs.forEach(({ job, index }) => {
        const status = getStatus(job);
        const valmis = job['Valmis'];
        const conflicted = conflictedIds.has(job._id);
        const showRowColors = localStorage.getItem('showRowColors') !== 'false';
        const statusClass = status && showRowColors ? 'row-' + status : '';
        html += '<tr class="' + (valmis ? 'done-row ' : '') + (status === 'machined' ? 'machined-row ' : '') + statusClass + (conflicted ? ' row-conflict' : '') + '" data-index="' + index + '">';
        // A conflicted row must be visible as conflicted: the header dot alone
        // let a user stare at a row another user had already changed or deleted.
        const indicator = conflicted
            ? '<span class="conflict-dot" role="button" tabindex="0" onclick="openConflicts()" data-tooltip="' + escapeHTML(t('conflict.rowMarker')) + '">!</span>'
            : (status ? '<span class="status-dot status-dot--' + status + '"></span>' : '');
        html += '<td class="row-indicator"><span class="cell-inner">' + indicator + '</span></td>';
        
        COLUMNS.forEach(col => {
            const value = job[col];
            const isCheckbox = CHECKBOX_COLS.includes(col);
            const isDate = DATE_COLS.includes(col);
            const isHidden = hiddenColumns[col] || (HIDDEN_COLS.includes(col) && !showHidden);
            if (isHidden) return;
            const width = widths[col] || 40;
            let colEscaped = col.replace(/'/g, "\\'");
            
            const stickyClass = STICKY_COLS.includes(col) ? 'sticky-col' : '';
            if (isCheckbox) {
                html += '<td tabindex="-1" class="' + stickyClass + '" style="width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px" data-index="' + index + '" data-checkbox="' + colEscaped + '"><span class="cell-inner"><input type="checkbox" class="checkbox" ' + (value ? 'checked' : '') + ' onchange="toggleField(' + index + ', \'' + colEscaped + '\', this.checked)"></span></td>';
            } else {
                const rawValue = isDate ? formatDate(value) : (value || '');
                const displayValue = isDate ? escapeHTML(rawValue) : renderMarkdown(rawValue);
                const tooltipValue = String(rawValue).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                html += '<td tabindex="0" class="' + stickyClass + '" style="width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px" data-index="' + index + '" data-col="' + colEscaped + '" data-tooltip="' + tooltipValue + '"><span class="cell-inner">' + displayValue + '</span></td>';
            }
        });
        html += '<td class="cell-delete"><button type="button" class="btn-delete" data-index="' + index + '" data-tooltip="' + escapeHTML(t('delete.tooltip')) + '" aria-label="' + escapeHTML(t('delete.tooltip')) + '">×</button></td>';
        html += '</tr>';
    });
    
    tbody.innerHTML = html;
    updateStickyPositions();
    window.dispatchEvent(new CustomEvent('jobs-table-rendered'));
}

export function updateStickyPositions() {
    requestAnimationFrame(() => {
        const headerRow = document.querySelector('thead tr');
        if (!headerRow) return;

        const headerSticky = headerRow.querySelectorAll('.sticky-col:not(.hidden-col)');
        const positions = [];
        let left = rowGutterWidth();

        headerSticky.forEach(el => {
            positions.push({ left: left });
            left += el.getBoundingClientRect().width;
        });

        headerSticky.forEach((el, i) => {
            el.style.left = positions[i].left + 'px';
            el.style.zIndex = 9 - i;
        });

        document.querySelectorAll('#table-body tr').forEach(row => {
            const cells = row.querySelectorAll('.sticky-col:not(.hidden-col)');
            cells.forEach((cell, i) => {
                if (i < positions.length) {
                    cell.style.left = positions[i].left + 'px';
                    cell.style.zIndex = 4 - i;
                }
            });
        });
    });
}

export function renderForm() {
    const grid = document.getElementById('form-grid');
    const modalButtons = document.querySelector('.modal-buttons');
    if (modalButtons && grid.contains(modalButtons)) {
        document.getElementById('add-form').appendChild(modalButtons);
    }
    let html = '';
    
    const lines = {};
    FORM_FIELDS.forEach(f => {
        const line = f.line || 1;
        if (!lines[line]) lines[line] = [];
        lines[line].push(f);
    });
    
    Object.keys(lines).sort().forEach(lineNum => {
        html += '<div class="form-line">';
        lines[lineNum].forEach(f => {
            const col = f.col;
            const label = escapeHTML(t(f.labelKey));
            const isRequired = f.required ? ' required' : '';
            
            html += '<div class="form-group" style="max-width: ' + f.width + 'px; width: ' + f.width + 'px;">';
            
            if (f.isDate) {
                const inputId = 'modal-date-' + col.replace(/[^a-zA-Z0-9]/g, '-');
                html += '<div class="date-input-wrapper">';
                html += '<input type="text" name="' + col + '" id="' + inputId + '" class="date-input" placeholder="' + label + '" data-tooltip="' + label + '"' + isRequired + '>';
                html += '<button type="button" class="calendar-icon-btn" data-input-id="' + inputId + '"></button>';
                html += '</div>';
            } else {
                html += '<input type="text" name="' + col + '" placeholder="' + label + '" data-tooltip="' + label + '"' + isRequired + '>';
            }
            
            html += '</div>';
        });
        html += '</div>';
    });

        grid.innerHTML = html;

        // Add calendar button click handlers for date inputs
        document.querySelectorAll('.calendar-icon-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const inputId = this.getAttribute('data-input-id');
                const inputEl = document.getElementById(inputId);
                if (inputEl) {
                    openDateCalendar(inputEl, inputEl.value, function(result) {
                        inputEl.value = result.value || '';
                    }, this);
                }
            });
        });

        // Move buttons to last form-line
        const lastFormLine = grid.querySelector('.form-line:last-child');
        if (lastFormLine && modalButtons) {
            lastFormLine.appendChild(modalButtons);
        }
    }

export function updateStats() {
    const jobsArr = getJobs();
    const total = jobsArr.length;
    let completed = 0, inProgress = 0, allhanke = 0, machined = 0, overdue = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    jobsArr.forEach(job => {
        if (job['Valmis']) {
            completed++;
        } else {
            if (isInProgress(job)) inProgress++;
            if (isAllhanke(job)) allhanke++;
            if (isMachined(job)) machined++;
            if (isOverdue(job, today)) overdue++;
        }
    });
    const active = total - completed;
    
    document.getElementById('count-active').textContent = active;
    document.getElementById('count-in-progress').textContent = inProgress;
    document.getElementById('count-allhanke').textContent = allhanke;
    document.getElementById('count-machined').textContent = machined;
    document.getElementById('count-overdue').textContent = overdue;
    document.getElementById('count-completed').textContent = completed;
}

export function renderRowColorsMenuItem() {
    const item = document.getElementById('menu-row-colors');
    if (!item) return;
    const label = escapeHTML(t('menu.rowColors'));
    item.innerHTML = localStorage.getItem('showRowColors') !== 'false' ? label + ' <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--color-primary);vertical-align:middle;margin-left:6px"></span>' : label;
}

export function showStatus(message, type) {
    const bar = document.getElementById('status-bar');
    bar.textContent = message;
    bar.className = 'status-bar ' + type;
    bar.style.display = 'block';
    setTimeout(() => bar.style.display = 'none', 3000);
}

export function filterTable() {
    renderTableBody();
    updateStats();
}

export function sortBy(col) {
    const { sortColumn, sortDirection } = getSortingState();
    const newDir = sortColumn === col ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'asc';
    pushUndo();
    setSortingState(col, newDir);
    reorderJobs(col, newDir, false);
    renderTable();
}

export function startResize(e, th) {
    e.stopPropagation();
    if (e.target.tagName === 'SPAN') return;

    window._isResizing = false;

    let didResize = false;
    const startX = e.pageX, startWidth = th.offsetWidth;
    const col = th.getAttribute('data-col');
    const table = document.getElementById('jobs-table');
    const colEl = document.querySelector('col[data-col="' + col + '"]');
    const initialColWidth = parseInt(colEl?.style.width || '40', 10);
    const initialTableWidth = parseInt(table.style.width, 10) || 0;

    function doResize(ev) {
        window._isResizing = true;
        didResize = true;
        const diff = ev.pageX - startX;
        const newWidth = Math.max(4, startWidth + diff);
        th.style.width = newWidth + 'px';
        th.style.minWidth = newWidth + 'px';
        th.style.maxWidth = newWidth + 'px';
        if (colEl) colEl.style.width = newWidth + 'px';
        table.style.width = (initialTableWidth - initialColWidth + newWidth) + 'px';
        setColumnWidth(col, newWidth);
    }

    function stopResize() {
        if (didResize) {
            saveColumnWidths();
            updateStickyPositions();
        }
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
}
