/* Disaster Lens – first-run setup, demo mode and official verification screens (Phase 4) */
(function () {
  var S = window.DL.store, U = window.DL.ui, V = window.DL.vhelp, esc = U.esc, btn = U.button, icon = U.icon;
  var wrap = V.wrap, sec = V.sec, alertBox = V.alertBox, friendly = V.friendly;

  /* ---------- first administrator ---------- */
  function setup(ctx) {
    if (S.isCloud()) {
      var sql = "select public.make_admin('your.email@example.org');";
      if (S.hasAdmin()) return { html: wrap(U.emptyState({ icon: 'check', title: 'Setup is finished', text: 'An administrator already exists. Log in to manage the site.', action: btn({ label: 'Log in', href: '#/login', kind: 'primary' }) }), 'narrow') };
      return { html: wrap(U.pageHeader({ title: 'Create the first administrator', sub: 'This is done once, from the database, so nobody else can claim it.' }) +
        '<ol class="how"><li><strong>Sign up in the app</strong><span>Use the email you want to be the administrator.</span></li>' +
        '<li><strong>Open Supabase and run one line</strong><span>Project, then SQL editor, then paste this and press Run (use your own email):</span></li>' +
        '<li><strong>Log out and log in again</strong><span>You will land on the admin dashboard.</span></li></ol>' +
        '<pre class="code" id="sqlbox">' + esc(sql) + '</pre><div class="stack-row">' + btn({ label: 'Copy the line', id: 'cp', small: true }) + btn({ label: 'I have done it, check again', id: 'chk', kind: 'primary', small: true }) + '</div><p class="muted small" id="st-out" role="status"></p>', 'narrow'),
        mount: function (root) {
          root.querySelector('#cp').addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(sql) : Promise.reject()).then(function () { U.toast('Copied', 'good'); }, function () { window.prompt('Copy this line', sql); }); });
          root.querySelector('#chk').addEventListener('click', function (e) { var b = e.currentTarget; U.setBusy(b, true, 'Checking…'); window.DL.cloud.refresh().then(function () { U.setBusy(b, false); if (S.hasAdmin()) window.DL.app.render(); else root.querySelector('#st-out').textContent = 'No administrator found yet. Run the line, then check again.'; }); });
        } };
    }
    if (S.isDemo()) return { html: wrap(U.emptyState({ icon: 'shield', title: 'Demo mode has its own admin', text: 'Leave demo mode to set up the real administrator.', action: btn({ label: 'Open demo mode', href: '#/demo', kind: 'primary' }) }), 'narrow') };
    if (S.hasAdmin()) return { html: wrap(U.emptyState({ icon: 'check', title: 'Setup is finished', text: 'An administrator already exists. Log in to manage the site.', action: btn({ label: 'Log in', href: '#/login', kind: 'primary' }) }), 'narrow') };
    return {
      html: wrap(U.pageHeader({ title: 'Set up the administrator', sub: 'This creates the first admin account. There are no default passwords.' }) +
        '<form id="su" class="form" novalidate>' +
        U.field({ id: 'su-name', label: 'Full name', required: true, attrs: 'autocomplete="name"' }) +
        U.field({ id: 'su-em', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email"' }) +
        U.field({ id: 'su-pw', label: 'Password', type: 'password', required: true, hint: 'At least 10 characters. Keep it private.', attrs: 'autocomplete="new-password"' }) +
        U.field({ id: 'su-pw2', label: 'Repeat the password', type: 'password', required: true, attrs: 'autocomplete="new-password"' }) +
        '<div id="su-alert"></div>' + btn({ label: 'Create administrator', type: 'submit', kind: 'primary', block: true, id: 'su-go', cls: 'btn-lg' }) + '</form>', 'narrow'),
      mount: function (root) {
        root.querySelector('#su').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root); root.querySelector('#su-alert').innerHTML = '';
          var v = function (id) { return root.querySelector(id).value; }, ok = true;
          if (!v('#su-name').trim()) { U.showError(root, 'su-name', 'Enter the name.'); ok = false; }
          if (!/^\S+@\S+\.\S+$/.test(v('#su-em'))) { U.showError(root, 'su-em', 'Enter a valid email address.'); ok = false; }
          if (v('#su-pw').length < 10) { U.showError(root, 'su-pw', 'Use at least 10 characters.'); ok = false; }
          else if (v('#su-pw') !== v('#su-pw2')) { U.showError(root, 'su-pw2', 'The two passwords are not the same.'); ok = false; }
          if (!ok) { U.focusFirstError(root); return; }
          var go = root.querySelector('#su-go'); U.setBusy(go, true, 'Creating…');
          S.setupAdmin({ name: v('#su-name'), email: v('#su-em'), password: v('#su-pw') }).then(function () { U.toast('Administrator created', 'good'); location.hash = '#/admin'; })
            .catch(function (ex) { U.setBusy(go, false); root.querySelector('#su-alert').innerHTML = alertBox('danger', '<strong>Not created</strong><p>' + esc(friendly(ex, 'Something went wrong. Please try again.')) + '</p>'); });
        });
      }
    };
  }

  /* ---------- demo mode (sample data, kept apart from real data) ---------- */
  function demo() {
    var inDemo = S.isDemo();
    var accts = [['Demo Admin', 'admin@demo.local', 'Moderation, authorities, logs'], ['Demo Official', 'official@demo.local', 'Public Works Department desk'],
      ['Demo Pending Official', 'pending@demo.local', 'Waiting for verification'], ['Demo Citizen', 'citizen@demo.local', 'Owns the sample reports'],
      ['Demo Neighbour A', 'neighbour.a@demo.local', 'Can flag reports'], ['Demo Neighbour B', 'neighbour.b@demo.local', 'Can flag reports']];
    return {
      html: wrap(U.pageHeader({ title: 'Demo mode', back: { href: inDemo ? '#/' : '#/about', label: 'Back' } }) +
        '<p class="body">Demo mode fills a separate space with a few clearly labelled sample records so you can try every screen. It never mixes with real reports, real users, real counts or real alerts.</p>' +
        (inDemo
          ? alertBox('info', '<strong>You are in demo mode.</strong><p>Everything you see is sample data.</p>') +
            sec('Demo accounts', '<p class="muted">Password for all: <strong>' + esc(window.DL.demoPassword) + '</strong></p><ul class="rlist">' + accts.map(function (a) {
              return '<li class="plainrow"><strong>' + esc(a[0]) + '</strong><span>' + esc(a[1]) + '</span><span class="muted">' + esc(a[2]) + '</span></li>'; }).join('') + '</ul>') +
            '<div class="stack-col">' + btn({ label: 'Reset demo data', id: 'd-reset', block: true }) + btn({ label: 'Leave demo mode', id: 'd-exit', kind: 'primary', block: true }) + '</div>'
          : '<div class="stack-col">' + btn({ label: 'Start demo mode', id: 'd-start', kind: 'primary', block: true, cls: 'btn-lg' }) + '</div>'), 'narrow'),
      mount: function (root) {
        function go() { location.hash = '#/login'; window.DL.app.render(); }
        var st = root.querySelector('#d-start');
        if (st) st.addEventListener('click', function () { U.setBusy(st, true, 'Preparing…'); S.startDemo().then(function () { U.toast('Demo mode is on', 'good'); go(); }).catch(function (ex) { U.setBusy(st, false); U.toast(friendly(ex, 'Could not start demo mode.'), 'bad'); }); });
        var ex = root.querySelector('#d-exit');
        if (ex) ex.addEventListener('click', function () { S.exitDemo().then(function () { U.toast('Back to the real site', 'good'); location.hash = '#/'; window.DL.app.render(); }); });
        var rs = root.querySelector('#d-reset');
        if (rs) rs.addEventListener('click', function () {
          U.confirmDialog({ title: 'Reset demo data?', text: 'This deletes everything in demo mode and brings back the sample records. Real data is not touched.', confirmLabel: 'Reset demo data', danger: true,
            onConfirm: function (d, close) { S.resetDemo().then(function () { close(); U.toast('Demo data restored', 'good'); location.hash = '#/login'; window.DL.app.render(); }); } });
        });
      }
    };
  }

  /* ---------- official verification status ---------- */
  var COPY = {
    pending:        { tone: 'warn', ic: 'clock', head: 'Your ID is being checked', text: 'An admin is checking your details. You cannot use the department desk until you are approved.' },
    info_requested: { tone: 'warn', ic: 'info', head: 'The admin needs more information', text: 'Reply below so your application can continue.' },
    approved:       { tone: 'good', ic: 'check', head: 'You are approved', text: 'You can use your department desk.' },
    rejected:       { tone: 'danger', ic: 'alert', head: 'Your application was not approved', text: 'You cannot do official work. If the admin\'s reason can be fixed, you can send new details below.' },
    suspended:      { tone: 'danger', ic: 'alert', head: 'Your official access is suspended', text: 'You cannot do official work until an admin restores your access.' }
  };

  function verification(ctx) {
    var me = ctx.me;
    if (!me) return V.needLogin('Log in to see the status of your official application.');
    if (me.role !== 'official') return { html: wrap(U.emptyState({ icon: 'shield', title: 'This page is for officials', action: btn({ label: 'Go home', href: '#/', kind: 'primary' }) }), 'narrow') };
    var st = S.verifState(me), m = COPY[st] || COPY.pending, v = me.verification;
    var hist = v.history.map(function (h) { return '<li><strong>' + esc(({ pending: 'Sent to admin', info_requested: 'More information requested', approved: 'Approved', rejected: 'Not approved', suspended: 'Suspended' })[h.status] || h.status) +
      '</strong><span class="muted"> · ' + U.dateTime(h.ts) + '</span>' + (h.note ? '<p>' + esc(h.note) + '</p>' : '') + '</li>'; }).join('');
    var canReply = st === 'info_requested' || st === 'rejected';
    return {
      html: wrap(U.pageHeader({ title: 'Official verification', sub: me.department + ' · ' + (me.authorityRole || 'Official') }) +
        '<section class="status tone-' + m.tone + '"><span class="status-ic">' + icon(m.ic) + '</span><div><p class="status-lead">' + m.head + '</p><p>' + m.text + '</p>' +
          (v.adminNote && st !== 'approved' ? '<p class="next"><strong>Admin note:</strong> ' + esc(v.adminNote) + '</p>' : '') + '</div></section>' +
        (st === 'approved' ? '<p class="more">' + btn({ label: 'Open department desk', href: '#/desk', kind: 'primary' }) + '</p>' : '') +
        (canReply ? '<form id="vf" class="form" novalidate>' + U.field({ id: 'v-t', label: 'Your reply or new details', tag: 'textarea', rows: 3, required: true, hint: 'For example: your ID number, your office, or a clearer description of your post.', attrs: 'maxlength="600"' }) +
          '<div id="v-alert"></div>' + btn({ label: 'Send to admin', type: 'submit', kind: 'primary', block: true, id: 'v-go' }) + '</form>' : '') +
        sec('What you sent', '<dl class="facts"><div><dt>Department</dt><dd>' + esc(me.department) + '</dd></div><div><dt>Designation</dt><dd>' + esc(me.authorityRole || '') + '</dd></div><div><dt>ID details</dt><dd>' + esc(me.idProof || '') + '</dd></div></dl>') +
        sec('History', '<ul class="loglist">' + hist + '</ul>'), 'narrow'),
      mount: function (root) {
        var f = root.querySelector('#vf'); if (!f) return;
        f.addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root); root.querySelector('#v-alert').innerHTML = '';
          var go = root.querySelector('#v-go'); U.setBusy(go, true, 'Sending…');
          U.attempt(function () { return S.submitVerificationInfo(me, root.querySelector('#v-t').value); }).then(function () { U.toast('Sent to the admin', 'good'); window.DL.app.render(); })
            .catch(function (ex) { U.setBusy(go, false); U.showError(root, 'v-t', friendly(ex, 'We could not send this. Please try again.')); });
        });
      }
    };
  }

  /* ---------- forgot / reset password (online mode) ---------- */
  function forgot() {
    if (!S.isCloud()) return { html: wrap(U.emptyState({ icon: 'info', title: 'Not available on this device', text: 'Resetting a password by email needs the online backend.', action: btn({ label: 'Back to log in', href: '#/login', kind: 'primary' }) }), 'narrow') };
    return { html: wrap(U.pageHeader({ title: 'Forgot your password?', sub: 'Enter your email and we will send you a link to choose a new one.', back: { href: '#/login', label: 'Log in' } }) +
      '<form id="ff" class="form" novalidate>' + U.field({ id: 'fp-em', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email"' }) + '<div id="fp-out" role="status"></div>' + btn({ label: 'Send the link', type: 'submit', kind: 'primary', block: true, id: 'fp-go', cls: 'btn-lg' }) + '</form>', 'narrow'),
      mount: function (root) {
        root.querySelector('#ff').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var em = root.querySelector('#fp-em').value;
          if (!/^\S+@\S+\.\S+$/.test(em)) { U.showError(root, 'fp-em', 'Enter a valid email address.'); root.querySelector('#fp-em').focus(); return; }
          var go = root.querySelector('#fp-go'); U.setBusy(go, true, 'Sending…');
          U.attempt(function () { return S.resetPassword(em); }).then(function () {
            U.setBusy(go, false);
            root.querySelector('#fp-out').innerHTML = alertBox('good', '<strong>Check your email</strong><p>If there is an account for ' + esc(em) + ', we sent a link. It can take a minute. Check your spam folder too.</p>');
          }).catch(function (ex) { U.setBusy(go, false); root.querySelector('#fp-out').innerHTML = alertBox('danger', '<strong>Not sent</strong><p>' + esc(friendly(ex, 'Something went wrong. Please try again.')) + '</p>'); });
        });
      } };
  }

  function reset() {
    if (!S.isCloud() || !(window.DL.cloud.inRecovery() || S.me())) return { html: wrap(U.emptyState({ icon: 'clock', title: 'This link has expired', text: 'Password links work once and for a short time. Ask for a new one.', action: btn({ label: 'Send a new link', href: '#/forgot', kind: 'primary' }) }), 'narrow') };
    return { html: wrap(U.pageHeader({ title: 'Choose a new password' }) + '<form id="rf2" class="form" novalidate>' +
      U.field({ id: 'np1', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: 'autocomplete="new-password"' }) +
      U.field({ id: 'np2', label: 'Repeat the new password', type: 'password', required: true, attrs: 'autocomplete="new-password"' }) +
      '<label class="check-inline"><input type="checkbox" id="np-show"><span>Show passwords</span></label><div id="np-out"></div>' + btn({ label: 'Save new password', type: 'submit', kind: 'primary', block: true, id: 'np-go', cls: 'btn-lg' }) + '</form>', 'narrow'),
      mount: function (root) {
        root.querySelector('#np-show').addEventListener('change', function (ev) { ['#np1', '#np2'].forEach(function (i) { root.querySelector(i).type = ev.target.checked ? 'text' : 'password'; }); });
        root.querySelector('#rf2').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var a = root.querySelector('#np1').value, b = root.querySelector('#np2').value, ok = true;
          if (a.length < 8) { U.showError(root, 'np1', 'Use at least 8 characters.'); ok = false; } else if (a !== b) { U.showError(root, 'np2', 'The two passwords are not the same.'); ok = false; }
          if (!ok) { U.focusFirstError(root); return; }
          var go = root.querySelector('#np-go'); U.setBusy(go, true, 'Saving…');
          U.attempt(function () { return S.setPassword(a); }).then(function () { U.toast('Your password was changed', 'good'); location.hash = S.me() ? '#/' : '#/login'; })
            .catch(function (ex) { U.setBusy(go, false); root.querySelector('#np-out').innerHTML = alertBox('danger', '<strong>Not saved</strong><p>' + esc(friendly(ex, 'Something went wrong. Please try again.')) + '</p>'); });
        });
      } };
  }

  /* ---------- profile dialogs (online mode) ---------- */
  function openEditProfile(me) {
    U.dialog({ title: 'Edit my details', body: '<form id="ep" novalidate>' + U.field({ id: 'ep-n', label: 'Full name', required: true, value: me.name }) +
      U.field({ id: 'ep-p', label: 'Mobile number', value: me.phone, attrs: 'inputmode="numeric" maxlength="10"' }) +
      U.field({ id: 'ep-s', label: 'State', tag: 'select', optionsHtml: '<option value="">Choose state</option>' + U.opts(S.STATES, me.state, function (x) { return x; }, function (x) { return x; }) }) +
      '<div class="two">' + U.field({ id: 'ep-d', label: 'District', value: me.district }) + U.field({ id: 'ep-c', label: 'City or town', value: me.city }) + '</div>' +
      U.field({ id: 'ep-z', label: 'Pincode', value: me.pincode, attrs: 'inputmode="numeric" maxlength="6"' }) +
      '<p class="muted small">Your email and role cannot be changed here.</p><div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Save', kind: 'primary', type: 'submit', id: 'ep-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#ep').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var v = function (i) { return root.querySelector(i).value.trim(); }, ok = true;
          if (v('#ep-n').length < 2) { U.showError(root, 'ep-n', 'Enter your name.'); ok = false; }
          if (v('#ep-p') && !/^\d{10}$/.test(v('#ep-p'))) { U.showError(root, 'ep-p', 'A mobile number has 10 digits.'); ok = false; }
          if (v('#ep-z') && !/^\d{6}$/.test(v('#ep-z'))) { U.showError(root, 'ep-z', 'A pincode has 6 digits.'); ok = false; }
          if (!ok) { U.focusFirstError(root); return; }
          var go = root.querySelector('#ep-go'); U.setBusy(go, true, 'Saving…');
          U.attempt(function () { return S.updateProfile({ name: v('#ep-n'), phone: v('#ep-p'), state: root.querySelector('#ep-s').value, district: v('#ep-d'), city: v('#ep-c'), pincode: v('#ep-z') }); })
            .then(function () { close(); U.toast('Details saved', 'good'); window.DL.app.render(); }).catch(function (ex) { U.setBusy(go, false); U.showError(root, 'ep-n', friendly(ex, 'We could not save your details.')); });
        });
      } });
  }
  function openChangePassword() {
    U.dialog({ title: 'Change password', body: '<form id="cp2" novalidate>' + U.field({ id: 'cp-a', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: 'autocomplete="new-password"' }) +
      U.field({ id: 'cp-b', label: 'Repeat the new password', type: 'password', required: true, attrs: 'autocomplete="new-password"' }) +
      '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Change password', kind: 'primary', type: 'submit', id: 'cp-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#cp2').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var a = root.querySelector('#cp-a').value, b = root.querySelector('#cp-b').value;
          if (a.length < 8) { U.showError(root, 'cp-a', 'Use at least 8 characters.'); return; } if (a !== b) { U.showError(root, 'cp-b', 'The two passwords are not the same.'); return; }
          var go = root.querySelector('#cp-go'); U.setBusy(go, true, 'Saving…');
          U.attempt(function () { return S.setPassword(a); }).then(function () { close(); U.toast('Your password was changed', 'good'); }).catch(function (ex) { U.setBusy(go, false); U.showError(root, 'cp-a', friendly(ex, 'We could not change the password.')); });
        });
      } });
  }

  window.DL.accountViews = { setup: setup, demo: demo, verification: verification, forgot: forgot, reset: reset, openEditProfile: openEditProfile, openChangePassword: openChangePassword };
})();
