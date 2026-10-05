/* Disaster Lens – screens (Phase 2.5 UX rebuild). Each view returns { html, mount(root) }. */
(function () {
  var S = window.DL.store, U = window.DL.ui, esc = U.esc, icon = U.icon, btn = U.button;
  var DEV = { site: 'Disaster Lens', team: 'Tech Giants', email: 'devp3987@gmail.com', developer: 'Team Tech Giants', phone: '' };

  /* ---------- small helpers ---------- */
  function wrap(inner, cls) { return '<div class="wrap ' + (cls || '') + '">' + inner + '</div>'; }
  function sec(title, inner, cls) { return '<section class="sec ' + (cls || '') + '"><h2 class="sec-h">' + title + '</h2>' + inner + '</section>'; }
  function isOfficial(me) { return !!me && me.role !== 'citizen'; }
  function approved(me) { return !!me && (me.role === 'admin' || (me.role === 'official' && S.verifState(me) === 'approved')); }
  function friendly(ex, fallback) { if (!ex || !ex.message) { S.sysLog('error', 'ui', fallback); return fallback; } return ex.message; }
  function stateOpts(sel) { return '<option value="">Choose state</option>' + U.opts(S.STATES, sel, function (s) { return s; }, function (s) { return s; }); }
  function alertBox(kind, html) { return '<div class="alert alert-' + kind + '" role="' + (kind === 'danger' ? 'alert' : 'status') + '">' + icon(kind === 'good' ? 'check' : (kind === 'danger' ? 'alert' : 'info')) + '<div>' + html + '</div></div>'; }
  function mapLink(text, c) {
    if (c.latitude != null) return 'https://www.openstreetmap.org/?mlat=' + c.latitude + '&mlon=' + c.longitude + '#map=17/' + c.latitude + '/' + c.longitude;
    return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(text);
  }
  function fullPlace(c) {
    var seen = {};
    return [c.manualLocationAddress, c.city, c.district, c.state, c.pincode].filter(function (x) { if (!x) return false; var k = String(x).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).join(', ');
  }

  /* a link to the on-site map; the public only ever gets the moved point, never the exact coordinates */
  function locLine(c, me) {
    var loc = S.locationFor(c);
    if (!loc) return '';
    var isExact = loc.quality === 'exact', area = loc.quality === 'area';
    var note = area ? 'Shown at the city centre (approximate).' : (isExact ? 'Exact spot visible to you.' : 'The public map shows the general area only.');
    return '<br><a class="link" href="#/map?focus=' + c.id + '">See on the map</a> <span class="muted small">' + note + '</span>';
  }

  function needLogin(why) {
    sessionStorage.setItem('dl_return', location.hash);
    return { html: wrap('<div class="center-card">' + U.emptyState({ icon: 'user', title: 'Log in to continue', text: why,
      action: '<div class="stack-row">' + btn({ label: 'Log in', href: '#/login', kind: 'primary' }) + btn({ label: 'Create account', href: '#/signup' }) + '</div>' }) + '</div>', 'narrow') };
  }

  function accountNotice(me) {
    var acc = S.accountOf(me);
    if (acc.status !== 'suspended') return '';
    return '<div class="sec">' + alertBox('danger', '<strong>Your account is suspended until ' + U.dateOnly(acc.until) + '.</strong><p>You can still read your reports, but you cannot post, comment or flag. Reason: ' + esc(acc.reason) + '</p>') + '</div>';
  }

  /* ---------- home ---------- */
  function guestHome() {
    var recent = S.list({ sort: 'new' }).slice(0, 3);
    return { html: wrap(
      '<section class="hero"><h1 id="page-title" tabindex="-1">Report local problems. Track their resolution.</h1>' +
      '<p class="hero-p">Tell your local department about potholes, garbage, water leaks, broken wires and other civic problems. Follow every step until it is fixed.</p>' +
      '<div class="stack-row">' + btn({ label: 'Report a problem', icon: 'pin', href: '#/new', kind: 'primary', cls: 'btn-lg' }) + btn({ label: 'Log in', href: '#/login', cls: 'btn-lg' }) + '</div></section>' +
      sec('How it works',
        '<ol class="how"><li><strong>You report it</strong><span>Add a short description, the place and a photo.</span></li>' +
        '<li><strong>The right department gets it</strong><span>You can follow each step on the report.</span></li>' +
        '<li><strong>You see it fixed</strong><span>The department adds a note and a photo of the work.</span></li></ol>') +
      sec('Recent reports', recent.length ? U.reportList(recent) + '<p class="more">' + btn({ label: 'See all reports', href: '#/feed', kind: 'quiet' }) + '</p>'
        : U.emptyState({ icon: 'file', title: 'No reports yet', text: 'Reports submitted by citizens will appear here.' }))) };
  }

  function citizenHome(me) {
    var mine = S.list({ userId: me.id });
    var n = { active: 0, progress: 0, done: 0 };
    mine.forEach(function (c) { if (!S.isActive(c) && S.modOf(c) !== 'under_review') return; if (!S.isOpen(c)) n.done++; else if (c.status === 'In progress') n.progress++; else n.active++; });
    var recent = mine.slice(0, 3);
    var checks = S.pendingChecks(me.id);
    var checkBox = checks.length ? '<a class="todo" href="#/c/' + checks[0].id + '">' + icon('eye') + '<span><strong>' + (checks.length === 1 ? '1 report is waiting for your check' : checks.length + ' reports are waiting for your check') +
      '</strong><span>The department says it fixed the problem. Is it really fixed?</span></span>' + icon('right', 'rc-go') + '</a>' : '';
    return { html: wrap(
      '<div class="home"><div class="home-main">' +
        '<h1 id="page-title" tabindex="-1" class="home-h">Report local problems. Track their resolution.</h1>' + checkBox +
        '<a class="cta" href="#/new">' + '<span class="cta-ic">' + icon('pin') + '</span><span class="cta-t"><strong>Report a problem</strong>' +
          '<span>Report potholes, garbage, broken streetlights, water issues and other civic problems.</span></span>' + icon('right', 'cta-go') + '</a>' +
        sec('My reports', '<div class="trio"><a href="#/mine?f=active"><b>' + n.active + '</b><span>Active</span></a><a href="#/mine?f=progress"><b>' + n.progress + '</b><span>In progress</span></a>' +
          '<a href="#/mine?f=done"><b>' + n.done + '</b><span>Resolved</span></a></div>') +
        sec('Recent reports', recent.length ? U.reportList(recent, { mine: true }) + '<p class="more">' + btn({ label: 'See all my reports', href: '#/mine', kind: 'quiet' }) + '</p>'
          : U.emptyState({ icon: 'file', title: 'No reports yet', text: 'You have not reported anything yet. Your reports will show up here.', action: btn({ label: 'Report a problem', href: '#/new', kind: 'primary' }) })) +
        accountNotice(me) +
      '</div><aside class="home-side">' +
        sec('Your area', '<p class="muted">See what other people have reported, and add your voice with an upvote.</p>' + btn({ label: 'See community reports', href: '#/feed', icon: 'list', block: true }) + '<p class="stack-gap">' + btn({ label: 'See them on a map', href: '#/map', icon: 'pin', block: true }) + '</p>') +
      '</aside></div>', 'wide') };
  }

  function home(ctx) {
    if (!ctx.me) return guestHome();
    if (ctx.me.role === 'admin') { location.replace('#/admin'); return { html: '' }; }
    if (isOfficial(ctx.me)) { location.replace(approved(ctx.me) ? '#/desk' : '#/verification'); return { html: '' }; }
    return citizenHome(ctx.me);
  }

  /* ---------- community reports ---------- */
  function feed(ctx) {
    var q = ctx.query;
    var st = { q: q.q || '', status: q.status || 'all', category: q.cat || 'all', sort: q.sort || 'new' };
    return {
      html: wrap(U.pageHeader({ title: 'Community reports', sub: 'Problems reported by people in your area.', actions: window.DL.mapViews.viewToggle('list') }) +
        '<form class="filters" id="filters" role="search" onsubmit="return false">' +
          '<div class="search">' + icon('search') + '<label class="sr" for="f-q">Search reports</label><input type="search" id="f-q" placeholder="Search by title or place" value="' + esc(st.q) + '"></div>' +
          '<details class="more-f" id="more-f"><summary>Filters</summary><div class="f-grid">' +
            '<div class="field"><label for="f-status">Status</label><select id="f-status"><option value="all">Any status</option>' +
              U.opts(['Submitted', 'In progress', 'Resolved', 'Reopened'], st.status, function (s) { return s; }, function (s) { return s; }) + '</select></div>' +
            '<div class="field"><label for="f-cat">Problem type</label><select id="f-cat"><option value="all">Any type</option>' + U.opts(S.CATS, st.category, function (c) { return c.id; }, function (c) { return c.name; }) + '</select></div>' +
            '<div class="field"><label for="f-sort">Sort by</label><select id="f-sort"><option value="new">Newest</option><option value="urgent">Urgent first</option><option value="votes">Most upvoted</option></select></div>' +
          '</div></details></form>' +
        '<p class="result-n" id="count" aria-live="polite"></p><div id="list"></div>', 'wide'),
      mount: function (root) {
        root.querySelector('#f-sort').value = st.sort;
        if (window.innerWidth >= 900 || st.status !== 'all' || st.category !== 'all') root.querySelector('#more-f').open = true;
        function draw() {
          st.q = root.querySelector('#f-q').value; st.status = root.querySelector('#f-status').value;
          st.category = root.querySelector('#f-cat').value; st.sort = root.querySelector('#f-sort').value;
          var items = S.list(st);
          root.querySelector('#count').textContent = items.length + (items.length === 1 ? ' report' : ' reports');
          root.querySelector('#list').innerHTML = items.length ? U.reportList(items)
            : U.emptyState({ icon: 'search', title: 'No reports match', text: 'Try a different word, or clear the filters.',
              action: ctx.me && ctx.me.role === 'citizen' ? btn({ label: 'Report a problem', href: '#/new', kind: 'primary' }) : '' });
        }
        root.querySelector('#filters').addEventListener('input', draw);
        draw();
      }
    };
  }

  /* ---------- my reports ---------- */
  function mine(ctx) {
    if (!ctx.me) return needLogin('Log in to see the reports you have filed.');
    var f = ctx.query.f || 'all';
    var all = S.list({ userId: ctx.me.id });
    var part = {
      all: all,
      active: all.filter(function (c) { return (S.isActive(c) || S.modOf(c) === 'under_review') && S.isOpen(c) && c.status !== 'In progress'; }),
      progress: all.filter(function (c) { return S.isActive(c) && S.isOpen(c) && c.status === 'In progress'; }),
      done: all.filter(function (c) { return S.isActive(c) && !S.isOpen(c); })
    };
    var tabs = [['all', 'All'], ['active', 'Active'], ['progress', 'In progress'], ['done', 'Resolved']];
    var items = part[f] || part.all;
    var empty = {
      all: ['No reports yet', 'You have not reported anything yet.'],
      active: ['No active reports', 'Reports waiting for the department will show here.'],
      progress: ['Nothing in progress', 'Reports the department is working on will show here.'],
      done: ['No resolved reports', 'Fixed problems will show here.']
    }[f] || ['No reports', ''];
    return { html: wrap(U.pageHeader({ title: 'My reports', actions: btn({ label: 'Report a problem', href: '#/new', kind: 'primary', small: true }) }) +
      '<nav class="tabs" aria-label="Filter my reports">' + tabs.map(function (t) {
        return '<a href="#/mine?f=' + t[0] + '"' + (t[0] === f ? ' aria-current="true"' : '') + '>' + t[1] + ' <span class="tab-n">' + part[t[0]].length + '</span></a>';
      }).join('') + '</nav>' +
      (items.length ? U.reportList(items, { mine: true }) : U.emptyState({ icon: 'file', title: empty[0], text: empty[1], action: btn({ label: 'Report a problem', href: '#/new', kind: 'primary' }) }))) };
  }

  /* ---------- report a problem (4 steps) ---------- */
  var draft = null;
  var STEPS = ['What happened?', 'Where is it?', 'Add a photo', 'Check and submit'];

  function freshDraft(u) {
    return { step: 1, cat: '', title: '', desc: '', addr: '', state: u.state || '', district: u.district || '', city: u.city || '', pin: u.pincode || '', coords: null, image: '', anon: false, userId: u.id };
  }

  function newReport(ctx) {
    if (!ctx.me) return needLogin('You need an account so we can send you updates on your report.');
    if (isOfficial(ctx.me)) return { html: wrap(U.emptyState({ icon: 'desk', title: 'Reports are filed by citizens', text: 'Officials respond to reports from the desk.', action: btn({ label: 'Open desk', href: '#/desk', kind: 'primary' }) }), 'narrow') };
    if (!S.can('report.create')) {
      var acc = S.accountOf(ctx.me);
      return { html: wrap(U.pageHeader({ title: 'Report a problem', back: { href: '#/', label: 'Back' } }) + alertBox('danger', '<strong>You cannot send new reports right now.</strong><p>' +
        (acc.status === 'suspended' ? 'Your account is suspended until ' + U.dateOnly(acc.until) + '. Reason: ' + esc(acc.reason) : 'Your account cannot send reports.') + '</p>'), 'narrow') };
    }
    if (!draft || draft.userId !== ctx.me.id) draft = freshDraft(ctx.me);
    return {
      html: wrap(U.pageHeader({ title: 'Report a problem', back: { href: '#/', label: 'Cancel' } }) +
        '<div class="steps"><p class="steps-t" id="steps-t"></p><div class="bar" id="bar" role="progressbar" aria-label="Report progress" aria-valuemin="1" aria-valuemax="4"><span></span></div></div>' +
        '<form id="rf" novalidate><div id="step-body"></div><div class="stepbar" id="stepbar"></div></form>', 'narrow'),
      mount: function (root) {
        var body = root.querySelector('#step-body'), bar = root.querySelector('#stepbar');
        var q = function (s) { return body.querySelector(s); };

        function readStep() {
          if (draft.step === 1) {
            var r = body.querySelector('input[name=cat]:checked'); draft.cat = r ? r.value : draft.cat;
            draft.title = q('#r-title').value; draft.desc = q('#r-desc').value;
          } else if (draft.step === 2) {
            draft.addr = q('#r-addr').value; draft.state = q('#r-state').value; draft.district = q('#r-district').value;
            draft.city = q('#r-city').value; draft.pin = q('#r-pin').value;
          } else if (draft.step === 4) { draft.anon = q('#r-anon').checked; }
        }

        function validate() {
          U.clearErrors(body);
          var ok = true;
          function bad(id, msg) { U.showError(body, id, msg); ok = false; }
          if (draft.step === 1) {
            if (!draft.cat) { var ce = body.querySelector('#cat-err'); ce.textContent = 'Choose the kind of problem.'; ce.hidden = false; ok = false; }
            if (draft.title.trim().length < 5) bad('r-title', 'Write a short title of at least 5 letters.');
            if (draft.desc.trim().length < 15) bad('r-desc', 'Add a few more words. At least 15 letters, please.');
          }
          if (draft.step === 2) {
            if (!draft.addr.trim()) bad('r-addr', 'Tell us the landmark or street.');
            if (!draft.state) bad('r-state', 'Choose your state.');
            if (!draft.district.trim()) bad('r-district', 'Enter the district.');
            if (!draft.city.trim()) bad('r-city', 'Enter the city or town.');
            if (draft.pin && !/^\d{6}$/.test(draft.pin)) bad('r-pin', 'A pincode has 6 digits. Leave it empty if you are not sure.');
          }
          if (!ok) U.focusFirstError(body);
          return ok;
        }

        function urgentNote() {
          var el = q('#urgent-note'); if (!el) return;
          var p = S.detectPriority(q('#r-title').value, q('#r-desc').value, (body.querySelector('input[name=cat]:checked') || {}).value);
          el.innerHTML = p.priority === 'Urgent' ? alertBox('danger', '<strong>This sounds urgent.</strong><p>If anyone is in danger, call <strong>112</strong> first. We will mark your report Urgent for the department.</p>') : '';
        }

        function draw() {
          var d = draft, h = '';
          root.querySelector('#steps-t').textContent = 'Step ' + d.step + ' of 4';
          var b = root.querySelector('#bar'); b.setAttribute('aria-valuenow', d.step); b.setAttribute('aria-valuetext', 'Step ' + d.step + ' of 4: ' + STEPS[d.step - 1]); b.firstChild.style.width = (d.step * 25) + '%';

          if (d.step === 1) {
            h = '<h2 class="step-h" id="step-h" tabindex="-1">' + STEPS[0] + '</h2>' +
              '<fieldset class="tiles"><legend>What kind of problem is it?</legend><div class="tile-grid">' + S.CATS.map(function (c) {
                return '<label class="tile"><input type="radio" name="cat" value="' + c.id + '"' + (d.cat === c.id ? ' checked' : '') + '><span>' + icon('check', 'tile-ck') + '<b>' + esc(c.name) + '</b></span></label>';
              }).join('') + '</div><p class="err" id="cat-err" hidden></p></fieldset>' +
              U.field({ id: 'r-title', label: 'Title', required: true, value: d.title, hint: 'Say it in a few words. Example: Open drain near the school gate.', attrs: 'maxlength="90" autocomplete="off"' }) +
              U.field({ id: 'r-desc', label: 'Details', tag: 'textarea', required: true, value: d.desc, hint: 'What is wrong? How long has it been like this? Who could be hurt?', attrs: 'maxlength="800"' }) +
              '<div id="urgent-note"></div>';
          } else if (d.step === 2) {
            h = '<h2 class="step-h" id="step-h" tabindex="-1">' + STEPS[1] + '</h2>' +
              btn({ label: 'Use my current location', icon: 'pin', id: 'gps', block: true }) +
              '<p class="gps-out" id="gps-out" role="status">' + (d.coords ? 'Location saved from your phone. <a class="link" target="_blank" rel="noopener" href="' + mapLink('', { latitude: d.coords.lat, longitude: d.coords.lng }) + '">Check it on the map</a>' : '') + '</p>' +
              '<p class="or"><span>or type the place</span></p>' +
              U.field({ id: 'r-addr', label: 'Landmark or street', required: true, value: d.addr, hint: 'Example: Near the bus stop on Station Road.' }) +
              U.field({ id: 'r-state', label: 'State', tag: 'select', required: true, optionsHtml: stateOpts(d.state) }) +
              '<div class="two">' + U.field({ id: 'r-district', label: 'District', required: true, value: d.district }) + U.field({ id: 'r-city', label: 'City or town', required: true, value: d.city }) + '</div>' +
              U.field({ id: 'r-pin', label: 'Pincode', value: d.pin, attrs: 'inputmode="numeric" maxlength="6" autocomplete="postal-code"' });
          } else if (d.step === 3) {
            h = '<h2 class="step-h" id="step-h" tabindex="-1">' + STEPS[2] + '</h2>' +
              '<p class="step-p">A clear photo helps the department find the problem and understand it quickly.</p>' +
              '<div class="photo-actions"><input id="ph-cam" class="sr-in" type="file" accept="image/*" capture="environment"><label class="btn btn-secondary btn-block" for="ph-cam">' + icon('camera') + '<span>Take a photo</span></label>' +
              '<input id="ph-gal" class="sr-in" type="file" accept="image/*"><label class="btn btn-secondary btn-block" for="ph-gal">' + icon('image') + '<span>Choose from gallery</span></label></div>' +
              '<p class="err" id="ph-err" hidden></p><div id="ph-prev">' + (d.image ? photoPrev(d.image) : '') + '</div>';
          } else {
            var cat = S.cat(d.cat);
            h = '<h2 class="step-h" id="step-h" tabindex="-1">' + STEPS[3] + '</h2>' +
              '<dl class="sumry">' +
              sumRow(1, 'Problem', '<strong>' + esc(d.title) + '</strong><br>' + esc(cat.name)) +
              sumRow(1, 'Details', esc(d.desc.length > 160 ? d.desc.slice(0, 160) + '…' : d.desc)) +
              sumRow(2, 'Location', esc(fullPlace({ manualLocationAddress: d.addr, city: d.city, district: d.district, state: d.state, pincode: d.pin })) + (d.coords ? '<br><span class="muted">GPS location saved</span>' : '')) +
              sumRow(3, 'Photo', d.image ? '<img class="sum-img" src="' + d.image + '" alt="Your photo">' : '<span class="muted">No photo added</span>') +
              '</dl><label class="check"><input type="checkbox" id="r-anon"' + (d.anon ? ' checked' : '') + '><span><strong>Hide my name from other people</strong><br><span class="muted">Officials can still see your account.</span></span></label>' +
              '<p class="step-p">This report will go to the <strong>' + esc(cat.dept) + '</strong>.</p>' + (d.coords ? '<p class="step-p">' + icon('pin', 'i-sm') + 'Other people see only the general area on the map, never your exact spot. The department sees the exact spot.</p>' : '<p class="step-p">' + icon('info', 'i-sm') + 'You did not share a GPS point. The report will not appear on the map. Go back to step 2 and tap "Use my current location" to add it.</p>') + '<div id="submit-err"></div>';
          }
          body.innerHTML = h;

          var back = d.step > 1 ? btn({ label: 'Back', kind: 'quiet', id: 'back', icon: 'left' }) : '';
          var nextLabel = d.step === 4 ? 'Submit report' : (d.step === 3 && !d.image ? 'Continue without a photo' : 'Next');
          bar.innerHTML = back + btn({ label: nextLabel, kind: 'primary', type: 'submit', id: 'next', cls: 'grow' });

          if (d.step === 1) {
            ['#r-title', '#r-desc'].forEach(function (s) { q(s).addEventListener('input', urgentNote); });
            body.querySelectorAll('input[name=cat]').forEach(function (r) { r.addEventListener('change', urgentNote); });
            urgentNote();
          }
          if (d.step === 2) q('#gps').addEventListener('click', gps);
          if (d.step === 3) { q('#ph-cam').addEventListener('change', pick); q('#ph-gal').addEventListener('change', pick); }
          if (d.step === 4) body.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () { readStep(); draft.step = Number(b.getAttribute('data-go')); draw(); focusHead(); }); });
          var bk = bar.querySelector('#back');
          if (bk) bk.addEventListener('click', function () { readStep(); draft.step--; draw(); focusHead(); });
        }

        function focusHead() { var h = body.querySelector('#step-h'); window.scrollTo(0, 0); if (h) h.focus({ preventScroll: true }); }
        function sumRow(step, label, val) { return '<div class="sum-r"><dt>' + label + '</dt><dd>' + val + '</dd><button type="button" class="link-btn" data-go="' + step + '" aria-label="Change ' + label.toLowerCase() + '">Change</button></div>'; }
        function photoPrev(src) { return '<div class="prev"><img src="' + src + '" alt="Preview of your photo">' + btn({ label: 'Remove photo', kind: 'quiet', small: true, id: 'ph-rm' }) + '</div>'; }

        function gps() {
          var out = q('#gps-out');
          if (!navigator.geolocation) { out.textContent = 'This phone or browser cannot share its location. Please type the place instead.'; return; }
          out.textContent = 'Finding your location…';
          navigator.geolocation.getCurrentPosition(function (p) {
            draft.coords = { lat: p.coords.latitude, lng: p.coords.longitude };
            out.innerHTML = 'Location saved from your phone. <a class="link" target="_blank" rel="noopener" href="' + mapLink('', { latitude: draft.coords.lat, longitude: draft.coords.lng }) + '">Check it on the map</a>';
          }, function () { out.textContent = 'We could not get your location. Allow location access in your browser, or type the place below.'; },
          { enableHighAccuracy: true, timeout: 12000 });
        }

        function pick(e) {
          var file = e.target.files[0]; if (!file) return;
          var err = q('#ph-err'); err.hidden = true;
          q('#ph-prev').innerHTML = '<p class="muted" role="status">Preparing photo…</p>';
          U.compressImage(file, 1000, 0.72).then(function (data) {
            draft.image = data; q('#ph-prev').innerHTML = photoPrev(data);
            q('#ph-rm').addEventListener('click', function () { draft.image = ''; draw(); });
            bar.querySelector('#next span').textContent = 'Next';
          }).catch(function (ex) { q('#ph-prev').innerHTML = ''; err.textContent = friendly(ex, 'We could not use that photo. Try another one.'); err.hidden = false; });
        }

        root.querySelector('#rf').addEventListener('submit', function (e) {
          e.preventDefault();
          readStep();
          if (!validate()) return;
          if (draft.step < 4) { draft.step++; draw(); focusHead(); return; }
          var next = bar.querySelector('#next');
          if (next.disabled) return;
          U.setBusy(next, true, draft.image ? 'Uploading photo…' : 'Submitting…');
          U.attempt(function () {
            return S.createComplaint(ctx.me, { category: draft.cat, title: draft.title, description: draft.desc, address: draft.addr, state: draft.state, district: draft.district,
              city: draft.city, pincode: draft.pin, isAnonymous: draft.anon, image: draft.image, latitude: draft.coords ? draft.coords.lat : null, longitude: draft.coords ? draft.coords.lng : null });
          }).then(function (c) {
            draft = null;
            location.hash = '#/c/' + c.id + '?new=1';
          }).catch(function (ex) {
            U.setBusy(next, false);
            console.error(ex); S.sysLog('error', 'report', 'Report submit failed: ' + (ex && ex.message));
            q('#submit-err').innerHTML = alertBox('danger', '<strong>Your report was not sent.</strong><p>' + esc(friendly(ex, 'Something went wrong while submitting your report. Please try again.')) + '</p>');
          });
        });
        draw();
      }
    };
  }

  /* ---------- report page ---------- */
  function detail(ctx) {
    var c = S.getComplaint(ctx.params[0]);
    var me = ctx.me;
    if (!c) return { html: wrap(U.emptyState({ icon: 'search', title: 'Report not found', text: 'It may have been removed.', action: btn({ label: 'See all reports', href: '#/feed', kind: 'primary' }) }), 'narrow') };
    var owner = me && me.id === c.citizenId, official = isOfficial(me);
    if (!S.canView(c)) {
      return { html: wrap(U.emptyState({ icon: 'eye', title: 'This report is not available', text: 'It may be under review or no longer public.', action: btn({ label: 'See all reports', href: '#/feed', kind: 'primary' }) }), 'narrow') };
    }
    var canAct = official && S.canManage(me, c);
    var ms = S.modOf(c);
    var modNote = '';
    if (owner && ms === 'under_review') modNote = alertBox('info', '<strong>An admin is checking this report.</strong><p>It is hidden from the public list until they decide. Nothing is wrong with your account.</p>');
    if (owner && ms === 'rejected' && c.modOutcome === 'duplicate') modNote = alertBox('info', '<strong>This report matches an earlier one.</strong><p><a class="link" href="#/c/' + c.duplicateOf + '">Follow report DL-' + c.duplicateOf + '</a> for updates.</p>');
    else if (owner && ms === 'rejected') modNote = alertBox('danger', '<strong>An admin removed this report.</strong><p>' + esc(c.modReason) + '</p>');
    if (owner && ms === 'archived') modNote = alertBox('info', '<strong>An admin archived this report.</strong><p>' + esc(c.modReason) + '</p>');
    if (me && me.role === 'admin' && ms !== 'normal') modNote = alertBox('info', '<strong>Moderation: ' + esc(S.MOD_LABELS[ms]) + '.</strong><p>' + btn({ label: 'Open in moderation', href: '#/admin/r/' + c.id, small: true }) + '</p>');
    else if (me && me.role === 'admin') modNote = '<p class="flag-row">' + btn({ label: 'Open in moderation', href: '#/admin/r/' + c.id, small: true, kind: 'quiet' }) + '</p>';
    var key = U.statusKey(c), m = U.STATUS[key], cat = S.cat(c.category);
    var voice = official ? 'off' : 'cit';
    var voted = me && S.hasUpvoted(me.id, c.id), flagged = me && S.hasFlagged(me.id, c.id);
    var back = official ? (me.role === 'admin' ? { href: '#/admin/reports', label: 'Admin reports' } : { href: '#/desk', label: 'Desk' }) : (owner ? { href: '#/mine', label: 'My reports' } : { href: '#/feed', label: 'Reports' });

    var banner = modNote + (ctx.query['new'] ? alertBox('good', '<strong>Report submitted</strong><p>The ' + esc(c.assignedDepartment) + ' has been told. You can follow it here, or in My reports.</p>') : '');
    var status = '<section class="status tone-' + m.tone + '" aria-labelledby="st-h"><span class="status-ic">' + icon(m.icon) + '</span><div><h2 class="sr" id="st-h">Status: ' + m.label + '</h2><p class="status-lead">' + m[voice] + '</p>' +
      '<p class="next">' + (official ? esc(U.slaText(c)) + '.' : '<strong>What happens next:</strong> ' + esc(U.NEXT[key](c))) + '</p></div></section>';
    var photo = c.imageUrlProof ? '<img class="photo" ' + U.src(c.imageUrlProof) + ' alt="Photo of the problem: ' + esc(c.title) + '">' : '';
    var where = fullPlace(c);
    var facts = '<dl class="facts"><div><dt>Category</dt><dd>' + esc(cat.name) + '</dd></div>' +
      '<div><dt>Location</dt><dd>' + esc(where) + (c.latitude != null ? '<br><span class="muted small">GPS location saved</span>' : '') + locLine(c, me) + '</dd></div>' +
      '<div><dt>Reported</dt><dd>' + U.dateOnly(c.timestamp) + ' by ' + esc(S.authorName(c)) + '</dd></div>' +
      '<div><dt>Department</dt><dd>' + esc(c.assignedDepartment) + '</dd></div></dl>';

    var resolvedAt = 0; (c.timeline || []).forEach(function (t) { if (/^Marked resolved/.test(t.label)) resolvedAt = t.ts; });
    var response = (c.authorityResponse || c.resolutionProofUrl)
      ? '<section class="resp" aria-labelledby="resp-h"><h2 class="sec-h" id="resp-h">' + icon('check') + ' Official response</h2><p class="resp-by">' + esc(c.assignedDepartment) + (resolvedAt ? ' · ' + U.dateOnly(resolvedAt) : '') + '</p>' +
        '<p class="body">' + esc(c.authorityResponse) + '</p>' + (c.resolutionProofUrl ? '<img class="photo" ' + U.src(c.resolutionProofUrl) + ' alt="Photo of the finished work">' : '') + '</section>' : '';

    var progress = sec('Progress', U.timeline(c));

    var ai = S.auditInfo(c);
    var disp = (c.disputes && c.disputes[0]) || null;
    var disputeBox = disp && c.status === 'Reopened' && (owner || official)
      ? '<section class="dispute" aria-labelledby="dp-h"><h2 class="sec-h" id="dp-h">' + icon('alert') + ' ' + (official ? 'The citizen says it is not fixed' : 'You said it is not fixed') + '</h2><p class="resp-by">' + esc(disp.reason) + ' · ' + U.dateOnly(disp.ts) + '</p>' +
        '<p class="body">' + esc(disp.note) + '</p>' + (disp.photo ? '<img class="photo" ' + U.src(disp.photo) + ' alt="Photo from the citizen">' : '') + '</section>' : '';
    var earlier = (c.resolutions && c.resolutions.length && (owner || official || (me && me.role === 'admin')))
      ? '<details class="earlier"><summary>Earlier attempts (' + c.resolutions.length + ')</summary>' + c.resolutions.map(function (r) {
        return '<div class="earlier-i"><p class="resp-by">' + esc(S.deptName(r.deptId)) + ' · ' + U.dateOnly(r.ts) + '</p><p class="body">' + esc(r.response) + '</p>' + (r.proof ? '<img class="photo" ' + U.src(r.proof) + ' alt="Photo of the earlier work">' : '') +
          '<p class="muted small">The citizen said: ' + esc(r.disputedReason) + '. ' + esc(r.disputedNote) + '</p></div>'; }).join('') + '</details>' : '';
    var ratingBox = c.audit && c.audit.state === 'confirmed' && (owner || official || (me && me.role === 'admin'))
      ? '<section class="rated"><h2 class="sec-h">' + icon('check') + ' ' + (owner ? 'You confirmed the fix' : 'The citizen confirmed the fix') + '</h2><p>' + U.stars(c.audit.rating) + '</p>' + (c.audit.comment ? '<p class="body">' + esc(c.audit.comment) + '</p>' : '') + '</section>'
      : (c.audit && c.audit.state === 'auto_closed' ? '<p class="muted">Closed automatically because no reply came in time.</p>' : '');
    var checkPanel = owner && ai.pending && S.isActive(c)
      ? '<section class="checkpanel" aria-labelledby="ck-h"><h2 class="sec-h" id="ck-h">' + icon('eye') + ' Check the work</h2><p>The department says this problem is fixed. Look at the place and the photo above, then tell us.</p>' +
        '<div class="check-btns">' + btn({ label: 'Yes, it is fixed', icon: 'check', id: 'a-fixed', kind: 'primary', block: true, cls: 'btn-lg' }) + btn({ label: 'No, it is still a problem', icon: 'alert', id: 'a-notfixed', block: true }) + '</div>' +
        '<p class="muted small">You have ' + ai.daysLeft + (ai.daysLeft === 1 ? ' day' : ' days') + ' to reply. If nobody replies, the report closes by itself.</p></section>' : '';

    var comments = S.commentsFor(c.id);
    var cList = comments.length ? comments.map(function (x) {
      return '<li><div class="cm-h"><strong>' + esc(x.authorName) + '</strong>' + (x.authorRole !== 'citizen' ? '<span class="badge tone-info">' + (x.authorRole === 'admin' ? 'Admin' : 'Official') + '</span>' : '') + '<time>' + U.ago(x.ts) + '</time></div><p>' + esc(x.text) + '</p></li>';
    }).join('') : '<li class="muted">No comments yet.</li>';
    var community = sec('Comments', '<ul class="comments" id="cm">' + cList + '</ul>' + (me
      ? '<form id="cf" class="cform"><div class="field"><label for="cm-t">' + (official ? 'Post an update for the citizen' : 'Add a comment') + '</label><textarea id="cm-t" rows="2" maxlength="600"></textarea><p class="err" id="cm-t-err" hidden></p></div>' + btn({ label: 'Post', type: 'submit', kind: 'primary' }) + '</form>'
      : '<p><a class="link" href="#/login">Log in</a> to comment.</p>'));

    var engage = '<div class="engage">' + btn({ label: 'Upvote · ' + c.upvoteCount, icon: 'up', id: 'a-up', attrs: 'aria-pressed="' + !!voted + '"', cls: voted ? 'is-on' : '' }) + btn({ label: 'Copy link', icon: 'link', id: 'a-share' }) + '</div>' +
      (!owner && me && !official && S.isActive(c) ? '<p class="flag-row">' + btn({ label: flagged ? 'You flagged this report' : 'Flag this report', icon: 'flag', id: 'a-flag', kind: 'quiet', small: true, attrs: flagged ? 'disabled' : '' }) + '</p>' : '');

    var actions = '';
    if (canAct) {
      if (!S.isOpen(c)) actions = sec('Actions', '<p class="muted">This report is resolved. No more action is needed.</p>', 'actions');
      else {
        var started = c.status === 'In progress';
        actions = sec('Actions', '<p class="muted">' + (started ? 'When the work is finished, mark it resolved with a note and a photo.' : 'Start work so the citizen knows the department is on it.') + '</p>' +
          (started ? btn({ label: 'Mark resolved', icon: 'check', id: 'a-resolve', kind: 'primary', block: true, cls: 'btn-lg' }) : btn({ label: 'Start work', icon: 'wrench', id: 'a-start', kind: 'primary', block: true, cls: 'btn-lg' })) +
          '<div class="act2">' + btn({ label: 'Transfer', icon: 'transfer', id: 'a-transfer' }) + (c.isEscalated ? '' : btn({ label: 'Escalate', icon: 'alert', id: 'a-escalate' })) + '</div>', 'actions');
      }
    }

    var head = '<header class="ph ph-detail">' + '<a class="ph-back" href="' + back.href + '">' + icon('left') + '<span>' + back.label + '</span></a>' +
      '<h1 id="page-title" tabindex="-1">' + esc(c.title) + '</h1><div class="rc-badges">' + U.urgentBadge(c) + U.statusBadge(c, true) + U.lateBadge(c) + '</div></header>';

    var inner = official
      ? head + banner + sec('Problem', photo + '<p class="body">' + esc(c.description) + '</p>') + sec('Location', facts) + status + disputeBox + actions + progress + response + earlier + ratingBox + community
      : head + banner + status + checkPanel + disputeBox + photo + '<p class="body">' + esc(c.description) + '</p>' + facts + progress + response + earlier + ratingBox + engage + community;

    return {
      html: wrap(inner, 'narrow detail'),
      mount: function (root) {
        function need() { U.toast('Please log in first.', 'bad'); sessionStorage.setItem('dl_return', location.hash); location.hash = '#/login'; }
        function rerender() { window.DL.app.render(); }
        var up = root.querySelector('#a-up');
        if (up) up.addEventListener('click', function () {
          if (!me) return need();
          up.disabled = true;
          U.attempt(function () { return S.toggleUpvote(me, c.id); }).then(function (r) {
            up.disabled = false; up.querySelector('span').textContent = 'Upvote · ' + r.count; up.classList.toggle('is-on', r.voted); up.setAttribute('aria-pressed', r.voted);
          }).catch(function (ex) { up.disabled = false; U.toast(friendly(ex, 'We could not save your upvote. Please try again.'), 'bad'); });
        });
        var sh = root.querySelector('#a-share');
        if (sh) sh.addEventListener('click', function () {
          var url = location.href.replace('?new=1', '');
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { U.toast('Link copied', 'good'); }, function () { window.prompt('Copy this link', url); });
        });
        var fl = root.querySelector('#a-flag');
        if (fl) fl.addEventListener('click', function () { openFlag(c, me, function () { rerender(); }); });
        var cf = root.querySelector('#cf');
        if (cf) cf.addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(cf);
          var t = root.querySelector('#cm-t');
          if (!t.value.trim()) { U.showError(cf, 'cm-t', 'Write something first.'); t.focus(); return; }
          var pb = cf.querySelector('button[type=submit]'); U.setBusy(pb, true, 'Posting…');
          U.attempt(function () { return S.addComment(me, c.id, t.value); }).then(function () { rerender(); U.toast('Comment posted', 'good'); })
            .catch(function (ex) { U.setBusy(pb, false); U.showError(cf, 'cm-t', friendly(ex, 'We could not post your comment. Please try again.')); });
        });

        var fx = root.querySelector('#a-fixed'); if (fx) fx.addEventListener('click', function () { openConfirmFix(c, me, rerender); });
        var nf = root.querySelector('#a-notfixed'); if (nf) nf.addEventListener('click', function () { openDispute(c, me, rerender); });

        if (!canAct) return;
        function done(msg) { U.toast(msg, 'good'); rerender(); }
        var st = root.querySelector('#a-start');
        if (st) st.addEventListener('click', function () {
          U.setBusy(st, true, 'Starting…');
          U.attempt(function () { return S.startWork(me, c.id); }).then(function () { done('Work started. The citizen has been told.'); })
            .catch(function (ex) { U.setBusy(st, false); U.toast(friendly(ex, 'Could not start work. Please try again.'), 'bad'); });
        });
        var rs = root.querySelector('#a-resolve');
        if (rs) rs.addEventListener('click', function () { openResolve(c, me, done); });
        var tr = root.querySelector('#a-transfer');
        if (tr) tr.addEventListener('click', function () { openTransfer(c, me); });
        var es = root.querySelector('#a-escalate');
        if (es) es.addEventListener('click', function () { openEscalate(c, me, done); });
      }
    };
  }

  /* ---------- citizen checks the work ---------- */
  var STAR_WORDS = ['Very poor', 'Poor', 'Okay', 'Good', 'Very good'];
  function openConfirmFix(c, me, done) {
    U.dialog({
      title: 'Is the problem fixed?',
      body: '<form id="cf2" novalidate><p class="dlg-text">Thank you for checking. Your rating tells the department how well the work was done. Once you confirm, the report is closed.</p>' +
        '<fieldset class="radios stars-pick"><legend>How well was it fixed?</legend><div class="star-row">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<label class="starp"><input type="radio" name="rt" value="' + n + '"><span><b>' + n + '</b><small>' + STAR_WORDS[n - 1] + '</small></span></label>'; }).join('') + '</div><p class="err" id="rt-err" hidden></p></fieldset>' +
        U.field({ id: 'cf-c', label: 'Anything you want to add', tag: 'textarea', rows: 2, attrs: 'maxlength="300"' }) +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Confirm it is fixed', kind: 'primary', type: 'submit', id: 'cf-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#cf2').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var r = root.querySelector('input[name=rt]:checked');
          if (!r) { var er = root.querySelector('#rt-err'); er.textContent = 'Choose a rating from 1 to 5.'; er.hidden = false; return; }
          var go = root.querySelector('#cf-go'); U.setBusy(go, true, 'Saving…');
          U.attempt(function () { return S.confirmFix(me, c.id, { rating: r.value, comment: root.querySelector('#cf-c').value }); })
            .then(function () { close(); U.toast('Thank you. The report is closed.', 'good'); done(); })
            .catch(function (ex) { U.setBusy(go, false); var e2 = root.querySelector('#rt-err'); e2.textContent = friendly(ex, 'We could not save this. Please try again.'); e2.hidden = false; });
        });
      }
    });
  }

  function openDispute(c, me, done) {
    var photo = '';
    U.dialog({
      title: 'It is still a problem',
      body: '<form id="ds" novalidate><div class="notice">' + icon('info') + '<p>The report will be reopened and the department will be asked to work on it again. They will see what you write here.</p></div>' +
        '<fieldset class="radios"><legend>What is wrong?</legend>' + S.DISPUTE_REASONS.map(function (r, i) { return '<label class="radio"><input type="radio" name="dr" value="' + r.id + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(r.label) + '</span></label>'; }).join('') + '</fieldset>' +
        U.field({ id: 'ds-n', label: 'Tell the department what you see', tag: 'textarea', rows: 3, required: true, attrs: 'maxlength="300"' }) +
        '<div class="field"><span class="lbl">New photo</span><p class="hint" id="ds-h">A photo of the place today helps a lot.</p><input id="ds-img" class="sr-in" type="file" accept="image/*" capture="environment" aria-describedby="ds-h ds-img-err">' +
        '<label class="btn btn-secondary btn-block" for="ds-img">' + icon('camera') + '<span id="ds-img-t">Take or choose a photo</span></label><div id="ds-prev"></div><p class="err" id="ds-img-err" hidden></p></div>' +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Reopen this report', kind: 'danger', type: 'submit', id: 'ds-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#ds-img').addEventListener('change', function (e) {
          var f = e.target.files[0]; if (!f) return;
          root.querySelector('#ds-img-t').textContent = 'Preparing photo…';
          U.compressImage(f, 1000, 0.72).then(function (d) { photo = d; root.querySelector('#ds-img-t').textContent = 'Change photo'; root.querySelector('#ds-prev').innerHTML = '<img class="photo" src="' + d + '" alt="Preview of your photo">'; })
            .catch(function (ex) { root.querySelector('#ds-img-t').textContent = 'Take or choose a photo'; U.showError(root, 'ds-img', friendly(ex, 'We could not use that photo.')); });
        });
        root.querySelector('#ds').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var note = root.querySelector('#ds-n').value;
          if (note.trim().length < 5) { U.showError(root, 'ds-n', 'Tell the department what is still wrong, at least 5 letters.'); root.querySelector('#ds-n').focus(); return; }
          var go = root.querySelector('#ds-go'); U.setBusy(go, true, photo ? 'Uploading photo…' : 'Reopening…');
          U.attempt(function () { return S.disputeFix(me, c.id, { reasonId: root.querySelector('input[name=dr]:checked').value, note: note, photo: photo }); })
            .then(function () { close(); U.toast('The report was reopened. The department has been told.', 'good'); done(); })
            .catch(function (ex) { U.setBusy(go, false); U.showError(root, 'ds-n', friendly(ex, 'We could not reopen this report. Please try again.')); });
        });
      }
    });
  }

  /* ---------- flag dialog: a flag asks for a human check, it never decides anything ---------- */
  function openFlag(c, me, done) {
    U.dialog({
      title: 'Flag this report',
      body: '<form id="fg" novalidate><p class="dlg-text">A flag asks an admin to take a look. It does not remove the report, and nothing happens to the person who wrote it until an admin decides.</p>' +
        '<fieldset class="radios"><legend>Why are you flagging it?</legend>' + S.FLAG_REASONS.map(function (r) {
          return '<label class="radio"><input type="radio" name="fr" value="' + r.id + '"><span>' + esc(r.label) + '</span></label>';
        }).join('') + '<p class="err" id="fr-err" hidden></p></fieldset>' +
        U.field({ id: 'fg-n', label: 'Anything else the admin should know', attrs: 'maxlength="200"' }) +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Send flag', kind: 'primary', type: 'submit', id: 'fg-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#fg').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var r = root.querySelector('input[name=fr]:checked');
          if (!r) { var er = root.querySelector('#fr-err'); er.textContent = 'Choose a reason.'; er.hidden = false; return; }
          var go = root.querySelector('#fg-go'); U.setBusy(go, true, 'Sending…');
          U.attempt(function () { return S.flagComplaint(me, c.id, r.value, root.querySelector('#fg-n').value); })
            .then(function (res) { close(); U.toast(res.toReview ? 'Thanks. An admin will review this report.' : 'Thanks. Your flag was sent to the admins.', 'good'); done(); })
            .catch(function (ex) { U.setBusy(go, false); var e2 = root.querySelector('#fr-err'); e2.textContent = friendly(ex, 'We could not send your flag. Please try again.'); e2.hidden = false; });
        });
      }
    });
  }

  /* ---------- official dialogs ---------- */
  function openResolve(c, me, done) {
    var proof = '';
    U.dialog({
      title: 'Mark as resolved',
      body: '<form id="rv" novalidate><div class="notice">' + icon('eye') + '<p>Your resolution note and photo will be visible to the citizen.</p></div>' +
        U.field({ id: 'rv-t', label: 'Resolution note', tag: 'textarea', required: true, rows: 3, hint: 'What was done to fix this issue?', attrs: 'maxlength="800"' }) +
        '<div class="field"><span class="lbl" id="rv-l">Proof photo</span><p class="hint" id="rv-img-hint">Upload a photo of the completed work.</p>' +
        '<input id="rv-img" class="sr-in" type="file" accept="image/*" capture="environment" aria-describedby="rv-img-hint rv-img-err"><label class="btn btn-secondary btn-block" for="rv-img">' + icon('camera') + '<span id="rv-img-t">Take or choose a photo</span></label>' +
        '<div id="rv-prev"></div><p class="err" id="rv-img-err" hidden></p></div>' +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Submit resolution', kind: 'primary', type: 'submit', id: 'rv-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#rv-img').addEventListener('change', function (e) {
          var f = e.target.files[0]; if (!f) return;
          root.querySelector('#rv-img-t').textContent = 'Preparing photo…';
          U.compressImage(f, 1000, 0.72).then(function (d) {
            proof = d; root.querySelector('#rv-img-t').textContent = 'Change photo';
            root.querySelector('#rv-prev').innerHTML = '<img class="photo" src="' + d + '" alt="Preview of the finished work">';
            var er = root.querySelector('#rv-img-err'); er.hidden = true;
          }).catch(function (ex) { root.querySelector('#rv-img-t').textContent = 'Take or choose a photo'; U.showError(root, 'rv-img', friendly(ex, 'We could not use that photo.')); });
        });
        root.querySelector('#rv').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var note = root.querySelector('#rv-t').value, ok = true;
          if (note.trim().length < 10) { U.showError(root, 'rv-t', 'Describe the work in at least 10 letters.'); ok = false; }
          if (!proof) { U.showError(root, 'rv-img', 'Add a photo of the finished work.'); ok = false; }
          if (!ok) { U.focusFirstError(root); return; }
          var go = root.querySelector('#rv-go'); U.setBusy(go, true, 'Uploading photo…');
          U.attempt(function () { return S.resolve(me, c.id, { response: note, proof: proof }); })
            .then(function () { close(); done('Marked as resolved. The citizen can see your note and photo.'); })
            .catch(function (ex) { U.setBusy(go, false); U.showError(root, 'rv-t', friendly(ex, 'Could not mark this as resolved. Please try again.')); });
        });
      }
    });
  }

  function openTransfer(c, me) {
    var depts = S.activeDepts().filter(function (d) { return d.id !== c.deptId; });
    U.dialog({
      title: 'Transfer report',
      body: '<form id="tf" novalidate>' +
        U.field({ id: 'tf-d', label: 'Send to department', tag: 'select', required: true, optionsHtml: U.opts(depts, '', function (d) { return d.id; }, function (d) { return d.name; }) }) +
        U.field({ id: 'tf-r', label: 'Reason for transfer', required: true, hint: 'Example: This is a water pipe problem, not a road problem.', attrs: 'maxlength="200"' }) +
        '<p class="notice" id="tf-n" role="status">' + icon('info') + '<span></span></p>' +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Transfer report', kind: 'primary', type: 'submit', id: 'tf-go' }) + '</div></form>',
      onMount: function (root, close) {
        var sel = root.querySelector('#tf-d');
        function note() { root.querySelector('#tf-n span').textContent = 'This report will be moved to the ' + S.deptName(sel.value) + '. The citizen will be told.'; }
        sel.addEventListener('change', note); note();
        root.querySelector('#tf').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          if (root.querySelector('#tf-r').value.trim().length < 5) { U.showError(root, 'tf-r', 'Say why it is being transferred.'); U.focusFirstError(root); return; }
          var go = root.querySelector('#tf-go'); U.setBusy(go, true, 'Transferring…');
          var to = S.deptName(sel.value);
          U.attempt(function () { return S.transfer(me, c.id, sel.value, root.querySelector('#tf-r').value); }).then(function () {
            close();
            U.toast('Report transferred to the ' + to + '.', 'good');
            if (me.role === 'official') location.hash = '#/desk'; else window.DL.app.render();
          }).catch(function (ex) { U.setBusy(go, false); U.showError(root, 'tf-r', friendly(ex, 'Could not transfer this report. Please try again.')); });
        });
      }
    });
  }

  function openEscalate(c, me, done) {
    U.confirmDialog({
      title: 'Escalate this report?', text: 'Escalating will notify the district administration.', confirmLabel: 'Escalate', danger: true,
      extra: U.field({ id: 'es-r', label: 'Reason', required: true, hint: 'Example: Needs more funds and a bigger team.', attrs: 'maxlength="200"' }),
      onConfirm: function (root, close) {
        U.clearErrors(root);
        if (root.querySelector('#es-r').value.trim().length < 5) { U.showError(root, 'es-r', 'Say why this needs escalation.'); root.querySelector('#es-r').focus(); return; }
        var ok = root.querySelector('#dlg-ok'); U.setBusy(ok, true, 'Escalating…');
        U.attempt(function () { return S.escalate(me, c.id, root.querySelector('#es-r').value); }).then(function () { close(); done('Report escalated to the district administration.'); })
          .catch(function (ex) { U.setBusy(ok, false); U.showError(root, 'es-r', friendly(ex, 'Could not escalate this report. Please try again.')); });
      }
    });
  }

  /* ---------- official desk ---------- */
  function desk(ctx) {
    var me = ctx.me;
    if (!me) return needLogin('Officials and admins log in to open the desk.');
    if (!isOfficial(me)) return { html: wrap(U.emptyState({ icon: 'desk', title: 'The desk is for officials', text: 'Citizens can follow their reports from My reports.', action: btn({ label: 'Go to My reports', href: '#/mine', kind: 'primary' }) }), 'narrow') };
    if (me.role === 'admin') { location.replace('#/admin'); return { html: '' }; }
    if (!approved(me)) { location.replace('#/verification'); return { html: '' }; }
    var f = ctx.query.f || 'open';
    var st = S.deskStats(me);
    var tabs = [['open', st.open, 'Open'], ['urgent', st.urgent, 'Urgent'], ['late', st.late, 'Late'], ['resolved', st.resolved, 'Resolved']];
    var items = S.deskList(me, { filter: f });
    var rows = items.map(function (c) {
      var action = !S.isOpen(c) ? btn({ label: 'View', href: '#/c/' + c.id, kind: 'secondary' })
        : (c.status === 'In progress' ? btn({ label: 'Continue', href: '#/c/' + c.id, kind: 'secondary' }) : btn({ label: 'Start work', kind: 'primary', attrs: 'data-start="' + c.id + '"' }));
      return '<li class="drow"><div class="drow-main"><div class="rc-badges">' + U.urgentBadge(c) + U.lateBadge(c) + U.statusBadge(c) + '</div>' +
        '<a class="drow-title" href="#/c/' + c.id + '">' + esc(c.title) + '</a>' +
        '<p class="rc-meta">' + icon('pin', 'i-sm') + esc(U.placeOf(c)) + ' · Reported ' + U.ago(c.timestamp) + '</p>' +
        (c.status === 'Reopened' && c.disputes && c.disputes[0] ? '<p class="reopen-note">Citizen says: ' + esc(c.disputes[0].reason) + '</p>' : '') + '</div>' +
        '<div class="drow-act">' + action + '</div></li>';
    }).join('');
    var emptyText = { open: ['No reports need your attention', "You're all caught up."], urgent: ['No urgent reports', 'Nothing urgent right now.'], late: ['Nothing is late', 'All open reports are within their response time.'], resolved: ['No resolved reports yet', 'Reports you resolve will show here.'] }[f] || ['Nothing here', ''];
    return {
      html: wrap(U.pageHeader({ title: 'Department Desk', actions: btn({ label: 'See on map', href: '#/map', icon: 'pin', small: true }), sub: me.department + (st.rating && st.rating.count ? ' · Citizen rating ' + st.rating.avg + ' of 5 (' + st.rating.count + (st.rating.count === 1 ? ' rating)' : ' ratings)') : '') }) +
        '<nav class="sumbar" aria-label="Filter reports">' + tabs.map(function (t) {
          return '<a href="#/desk?f=' + t[0] + '"' + (t[0] === f ? ' aria-current="true"' : '') + (t[0] !== 'open' && t[0] !== 'resolved' && t[1] ? ' class="hot"' : '') + '><b>' + t[1] + '</b> <span>' + t[2] + '</span></a>';
        }).join('') + '</nav>' +
        (items.length ? '<ul class="dlist" id="dlist">' + rows + '</ul>' : U.emptyState({ icon: 'desk', title: emptyText[0], text: emptyText[1] })), 'wide'),
      mount: function (root) {
        var list = root.querySelector('#dlist'); if (!list) return;
        list.addEventListener('click', function (e) {
          var b = e.target.closest('[data-start]'); if (!b || b.disabled) return;
          U.setBusy(b, true, 'Starting…');
          var id = b.getAttribute('data-start');
          U.attempt(function () { return S.startWork(me, id); }).then(function () { U.toast('Work started. The citizen has been told.', 'good'); location.hash = '#/c/' + id; })
            .catch(function (ex) { U.setBusy(b, false); U.toast(friendly(ex, 'Could not start work. Please try again.'), 'bad'); });
        });
      }
    };
  }

  /* ---------- alerts ---------- */
  function alerts(ctx) {
    var me = ctx.me;
    if (!me) return needLogin('Log in to see updates on your reports.');
    var list = S.notificationsFor(me.id);
    var today = list.filter(function (n) { return U.sameDay(n.ts, Date.now()); });
    var earlier = list.filter(function (n) { return !U.sameDay(n.ts, Date.now()); });
    var unread = S.unreadCount(me.id);
    function group(title, arr) { return arr.length ? sec(title, '<ul class="nlist">' + arr.map(U.notificationItem).join('') + '</ul>') : ''; }
    return {
      html: wrap(U.pageHeader({ title: 'Alerts', actions: unread ? btn({ label: 'Mark all as read', id: 'read-all', kind: 'quiet', small: true }) : '' }) +
        (list.length ? group('Today', today) + group('Earlier', earlier)
          : U.emptyState({ icon: 'bell', title: 'No alerts yet', text: isOfficial(me) ? 'You will see new reports for your department here.' : 'You will see an alert here when your report changes.' })), 'narrow'),
      mount: function (root) {
        var b = root.querySelector('#read-all');
        if (b) b.addEventListener('click', function () { S.markAllRead(me.id); window.DL.app.render(); });
        root.addEventListener('click', function (e) { var a = e.target.closest('[data-note]'); if (a) S.markRead(me.id, a.getAttribute('data-note')); });
      }
    };
  }

  /* ---------- profile and about ---------- */
  function profile(ctx) {
    var me = ctx.me;
    if (!me) return needLogin('Log in to see your profile.');
    var role = me.role === 'admin' ? 'Admin' : (me.role === 'official' ? (me.authorityRole || 'Official') + ', ' + me.department : 'Citizen');
    return {
      html: wrap(U.pageHeader({ title: 'Profile' }) +
        '<dl class="facts"><div><dt>Name</dt><dd>' + esc(me.name) + '</dd></div><div><dt>Email</dt><dd>' + esc(me.email) + '</dd></div>' +
        (me.phone ? '<div><dt>Mobile</dt><dd>' + esc(me.phone) + '</dd></div>' : '') +
        '<div><dt>Account</dt><dd>' + esc(role) + '</dd></div>' + (me.role === 'citizen' ? '<div><dt>Standing</dt><dd>' + esc(S.accountOf(me).status === 'suspended' ? 'Suspended until ' + U.dateOnly(S.accountOf(me).until) : 'Active') + '</dd></div>' : '') + '<div><dt>Location</dt><dd>' + esc([me.city, me.district, me.state].filter(Boolean).join(', ')) + '</dd></div></dl>' +
        '<div class="stack-col">' + (S.isCloud() ? btn({ label: 'Edit my details', id: 'p-edit', icon: 'user', block: true }) + btn({ label: 'Change password', id: 'p-pw', icon: 'shield', block: true }) : '') +
        btn({ label: 'About Disaster Lens', href: '#/about', icon: 'info', block: true }) + btn({ label: 'Log out', id: 'p-logout', icon: 'logout', block: true }) + '</div>', 'narrow'),
      mount: function (root) {
        root.querySelector('#p-logout').addEventListener('click', function () { window.DL.app.logout(); });
        var e1 = root.querySelector('#p-edit'); if (e1) e1.addEventListener('click', function () { window.DL.accountViews.openEditProfile(me); });
        var e2 = root.querySelector('#p-pw'); if (e2) e2.addEventListener('click', function () { window.DL.accountViews.openChangePassword(); });
      }
    };
  }

  function about(ctx) {
    return {
      html: wrap(U.pageHeader({ title: 'About Disaster Lens', back: { href: ctx.me ? '#/profile' : '#/', label: 'Back' } }) +
        '<p class="body">Disaster Lens is a public record of civic problems. Citizens report a problem with a place and a photo, the right department is assigned, and the report stays visible until the work is done.</p>' +
        sec('How urgent reports are chosen', '<p class="body">There is no artificial intelligence on this site. A report is marked Urgent when its words include an emergency, such as fire, live wire, collapse or flooding, or when it is a fire or flood report. Everything else is Routine.</p>') +
        sec('Flagged reports', '<p class="body">Anyone who is logged in can flag a report they think is wrong. A flag only asks an admin to look. Nothing is removed and nobody is punished until an admin has reviewed it and written down a reason.</p>') +
        sec('Developer', '<dl class="facts" id="dev"><div><dt>Website</dt><dd>' + esc(DEV.site) + '</dd></div><div><dt>Team</dt><dd>' + esc(DEV.team) + '</dd></div><div><dt>Developer</dt><dd>' + esc(DEV.developer) + '</dd></div>' +
          '<div><dt>Phone</dt><dd><a class="link" href="tel:+91' + DEV.phone + '">' + DEV.phone + '</a></dd></div><div><dt>Email</dt><dd><a class="link" href="mailto:' + DEV.email + '">' + DEV.email + '</a></dd></div></dl>') +
        sec('Developer tools', '<p class="muted">Demo mode shows sample data in a separate space. It never mixes with real reports.</p>' + btn({ label: 'Open demo mode', href: '#/demo', kind: 'secondary' })), 'narrow'),
      mount: function () {}
    };
  }

  /* ---------- log in and sign up ---------- */
  function loginView() {
    return {
      html: wrap(U.pageHeader({ title: 'Log in' }) +
        '<form id="lf" class="form" novalidate>' + U.field({ id: 'l-em', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email"' }) +
        U.field({ id: 'l-pw', label: 'Password', type: 'password', required: true, attrs: 'autocomplete="current-password"' }) +
        '<div class="pw-row"><label class="check-inline"><input type="checkbox" id="l-show"><span>Show password</span></label>' + (S.isCloud() ? '<a class="link" href="#/forgot">Forgot password?</a>' : '') + '</div>' +
        '<div id="l-alert"></div>' + btn({ label: 'Log in', type: 'submit', kind: 'primary', block: true, id: 'l-go', cls: 'btn-lg' }) + '</form>' +
        '<p class="alt">New here? <a class="link" href="#/signup">Create an account</a></p>' +
        (S.hasAdmin() || S.isDemo() ? '' : alertBox('info', '<strong>No administrator yet.</strong><p>' + btn({ label: 'Set up the administrator', href: '#/setup', small: true }) + '</p>')), 'narrow'),
      mount: function (root) {
        root.querySelector('#l-show').addEventListener('change', function (ev) { root.querySelector('#l-pw').type = ev.target.checked ? 'text' : 'password'; });
        root.querySelector('#lf').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root); root.querySelector('#l-alert').innerHTML = '';
          var em = root.querySelector('#l-em').value, pw = root.querySelector('#l-pw').value, ok = true;
          if (!/^\S+@\S+\.\S+$/.test(em)) { U.showError(root, 'l-em', 'Enter your email address.'); ok = false; }
          if (!pw) { U.showError(root, 'l-pw', 'Enter your password.'); ok = false; }
          if (!ok) { U.focusFirstError(root); return; }
          var go = root.querySelector('#l-go'); U.setBusy(go, true, 'Logging in…');
          S.login(em, pw).then(function (u) {
            U.toast('Welcome back, ' + u.name.split(' ')[0], 'good');
            var back = sessionStorage.getItem('dl_return'); sessionStorage.removeItem('dl_return');
            location.hash = back && back.indexOf('login') < 0 && back.indexOf('signup') < 0 ? back : (u.role === 'citizen' ? '#/' : (u.role === 'admin' ? '#/admin' : (S.verifState(u) === 'approved' ? '#/desk' : '#/verification')));
          }).catch(function (ex) {
            U.setBusy(go, false);
            root.querySelector('#l-alert').innerHTML = alertBox('danger', '<strong>Could not log in</strong><p>' + esc(friendly(ex, 'Something went wrong. Please try again.')) + '</p>');
          });
        });
      }
    };
  }

  function signupView() {
    return {
      html: wrap(U.pageHeader({ title: 'Create account' }) +
        '<form id="sf" class="form" novalidate><fieldset class="seg"><legend class="sr">Account type</legend>' +
        '<label><input type="radio" name="role" value="citizen" checked><span>I am a citizen</span></label><label><input type="radio" name="role" value="official"><span>I am an official</span></label></fieldset>' +
        U.field({ id: 's-name', label: 'Full name', required: true, attrs: 'autocomplete="name"' }) +
        U.field({ id: 's-em', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email"' }) +
        U.field({ id: 's-ph', label: 'Mobile number', attrs: 'inputmode="numeric" maxlength="10" autocomplete="tel-national"' }) +
        U.field({ id: 's-pw', label: 'Password', type: 'password', required: true, hint: 'At least 8 characters. A mix of letters and numbers is best.', attrs: 'autocomplete="new-password"' }) +
        '<label class="check-inline"><input type="checkbox" id="s-show"><span>Show password</span></label>' +
        U.field({ id: 's-state', label: 'State', tag: 'select', required: true, optionsHtml: stateOpts('') }) +
        '<div class="two">' + U.field({ id: 's-dist', label: 'District', required: true }) + U.field({ id: 's-city', label: 'City or town', required: true }) + '</div>' +
        U.field({ id: 's-pin', label: 'Pincode', attrs: 'inputmode="numeric" maxlength="6"' }) +
        '<div id="auth-only" hidden>' + U.field({ id: 's-arole', label: 'Your role', hint: 'Example: Ward Officer', required: true }) +
          U.field({ id: 's-dept', label: 'Department', tag: 'select', required: true, optionsHtml: U.opts(S.activeDepts(), '', function (d) { return d.id; }, function (d) { return d.name; }) }) +
          U.field({ id: 's-idp', label: 'Official ID details', tag: 'textarea', rows: 2, required: true, hint: 'ID number and issuing office. An admin checks this before you can log in.' }) + '</div>' +
        '<div id="s-alert"></div>' + btn({ label: 'Create account', type: 'submit', kind: 'primary', block: true, id: 's-go', cls: 'btn-lg' }) + '</form>' +
        '<p class="alt">Already registered? <a class="link" href="#/login">Log in</a></p>', 'narrow'),
      mount: function (root) {
        var f = function (s) { return root.querySelector(s); };
        var roleVal = function () { return root.querySelector('input[name=role]:checked').value; };
        f('#s-show').addEventListener('change', function (ev) { f('#s-pw').type = ev.target.checked ? 'text' : 'password'; });
        root.querySelectorAll('input[name=role]').forEach(function (r) { r.addEventListener('change', function () { f('#auth-only').hidden = roleVal() !== 'official'; }); });
        f('#sf').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root); f('#s-alert').innerHTML = '';
          var role = roleVal(), ok = true;
          function bad(id, msg) { U.showError(root, id, msg); ok = false; }
          var d = { role: role, name: f('#s-name').value, email: f('#s-em').value, phone: f('#s-ph').value, password: f('#s-pw').value, state: f('#s-state').value,
            district: f('#s-dist').value, city: f('#s-city').value, pincode: f('#s-pin').value, authorityRole: f('#s-arole').value, deptId: f('#s-dept').value, idProof: f('#s-idp').value };
          if (!d.name.trim()) bad('s-name', 'Enter your name.');
          if (!/^\S+@\S+\.\S+$/.test(d.email)) bad('s-em', 'Enter a valid email address.');
          if (d.phone && !/^\d{10}$/.test(d.phone)) bad('s-ph', 'A mobile number has 10 digits. Leave it empty if you prefer.');
          if (d.password.length < 8) bad('s-pw', 'Use at least 8 characters.');
          if (!d.state) bad('s-state', 'Choose your state.');
          if (!d.district.trim()) bad('s-dist', 'Enter your district.');
          if (!d.city.trim()) bad('s-city', 'Enter your city or town.');
          if (d.pincode && !/^\d{6}$/.test(d.pincode)) bad('s-pin', 'A pincode has 6 digits.');
          if (role === 'official') { if (!d.authorityRole.trim()) bad('s-arole', 'Enter your role.'); if (!d.idProof.trim()) bad('s-idp', 'Enter your official ID details.'); }
          if (!ok) { U.focusFirstError(root); return; }
          var go = f('#s-go'); U.setBusy(go, true, 'Creating account…');
          S.register(d).then(function (u) {
            if (u && u.needsConfirm) {
              root.innerHTML = '<div class="panel center">' + U.emptyState({ icon: 'inbox', title: 'Check your email', text: 'We sent a link to ' + u.email + '. Open it to confirm your account, then log in.',
                action: '<div class="stack-col">' + btn({ label: 'Resend the email', id: 'rs-mail', block: true }) + btn({ label: 'Go to log in', href: '#/login', kind: 'primary', block: true }) + '</div><p class="muted small" id="rs-out" role="status"></p>' }) + '</div>';
              root.querySelector('#rs-mail').addEventListener('click', function (ev) {
                var b = ev.currentTarget; U.setBusy(b, true, 'Sending…');
                U.attempt(function () { return S.resendConfirmation(u.email); }).then(function () { U.setBusy(b, false); root.querySelector('#rs-out').textContent = 'Sent again. It can take a minute to arrive. Check your spam folder too.'; })
                  .catch(function (ex) { U.setBusy(b, false); root.querySelector('#rs-out').textContent = friendly(ex, 'We could not send it. Please try again.'); });
              });
              return;
            }
            if (u.role === 'official') { U.toast('Application sent. An admin will check your ID.', 'good'); location.hash = '#/verification'; }
            else { U.toast('Account created', 'good'); location.hash = '#/'; }
          }).catch(function (ex) {
            U.setBusy(go, false);
            f('#s-alert').innerHTML = alertBox('danger', '<strong>Account not created</strong><p>' + esc(friendly(ex, 'Something went wrong. Please try again.')) + '</p>');
          });
        });
      }
    };
  }

  window.DL.vhelp = { wrap: wrap, sec: sec, alertBox: alertBox, friendly: friendly, needLogin: needLogin, isOfficial: isOfficial, approved: approved };
  window.DL.views = { DEV: DEV, home: home, feed: feed, newReport: newReport, detail: detail, mine: mine, alerts: alerts, profile: profile,
    login: loginView, signup: signupView, about: about, desk: desk };
})();
