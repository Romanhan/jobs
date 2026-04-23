# AGENTS.md - Tööde Haldus App

## Project Type
Simple single-page HTML app for work management - replaces Excel spreadsheet.

## Files
- `index.html` - Full app (HTML + CSS + JS in one file)
- `jobs_data.json` - Data file in same folder
- `launch.bat` - Windows one-click launcher

## How to Run
1. **Local:** Double-click `index.html` or `launch.bat`
2. **Shared folder:** Copy both `index.html` + `jobs_data.json` to shared network folder

## App Features
- **Load data:** Reads from `jobs_data.json` on page load
- **Add new work:** Click "+ Lisa uus" button
- **Edit:** Click any cell to edit inline
- **Mark started:** Check "Alustatud" checkbox → adds date automatically
- **Mark done:** Check "Valmis" checkbox → adds today as completion date, hides row
- **Show completed:** Toggle checkbox to see/hide completed jobs
- **Filters:**
  - Text filter by "Töö Nr"
  - Text filter by "Täitmise koht" (location)
  - Date range filter (from/to)
- **Save:** Click "Salvesta" → downloads updated `jobs_data.json`
- **Load:** Click "Laadi" → load data from a JSON file

## Collaboration (Shared Folder)
- Put BOTH `index.html` AND `jobs_data.json` on shared folder
- Users coordinate: "I'm saving now" → click Save → overwrites shared JSON
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

## Important Notes
- Chrome/Edge recommended for best compatibility
- First open loads `jobs_data.json` automatically (same folder)
- "Salvesta" downloads fresh JSON - save it to same shared folder
- No build steps, no dependencies needed