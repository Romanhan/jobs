# Job Management

A soft neumorphic (soft UI) job management app — replaces Excel spreadsheets with an intuitive web interface. Built with vanilla HTML, CSS, and JavaScript. No dependencies, no build step.

![App Screenshot](screenshot-3.png)

**Current version: 0.5.1** — see the [release notes](CHANGELOG.md).

## Features

- **20 columns** for tracking jobs from start to finish
- **Inline editing** — click any cell to edit
- **Auto-date** — marking a job started or done fills the matching date
- **Status indicators & row tinting** — in progress / fully machined / subcontract / overdue / done
- **Filters** — by job number and machine, rows without a need date, show completed or subcontract work
- **CSV import/export** and **automatic backups** (validated snapshot every 48 hours, newest 36 kept, filed by month)
- **Text formatting** — bold (`**`), important (`!!`), strikethrough (`~~`)
- **Undo, duplicate row, sorting, column resize and font size**
- **Light & dark theme** with a soft neumorphic look
- **Interface languages** — Estonian, English and Russian, switched from the menu
- **Vim keys (optional)** — Menu → "Vim keys" turns on a keyboard-driven mode with a cell cursor, an nvim-style statusline and a `,` leader menu; off by default and per browser
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

The Ctrl shortcuts also work with the Russian keyboard layout.

### Vim keys

Turn on Menu → "Vim keys" (off by default, remembered per browser). The keys respond only with the English keyboard layout, and `?` lists them all in the app. If you use a browser extension such as Vimium C, exclude the app's address (`http://localhost:8085`) in it, or it takes the keys first.

| Keys | Action |
| --- | --- |
| `h j k l`, `5j`, `w` / `b` | Move the cursor (with counts; next / previous text cell); the left gutter shows relative row numbers |
| `gg` / `G` / `10G`, `0` / `$` | First / last / Nth row, first / last column |
| `Ctrl+D` / `Ctrl+U`, `zz` | Page down / up, center the row |
| `i` / `Enter`, `jk`, `Esc` | Edit, save and leave the editor, cancel |
| `Space`, `x` / `s` / `m` | Tick the checkbox; toggle Valmis / Alustatud / Töötlus Lõpetatud |
| `t`, `gd` | Today's date; open the calendar (`hjkl`, `H` / `L`, `t`, `Enter`) |
| `o`, `dd`, `yy` / `p` | New job, delete row (`y` / `n`), copy / paste a duplicate |
| `u` / `Ctrl+R` | Undo / redo |
| `/`, `f`, `g1` … `g6`, `Esc Esc` | Search Töö Nr / machine, status pills, clear filters |
| `]c` / `[c`, `!` | Next / previous conflict, open conflicts |
| `,t` `,k` `,n` `,b` | TOS, Karusel, no date, blank location |
| `,v` `d` `c` `a`, `,s` `d` `e` `m`, `,m` | Views, sort by part / need date / machining start, menu |
