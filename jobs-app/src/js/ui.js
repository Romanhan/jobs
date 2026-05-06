import { COLUMNS, COLUMN_LABELS, COLUMN_WIDTHS, DATE_COLS, CHECKBOX_COLS, HIDDEN_COLS, COLUMN_WRAP, FORM_FIELDS } from './config.js';
import { formatDate } from './utils.js';
import { getJobs, getColumnWidths, setColumnWidth, saveColumnWidths, getHiddenColumns, autoSave as doAutoSave } from './data.js';

let sortColumn = null;
let sortDirection = 'asc';

export function setSortingState(column, direction) {
    sortColumn = column;
    sortDirection = direction;
}

export function getSortingState() {
    return { sortColumn, sortDirection };
}

export function getStatus(job) {
    if (job['Valmis']) return 'completed';
    if (job['Töötlus allhankes']) return 'allhanke';
    if (job['Alustatud']) return 'in-progress';
    const deadlineStr = job['EE vajaduse kuupäev (koostamiseks valmis kujul)'];
    if (deadlineStr) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const deadline = new Date(deadlineStr); deadline.setHours(0, 0, 0, 0);
        if (deadline < today) return 'overdue';
    }
    return null;
}

export function renderTable() {
    const thead = document.querySelector('thead');
    let html = '<tr><th class="row-indicator"></th>';
    const showHidden = document.getElementById('show-hidden-dates')?.checked;
    const hiddenColumns = getHiddenColumns();
    
    COLUMNS.forEach(col => {
        const isHidden = HIDDEN_COLS.includes(col) && !showHidden;
        if (isHidden) return;
        const label = COLUMN_LABELS[col] || col;
        const sortedClass = sortColumn === col ? 'sorted' : '';
        const hiddenClass = hiddenColumns[col] ? 'hidden-col' : '';
        const wrapClass = COLUMN_WRAP.includes(col) ? 'wrap-header' : '';
        const widths = getColumnWidths();
        const width = widths[col] || COLUMN_WIDTHS[col] || 40;
        const arrow = sortColumn === col ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
        html += '<th class="' + sortedClass + ' ' + hiddenClass + ' ' + wrapClass + '" style="min-width: ' + width + 'px" data-col="' + col + '" title="' + col + '" onmousedown="startResize(event, this)">' + label + '<span class="sort-indicator">' + arrow + '</span></th>';
    });
    html += '</tr>';
    thead.innerHTML = html;
    renderTableBody();
}

export function renderTableBody() {
    const tbody = document.getElementById('table-body');
    const filterNr = document.getElementById('filter-nr').value.toLowerCase();
    const filterKoht = document.getElementById('filter-koht').value.toLowerCase();
    const showCompleted = document.getElementById('show-completed').checked;
    const showAllhankes = document.getElementById('show-allhankes').checked;
    const showHidden = document.getElementById('show-hidden-dates')?.checked;
    const hiddenColumns = getHiddenColumns();
    
    const jobsArr = getJobs();
    
    let filteredJobs = jobsArr.map((job, index) => ({ job, index }))
        .filter(({ job }) => {
            const valmis = job['Valmis'];
            if (showCompleted) {
                if (!valmis) return false;
            } else {
                if (valmis) return false;
            }
            const allhankes = job['Töötlus allhankes'];
            if (allhankes && !showAllhankes) return false;
            const nrMatch = !filterNr || (job['Töö Nr'] || '').toLowerCase().includes(filterNr);
            const kohtMatch = !filterKoht || (job['Täitmise koht'] || '').toLowerCase().includes(filterKoht);
            return nrMatch && kohtMatch;
        });
    
    if (sortColumn) {
        filteredJobs.sort((a, b) => {
            let valA = a.job[sortColumn], valB = b.job[sortColumn];
            if (valA === null || valA === undefined) valA = '';
            if (valB === null || valB === undefined) valB = '';
            if (typeof valA === 'boolean') { valA = valA ? 1 : 0; valB = valB ? 1 : 0; }
            else if (DATE_COLS.includes(sortColumn)) { valA = valA ? new Date(valA).getTime() : 0; valB = valB ? new Date(valB).getTime() : 0; }
            else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    let html = '';
    const statusColors = { 'in-progress': '#15803d', 'allhanke': '#6d28d9', 'overdue': '#dc2626', 'completed': '#64748b' };
    
    filteredJobs.forEach(({ job, index }) => {
        const status = getStatus(job);
        const valmis = job['Valmis'];
        const statusColor = status ? statusColors[status] : '#ffffff';
        const statusClass = status ? 'row-' + status : '';
        html += '<tr class="' + (valmis ? 'done-row ' : '') + statusClass + '" data-index="' + index + '">';
        html += '<td class="row-indicator" style="background-color: ' + statusColor + '"></td>';
        
        COLUMNS.forEach(col => {
            const value = job[col];
            const isCheckbox = CHECKBOX_COLS.includes(col);
            const isDate = DATE_COLS.includes(col);
            const isHidden = hiddenColumns[col] || (HIDDEN_COLS.includes(col) && !showHidden);
            if (isHidden) return;
            const widths = getColumnWidths();
            const width = widths[col] || COLUMN_WIDTHS[col] || 40;
            let colEscaped = col.replace(/'/g, "\\'");
            
            if (isCheckbox) {
                html += '<td style="min-width: ' + width + 'px"><input type="checkbox" class="checkbox" ' + (value ? 'checked' : '') + ' onchange="toggleField(' + index + ', \'' + colEscaped + '\', this.checked)"></td>';
            } else {
                const displayValue = isDate ? formatDate(value) : (value || '');
                html += '<td style="min-width: ' + width + 'px" data-index="' + index + '" data-col="' + colEscaped + '" title="' + displayValue + '">' + displayValue + '</td>';
            }
        });
        html += '</tr>';
    });
    
    tbody.innerHTML = html;
}

export function renderForm() {
    const grid = document.getElementById('form-grid');
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
                html += '<input type="text" name="' + col + '" class="date-input" placeholder="' + label + '" title="' + label + '"' + isRequired + '>';
            } else {
                html += '<input type="text" name="' + col + '" placeholder="' + label + '" title="' + label + '"' + isRequired + '>';
            }
            
            html += '</div>';
        });
        html += '</div>';
    });
    
grid.innerHTML = html;
        
        // Move buttons to last form-line
        const lastFormLine = grid.querySelector('.form-line:last-child');
        const modalButtons = document.querySelector('.modal-buttons');
        if (lastFormLine && modalButtons) {
            lastFormLine.appendChild(modalButtons);
        }
    }

export function updateStats() {
    const jobsArr = getJobs();
    const total = jobsArr.length;
    const completed = jobsArr.filter(j => j['Valmis']).length;
    const active = total - completed;
    const inProgress = jobsArr.filter(j => j['Alustatud'] && !j['Valmis']).length;
    const allhanke = jobsArr.filter(j => j['Töötlus allhankes'] && !j['Valmis']).length;
    const overdue = jobsArr.filter(j => getStatus(j) === 'overdue').length;
    
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
    renderTable();
}

export function startResize(e, th) {
    if (e.target.tagName === 'SPAN') return;
    let didResize = false;
    const startX = e.pageX, startWidth = th.offsetWidth;
    const col = th.getAttribute('data-col');

    function doResize(ev) {
        didResize = true;
        const diff = ev.pageX - startX;
        const newWidth = Math.max(25, startWidth + diff);
        th.style.minWidth = newWidth + 'px';
        setColumnWidth(col, newWidth);
    }

    function stopResize() {
        if (didResize) {
            saveColumnWidths();
        }
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
}