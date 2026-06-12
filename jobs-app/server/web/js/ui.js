import { COLUMNS, COLUMN_LABELS, DATE_COLS, CHECKBOX_COLS, HIDDEN_COLS, COLUMN_WRAP, FORM_FIELDS, STICKY_COLS } from './config.js';
import { formatDate, renderMarkdown } from './utils.js';
import { getJobs, getColumnWidths, setColumnWidth, saveColumnWidths, getHiddenColumns, autoSave as doAutoSave } from './data.js';
import { openDateCalendar } from './calendar.js';

let sortColumn = null;
let sortDirection = 'asc';
let statusFilter = null;

export function setSortingState(column, direction) {
    sortColumn = column;
    sortDirection = direction;
}

export function getSortingState() {
    return { sortColumn, sortDirection };
}

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
    const parts = str.includes('.') ? str.split('.') : str.split('-');
    if (parts.length !== 3 || parts.some(p => !p.trim() || isNaN(p))) return null;
    const [y, m, d] = str.includes('.') ? [parts[2], parts[1] - 1, parts[0]] : [parts[0], parts[1] - 1, parts[2]];
    const date = new Date(y, m, d);
    return isNaN(date.getTime()) ? null : date;
}

export function getStatus(job) {
    if (job['Valmis']) return 'completed';
    const deadline = parseDeadline(job['EE vajaduse kuupäev (koostamiseks valmis kujul)']);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (deadline && deadline < today) return 'overdue';
    if (job['Töötlus allhankes']) return 'allhanke';
    if (job['Alustatud']) return 'in-progress';
    return null;
}

export function renderTable() {
    const thead = document.querySelector('thead');
    const showHidden = document.getElementById('show-hidden-dates')?.checked;
    const hiddenColumns = getHiddenColumns();
    
    const existingColgroup = document.querySelector('colgroup');
    if (existingColgroup) existingColgroup.remove();
    
    const colgroup = document.createElement('colgroup');
    const indicatorCol = document.createElement('col');
    indicatorCol.style.width = '16px';
    colgroup.appendChild(indicatorCol);
    
    let totalWidth = 16;
    const ths = [];
    COLUMNS.forEach(col => {
        const isHidden = HIDDEN_COLS.includes(col) && !showHidden;
        if (isHidden) return;
        const label = COLUMN_LABELS[col] || col;
        const sortedClass = sortColumn === col ? 'sorted' : '';
        const sortedDir = sortColumn === col ? (sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
        const hiddenClass = hiddenColumns[col] ? 'hidden-col' : '';
        const wrapClass = COLUMN_WRAP.includes(col) ? 'wrap-header' : '';
        const stickyClass = STICKY_COLS.includes(col) ? 'sticky-col' : '';
        const widths = getColumnWidths();
        const width = widths[col] || 40;
        totalWidth += width;
        
        const colEl = document.createElement('col');
        colEl.dataset.col = col;
        colEl.style.width = width + 'px';
        colgroup.appendChild(colEl);
        
        ths.push({ html: '<th class="' + sortedClass + ' ' + sortedDir + ' ' + hiddenClass + ' ' + wrapClass + ' ' + stickyClass + '" style="width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px" data-col="' + col + '" data-tooltip="' + col + '"><span class="header-label">' + label + '</span><div class="resize-handle" onmousedown="startResize(event, this.parentElement)"></div></th>', hidden: !!hiddenColumns[col] });
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
    
    let html = '<tr><th class="row-indicator"></th>';
    ths.forEach(th => { html += th.html; });
    html += '<th class="cell-delete-header"></th></tr>';
    thead.innerHTML = html;
    thead.parentNode.insertBefore(colgroup, thead);
    document.getElementById('jobs-table').style.width = (totalWidth + 28) + 'px';
    renderTableBody();
    updateStickyPositions();
}

export function renderTableBody() {
    const tbody = document.getElementById('table-body');
    const filterNr = document.getElementById('filter-nr').value.toLowerCase();
    const filterKoht = document.getElementById('filter-koht').value.toLowerCase();
    const showBlankKoht = document.getElementById('show-blank-koht').checked;
    const showCompleted = document.getElementById('show-completed').checked;
    const showAllhankes = document.getElementById('show-allhankes').checked;
    const showHidden = document.getElementById('show-hidden-dates')?.checked;
    const hiddenColumns = getHiddenColumns();
    
    const jobsArr = getJobs();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    
    let filteredJobs = jobsArr.map((job, index) => ({ job, index }))
        .filter(({ job }) => {
            if (statusFilter) {
                if (statusFilter === 'completed' && !job['Valmis']) return false;
                if (statusFilter === 'in-progress' && (job['Valmis'] || !job['Alustatud'])) return false;
                if (statusFilter === 'allhanke' && (job['Valmis'] || !job['Töötlus allhankes'])) return false;
                if (statusFilter === 'overdue') {
                    if (job['Valmis']) return false;
                    const deadline = parseDeadline(job['EE vajaduse kuupäev (koostamiseks valmis kujul)']);
                    if (!deadline || !(deadline < today)) return false;
                }
            } else {
                if (job['Valmis'] && !showCompleted) return false;
                const allhankes = job['Töötlus allhankes'];
                if (allhankes && !showAllhankes) return false;
            }
            const nrMatch = !filterNr || (job['Töö Nr'] || '').toLowerCase().includes(filterNr);
            const kohtBlank = showBlankKoht && (!job['Täitmise koht'] || job['Täitmise koht'].trim() === '');
            const kohtMatch = kohtBlank || !filterKoht || (job['Täitmise koht'] || '').toLowerCase().includes(filterKoht);
            return nrMatch && kohtMatch;
        });
    
    if (sortColumn) {
        filteredJobs.sort((a, b) => {
            let valA = a.job[sortColumn], valB = b.job[sortColumn];
            if (valA === null || valA === undefined) valA = '';
            if (valB === null || valB === undefined) valB = '';
            
            const isEmptyA = !valA || valA === '';
            const isEmptyB = !valB || valB === '';
            
            if (isEmptyA && !isEmptyB) return 1;
            if (!isEmptyA && isEmptyB) return -1;
            
            if (typeof valA === 'boolean') { valA = valA ? 1 : 0; valB = valB ? 1 : 0; }
            else if (DATE_COLS.includes(sortColumn)) {
                let cleanA = valA, cleanB = valB;
                if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanA)) {
                    const p = cleanA.split('.');
                    cleanA = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                }
                if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanB)) {
                    const p = cleanB.split('.');
                    cleanB = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                }
                const dateA = cleanA ? new Date(cleanA).getTime() : 0;
                const dateB = cleanB ? new Date(cleanB).getTime() : 0;
                valA = isNaN(dateA) ? 0 : dateA;
                valB = isNaN(dateB) ? 0 : dateB;
            }
            else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    let html = '';
    filteredJobs.forEach(({ job, index }) => {
        const status = getStatus(job);
        const valmis = job['Valmis'];
        const showRowColors = localStorage.getItem('showRowColors') !== 'false';
        const statusClass = status && showRowColors ? 'row-' + status : '';
        html += '<tr class="' + (valmis ? 'done-row ' : '') + statusClass + '" data-index="' + index + '">';
        html += '<td class="row-indicator"><span class="cell-inner">' + (status ? '<span class="status-dot status-dot--' + status + '"></span>' : '') + '</span></td>';
        
        COLUMNS.forEach(col => {
            const value = job[col];
            const isCheckbox = CHECKBOX_COLS.includes(col);
            const isDate = DATE_COLS.includes(col);
            const isHidden = hiddenColumns[col] || (HIDDEN_COLS.includes(col) && !showHidden);
            if (isHidden) return;
            const widths = getColumnWidths();
            const width = widths[col] || 40;
            let colEscaped = col.replace(/'/g, "\\'");
            
            const stickyClass = STICKY_COLS.includes(col) ? 'sticky-col' : '';
            if (isCheckbox) {
                html += '<td class="' + stickyClass + '" style="width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px"><span class="cell-inner"><input type="checkbox" class="checkbox" ' + (value ? 'checked' : '') + ' onchange="toggleField(' + index + ', \'' + colEscaped + '\', this.checked)"></span></td>';
            } else {
                const rawValue = isDate ? formatDate(value) : (value || '');
                const displayValue = isDate ? rawValue : renderMarkdown(rawValue);
                const tooltipValue = String(rawValue).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                html += '<td tabindex="0" class="' + stickyClass + '" style="width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px" data-index="' + index + '" data-col="' + colEscaped + '" data-tooltip="' + tooltipValue + '"><span class="cell-inner">' + displayValue + '</span></td>';
            }
        });
        html += '<td class="cell-delete"><button type="button" class="btn-delete" data-index="' + index + '" data-tooltip="Kustuta" aria-label="Kustuta">×</button></td>';
        html += '</tr>';
    });
    
    tbody.innerHTML = html;
    updateStickyPositions();
}

export function updateStickyPositions() {
    requestAnimationFrame(() => {
        const headerRow = document.querySelector('thead tr');
        if (!headerRow) return;

        const headerSticky = headerRow.querySelectorAll('.sticky-col:not(.hidden-col)');
        const positions = [];
        let left = 16;

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
            const label = f.label || COLUMN_LABELS[col] || col;
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
    let completed = 0, inProgress = 0, allhanke = 0, overdue = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    jobsArr.forEach(job => {
        if (job['Valmis']) {
            completed++;
        } else {
            if (job['Alustatud']) inProgress++;
            if (job['Töötlus allhankes']) allhanke++;
            const deadline = parseDeadline(job['EE vajaduse kuupäev (koostamiseks valmis kujul)']);
            if (deadline && deadline < today) overdue++;
        }
    });
    const active = total - completed;
    
    document.getElementById('count-active').textContent = active;
    document.getElementById('count-in-progress').textContent = inProgress;
    document.getElementById('count-allhanke').textContent = allhanke;
    document.getElementById('count-overdue').textContent = overdue;
    document.getElementById('count-completed').textContent = completed;
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
    if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = col;
        sortDirection = 'asc';
    }
    document.querySelectorAll('thead th').forEach(th => {
        th.classList.remove('sorted', 'sorted-asc', 'sorted-desc');
    });
    const th = document.querySelector('thead th[data-col="' + col + '"]');
    if (th) {
        th.classList.add('sorted', sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
    renderTableBody();
    updateStickyPositions();
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