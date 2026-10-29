// Opt-in vim-style keyboard mode for the table. It is off by default and the
// choice is stored per browser, so other users of the shared data file see no
// change. Keys respond only with the English (US) keyboard layout; with any
// other layout every key types and behaves exactly as without vim mode.
//
// Every key lives in KEYMAP (normal mode) or LEADER (after ","). Key handling,
// the "?" help and the which-key popup are all built from these two tables.
import { getJobs, undo, redo, duplicateJob, pushUndo, autoSave } from './data.js';
import { renderTable, rowGutterWidth, renderTableBody, updateStats, showStatus, sortBy } from './ui.js';
import { editCell, toggleField, deleteRow, openModal, getEditingCell } from './events.js';
import { DATE_COLS } from './config.js';
import { t, columnLabel } from './i18n.js';
import { escapeHTML, matchesUSLayout, parseDate } from './utils.js';
import { isCalendarOpen, moveCalendarFocus, moveCalendarFocusMonths, focusCalendarToday, selectFocusedCalendarDate } from './calendar.js';

const STORAGE_KEY = 'vimMode';
const SEQUENCE_TIMEOUT_MS = 1000;
const DOUBLE_ESCAPE_MS = 500;
const CHORD_TIMEOUT_MS = 300;
const LEADER_KEY = ',';
const STATUS_KEYS = { x: 'Valmis', s: 'Alustatud', m: 'Töötlus Lõpetatud' };
// The cell editor treats this column as a date too, but stores it as typed.
const DATE_LIKE_COLS = [...DATE_COLS, 'Tooriku saabumise kuupäev EE'];
const FILTER_IDS = ['filter-nr', 'filter-koht'];
const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'OS', 'CapsLock', 'AltGraph'];
const CELL_SELECTOR = '#table-body td[data-col], #table-body td[data-checkbox]';
// Popups whose buttons j / k walk through; letter keys press [data-key] buttons.
const NAVIGABLE_POPUPS = ['menu-dropdown', 'sync-popup'];
const BLOCKING_POPUPS = ['conflict-merge-popup', 'confirm-popup'];
const CLOSABLE_POPUPS = ['shortcuts-popup', 'info-popup', 'font-size-popup'];
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'];

let enabled = readEnabled();
// null while unknown: without the Keyboard API each key is judged on its own.
let layoutEnglish = null;
const layoutApi = typeof navigator !== 'undefined' && typeof navigator.keyboard?.getLayoutMap === 'function';
// Remembered by job id and column so it survives re-renders, sorting and polls;
// the positions are the fallback when that row or column is gone.
let cursor = null;
let pending = '';
let pendingTimer = null;
// Count typed before a motion, as in vim: "5j", "10G".
let count = '';
let lastEscapeAt = 0;
let yankedId = null;
let lastJAt = 0;
// Keys typed after the leader, e.g. [] right after "," and ['v'] after ",v".
let leaderPath = null;

// ---- Key tables -------------------------------------------------------------

// Each row is one line of the "?" help. `bindings` maps a key, a sequence
// ("gg") or a Ctrl key ("C-d") to its action; the action gets the typed count
// (0 when none). Rows without bindings are handled where noted.
const KEYMAP = [
    { group: 'move', keys: 'h j k l', label: 'vim.move', bindings: {
        h: n => moveCol(-(n || 1)), l: n => moveCol(n || 1), j: n => moveRow(n || 1), k: n => moveRow(-(n || 1)),
        ArrowLeft: n => moveCol(-(n || 1)), ArrowRight: n => moveCol(n || 1),
        ArrowDown: n => moveRow(n || 1), ArrowUp: n => moveRow(-(n || 1))
    } },
    // Counts are collected in handleVimKeydown.
    { group: 'move', keys: '5j / 3k', label: 'vim.count' },
    { group: 'move', keys: 'w / b', label: 'vim.word', bindings: { w: n => moveWord(1, n || 1), b: n => moveWord(-1, n || 1) } },
    { group: 'move', keys: 'gg / G / 10G', label: 'vim.rows', bindings: {
        gg: n => moveRow(n ? n - 1 : 0, true), G: n => moveRow(n ? n - 1 : tableRows().length - 1, true)
    } },
    { group: 'move', keys: '0 / $', label: 'vim.cols', bindings: { 0: () => moveCol(0, true), $: () => moveCol(Number.MAX_SAFE_INTEGER, true) } },
    { group: 'move', keys: 'Ctrl+D / Ctrl+U', label: 'vim.halfPage', bindings: {
        'C-d': () => scrollRows(halfPage()), 'C-u': () => scrollRows(-halfPage())
    } },
    { group: 'move', keys: 'PageDown / PageUp', label: 'vim.page', bindings: {
        PageDown: () => scrollRows(pageRows()), PageUp: () => scrollRows(-pageRows())
    } },
    { group: 'move', keys: 'zz', label: 'vim.center', bindings: { zz: centerRow } },
    { group: 'move', keys: ']c / [c', label: 'vim.conflictJump', bindings: { ']c': () => jumpConflict(1), '[c': () => jumpConflict(-1) } },

    { group: 'edit', keys: 'i / Enter', label: 'vim.edit', bindings: { i: editOrToggle, Enter: editOrToggle } },
    // Handled by isLeaveInsertChord in the editor and the filter boxes.
    { group: 'edit', keys: 'jk', label: 'vim.leaveInsert' },
    { group: 'edit', keys: 'Space', label: 'vim.toggle', bindings: { ' ': toggleCheckboxUnderCursor } },
    { group: 'edit', keys: 'x / s / m', label: 'vim.status', bindings: {
        x: () => toggleStatus(STATUS_KEYS.x), s: () => toggleStatus(STATUS_KEYS.s), m: () => toggleStatus(STATUS_KEYS.m)
    } },
    { group: 'edit', keys: 't', label: 'vim.today', bindings: { t: setToday } },
    { group: 'edit', keys: 'gd', label: 'vim.calendar', bindings: { gd: openCalendar } },
    { group: 'edit', keys: 'o', label: 'vim.newJob', bindings: { o: () => openModal() } },
    { group: 'edit', keys: 'dd', label: 'vim.delete', bindings: { dd: deleteCursorRow } },
    { group: 'edit', keys: 'yy / p', label: 'vim.copy', bindings: { yy: yankRow, p: pasteRow } },
    { group: 'edit', keys: 'u / Ctrl+R', label: 'vim.undoRedo', bindings: {
        u: () => undoChange(false), 'C-r': () => undoChange(true), 'C-y': () => undoChange(true)
    } },

    { group: 'find', keys: '/', label: 'vim.search', bindings: { '/': () => focusFilter('filter-nr') } },
    { group: 'find', keys: 'f', label: 'vim.searchKoht', bindings: { f: () => focusFilter('filter-koht') } },
    { group: 'find', keys: 'g1 … g6', label: 'vim.pills', bindings: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => ['g' + n, () => pressPill(n)])) },
    // Handled in handleVimKeydown, which tells it apart from an Esc that closes a popup.
    { group: 'find', keys: 'Esc Esc', label: 'vim.clearFilters' },
    { group: 'find', keys: '!', label: 'vim.conflicts', bindings: { '!': () => window.openConflicts?.() } },
    { group: 'find', keys: '?', label: 'vim.help', bindings: { '?': toggleShortcuts } },

    // Handled in handlePopupKey, handleConfirmKey and handleCalendarKey.
    { group: 'popup', keys: 'j / k', label: 'vim.popupNav' },
    { group: 'popup', keys: 'y / n', label: 'vim.confirm' },
    { group: 'popup', keys: 's / m / b / r', label: 'vim.syncKeys' },
    { group: 'popup', keys: 'hjkl H L t', label: 'vim.calendarKeys' },
    { group: 'leader', keys: ',', label: 'vim.leaderOpen', bindings: { [LEADER_KEY]: openLeader } }
];

// Keys after ",". A row with `children` opens the next level of the which-key popup.
const LEADER = [
    { keys: 't', text: () => 'TOS', run: () => clickId('btn-filter-tos') },
    { keys: 'k', text: () => 'Karusel', run: () => clickId('btn-filter-karusel') },
    { keys: 'n', label: 'filter.noDate', run: () => clickId('btn-filter-no-date') },
    { keys: 'b', label: 'filter.blank', run: () => clickId('show-blank-koht') },
    { keys: 'm', label: 'vim.leader.menu', run: openMenu },
    { keys: 'v', label: 'vim.leader.view', children: [
        { keys: 'd', label: 'toolbar.dates', run: () => clickId('show-hidden-dates') },
        { keys: 'c', label: 'toolbar.completed', run: () => clickId('show-completed') },
        { keys: 'a', label: 'toolbar.allhanke', run: () => clickId('show-allhankes') }
    ] },
    { keys: 's', label: 'vim.leader.sort', children: [
        ['d', 'Detaili/koostu nimetus või joonise Nr'],
        ['e', 'EE vajaduse kuupäev (koostamiseks valmis kujul)'],
        ['m', 'Töötluse algus']
    ].map(([keys, col]) => ({ keys, text: () => columnLabel(col), run: () => sortBy(col) })) }
];

const BINDINGS = new Map(KEYMAP.flatMap(row => Object.entries(row.bindings || {})));
// First keys of multi-key sequences ("gg", "]c"); named keys like "Enter" are single keys.
const SEQUENCE_STARTS = new Set([...BINDINGS.keys()]
    .filter(key => key.length > 1 && !key.startsWith('C-') && !/^[A-Z][A-Za-z]+$/.test(key))
    .map(key => key[0]));

// ---- State and layout -------------------------------------------------------

function readEnabled() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function isVimEnabled() {
    return enabled;
}

export function setVimEnabled(next) {
    enabled = !!next;
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {}
    clearPending();
    closeLeader();
    if (enabled) refreshLayout();
    renderVimMenuItem();
    renderVimIndicator();
    renderVimShortcuts();
}

function isActive() {
    return enabled && layoutEnglish !== false;
}

async function refreshLayout() {
    if (!layoutApi) return;
    try {
        const map = await navigator.keyboard.getLayoutMap();
        if (!map || !map.size) return;
        const english = map.get('KeyQ') === 'q' && map.get('KeyY') === 'y' && map.get('BracketLeft') === '['
            && map.get('Semicolon') === ';' && map.get('Slash') === '/';
        if (english !== layoutEnglish) {
            layoutEnglish = english;
            if (!english) closeLeader();
            renderVimIndicator();
        }
    } catch {}
}

// Plain keys only, typed with the English layout.
function isPlainEnglishKey(e) {
    return isActive() && !e.ctrlKey && !e.altKey && !e.metaKey && matchesUSLayout(e);
}

// ---- Table cursor -----------------------------------------------------------

function tableBody() {
    return document.getElementById('table-body');
}

function tableRows() {
    return [...tableBody().rows];
}

function rowCells(row) {
    return row ? [...row.querySelectorAll('td[data-col], td[data-checkbox]')] : [];
}

function cellCol(td) {
    return (td.dataset.col ?? td.dataset.checkbox ?? '').replace(/\\'/g, "'");
}

function focusedCell() {
    return document.activeElement?.closest?.(CELL_SELECTOR) || null;
}

function findCursorCell() {
    const rows = tableRows();
    if (!rows.length) return null;
    if (!cursor) return rowCells(rows[0])[0] || null;
    let row = null;
    if (cursor.jobId) {
        const index = getJobs().findIndex(job => job._id === cursor.jobId);
        if (index >= 0) row = tableBody().querySelector(`tr[data-index="${index}"]`);
    }
    if (!row) row = rows[Math.min(cursor.rowPos, rows.length - 1)];
    const cells = rowCells(row);
    return cells.find(cell => cellCol(cell) === cursor.col) || cells[Math.min(cursor.colPos, cells.length - 1)] || null;
}

function remember(td) {
    const row = td.parentElement;
    const index = parseInt(td.dataset.index, 10);
    cursor = {
        jobId: getJobs()[index]?._id ?? null,
        col: cellCol(td),
        rowPos: tableRows().indexOf(row),
        colPos: rowCells(row).indexOf(td)
    };
}

// Scrolls the table so the cell is clear of the sticky header and columns.
function ensureVisible(td) {
    const wrap = td.closest('.table-wrap');
    if (!wrap) return;
    const view = wrap.getBoundingClientRect();
    const headerBottom = wrap.querySelector('thead')?.getBoundingClientRect().bottom ?? view.top;
    const bottom = view.top + wrap.clientTop + wrap.clientHeight;
    let rect = td.getBoundingClientRect();
    if (rect.top < headerBottom) wrap.scrollTop -= headerBottom - rect.top;
    else if (rect.bottom > bottom) wrap.scrollTop += Math.min(rect.bottom - bottom, rect.top - headerBottom);
    if (td.classList.contains('sticky-col')) return;
    let stickyRight = view.left + wrap.clientLeft;
    td.parentElement.querySelectorAll('.sticky-col').forEach(cell => {
        stickyRight = Math.max(stickyRight, cell.getBoundingClientRect().right);
    });
    const right = view.left + wrap.clientLeft + wrap.clientWidth;
    rect = td.getBoundingClientRect();
    if (rect.left < stickyRight) wrap.scrollLeft -= stickyRight - rect.left;
    else if (rect.right > right) wrap.scrollLeft += Math.min(rect.right - right, rect.left - stickyRight);
}

function moveTo(td) {
    if (!td) return;
    td.focus({ preventScroll: true });
    remember(td);
    ensureVisible(td);
}

// The first movement key only shows the cursor where it was left.
function moveRow(delta, absolute = false) {
    const td = focusedCell();
    if (!td) return moveTo(findCursorCell());
    const rows = tableRows();
    const from = rows.indexOf(td.parentElement);
    const target = rows[Math.max(0, Math.min(rows.length - 1, absolute ? delta : from + delta))];
    const cells = rowCells(target);
    const colPos = rowCells(td.parentElement).indexOf(td);
    moveTo(cells.find(cell => cellCol(cell) === cellCol(td)) || cells[Math.min(colPos, cells.length - 1)]);
}

function moveCol(delta, absolute = false) {
    const td = focusedCell();
    if (!td) return moveTo(findCursorCell());
    const cells = rowCells(td.parentElement);
    const from = cells.indexOf(td);
    moveTo(cells[Math.max(0, Math.min(cells.length - 1, absolute ? delta : from + delta))]);
}

// w / b: next / previous text cell, continuing on the next / previous row.
function moveWord(step, times) {
    const td = focusedCell();
    if (!td) return moveTo(findCursorCell());
    const all = tableRows().flatMap(rowCells);
    let at = all.indexOf(td);
    for (let n = 0; n < times; n++) {
        let next = at + step;
        while (next >= 0 && next < all.length && !all[next].dataset.col) next += step;
        if (next < 0 || next >= all.length) break;
        at = next;
    }
    moveTo(all[at]);
}

function pageRows() {
    const wrap = document.querySelector('.table-wrap');
    const row = tableBody().rows[0];
    if (!wrap || !row) return 1;
    const header = wrap.querySelector('thead')?.offsetHeight || 0;
    return Math.max(1, Math.floor((wrap.clientHeight - header) / Math.max(1, row.offsetHeight)) - 1);
}

// nvim's Ctrl+D / Ctrl+U move half a screen; PageDown / PageUp a whole one.
function halfPage() {
    return Math.max(1, Math.floor((pageRows() + 1) / 2));
}

// Like nvim, the view scrolls by the same rows as the cursor, so the cursor
// keeps its place on screen (until the top or bottom of the table).
function scrollRows(delta) {
    const before = focusedCell()?.getBoundingClientRect().top;
    moveRow(delta);
    const td = focusedCell();
    const wrap = td?.closest('.table-wrap');
    if (before === undefined || !wrap) return;
    // Scroll by the distance the cursor actually moved on screen (row
    // heights vary); the browser clamps at the top and bottom of the table
    // and snaps the offset to whole device pixels, so a fractional cursor
    // position needs a second pass to converge. The loop guards against
    // hidden rounding quirks with a small iteration budget.
    // The browser snaps scroll offsets to whole device pixels while row
    // pitches can be fractional (Linux font metrics), so the first pass can
    // leave a sub-pixel drift; finer passes converge while they still move
    // the offset.
    for (let pass = 0; pass < 3; pass++) {
        const drift = td.getBoundingClientRect().top - before;
        if (Math.abs(drift) < 0.5) break;
        const scroll = wrap.scrollTop;
        wrap.scrollTop += drift;
        if (wrap.scrollTop === scroll) break;
    }
}

function centerRow() {
    const td = targetCell();
    const wrap = td?.closest('.table-wrap');
    if (!wrap) return;
    const view = wrap.getBoundingClientRect();
    const headerBottom = wrap.querySelector('thead')?.getBoundingClientRect().bottom ?? view.top;
    const middle = headerBottom + (view.top + wrap.clientTop + wrap.clientHeight - headerBottom) / 2;
    const row = td.parentElement.getBoundingClientRect();
    wrap.scrollTop += row.top + row.height / 2 - middle;
}

function jumpConflict(step) {
    const rows = tableRows();
    const td = targetCell();
    const from = td ? rows.indexOf(td.parentElement) : (step > 0 ? -1 : 0);
    for (let n = 1; n <= rows.length; n++) {
        const row = rows[((from + step * n) % rows.length + rows.length) % rows.length];
        if (row.classList.contains('row-conflict')) {
            moveRow(rows.indexOf(row), true);
            return;
        }
    }
    showStatus(t('vim.toastNoConflicts'), 'info');
}

function targetCell() {
    const td = focusedCell() || findCursorCell();
    if (td && td !== document.activeElement) moveTo(td);
    return td;
}

function rowIndex(td) {
    return parseInt(td.parentElement.dataset.index, 10);
}

// ---- Normal-mode actions ----------------------------------------------------

function toggleCheckbox(td) {
    const box = td.querySelector('input[type="checkbox"]');
    if (box) toggleField(rowIndex(td), cellCol(td), !box.checked);
}

function toggleCheckboxUnderCursor() {
    const td = targetCell();
    if (td?.dataset.checkbox) toggleCheckbox(td);
}

function editOrToggle() {
    const td = targetCell();
    if (!td) return;
    if (td.dataset.checkbox) toggleCheckbox(td);
    else editCell(td, rowIndex(td), cellCol(td));
}

function toggleStatus(col) {
    const td = targetCell();
    if (!td) return;
    const index = rowIndex(td);
    toggleField(index, col, !getJobs()[index][col]);
}

function dateCellUnderCursor() {
    const td = targetCell();
    if (td && DATE_LIKE_COLS.includes(cellCol(td))) return td;
    showStatus(t('vim.toastNotDate'), 'error');
    return null;
}

function setToday() {
    const td = dateCellUnderCursor();
    if (!td) return;
    const col = cellCol(td);
    const now = new Date();
    const display = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + now.getFullYear();
    pushUndo();
    getJobs()[rowIndex(td)][col] = DATE_COLS.includes(col) ? parseDate(display) : display;
    autoSave();
    renderTableBody();
    updateStats();
}

// Opens the cell editor with its calendar; the calendar keys then pick a date.
function openCalendar() {
    const td = dateCellUnderCursor();
    if (!td) return;
    editCell(td, rowIndex(td), cellCol(td));
    document.querySelector('.floating-editor .calendar-edit-btn')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

function deleteCursorRow() {
    const td = targetCell();
    if (td) deleteRow(rowIndex(td));
}

function yankRow() {
    const td = targetCell();
    if (!td) return;
    yankedId = getJobs()[rowIndex(td)]?._id ?? null;
    if (yankedId) showStatus(t('vim.toastYanked'), 'success');
}

function pasteRow() {
    const jobs = getJobs();
    const index = yankedId ? jobs.findIndex(job => job._id === yankedId) : -1;
    if (index < 0) {
        showStatus(t('vim.toastNothingYanked'), 'error');
        return;
    }
    const before = new Set(jobs.map(job => job._id));
    if (!duplicateJob(index)) return;
    const copy = getJobs().find(job => !before.has(job._id));
    if (copy) cursor = { ...(cursor || { col: '', rowPos: 0, colPos: 0 }), jobId: copy._id };
    renderTable();
    updateStats();
    showStatus(t('toast.rowCopied'), 'success');
}

function undoChange(redoing) {
    if (!(redoing ? redo() : undo())) return;
    renderTable();
    updateStats();
    showStatus(t(redoing ? 'vim.toastRedone' : 'toast.undone'), 'success');
}

function focusFilter(id) {
    const filter = document.getElementById(id);
    if (!filter) return;
    filter.focus();
    filter.select();
}

// "?" shows only the vim keys; Menu → Shortcuts shows the default ones.
function toggleShortcuts() {
    const popup = document.getElementById('shortcuts-popup');
    if (!popup) return;
    const open = popup.style.display !== 'none' && popup.dataset.view === 'vim';
    popup.dataset.view = 'vim';
    popup.style.display = open ? 'none' : 'block';
}

// g1 … g6 press the status pills in order: Aktiivsed (resets all filters),
// Töös, Töödeldud, Allhanke, Hilinenud, Valmis.
function pressPill(number) {
    document.querySelectorAll('.status-boxes .status-box')[number - 1]?.click();
}

// ---- Leader actions ---------------------------------------------------------

function clickId(id) {
    document.getElementById(id)?.click();
}

function openMenu() {
    const menu = document.getElementById('menu-dropdown');
    if (!menu) return;
    if (menu.style.display === 'none') clickId('btn-menu');
    focusPopupButton(menu, 1);
}

function openLeader() {
    leaderPath = [];
    renderWhichKey();
}

function closeLeader() {
    if (leaderPath === null) return;
    leaderPath = null;
    renderWhichKey();
}

function leaderRows() {
    let rows = LEADER;
    for (const key of leaderPath || []) rows = rows.find(row => row.keys === key)?.children || [];
    return rows;
}

function rowText(row) {
    return row.text ? row.text() : t(row.label);
}

function handleLeaderKey(e) {
    e.preventDefault();
    if (e.key === 'Escape') {
        closeLeader();
        return true;
    }
    const row = leaderRows().find(item => item.keys === e.key);
    if (row?.children) {
        leaderPath.push(e.key);
        renderWhichKey();
        return true;
    }
    closeLeader();
    row?.run();
    return true;
}

// ---- Popups, confirm dialog and calendar --------------------------------------

function isShown(el) {
    return !!el && el.getClientRects().length > 0;
}

function popupButtons(popup) {
    return [...popup.querySelectorAll('button')].filter(button => !button.disabled && isShown(button));
}

function focusPopupButton(popup, step) {
    const buttons = popupButtons(popup);
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    const next = at < 0 ? (step > 0 ? 0 : buttons.length - 1) : (at + step + buttons.length) % buttons.length;
    buttons[next].focus();
}

function openNavigablePopup() {
    return NAVIGABLE_POPUPS.map(id => document.getElementById(id)).find(el => el && el.style.display && el.style.display !== 'none' && isShown(el)) || null;
}

// j / k walk through the popup's buttons, letters press a [data-key] button.
// Enter, Space and Esc keep their usual meaning; after Esc the cursor returns.
function handlePopupKey(e, popup) {
    if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusPopupButton(popup, e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1);
        return true;
    }
    const button = e.key.length === 1 ? popup.querySelector(`button[data-key="${CSS.escape(e.key)}"]`) : null;
    if (button && isShown(button)) {
        e.preventDefault();
        button.click();
        setTimeout(returnToTableIfLost, 0);
        return true;
    }
    if (e.key === 'Escape') setTimeout(returnToTableIfLost, 0);
    return false;
}

function returnToTableIfLost() {
    const active = document.activeElement;
    if (!active || active === document.body || !isShown(active)) moveTo(findCursorCell());
}

// Delete confirmation: y deletes, n cancels, j / k / h / l switch the button.
export function handleConfirmKey(e, okButton, cancelButton) {
    if (!isPlainEnglishKey(e)) return false;
    if (e.key === 'y') okButton.click();
    else if (e.key === 'n') cancelButton.click();
    else if ('hjkl'.includes(e.key)) (document.activeElement === okButton ? cancelButton : okButton).focus();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
}

// While a calendar is open: h / l a day, j / k a week, H / L a month, t today,
// Enter picks. Runs before the editor, so these keys do not type into it.
function handleCalendarKey(e) {
    if (!isCalendarOpen() || !isPlainEnglishKey(e)) return;
    const moves = { h: -1, l: 1, j: 7, k: -7, ArrowLeft: -1, ArrowRight: 1, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in moves) moveCalendarFocus(moves[e.key]);
    else if (e.key === 'H' || e.key === 'L') moveCalendarFocusMonths(e.key === 'H' ? -1 : 1);
    else if (e.key === 't') focusCalendarToday();
    else if (e.key === 'Enter') selectFocusedCalendarDate();
    else return;
    e.preventDefault();
    e.stopPropagation();
}

// ---- Insert-mode chord --------------------------------------------------------

// "jk" typed quickly leaves insert mode, like the common nvim mapping. The 'j'
// has already been typed into the field, so it is taken out again.
export function isLeaveInsertChord(e, field) {
    if (!enabled || layoutEnglish === false || e.ctrlKey || e.altKey || e.metaKey || !matchesUSLayout(e)) {
        lastJAt = 0;
        return false;
    }
    if (e.key === 'j') {
        lastJAt = e.timeStamp;
        return false;
    }
    const chord = e.key === 'k' && lastJAt > 0 && e.timeStamp - lastJAt <= CHORD_TIMEOUT_MS;
    lastJAt = 0;
    if (!chord) return false;
    const pos = field.selectionStart;
    if (pos !== field.selectionEnd || pos < 1 || field.value[pos - 1] !== 'j') return false;
    field.value = field.value.slice(0, pos - 1) + field.value.slice(pos);
    field.setSelectionRange(pos - 1, pos - 1);
    return true;
}

// ---- Key dispatch -------------------------------------------------------------

function setPending(key) {
    pending = key;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
    renderVimIndicator();
}

function clearPending() {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    if (!pending && !count) return;
    pending = '';
    count = '';
    renderVimIndicator();
}

function takeCount() {
    const value = parseInt(count, 10) || 0;
    count = '';
    return value;
}

function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.includes(el.type);
}

function isOpen(id) {
    const el = document.getElementById(id);
    return !!el && !!el.style.display && el.style.display !== 'none';
}

function handleCtrlKey(e) {
    if (e.shiftKey) return false;
    const key = 'C-' + e.key.toLowerCase();
    const action = BINDINGS.get(key);
    if (!action) return false;
    if (key === 'C-r' || key === 'C-y') {
        // Never reload while typing; Ctrl+Y keeps the text field's own redo.
        if (getEditingCell() || isTextEntry(document.activeElement)) {
            if (key === 'C-r') e.preventDefault();
            return key === 'C-r';
        }
    } else if (getEditingCell()) {
        // Paging replaces Ctrl+D duplicate in vim mode, also inside the editor.
        e.preventDefault();
        return true;
    }
    e.preventDefault();
    clearPending();
    action(0);
    return true;
}

function runKey(key, e) {
    if (SEQUENCE_STARTS.has(key)) {
        setPending(key);
        e.preventDefault();
        return true;
    }
    const action = BINDINGS.get(key);
    const n = takeCount();
    if (!action) return false;
    e.preventDefault();
    action(n);
    return true;
}

// Returns true when vim mode handled the key, so the default handler must skip it.
export function handleVimKeydown(e) {
    if (!enabled || e.altKey || e.metaKey) return false;
    // Shift on its own (before "G", "$", "?") must not cancel a count or sequence.
    if (MODIFIER_KEYS.includes(e.key)) return false;
    if (document.getElementById('modal')?.classList.contains('active')) return false;
    // Already handled by the editor (Enter/Escape there return focus to the cell,
    // which must not reopen it).
    if (e.defaultPrevented) return true;
    if (layoutEnglish === false || !matchesUSLayout(e)) {
        if (layoutApi && layoutEnglish !== false && !matchesUSLayout(e)) {
            layoutEnglish = false;
            closeLeader();
            renderVimIndicator();
        }
        refreshLayout();
        return false;
    }
    if (leaderPath !== null && !e.ctrlKey) return handleLeaderKey(e);
    if (e.ctrlKey) return handleCtrlKey(e);
    if (getEditingCell()) return false;

    const popup = openNavigablePopup();
    if (popup) return handlePopupKey(e, popup);
    if (BLOCKING_POPUPS.some(isOpen) || isCalendarOpen()) return false;

    // A focused element that has just been hidden (a closed menu) counts as none.
    const focused = document.activeElement;
    const active = focused && isShown(focused) ? focused : document.body;
    const inFilter = FILTER_IDS.includes(active.id);
    if (inFilter && isLeaveInsertChord(e, active)) {
        e.preventDefault();
        active.dispatchEvent(new Event('input'));
        moveTo(findCursorCell());
        return true;
    }
    if (inFilter && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        if (e.key === 'Enter') {
            cursor = cursor ? { ...cursor, jobId: null, rowPos: 0 } : null;
        }
        moveTo(findCursorCell());
        return true;
    }
    if (isTextEntry(active)) return false;
    if (e.key === 'Escape') {
        if (pending || count) {
            clearPending();
            e.preventDefault();
            return true;
        }
        // An Esc that closes a popup never counts towards Esc Esc.
        if (CLOSABLE_POPUPS.some(id => document.getElementById(id)?.style.display === 'block')) {
            lastEscapeAt = 0;
            return false;
        }
        // Esc Esc clears every filter, like clicking "Aktiivsed".
        if (e.timeStamp - lastEscapeAt <= DOUBLE_ESCAPE_MS) {
            lastEscapeAt = 0;
            pressPill(1);
            e.preventDefault();
            return true;
        }
        lastEscapeAt = e.timeStamp;
        return false;
    }
    // Enter and Space keep activating a focused button or toolbar checkbox.
    const outsideTable = active !== document.body && !active.closest('#table-body');
    if ((e.key === 'Enter' || e.key === ' ') && outsideTable) return false;

    if (pending) {
        const sequence = pending + e.key;
        pending = '';
        clearTimeout(pendingTimer);
        const action = BINDINGS.get(sequence);
        if (action) {
            e.preventDefault();
            action(takeCount());
            renderVimIndicator();
            return true;
        }
        count = '';
        renderVimIndicator();
    }
    // A count starts with 1-9; a leading 0 is "first column".
    if (/^[1-9]$/.test(e.key) || (e.key === '0' && count)) {
        count += e.key;
        e.preventDefault();
        renderVimIndicator();
        return true;
    }
    const handled = runKey(e.key, e);
    renderVimIndicator();
    return handled;
}

// A re-render replaces every cell; put the cursor back unless the user is
// working somewhere else (a filter box, a popup, the editor).
function onTableRendered() {
    restoreCursor();
    if (enabled) renderVimIndicator();
}

function restoreCursor() {
    if (!enabled || !cursor || getEditingCell()) return;
    if (document.getElementById('modal')?.classList.contains('active')) return;
    const active = document.activeElement;
    if (active && active !== document.body && !tableBody().contains(active)) return;
    const td = findCursorCell();
    if (!td) return;
    td.focus({ preventScroll: true });
    remember(td);
}

// ---- Rendering ----------------------------------------------------------------

export function renderVimMenuItem() {
    const item = document.getElementById('menu-vim-mode');
    if (!item) return;
    const label = escapeHTML(t('menu.vimMode'));
    item.innerHTML = enabled ? label + ' <span class="menu-item-dot"></span>' : label;
    item.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

// Statusline under the table: mode, pending keys (showcmd) and the cursor
// position (ruler), like nvim's.
function renderVimIndicator() {
    document.body.classList.toggle('vim-on', enabled);
    syncGutter();
    const el = document.getElementById('vim-indicator');
    if (!el) return;
    el.hidden = !enabled;
    if (!enabled) return;
    const blocked = layoutEnglish === false;
    const insert = !blocked && !!document.querySelector('.floating-editor');
    el.classList.toggle('is-blocked', blocked);
    el.classList.toggle('is-insert', insert);
    el.querySelector('.vim-mode').textContent = blocked ? t('vim.layoutBadge') : (insert ? 'INSERT' : 'NORMAL');
    const typed = leaderPath !== null ? LEADER_KEY + leaderPath.join('') : count + pending;
    el.querySelector('.vim-showcmd').textContent = blocked ? t('vim.layoutTooltip') : typed;
    // The editor holds focus in INSERT mode, so fall back to the edited cell.
    const td = focusedCell() || getEditingCell()?.td;
    el.querySelector('.vim-ruler').textContent = td?.isConnected && !blocked ? rulerText(td) : '';
    renderRowNumbers(td?.isConnected ? td.parentElement : null);
}

// nvim's number + relativenumber in the left gutter: the cursor row shows its
// own number, every other row its distance from it (absolute without a cursor).
function renderRowNumbers(current) {
    const rows = tableRows();
    const at = rows.indexOf(current);
    rows.forEach((row, i) => {
        const gutter = row.cells[0];
        if (!gutter?.classList.contains('row-indicator')) return;
        const text = String(at < 0 || i === at ? i + 1 : Math.abs(i - at));
        const inner = gutter.querySelector('.cell-inner');
        if (inner && inner.dataset.rel !== text) inner.dataset.rel = text;
        gutter.classList.toggle('is-cursor-row', i === at);
    });
}

// The gutter width depends on vim mode, so the header and columns re-render.
function syncGutter() {
    const col = document.querySelector('#jobs-table colgroup col');
    if (col && col.style.width !== rowGutterWidth() + 'px') renderTable(true);
}

// "Column  row,col  pos", like nvim's ruler: pos is All, Top, Bot or the
// row's position through the visible rows in percent.
function rulerText(td) {
    const rows = tableRows();
    const row = rows.indexOf(td.parentElement) + 1;
    const col = rowCells(td.parentElement).indexOf(td) + 1;
    const pos = rows.length <= 1 ? 'All' : row === 1 ? 'Top' : row === rows.length ? 'Bot'
        : Math.round(row / rows.length * 100) + '%';
    return columnLabel(cellCol(td)) + '  ' + row + ',' + col + '  ' + pos;
}

function keyRows(rows, prefix = '') {
    return rows.map(row => '<span class="key">' + escapeHTML(prefix + row.keys) + '</span><span>'
        + escapeHTML(rowText(row) + (row.children ? ' …' : '')) + '</span>').join('');
}

// Which-key popup: the keys that can follow the leader keys typed so far.
function renderWhichKey() {
    renderVimIndicator();
    const popup = document.getElementById('vim-whichkey');
    if (!popup) return;
    popup.hidden = leaderPath === null;
    if (leaderPath === null) return;
    const parent = leaderPath.length ? LEADER.find(row => row.keys === leaderPath[0]) : null;
    popup.innerHTML = '<div class="shortcuts-title">' + escapeHTML(LEADER_KEY + leaderPath.join('') + '  ' + (parent ? rowText(parent) : t('vim.leaderTitle')))
        + '</div><div class="shortcuts-grid">' + keyRows(leaderRows()) + '</div>';
}

// "?" help, generated from KEYMAP and LEADER.
function renderVimHelp() {
    const help = document.getElementById('shortcuts-vim');
    if (!help) return;
    const group = name => '<div class="shortcuts-group">' + escapeHTML(t('vim.group.' + name)) + '</div><div class="shortcuts-grid">'
        + keyRows(KEYMAP.filter(row => row.group === name))
        + (name === 'leader' ? keyRows(LEADER, LEADER_KEY + ' ') : '') + '</div>';
    help.innerHTML = '<div class="shortcuts-title">' + escapeHTML(t('vim.title')) + '</div>'
        + '<div class="shortcuts-columns"><div>' + group('move') + group('find') + group('popup') + '</div>'
        + '<div>' + group('edit') + group('leader') + '</div></div>';
}

function renderVimShortcuts() {
    const hint = document.getElementById('shortcuts-vim-hint');
    if (hint) hint.hidden = !enabled;
    renderVimHelp();
}

export function initVim() {
    window.addEventListener('jobs-table-rendered', onTableRendered);
    window.addEventListener('jobs-language-changed', () => {
        renderVimMenuItem();
        renderVimIndicator();
        renderVimHelp();
        renderWhichKey();
    });
    // Switching layout (Win+Space, Alt+Shift) or windows re-checks the layout.
    window.addEventListener('focus', () => { if (enabled) refreshLayout(); });
    document.addEventListener('keyup', e => {
        if (enabled && ['Meta', 'OS', 'Alt', 'Shift', 'Control'].includes(e.key)) refreshLayout();
    });
    document.addEventListener('keydown', handleCalendarKey, true);
    document.addEventListener('focusin', e => {
        const td = e.target.closest?.(CELL_SELECTOR);
        if (td) remember(td);
        if (enabled) renderVimIndicator();
    });
    document.addEventListener('focusout', () => { if (enabled) renderVimIndicator(); });
    renderVimMenuItem();
    renderVimIndicator();
    renderVimShortcuts();
    if (enabled) refreshLayout();
}
