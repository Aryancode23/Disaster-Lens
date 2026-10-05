# Connecting Disaster Lens to Supabase (about 10 minutes)

You need: your Supabase project, and a place to host the website (GitHub Pages, Vercel or Netlify).

## 1. Create the database (once)
1. Supabase dashboard -> **SQL Editor** -> **New query**.
2. Open `supabase/schema.sql` from this folder, copy ALL of it, paste it in, press **Run**.
   You should see "Success. No rows returned". It is safe to run again later (it only adds what is missing).
   Do NOT run anything in `_set_aside_other_backend/`; that is a different design and would clash.
3. Check: **Database -> Tables** shows reports, profiles, comments... ; **Storage** shows a private bucket `report-images`.

## 2. Settings in the Supabase dashboard
* **Authentication -> URL Configuration**: set **Site URL** to your website address (for example `https://yourname.github.io/disaster-lens/`) and add the same address under **Redirect URLs**. Password-reset and email-confirmation links need this.
* **Authentication -> Sign In / Providers -> Email**: leave Email on. **Confirm email** is your choice:
  * ON (default, safer): people must click a link before their first log-in. Supabase's built-in email sender allows only a few emails per hour, so for real use add your own SMTP under Authentication -> SMTP Settings.
  * OFF: easiest while testing.
* **Database -> Replication**: nothing to do (the SQL file already switches on live updates for `change_feed`).

## 3. Connect the website
`js/config.js` already holds your project URL and the public **anon** key. They are meant to be public.
Never put the `service_role` key or any "secret" key in the website.

## 4. Put the website online
Upload the whole folder (or just `disaster-lens-single.html`, renamed `index.html`) to GitHub Pages / Vercel / Netlify.
The site will NOT reach Supabase from the Claude preview link; it must be opened from your own address.

## 5. Create the administrator FIRST
Open the site -> **Log in** -> **Set up the administrator**. The first person to finish that screen becomes admin.
Do this before you share the link with anyone.

## 6. Try it (5 minutes)
1. Sign up as a citizen (second browser or phone). Send a report with a photo and tap "Use my current location".
2. Sign up as an official (choose Public Works). In the admin browser open Authorities and approve the ID.
3. As the official: Start work, then Mark resolved with a photo. The citizen's screen updates by itself (small "Live" tag at the bottom).
4. As the citizen: Check the work, give stars.
5. Log out and try "Forgot your password?".

## If something does not work
* "The server is missing an update" -> run `supabase/schema.sql` again.
* Sign-up says too many tries -> Supabase email limit; wait, or add SMTP.
* Photos do not show -> check the bucket is named `report-images` and private; run the SQL again.
* Live tag says "Reconnecting" -> the app still refreshes every 25 seconds.
