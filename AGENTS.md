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
2. **Shared folder:** Copy `jobs-app/index.html` + `jobs_data.json` to shared network folder
3. **Build .exe:** `cd jobs-app/server && deno task build` (auto-generates version info from `deno.json`)

## Version Info
- Version managed in `jobs-app/server/deno.json` (field `"version"`)
- `deno task gen-version` reads `deno.json` and generates `web/js/version.js`
- `deno task build` runs gen-version then compiles the .exe
- Info popup (Menu → Info) displays app name, version, author (English labels)
- App icon — `icon.ico` in `server/` (16×16, 32×32, 64×64 combined), baked via `--icon icon.ico`

## Features
- **Load data** — Reads from `jobs_data.json` or localStorage on page load
- **Add new work** — Click "+ Lisa uus" button (modal form)
- **Edit inline** — Click any cell to edit; floating editor for text/date cells
- **Mark started** — Check "Alustatud" → auto-fills start date
- **Mark done** — Check "Valmis" → auto-fills completion date, dims row
- **Show completed** — Toggle "Lõppenud" checkbox
- **Show allhankes** — Toggle "Allhange" checkbox
- **Show dates** — Toggle "Kuupäevad" checkbox
- **Filters** — Text filter by "Töö Nr" and "Koht", blank-location toggle
- **Save CSV** — Menu → "Save CSV" downloads `jobs_data.csv`
- **Load CSV** — Menu → "Load CSV" loads data from file
- **Row colors** — Menu → "Color rows" toggles status row tinting
- **Font size** — Menu → "Font size" slider
- **Theme toggle** — Top-right moon/sun icon button
- **Keyboard shortcuts** — Menu → "Shortcuts" popup

## Collaboration (Shared Folder)
- Each user runs the same current-version executable locally with `--data` pointing to the shared `jobs_data.json`
- Field-level changes are merged under an exclusive shared-drive lock; different rows/fields can be edited concurrently
- Same-field edits from stale copies create a visible conflict instead of silently overwriting either value
- Comment conflicts offer an editable "Ühenda mõlemad" flow in addition to choosing the shared or local value
- `jobs_data.json.version` is managed automatically beside the data file for reliable change polling
- A validated backup is created in `backups/` when the newest backup is at least 48 hours old; the newest 36 are retained
- All users must upgrade together when the synchronization protocol changes; older executables still use whole-file saves

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
