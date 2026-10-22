# Tööde Haldus (Job Management)

A soft neumorphic (soft UI) job management app — replaces Excel spreadsheets with an intuitive web interface. Built with vanilla HTML, CSS, and JavaScript. No dependencies, no build step.

![App Screenshot](screenshot-3.png)

## Current version — 0.3.11

0.3.11 keeps the shared lock folder (`jobs_data.json.lock`) permanently and claims a file inside it instead of creating the folder on every save. Some Windows shares allow files but refuse to create folders, which made saves wait 90 seconds and fail although no client held the lock. A missing lock folder is now reported in seconds, stale claims are reclaimed after two minutes, and an empty claim left by a crash is reclaimed after 30 seconds. A failed reclaim never deletes a lock another client just took. 0.3.10 resolved conflicts with one click; 0.3.9 made collaboration recover instead of freezing. See [release notes](CHANGELOG.md).

## Features

- **20 columns** for tracking jobs from start to finish
- **Inline editing** — click any cell to edit
- **Auto-date** — marking a job started or done fills the matching date
- **Status indicators & row tinting** — in progress / subcontract / overdue / done
- **Filters** — by job number and location, show completed or subcontract work
- **CSV import/export** and **automatic backups** (validated snapshot every 48 hours, newest 36 kept, filed by month)
- **Text formatting** — bold (`**`), important (`!!`), strikethrough (`~~`)
- **Undo, duplicate row, sorting, column resize and font size**
- **Light & dark theme** with a soft neumorphic look
- **Conflict handling** — field-level merges, visible conflicted rows and a merge editor for comments
- **Connection diagnostics** — `error.log` next to the executable, plus an explicit "data unavailable" panel in the page

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
2. **Windows executable (shared folder):** copy `jobs-app.exe` to a shared network folder and point every shortcut at the same data file:

   ```text
   "K:\your-folder\jobs-app.exe" --data "K:\your-folder\jobs_data.json"
   ```

   The app creates `jobs_data.json.lock` next to the data file on first start and keeps it. If the share does not allow users to create folders, create that one folder yourself (while the app is closed) and grant users Modify inside it.
3. **Build the executable:** from `jobs-app/server`, run `deno task build` with **Deno 2.9.8** — the fixed release toolchain for every version. 2.9.7 builds were quarantined by WithSecure as a false positive; 2.9.8 was scanned clean for both a hello-world and a real app build. Release builds and the Windows CI workflow both use it.

### Upgrading

Close the app on every PC before replacing `jobs-app.exe` — a background server keeps running for a while after the last tab closes. Upgrade all PCs together: do not mix 0.3.10 and 0.3.11 on one share. A 0.3.10 client treats the permanent lock folder as its own stale lock and renames it away after two idle minutes, and on a share that refuses folder creation nobody can recreate it.
