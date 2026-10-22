# Tööde Haldus (Job Management)

A soft neumorphic (soft UI) job management app — replaces Excel spreadsheets with an intuitive web interface. Built with vanilla HTML, CSS, and JavaScript. No dependencies, no build step.

![App Screenshot](screenshot-3.png)

## Current version — 0.3.11

0.3.11 keeps the shared lock folder (`jobs_data.json.lock`) permanently and claims a file inside it instead of creating the folder on every save. Some Windows shares allow files but refuse to create folders, which made saves wait 90 seconds and fail although no client held the lock. A missing lock folder is now reported in seconds, stale claims are still reclaimed after two minutes, and a failed reclaim never deletes a lock another client just took. 0.3.10 resolved conflicts with one click; 0.3.9 made collaboration recover instead of freezing. See [release notes](CHANGELOG.md).

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

   The app creates `jobs_data.json.lock` next to the data file on first start. If the share does not allow users to create folders, create that one folder yourself (while the app is closed) and grant users Modify inside it.

3. **Build the executable:** from `jobs-app/server`, run `deno task build` with **Deno 2.9.8** — the fixed release toolchain for every version. 2.9.7 builds were quarantined by WithSecure as a false positive; 2.9.8 was scanned clean for both a hello-world and a real app build. Release builds and the Windows CI workflow both use it.

## Shared folder

- Every user runs the same current version against the same `jobs_data.json`.
- Changes are merged field by field under an exclusive lock, so two people can edit different rows or different fields of the same row at the same time.
- The lock is a permanent `jobs_data.json.lock` folder next to the data file. The exclusive claim is a `holder` file inside it, created in one step; `owner.json` is the 5 s heartbeat. The folder is created once (the app tries at startup) and never removed, so a share that refuses folder creation can still be used. A claim stranded by a crash is reclaimed automatically after two minutes.
- All PCs must run the same version: the lock protocol is version 2 as of 0.3.11. An older client that still holds the folder is detected and waited for, never taken over while its heartbeat is fresh.
- Same-field edits from stale copies are shown as conflicts instead of silently overwriting either value.
- While the shared file cannot be read, the page says so and retries every two seconds instead of showing an empty table.

## Backups

A validated snapshot is written to `backups/<YYYY-MM>/` when the newest valid backup is at least 48 hours old. The newest 36 snapshots are kept across all months; older ones are pruned. To restore, copy one snapshot over `jobs_data.json` while nobody has the app open.

## Diagnostics

`error.log` is written next to the executable (1 MB rotation to `error.log.1`) and records startup/shutdown, tab lifecycle, shared-lock waits and reclaims, merge/load failures, and browser-reported connection and conflict events. `JOBS_LOG_FILE` overrides the path. Timestamps are local time with the UTC offset, and the startup line records the offset and host name.

## Tests

From `jobs-app/server`: `deno task test` (needs Deno 2 and Chromium or Google Chrome). See `tests/README.md` for details.
