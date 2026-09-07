# Changelog

## 0.3.2

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
- Add 65 automated tests covering core workflows, concurrency, recovery, CSV,
  calendar controls, preferences, filtering, sorting, backups, and a 1,000-row table.
- Gate release builds on Linux and Windows source tests, then run the complete
  suite against the compiled Windows executable and its embedded UI.

Use the same current executable on all computers sharing a data file. Actual
network-share outages, permissions, and antivirus behavior remain environment
checks; automated tests use isolated local files and simulated request failures.
