# AGENTS.md - Tööde Haldus App

## Project Type
Single-page HTML work management app with soft neumorphic (soft UI) design.

## Files
- `jobs-app/src/index.html` — Main app (HTML + JS)
- `jobs-app/src/css/variables.css` — Design tokens (colors, shadows, radii)
- `jobs-app/src/css/base.css` — Body, container, buttons
- `jobs-app/src/css/header.css` — Header bar, status pills, legend
- `jobs-app/src/css/toolbar.css` — Toolbar, inputs, checkboxes, menu, popups
- `jobs-app/src/css/table.css` — Table, sticky columns, row tints, tooltips, editor
- `jobs-app/src/css/modal.css` — Modal, form inputs
- `jobs-app/src/css/calendar.css` — Calendar popup
- `jobs-app/src/css/scrollbar.css` — Scrollbar styling
- `jobs-app/src/css/status-bar.css` — Toast notifications
- `jobs-app/src/styles.css` — Root import file
- `jobs_data.json` — Data file (optional, loads from localStorage)

## Design System
- **Soft neumorphism** — Extruded surfaces with dual-shadow system (light TL + dark BR), inset/pressed states for inputs and active elements
- **Color palette** — Body `#b4b8c0`, card surface `#eef0f4`, input surface `#e4e8ee`, mint accent `#6abf9e`
- **Radius system** — `--radius-xs: 6px`, `--radius-sm: 12px`, `--radius-md: 16px`, `--radius-lg: 20px`
- **Single extruded card** — `.app-container` wraps header + toolbar + table into one continuous surface
- **Dark theme** — Full `[data-theme="dark"]` support with adjusted values
- **Custom scrollbar** — Matte, matching the theme

## How to Run
1. **Local:** Open `jobs-app/src/index.html` in Chrome/Edge
2. **Shared folder:** Copy `jobs-app/index.html` + `jobs_data.json` to shared network folder

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
- Copy `jobs-app/index.html` + `jobs_data.json` to shared folder
- Coordinate saves: "I'm saving now" → Save → overwrites shared CSV
- Last save wins

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
