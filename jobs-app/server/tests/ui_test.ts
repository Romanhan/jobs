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
