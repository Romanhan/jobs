# AGENTS.md - Tööde Haldus App

## Project Type
Simple single-page HTML app for work management - replaces Excel spreadsheet. Features a modern slate-gray skeuomorphic design.

## Files
- `jobs-app/src/index.html` - Main app (HTML + JS)
- `jobs-app/src/styles.css` - Slate-gray skeuomorphic theme
- `jobs_data.json` - Data file (optional, loads from localStorage)

## Design
- **Slate-gray color palette** - Professional look with #64748b, #475569, #334155
- **Skeuomorphic elements** - Custom checkboxes with gradients, beveled buttons, depth shadows
- **Compact header layout** - Title + status boxes + legend + actions in single row
- **CSV buttons top-right** - "💾 Salvesta CSV" and "📂 Laadi CSV" with icons
- **Subtle accent color** - Sky blue (#0ea5e9) for interactive elements
- **Custom scrollbar** - Styled to match the theme

## How to Run
1. **Local:** Open `jobs-app/src/index.html` in Chrome/Edge
2. **Shared folder:** Copy `jobs-app/src/index.html` + `jobs_data.json` to shared network folder

## App Features
- **Load data:** Reads from `jobs_data.json` or localStorage on page load
- **Add new work:** Click "+ Lisa uus" button (modal form)
- **Edit:** Click any cell to edit inline
- **Mark started:** Check "Alustatud" checkbox → adds date automatically
- **Mark done:** Check "Valmis" checkbox → adds today as completion date, hides row
- **Show completed:** Toggle checkbox to see/hide completed jobs
- **Filters:**
  - Text filter by "Töö Nr"
  - Text filter by "Täitmise koht" (location)
- **Save:** Click "💾 Salvesta CSV" → downloads updated `jobs_data.csv`
- **Load:** Click "📂 Laadi CSV" → load data from a CSV file

## Collaboration (Shared Folder)
- Put `jobs-app/src/index.html` AND `jobs_data.json` on shared folder
- Users coordinate: "I'm saving now" → click Save → overwrites shared CSV
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
- First open loads from localStorage or `jobs_data.json` automatically
- "Salvesta CSV" downloads fresh CSV - save it to same shared folder
- No build steps, no dependencies needed
- Desktop-only design (not optimized for mobile)