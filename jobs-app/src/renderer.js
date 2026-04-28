const COLUMNS = [
    'Töö Nr', 'Valmis', 'Valmis kpv', 'Tegevuse sisestaja nimi',
    'Detaili/koostu nimetus või joonise Nr', 'Kommentaar(tooriku/detaili seis, muu oluline info)',
    'Otsuse/Tegevuse vastutaja', 'Tooriku saabumise kuupäev EE',
    'EE vajaduse kuupäev (koostamiseks valmis kujul)', 'Meeldetuletus  X päeva ennem',
    'Töötluse algus', 'Alustatud', 'Alustamise kpv', 'EE töötluse lõpp',
    'Töötlus Lõpetatud', 'Töötlus allhankes', 'Täitmise koht',
    'EE kuupäev tarne', 'TE kuupäev tarne', 'Info sisestamise kuupäev'
];

const COLUMN_LABELS = {
    'Kommentaar(tooriku/detaili seis, muu oluline info)': 'Kommentaar',
    'Detaili/koostu nimetus või joonise Nr': 'Detail/koostu',
    'EE vajaduse kuupäev (koostamiseks valmis kujul)': 'EE vajaduse kpv',
    'Meeldetuletus  X päeva ennem': 'Meeldetuletus',
    'Tegevuse sisestaja nimi': 'Sisestaja'
};

const COLUMN_WIDTHS = {
    'Töö Nr': 80, 'Valmis': 50, 'Valmis kpv': 90, 'Tegevuse sisestaja nimi': 80,
    'Detaili/koostu nimetus või joonise Nr': 80, 'Kommentaar(tooriku/detaili seis, muu oluline info)': 250,
    'Otsuse/Tegevuse vastutaja': 90, 'Tooriku saabumise kuupäev EE': 100,
    'EE vajaduse kuupäev (koostamiseks valmis kujul)': 100, 'Meeldetuletus  X päeva ennem': 80,
    'Töötluse algus': 90, 'Alustatud': 60, 'Alustamise kpv': 90,
    'EE töötluse lõpp': 90, 'Töötlus Lõpetatud': 80, 'Töötlus allhankes': 80,
    'Täitmise koht': 100, 'EE kuupäev tarne': 90, 'TE kuupäev tarne': 90,
    'Info sisestamise kuupäev': 100
};

const DATE_COLS = ['Valmis kpv', 'Info sisestamise kuupäev', 'Tooriku saabumise kuupäev EE',
    'EE vajaduse kuupäev (koostamiseks valmis kujul)', 'Töötluse algus',
    'Alustamise kpv', 'EE töötluse lõpp', 'EE kuupäev tarne', 'TE kuupäev tarne'];

const CHECKBOX_COLS = ['Valmis', 'Alustatud', 'Töötlus Lõpetatud', 'Töötlus allhankes'];
const HIDDEN_COLS = ['Valmis kpv', 'Alustamise kpv'];

let jobs = [];
let editingCell = null;
const DEADLINE_WARNING_DAYS = 7;
let sortColumn = null, sortDirection = 'asc';
let columnWidths = {}, hiddenColumns = {};

function hasLocalStorage() {
    try { localStorage.setItem('test', 'test'); localStorage.removeItem('test'); return true; }
    catch (e) { return false; }
}

function getStatus(job) {
    if (job['Valmis']) return 'completed';
    if (job['Alustatud']) return 'in-progress';
    const deadline = job['EE vajaduse kuupäev (koostamiseks valmis kujul)'];
    if (!deadline) return 'waiting';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline); deadlineDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'overdue';
    if (diffDays <= DEADLINE_WARNING_DAYS) return 'soon';
    return 'ok';
}

function loadColumnWidths() {
    columnWidths = {};
    const saved = localStorage.getItem('jobsColumnWidths');
    if (saved) { try { columnWidths = JSON.parse(saved); } catch (e) { columnWidths = {}; } }
}

function saveColumnWidths() {
    localStorage.setItem('jobsColumnWidths', JSON.stringify(columnWidths));
}

function loadHiddenColumns() {
    hiddenColumns = {};
    const saved = localStorage.getItem('jobsHiddenColumns');
    if (saved) { try { hiddenColumns = JSON.parse(saved); } catch (e) { hiddenColumns = {}; } }
}

function saveHiddenColumns() {
    localStorage.setItem('jobsHiddenColumns', JSON.stringify(hiddenColumns));
}

let resizingTh = null;

function startResize(e, th) {
    if (e.target.tagName === 'SPAN') return;
    resizingTh = th;
    const startX = e.pageX, startWidth = th.offsetWidth;
    document.addEventListener('mousemove', function doResize(ev) {
        if (!resizingTh) return;
        const diff = ev.pageX - startX;
        const newWidth = Math.max(40, startWidth + diff);
        const col = resizingTh.getAttribute('data-col');
        resizingTh.style.minWidth = newWidth + 'px';
        columnWidths[col] = newWidth;
    });
    document.addEventListener('mouseup', function stopResize() {
        if (resizingTh) {
            const col = resizingTh.getAttribute('data-col');
            if (col) sortBy(col);
            saveColumnWidths();
            resizingTh = null;
        }
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    });
}

function toggleColumnMenu() {
    const menu = document.getElementById('column-menu');
    const menuInner = document.getElementById('column-menu-inner');
    if (menu.classList.contains('active')) { menu.classList.remove('active'); return; }
    let html = '';
    COLUMNS.forEach(col => {
        const label = COLUMN_LABELS[col] || col;
        const isHidden = hiddenColumns[col];
        html += '<label class="column-menu-item"><input type="checkbox" ' + (!isHidden ? 'checked' : '') + ' onchange="toggleColumn(\'' + col + '\', !this.checked)">' + label + '</label>';
    });
    menuInner.innerHTML = html;
    menu.classList.add('active');
}

document.addEventListener('click', function(e) {
    const toggleBtn = document.querySelector('.column-toggle-btn');
    const menu = document.getElementById('column-menu');
    if (toggleBtn && menu && !toggleBtn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('active');
    }
});

function toggleColumn(col, hide) {
    if (hide) hiddenColumns[col] = true;
    else delete hiddenColumns[col];
    saveHiddenColumns();
    renderTable();
}

function init() {
    loadHiddenColumns();
    loadColumnWidths();
    
    if (typeof JOBS_DATA !== 'undefined' && Array.isArray(JOBS_DATA) && JOBS_DATA.length > 0) {
        jobs = JOBS_DATA.map(job => {
            const fixed = {};
            Object.keys(job).forEach(key => {
                let newKey = key;
                if (key.startsWith(' EE')) newKey = 'EE' + key.substring(3);
                let val = job[key];
                if (val === null || val === undefined) val = '';
                fixed[newKey] = val;
            });
            return fixed;
        });
        showStatus('Andmed laetud!', 'success');
    }
    
    renderTable();
    renderForm();
    updateStats();
}

function renderTable() {
    const thead = document.getElementById('table-head');
    let html = '<tr><th class="row-indicator"></th>';
    COLUMNS.forEach(col => {
        const label = COLUMN_LABELS[col] || col;
        const indicator = sortColumn === col ? (sortDirection === 'asc' ? '▲' : '▼') : '↕';
        const sortedClass = sortColumn === col ? 'sorted' : '';
        const hiddenClass = hiddenColumns[col] ? 'hidden-col' : '';
        const width = columnWidths[col] || COLUMN_WIDTHS[col] || 80;
        html += '<th class="' + sortedClass + ' ' + hiddenClass + '" style="min-width: ' + width + 'px" data-col="' + col + '" onmousedown="startResize(event, this)">' + label + '<span class="sort-indicator">' + indicator + '</span></th>';
    });
    html += '</tr>';
    thead.innerHTML = html;
    renderTableBody();
}

function renderTableBody() {
    const tbody = document.getElementById('table-body');
    const filterNr = document.getElementById('filter-nr').value.toLowerCase();
    const filterKoht = document.getElementById('filter-koht').value.toLowerCase();
    const showCompleted = document.getElementById('show-completed').checked;
    
    let filteredJobs = jobs.map((job, index) => ({ job, index }))
        .filter(({ job }) => {
            const valmis = job['Valmis'];
            if (valmis && !showCompleted) return false;
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
    const statusColors = { 'waiting': '#94a3b8', 'in-progress': '#f59e0b', 'ok': '#22c55e', 'soon': '#eab308', 'overdue': '#ef4444', 'completed': '#94a3b8' };
    
    filteredJobs.forEach(({ job, index }) => {
        const status = getStatus(job);
        const valmis = job['Valmis'];
        const statusColor = statusColors[status] || statusColors.waiting;
        html += '<tr class="' + (valmis ? 'done-row' : '') + '" data-index="' + index + '">';
        html += '<td class="row-indicator" style="background-color: ' + statusColor + '"></td>';
        
        COLUMNS.forEach(col => {
            const value = job[col];
            const isCheckbox = CHECKBOX_COLS.includes(col);
            const isHidden = hiddenColumns[col] || (HIDDEN_COLS.includes(col) && !document.getElementById('show-hidden-dates').checked);
            if (isHidden) return;
            const width = columnWidths[col] || COLUMN_WIDTHS[col] || 80;
            
            if (isCheckbox) {
                html += '<td style="min-width: ' + width + 'px"><input type="checkbox" class="checkbox" ' + (value ? 'checked' : '') + ' onchange="toggleField(' + index + ', \'' + col + '\', this.checked)"></td>';
            } else {
                const displayValue = value || '';
                html += '<td style="min-width: ' + width + 'px" title="' + displayValue + '" onclick="editCell(this, ' + index + ', \'' + col + '\')">' + displayValue + '</td>';
            }
        });
        html += '</tr>';
    });
    
    tbody.innerHTML = html;
}

function sortBy(col) {
    if (sortColumn === col) { sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; }
    else { sortColumn = col; sortDirection = 'asc'; }
    renderTable();
}

function editCell(td, index, col) {
    if (editingCell) finishEditing();
    const job = jobs[index];
    const value = job[col] || '';
    const isDate = DATE_COLS.includes(col);
    if (isDate) {
        td.innerHTML = '<input type="date" value="' + value + '" style="width: 100%;" onblur="saveEdited(this, ' + index + ', \'' + col + '\')">';
    } else {
        const rows = Math.max(2, Math.ceil(value.length / 40));
        td.innerHTML = '<textarea style="width: 100%;" rows="' + rows + '" onblur="saveEdited(this, ' + index + ', \'' + col + '\')">' + value + '</textarea>';
    }
    td.classList.add('editing');
    const input = td.querySelector('input, textarea');
    input.focus();
    editingCell = { td, index, col };
}

function saveEdited(input, index, col) {
    const value = input.value;
    jobs[index][col] = value;
    editingCell.td.innerHTML = value || '';
    editingCell.td.classList.remove('editing');
    editingCell = null;
    renderTableBody();
    updateStats();
}

function finishEditing() {
    if (!editingCell) return;
    const value = jobs[editingCell.index][editingCell.col] || '';
    editingCell.td.innerHTML = value;
    editingCell.td.classList.remove('editing');
    editingCell = null;
}

function toggleField(index, col, value) {
    const today = new Date().toISOString().split('T')[0];
    if (col === 'Valmis') jobs[index]['Valmis kpv'] = value ? today : '';
    if (col === 'Alustatud') jobs[index]['Alustamise kpv'] = value ? today : '';
    jobs[index][col] = value;
    renderTableBody();
    updateStats();
}

function filterTable() { renderTableBody(); updateStats(); }

function updateStats() {
    const total = jobs.length;
    const completed = jobs.filter(j => j['Valmis']).length;
    const active = total - completed;
    const inProgress = jobs.filter(j => j['Alustatud'] && !j['Valmis']).length;
    const overdue = jobs.filter(j => getStatus(j) === 'overdue').length;
    
    document.getElementById('count-active').textContent = active;
    document.getElementById('count-in-progress').textContent = inProgress;
    document.getElementById('count-overdue').textContent = overdue;
    document.getElementById('count-completed').textContent = completed;
}

function renderForm() {
    const grid = document.getElementById('form-grid');
    let html = '';
    const defaultDate = new Date().toISOString().split('T')[0];
    
    COLUMNS.forEach(col => {
        if (HIDDEN_COLS.includes(col)) return;
        const isCheckbox = CHECKBOX_COLS.includes(col);
        const isDate = DATE_COLS.includes(col);
        let inputHtml = '';
        if (isCheckbox) inputHtml = '<input type="checkbox" name="' + col + '">';
        else if (isDate) inputHtml = '<input type="date" name="' + col + '" value="' + defaultDate + '">';
        else if (col === 'Töö Nr') inputHtml = '<input type="text" name="' + col + '" required placeholder="W26001">';
        else if (col === 'Info sisestamise kuupäev') inputHtml = '<input type="date" name="' + col + '" value="' + defaultDate + '">';
        else inputHtml = '<input type="text" name="' + col + '">';
        const label = COLUMN_LABELS[col] || col;
        html += '<div class="form-group"><label>' + label + '</label>' + inputHtml + '</div>';
    });
    
    grid.innerHTML = html;
}

function openModal() {
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('#add-form input[type="date"]').forEach(i => i.value = today);
    document.querySelectorAll('#add-form input[type="checkbox"]').forEach(i => i.checked = false);
    document.querySelectorAll('#add-form input[type="text"]').forEach(i => i.value = '');
    document.getElementById('modal').classList.add('active');
}

function closeModal() { document.getElementById('modal').classList.remove('active'); }

function addJob(e) {
    e.preventDefault();
    const form = document.getElementById('add-form');
    const job = {};
    COLUMNS.forEach(col => {
        const input = form.querySelector('[name="' + col + '"]');
        if (input) job[col] = input.type === 'checkbox' ? input.checked : (input.value || '');
        else job[col] = '';
    });
    jobs.push(job);
    closeModal();
    renderTableBody();
    updateStats();
    showStatus('Töö lisatud!', 'success');
}

function saveData() {
    try {
        const data = JSON.stringify(jobs, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'jobs_data.json';
        a.click();
        URL.revokeObjectURL(url);
        showStatus('Andmed salvestatud!', 'success');
    } catch (e) {
        showStatus('Viga: ' + e.message, 'error');
    }
}

function loadFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            jobs = JSON.parse(e.target.result);
            renderTableBody();
            updateStats();
            showStatus('Andmed laetud!', 'success');
        } catch (err) {
            showStatus('Viga faili lugemisel', 'error');
        }
    };
    reader.readAsText(file);
}

function showStatus(message, type) {
    const bar = document.getElementById('status-bar');
    bar.textContent = message;
    bar.className = 'status-bar ' + type;
    bar.style.display = 'block';
    setTimeout(() => bar.style.display = 'none', 3000);
}