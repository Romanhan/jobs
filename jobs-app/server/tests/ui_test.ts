import { assert, equal, fixture, job, until } from './helpers.ts';
import { browser } from './browser.ts';

Deno.test('UI: Add dialog traps real keyboard focus and prevents background edits', async () => {
  const f = await fixture(); const b = await browser();
  try {
    await b.open(f.url); await b.click('#btn-add-job');
    equal(await b.evaluate(`document.activeElement.getAttribute('name')`), 'Töö Nr');
    await b.key('Tab', 9, 8);
    assert(await b.evaluate(`!!document.activeElement.closest('#modal')`));
    for (let i = 0; i < 15; i++) {
      await b.key('Tab', 9);
      assert(await b.evaluate(`!!document.activeElement.closest('#modal')`), 'Tab must stay inside dialog');
    }
    await b.key('Escape', 27);
    equal(await b.evaluate('document.activeElement.id'), 'btn-add-job');
    await b.click('#btn-add-job'); await b.key('Tab', 9); await b.key('Tab', 9); await b.key(' ', 32);
    equal(await f.read(), [job()]);
    await b.key('Escape', 27);
    await b.click('input.checkbox');
    await until(async () => (await f.read())[0].Valmis === true);
  } finally { await b.close(); await f.close(); }
});

for (const [width, height] of [[1024, 768], [390, 600]]) {
  Deno.test(`UI: editors remain inside ${width}x${height} viewport during growth and resize`, async () => {
    const f = await fixture(Array.from({ length: 50 }, (_, i) => job(String(i), {
      'Kommentaar(tooriku/detaili seis, muu oluline info)': 'Long multiline comment. '.repeat(40),
      'Tegevuse sisestaja nimi': 'A long responsible person name for this assembly',
    })));
    const b = await browser();
    try {
      await b.viewport(width, height); await b.open(f.url);
      await b.evaluate(`document.getElementById('status-bar').style.display='none'`);
      const inside = () => b.evaluate(`(() => { const r=document.querySelector('.floating-editor')?.getBoundingClientRect(); return !!r && r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight; })()`);
      await b.click('tr[data-index="49"] td[data-col="Kommentaar(tooriku/detaili seis, muu oluline info)"]');
      await until(inside);
      await b.evaluate(`const input=document.querySelector('.floating-editor textarea'); input.value='many lines\\n'.repeat(100); input.dispatchEvent(new Event('input'));`);
      await until(inside);
      assert(await b.evaluate(`document.querySelector('.floating-editor textarea').scrollHeight > document.querySelector('.floating-editor textarea').clientHeight`));
      await b.key('Escape',27);
      await b.evaluate(`document.documentElement.setAttribute('data-theme','dark')`);
      await b.click('tr[data-index="0"] td[data-col="Tegevuse sisestaja nimi"]'); await until(inside);
      await b.viewport(Math.max(320, width-100), height-100); await until(inside);
      await b.key('Escape',27);
      equal((await f.read())[49]['Kommentaar(tooriku/detaili seis, muu oluline info)'], 'Long multiline comment. '.repeat(40));
    } catch (error) {
      console.log(await b.evaluate(`({editor:document.querySelector('.floating-editor')?.getBoundingClientRect().toJSON(), viewport:[innerWidth,innerHeight], focused:document.activeElement.tagName})`));
      throw error;
    } finally { await b.close(); await f.close(); }
  });
}

Deno.test('UI: editor follows scrolling and saves to its original row when scrolled out', async () => {
  const f = await fixture(Array.from({length:50},(_,i)=>job(String(i)))); const b=await browser();
  try {
    await b.viewport(1024,768); await b.open(f.url);
    await b.click('tr[data-index="10"] td[data-col="Täitmise koht"]');
    await b.evaluate(`document.querySelector('.floating-editor textarea').value='Edited original'; document.querySelector('.table-wrap').scrollTop=50;`);
    await until(async()=> await b.evaluate(`(() => { const editor=document.querySelector('.floating-editor'); const cell=document.querySelector('tr[data-index="10"] td[data-col="Täitmise koht"]'); return !!editor && Math.abs(editor.getBoundingClientRect().top-cell.getBoundingClientRect().top)<1; })()`));
    await b.evaluate(`document.querySelector('.table-wrap').scrollTop=900`);
    await until(async()=>!await b.evaluate(`!!document.querySelector('.floating-editor')`));
    await until(async()=>(await f.read())[10]['Täitmise koht']==='Edited original');
    equal((await f.read())[11]['Täitmise koht'],'TOS');
    await b.click('tr[data-index="49"] td[data-col="Täitmise koht"]');
    await b.key('Escape',27);
    await b.evaluate(`document.querySelector('.table-wrap').scrollTop=0; window.dispatchEvent(new Event('resize'));`);
    equal(await b.evaluate(`!!document.querySelector('.floating-editor')`),false);
  } finally { await b.close(); await f.close(); }
});

Deno.test('UI: language switch translates the interface, keeps data keys, and persists', async () => {
  const f = await fixture([job('1')]); const b = await browser();
  try {
    await b.open(f.url);
    await until(async () => await b.evaluate(`document.querySelectorAll('#table-body tr').length`) === 1);
    equal(await b.evaluate(`document.documentElement.lang`), 'et');
    equal(await b.evaluate(`document.getElementById('btn-add-job').textContent`), 'Lisa uus');
    await b.click('#btn-menu'); await b.click('[data-language="en"]');
    equal(await b.evaluate(`document.documentElement.lang`), 'en');
    equal(await b.evaluate(`document.getElementById('btn-add-job').textContent`), 'Add new');
    equal(await b.evaluate(`document.querySelector('[data-language="en"]').getAttribute('aria-pressed')`), 'true');
    equal(await b.evaluate(`document.getElementById('menu-dropdown').style.display`), 'flex');
    equal(await b.evaluate(`document.querySelector('th[data-col="Töö Nr"] .header-label').textContent`), 'Job No');
    equal(await b.evaluate(`document.querySelector('#add-form input[name="Täitmise koht"]').placeholder`), 'Machine');
    equal(await b.evaluate(`document.getElementById('sync-indicator').getAttribute('aria-label')`), 'All changes saved');
    await b.click('[data-language="ru"]');
    equal(await b.evaluate(`document.documentElement.lang`), 'ru');
    equal(await b.evaluate(`document.getElementById('btn-add-job').textContent`), 'Добавить');
    equal(await b.evaluate(`document.querySelector('th[data-col="TE kuupäev tarne"] .header-label').textContent`), 'Факт. поставка');
    await b.click('[data-language="en"]');
    await b.open(f.url);
    await until(async () => await b.evaluate(`document.documentElement.lang`) === 'en');
    await b.click('#btn-menu'); await b.click('[data-language="et"]');
    equal(await b.evaluate(`document.getElementById('btn-add-job').textContent`), 'Lisa uus');
    equal(await f.read(), [job('1')]);
  } finally { await b.close(); await f.close(); }
});

Deno.test('UI: Ctrl+C / Ctrl+V copy and paste the hovered cell', async () => {
  const COMMENT = 'Kommentaar(tooriku/detaili seis, muu oluline info)';
  const NEED = 'EE vajaduse kuupäev (koostamiseks valmis kujul)';
  const DETAIL = 'Detaili/koostu nimetus või joonise Nr';
  const f = await fixture([job('a', { [COMMENT]: 'hello', [NEED]: '2026-12-01', Alustatud: true }), job('b')]);
  const b = await browser();
  const cell = (row: string, col: string) => `#table-body tr[data-index="${row}"] td[data-col="${col}"], #table-body tr[data-index="${row}"] td[data-checkbox="${col}"]`;
  const hover = (selector: string) => b.evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('.cell-inner').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  // Ctrl+C returns what the app copied (null when it left the key alone).
  const copy = async () => {
    await b.evaluate(`window.__copied = null; import('/js/events.js').then(m => { window.__before = m.getCellRegister(); })`);
    await b.key('c', 67, 2, 'KeyC');
    return b.evaluate(`import('/js/events.js').then(m => m.getCellRegister() === window.__before ? null : m.getCellRegister().text)`);
  };
  // Headless Chrome has no system clipboard, so a paste from elsewhere is a
  // "paste" event carrying its own data.
  const paste = (text: string) => b.evaluate(`(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    return !document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
  const toast = () => b.evaluate(`document.getElementById('status-bar').textContent`);
  const row = async (id: string) => (await f.read()).find((r: Record<string, unknown>) => r._id === id);
  try {
    await b.open(f.url);
    // Text: copy from one comment, paste into another.
    await hover(cell('0', COMMENT));
    equal(await copy(), 'hello');
    equal(await toast(), 'Lahter kopeeritud');
    await hover(cell('1', COMMENT));
    equal(await paste('hello'), true);
    await until(async () => (await row('b'))[COMMENT] === 'hello');
    equal(await toast(), 'Lahter kleebitud');
    // Dates copy as shown and store as ISO.
    await hover(cell('0', NEED));
    equal(await copy(), '01.12.2026');
    await hover(cell('1', NEED));
    await paste('01.12.2026');
    await until(async () => (await row('b'))[NEED] === '2026-12-01');
    // Text that is not a date is refused in a date cell.
    await paste('not a date');
    equal(await toast(), 'Vigane kuupäeva vorming (Kasuta: PP.KK.AAAA)');
    equal((await row('b'))[NEED], '2026-12-01');
    // Text copied elsewhere (a spreadsheet cell ends with a line break).
    await hover(cell('1', DETAIL));
    await paste('from excel\r\n');
    await until(async () => (await row('b'))[DETAIL] === 'from excel');
    // Checkboxes copy their state and only go into a checkbox.
    await hover(cell('0', 'Alustatud'));
    equal(await copy(), 'x');
    await hover(cell('1', COMMENT));
    await paste('x');
    equal(await toast(), 'Linnukest saab kleepida ainult linnukesse');
    await hover(cell('1', 'Alustatud'));
    await paste('x');
    await until(async () => (await row('b')).Alustatud === true);
    assert((await row('b'))['Alustamise kpv'], 'pasting a checked Alustatud fills the start date');
    // Undo takes back the paste.
    await b.key('z', 90, 2, 'KeyZ');
    await until(async () => !(await row('b')).Alustatud);
    // Ctrl+V with no "paste" event from the browser pastes the cell copied
    // here; the Russian layout ('м' on the V key) works too.
    await hover(cell('0', COMMENT));
    equal(await copy(), 'hello');
    await hover(cell('1', DETAIL));
    await b.key('м', 86, 2, 'KeyV');
    await until(async () => (await row('b'))[DETAIL] === 'hello');
    // Selected text and text fields keep the browser's own copy and paste.
    await b.evaluate(`getSelection().selectAllChildren(document.querySelector(${JSON.stringify(cell('0', COMMENT))}))`);
    equal(await copy(), null);
    await b.evaluate(`getSelection().removeAllRanges(); document.getElementById('filter-nr').focus()`);
    equal(await copy(), null);
    equal(await paste('typed'), false);
  } finally { await b.close(); await f.close(); }
});
