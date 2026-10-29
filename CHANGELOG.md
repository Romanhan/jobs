# Changelog

## 0.5.2

- Vim keys: `Ctrl+D` / `Ctrl+U` now move half a screen, like nvim, and the
  view scrolls with the cursor so it keeps its place on screen. They used to
  jump a whole screen; `PageDown` / `PageUp` still do (nvim's `Ctrl+F` /
  `Ctrl+B`).
- Vim keys: the row-number gutter is sized from the real width of the numbers
  at the current font size (and re-sized when the font size changes), so the
  status dot sits exactly midway: 4 px to the number and 4 px to the work
  number, at every font size.

## 0.5.1

- Vim keys: the row with the cursor is highlighted like a hovered row (nvim's
  cursorline), also while its cell is being edited.
- Vim keys: relative row numbers in the left gutter, like nvim's `number` +
  `relativenumber`: the cursor row shows its own number (in bold), every
  other row its distance from it, so `5j` / `3k` can be read off the gutter.
  The gutter only widens while vim mode is on.
- Vim keys: the statusline ruler now reads like nvim's: column name, then
  `row,column`, then `Top` / `Bot` / `All` or the position in percent. It used
  to show `row/total`, whose second number never changed while moving.

## 0.5.0

- Add an optional vim-style keyboard mode: Menu → "Vim keys". It is off by
  default and remembered per browser, so nothing changes for anyone who does
  not turn it on. While it is on, an nvim-style statusline under the table
  shows the mode (`NORMAL` / `INSERT`), pending keys and the cursor's column
  and row, and the table has a cell cursor that survives saves, polls and
  sorting:
  - `h j k l` / arrows move, with counts (`5j`, `3k`); `w` / `b` jump to the
    next / previous text cell across rows; `gg` / `G` first / last row and
    `10G` / `2gg` a given row; `0` / `$` first / last column; `Ctrl+D` /
    `Ctrl+U` and PageDown / PageUp page down / up; `zz` centers the cursor row;
    `]c` / `[c` jump to the next / previous conflicted row.
  - `i` / `Enter` edit the cell (`Esc` returns to it), `Space` ticks the
    checkbox under the cursor, `x` / `s` / `m` toggle "Valmis" / "Alustatud" /
    "Töötlus Lõpetatud" on the cursor row, `t` puts today's date into a date
    cell, `o` adds a job, `dd` deletes the row after the usual confirmation.
  - `yy` then `p` duplicates a row (this replaces `Ctrl+D` while vim mode is
    on), `u` / `Ctrl+R` undo / redo (`Ctrl+R` no longer reloads the page;
    `Ctrl+Y` also redoes).
  - `/` jumps to the "Töö Nr" filter and `f` to the machine filter (`Enter`,
    `Esc` or `jk` return to the table), `g1` … `g6` press the status pills
    ("Aktiivsed" … "Valmis"), `Esc Esc` clears all filters, `!` opens the
    conflict popup.
  - `jk` typed quickly (within 300 ms) in the cell editor saves and returns to
    normal mode, like the common nvim mapping. `Esc` in the editor still
    cancels the edit.
  - `gd` opens the calendar of a date cell. In any open calendar `h` / `l`
    move a day, `j` / `k` a week, `H` / `L` a month, `t` jumps to today and
    `Enter` picks the date.
  - `,` (leader) opens a which-key popup above the statusline: `t` TOS, `k`
    Karusel, `n` no date, `b` blank location, `m` menu,
    `v…` views (`d` dates, `c` completed, `a` subcontract) and `s…`
    sort by part (`d`), need date (`e`) or machining start (`m`).
  - In the menu and the sync / conflict popup `j` / `k` move between buttons
    and `Enter` picks; conflict buttons also answer to `s` (shared), `m`
    (mine), `b` (combine both) and `r` (retry). The delete confirmation takes
    `y` / `n`.
  - `?` shows only the vim keys, grouped by moving, editing, search, popups
    and leader, and is generated from the same key table that handles the
    keys, so the help cannot drift. Menu → "Shortcuts" keeps showing the
    default keys.
- Vim keys respond only with the English keyboard layout. With the Estonian
  or Russian layout every key works as before and the statusline shows
  `VIM: EN`.
- `Ctrl+D`, `Ctrl+Z`, `Ctrl+;` and the editor's `Ctrl+B` / `Ctrl+I` /
  `Ctrl+Shift+S` now also work with the Russian keyboard layout.

The data format, the merge protocol and the lock protocol are unchanged.
0.5.0 can share a data file with 0.3.11 – 0.4.0.

## 0.4.0

- Add a "Fully Machined" status ("Töödeldud" / "Обработано") for rows where
  "Töötlus Lõpetatud" is ticked but "Valmis" is not — machining is done and the
  part only waits for delivery. These rows get a deep green tint and dimmed
  text, a legend dot, and a counter pill right after "In progress" that filters
  to them. They no longer count as "In progress" or "Subcontract". An overdue
  need date still wins and keeps the row red.
- Lighten the "In progress" green so it reads as the step before
  "Fully Machined" in both themes.
- Add a "No date" button ("Kpv puudub" / "Без даты") after TOS and Karusel that
  shows only rows without an "EE vajaduse kuupäev". It combines with the
  location buttons and is cleared by the "Active" pill.
- Rename the "Täitmise koht" labels to "Machine" in English and "Станок" in
  Russian (column header, tooltip, filter box and add form), and widen the
  filter box so the placeholder fits. Estonian labels and the data column name
  are unchanged.

The data format, the merge protocol and the lock protocol are unchanged, and
the new status only reads the existing "Töötlus Lõpetatud" field. 0.4.0 can
share a data file with 0.3.11 and 0.3.12; older clients simply show
fully machined rows with their previous colour.

## 0.3.12

- Add EST / ENG / RUS language buttons at the top of the menu. The whole
  interface — header, toolbar, menu, column headers and tooltips, add form,
  calendar, popups, conflict resolution and notifications — is available in
  Estonian (default), English and Russian, and the choice is remembered per
  browser. Data, column keys and CSV files are unchanged.

## 0.3.11

- Keep the shared lock folder (`jobs_data.json.lock`) permanently and claim a
  file inside it (`holder`, created exclusively) instead of creating the folder
  on every save. Some Windows shares allow creating files but refuse to create
  folders, which made every save wait 90 seconds and fail even though no client
  held the lock. The folder is created once — the app tries at startup — and is
  never removed; a stale claim is still renamed aside after two minutes.
- Report a missing lock folder in seconds with a message that names it, instead
  of retrying until the 90-second timeout. A fresh heartbeat written without a
  holder is recognised as a 0.3.10 lock and waited for, and a leftover
  heartbeat from a partial release does not block the next save.
- A failed stale reclaim no longer falls back to deleting the path, which could
  remove a claim another client had just acquired.
- Reclaim an empty claim after 30 seconds instead of two minutes. A client that
  failed between creating `holder` and writing it no longer stalls every save.
- Read the claim back after creating it and only act as the owner when it
  carries this client's token, so a claim moved aside in the same instant
  cannot produce two owners.
- Move the build toolchain to Deno 2.9.8. 2.9.7 `deno compile` output was
  quarantined by WithSecure as `Trojan.TR/W64.Malware` (false positive on the
  compiled shell) and broke the resource merge that `set-version-info.ts`
  relies on. With 2.9.8 both a hello-world build and a full 0.3.10 executable
  were accepted by WithSecure, and the version stamp kept the embedded payload
  byte for byte. 2.9.7 remains excluded; CI pins `v2.9.8`.

The data format and the merge protocol are unchanged. The lock protocol is
version 2: `jobs_data.json.lock` must exist once on the share (the app creates
it when the share allows folder creation), and every PC must run 0.3.11 or
newer. Upgrade all PCs together: do not mix 0.3.10 and 0.3.11 on one share.
A 0.3.10 client treats the permanent folder as its own stale lock and renames
it away after two idle minutes — on a share that refuses folder creation
nobody can recreate it — and in a short window both versions can believe they
hold the lock. Close the app everywhere, create the folder if needed, then
start 0.3.11.

## 0.3.10

- Resolve a conflict with one click. After a poll updated an open conflict,
  the tab still compared the decision with the row's old base, so the save
  came back as the same conflict: "Taasta minu versioon" on a row deleted
  elsewhere, "Jäta kustutatuks", and "Kasuta minu väärtust" after the other
  user changed the value again all needed a second click. The decision is now
  made against the shared value shown in the popup.
- Name both sides of a row-level conflict (same ID, different content) as
  "Kasuta salvestatud rida" / "Kasuta minu rida" instead of showing the raw
  field name. "Kasuta minu rida" applies my values on top of the shared row, so
  columns my row does not carry are kept instead of being blanked.

The data format and the synchronization protocol are unchanged.

## 0.3.9

- Keep polling while a conflict is open. A tab with an unresolved conflict used
  to stop receiving updates, which is how one user kept seeing a row another
  user had already deleted. The tab now follows the shared file and only keeps
  the values that are actually in conflict.
- A field conflict on a row that was deleted elsewhere becomes a deletion
  conflict instead of pointing at a row that no longer exists, and a conflict
  whose shared value already equals the local value is dropped.
- Mark conflicted rows in the table with an amber tint and a `!` marker that
  opens the resolution popup, and count pending conflicts in the popup title.
- Name the outcome in the deletion popup ("Kustuta töö" / "Taasta minu
  versioon") instead of "Kasuta minu väärtust", which silently re-created a
  deleted row.
- Retry a failed save automatically with 5 s → 30 s backoff, paused while the
  tab is hidden and resumed on focus or reconnect. A rejected request (invalid
  merge) is not retried, so its error stays visible.
- Log conflict lifecycle events (`conflict-open`, `conflict-resolved`) and
  throttle repeated save failures, so `error.log` can answer who still holds a
  deleted row.
- Write log timestamps in local time with an explicit UTC offset (for example
  `2026-10-19T14:54:55.330+03:00`) and record the offset on the startup line.
  Previously the log was UTC, which looked three hours behind on a Tallinn PC.
- File backup snapshots by month in `backups/<YYYY-MM>/`. Existing snapshots in
  `backups/` are still counted, kept and pruned; retention is unchanged at the
  newest 36, and empty month folders are removed.
- Rewrite the README in English and document the shared-folder rules, backups
  and diagnostics.

The data format and the synchronization protocol are unchanged.

## 0.3.8

- Fix the first reported shared-drive outage: a lock directory that a network
  share refuses to recreate (`ACCESS_DENIED`, not "already exists") was retried
  forever, so one stranded `jobs_data.json.lock` blocked saving and loading for
  every user until someone cleared it by hand. A refused create is now
  inspected: the lock owner is read, a stale lock is reclaimed, and only a
  genuinely live lock is waited for.
- Reclaim a stale lock by renaming it to a unique tombstone before deleting it,
  so two waiting computers can no longer delete each other's freshly acquired
  lock. Tombstones are invisible to older versions and are cleared at startup.
- Confirm that the lock directory is really gone after a "successful" removal.
  Network shares can report a completed delete while the directory is still
  pending removal, which is what makes later creates fail with access denied.
- Wait up to 90 s for a lock instead of 15 s, and back off between attempts
  instead of retrying every 100 ms. Real merges on the work share hold the lock
  for 25–35 s, so the old timeout failed every save that overlapped another
  user's save.
- Refresh the lock owner file every 5 s while holding the lock, and require both
  the directory and that heartbeat to look stale before reclaiming anything, so
  a slow but live save is never broken into.
- Shrink the time spent holding the lock: the automatic backup now scans and
  validates old snapshots outside the lock, and reading the shared file no
  longer needs the lock at all (writes are already atomic).
- Add a per-attempt progress line, the observed lock state, the lock owner and a
  data-directory writability probe to the diagnostics log, so the next outage
  distinguishes a stranded lock from an unreachable share.
- Record the lock state at startup and clear leftover tombstones.
- Show an explicit "Andmed ei ole saadaval" panel with the unreadable file path
  while the shared file cannot be read, instead of a silently empty table. The
  two-second poll still recovers automatically, and the panel names the file in
  the browser diagnostics log.

The shared-data format and synchronization protocol are unchanged.

## 0.3.7

- Record a diagnostics log next to the executable, so `error.log` is easy to find
  on the work computers regardless of the shortcut's working directory. The log
  rotates to `error.log.1` at 1 MB, and falls back to the working directory when
  the executable's folder is read-only. `JOBS_LOG_FILE` overrides the location.
- Log every line with host, process ID, and app version.
- Record the reason for connection loss: server start and reuse, tab connect and
  expiry, idle shutdown, poll and data-load failures with the underlying error,
  slow shared-lock waits with the lock owner, and the lock diagnostics from
  0.3.5 (owner metadata, future timestamps, filesystem failures).
- Add `/api/client-log`, so the browser reports poll and save failures with its
  tab ID, `navigator.onLine`, and page visibility. Repeated conditions are
  throttled to keep the log readable.
- Restore the Windows message box for startup failures (port conflict or server
  error) that would otherwise be invisible without a console, and record the
  browser-launch exit code.
- Keep the tab registered with the server every 60 s even while a cell editor is
  open, and raise the tab-expiry timeout from 5 to 15 minutes. Previously a tab
  left open in an editor for over five minutes expired, the server shut down,
  and the app reported "Serveriga puudub ühendus".

The shared-data format and synchronization protocol are unchanged.

## 0.3.6

- Duplicate a row with Ctrl+D: the focused or hovered row is copied with a new
  internal ID, status fields reset, today's date set, and the Töötlus algus and
  EE lõpp dates preserved. Copying with no row targeted shows a red hint.
- Remove the temporary shared-lock and connection diagnostics added in 0.3.5
  (extended error.log context, lock-owner metadata, and the Windows PowerShell
  startup-error dialog).
- Stamp the Windows executable with its file version, so Explorer's Details tab
  and PowerShell `VersionInfo` report 0.3.6. The version resource is merged
  alongside Deno's embedded payload instead of being written by rcedit, which
  dropped that payload and made the executable fail with "Could not find
  standalone binary section".
- Pin the build toolchain to Deno 2.9.6: 2.9.7 `deno compile` output is
  quarantined by WithSecure as `Trojan.TR/W64.Malware`. The detection is a false
  positive on the compiled shell and also hits a hello-world build, while 2.9.6
  output is accepted.

The shared-data format and synchronization protocol are unchanged.

## 0.3.5

- Open the browser interface before accessing shared data, and combine initial
  validation and loading into one protected read.
- Defer the startup backup check until the page has populated the table.
- Reuse a running instance with the same version, user, and data path instead
  of killing the process occupying its port.
- Let the surviving server open the browser on repeat launches; the second
  executable no longer starts a browser helper immediately before exiting.
- Record browser helper failures, including unsuccessful exit codes.
- Preserve the five-second shutdown delay after the last tab closes, with a
  temporary reservation while a reopened tab connects.
- Add startup, port-conflict, and browser-launch ownership regression tests.

The shared-data format and synchronization protocol are unchanged. Windows
interactive launching and shared-drive behavior still require testing on the
work computers.

## 0.3.4

- Retry shared-data lock removal after temporary filesystem errors instead of
  silently leaving the lock behind after the first failure.
- Log lock cleanup failures if all removal attempts fail.
- Add regression tests for temporary removal failures and consecutive row edits.

The shared-data format and synchronization protocol are unchanged. This fixes
a cleanup failure path; actual shared-drive behavior still needs verification
on the affected computers.

## 0.3.3

- Automatically retry full initialization after an initial data-load failure.
- Restore adding and saving after access returns, including the merge baseline
  and recovery of pending local edits.
- Prevent polling from displaying rows while startup remains incomplete.
- Add a browser regression test for failed startup followed by recovery and a new saved job.

This fixes recovery after a loading failure; it does not change the shared-file
locking mechanism or establish the cause of the reported lock timeouts.

## 0.3.2

- Remember sorting per browser across saves and reopening; Aktiivsed resets to
  EE vajadus ascending, with empty dates last.
- Default new jobs to a 7-day reminder without changing existing reminders.


- Keep keyboard focus inside the Add dialog and prevent background row changes.
- Keep long cell editors inside the viewport, with scrolling for long text.
- Reposition editors with their rows; save and close when the row scrolls out of view.
- Add four UI regression tests using real mouse and keyboard events.

- Preserve the original save baseline when recovering offline edits, so another
  user's changes still produce conflicts instead of being overwritten.
- Preserve unresolved local conflict values through reloads and unrelated saves.
- Apply both choices correctly when one user deletes a row and another edits it.
- Ignore unchanged stale rows that another user has deleted.
- Prevent delayed polling from replacing newer saved edits or bypassing conflicts
  while a cell is being edited.
- Reject malformed merge requests and duplicate or missing row IDs.
- Reject impossible dates and store calendar selections consistently.
- Escape imported text in date cells before rendering it.
- Continue shared-file saves when browser storage is full; warn if a pending edit
  cannot be backed up locally.
- Add 69 automated tests covering core workflows, concurrency, recovery, CSV,
  calendar controls, preferences, filtering, sorting, backups, and a 1,000-row table.
- Gate release builds on Linux and Windows source tests, then run the complete
  suite against the compiled Windows executable and its embedded UI.

Use the same current executable on all computers sharing a data file. Actual
network-share outages, permissions, and antivirus behavior remain environment
checks; automated tests use isolated local files and simulated request failures.
