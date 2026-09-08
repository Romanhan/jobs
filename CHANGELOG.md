# Changelog

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
