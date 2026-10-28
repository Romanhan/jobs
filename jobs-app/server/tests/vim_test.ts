import { assert, equal, fixture, job, until } from './helpers.ts';
import { browser } from './browser.ts';

type Browser = Awaited<ReturnType<typeof browser>>;
type Row = Record<string, unknown>;

const CTRL = 2;
const SHIFT = 8;
const US = { KeyQ: 'q', KeyY: 'y', BracketLeft: '[', Semicolon: ';', Slash: '/' };
const RU = { KeyQ: 'й', KeyY: 'н', BracketLeft: 'х', Semicolon: 'ж', Slash: '.' };
// The headless browser's real layout is unknown, so the Keyboard API is stubbed.
const layoutStub = `window.__layout = ${JSON.stringify(US)};
Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { getLayoutMap: async () => new Map(Object.entries(window.__layout)) } });`;
const vimOn = layoutStub + `localStorage.setItem('vimMode', 'true');`;

const DETAIL = 'Detaili/koostu nimetus või joonise Nr';
const NEED = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
const LAST_COL = 'Tegevuse sisestaja nimi';

const SPECIAL: Record<string, [number, string]> = {
  Enter: [13, 'Enter'], Escape: [27, 'Escape'], ' ': [32, 'Space'],
  '$': [52, 'Digit4'], '!': [49, 'Digit1'], '/': [191, 'Slash'], '?': [191, 'Slash'],
  ']': [221, 'BracketRight'], '[': [219, 'BracketLeft'], ',': [188, 'Comma'],
  '+': [187, 'Equal'], '-': [189, 'Minus'],
};
const SHIFTED = new Set(['$', '!', '?', '+']);

// Types a key as the US layout produces it; `physical` overrides the DOM code
// to simulate another layout.
function press(b: Browser, key: string, modifiers = 0, physical = '') {
  const mods = modifiers | (SHIFTED.has(key) || (key.length === 1 && key !== key.toLowerCase()) ? SHIFT : 0);
  if (SPECIAL[key]) return b.key(key, SPECIAL[key][0], mods, physical || SPECIAL[key][1]);
  if (/^\d$/.test(key)) return b.key(key, key.charCodeAt(0), mods, physical || 'Digit' + key);
  const upper = key.toUpperCase();
  return b.key(key, upper.charCodeAt(0), mods, physical || 'Key' + upper);
}

async function type(b: Browser, keys: string) {
  for (const key of keys) await press(b, key);
}

const at = (b: Browser) => b.evaluate(`(() => {
  const td = document.activeElement?.closest?.('#table-body td');
  if (!td) return null;
  return { row: td.parentElement.querySelector('td[data-col="Töö Nr"]').textContent, col: td.dataset.col ?? td.dataset.checkbox };
})()`);
const order = (b: Browser): Promise<string[]> => b.evaluate(`[...document.querySelectorAll('#table-body td[data-col="Töö Nr"]')].map(td => td.textContent)`);
const mode = (b: Browser) => b.evaluate(`document.getElementById('vim-indicator').hidden ? null : document.querySelector('#vim-indicator .vim-mode').textContent`);
const showcmd = (b: Browser) => b.evaluate(`document.querySelector('#vim-indicator .vim-showcmd').textContent`);
const ruler = (b: Browser) => b.evaluate(`document.querySelector('#vim-indicator .vim-ruler').textContent`);
const visible = (b: Browser, selector: string) => b.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && getComputedStyle(el).display !== 'none' && !el.closest('[style*="display: none"]'); })()`);
const cursorId = (b: Browser) => b.evaluate(`(async () => (await import('/js/data.js')).getJobs()[+document.activeElement.closest('tr').dataset.index]._id)()`);
const rowsOf = async (f: Awaited<ReturnType<typeof fixture>>): Promise<Row[]> => await f.read();
const byId = async (f: Awaited<ReturnType<typeof fixture>>, id: string) => (await rowsOf(f)).find(row => row._id === id)!;

Deno.test('vim: off by default; default keys, Ctrl+D duplicate and Russian-layout Ctrl shortcuts unchanged', async () => {
  const f = await fixture([job('a'), job('b')]); const b = await browser();
  try {
    await b.beforeLoad(layoutStub);
    await b.open(f.url);
    equal(await mode(b), null);
    equal(await b.evaluate(`document.getElementById('menu-vim-mode').getAttribute('aria-pressed')`), 'false');
    await b.evaluate(`document.querySelector('#table-body td[data-col="Täitmise koht"]').focus()`);
    const before = await at(b);
    for (const key of ['j', 'k', 'G', 'x', 'o']) await press(b, key);
    equal(await at(b), before);
    assert(!await b.evaluate(`document.getElementById('modal').classList.contains('active')`), 'o does nothing without vim mode');
    await press(b, '?');
    equal(await b.evaluate(`document.getElementById('shortcuts-popup').style.display`), 'none');
    // Menu → Shortcuts lists only the default keys, without the vim hint.
    await b.click('#btn-menu'); await b.click('[data-action="shortcuts"]');
    assert(await visible(b, '#shortcuts-default'), 'default shortcuts shown');
    assert(!await visible(b, '#shortcuts-vim'), 'vim shortcuts hidden');
    assert(!await visible(b, '#shortcuts-vim-hint'), 'no vim hint while vim mode is off');
    await press(b, 'Escape');
    await b.evaluate(`document.querySelector('#table-body td[data-col="Täitmise koht"]').focus()`);
    // Russian layout: Ctrl+D reports key 'в' on the physical D key.
    await b.key('в', 68, CTRL, 'KeyD');
    await until(async () => (await rowsOf(f)).length === 3);
    // Ctrl+Z works on the Russian layout too ('я' on the physical Z key).
    await b.key('я', 90, CTRL, 'KeyZ');
    await until(async () => (await rowsOf(f)).length === 2);
  } finally { await b.close(); await f.close(); }
});

Deno.test('vim: toggle persists; movement, editing, toggles, copy, delete, undo and paging', async () => {
  const f = await fixture([job('a'), job('b'), job('c')]); const b = await browser();
  try {
    await b.beforeLoad(layoutStub);
    await b.open(f.url);
    await b.click('#btn-menu'); await b.click('[data-action="vim-mode"]');
    equal(await b.evaluate(`localStorage.getItem('vimMode')`), 'true');
    equal(await b.evaluate(`document.getElementById('menu-vim-mode').getAttribute('aria-pressed')`), 'true');
    equal(await b.evaluate(`document.getElementById('status-bar').textContent`), 'Vim klahvid sisse lülitatud');
    await b.open(f.url);
    await until(async () => await mode(b) === 'NORMAL');
    const rows = await order(b);
    equal(rows.length, 3);

    // First key shows the cursor, later keys move it; edges clamp.
    await press(b, 'j'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    equal(await ruler(b), 'Töö Nr  1/3');
    await press(b, 'k'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    await press(b, 'h'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    await press(b, 'j'); equal(await at(b), { row: rows[1], col: 'Töö Nr' });
    equal(await ruler(b), 'Töö Nr  2/3');
    await press(b, 'k'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    await press(b, 'l'); equal(await at(b), { row: rows[0], col: 'Valmis' });
    equal(await ruler(b), 'Valmis  1/3');
    await press(b, 'h'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    await b.key('ArrowDown', 40, 0, 'ArrowDown');
    equal(await at(b), { row: rows[1], col: 'Töö Nr' });
    await press(b, 'G'); equal(await at(b), { row: rows[2], col: 'Töö Nr' });
    await press(b, 'j'); equal(await at(b), { row: rows[2], col: 'Töö Nr' });
    await press(b, 'g'); equal(await showcmd(b), 'g');
    await press(b, 'g'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    equal(await showcmd(b), '');
    await press(b, '$'); equal(await at(b), { row: rows[0], col: LAST_COL });
    await press(b, 'l'); equal(await at(b), { row: rows[0], col: LAST_COL });
    await press(b, '0'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    // Esc cancels a pending sequence.
    await press(b, 'd'); equal(await showcmd(b), 'd');
    await press(b, 'Escape'); equal(await showcmd(b), '');
    await press(b, 'd');
    equal(await b.evaluate(`document.getElementById('confirm-popup').style.display`), 'none');
    await press(b, 'Escape');

    // Edit and cancel returns to the same cell; Enter saves.
    await press(b, 'i');
    assert(await b.evaluate(`!!document.querySelector('.floating-editor')`), 'i opens the editor');
    equal(await mode(b), 'INSERT');
    assert(await b.evaluate(`document.getElementById('vim-indicator').classList.contains('is-insert')`), 'insert class');
    await press(b, 'Escape');
    equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    equal(await mode(b), 'NORMAL');
    await press(b, 'Enter');
    await b.evaluate(`document.querySelector('.floating-editor textarea').value = 'Z1'`);
    await press(b, 'Enter');
    await until(async () => (await rowsOf(f)).some(row => row['Töö Nr'] === 'Z1'));
    await until(async () => (await at(b))?.col === 'Töö Nr');
    assert(!await b.evaluate(`!!document.querySelector('.floating-editor')`), 'Enter that saved must not reopen the editor');

    // "jk" typed quickly leaves insert mode and keeps the text; slowly it is just text.
    await press(b, 'g'); await press(b, 'g');
    await press(b, 'l'); await press(b, 'l'); equal((await at(b)).col, DETAIL);
    await press(b, 'i');
    await b.evaluate(`document.querySelector('.floating-editor textarea').value = ''`);
    await type(b, 'xjk');
    await until(async () => (await rowsOf(f)).some(row => row[DETAIL] === 'x'));
    equal(await mode(b), 'NORMAL');
    equal((await at(b)).col, DETAIL);
    await press(b, 'i');
    await press(b, 'j'); await new Promise(resolve => setTimeout(resolve, 400)); await press(b, 'k');
    equal(await b.evaluate(`document.querySelector('.floating-editor textarea').value`), 'xjk');
    await press(b, 'Escape');
    equal(await b.evaluate(`document.querySelector('.floating-editor')`), null);
    assert((await rowsOf(f)).some(row => row[DETAIL] === 'x'), 'Esc cancels without saving');

    // Space on a text cell changes nothing.
    const snapshot = JSON.stringify(await f.read());
    await press(b, ' ');
    await new Promise(resolve => setTimeout(resolve, 200));
    equal(JSON.stringify(await f.read()), snapshot);

    // Ctrl+R redoes like vim and must not reload the page.
    await b.evaluate(`window.__sameDocument = true`);
    await press(b, 'u'); await until(async () => !(await rowsOf(f)).some(row => row[DETAIL] === 'x'));
    await b.key('r', 82, CTRL, 'KeyR');
    await until(async () => (await rowsOf(f)).some(row => row[DETAIL] === 'x'));
    equal(await b.evaluate(`window.__sameDocument === true`), true);
    // Ctrl+R inside the editor must not reload either.
    await press(b, 'i');
    await b.key('r', 82, CTRL, 'KeyR');
    equal(await b.evaluate(`window.__sameDocument === true`), true);
    await press(b, 'Escape');

    // Status toggles act on the cursor row from any column.
    await press(b, '0');
    const id = await cursorId(b);
    const field = async (name: string) => (await byId(f, id))[name];
    await press(b, 's'); await until(async () => await field('Alustatud') === true);
    await press(b, 's'); await until(async () => await field('Alustatud') === false);
    await press(b, 'm'); await until(async () => await field('Töötlus Lõpetatud') === true);
    await press(b, 'm'); await until(async () => await field('Töötlus Lõpetatud') === false);
    await press(b, 'l'); equal((await at(b)).col, 'Valmis');
    await press(b, ' '); await until(async () => await field('Valmis') === true);
    // The finished row is hidden; the cursor stays at the same position.
    equal((await at(b)).col, 'Valmis');
    equal((await order(b)).length, 2);
    await press(b, 'u'); await until(async () => !await field('Valmis'));
    await b.key('y', 89, CTRL, 'KeyY'); await until(async () => await field('Valmis') === true);
    await press(b, 'u'); await until(async () => !await field('Valmis'));
    await press(b, 'g'); await press(b, 'g'); await press(b, '0');
    const xId = await cursorId(b);
    await press(b, 'x'); await until(async () => (await byId(f, xId)).Valmis === true);
    assert((await byId(f, xId))['Valmis kpv'], 'x fills the completion date');
    await press(b, 'u'); await until(async () => !(await byId(f, xId)).Valmis);

    // yy p adds a duplicate and moves the cursor onto it.
    await press(b, 'g'); await press(b, 'g'); await press(b, '0');
    await press(b, 'p');
    equal(await b.evaluate(`document.getElementById('status-bar').textContent`), 'Kopeeri rida enne klahvidega yy');
    await press(b, 'y'); await press(b, 'y');
    equal(await b.evaluate(`document.getElementById('status-bar').textContent`), 'Rida kopeeritud — p lisab koopia');
    const yanked = await cursorId(b);
    await press(b, 'p');
    await until(async () => (await rowsOf(f)).length === 4);
    const copyId = await cursorId(b);
    assert(![yanked, 'a', 'b', 'c'].includes(copyId), 'Cursor moves to the new copy');
    equal((await byId(f, copyId))['Töö Nr'], (await byId(f, yanked))['Töö Nr']);

    // dd asks first: cancel keeps the row and the cursor, OK deletes.
    await press(b, 'd'); await press(b, 'd');
    equal(await b.evaluate(`document.getElementById('confirm-popup').style.display`), 'flex');
    await b.click('#confirm-cancel');
    equal(await cursorId(b), copyId);
    equal((await rowsOf(f)).length, 4);
    await press(b, 'd'); await press(b, 'd');
    await b.click('#confirm-ok');
    await until(async () => (await rowsOf(f)).length === 3);
    assert(!(await rowsOf(f)).some(row => row._id === copyId), 'dd deletes the cursor row');
    assert(await at(b), 'Cursor stays in the table after deleting');

    // Ctrl+D / Ctrl+U page instead of duplicating.
    await press(b, 'g'); await press(b, 'g');
    await b.key('d', 68, CTRL, 'KeyD');
    equal((await at(b)).row, (await order(b))[2]);
    await b.key('u', 85, CTRL, 'KeyU');
    equal((await at(b)).row, (await order(b))[0]);
    await b.key('u', 85, CTRL, 'KeyU');
    equal((await at(b)).row, (await order(b))[0]);
    await new Promise(resolve => setTimeout(resolve, 300));
    equal((await rowsOf(f)).length, 3);

    // Search box: "jk" and Esc return to the table, Enter goes to the first row.
    await press(b, 'G');
    await press(b, '/');
    equal(await b.evaluate(`document.activeElement.id`), 'filter-nr');
    await type(b, 'jk');
    assert(await at(b), 'jk leaves the search box for the table');
    equal(await b.evaluate(`document.getElementById('filter-nr').value`), '');
    await press(b, '/');
    await press(b, 'Escape');
    equal((await at(b)).row, (await order(b))[2]);
    await press(b, '/');
    await press(b, 'Enter');
    equal((await at(b)).row, (await order(b))[0]);

    // "?" shows only the vim keys; Menu → Shortcuts only the default keys plus a hint.
    await press(b, '?');
    equal(await b.evaluate(`document.getElementById('shortcuts-popup').style.display`), 'block');
    assert(await visible(b, '#shortcuts-vim'), 'vim keys shown');
    assert(!await visible(b, '#shortcuts-default'), 'default keys hidden from the vim help');
    await press(b, '?');
    equal(await b.evaluate(`document.getElementById('shortcuts-popup').style.display`), 'none');
    await press(b, '?');
    await press(b, 'Escape');
    equal(await b.evaluate(`document.getElementById('shortcuts-popup').style.display`), 'none');
    await b.click('#btn-menu'); await b.click('[data-action="shortcuts"]');
    assert(await visible(b, '#shortcuts-default'), 'default keys in Menu → Shortcuts');
    assert(!await visible(b, '#shortcuts-vim'), 'vim keys not in Menu → Shortcuts');
    assert(await visible(b, '#shortcuts-vim-hint'), 'vim hint in Menu → Shortcuts');
    await press(b, 'Escape');

    // o opens the add dialog; Esc returns to the cell.
    await b.evaluate(`document.querySelector('#table-body td[data-col="Töö Nr"]').focus()`);
    const before = await at(b);
    await press(b, 'o');
    assert(await b.evaluate(`document.getElementById('modal').classList.contains('active')`), 'o opens the add dialog');
    await press(b, 'j');
    equal(await b.evaluate(`document.activeElement.getAttribute('name')`), 'Töö Nr');
    equal(await b.evaluate(`document.activeElement.value`), 'j');
    await press(b, 'Escape');
    equal(await at(b), before);

    // Turning it off restores Ctrl+D duplicate and hides the statusline.
    await b.click('#btn-menu'); await b.click('[data-action="vim-mode"]');
    equal(await mode(b), null);
    equal(await b.evaluate(`localStorage.getItem('vimMode')`), 'false');
    await b.evaluate(`document.querySelector('#table-body td[data-col="Täitmise koht"]').focus()`);
    await b.key('d', 68, CTRL, 'KeyD');
    await until(async () => (await rowsOf(f)).length === 4);
  } finally { await b.close(); await f.close(); }
});

Deno.test('vim: counts, w/b, zz, today, filters, status pills and conflict jumps', async () => {
  const ids = Array.from({ length: 40 }, (_, i) => String(i + 1).padStart(2, '0'));
  const f = await fixture(ids.map((id, i) => job(id, i % 4 === 0 ? { Alustatud: true } : {})));
  const b = await browser();
  try {
    await b.viewport(1024, 600);
    await b.beforeLoad(vimOn);
    await b.open(f.url);
    await until(async () => await mode(b) === 'NORMAL');
    const rows = await order(b);
    equal(rows.length, 40);
    await press(b, 'j');
    equal(await at(b), { row: rows[0], col: 'Töö Nr' });

    // Counts repeat motions and pick rows; the statusline shows the count.
    await press(b, '5'); equal(await showcmd(b), '5');
    await press(b, 'j'); equal((await at(b)).row, rows[5]);
    equal(await showcmd(b), '');
    await press(b, '3'); await press(b, 'k'); equal((await at(b)).row, rows[2]);
    await press(b, '1'); await press(b, '0'); equal(await showcmd(b), '10');
    await press(b, 'G'); equal((await at(b)).row, rows[9]);
    equal(await ruler(b), 'Töö Nr  10/40');
    await press(b, '2'); await press(b, 'g'); equal(await showcmd(b), '2g');
    await press(b, 'g'); equal((await at(b)).row, rows[1]);
    await press(b, '9'); await press(b, '9'); await press(b, 'j'); equal((await at(b)).row, rows[39]);
    await press(b, 'g'); await press(b, 'g');
    await press(b, '3'); await press(b, 'l'); equal((await at(b)).col, 'Kommentaar(tooriku/detaili seis, muu oluline info)');
    // A count is dropped by Esc and by an unknown key.
    await press(b, '4'); await press(b, 'Escape'); equal(await showcmd(b), '');
    await press(b, 'j'); equal((await at(b)).row, rows[1]);
    await press(b, 'k');

    // w / b skip checkbox cells and continue on the next / previous row.
    await press(b, '0');
    await press(b, 'w'); equal(await at(b), { row: rows[0], col: DETAIL });
    await press(b, 'b'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });
    await press(b, '$');
    await press(b, 'w'); equal(await at(b), { row: rows[1], col: 'Töö Nr' });
    await press(b, 'b'); equal(await at(b), { row: rows[0], col: LAST_COL });
    await press(b, '2'); await press(b, 'w'); equal(await at(b), { row: rows[1], col: DETAIL });
    await press(b, 'g'); await press(b, 'g'); await press(b, '0');
    await press(b, 'b'); equal(await at(b), { row: rows[0], col: 'Töö Nr' });

    // zz centers the cursor row in the visible table.
    await press(b, '2'); await press(b, '5'); await press(b, 'G');
    await b.evaluate(`document.querySelector('.table-wrap').scrollTop = 0`);
    await press(b, 'z'); await press(b, 'z');
    const offset = await b.evaluate(`(() => {
      const wrap = document.querySelector('.table-wrap');
      const view = wrap.getBoundingClientRect();
      const header = wrap.querySelector('thead').getBoundingClientRect().bottom;
      const row = document.activeElement.closest('tr').getBoundingClientRect();
      return Math.abs(row.top + row.height / 2 - (header + (view.top + wrap.clientHeight - header) / 2)) / row.height;
    })()`);
    assert(offset < 1, `zz centers the row (off by ${offset} rows)`);
    // Moving keeps the cursor out from under the sticky header.
    await press(b, 'g'); await press(b, 'g');
    assert(await b.evaluate(`document.activeElement.getBoundingClientRect().top >= document.querySelector('thead').getBoundingClientRect().bottom - 1`), 'gg scrolls back up');

    // t puts today's date into date cells only.
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const firstId = await cursorId(b);
    await press(b, 't');
    equal(await b.evaluate(`document.getElementById('status-bar').textContent`), 'Kursor ei ole kuupäeva lahtris');
    await b.evaluate(`document.querySelector('#table-body tr td[data-col="${NEED}"]').focus()`);
    const needId = await cursorId(b);
    await press(b, 't');
    await until(async () => (await byId(f, needId))[NEED] === iso);
    equal((await at(b)).col, NEED);
    await press(b, 'u');
    await until(async () => !(await byId(f, needId))[NEED]);
    equal((await byId(f, firstId))['Töö Nr'], rows[0]);

    // f focuses the machine filter; Esc returns to the table.
    await press(b, 'f');
    equal(await b.evaluate(`document.activeElement.id`), 'filter-koht');
    await press(b, 'Escape');
    assert(await at(b), 'Esc leaves the machine filter');

    // g2 … g6 press the status pills, g1 ("Aktiivsed") resets them.
    await press(b, 'g'); await press(b, '2');
    assert(await b.evaluate(`document.querySelector('.status-box.in-progress').classList.contains('filter-active')`), 'g2 selects "Töös"');
    equal((await order(b)).length, 10);
    assert(await at(b), 'Cursor survives filtering');
    await press(b, 'g'); await press(b, '2');
    equal((await order(b)).length, 40);
    await press(b, 'g'); await press(b, '6');
    assert(await b.evaluate(`document.querySelector('.status-box.completed').classList.contains('filter-active')`), 'g6 selects "Valmis"');
    equal((await order(b)).length, 0);
    await press(b, 'g'); await press(b, '1');
    equal((await order(b)).length, 40);
    equal(await b.evaluate(`document.querySelectorAll('.status-box.filter-active').length`), 0);

    // Esc Esc clears the filters; a single Esc does not.
    await b.evaluate(`const input = document.getElementById('filter-nr'); input.value = '1'; input.dispatchEvent(new Event('input'))`);
    equal((await order(b)).length, 13);
    await b.evaluate(`document.querySelector('#table-body td[data-col="Töö Nr"]').focus()`);
    await press(b, 'Escape');
    equal((await order(b)).length, 13);
    await new Promise(resolve => setTimeout(resolve, 600));
    await press(b, 'Escape');
    equal((await order(b)).length, 13);
    await press(b, 'Escape');
    equal((await order(b)).length, 40);
    equal(await b.evaluate(`document.getElementById('filter-nr').value`), '');

    // ]c / [c jump between conflicted rows and wrap around.
    await press(b, 'g'); await press(b, 'g');
    await b.evaluate(`const rows = document.querySelectorAll('#table-body tr'); rows[3].classList.add('row-conflict'); rows[7].classList.add('row-conflict');`);
    await press(b, ']'); await press(b, 'c'); equal((await at(b)).row, rows[3]);
    await press(b, ']'); await press(b, 'c'); equal((await at(b)).row, rows[7]);
    await press(b, ']'); await press(b, 'c'); equal((await at(b)).row, rows[3]);
    await press(b, '['); await press(b, 'c'); equal((await at(b)).row, rows[7]);
    await press(b, '['); await press(b, 'c'); equal((await at(b)).row, rows[3]);
    await b.evaluate(`document.querySelectorAll('.row-conflict').forEach(row => row.classList.remove('row-conflict'))`);
    await press(b, ']'); await press(b, 'c');
    equal((await at(b)).row, rows[3]);
    equal(await b.evaluate(`document.getElementById('status-bar').textContent`), 'Konflikte ei ole');

    // ! opens the sync / conflict popup; keys stay inactive while it is open.
    await press(b, '!');
    equal(await b.evaluate(`document.getElementById('sync-popup').style.display`), 'block');
    await press(b, 'j'); equal((await at(b)).row, rows[3]);
    await press(b, 'Escape');
    equal(await b.evaluate(`document.getElementById('sync-popup').style.display`), 'none');
    await press(b, 'j'); equal((await at(b)).row, rows[4]);
    equal((await rowsOf(f)).length, 40);
  } finally { await b.close(); await f.close(); }
});

Deno.test('vim: keys are ignored with a non-English keyboard layout', async () => {
  const f = await fixture([job('a'), job('b')]); const b = await browser();
  try {
    await b.beforeLoad(vimOn);
    await b.open(f.url);
    await until(async () => await mode(b) === 'NORMAL');
    await b.evaluate(`window.__layout = ${JSON.stringify(RU)}; window.dispatchEvent(new Event('focus'))`);
    await until(async () => await mode(b) === 'VIM: EN');
    assert(await b.evaluate(`document.getElementById('vim-indicator').classList.contains('is-blocked')`), 'blocked class');
    equal(await showcmd(b), 'Vim klahvid töötavad ainult inglise klaviatuuripaigutusega');
    await b.evaluate(`document.querySelector('#table-body td[data-col="Töö Nr"]').focus()`);
    const start = await at(b);
    await b.key('о', 74, 0, 'KeyJ');
    equal(await at(b), start);
    // Even a key that matches the US layout stays inactive while the layout is not English.
    await press(b, 'j');
    equal(await at(b), start);
    await b.key('в', 68, CTRL, 'KeyD');
    await until(async () => (await rowsOf(f)).length === 3);

    await b.evaluate(`window.__layout = ${JSON.stringify(US)}; window.dispatchEvent(new Event('focus'))`);
    await until(async () => await mode(b) === 'NORMAL');
    await press(b, 'j');
    equal((await at(b)).row, (await order(b))[1]);
    // A key typed with another layout is ignored at once.
    await b.key('о', 74, 0, 'KeyJ');
    equal((await at(b)).row, (await order(b))[1]);
    // Releasing a modifier (Alt+Shift, Win+Space) re-checks the layout.
    await b.evaluate(`window.__layout = ${JSON.stringify(RU)}`);
    await b.key('Shift', 16, 0, 'ShiftLeft');
    await until(async () => await mode(b) === 'VIM: EN');
    await b.evaluate(`window.__layout = ${JSON.stringify(US)}`);
    await b.key('Shift', 16, 0, 'ShiftLeft');
    await until(async () => await mode(b) === 'NORMAL');
    await press(b, 'k');
    equal((await at(b)).row, (await order(b))[0]);
  } finally { await b.close(); await f.close(); }
});

const day = (date: Date) => `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shifted = (days: number) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + days); return date; };

Deno.test('vim: leader menu with which-key, menu and popup keys, delete confirm, calendar and generated help', async () => {
  const f = await fixture([job('a', { [DETAIL]: 'Z' }), job('b', { [DETAIL]: 'Y' }), job('c', { [DETAIL]: 'X' })]); const b = await browser();
  try {
    await b.beforeLoad(vimOn);
    await b.open(f.url);
    await until(async () => await mode(b) === 'NORMAL');
    await press(b, 'j');
    const whichKey = () => b.evaluate(`document.getElementById('vim-whichkey').hidden ? null : [...document.querySelectorAll('#vim-whichkey .key')].map(key => key.textContent)`);
    const whichKeyTitle = () => b.evaluate(`document.querySelector('#vim-whichkey .shortcuts-title').textContent`);

    // "," opens the which-key popup; Esc and unknown keys close it without acting.
    await press(b, ',');
    equal(await whichKey(), ['t', 'k', 'n', 'b', 'm', 'v', 's']);
    equal(await showcmd(b), ',');
    assert((await whichKeyTitle()).includes('Juhtklahv'), 'which-key title');
    await press(b, 'Escape');
    equal(await whichKey(), null);
    equal(await showcmd(b), '');
    await press(b, ','); await press(b, 'q');
    equal(await whichKey(), null);
    equal(await at(b), { row: 'A', col: 'Töö Nr' });

    // Location and date filters sit directly on the leader.
    await press(b, ','); await press(b, 't');
    equal(await b.evaluate(`document.getElementById('filter-koht').value`), 'TOS');
    equal(await b.evaluate(`document.getElementById('btn-filter-tos').getAttribute('aria-pressed')`), 'true');
    await press(b, ','); await press(b, 'k');
    equal(await b.evaluate(`document.getElementById('filter-koht').value`), 'Karusel');
    equal(await b.evaluate(`document.getElementById('btn-filter-tos').getAttribute('aria-pressed')`), 'false');
    await press(b, ','); await press(b, 'k');
    equal(await b.evaluate(`document.getElementById('filter-koht').value`), '');
    await press(b, ','); await press(b, 'n');
    equal(await b.evaluate(`document.getElementById('btn-filter-no-date').getAttribute('aria-pressed')`), 'true');
    equal((await order(b)).length, 3);
    await press(b, ','); await press(b, 'n');
    equal(await b.evaluate(`document.getElementById('btn-filter-no-date').getAttribute('aria-pressed')`), 'false');
    await press(b, ','); await press(b, 'b');
    equal(await b.evaluate(`document.getElementById('show-blank-koht').checked`), true);
    await press(b, ','); await press(b, 'b');
    equal(await b.evaluate(`document.getElementById('show-blank-koht').checked`), false);
    // Removed keys (theme, font size, CSV, row colors, language) do nothing now.
    for (const key of ['+', '-', 'S', 'L', 'c', 'l']) {
      await press(b, ','); await press(b, key);
      equal(await whichKey(), null);
    }
    equal(await b.evaluate(`document.documentElement.getAttribute('data-theme')`), null);
    equal(await b.evaluate(`localStorage.getItem('fontSize')`), '12');
    equal(await b.evaluate(`localStorage.getItem('showRowColors')`), 'true');
    equal(await b.evaluate(`document.documentElement.lang`), 'et');

    // The which-key popup follows the interface language.
    await b.evaluate(`document.querySelector('[data-language="en"]').click()`);
    await press(b, ',');
    equal(await whichKeyTitle(), ',  Leader');
    await press(b, 'Escape');
    await b.evaluate(`document.querySelector('[data-language="et"]').click()`);
    assert(await at(b), 'Cursor survives the language re-render');

    // ",v" opens the second level for the toolbar view checkboxes.
    await press(b, ','); await press(b, 'v');
    equal(await whichKey(), ['d', 'c', 'a']);
    equal(await showcmd(b), ',v');
    await press(b, 'c');
    equal(await whichKey(), null);
    equal(await b.evaluate(`document.getElementById('show-completed').checked`), true);
    await press(b, ','); await press(b, 'v'); await press(b, 'd');
    equal(await b.evaluate(`document.getElementById('show-hidden-dates').checked`), true);
    assert(await b.evaluate(`!!document.querySelector('th[data-col="Valmis kpv"]')`), ',vd shows the hidden date columns');
    await press(b, ','); await press(b, 'v'); await press(b, 'a');
    equal(await b.evaluate(`document.getElementById('show-allhankes').checked`), true);
    await press(b, ','); await press(b, 'v'); await press(b, 'a');
    await press(b, ','); await press(b, 'v'); await press(b, 'd');
    await press(b, ','); await press(b, 'v'); await press(b, 'c');

    // ",s" sorts by part, need date or machining start; again reverses.
    await press(b, ','); await press(b, 's');
    equal(await whichKey(), ['d', 'e', 'm']);
    const sortText = await b.evaluate(`document.getElementById('vim-whichkey').textContent`);
    for (const label of ['Detail/koostu', 'EE vajadus', 'Töötlus algus']) assert(sortText.includes(label), `sort lists ${label}`);
    await press(b, 'd');
    assert((await b.evaluate(`document.querySelector('th[data-col="${DETAIL}"] .header-label').textContent`)).endsWith('▴'), 'sorted ascending');
    equal(await order(b), ['C', 'B', 'A']);
    await press(b, ','); await press(b, 's'); await press(b, 'd');
    equal(await order(b), ['A', 'B', 'C']);
    assert(await at(b), 'Cursor survives sorting');
    await press(b, ','); await press(b, 's'); await press(b, 'm');
    assert((await b.evaluate(`document.querySelector('th[data-col="Töötluse algus"] .header-label').textContent`)).endsWith('▴'), ',sm sorts by machining start');
    await press(b, 'u'); await press(b, 'u'); await press(b, 'u');
    equal(await order(b), ['A', 'B', 'C']);
    assert(!(await b.evaluate(`document.querySelector('th[data-col="${DETAIL}"] .header-label').textContent`)).match(/[▴▾]$/), 'undo restores the original sort');

    // ",m" opens the menu with focus on its first button; j / k walk, Enter picks.
    await press(b, ','); await press(b, 'm');
    equal(await b.evaluate(`document.getElementById('menu-dropdown').style.display`), 'flex');
    equal(await b.evaluate(`document.activeElement.dataset.language`), 'et');
    await press(b, 'j');
    equal(await b.evaluate(`document.activeElement.dataset.language`), 'en');
    await press(b, 'k'); await press(b, 'k');
    equal(await b.evaluate(`document.activeElement.dataset.action`), 'info');
    await press(b, 'Enter');
    equal(await b.evaluate(`document.getElementById('info-popup').style.display`), 'block');
    equal(await b.evaluate(`document.getElementById('menu-dropdown').style.display`), 'none');
    await press(b, 'Escape');
    equal(await b.evaluate(`document.getElementById('info-popup').style.display`), 'none');
    await press(b, 'j');
    assert(await at(b), 'Keys return to the table after the menu closed');
    await press(b, ','); await press(b, 'm');
    await press(b, 'Escape');
    equal(await b.evaluate(`document.getElementById('menu-dropdown').style.display`), 'none');
    await until(async () => !!(await at(b)));

    // Sync popup: j walks its buttons and a letter presses the button with that key.
    await press(b, '!');
    equal(await b.evaluate(`document.getElementById('sync-popup').style.display`), 'block');
    await b.evaluate(`(() => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.key = 'r'; button.textContent = 'Retry';
      button.onclick = () => { window.__retried = true; };
      document.getElementById('sync-popup-actions').appendChild(button);
    })()`);
    equal(await b.evaluate(`getComputedStyle(document.querySelector('#sync-popup-actions button'), '::after').content`), '"r"');
    await press(b, 'j');
    equal(await b.evaluate(`document.activeElement.dataset.key`), 'r');
    await press(b, 'r');
    equal(await b.evaluate(`window.__retried === true`), true);
    await press(b, 'Escape');
    equal(await b.evaluate(`document.getElementById('sync-popup').style.display`), 'none');

    // Delete confirmation: n keeps the row, l / h switch the button, y deletes.
    await b.evaluate(`document.querySelector('#table-body td[data-col="Töö Nr"]').focus()`);
    await press(b, 'd'); await press(b, 'd');
    equal(await b.evaluate(`document.getElementById('confirm-popup').style.display`), 'flex');
    equal(await b.evaluate(`document.activeElement.id`), 'confirm-cancel');
    await press(b, 'n');
    equal(await b.evaluate(`document.getElementById('confirm-popup').style.display`), 'none');
    equal((await rowsOf(f)).length, 3);
    equal(await at(b), { row: 'A', col: 'Töö Nr' });
    await press(b, 'd'); await press(b, 'd');
    await press(b, 'l');
    equal(await b.evaluate(`document.activeElement.id`), 'confirm-ok');
    await press(b, 'h');
    equal(await b.evaluate(`document.activeElement.id`), 'confirm-cancel');
    await press(b, 'y');
    await until(async () => (await rowsOf(f)).length === 2);
    equal(await order(b), ['B', 'C']);
    assert(await at(b), 'Cursor stays in the table after y');

    // gd opens the calendar on a date cell; hjkl / H / L / t move, Enter picks.
    await press(b, 'g'); await press(b, 'd');
    equal(await b.evaluate(`document.getElementById('status-bar').textContent`), 'Kursor ei ole kuupäeva lahtris');
    equal(await b.evaluate(`document.getElementById('calendar-popup')`), null);
    await b.evaluate(`document.querySelector('#table-body td[data-col="${NEED}"]').focus()`);
    const needId = await cursorId(b);
    await press(b, 'g'); await press(b, 'd');
    assert(await b.evaluate(`!!document.getElementById('calendar-popup')`), 'gd opens the calendar');
    const focusedDay = () => b.evaluate(`document.querySelector('#calendar-popup .calendar-day.focused')?.dataset.date ?? null`);
    equal(await focusedDay(), day(shifted(0)));
    await press(b, 'l'); equal(await focusedDay(), day(shifted(1)));
    await press(b, 'j'); equal(await focusedDay(), day(shifted(8)));
    await press(b, 'h'); equal(await focusedDay(), day(shifted(7)));
    await press(b, 'k'); equal(await focusedDay(), day(shifted(0)));
    const monthBack = shifted(0); monthBack.setDate(1); monthBack.setMonth(monthBack.getMonth() - 1);
    await press(b, 'H');
    assert((await focusedDay()).endsWith(day(monthBack).slice(2)), 'H moves one month back');
    await press(b, 'L'); equal(await focusedDay(), day(shifted(0)));
    await press(b, 'k'); await press(b, 'k');
    await press(b, 't'); equal(await focusedDay(), day(shifted(0)));
    await press(b, 'k');
    equal(await b.evaluate(`document.querySelector('.floating-editor textarea').value`), '');
    assert(await b.evaluate(`getComputedStyle(document.querySelector('.calendar-day.focused')).outlineStyle !== 'none'`), 'focused day is outlined in vim mode');
    await press(b, 'Enter');
    await until(async () => (await byId(f, needId))[NEED] === isoDay(shifted(-7)));
    equal(await b.evaluate(`document.getElementById('calendar-popup')`), null);
    equal(await b.evaluate(`document.querySelector('.floating-editor')`), null);
    equal(await mode(b), 'NORMAL');
    equal((await at(b)).col, NEED);
    // Esc closes the calendar and the editor without saving.
    await press(b, 'g'); await press(b, 'd');
    await press(b, 'l');
    await press(b, 'Escape');
    equal(await b.evaluate(`document.getElementById('calendar-popup')`), null);
    equal((await byId(f, needId))[NEED], isoDay(shifted(-7)));

    // "?" help is generated from the keymap and lists every group and the leader keys.
    await press(b, '?');
    const help: string[] = await b.evaluate(`[...document.querySelectorAll('#shortcuts-vim .key')].map(key => key.textContent)`);
    for (const key of ['h j k l', 'gg / G / 10G', 'gd', 'g1 … g6', 'Esc Esc', 'y / n', ',', ', t', ', v', ', s']) {
      assert(help.includes(key), `help lists ${key}`);
    }
    equal(await b.evaluate(`document.querySelectorAll('#shortcuts-vim .shortcuts-group').length`), 5);
    await press(b, '?');
  } finally { await b.close(); await f.close(); }
});
