/* Disaster Lens – sign-in screens (Phase 6)
 * One calm layout for log in, sign up, "check your email", forgot password and choosing a new password.
 * These replace the simpler Phase 2.5 versions; ids and behaviour that other parts rely on are kept.
 */
(function () {
  var S = window.DL.store, U = window.DL.ui, H = window.DL.vhelp, V = window.DL.views;
  var esc = U.esc, btn = U.button, icon = U.icon, wrap = H.wrap, alertBox = H.alertBox, friendly = H.friendly;

  function stateOpts(sel) { return '<option value="">Choose state</option>' + U.opts(S.STATES, sel, function (s) { return s; }, function (s) { return s; }); }

  function shell(title, lead, body, foot) {
    return '<div class="auth"><aside class="auth-brand" aria-hidden="true"><div class="auth-logo">' + U.LOGO + '<span>Disaster Lens</span></div>' +
      '<h2>Report it. Track it. Get it fixed.</h2><ul><li>' + icon('camera') + '<span>Send a problem with a photo and the place</span></li><li>' + icon('bell') + '<span>Follow every step, as it happens</span></li>' +
      '<li>' + icon('check') + '<span>Check the work and rate the fix</span></li></ul></aside>' +
      '<section class="auth-card"><h1 id="page-title" tabindex="-1">' + title + '</h1>' + (lead ? '<p class="auth-lead">' + lead + '</p>' : '') + body + (foot ? '<div class="auth-foot">' + foot + '</div>' : '') + '</section></div>';
  }

  /* show / hide for password boxes: a text button, not an icon */
  function passToggle(root) {
    root.querySelectorAll('input[type=password]').forEach(function (inp) {
      var w = document.createElement('div'); w.className = 'pw'; inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pw-t'; b.textContent = 'Show'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password');
      b.addEventListener('click', function () {
        var show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
        b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', (show ? 'Hide' : 'Show') + ' password');
      });
      w.appendChild(b);
    });
  }
  function strength(pw) {
    if (!pw) return '';
    var n = (pw.length >= 8 ? 1 : 0) + (pw.length >= 12 ? 1 : 0) + (/[a-z]/.test(pw) && /[A-Z]/.test(pw) ? 1 : 0) + (/\d/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
    if (pw.length < 8) return 'Too short. Use at least 8 characters.';
    return n >= 4 ? 'Strong password.' : (n >= 3 ? 'Good. A symbol or more length makes it stronger.' : 'Fair. Mix upper and lower case, numbers and a symbol.');
  }

  function forgotDialog(prefill) {
    U.dialog({
      title: 'Reset your password',
      body: '<form id="fp" novalidate><p class="dlg-text">Enter the email you signed up with. If an account exists, we will email you a link to choose a new password.</p>' +
        U.field({ id: 'fp-em', label: 'Email', type: 'email', required: true, value: prefill || '', attrs: 'autocomplete="email"' }) +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: 'Send reset link', kind: 'primary', type: 'submit', id: 'fp-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#fp').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var em = root.querySelector('#fp-em').value;
          if (!/^\S+@\S+\.\S+$/.test(em)) { U.showError(root, 'fp-em', 'Enter a valid email address.'); return; }
          var go = root.querySelector('#fp-go'); U.setBusy(go, true, 'Sending…');
          S.requestPasswordReset(em).then(function () { close(); U.toast('If that email has an account, a reset link is on its way.', 'good'); })
            .catch(function (ex) { U.setBusy(go, false); U.showError(root, 'fp-em', friendly(ex, 'We could not send the link. Please try again.')); });
        });
      }
    });
  }

  /* send people back to the page they wanted, but only if THEIR account may open it
     (someone who logs in as a different person must not land on a page that is not for them) */
  function returnTo(back, u) {
    if (!back || /#\/(login|signup|setup|reset|check-email)/.test(back)) return '';
    if (/^#\/admin/.test(back)) return u.role === 'admin' ? back : '';
    if (/^#\/(desk|verification)/.test(back)) return u.role === 'official' ? back : '';
    if (/^#\/(new|mine)/.test(back)) return u.role === 'citizen' ? back : '';
    return back;
  }

  function login() {
    return {
      html: wrap(shell('Log in', 'Welcome back. Log in to follow your reports.',
        '<form id="lf" class="form" novalidate>' + U.field({ id: 'l-em', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email" inputmode="email"' }) +
        U.field({ id: 'l-pw', label: 'Password', type: 'password', required: true, attrs: 'autocomplete="current-password"' }) +
        (S.isRemote() ? '<p class="forgot"><button type="button" class="link-btn" id="l-forgot">Forgot your password?</button></p>' : '') +
        '<div id="l-alert"></div>' + btn({ label: 'Log in', type: 'submit', kind: 'primary', block: true, id: 'l-go', cls: 'btn-lg' }) + '</form>' +
        (S.hasAdmin() || S.isDemo() ? '' : '<div class="setup-hint">' + alertBox('info', '<strong>This site has no administrator yet.</strong><p>' + btn({ label: 'Set up the administrator', href: '#/setup', small: true }) + '</p>') + '</div>'),
        'New here? <a class="link" href="#/signup">Create an account</a>'), 'auth-wrap'),
      mount: function (root) {
        passToggle(root);
        var fg = root.querySelector('#l-forgot'); if (fg) fg.addEventListener('click', function () { forgotDialog(root.querySelector('#l-em').value); });
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
            location.hash = returnTo(back, u) || (u.role === 'citizen' ? '#/' : (u.role === 'admin' ? '#/admin' : (S.verifState(u) === 'approved' ? '#/desk' : '#/verification')));
          }).catch(function (ex) {
            U.setBusy(go, false);
            root.querySelector('#l-alert').innerHTML = alertBox('danger', '<strong>Could not log in</strong><p>' + esc(friendly(ex, 'Something went wrong. Please try again.')) + '</p>');
          });
        });
      }
    };
  }

  function signup() {
    return {
      html: wrap(shell('Create account', 'It takes a minute. You can report problems and follow them right away.',
        '<form id="sf" class="form" novalidate><fieldset class="seg"><legend class="sr">Account type</legend>' +
        '<label><input type="radio" name="role" value="citizen" checked><span>I am a citizen</span></label><label><input type="radio" name="role" value="official"><span>I am an official</span></label></fieldset>' +
        U.field({ id: 's-name', label: 'Full name', required: true, attrs: 'autocomplete="name"' }) +
        U.field({ id: 's-em', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email" inputmode="email"' }) +
        U.field({ id: 's-ph', label: 'Mobile number', attrs: 'inputmode="numeric" maxlength="10" autocomplete="tel-national"' }) +
        U.field({ id: 's-pw', label: 'Password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: 'autocomplete="new-password"' }) + '<p class="pw-s" id="s-pw-s" aria-live="polite"></p>' +
        U.field({ id: 's-state', label: 'State', tag: 'select', required: true, optionsHtml: stateOpts('') }) +
        '<div class="two">' + U.field({ id: 's-dist', label: 'District', required: true }) + U.field({ id: 's-city', label: 'City or town', required: true }) + '</div>' +
        U.field({ id: 's-pin', label: 'Pincode', attrs: 'inputmode="numeric" maxlength="6"' }) +
        '<div id="auth-only" hidden>' + U.field({ id: 's-arole', label: 'Your role', hint: 'Example: Ward Officer', required: true }) +
          U.field({ id: 's-dept', label: 'Department', tag: 'select', required: true, optionsHtml: U.opts(S.activeDepts(), '', function (d) { return d.id; }, function (d) { return d.name; }) }) +
          U.field({ id: 's-idp', label: 'Official ID details', tag: 'textarea', rows: 2, required: true, hint: 'ID number and issuing office. An admin checks this before you can use the desk.' }) + '</div>' +
        '<div id="s-alert"></div>' + btn({ label: 'Create account', type: 'submit', kind: 'primary', block: true, id: 's-go', cls: 'btn-lg' }) + '</form>',
        'Already registered? <a class="link" href="#/login">Log in</a>'), 'auth-wrap'),
      mount: function (root) {
        passToggle(root);
        var f = function (s) { return root.querySelector(s); };
        var roleVal = function () { return root.querySelector('input[name=role]:checked').value; };
        f('#s-pw').addEventListener('input', function () { f('#s-pw-s').textContent = strength(f('#s-pw').value); });
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
            if (u.needsConfirm) { location.hash = '#/check-email?e=' + encodeURIComponent(u.email) + '&r=' + u.role; return; }
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

  /* shown after sign-up when the project asks people to confirm their email first */
  function checkEmail(ctx) {
    var e = ctx.query.e || 'your email', off = ctx.query.r === 'official';
    return { html: wrap(shell('Check your email', '',
      '<div class="mailbox">' + icon('inbox') + '</div><p class="body">We sent a confirmation link to <strong>' + esc(e) + '</strong>. Open it, then come back and log in.' +
      (off ? ' After that, an admin will check your ID before you can use the department desk.' : '') + '</p>' +
      '<p class="muted small">Nothing in your inbox after a few minutes? Look in spam or junk mail.</p>' + btn({ label: 'Go to log in', href: '#/login', kind: 'primary', block: true }), ''), 'auth-wrap') };
  }

  /* opened from the link in the password-reset email */
  function reset() {
    return {
      html: wrap(shell('Choose a new password', 'Pick something you do not use anywhere else.',
        '<form id="rp" class="form" novalidate>' + U.field({ id: 'rp-pw', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: 'autocomplete="new-password"' }) + '<p class="pw-s" id="rp-s" aria-live="polite"></p>' +
        U.field({ id: 'rp-pw2', label: 'Repeat the new password', type: 'password', required: true, attrs: 'autocomplete="new-password"' }) + '<div id="rp-alert"></div>' +
        btn({ label: 'Save new password', type: 'submit', kind: 'primary', block: true, id: 'rp-go', cls: 'btn-lg' }) + '</form>', ''), 'auth-wrap'),
      mount: function (root) {
        passToggle(root);
        root.querySelector('#rp-pw').addEventListener('input', function (e) { root.querySelector('#rp-s').textContent = strength(e.target.value); });
        root.querySelector('#rp').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root); root.querySelector('#rp-alert').innerHTML = '';
          var a = root.querySelector('#rp-pw').value, b = root.querySelector('#rp-pw2').value, ok = true;
          if (a.length < 8) { U.showError(root, 'rp-pw', 'Use at least 8 characters.'); ok = false; } else if (a !== b) { U.showError(root, 'rp-pw2', 'The two passwords are not the same.'); ok = false; }
          if (!ok) { U.focusFirstError(root); return; }
          var go = root.querySelector('#rp-go'); U.setBusy(go, true, 'Saving…');
          S.updatePassword(a).then(function () { U.toast('Password changed. You are logged in.', 'good'); location.hash = '#/'; window.DL.app.render(); })
            .catch(function (ex) { U.setBusy(go, false); root.querySelector('#rp-alert').innerHTML = alertBox('danger', '<strong>Not saved</strong><p>' + esc(friendly(ex, 'The link may have expired. Request a new one from the log-in page.')) + '</p>'); });
        });
      }
    };
  }

  V.login = login; V.signup = signup; V.checkEmail = checkEmail; V.reset = reset;
  window.DL.authUi = { passToggle: passToggle, strength: strength, shell: shell };
})();
