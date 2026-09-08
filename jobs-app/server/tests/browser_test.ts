import { fixture } from "./helpers.ts";
import { browser } from "./browser.ts";
import * as scenarios from "./browser_scenarios.js";
import * as extended from "./extended_scenarios.js";

const cases = [
  ["add, filtered edit, delete, undo, reload, theme", scenarios.workflows],
  ["checkbox dates, completed filter, deadline statuses", scenarios.datesAndFilters],
  ["reject impossible dates", scenarios.invalidDate],
  ["CSV round trip and deduplication", scenarios.csvRoundTrip],
  ["edits made during a delayed save survive", scenarios.delayedSave],
  ["delayed poll cannot overwrite a newer local edit", scenarios.delayedPoll],
  ["failed save preserves pending work and retries", scenarios.failedSaveRetry],
  ["choose shared conflict value", scenarios.prepareConflict, scenarios.resolveShared],
  ["choose local conflict value", scenarios.prepareConflict, scenarios.resolveMine],
  ["review and combine comment conflict", scenarios.resolveComment],
  ["accept shared deletion", scenarios.acceptSharedDeletion],
  ["keep local deletion", scenarios.keepLocalDeletion],
  ["render imported content as text", scenarios.escapedContent],
  ["unresolved conflict survives saving another field", scenarios.prepareConflict, scenarios.conflictSurvivesOtherSave],
  ["restore locally edited row after shared deletion", scenarios.retainLocalRow],
  ["keep shared row after local deletion", scenarios.retainSharedRow],
  ["add form rejects blank work number and invalid dates", scenarios.validateAddForm],
  ["mixed-format date sorting, blanks last, deletion after sorting", scenarios.sorting],
  ["combined filters and exact status counters", extended.filtersAndCounters],
  ["calendar navigation, leap day, today and cancel", extended.calendarControls],
  ["keyboard editing, formatting, multiline text and cancel", extended.keyboardAndCancel],
  ["menus, preferences and column resize", extended.menusAndPreferences],
  ["retry after server saved but response was lost", extended.lostResponse],
  ["resolve multiple conflicts independently", extended.multipleConflicts],
  ["saving when browser storage quota is exceeded", extended.storageUnavailable],
  ["poll arriving during cell editing", extended.editingDuringPoll],
  ["CSV reordered columns, legacy encoding and empty file", extended.csvCompatibility],
  ["header sorting and filtering 1000 rows", extended.headerSortingAndScale],
] as const;

for (const [name, ...steps] of cases) {
  Deno.test(`browser: ${name}`, async () => {
    const f = await fixture();
    let b;
    try {
      b = await browser();
      await b.open(f.url);
      await b.run(scenarios.setup);
      for (const step of steps) await b.run(step);
    } finally { if (b) await b.close(); await f.close(); }
  });
}

Deno.test("browser: reload of offline edits preserves conflict baseline", async () => {
  const f = await fixture();
  let b;
  try {
    b = await browser();
    await b.open(f.url);
    await b.run(scenarios.setup);
    await b.run(scenarios.prepareRecovery);
    await b.open(f.url);
    await b.run(scenarios.setup);
    await b.run(scenarios.recoveredConflict);
  } finally { if (b) await b.close(); await f.close(); }
});

Deno.test("browser: preferences survive a real reload", async () => {
  const f = await fixture(); let b;
  try {
    b = await browser(); await b.open(f.url); await b.run(scenarios.setup);
    await b.run(extended.menusAndPreferences);
    await b.open(f.url); await b.run(scenarios.setup); await b.run(extended.preferencesRestored);
  } finally { if (b) await b.close(); await f.close(); }
});

Deno.test("browser: reconnect after failed initial load", async () => {
  const f = await fixture(); let b;
  try {
    b = await browser();
    await b.beforeLoad(`window.startupOffline = true; const originalFetch = window.fetch.bind(window); window.fetch = (...args) => window.startupOffline && args[0] === '/api/data' ? Promise.reject(new Error('Simulated startup offline')) : originalFetch(...args);`);
    await b.open(f.url, false); await b.run(scenarios.setup); await b.run(extended.startupRetry);
  } finally { if (b) await b.close(); await f.close(); }
});

Deno.test("browser: unresolved conflict survives reload", async () => {
  const f = await fixture();
  let b;
  try {
    b = await browser();
    await b.open(f.url);
    await b.run(scenarios.setup);
    await b.run(scenarios.prepareConflict);
    await b.open(f.url);
    await b.run(scenarios.setup);
    await b.run(scenarios.conflictSurvivesReload);
  } finally { if (b) await b.close(); await f.close(); }
});

Deno.test("browser: personal sorting survives save and reload", async () => {
  const col = "EE vajaduse kuupäev (koostamiseks valmis kujul)";
  const f = await fixture([
    { _id: "a", "Töö Nr": "A", [col]: "2026-10-20" },
    { _id: "b", "Töö Nr": "B", [col]: "2026-10-10" },
    { _id: "c", "Töö Nr": "C", [col]: "" },
  ]);
  let b;
  try {
    b = await browser(); await b.open(f.url); await b.run(scenarios.setup);
    await b.run(scenarios.personalSorting0);
    await b.open(f.url); await b.run(scenarios.setup);
    await b.run(scenarios.personalSorting1);
  } finally { if (b) await b.close(); await f.close(); }
});
