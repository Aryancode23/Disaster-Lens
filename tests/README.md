# Tests
Run `npm install` here first. Python tests need `pip install playwright` and `playwright install chromium`.

* `node sqltest.js` : 87 checks of supabase/schema.sql on a real PostgreSQL engine (PGlite): blocked table access, privacy, department isolation, moderation, audit chain, storage rules, realtime feed.
* `node realclient.js` : 11 checks of the exact requests the website makes, using the real supabase-js library against a local recorder.
* Browser test against the real schema: `node serve-pglite.js` (port 8766), serve the site folder on port 8767 (`python3 -m http.server 8767`), then `python3 remote_e2e.py` (61 checks). The Supabase client is replaced by `mock-supabase.js`: the database rules are real, the sign-in tokens, HTTP, storage service and realtime socket are imitated.
* Paths inside these files point at the folders used while building; change them to your own.
These tests never contact a real Supabase project.
