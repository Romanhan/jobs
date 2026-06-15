import { COLUMNS, COLUMN_LABELS, DATE_COLS } from './config.js';
import { convertSaabunudDates, parseCSVLine, parseCSVLines, fixColumnKeys } from './utils.js';

export let jobs = [];
let lastSavedTimestamp = 0;
let isLoaded = false;
let inFlightSaves = 0;
let isPolling = false;
let sortColumn = null;
let sortDirection = 'asc';
let undoStack = [];
const MAX_UNDO = 50;

export function setSortingState(col, dir) {
    sortColumn = col;
    sortDirection = dir;
}

export function getSortingState() {
    return { sortColumn, sortDirection };
}

export function setJobs(newJobs) {
    jobs = newJobs;
}

export function getJobs() {
    return jobs;
}

export function pushUndo() {
    try {
        undoStack.push({
            jobs: JSON.parse(JSON.stringify(jobs)),
            sortColumn,
            sortDirection
        });
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    } catch (e) {}
}

export function undo() {
    if (undoStack.length === 0) return false;
    const state = undoStack.pop();
    jobs = state.jobs;
    if (state.sortColumn) {
        sortColumn = state.sortColumn;
        sortDirection = state.sortDirection;
        localStorage.setItem('jobsSortState', JSON.stringify({ sortColumn, sortDirection }));
    } else {
        sortColumn = null;
        sortDirection = 'asc';
        localStorage.removeItem('jobsSortState');
    }
    autoSave();
    return true;
}

export function clearUndo() {
    undoStack = [];
}

export async function loadData() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) {
            console.error('Server error:', res.status, await res.text());
            return { status: 'error', count: jobs.length, jobs };
        }
        const data = await res.json();
        jobs = data.jobs || [];
        isLoaded = true;
        lastSavedTimestamp = data.modified || Date.now();
        clearUndo();
        const count = convertSaabunudDates(jobs);
        if (count > 0) await autoSave();
        return { status: 'loaded', count: jobs.length, jobs };
    } catch (e) {
        console.error('Failed to load data:', e);
        // Keep existing jobs on error — don't silently clear data
        return { status: 'error', count: jobs.length, jobs };
    }
}

export async function loadFromFileLegacy() {
    return null;
}

export async function autoSave() {
    if (!isLoaded) return;
    inFlightSaves++;
    try {
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jobs)
        });
        if (!res.ok) {
            throw new Error("Server error: " + res.status);
        }
        const data = await res.json();
        lastSavedTimestamp = data.modified || Date.now();
    } catch (e) {
        console.error('Salvestamine ebaõnnestus', e);
    } finally {
        inFlightSaves--;
    }
}

export async function pollChanges(tabId) {
    if (inFlightSaves > 0 || isPolling) return false;
    isPolling = true;
    try {
        let url = '/api/poll?since=' + lastSavedTimestamp;
        if (tabId) url += '&tabId=' + encodeURIComponent(tabId);
        const res = await fetch(url);
        if (!res.ok) return false;
        const data = await res.json();
        if (data.changed && data.jobs) {
            jobs = data.jobs;
            convertSaabunudDates(jobs);
            lastSavedTimestamp = data.modified || Date.now();
            clearUndo();
            return true;
        }
        return false;
    } catch {
        return false;
    } finally {
        isPolling = false;
    }
}

export function reorderJobs(column, direction, shouldSave = false) {
    if (!column) return;
    if (shouldSave) pushUndo();

    jobs.sort((a, b) => {
        let valA = a[column], valB = b[column];
        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';
        if (typeof valA === 'boolean' && valB === '') valB = false;
        if (typeof valB === 'boolean' && valA === '') valA = false;

        const isEmptyA = valA === '';
        const isEmptyB = valB === '';

        if (isEmptyA && !isEmptyB) return 1;
        if (!isEmptyA && isEmptyB) return -1;

        if (typeof valA === 'boolean' || typeof valB === 'boolean') {
            const isTruthy = v => v === true || ['true', '1', 'jah', 'yes'].includes(String(v).toLowerCase());
            valA = isTruthy(valA) ? 1 : 0;
            valB = isTruthy(valB) ? 1 : 0;
        }
        else if (DATE_COLS.includes(column) || column === 'Tooriku saabumise kuupäev EE') {
            let cleanA = valA, cleanB = valB;
            if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanA)) {
                const p = cleanA.split('.');
                cleanA = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
            }
            if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanB)) {
                const p = cleanB.split('.');
                cleanB = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
            }
            valA = cleanA;
            valB = cleanB;
        }
        else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    if (shouldSave) autoSave();
}

export function addJob(job) {
    pushUndo();
    jobs.push(job);
    if (sortColumn && sortDirection) {
        reorderJobs(sortColumn, sortDirection, false);
    }
    autoSave();
}

export function deleteJob(index) {
    if (typeof index !== 'number' || isNaN(index) || index < 0 || index >= jobs.length) {
        return;
    }
    pushUndo();
    jobs.splice(index, 1);
    autoSave();
}

let columnWidths = {};
let hiddenColumns = {};

export function loadColumnWidths() {
    columnWidths = {};
    const saved = localStorage.getItem('jobsColumnWidths');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (typeof parsed === 'object' && parsed !== null) {
                Object.keys(parsed).forEach(col => {
                    const w = Number(parsed[col]);
                    if (!isNaN(w) && w > 0) columnWidths[col] = w;
                });
            }
        } catch (e) { /* ignore */ }
    }
}

export function autoCalculateColumnWidths(columns) {
    const checkboxCols = ['Valmis', 'Alustatud', 'Töötlus Lõpetatud', 'Töötlus allhankes'];
    columns.forEach(col => {
        if (columnWidths[col] === undefined) {
            if (col === 'Töö Nr') {
                columnWidths[col] = 78;
            } else if (checkboxCols.includes(col)) {
                columnWidths[col] = 40;
            } else {
                columnWidths[col] = 64;
            }
        }
    });
}

export function saveColumnWidths() {
    localStorage.setItem('jobsColumnWidths', JSON.stringify(columnWidths));
}

export function getColumnWidths() {
    return columnWidths;
}

export function setColumnWidth(col, width) {
    columnWidths[col] = width;
}

export function loadHiddenColumns() {
    hiddenColumns = {};
    const saved = localStorage.getItem('jobsHiddenColumns');
    if (saved) { try { hiddenColumns = JSON.parse(saved); } catch (e) { hiddenColumns = {}; } }
}

export function saveHiddenColumns() {
    localStorage.setItem('jobsHiddenColumns', JSON.stringify(hiddenColumns));
}

export function getHiddenColumns() {
    return hiddenColumns;
}

export function setHiddenColumn(col, hidden) {
    hiddenColumns[col] = hidden;
}

export function saveCSV() {
    const headerRow = COLUMNS.join(';');
    const rows = jobs.map(job => {
        return COLUMNS.map(col => {
            let val = (job[col] !== undefined && job[col] !== null) ? job[col] : '';
            if (val === true) val = 'TRUE';
            else if (val === false) val = 'FALSE';
            else if (typeof val === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                    const p = val.split('-');
                    val = p[2] + '.' + p[1] + '.' + p[0];
                }
            }
            val = String(val).replace(/"/g, '""');
            if (val.includes(';') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
                val = '"' + val + '"';
            }
            return val;
        }).join(';');
    });
    const csv = [headerRow, ...rows].join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobs_data.csv';
    a.click();
    URL.revokeObjectURL(url);
}

export function loadFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const arr = new Uint8Array(e.target.result);
                let raw;
                if (arr[0] === 0xEF && arr[1] === 0xBB && arr[2] === 0xBF) {
                    raw = new TextDecoder('utf-8').decode(arr.slice(3));
                } else {
                    try {
                        raw = new TextDecoder('utf-8', { fatal: true }).decode(arr);
                    } catch {
                        raw = new TextDecoder('windows-1252').decode(arr);
                    }
                }
                const lines = parseCSVLines(raw);
                if (lines.length < 1) throw new Error('Tühi fail');

                const headerLine = lines[0];
                const headers = parseCSVLine(headerLine);

                const colMap = {};
                const usedIndices = new Set();

                headers.forEach((h, i) => {
                    const key = h.trim().replace(/^"|"$/g, '');
                    const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const found = COLUMNS.find(c => {
                        const normC = c.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return normC === normKey;
                    });
                    if (found) {
                        colMap[found] = i;
                        usedIndices.add(i);
                    }
                });

                let posIdx = 0;
                COLUMNS.forEach(col => {
                    if (colMap[col] === undefined) {
                        while (usedIndices.has(posIdx) && posIdx < headers.length) posIdx++;
                        if (posIdx < headers.length) {
                            colMap[col] = posIdx;
                            usedIndices.add(posIdx);
                        }
                        posIdx++;
                    }
                });

                const newJobs = [];
                for (let i = 1; i < lines.length; i++) {
                    const values = parseCSVLine(lines[i]);
                    const job = {};
                    COLUMNS.forEach(col => {
                        const idx = colMap[col];
                        let val = (idx !== undefined && values[idx] !== undefined) ? values[idx] : '';

                        if (col === 'Valmis' || col === 'Alustatud' || col === 'Töötlus Lõpetatud' || col === 'Töötlus allhankes') {
                            const upper = val.toUpperCase();
                            val = (upper === 'TRUE' || upper === '1' || upper === 'JAH' || upper === 'YES');
                        } else if (DATE_COLS.includes(col) && val) {
                            const m = val.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
                            if (m) {
                                val = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
                            }
                        }
                        job[col] = val;
                    });
                    if (job['Töö Nr']) newJobs.push(job);
                }

                const keyFields = [
                    'Töö Nr',
                    'Detaili/koostu nimetus või joonise Nr',
                    'Kommentaar(tooriku/detaili seis, muu oluline info)'
                ];
                const key = j => j ? JSON.stringify(keyFields.map(k => String(j[k] ?? '').trim().toLowerCase())) : '';
                const existingKeys = new Set(jobs.filter(Boolean).map(key));
                const toAdd = [];
                for (const job of newJobs) {
                    const k = key(job);
                    if (!existingKeys.has(k)) {
                        existingKeys.add(k);
                        toAdd.push(job);
                    }
                }
                isLoaded = true;
                if (toAdd.length > 0) {
                    pushUndo();
                    for (const job of toAdd) {
                        jobs.push(job);
                    }
                    autoSave();
                }
                const addedCount = toAdd.length;
                resolve({ count: newJobs.length, jobs, added: addedCount });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = function() {
            reject(new Error('Faili lugemine ebaõnnestus'));
        };
        reader.readAsArrayBuffer(file);
    });
}
