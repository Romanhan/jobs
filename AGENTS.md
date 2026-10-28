# AGENTS.md - Tööde Haldus App

## Project Type
Single-page HTML work management app with soft neumorphic (soft UI) design.

## Files
- `jobs-app/server/web/index.html` — Main app (HTML + JS)
- `jobs-app/server/web/css/variables.css` — Design tokens (colors, shadows, radii)
- `jobs-app/server/web/css/base.css` — Body, container, buttons
- `jobs-app/server/web/css/header.css` — Header bar, status pills, legend
- `jobs-app/server/web/css/toolbar.css` — Toolbar, inputs, checkboxes, menu, popups
- `jobs-app/server/web/css/table.css` — Table, sticky columns, row tints, tooltips, editor
- `jobs-app/server/web/css/modal.css` — Modal, form inputs
- `jobs-app/server/web/css/calendar.css` — Calendar popup
- `jobs-app/server/web/css/scrollbar.css` — Scrollbar styling
- `jobs-app/server/web/css/status-bar.css` — Toast notifications
- `jobs-app/server/web/css/styles.css` — Root import file
- `jobs_data.json` — Data file (optional, loads from localStorage)

## Design System
- **Soft neumorphism** — Extruded surfaces with dual-shadow system (light TL + dark BR), inset/pressed states for inputs and active elements
- **Color palette** — Body `#b4b8c0`, card surface `#eef0f4`, input surface `#e4e8ee`, mint accent `#6abf9e`
- **Radius system** — `--radius-xs: 6px`, `--radius-sm: 12px`, `--radius-md: 16px`, `--radius-lg: 20px`
- **Single extruded card** — `.app-container` wraps header + toolbar + table into one continuous surface
- **Dark theme** — Full `[data-theme="dark"]` support with adjusted values
- **Custom scrollbar** — Matte, matching the theme

## Code Style & Design Rules
- **No hardcoded colors** — All color/background/border values must reference CSS custom properties from `variables.css` (`var(--color-*)`, `var(--surface-*)`, `var(--text-*)`, etc.). New colors must be added as tokens with both light and dark theme values.
- **Neumorphic consistency** — Extruded surfaces use `box-shadow: var(--shadow-extruded-*)` (light TL + dark BR); pressed/inset states use `var(--shadow-pressed)` or `var(--shadow-inset-*)`. Flat backgrounds or hardcoded box-shadows are not allowed on surfaces or buttons.
- **Use existing tokens first** — Before adding a new token, check if an existing one fits (`--color-primary`, `--text-important`, `--surface-btn-secondary`, etc.). Avoid token bloat.
- **Always theme both modes** — Every new token must have a `[data-theme="dark"]` override in `variables.css`.
- **Match element patterns** — New interactive elements should mimic existing ones (e.g., buttons use `--surface-btn-*` + `--shadow-btn-*`, inputs use `--shadow-inset-input`, tooltips use `--surface-menu`). Do not invent new visual styles.
- **Radius system** — Use `--radius-*` tokens (xs/sm/md/lg) consistently; never hardcode border-radius values.
- **Zero-font-size tds** — Table cells use `line-height: 0; font-size: 0` on `td` with content wrapped in `.cell-inner` (`display: inline-block; font-size: var(--font-row-size); line-height: 1`). Content outside `.cell-inner` must also match this pattern.

## How to Run
1. **Local:** Open `jobs-app/server/web/index.html` in Chrome/Edge
2. **Shared folder:** Copy `jobs-app.exe` to the shared network folder and point every shortcut at the same data file: `jobs-app.exe --data K:\folder\jobs_data.json`
3. **Build .exe:** `cd jobs-app/server && deno task build` (cross-compiles to a Windows PE and stamps the file version; `deno task build:quick` compiles without the version resource)
   - **Always build with Deno 2.9.8 — for every future release.** This is the project's fixed release toolchain. Deno 2.9.7 `deno compile` output was quarantined by WithSecure as `Trojan.TR/W64.Malware` (false positive on the compiled shell — a hello-world build was flagged too) and broke the resource merge that `set-version-info.ts` relies on. On 2026-10-22 both a hello-world build and a full 0.3.10 executable were built with 2.9.8, accepted by WithSecure, and the embedded payload survived the version stamp, so the pin moved to 2.9.8. CI pins the exact tag `v2.9.8` (never `v2.x` or a newer release); `set-version-info.ts` warns when another version is used.
   - Do not bump the pin casually. Only change it after a fresh WithSecure scan of both a hello-world build and a real app build shows the new Deno is clean; then update the pin in `.github/workflows/build.yml`, `.github/workflows/test.yml`, this note, and the version check in `set-version-info.ts` together.
   - Local builds: the pinned binary is at `~/.cache/deno-2.9.8/deno`, so run `PATH="$HOME/.cache/deno-2.9.8:$PATH" deno task build` if the `deno` on `PATH` is a different version.

## Version Info
- Version managed in `jobs-app/server/deno.json` (field `"version"`)
- `deno task gen-version` reads `deno.json` and generates `web/js/version.js`
- `deno task build` runs gen-version, compiles the .exe, then `deno task set-version-info` stamps the file version (RT_VERSION)
- `set-version-info.ts` merges the version resource next to Deno's embedded payload resource — never use rcedit, which drops that payload and breaks startup with "Could not find standalone binary section"
- Info popup (Menu → Info) displays app name, version, author (English labels)
- App icon — `icon.ico` in `server/` (16×16, 32×32, 64×64 combined), baked via `--icon icon.ico`

## Release
- **Toolchain is fixed for all releases: Deno 2.9.8** (see "How to Run"). Every release from the next version onward is built with it. 2.9.7 stays excluded; a newer Deno only replaces 2.9.8 after a fresh WithSecure scan of both a hello-world build and a real app build.
- Flow: branch → PR → CI green (tests run on ubuntu and windows) → merge to `main` → annotated tag `vX.Y.Z` on `main` → push the tag.
- CI (`build.yml`, `windows-latest`, Deno `v2.9.8`) builds, verifies `VersionInfo.FileVersion` matches `deno.json`, runs the full test suite against the compiled exe, and attaches `jobs-app.exe` to the GitHub release.
- Bump `jobs-app/server/deno.json` and add a `CHANGELOG.md` entry before tagging.
- Never commit `jobs-app.exe` or archives — the release asset (or CI artifact) is the only binary.

## Features
- **Load data** — Reads from `jobs_data.json` or localStorage on page load
- **Add new work** — Click "+ Lisa uus" button (modal form)
- **Edit inline** — Click any cell to edit; floating editor for text/date cells
- **Mark started** — Check "Alustatud" → auto-fills start date
- **Mark done** — Check "Valmis" → auto-fills completion date, dims row
- **Show completed** — Toggle "Lõppenud" checkbox
- **Show allhankes** — Toggle "Allhange" checkbox
- **Show dates** — Toggle "Kuupäevad" checkbox
- **Mark fully machined** — Check "Töötlus Lõpetatud" (without "Valmis") → "Fully Machined" status: deep green tint, dimmed text, own counter pill; an overdue need date still shows red
- **Filters** — Text filter by "Töö Nr" and "Koht", blank-location toggle, "Kpv puudub" button for rows without "EE vajaduse kuupäev"
- **Save CSV** — Menu → "Save CSV" downloads `jobs_data.csv`
- **Load CSV** — Menu → "Load CSV" loads data from file
- **Row colors** — Menu → "Color rows" toggles status row tinting
- **Font size** — Menu → "Font size" slider
- **Theme toggle** — Top-right moon/sun icon button
- **Language switch** — EST / ENG / RUS buttons at the top of the menu switch the interface between Estonian (default), English and Russian; stored in localStorage (`language`). All UI text lives in `web/js/i18n.js` (`t()`, `columnLabel()`, `columnTitle()`); static markup uses `data-i18n`, `data-i18n-html`, `data-i18n-placeholder`, `data-i18n-tooltip`, `data-i18n-aria-label`. Column names stay Estonian in the data, CSV and merge protocol — only their displayed labels are translated. New UI strings must be added to all three dictionaries.
- **Automatic save retry** — A failed save retries with 5 s → 30 s backoff (paused while the tab is hidden, resumed on focus or reconnect); rejected requests are not retried
- **Conflict marking** — Rows with an unresolved conflict get an amber tint and a `!` marker that opens the resolution popup
- **Diagnostics log** — `error.log` next to the executable (1 MB rotation to `error.log.1`, `JOBS_LOG_FILE` overrides), with local timestamps carrying the UTC offset and host/pid/version prefixes, tab and shutdown lifecycle, poll/data failures, lock-owner dumps, and browser reports via `POST /api/client-log` (load failures, save failures, poll failures, conflict open/resolved)
- **Keyboard shortcuts** — Menu → "Shortcuts" popup. Ctrl shortcuts match through `shortcutKey()` (`web/js/utils.js`) so they also work with the Russian layout
- **Vim keys** — Menu → "Vim keys" (`web/js/vim.js`), off by default and stored per browser in localStorage (`vimMode`). Adds a table cursor (focused cell, remembered by job id + column across re-renders via the `jobs-table-rendered` event) and an nvim-style statusline under the table (mode, pending keys, ruler). Keys respond only with the English (US) layout: each key must match `matchesUSLayout()`, and `navigator.keyboard.getLayoutMap()` is re-checked on focus and modifier key-up; with another layout the app behaves as with vim mode off. In vim mode digits are counts (`5j`, `10G`), so status pills are `g1`–`g6`; `?` shows only the vim keys (popup `data-view="vim"`), Menu → Shortcuts only the default ones (`data-view="default"`); `Ctrl+D` / `Ctrl+U` page down / up, `Ctrl+R` redoes (its browser reload is blocked), `jk` typed within 300 ms leaves the editor and saves, and `yy` + `p` duplicate; with vim mode off (or another layout) `Ctrl+D` still duplicates. Avoid keys Windows or Edge/Chrome reserve (`Win`/`Alt` combos, F-keys, `Ctrl+W/T/N/Tab`). All vim keys live in two tables in `vim.js`: `KEYMAP` (normal mode, one row per help line, `bindings` map keys, sequences like `gg` and Ctrl keys like `C-d` to actions) and `LEADER` (keys after `,`, with `children` for `,v…` / `,s…`; top level: `t` TOS, `k` Karusel, `n` no date, `b` blank Koht, `m` menu). Key handling, the generated `?` help (`#shortcuts-vim`) and the which-key popup (`#vim-whichkey`) all read them — add a key by adding a row, plus its label in all three dictionaries. Sync popup buttons carry `data-key` (s / m / b / r); the calendar has a keyboard-focused day (`.calendar-day.focused`, outlined only under `body.vim-on`).

## Collaboration (Shared Folder)
- Each user runs the same current-version executable locally with `--data` pointing to the shared `jobs_data.json`
- Field-level changes are merged under an exclusive shared-drive lock; different rows/fields can be edited concurrently
- The lock is a permanent `jobs_data.json.lock` folder with an exclusive `holder` file inside it (created with `CREATE_NEW`) and an `owner.json` heartbeat refreshed every 5 s. The folder is created once and never removed, because some shares allow files but refuse folder creation; a refusal to create it at startup is logged and fails fast instead of waiting 90 s. A stale claim (holder and heartbeat older than 2 min) is reclaimed by renaming `holder` to `holder.broken-*` and deleting that tombstone — never by deleting the path in place, so a failed reclaim cannot remove a claim another client just took. An empty `holder` with no heartbeat is reclaimed after 30 s, so a client that crashed between creating the claim and writing it does not stall every save. After creating the claim the client reads it back and acts as the owner only when it carries its own token, so a claim moved aside in the same instant cannot produce two owners. A folder claimed by an older client (fresh `owner.json` without a holder) is waited for, not taken over.
- Lock timings can be overridden for tests: `JOBS_LOCK_MAX_WAIT_MS`, `JOBS_LOCK_STALE_MS`, `JOBS_LOCK_HEARTBEAT_MS`, `JOBS_LOCK_PROGRESS_MS` (the 30 s empty-claim threshold is fixed).
- While the shared file cannot be read the page shows an "Andmed ei ole saadaval" panel with the file path instead of an empty table, and retries every 2 s
- Same-field edits from stale copies create a visible conflict instead of silently overwriting either value
- Polling keeps running while a conflict is open: the tab follows the shared file, keeps only the values in conflict, and marks the affected rows. A field conflict on a row deleted elsewhere becomes a deletion conflict
- The merge baseline stays stale for a conflicted row, so nothing is re-created silently; it is rebased onto the shared value only when the user resolves the conflict, so every choice ("mina", "salvestatud", "ühenda") applies in one save
- Comment conflicts offer an editable "Ühenda mõlemad" flow in addition to choosing the shared or local value
- `jobs_data.json.version` is managed automatically beside the data file for reliable change polling
- A validated backup is written to `backups/<YYYY-MM>/` when the newest backup is at least 48 hours old; the newest 36 are retained across all months, old snapshots left in `backups/` are still counted, and empty month folders are removed
- All users must upgrade together when the synchronization protocol changes — do not mix versions on one share. 0.3.10 and 0.3.11 are not compatible: a 0.3.10 client treats the permanent lock folder as its own stale lock and renames it away after two idle minutes, and on a share that refuses folder creation nobody can recreate it. Close the app everywhere before replacing the executable — the background server lingers after the last tab closes.

## All 20 Columns
1. Töö Nr
2. Valmis
3. Valmis kpv
4. Info sisestamise kuupäev
5. Tegevuse sisestaja nimi
6. Detaili/koostu nimetus või joonise Nr
7. Kommentaar(tooriku/detaili seis, muu oluline info)
8. Otsuse/Tegevuse vastutaja
9. Tooriku saabumise kuupäev EE
10. EE vajaduse kuupäev (koostamiseks valmis kujul)
11. Meeldetuletus X päeva ennem
12. Töötluse algus
13. Alustatud
14. Alustamise kpv
15. EE töötluse lõpp
16. Töötlus Lõpetatud
17. Töötlus allhankes
18. Täitmise koht
19. EE kuupäev tarne
20. TE kuupäev tarne
