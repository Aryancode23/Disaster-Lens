# Disaster Lens

Civic and disaster reporting website. Plain HTML, CSS and JavaScript. No AI, no API keys, no build step.
Open `index.html`, or upload the folder to GitHub Pages / Netlify / Vercel.

Developer: Team Tech Giants · devp3987@gmail.com

## Phases (each download contains every earlier phase)
1. Foundation and citizen side (included)
2. Officials: desk, start work, resolve with proof, transfer, escalate (included)
2.5. UX simplification: new home, 4-step report flow, plain statuses, shared components (included)
3. Citizen checks the work: confirm with a star rating, or reopen; auto-close; department ratings (included)
4. Admin, moderation, trust, authority verification, audit (included)
5. Maps, location privacy, heatmap and analytics (included)
6. Online backend with Supabase: sign-in, photo upload, live updates, server-side rules (included)  <- you are here

## First run
The real site starts EMPTY. Open `#/setup` (the login page links to it) and create the first administrator with your own password. There are no default accounts.

## Demo mode (`#/demo`, linked from About)
Sample data lives in a separate space (`dl_demo_v2`), filled by `js/demo-seed.js`. Names start with "Demo", report titles with "[Demo]". It never mixes with real data. To remove demo data from a build, delete `js/demo-seed.js` and its script tag.
Demo password for every demo account: Demo@12345 (admin@demo.local, official@demo.local, pending@demo.local, citizen@demo.local, neighbour.a@demo.local, neighbour.b@demo.local).

## Where the rules live
`js/store.js` is the only file that reads or writes data and the only place permissions are decided. Pages in `js/views.js`, `js/admin.js`, `js/account.js` only display things. When the real backend arrives (Phase 6), `store.js` is what gets replaced by server code and database policies.

## Security note
Right now data is stored in each browser (localStorage). The permission checks stop normal use and mistakes, but a person with developer tools on their own device can still change their own copy of the data. Real protection needs the server in Phase 6. The code contains no API keys or secrets.

## Maps, heatmap and analytics (Phase 5)
- `js/geo.js` place names, map maths, privacy snapping, coordinate checks. `js/map.js` the map itself (no library, no key). `js/mapviews.js` the Map page and admin Insights.
- Public maps show a point moved to the centre of a square (500 m by default, admin can change it). Officials see exact points for their own department; admins see everything. A report with no GPS appears only at its city centre, marked approximate, and never in the heatmap.
- The street-map picture behind the reports is OFF by default. Turning it on (Settings) makes visitors' browsers load pictures from OpenStreetMap.
- Analytics and the heatmap use real, active reports only. Demo records are ignored even if they reach the real database.
- `store.mapPoints(filters)` takes filters, a bounding box and a limit, so it can be replaced by a PostGIS query in Phase 6.

## Testing locally
Serve the folder over http (for example `python3 -m http.server`) rather than opening the file directly; some browsers lose saved data between reloads on `file://` addresses.

## Online backend (Phase 6)
See `docs/SUPABASE_SETUP.md` for the exact steps. In short: run `supabase/schema.sql` in the Supabase SQL editor, keep your URL and public anon key in `js/config.js`, host the folder, then create the administrator from the log-in page.
* Leave `js/config.js` empty to run stand-alone (data in each browser). Demo mode (`#/demo`) is always stand-alone sample data.
* Online, the browser never touches tables. It asks `get_snapshot()` for what it may see and calls database functions to change anything; each function checks who is calling.
* Photos go to a private bucket (2 MB, JPEG/PNG/WebP) and are shown through short-lived signed links.
* `_set_aside_other_backend/` holds files found in the project that describe a different backend design. Nothing there is loaded.
* `tests/` has the database tests (real PostgreSQL via PGlite) and the browser tests; see `tests/README.md`.
