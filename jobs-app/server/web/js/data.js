import { COLUMNS, DATE_COLS } from './config.js';
import { t } from './i18n.js';
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
let dataGeneration = 0;
let loadFailure = null;
const SAVE_RETRY_MIN_MS = 5000;
const SAVE_RETRY_MAX_MS = 30000;
let saveRetryTimer = null;
let saveRetryDelay = SAVE_RETRY_MIN_MS;
let saveFailures = 0;
let lastConflictReport = '';
export const DEFAULT_SORT_COLUMN = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
let sortColumn = DEFAULT_SORT_COLUMN;
let sortDirection = 'asc';
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

try {
    const savedSort = JSON.parse(localStorage.getItem('jobsSorting') || 'null');
    if (savedSort && COLUMNS.includes(savedSort.column) && ['asc', 'desc'].includes(savedSort.direction)) {
        sortColumn = savedSort.column;
        sortDirection = savedSort.direction;
    }
} catch {}

function applySorting() {
    reorderJobs(sortColumn, sortDirection, false);
}

const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

function emitSync(state, detail = {}) {
    window.dispatchEvent(new CustomEvent('jobs-sync', { detail: { state, conflicts: conflicts.length, ...detail } }));
}

function persistPendingChanges() {
    try {
        if (pendingSnapshot || inFlightSaves || conflicts.length) {
            localStorage.setItem('jobsPendingChanges', JSON.stringify({ base: syncedJobs, proposed: jobs, conflicts }));
        } else {
            localStorage.removeItem('jobsPendingChanges');
        }
    } catch (error) {
        // Browser storage failure must not prevent saving to the shared file.
        console.error('Kohalik varukoopia ebaõnnestus', error);
        if (pendingSnapshot || inFlightSaves || conflicts.length) {
            emitSync('error', { messageKey: 'sync.localBackupFailed' });
        }
    }
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
    try {
        localStorage.setItem('jobsSorting', JSON.stringify({ column: col, direction: dir }));
    } catch {}
}

export function getSortingState() {
    return { sortColumn, sortDirection };
}

export function setJobs(newJobs) {
    dataGeneration++;
    jobs = newJobs;
}

export function getJobs() {
    return jobs;
}

// True once the shared data file has been read successfully at least once.
// Until then the table has no data to show and editing stays disabled.
export function isDataLoaded() {
    return isLoaded;
}

// Reason for the last failed load, or null when the data file was read fine.
export function getLoadFailure() {
    return loadFailure;
}

function snapshotState() {
    return { jobs: JSON.parse(JSON.stringify(jobs)), sortColumn, sortDirection };
}

function restoreState(state) {
    jobs = state.jobs;
    setSortingState(state.sortColumn || DEFAULT_SORT_COLUMN, state.sortColumn ? state.sortDirection : 'asc');
    autoSave();
}

export function pushUndo() {
    try {
        undoStack.push(snapshotState());
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        // A new change starts a new history branch.
        redoStack = [];
    } catch (e) {}
}

export function undo() {
    if (undoStack.length === 0) return false;
    const state = undoStack.pop();
    try {
        redoStack.push(snapshotState());
        if (redoStack.length > MAX_UNDO) redoStack.shift();
    } catch (e) {}
    restoreState(state);
    return true;
}

export function redo() {
    if (redoStack.length === 0) return false;
    const state = redoStack.pop();
    try {
        undoStack.push(snapshotState());
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    } catch (e) {}
    restoreState(state);
    return true;
}

export function clearUndo() {
    undoStack = [];
    redoStack = [];
}

export async function loadData() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) {
            // The server answers load failures with JSON (error, dataFile,
            // detail); keep it so the UI and the diagnostics log can explain
            // which file is unavailable instead of showing an empty table.
            const detail = await res.json().catch(() => ({}));
            const dataFile = typeof detail?.dataFile === 'string' ? detail.dataFile : '';
            const message = detail?.detail || detail?.error || `Server error: ${res.status}`;
            console.error('Server error:', res.status, message);
            loadFailure = {
                status: res.status,
                dataFile,
                detail: String(message),
                messageKey: dataFile ? 'sync.fileUnavailable' : 'sync.networkUnavailable',
                messageParams: { file: dataFile },
            };
            reportClientProblem('load-failed', undefined, new Error(String(message)), `status=${res.status} file=${dataFile} `);
            return { status: 'error', count: jobs.length, jobs };
        }
        loadFailure = null;
        const data = await res.json();
        jobs = data.jobs || [];
        dataGeneration++;
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
                    // Replay against the original baseline so edits made while
                    // offline still go through the server's conflict detection.
                    syncedJobs = clone(saved.base);
                    jobs = clone(saved.proposed);
                    conflicts = Array.isArray(saved.conflicts) ? saved.conflicts : [];
                    pendingSnapshot = clone(jobs);
                }
            } catch {}
        }
        const count = convertSaabunudDates(jobs);
        if (count > 0 || pendingSnapshot) await autoSave();
        applySorting();
        return { status: 'loaded', count: jobs.length, jobs };
    } catch (e) {
        console.error('Failed to load data:', e);
        loadFailure = {
            status: 0,
            dataFile: '',
            detail: String(e),
            messageKey: 'sync.noConnection',
        };
        // Keep existing jobs on error — don't silently clear data
        return { status: 'error', count: jobs.length, jobs };
    }
}

export async function loadFromFileLegacy() {
    return null;
}

export async function autoSave() {
    if (!isLoaded) return;
    dataGeneration++;
    ensureLocalIds(jobs);
    pendingSnapshot = clone(jobs);
    persistPendingChanges();
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
            if (conflict.field === '_deleted' || conflict.field === '_job') {
                const index = proposal.findIndex(job => job._id === conflict.jobId);
                if (index >= 0) proposal.splice(index, 1);
                if (baseJob) proposal.push(clone(baseJob));
            } else if (proposedJob && baseJob) {
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
            if (!res.ok || !Array.isArray(data.jobs)) {
                const error = new Error(data.message || 'Server error: ' + res.status);
                error.status = res.status;
                throw error;
            }
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
                }
            }
            // Unresolved values stay visible and recoverable even when this
            // response only saved an unrelated field.
            for (const conflict of conflicts) {
                const localJob = jobs.find(job => job._id === conflict.jobId);
                if (!conflict.field.startsWith('_')) {
                    const sent = sentSnapshot.find(job => job._id === conflict.jobId);
                    const current = currentJobs.find(job => job._id === conflict.jobId);
                    if (sent && current && !same(sent[conflict.field], current[conflict.field])) {
                        conflict.userValue = current[conflict.field] ?? '';
                    }
                    if (localJob) localJob[conflict.field] = conflict.userValue;
                }
                if (!localJob && conflict.field === '_deleted' && conflict.userValue) jobs.push(clone(conflict.userValue));
            }
            // Preserve row indices while an editor is open during a save.
            const positions = new Map(currentJobs.map((job, index) => [job._id, index]));
            jobs.sort((a, b) => (positions.get(a._id) ?? Infinity) - (positions.get(b._id) ?? Infinity));
            if (!document.querySelector('.floating-editor')) {
                applySorting();
                window.dispatchEvent(new CustomEvent('jobs-data-updated'));
            }
            emitSync(conflicts.length ? 'conflict' : (pendingSnapshot ? 'saving' : 'ok'), { savedAt: Date.now() });
            pollFailures = 0;
            saveFailures = 0;
            saveRetryDelay = SAVE_RETRY_MIN_MS;
            cancelSaveRetry();
            reportConflictState();
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error('Salvestamine ebaõnnestus', error);
            saveFailures++;
            if (saveFailures === 1 || saveFailures % 5 === 0) {
                reportClientProblem('save-failed', undefined, error, `attempt=${saveFailures} `);
            }
            pendingSnapshot = clone(jobs);
            emitSync('error', {
                messageKey: retryableSaveError(error) ? 'sync.retrying' : 'sync.reason',
                messageParams: { reason: error.message || t('sync.error') },
                pending: true,
            });
            if (retryableSaveError(error)) scheduleSaveRetry();
            break;
        } finally {
            clearTimeout(slowTimer);
            inFlightSaves--;
            persistPendingChanges();
        }
    }
    saveLoopRunning = false;
}

function reportClientProblem(kind, tabId, error, extra = '') {
    try {
        const message = `${extra}error=${String(error && error.message ? error.message : error)}`;
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind,
                tabId,
                message,
                online: navigator.onLine,
                visibility: document.visibilityState,
            }),
            keepalive: true,
        }).catch(() => {});
    } catch { /* diagnostics must never break the app */ }
}

// A rejected request (invalid merge, too large) will not get better by itself;
// a network drop or a 5xx on the share will.
function retryableSaveError(error) {
    const status = Number(error && error.status) || 0;
    if (status === 0) return true;
    return status >= 500 || status === 429;
}

function cancelSaveRetry() {
    if (saveRetryTimer !== null) {
        clearTimeout(saveRetryTimer);
        saveRetryTimer = null;
    }
}

// Retry a failed save on its own instead of waiting for someone to press
// "Proovi uuesti" — that click is exactly what a stuck lock used to swallow.
function scheduleSaveRetry() {
    if (saveRetryTimer !== null || !pendingSnapshot) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const wait = saveRetryDelay;
    saveRetryDelay = Math.min(SAVE_RETRY_MAX_MS, Math.round(saveRetryDelay * 2));
    saveRetryTimer = setTimeout(() => {
        saveRetryTimer = null;
        if (!pendingSnapshot || inFlightSaves > 0) return;
        autoSave();
    }, wait);
}

function resumeSaveRetry() {
    if (!pendingSnapshot || saveRetryTimer !== null) return;
    saveRetryDelay = SAVE_RETRY_MIN_MS;
    scheduleSaveRetry();
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', resumeSaveRetry);
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') resumeSaveRetry();
        });
    }
}

// One line per conflict change, so error.log can answer "who still holds the
// deleted row" instead of us guessing from a screenshot.
function reportConflictState() {
    const summary = conflicts.map(conflict => `${conflict.jobId}:${conflict.field}`).join(',');
    if (summary === lastConflictReport) return;
    lastConflictReport = summary;
    if (!summary) return;
    reportClientProblem('conflict-open', undefined, new Error(summary.slice(0, 200)), `count=${conflicts.length} `);
}

// A poll must not freeze while a conflict is open, but the conflicting values
// still belong to the user. Everything else follows the shared file, and each
// open conflict is re-pointed at what the file holds now.
function adoptPolledConflicts(serverJobs) {
    const display = clone(serverJobs);
    const byId = new Map(display.map(job => [job._id, job]));
    const putLocal = job => {
        display.push(clone(job));
        byId.set(job._id, display[display.length - 1]);
    };
    const drop = id => {
        const index = display.findIndex(job => job._id === id);
        if (index >= 0) display.splice(index, 1);
        byId.delete(id);
    };
    const open = [];
    for (const conflict of conflicts) {
        const localJob = jobs.find(job => job._id === conflict.jobId) || null;
        const shared = byId.get(conflict.jobId) || null;
        if (conflict.field === '_deleted') {
            if (conflict.userValue) {
                // The user still has a row someone else deleted.
                if (shared) conflict.currentValue = clone(shared);
                else {
                    putLocal(conflict.userValue);
                    conflict.currentValue = null;
                }
                open.push(conflict);
            } else if (shared) {
                // The user deleted the row: keep it out of view while undecided.
                conflict.currentValue = clone(shared);
                drop(conflict.jobId);
                open.push(conflict);
            }
            // Gone on both sides: the deletion is settled.
            continue;
        }
        if (conflict.field === '_job') {
            if (shared) conflict.currentValue = clone(shared);
            else if (conflict.userValue) putLocal(conflict.userValue);
            open.push(conflict);
            continue;
        }
        if (!shared) {
            // The row was deleted elsewhere, so a field conflict becomes a
            // deletion conflict instead of pointing at a missing row.
            conflict.field = '_deleted';
            conflict.currentValue = null;
            conflict.userValue = clone(localJob || conflict.userValue || conflict.currentValue);
            if (localJob) putLocal(localJob);
            open.push(conflict);
            continue;
        }
        conflict.currentValue = shared[conflict.field] ?? '';
        if (same(conflict.currentValue, conflict.userValue)) continue; // solved elsewhere
        shared[conflict.field] = conflict.userValue;
        open.push(conflict);
    }
    conflicts = open;
    return display;
}

// The merge baseline follows the file except for rows with an open conflict:
// keeping their old base is what stops "Kasuta minu väärtust" from silently
// re-creating a row that another user deleted.
function refreshBaseline(serverJobs) {
    const conflictedIds = new Set(conflicts.map(conflict => conflict.jobId));
    syncedJobs = [
        ...clone(serverJobs).filter(job => !conflictedIds.has(job._id)),
        ...clone(syncedJobs.filter(job => conflictedIds.has(job._id))),
    ];
}

export async function pollChanges(tabId, canApply = () => true) {
    // Conflicts no longer pause polling: a tab that never refreshes is how one
    // user kept seeing a row another user had already deleted.
    if (inFlightSaves > 0 || pendingSnapshot || isPolling) return false;
    isPolling = true;
    const generation = dataGeneration;
    try {
        // Polling alone cannot finish startup: loadData also establishes the
        // merge baseline and restores pending edits before saving is enabled.
        if (!isLoaded) {
            const result = await loadData();
            if (result.status !== 'loaded') return false;
            pollFailures = 0;
            emitSync(conflicts.length ? 'conflict' : (hasUnsavedChanges() ? 'saving' : 'ok'));
            window.dispatchEvent(new CustomEvent('jobs-data-updated'));
            return true;
        }
        let url = '/api/poll?since=' + lastSavedTimestamp;
        if (lastServerRevision) url += '&revision=' + encodeURIComponent(lastServerRevision);
        if (tabId) url += '&tabId=' + encodeURIComponent(tabId);
        const res = await fetch(url);
        if (!res.ok) throw new Error('Server error: ' + res.status);
        const data = await res.json();
        // A save may have started and finished while this request was pending.
        // Its older response must not replace the newer state or revision.
        if (generation !== dataGeneration || inFlightSaves || pendingSnapshot || !canApply()) return false;
        if (data.changed && data.jobs) {
            jobs = adoptPolledConflicts(data.jobs);
            ensureLocalIds(jobs);
            refreshBaseline(data.jobs);
            convertSaabunudDates(jobs);
            lastSavedTimestamp = data.modified || Date.now();
            lastServerRevision = data.revision || lastServerRevision;
            clearUndo();
            applySorting();
            persistPendingChanges();
            reportConflictState();
            emitSync(conflicts.length ? 'conflict' : 'ok');
            return true;
        }
        pollFailures = 0;
        if (!saveLoopRunning) emitSync(conflicts.length ? 'conflict' : 'ok');
        return false;
    } catch (e) {
        pollFailures++;
        if (pollFailures === 3 || pollFailures % 10 === 0) {
            reportClientProblem('poll-failed', tabId, e, `failures=${pollFailures} `);
        }
        if (pollFailures >= 3) emitSync('error', { messageKey: 'sync.noConnection' });
        return false;
    } finally {
        isPolling = false;
    }
}

export function getConflicts() {
    return conflicts.slice();
}

export async function retrySave() {
    cancelSaveRetry();
    saveRetryDelay = SAVE_RETRY_MIN_MS;
    if (!isLoaded) {
        const result = await loadData();
        if (result.status === 'loaded') {
            loadFailure = null;
            emitSync('ok');
            window.dispatchEvent(new CustomEvent('jobs-data-updated'));
        } else {
            emitSync('error', loadFailure ? { messageKey: loadFailure.messageKey, messageParams: loadFailure.messageParams } : { messageKey: 'sync.driveUnavailable' });
        }
        return;
    }
    autoSave();
}

// A decision is made against the shared value the user was shown. refreshBaseline
// keeps a conflicted row's old base, so without this the save that carries the
// decision is compared with that stale base and comes back as the same conflict
// ("Taasta minu versioon" needed a second click). This runs only after an
// explicit choice, so the base still stops silent re-creation until then.
function rebaseOnSharedValue(conflict) {
    const index = syncedJobs.findIndex(job => job._id === conflict.jobId);
    if (conflict.field === '_deleted' || conflict.field === '_job') {
        if (conflict.currentValue) {
            if (index >= 0) syncedJobs[index] = clone(conflict.currentValue);
            else syncedJobs.push(clone(conflict.currentValue));
        } else if (index >= 0) syncedJobs.splice(index, 1);
    } else if (index >= 0) {
        syncedJobs[index][conflict.field] = clone(conflict.currentValue ?? '');
    }
}

export function resolveConflict(jobId, field, choice, mergedValue = '') {
    const index = conflicts.findIndex(item => item.jobId === jobId && item.field === field);
    if (index < 0) return;
    const conflict = conflicts[index];
    dataGeneration++;
    const job = jobs.find(item => item._id === jobId);
    if (field === '_job') {
        // "Minu rida" means my values on top of the shared row, not a replacement
        // with missing columns: a saved row must never lose fields it does not
        // carry (an imported or restored row can be partial).
        const shared = conflict.currentValue;
        const selected = choice === 'mine'
            ? (shared ? { ...clone(shared), ...clone(conflict.userValue) } : clone(conflict.userValue))
            : (shared ? clone(shared) : null);
        const currentIndex = jobs.findIndex(item => item._id === jobId);
        if (selected) {
            if (currentIndex >= 0) jobs[currentIndex] = selected;
            else jobs.push(selected);
        } else if (currentIndex >= 0) jobs.splice(currentIndex, 1);
    } else if (field === '_deleted') {
        const selected = choice === 'mine' ? conflict.userValue : conflict.currentValue;
        const currentIndex = jobs.findIndex(item => item._id === jobId);
        if (selected) {
            if (currentIndex >= 0) jobs[currentIndex] = clone(selected);
            else jobs.push(clone(selected));
        } else if (currentIndex >= 0) jobs.splice(currentIndex, 1);
    } else if (job) {
        job[field] = choice === 'merged' ? mergedValue : (choice === 'mine' ? conflict.userValue : conflict.currentValue);
    }
    conflicts.splice(index, 1);
    rebaseOnSharedValue(conflict);
    reportClientProblem('conflict-resolved', undefined, new Error(choice), `field=${field} job=${jobId} left=${conflicts.length} `);
    reportConflictState();
    if (choice === 'mine' || choice === 'merged') autoSave();
    else {
        if (pendingSnapshot) pendingSnapshot = clone(jobs);
        persistPendingChanges();
        emitSync(conflicts.length ? 'conflict' : 'ok');
    }
    applySorting();
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
    if (job['Meeldetuletus X päeva ennem'] == null || job['Meeldetuletus X päeva ennem'] === '') {
        job['Meeldetuletus X päeva ennem'] = '7';
    }
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

const COPY_RESET_BOOLEAN_FIELDS = ['Valmis', 'Alustatud', 'Töötlus Lõpetatud'];
const COPY_RESET_TEXT_FIELDS = ['Valmis kpv', 'Alustamise kpv'];

export function duplicateJob(index) {
    const source = jobs[index];
    if (!source) return false;
    pushUndo();
    const copy = clone(source);
    delete copy._id;
    COPY_RESET_BOOLEAN_FIELDS.forEach(col => copy[col] = false);
    COPY_RESET_TEXT_FIELDS.forEach(col => copy[col] = '');
    const now = new Date();
    copy['Info sisestamise kuupäev'] =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    ensureLocalIds([copy]);
    jobs.push(copy);
    if (sortColumn && sortDirection) {
        reorderJobs(sortColumn, sortDirection, false);
    }
    autoSave();
    return true;
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
                if (lines.length < 1) throw new Error(t('file.empty'));

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
            reject(new Error(t('file.readFailed')));
        };
        reader.readAsArrayBuffer(file);
    });
}
