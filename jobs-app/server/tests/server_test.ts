import { assert, equal, fixture, job, until } from "./helpers.ts";

Deno.test("server: embedded UI assets, version, origin checks and invalid routes", async () => {
  const f = await fixture();
  try {
    for (const path of ["/", "/js/app.js", "/css/variables.css", "/icons/calendar.svg"]) {
      const response = await f.request(path); equal(response.status, 200); assert((await response.text()).length > 0);
    }
    const config = JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url)));
    const version = await f.request('/js/version.js'); assert((await version.text()).includes(JSON.stringify(config.version)));
    const forbidden = await fetch(f.url + '/api/data', { headers: { Origin: 'https://example.com' } }); equal(forbidden.status, 403); await forbidden.text();
    const traversal = await f.request('/%2e%2e%2fdeno.json'); equal(traversal.status, 403); await traversal.text();
    const missing = await f.request('/missing-file'); equal(missing.status, 404); await missing.text();
    const invalid = await fetch(f.url + '/api/merge', { method: 'POST', body: '{bad' }); equal(invalid.status, 400); await invalid.text();
    equal((await f.read())[0]['Töö Nr'], 'A');
  } finally { await f.close(); }
});

Deno.test("server: consecutive edits to different rows save without a pause", async () => {
  const f = await fixture([job("a"), job("b")]);
  try {
    let base = (await f.data()).jobs;
    for (let i = 0; i < 10; i++) {
      const proposed = structuredClone(base);
      proposed[i % 2]["Täitmise koht"] = `edit ${i}`;
      const result = await f.merge(base, proposed);
      equal(result.conflicts, []);
      equal(result.jobs, proposed);
      base = result.jobs;
    }
    equal(await f.read(), base);
  } finally { await f.close(); }
});

Deno.test("server: live lock is respected until its owner releases it", async () => {
  const f = await fixture();
  try {
    await Deno.mkdir(`${f.file}.lock`);
    let settled = false;
    const request = f.request('/api/data').then(response => { settled = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 200));
    const waited = !settled;
    await Deno.remove(`${f.file}.lock`);
    const response = await request; equal(response.status, 200); await response.text();
    assert(waited, 'Request must wait for live lock');
  } finally { await f.close(); }
});

for (const hours of [47.99, 48.01]) {
  Deno.test(`server: backup interval at ${hours} hours`, async () => {
    const f = await fixture();
    try {
      const dir = `${f.dir}/backups`; await Deno.mkdir(dir);
      const path = `${dir}/jobs_data_2025-01-01_00-00-00.json`;
      await Deno.writeTextFile(path, JSON.stringify([job('old')]));
      const stamp = new Date(Date.now() - hours * 3600000); await Deno.utime(path, stamp, stamp);
      await f.merge([job()], [job('a', { 'Täitmise koht': 'updated' })]);
      if (hours > 48) await until(async () => (await Array.fromAsync(Deno.readDir(dir))).length === 2);
      await f.data();
      equal((await Array.fromAsync(Deno.readDir(dir))).length, hours > 48 ? 2 : 1);
    } finally { await f.close(); }
  });
}

Deno.test("server: restored backup can be loaded and edited", async () => {
  const f = await fixture();
  try {
    await f.merge([job()], [job('a', { 'Täitmise koht': 'snapshot' })]);
    const dir = `${f.dir}/backups`;
    let backup = '';
    await until(async () => {
      try { backup = (await Array.fromAsync(Deno.readDir(dir))).find(e => e.name.endsWith('.json'))?.name || ''; } catch { return false; }
      return backup;
    });
    const content = await Deno.readTextFile(`${dir}/${backup}`);
    await f.merge((await f.data()).jobs, []);
    // Simulate an operator restoring a validated snapshot with no active writers.
    await Deno.writeTextFile(f.file, content);
    const restored = await f.data(); equal(restored.jobs[0]['Täitmise koht'], 'snapshot');
    restored.jobs[0]['Täitmise koht'] = 'after restore';
    await f.merge(JSON.parse(content), restored.jobs);
    equal((await f.read())[0]['Täitmise koht'], 'after restore');
  } finally { await f.close(); }
});

Deno.test("server: assigns stable unique IDs to legacy rows", async () => {
  const f = await fixture([{ "Töö Nr": "A" }, job("b"), job("b")]);
  try {
    const first = await f.data();
    equal(new Set(first.jobs.map((j: { _id: string }) => j._id)).size, 3);
    equal((await f.data()).jobs, first.jobs);
    equal(await f.read(), first.jobs);
  } finally { await f.close(); }
});

for (const sameRow of [false, true]) {
  Deno.test(`server: concurrent processes preserve edits to ${sameRow ? "different fields" : "different rows"}`, async () => {
    const f = await fixture([job("a"), job("b")]);
    try {
      const other = await f.start();
      const { jobs: base } = await f.data();
      const a = structuredClone(base), b = structuredClone(base);
      a[0]["Täitmise koht"] = "Karusel";
      b[sameRow ? 0 : 1]["Tegevuse sisestaja nimi"] = "Õie";
      const results = await Promise.all([f.merge(base, a), f.merge(base, b, other.url)]);
      results.forEach(r => equal(r.conflicts, []));
      const final = await f.read();
      equal(final[0]["Täitmise koht"], "Karusel");
      equal(final[sameRow ? 0 : 1]["Tegevuse sisestaja nimi"], "Õie");
    } finally { await f.close(); }
  });
}

for (const identical of [false, true]) {
  Deno.test(`server: ${identical ? "identical edits are idempotent" : "same-field edits report both values"}`, async () => {
    const f = await fixture();
    try {
      const { jobs: base } = await f.data();
      const shared = [job("a", { "Täitmise koht": "shared" })];
      await f.merge(base, shared);
      const result = await f.merge(base, identical ? shared : [job("a", { "Täitmise koht": "mine" })]);
      equal(result.conflicts.length, identical ? 0 : 1);
      if (!identical) {
        equal(result.conflicts[0], { jobId: "a", field: "Täitmise koht", baseValue: "TOS", currentValue: "shared", userValue: "mine" });
      }
      equal(await f.read(), shared);
    } finally { await f.close(); }
  });
}

Deno.test("server: concurrent additions and uncontested deletion", async () => {
  const f = await fixture();
  try {
    const { jobs: base } = await f.data();
    await Promise.all([f.merge(base, [...base, job("b")]), f.merge(base, [...base, job("c")])]);
    const result = await f.merge(base, []);
    equal(result.conflicts, []);
    equal((await f.read()).map((j: { _id: string }) => j._id).sort(), ["b", "c"]);
  } finally { await f.close(); }
});

for (const deleteFirst of [true, false]) {
  Deno.test(`server: edit/delete conflict (${deleteFirst ? "delete" : "edit"} first)`, async () => {
    const f = await fixture();
    try {
      const { jobs: base } = await f.data();
      const edited = [job("a", { "Täitmise koht": "changed" })];
      await f.merge(base, deleteFirst ? [] : edited);
      const result = await f.merge(base, deleteFirst ? edited : []);
      equal(result.conflicts.length, 1);
      equal(result.conflicts[0].field, "_deleted");
      equal(await f.read(), deleteFirst ? [] : edited);
    } finally { await f.close(); }
  });
}

Deno.test("server: unrelated edit does not resurrect a remotely deleted row", async () => {
  const f = await fixture([job("a"), job("b")]);
  try {
    const { jobs: base } = await f.data();
    await f.merge(base, [base[1]]);
    const proposed = structuredClone(base);
    proposed[1]["Täitmise koht"] = "changed";
    const result = await f.merge(base, proposed);
    equal(result.conflicts, []);
    equal(result.jobs, [proposed[1]]);
  } finally { await f.close(); }
});

Deno.test("server: revision polling detects changes with unchanged mtime and size", async () => {
  const f = await fixture();
  try {
    const initial = await f.data();
    const stamp = (await Deno.stat(f.file)).mtime!;
    const unchanged = await f.request(`/api/poll?revision=${encodeURIComponent(initial.revision)}`);
    equal(await unchanged.json(), { changed: false });
    await f.merge(initial.jobs, [job("a", { "Täitmise koht": "ABC" })]);
    await Deno.utime(f.file, stamp, stamp);
    const response = await f.request(`/api/poll?revision=${encodeURIComponent(initial.revision)}`);
    const result = await response.json();
    equal(result.changed, true);
    equal(result.jobs[0]["Täitmise koht"], "ABC");
  } finally { await f.close(); }
});

for (const bad of ["{broken", "null", "{}", "[null]"]) {
  Deno.test(`server: corrupt data is preserved (${bad})`, async () => {
    const f = await fixture();
    try {
      await Deno.writeTextFile(f.file, bad);
      const read = await f.request("/api/data");
      assert(read.status >= 400); await read.text();
      const save = await f.request("/api/merge", { base: [], proposed: [job()] });
      assert(save.status >= 400); await save.text();
      equal(await Deno.readTextFile(f.file), bad);
    } finally { await f.close(); }
  });
}

for (const payload of [null, {}, { base: [], proposed: [null] }, { base: [], proposed: [{ "Töö Nr": "A" }] }, { base: [], proposed: [job(), job()] }]) {
  Deno.test(`server: invalid merge rejected without changing file (${JSON.stringify(payload)})`, async () => {
    const f = await fixture();
    try {
      const before = await Deno.readTextFile(f.file);
      const response = await f.request("/api/merge", payload);
      equal(response.status, 400); await response.text();
      equal(await Deno.readTextFile(f.file), before);
    } finally { await f.close(); }
  });
}

Deno.test("server: missing shared file is not replaced by a stale save", async () => {
  const f = await fixture();
  try {
    const { jobs: base } = await f.data();
    await Deno.rename(f.file, `${f.file}.offline`);
    const response = await f.request("/api/merge", { base, proposed: [] });
    equal(response.status, 503); await response.text();
    equal(JSON.parse(await Deno.readTextFile(`${f.file}.offline`)), base);
  } finally { await f.close(); }
});

Deno.test("server: stale lock recovery", async () => {
  const f = await fixture();
  try {
    await Deno.mkdir(`${f.file}.lock`);
    const old = new Date(Date.now() - 180000);
    await Deno.utime(`${f.file}.lock`, old, old);
    equal((await f.data()).jobs.length, 1);
  } finally { await f.close(); }
});

Deno.test("server: backups retain 36 valid snapshots and ignore corrupt newest backup", async () => {
  const f = await fixture();
  try {
    const dir = `${f.dir}/backups`;
    await Deno.mkdir(dir);
    for (let i = 1; i <= 38; i++) {
      const name = `${dir}/jobs_data_2025-01-01_00-00-${String(i).padStart(2, "0")}.json`;
      await Deno.writeTextFile(name, i === 38 ? "broken" : JSON.stringify([job(String(i))]));
      const old = new Date(Date.now() - (100 - i) * 3600000);
      await Deno.utime(name, old, old);
    }
    const backups = () => Array.fromAsync(Deno.readDir(dir));
    await until(async () => (await backups()).some(e => !e.name.startsWith("jobs_data_2025") && e.name.endsWith(".json")));
    await until(async () => (await backups()).length === 37);
    const entries = await backups();
    const newest = entries.find(e => !e.name.startsWith("jobs_data_2025"))!;
    equal(JSON.parse(await Deno.readTextFile(`${dir}/${newest.name}`)), await f.read());
    assert(!entries.some(e => e.name.endsWith("00-00-01.json")));
    assert(!entries.some(e => e.name.endsWith("00-00-02.json")));
    assert(entries.some(e => e.name.endsWith("00-00-38.json")));
  } finally { await f.close(); }
});

Deno.test("server: recent valid backup prevents another snapshot", async () => {
  const f = await fixture();
  try {
    await Deno.mkdir(`${f.dir}/backups`);
    const name = "jobs_data_2026-01-01_00-00-00.json";
    await Deno.writeTextFile(`${f.dir}/backups/${name}`, JSON.stringify([job()]));
    await f.merge([job()], [job("a", { "Täitmise koht": "updated" })]);
    // Acquiring the lock waits for the background backup check to finish.
    await f.data();
    equal((await Array.fromAsync(Deno.readDir(`${f.dir}/backups`))).map(e => e.name), [name]);
  } finally { await f.close(); }
});
