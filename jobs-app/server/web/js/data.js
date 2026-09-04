import { COLUMNS, COLUMN_LABELS, DATE_COLS } from './config.js';
import { convertSaabunudDates, parseCSVLine, parseCSVLines, fixColumnKeys } from './utils.js';

export let jobs = [];
let lastSavedTimestamp = 0;
let lastServerRevision = '';
let isLoaded = false;
let inFlightSaves = 0;
let isPolling = false;
let syncedJobs = [];
let pendingSnapshot = null;
let saveLoopRunning = false;
let conflicts = [];
let pollFailures = 0;
let sortColumn = null;
let sortDirection = 'asc';
let undoStack = [];
const MAX_UNDO = 50;

const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

function emitSync(state, detail = {}) {
    window.dispatchEvent(new CustomEvent('jobs-sync', { detail: { state, conflicts: conflicts.length, ...detail } }));
}

function ensureLocalIds(items) {
    items.forEach(job => {
        if (!job._id) job._id = window.crypto?.randomUUID?.() ?? 'job-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    });
}

function applyChangesAfterSnapshot(serverJobs, sentSnapshot, currentJobs) {
    const result = clone(serverJobs);
    const resultById = new Map(result.map(job => [job._id, job]));
    const sentById = new Map(sentSnapshot.map(job => [job._id, job]));
    const currentById = new Map(currentJobs.map(job => [job._id, job]));
    for (const [id, current] of currentById) {
        const sent = sentById.get(id);
        if (!sent) {
            if (!resultById.has(id)) result.push(clone(current));
            continue;
        }
        const target = resultById.get(id);
        if (!target) {
            if (!same(sent, current)) result.push(clone(current));
            continue;
        }
        for (const field of new Set([...Object.keys(sent), ...Object.keys(current)])) {
            if (field !== '_id' && !same(sent[field], current[field])) target[field] = current[field] ?? '';
        }
    }
    for (const [id] of sentById) {
        if (!currentById.has(id)) {
            const index = result.findIndex(job => job._id === id);
            if (index >= 0) result.splice(index, 1);
        }
    }
    return result;
}

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
    sortColumn = state.sortColumn || null;
    sortDirection = state.sortColumn ? state.sortDirection : 'asc';
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
        ensureLocalIds(jobs);
        syncedJobs = clone(jobs);
        isLoaded = true;
        lastSavedTimestamp = data.modified || Date.now();
        lastServerRevision = data.revision || '';
        clearUndo();
        const storedPending = localStorage.getItem('jobsPendingChanges');
        if (storedPending) {
            try {
                const saved = JSON.parse(storedPending);
                if (Array.isArray(saved.base) && Array.isArray(saved.proposed)) {
                    jobs = applyChangesAfterSnapshot(jobs, saved.base, saved.proposed);
                    pendingSnapshot = clone(jobs);
                }
            } catch {}
        }
        const count = convertSaabunudDates(jobs);
        if (count > 0 || pendingSnapshot) await autoSave();
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
    ensureLocalIds(jobs);
    pendingSnapshot = clone(jobs);
    localStorage.setItem('jobsPendingChanges', JSON.stringify({ base: syncedJobs, proposed: pendingSnapshot }));
    if (!saveLoopRunning) processSaveQueue();
}

async function processSaveQueue() {
    saveLoopRunning = true;
    while (pendingSnapshot) {
        const sentSnapshot = pendingSnapshot;
        pendingSnapshot = null;
        const baseSnapshot = clone(syncedJobs);
        const proposal = clone(sentSnapshot);
        for (const conflict of conflicts) {
            const proposedJob = proposal.find(job => job._id === conflict.jobId);
            const baseJob = baseSnapshot.find(job => job._id === conflict.jobId);
            if (proposedJob && baseJob && !conflict.field.startsWith('_')) {
                conflict.userValue = proposedJob[conflict.field] ?? '';
                proposedJob[conflict.field] = baseJob[conflict.field] ?? '';
            }
        }
        inFlightSaves++;
        let slowTimer = setTimeout(() => emitSync('saving'), 500);
        try {
            const res = await fetch('/api/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base: baseSnapshot, proposed: proposal })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !Array.isArray(data.jobs)) throw new Error(data.message || 'Server error: ' + res.status);
            const currentJobs = jobs;
            syncedJobs = clone(data.jobs);
            jobs = applyChangesAfterSnapshot(data.jobs, sentSnapshot, currentJobs);
            lastSavedTimestamp = data.modified || Date.now();
            lastServerRevision = data.revision || lastServerRevision;
            if (Array.isArray(data.conflicts) && data.conflicts.length) {
                for (const conflict of data.conflicts) {
                    const existing = conflicts.findIndex(item => item.jobId === conflict.jobId && item.field === conflict.field);
                    if (existing >= 0) conflicts[existing] = conflict;
                    else conflicts.push(conflict);
                    const localJob = jobs.find(job => job._id === conflict.jobId);
                    if (localJob && !conflict.field.startsWith('_')) localJob[conflict.field] = conflict.userValue;
                    if (!localJob && conflict.field === '_deleted' && conflict.userValue) jobs.push(clone(conflict.userValue));
                }
                emitSync('conflict');
            } else {
                emitSync(conflicts.length ? 'conflict' : 'ok', { savedAt: Date.now() });
            }
            pollFailures = 0;
            if (!pendingSnapshot && conflicts.length === 0) localStorage.removeItem('jobsPendingChanges');
        } catch (e) {
            console.error('Salvestamine ebaõnnestus', e);
            pendingSnapshot = clone(jobs);
            emitSync('error', { message: e.message || 'Salvestamine ebaõnnestus', pending: true });
            break;
        } finally {
            clearTimeout(slowTimer);
            inFlightSaves--;
        }
    }
    saveLoopRunning = false;
}

export async function pollChanges(tabId) {
    if (inFlightSaves > 0 || pendingSnapshot || isPolling || conflicts.length) return false;
    isPolling = true;
    try {
        let url = '/api/poll?since=' + lastSavedTimestamp;
        if (lastServerRevision) url += '&revision=' + encodeURIComponent(lastServerRevision);
        if (tabId) url += '&tabId=' + encodeURIComponent(tabId);
        const res = await fetch(url);
        if (!res.ok) throw new Error('Server error: ' + res.status);
        const data = await res.json();
        if (data.changed && data.jobs) {
            jobs = data.jobs;
            ensureLocalIds(jobs);
            syncedJobs = clone(jobs);
            convertSaabunudDates(jobs);
            lastSavedTimestamp = data.modified || Date.now();
            lastServerRevision = data.revision || lastServerRevision;
            clearUndo();
            return true;
        }
        pollFailures = 0;
        if (!saveLoopRunning) emitSync('ok');
        return false;
    } catch (e) {
        pollFailures++;
        if (pollFailures >= 3) emitSync('error', { message: 'Serveriga puudub ühendus' });
        return false;
    } finally {
        isPolling = false;
    }
}

export function getConflicts() {
    return conflicts.slice();
}

export async function retrySave() {
    if (!isLoaded) {
        const result = await loadData();
        if (result.status === 'loaded') {
            emitSync('ok');
            window.dispatchEvent(new CustomEvent('jobs-data-updated'));
        } else {
            emitSync('error', { message: 'Server või K: ketas ei ole saadaval' });
        }
        return;
    }
    autoSave();
}

export function resolveConflict(jobId, field, choice, mergedValue = '') {
    const index = conflicts.findIndex(item => item.jobId === jobId && item.field === field);
    if (index < 0) return;
    const conflict = conflicts[index];
    const job = jobs.find(item => item._id === jobId);
    if (field === '_deleted') {
        if (choice === 'mine' && conflict.userValue) {
            const currentIndex = jobs.findIndex(item => item._id === jobId);
            if (currentIndex >= 0) jobs[currentIndex] = clone(conflict.userValue);
            else jobs.push(clone(conflict.userValue));
        } else if (choice === 'shared' && conflict.currentValue) {
            const currentIndex = jobs.findIndex(item => item._id === jobId);
            if (currentIndex >= 0) jobs[currentIndex] = clone(conflict.currentValue);
            else jobs.push(clone(conflict.currentValue));
        }
    } else if (job && field !== '_job') {
        job[field] = choice === 'merged' ? mergedValue : (choice === 'mine' ? conflict.userValue : conflict.currentValue);
    }
    conflicts.splice(index, 1);
    if (choice === 'mine' || choice === 'merged') autoSave();
    else {
        if (!conflicts.length && !pendingSnapshot) localStorage.removeItem('jobsPendingChanges');
        emitSync(conflicts.length ? 'conflict' : 'ok');
    }
    window.dispatchEvent(new CustomEvent('jobs-data-updated'));
}

export function hasUnsavedChanges() {
    return Boolean(pendingSnapshot || inFlightSaves || conflicts.length);
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
    ensureLocalIds([job]);
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
