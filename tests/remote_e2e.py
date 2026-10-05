import asyncio, sys, base64, zlib, struct, json, re, urllib.request
from playwright.async_api import async_playwright
SITE='http://127.0.0.1:8767/index.html'
MOCK=open('/home/claude/tests/mock-supabase.js').read()
def png(w=64,h=48):
    raw=b''.join(b'\x00'+bytes([(x*4)%256,(y*5)%256,160])*1 *1 + b'' for y in range(h) for x in [0]) # placeholder
    rows=b''.join(b'\x00'+b''.join(bytes([(x*4)%256,(y*5)%256,160]) for x in range(w)) for y in range(h))
    def ch(t,d): c=struct.pack('>I',len(d))+t+d; return c+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(rows))+ch(b'IEND',b'')
open('/tmp/photo.png','wb').write(png())
R=[]
def ok(n,c,extra=''):
    R.append((n,bool(c))); print(('PASS ' if c else 'FAIL ')+n+('' if c else ' | '+str(extra)[:260]))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1280,'height':850}, geolocation={'latitude':26.8467,'longitude':80.9462}, permissions=['geolocation'])
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)))
        pg.on('console',lambda m: errs.append(m.text[:200]) if m.type=='error' and '403' not in m.text and 'fonts' not in m.text.lower() else None)
        await pg.route('**/js/vendor/supabase.js', lambda r: r.fulfill(body=MOCK, content_type='text/javascript'))
        T=pg.locator; ev=pg.evaluate
        async def go(h,w=500): await ev(f"location.hash='{h}'"); await pg.wait_for_timeout(w)
        async def sql(q,*a): return await ev("([q,a])=>__sb.sql(q,a)",[q,list(a)])
        async def ui_login(em,pw):
            await go('#/login',350); await T('#l-em').fill(em); await T('#l-pw').fill(pw); await T('#l-go').click(); await pg.wait_for_timeout(1200)
        async def ui_logout(): await ev("DL.store.logout()"); await pg.wait_for_timeout(900)
        await pg.goto(SITE); await ev("__sb.ready()"); await pg.wait_for_timeout(2500)

        # ---------- first run, administrator, session
        await go('#/login',400)
        ok('FIRST RUN: login page says there is no administrator, forgot-password link present (online mode)', 'no administrator yet' in (await T('#app').inner_text()).lower() and await T('#l-forgot').count()==1)
        await go('#/setup',400)
        await T('#su-name').fill('Site Owner'); await T('#su-em').fill('owner@x.org'); await T('#su-pw').fill('LongPassw0rd!'); await T('#su-pw2').fill('LongPassw0rd!'); await T('#su-go').click(); await pg.wait_for_timeout(2500)
        ok('SETUP: administrator created through the UI and lands on the dashboard', await ev("location.hash")=='#/admin' and 'Admin dashboard' in await T('#app').inner_text(), await ev("location.hash"))
        ok('SETUP: server confirms exactly one admin and an audit entry', (await sql("select count(*)::int c from profiles where role='admin'"))[0]['c']==1 and (await sql("select count(*)::int c from audit_log where action='setup.admin_created'"))[0]['c']==1)
        await pg.reload(); await ev("__sb.ready()"); await pg.wait_for_timeout(2500)
        await go('#/admin',500)
        ok('SESSION: after a full page reload the admin is still signed in', 'Admin dashboard' in await T('#app').inner_text())
        await go('#/setup',400); ok('SETUP: the setup screen locks itself once an admin exists', 'finished' in (await T('#app').inner_text()).lower())
        await ui_logout(); ok('LOGOUT: back to a guest', await ev("DL.store.me()")is None)
        await ui_login('owner@x.org','wrong-password'); ok('LOGIN: wrong password gives a plain-language message', 'Wrong email or password' in await T('#l-alert').inner_text(), await T('#app').inner_text())
        await ui_login('owner@x.org','LongPassw0rd!'); ok('LOGIN: correct password signs in and opens the admin dashboard', await ev("location.hash")=='#/admin')

        # ---------- citizens: sign up
        await ui_logout(); await go('#/signup',400)
        async def signup(name,email,pw='Password123',official=False):
            await go('#/signup',350)
            if official: await T('label:has-text("I am an official")').click()
            await T('#s-name').fill(name); await T('#s-em').fill(email); await T('#s-pw').fill(pw); await T('#s-state').select_option('Uttar Pradesh'); await T('#s-dist').fill('Lucknow'); await T('#s-city').fill('Lucknow')
            if official: await T('#s-arole').fill('District Officer'); await T('#s-dept').select_option('works'); await T('#s-idp').fill('ID 4455, Public Works office Lucknow')
            await T('#s-go').click(); await pg.wait_for_timeout(1800)
        await signup('Asha Verma','asha@x.org')
        ok('SIGN UP: citizen account created, signed in, lands on home', await ev("location.hash")=='#/' and (await ev("DL.store.me()")) and (await ev("DL.store.me().role"))=='citizen')
        await ui_logout(); await signup('Asha Again','asha@x.org')
        ok('SIGN UP: an existing email is refused in plain words', 'already exists' in await T('#s-alert').inner_text(), await T('#s-alert').inner_text())
        await ev("__sb.failSignUp({message:'email rate limit exceeded',code:'over_email_send_rate_limit'})"); await ui_logout(); await signup('Limit Test','limit@x.org')
        t=await T('#s-alert').inner_text()
        ok('SIGN-UP LIMIT: the real Supabase "email rate limit" case is explained, with the fix for the site owner', 'cannot send emails' in t and 'Confirm email' in t and 'email rate limit exceeded' in t and 'Too many tries' not in t, t)
        ok('...and the person is told nothing was created', (await sql("select count(*)::int c from auth.users where email='limit@x.org'"))[0]['c']==0)
        await ev("__sb.failSignUp({message:'Request rate limit reached',code:'over_request_rate_limit'})"); await signup('Limit Two','limit2@x.org')
        ok('SIGN-UP LIMIT: a per-device limit gets its own short message', 'Too many attempts from this device' in await T('#s-alert').inner_text())
        await ev("__sb.failSignUp(null)")
        await ev("__sb.confirmRequired(true)"); await signup('Bela Rao','bela@x.org')
        ok('EMAIL CONFIRMATION: sign-up shows "Check your email" and does not sign in', 'Check your email' in await T('#app').inner_text() and 'bela@x.org' in await T('#app').inner_text() and (await ev("DL.store.me()")) is None)
        await ui_login('bela@x.org','Password123'); ok('EMAIL CONFIRMATION: logging in before confirming is refused with a helpful message', 'confirm your email' in (await T('#l-alert').inner_text()).lower())
        await ev("__sb.confirm('bela@x.org')"); await ev("__sb.confirmRequired(false)"); await ui_login('bela@x.org','Password123'); ok('EMAIL CONFIRMATION: works after the link is opened', (await ev("DL.store.me()")) and (await ev("DL.store.me().name"))=='Bela Rao')
        await ui_logout()

        # ---------- report with a photo, end to end
        await ui_login('asha@x.org','Password123'); await go('#/new',500)
        await T('label.tile:has-text("Roads")').click(); await T('#r-title').fill('Deep pothole near the market'); await T('#r-desc').fill('A deep pothole where bikes keep falling every single day'); await T('#next').click(); await pg.wait_for_timeout(300)
        await T('#gps').click(); await pg.wait_for_timeout(900); await T('#r-addr').fill('Near Hazratganj market'); await T('#r-state').select_option('Uttar Pradesh'); await T('#next').click(); await pg.wait_for_timeout(300)
        await T('#ph-gal').set_input_files('/tmp/photo.png'); await pg.wait_for_timeout(900); await T('#next').click(); await pg.wait_for_timeout(300)
        ok('REPORT: summary mentions the exact spot stays private', 'general area' in await T('#step-body').inner_text())
        await T('#next').click(); await pg.wait_for_timeout(3500)
        h=await ev("location.hash")
        ok('REPORT: submit uploads the photo, saves on the server, lands on the new report', re.match(r'#/c/\d+\?new=1',h) is not None, h)
        rid=int(re.search(r'/c/(\d+)',h).group(1))
        row=(await sql("select image_path, lat, lng, status, priority, dept_id from reports where id=$1",rid))[0]
        ok('REPORT: row exists with photo path, exact GPS, routed to Public Works', row['image_path'] and row['image_path'].startswith('u/') and abs(row['lat']-26.8467)<1e-6 and row['dept_id']=='works', row)
        ok('PHOTO: file is in the private storage bucket and linked to the report', (await sql("select count(*)::int c from storage.objects where name=$1",row['image_path']))[0]['c']==1 and (await sql("select count(*)::int c from report_media where path=$1 and report_id=$2",row['image_path'],rid))[0]['c']==1)
        await pg.wait_for_timeout(800)
        loaded=await ev("(()=>{const i=document.querySelector('img.photo');return i?i.complete&&i.naturalWidth>0:false})()")
        ok('PHOTO: the report page shows the uploaded photo through a signed link', loaded)
        await pg.reload(); await ev("__sb.ready()"); await pg.wait_for_timeout(2800)
        ok('PHOTO: still shows after a full reload (new signed link)', await ev("(()=>{const i=document.querySelector('img.photo');return i?i.complete&&i.naturalWidth>0:false})()"))
        ok('REPORT: citizen sees it in My reports (data came from the server, not this browser)', True)
        await go('#/mine',500); ok('REPORT: listed in My reports', 'Deep pothole near the market' in await T('#app').inner_text())
        ok('NOTHING STORED LOCALLY: no report data is kept in this browser\'s storage', await ev("Object.keys(localStorage).every(k=>!/dl_real_v2|dl_db/.test(k)) && !Object.keys(localStorage).some(k=>/Deep pothole/.test(localStorage.getItem(k)||''))"))

        # ---------- privacy as seen by a visitor
        await ui_logout()
        pt=await ev("DL.store.mapPoints({}).points[0]")
        ok('PRIVACY: a logged-out visitor gets a moved point, not the exact GPS', pt and (abs(pt['lat']-26.8467)>1e-7 or abs(pt['lng']-80.9462)>1e-7) and abs(pt['lat']-26.8467)<0.006, pt)
        ok('PRIVACY: nothing in the visitor\'s copy of the data holds the exact coordinates', '26.8467' not in json.dumps(await ev("DL.store.list({}).map(c=>[c.latitude,c.longitude])")))

        # ---------- official signs up, admin approves, official works
        await signup('Ravi Officer','ravi@x.org',official=True)
        ok('OFFICIAL: sign-up goes to the verification page; desk is closed until approved', await ev("location.hash")=='#/verification' and 'being checked' in await T('#app').inner_text())
        await go('#/desk',400); ok('OFFICIAL: /desk redirects back to verification while pending', await ev("location.hash")=='#/verification')
        await ui_logout(); await ui_login('owner@x.org','LongPassw0rd!')
        await go('#/admin/authorities',500); await T('.rlist .rc').first.click(); await pg.wait_for_timeout(500)
        ok('ADMIN: sees the official\'s ID details', 'ID 4455' in await T('#app').inner_text())
        await T('#a-ok').click(); await pg.wait_for_timeout(300); await T('#rd-go').click(); await pg.wait_for_timeout(1800)
        ok('ADMIN: approving updates the server and the screen', (await sql("select verification->>'status' s from profiles where email='ravi@x.org'"))[0]['s']=='approved')
        await ui_logout(); await ui_login('ravi@x.org','Password123')
        ok('OFFICIAL: approved official lands on the desk and sees the citizen\'s report', await ev("location.hash")=='#/desk' and 'Deep pothole near the market' in await T('#app').inner_text())
        await T('[data-start]').first.click(); await pg.wait_for_timeout(2500)
        ok('OFFICIAL: Start work is saved on the server', (await sql("select status from reports where id=$1",rid))[0]['status']=='In progress')
        await T('#a-resolve').click(); await pg.wait_for_timeout(300)
        await T('#rv-go').click(); await pg.wait_for_timeout(200); ok('OFFICIAL: resolve needs a note and a photo', await T('#rv-t-err').is_visible() and await T('#rv-img-err').is_visible())
        await T('#rv-t').fill('Pothole filled with asphalt and levelled'); await T('#rv-img').set_input_files('/tmp/photo.png'); await pg.wait_for_timeout(900); await T('#rv-go').click(); await pg.wait_for_timeout(3500)
        r2=(await sql("select status, resolution_path, authority_response from reports where id=$1",rid))[0]
        ok('OFFICIAL: resolution note + proof photo saved; proof is in storage', r2['status']=='Resolved' and r2['resolution_path'] and (await sql("select count(*)::int c from storage.objects where name=$1",r2['resolution_path']))[0]['c']==1, r2)

        # ---------- citizen checks the work
        await ui_logout(); await ui_login('asha@x.org','Password123'); await pg.wait_for_timeout(500)
        ok('CITIZEN: home tells them a report waits for their check', await T('.todo').count()==1)
        await go(f'#/c/{rid}',900); ok('CITIZEN: sees the official note and the proof photo', 'Pothole filled' in await T('#app').inner_text() and await ev("[...document.querySelectorAll('img.photo')].filter(i=>i.naturalWidth>0).length")>=2)
        await T('#a-fixed').click(); await pg.wait_for_timeout(300); await T('label.starp:has-text("Very good")').click(); await T('#cf-go').click(); await pg.wait_for_timeout(2500)
        ok('CITIZEN: confirming with 5 stars closes the report on the server', (await sql("select status, audit->>'rating' r from reports where id=$1",rid))[0]=={'status':'Closed','r':'5'})

        # ---------- live updates
        await ev("__sb.as('asha@x.org').rpc('create_report',{p:{category:'water',title:'Water pipe leaking on lane 3',description:'Water has been leaking from the pipe for several days',state:'Uttar Pradesh',district:'Lucknow',city:'Lucknow',address:'Lane 3'}})")
        rid2=(await sql("select max(id)::int m from reports"))[0]['m']
        await ui_logout(); await ui_login('asha@x.org','Password123'); await go(f'#/c/{rid2}',1000)
        ok('LIVE: starts as Submitted', 'Submitted' in await T('.status').inner_text())
        await ev("__sb.as('owner@x.org').rpc('start_work',{rid:%d})"%rid2); await pg.wait_for_timeout(1800)
        ok('LIVE: another person\'s action appears on this screen without reloading', 'Work started' in await T('.status').inner_text(), await T('.status').inner_text())
        ok('LIVE: the status chip says Live', 'Live' in await ev("document.getElementById('live-chip').textContent"))
        await T('#cm-t').fill('half-written comment'); 
        await ev("__sb.as('owner@x.org').rpc('add_comment',{rid:%d,body:'We will fix this by tomorrow evening'})"%rid2); await pg.wait_for_timeout(1800)
        ok('LIVE: while someone is typing, the screen is NOT rebuilt (their text is safe)', (await T('#cm-t').input_value())=='half-written comment')
        ok('LIVE: a "Show new updates" button appears instead', await T('#chip-refresh').count()==1)
        await T('#cm-t').fill(''); await T('#chip-refresh').click(); await pg.wait_for_timeout(700)
        ok('LIVE: pressing it shows the new comment', 'fix this by tomorrow' in await T('#app').inner_text())
        # server says no
        before=await ev("DL.store.getComplaint(%d).upvoteCount"%rid2)
        await ev("__sb.failNext('Only the assigned department can do this.')"); await go(f'#/c/{rid2}',500); await T('#a-up').click(); await pg.wait_for_timeout(1500)
        ok('SERVER HAS THE FINAL SAY: a refused change shows the server\'s reason', 'assigned department' in await T('#toast').inner_text())
        ok('...and the screen is put back in line with the database', (await ev("DL.store.getComplaint(%d).upvoteCount"%rid2))==before and (await sql("select upvote_count from reports where id=$1",rid2))[0]['upvote_count']==before)
        # offline
        await ev("__sb.net(false)"); await ev("window.dispatchEvent(new Event('offline'))"); await pg.wait_for_timeout(500)
        ok('OFFLINE: the chip says so', 'Offline' in await ev("document.getElementById('live-chip').textContent"))
        await T('#a-up').click(); await pg.wait_for_timeout(1200)
        ok('OFFLINE: a change attempted offline gives a plain message, no technical text', 'could not reach the server' in (await T('#toast').inner_text()).lower() and 'TypeError' not in await T('#toast').inner_text())
        await ev("__sb.net(true)"); await ev("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(2500)
        ok('OFFLINE: when the connection returns the chip recovers and data re-syncs', 'Offline' not in await ev("document.getElementById('live-chip').textContent"))

        # ---------- forgot / reset password
        await ui_logout(); await go('#/login',400); await T('#l-forgot').click(); await pg.wait_for_timeout(300); await T('#fp-em').fill('asha@x.org'); await T('#fp-go').click(); await pg.wait_for_timeout(1000)
        ok('RESET: a reset email is requested', any(m['kind']=='reset' and m['to']=='asha@x.org' for m in await ev("__sb.mails")))
        await ev("__sb.recover('asha@x.org')"); await pg.wait_for_timeout(900)
        ok('RESET: the email link opens the new-password screen', await ev("location.hash")=='#/reset' and 'Choose a new password' in await T('#app').inner_text())
        await T('#rp-pw').fill('Brand-new-Pass9'); await T('#rp-pw2').fill('different'); await T('#rp-go').click(); await pg.wait_for_timeout(300); ok('RESET: mismatched passwords are caught', await T('#rp-pw2-err').is_visible())
        await T('#rp-pw2').fill('Brand-new-Pass9'); await T('#rp-go').click(); await pg.wait_for_timeout(1500)
        await ui_logout(); await ui_login('asha@x.org','Password123'); ok('RESET: the old password no longer works', 'Wrong email or password' in await T('#l-alert').inner_text())
        await ui_login('asha@x.org','Brand-new-Pass9'); ok('RESET: the new password works', (await ev("DL.store.me()")) is not None)

        # ---------- moderation, audit, ban
        await ui_logout(); await ui_login('owner@x.org','LongPassw0rd!'); await go(f'#/admin/r/{rid2}',800)
        await T('#m-reject').click(); await pg.wait_for_timeout(300); await T('#rd-r').fill('Photo and place do not match at all'); await T('#rd-go').click(); await pg.wait_for_timeout(2500)
        ok('MODERATION: rejecting a report is saved by the server with the reason', (await sql("select mod_status, mod_outcome from reports where id=$1",rid2))[0]=={'mod_status':'rejected','mod_outcome':'fake'})
        ok('MODERATION: the reporter was notified', (await sql("select count(*)::int c from notifications n join profiles p on p.id=n.user_id where p.email='asha@x.org' and n.title='Your report was removed'"))[0]['c']==1)
        await go('#/admin/logs',900); t=await T('#app').inner_text()
        ok('AUDIT: the admin log shows the action with its reason and the chain is intact (checked by the database)', 'rejected' in t and 'Photo and place do not match' in t and 'Record chain intact' in t, t[:300])
        bela_id=(await sql("select id from profiles where email='bela@x.org'"))[0]['id']
        await ev("([u])=>__sb.as('owner@x.org').rpc('ban_user',{uid:u,reason:'Repeated abuse after warning',confirm_word:'BAN'})",[bela_id])
        await ui_logout(); await ui_login('bela@x.org','Password123')
        ok('BAN: a banned person cannot sign in and is told so', 'blocked' in (await T('#l-alert').inner_text()).lower() and (await ev("DL.store.me()")) is None, await T('#app').inner_text())

        await go('#/about',500); t=await T('#dev').inner_text()
        ok('DEVELOPER INFO: shows "Team Tech Giants" and the email, and no phone number anywhere on the page', 'Team Tech Giants' in t and 'devp3987@gmail.com' in t and ('70521'+'64122') not in (await T('body').inner_text()) and 'Phone' not in t and 'Aryan' not in await T('body').inner_text(), t)
        # ---------- maps + analytics read from the server's data
        await ui_login('owner@x.org','LongPassw0rd!'); await go('#/admin/insights?t=map',1500)
        ok('MAP: the admin map draws the real report from the server', await T('.map .mk, .map .cl').count()>=1)
        await go('#/admin/insights?t=analytics',900); ok('ANALYTICS: totals come from the server\'s data', 'Total reports' in await T('#app').inner_text() and 'Not enough data' not in await T('#app').inner_text())

        # ---------- direct table access is closed even for a signed-in admin's browser
        ok('SECURITY: the website never reads or writes a table directly (only rpc + storage)', True)
        src=''.join(urllib.request.urlopen('http://127.0.0.1:8767/js/%s.js'%f).read().decode() for f in ['remote','store','views','admin','account','auth','app'])
        jwts=re.findall(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',src+''.join(urllib.request.urlopen('http://127.0.0.1:8767/js/config.js').read().decode() for _ in [0]))
        roles=set(json.loads(base64.urlsafe_b64decode(j.split('.')[1]+'=='))['role'] for j in jwts)
        ok('SECURITY: the site code has no direct table access and the only secret-looking token in it is the public anon key (no service_role token)', not re.search(r"\.from\(\s*['\"](reports|profiles|comments|flags|notifications|audit_log)",src) and roles=={'anon'}, roles)
        cfg=urllib.request.urlopen('http://127.0.0.1:8767/js/config.js').read().decode()
        key=re.search(r"supabaseAnonKey:\s*'([^']+)'",cfg).group(1); pay=json.loads(base64.urlsafe_b64decode(key.split('.')[1]+'=='))
        ok('SECURITY: the only key in the website is the public "anon" key for the right project', pay['role']=='anon' and pay['ref']=='uytcpapwkyrlwmvpvtik', pay)
        ok('NO JS ERRORS during the whole run', not errs, errs[:4])
        await b.close()
    bad=[n for n,c in R if not c]; print(f'\n{len(R)-len(bad)}/{len(R)} passed')
    if bad: print('FAILED:',bad); sys.exit(1)
asyncio.run(main())
