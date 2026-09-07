# Automated tests

From `jobs-app/server`:

```sh
deno task test
```

Requires Deno 2 and Chromium or Google Chrome. The browser executable defaults
to `chromium`; set `CHROME_BIN` to an executable name or absolute path when needed.
For example, on Linux with Google Chrome:

```sh
CHROME_BIN=google-chrome deno task test
```

Separate suites:

```sh
deno task test:server
deno task test:browser
```

The suite uses Deno's test runner and Chromium's DevTools protocol, without npm
test dependencies. It starts real server processes on automatically assigned
localhost ports. Each test has its own temporary data directory; browser tests
also use a disposable browser profile. Test cleanup stops the processes and
removes their temporary files. No production data path is used. The server's
`--no-browser` flag suppresses automatic desktop browser launch.

Tests need permission to start subprocesses, listen on localhost, and write to
temporary directories. A restricted sandbox may require approval to run them.

## Coverage

There are 65 tests: 32 browser scenarios, 28 server tests, and 5 utility tests.

- Server: stable IDs, two processes sharing a data file, concurrent field/row
  edits, identical edits, conflicts, additions, deletions, revision polling,
  corrupt/missing data, malformed merge requests, stale locks, backup creation
  and retention, and skipping a recent valid backup.
- Browser: add/edit/delete/undo, editing filtered rows, sorting mixed date
  formats, completion visibility, automatic dates, required fields, invalid
  dates, theme switching, CSV round trips across all columns, deduplication,
  delayed saves and polls, failed saves and retries, offline reload recovery,
  conflict choices, combined comments, unresolved conflict persistence, and
  safe rendering of imported text in date and text cells.
- Additional browser coverage: combined filters and exact counters, calendar
  navigation and Today, cancel and keyboard actions, menus and version display,
  preferences surviving reload, column resizing, lost save responses, multiple
  conflicts, full browser storage, startup recovery, legacy CSV encoding, and
  header sorting/filtering of 1,000 rows.
- Additional server coverage: embedded assets and version, origin/path rejection,
  live locks, both sides of the 48-hour backup interval, and editing restored data.
- Utilities: date conversion and calendar validity, CSV quoting and multiline
  fields, HTML escaping, markdown, and legacy column normalization.

Browser scenarios exercise real page controls where practical and call app
modules directly to set up precise concurrency and recovery conditions. They
also fail on uncaught browser exceptions. Delayed and failed network requests
are simulated inside the test browser; saves still use the real server.

The first run on the original behavior produced 30 passes and 11 failures.
Follow-up conflict persistence tests exposed two more failures. These cases
remain in the suite alongside the fixes.

## CI and remaining release checks

The test workflow runs on pushes and pull requests. Server and utility tests
run on Linux and Windows; browser tests run on Linux. The Windows executable
build depends on the same workflow passing. After compilation, the complete
suite runs again on Windows against `jobs-app.exe`, including browser scenarios.
`JOBS_TEST_EXECUTABLE` selects a compiled server instead of the source entry point.

These checks do not prove absence of bugs. Before distributing an executable,
exercise two actual computers using the shared drive, including disconnect and
reconnect. Network-share permissions, interrupted filesystem writes, antivirus
interference, and interactive desktop launch are not reproduced by these tests.
The current suite does not exhaustively cover visual layout, accessibility,
tab-driven server shutdown, legacy whole-file saves, real file-picker/download
dialogs, or performance beyond the 1,000-row functional scenario.
