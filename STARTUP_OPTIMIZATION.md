# Startup Time Optimization — TODO

## Phase 1 — Measure first

- [x] **1.1** Add `performance.mark()` / `performance.measure()` at key points in `init()`:
  - `init-start` — first line of `init()`
  - `data-fetch-start` — before `await loadData()`
  - `data-fetch-end` — after `await loadData()`
  - `render-done` — after `renderTable()` + `renderForm()` + `updateStats()`
  - Log all `startup-*` measures to console on first `requestAnimationFrame`
- [ ] **1.2** Run Chrome DevTools Performance recording (4× CPU throttling) to establish baseline
- [ ] **1.3** Set a performance budget: <500ms from navigation to interactive on 4× throttled CPU

## Phase 2 — Critical rendering path

- [x] **2.1** Replace `@import` chain in `styles.css` — use `<link>` tags directly in `index.html` for each of the 9 CSS files (parallel loading instead of sequential)
- [x] **2.2** Move `renderTable()` + `renderForm()` before `await loadData()` — show the UI shell immediately, populate after data arrives
- [x] **2.3** Make `setRowFontSize()` only set the CSS variable (skip `renderTableBody()` + `updateStickyPositions()`) — those run again in `renderTable()` moments later

## Phase 3 — Bundle & loading

- [ ] **3.1** Combine JS modules into fewer files (e.g. `vendor.js` + `app.js`) to reduce HTTP request waterfall
- [ ] **3.2** Split `attachEventListeners()` — defer non-critical listeners (tooltips, menu, font slider) via `requestIdleCallback` or after first render
- [ ] **3.3** Lazy-load `calendar.js` — use dynamic `import('./calendar.js')` in the click handler instead of static import

## Phase 4 — Data & rendering efficiency

- [ ] **4.1** Batch 7 separate `localStorage.getItem()` calls into one `JSON.parse(localStorage.getItem('settings'))`
- [ ] **4.2** Consolidate `updateStickyPositions()` calls — debounce or call once after all rendering is done
- [ ] **4.3** Add `Cache-Control: public, max-age=31536000, immutable` for JS/CSS assets in `server.ts` (with version query param for cache busting)

## Phase 5 — Server-side

- [ ] **5.1** Cache parsed JSON in memory in `server.ts` — skip disk read + JSON.parse on every `/api/data` GET; invalidate on POST
- [ ] **5.2** Keep `ensureDataFile()` parsed result in memory to serve first client request instantly
