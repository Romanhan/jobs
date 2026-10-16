# Tööde Haldus App

A soft neumorphic (soft UI) job management app — replaces Excel spreadsheets with an intuitive web interface. Built with vanilla HTML, CSS, and JavaScript. No dependencies, no build step.

![App Screenshot](screenshot-3.png)

## Current version — 0.3.6

Version 0.3.6 adds row duplication (Ctrl+D) on top of the 0.3.5 startup changes, and removes the temporary lock/connection diagnostics that 0.3.5 used for troubleshooting. Reopening still reuses a compatible running server without killing processes. See [release notes](CHANGELOG.md).

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

3. **Build the executable:** from `jobs-app/server`, run `deno task build`.
