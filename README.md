# Tööde Haldus App

A soft neumorphic (soft UI) job management app — replaces Excel spreadsheets with an intuitive web interface. Built with vanilla HTML, CSS, and JavaScript. No dependencies, no build step.

![App Screenshot](screenshot-3.png)

## Current version — 0.3.7

Version 0.3.7 brings back the connection diagnostics from 0.3.5 and makes them permanent: `error.log` is written next to the executable (1 MB rotation), records server start/exit, tab lifecycle, shared-lock waits, poll and data-load failures with the underlying error, and browser-reported connection problems. It also keeps a tab registered with the server while a cell editor is open and raises the tab timeout to 15 minutes, so the app no longer shuts down under a long edit. See [release notes](CHANGELOG.md).

## Features

- **20 columns** for tracking jobs from start to finish
- **Inline editing** — click any cell to edit
- **Auto-date** — checking "Alustatud" / "Valmis" fills the matching date
- **Status indicators & row tinting** — Töös / Allhanke / Hilinenud / Valmis
- **Filters** — by Töö Nr and Täitmise koht, show completed / allhanke
- **CSV import/export** and **automatic backups** (validated snapshot every 48 hours, newest 36 kept)
- **Text formatting** — bold (`**`), important (`!!`), strikethrough (`~~`)
- **Undo, duplicate row, sorting, column resize and font size**
- **Light & dark theme** with a soft neumorphic look

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Toggle the focused checkbox |
| `Enter` | Save the edit |
| `Esc` | Cancel / close |
| `Ctrl+;` | Insert today's date |
| `DD.MM` then `Enter` | Auto-complete the year (e.g. `20.05` → `20.05.2026`) |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Mark as important (red) |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+Z` | Undo |
| `Ctrl+D` | Duplicate the focused or hovered row |

## How to run

1. **Locally:** open `jobs-app/server/web/index.html` in Chrome or Edge.
2. **Windows executable (shared folder):** copy `jobs-app.exe` and `jobs_data.json` to a shared network folder and point every shortcut at the same data file:

   ```text
   "K:\your-folder\jobs-app.exe" --data "K:\your-folder\jobs_data.json"
   ```

3. **Build the executable:** from `jobs-app/server`, run `deno task build` with **Deno 2.9.6** — the fixed release toolchain for every version (2.9.7 builds are quarantined by WithSecure). Release builds and the Windows CI workflow both use it.
