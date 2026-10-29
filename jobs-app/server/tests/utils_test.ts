import { equal, assert } from "./helpers.ts";
import { formatDate, parseDate, isValidDate, parseCSVLine, parseCSVLines, renderMarkdown, fixColumnKeys, shortcutKey, matchesUSLayout, dayFromToday, expandRelativeDate } from "../web/js/utils.js";

Deno.test("utils: date display and storage formats", () => {
  equal(formatDate("2024-02-29"), "29.02.2024");
  equal(parseDate("9.2.2024"), "2024-02-09");
  equal(parseDate("2024-02-29"), "2024-02-29");
  equal(formatDate(""), "");
  equal(parseDate(""), "");
});

Deno.test("utils: t, t5, t+5 and t-5 expand to dates relative to today", () => {
  const day = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };
  equal(dayFromToday(), day(0));
  equal(expandRelativeDate("t"), day(0));
  equal(expandRelativeDate("T5"), day(5));
  equal(expandRelativeDate(" t + 5 "), day(5));
  equal(expandRelativeDate("t-5"), day(-5));
  equal(expandRelativeDate("t-400"), day(-400));
  equal(expandRelativeDate("е-2"), day(-2));
  for (const other of ["", "20.05", "today", "t5d", "t--5", "5t", "tt"]) equal(expandRelativeDate(other), other);
});

Deno.test("utils: real calendar dates including leap-year boundaries", () => {
  for (const valid of ["2024-02-29", "2026-12-31", "2000-02-29", "2026-01-01"]) assert(isValidDate(valid), valid);
  for (const invalid of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-1", "garbage"]) assert(!isValidDate(invalid), invalid);
});

Deno.test("utils: CSV quotes, semicolons, multiline cells, CRLF, empty cells", () => {
  const raw = 'A;B;C\r\n"Õie; tööd";"a ""quote""\r\nnext";\r\n';
  equal(parseCSVLines(raw).map(parseCSVLine), [
    ["A", "B", "C"], ["Õie; tööd", 'a "quote"\r\nnext', ""],
  ]);
});

Deno.test("utils: markdown escapes HTML and preserves supported formatting", () => {
  equal(renderMarkdown('**bold** !!important!! ~~done~~'), '<strong>bold</strong> <span class="text-important">important</span> <s>done</s>');
  assert(!renderMarkdown('<img src=x onerror=alert(1)>').includes('<img'));
  equal(renderMarkdown(null), "");
  equal(renderMarkdown('A & B'), 'A &amp; B');
});

Deno.test("utils: legacy column names are trimmed", () => {
  equal(fixColumnKeys([{ " Töö Nr ": "A", "Täitmise koht": "TOS" }]), [{ "Töö Nr": "A", "Täitmise koht": "TOS" }]);
});

Deno.test("utils: shortcut keys and US layout detection across keyboard layouts", () => {
  equal(shortcutKey({ key: "D", code: "KeyD" }), "d");
  equal(shortcutKey({ key: "в", code: "KeyD" }), "d");
  equal(shortcutKey({ key: "ж", code: "Semicolon" }), ";");
  equal(shortcutKey({ key: ";", code: "Comma" }), ";");
  assert(matchesUSLayout({ key: "j", code: "KeyJ" }));
  assert(matchesUSLayout({ key: "G", code: "KeyG", shiftKey: true }));
  assert(matchesUSLayout({ key: "$", code: "Digit4", shiftKey: true }));
  assert(matchesUSLayout({ key: "/", code: "Slash" }));
  assert(matchesUSLayout({ key: "ArrowDown", code: "ArrowDown" }));
  assert(matchesUSLayout({ key: "j" }));
  assert(!matchesUSLayout({ key: "о", code: "KeyJ" }));
  assert(!matchesUSLayout({ key: "-", code: "Slash" }));
  assert(!matchesUSLayout({ key: "¤", code: "Digit4", shiftKey: true }));
});
