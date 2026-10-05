/* Disaster Lens – online backend (Phase 6)
 *
 * Turns on when js/config.js holds a Supabase URL and the public "anon" key.
 *   - Sign-up, log-in, log-out, password reset: Supabase Auth (sessions survive a reload)
 *   - Reading: ONE database function, get_snapshot(), returns exactly what this person may see.
 *     The screens keep reading from an in-memory copy of that, in the same shape as before.
 *   - Changing: every change is a database function (supabase/schema.sql) that checks who is calling.
 *     The change is also applied on this device first so the screen answers instantly; if the
 *     database says no, the screen is put right and the reason is shown.
 *   - Photos: compressed in the browser, uploaded to a PRIVATE bucket, shown through short-lived signed links.
 *   - Live: other people's changes arrive through Realtime; a slow poll and "back online" refresh cover gaps.
 *
 * No secrets here. The anon key is public by design (the database rules limit what it can do).
 * The service_role key must never be put in a website.
 */
(function () {
  window.DL = window.DL || {};
  var cfg = window.DL_CONFIG || {};
  var BUCKET = 'report-images', POLL_MS = cfg.pollMs || 25000, SIGN_SECONDS = 3600;
  var enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);

  var sb = null, adopt = null, channel = null, adoptedOnce = false;
  var st = { status: 'idle', live: 'off', refreshing: false, again: false, pending: false, debounce: 0, poll: 0, auditCheck: null, lastOk: 0, recovery: false };
  var urlCache = {};   // storage path -> { url, exp }

  /* ---------- plain-language errors ---------- */
  function friendly(e, fallback) {
    var m = (e && (e.message || e.error_description)) || '', code = e && (e.code || e.status);
    if (typeof navigator !== 'undefined' && navigator.onLine === false || /Failed to fetch|NetworkError|Load failed|fetch failed|network request failed/i.test(m))
      return new Error('We could not reach the server. Check your internet connection and try again.');
    if (/JWT expired|invalid JWT|not authenticated|session.*(missing|expired)/i.test(m)) return new Error('Your session ended. Please log in again.');
    if (code === 'PGRST202' || /Could not find the function/i.test(m)) return new Error('The server is missing an update. Ask the site owner to run the latest database file (supabase/schema.sql).');
    var lim = limitMessage(e); if (lim) return lim;
    var clean = String(m).replace(/^.*?ERROR:\s*/, '').trim();
    return new Error(clean || fallback || 'Something went wrong. Please try again.');
  }
  /* Supabase answers 429 for two very different reasons; people need to know which */
  function limitMessage(e) {
    var m = (e && e.message) || '', code = (e && (e.code || e.error_code)) || '';
    if (code === 'over_email_send_rate_limit' || /email.*rate|rate.*email|email rate limit/i.test(m)) {
      return new Error('The site cannot send emails for the next hour (the free email service has a small hourly limit), so your account could not be created. Please try again later. Site owner: switch off \u201CConfirm email\u201D in Supabase (Authentication \u2192 Sign In / Providers \u2192 Email) or add your own email service. Server said: ' + m);
    }
    if (code === 'over_request_rate_limit' || /request rate limit|too many requests/i.test(m)) return new Error('Too many attempts from this device. Please wait a few minutes and try again.');
    if (/rate limit|too many/i.test(m) || (e && e.status === 429)) return new Error('Too many tries. Please wait a few minutes and try again. Server said: ' + m);
    return null;
  }

  function ui() { return window.DL.ui; }
  function store() { return window.DL.store; }

  async function rpc(fn, args) {
    var r;
    try { r = await sb.rpc(fn, args || {}); } catch (e) { throw friendly(e); }
    if (r.error) throw friendly(r.error);
    return r.data;
  }

  /* ---------- reading ---------- */
  function emptySnapshot() {
    return { complaints: [], comments: [], upvotes: [], flags: [], notifications: [], users: [], audit: [], logs: [], departments: [], settings: {}, hasAdmin: true, me: null, updatedAt: Date.now(), seq: 0 };
  }

  function collectPaths(snap) {
    var out = {};
    function add(v) { if (typeof v === 'string' && v.indexOf('storage:') === 0) out[v.slice(8)] = 1; }
    snap.complaints.forEach(function (c) {
      add(c.imageUrlProof); add(c.resolutionProofUrl);
      (c.resolutions || []).forEach(function (r) { add(r.proof); });
      (c.disputes || []).forEach(function (d) { add(d.photo); });
    });
    return Object.keys(out);
  }
  function applyUrls(snap) {
    function sw(v) { if (typeof v !== 'string' || v.indexOf('storage:') !== 0) return v; var u = urlCache[v.slice(8)]; return u && u.url ? u.url : ''; }
    snap.complaints.forEach(function (c) {
      c.imageUrlProof = sw(c.imageUrlProof); c.resolutionProofUrl = sw(c.resolutionProofUrl);
      (c.resolutions || []).forEach(function (r) { r.proof = sw(r.proof); });
      (c.disputes || []).forEach(function (d) { d.photo = sw(d.photo); });
    });
  }
  async function signPhotos(snap) {
    var now = Date.now(), need = collectPaths(snap).filter(function (p) { var u = urlCache[p]; return !u || u.exp - now < 5 * 60000; });
    for (var i = 0; i < need.length; i += 100) {
      var chunk = need.slice(i, i + 100);
      try {
        var r = await sb.storage.from(BUCKET).createSignedUrls(chunk, SIGN_SECONDS);
        (r.data || []).forEach(function (row) { if (row && row.path) urlCache[row.path] = { url: row.signedUrl || '', exp: now + SIGN_SECONDS * 1000 }; });
      } catch (e) { /* photos are decoration; the report still shows without them */ }
    }
    applyUrls(snap);
  }

  async function refresh() {
    if (st.refreshing) { st.again = true; return; }
    st.refreshing = true;
    try {
      var snap = await rpc('get_snapshot');
      if (!snap || typeof snap !== 'object') throw new Error('The server sent an unexpected answer.');
      await signPhotos(snap);
      adopt(snap); adoptedOnce = true;
      st.status = 'online'; st.lastOk = Date.now();
      if (snap.me && ((snap.users || []).filter(function (u) { return u.id === snap.me; })[0] || {}).role === 'admin') {
        rpc('audit_verify').then(function (r) { st.auditCheck = r; }).catch(function () { /* shown as unknown */ });
      }
    } catch (e) {
      st.status = 'offline';
      if (!adoptedOnce) { adopt(emptySnapshot()); adoptedOnce = true; }
      showChip();
      st.refreshing = false;
      throw e;
    }
    st.refreshing = false;
    if (st.again) { st.again = false; return refresh(); }
    showChip();
  }

  /* ---------- keeping the screen in step without destroying what someone is typing ---------- */
  function busyScreen() {
    var a = document.activeElement, tag = a && a.tagName;
    if (document.querySelector('.modal')) return true;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return /^#\/(new|setup|signup|login|reset|map|admin\/insights|check-email)/.test(location.hash);
  }
  function repaint(force) {
    if (!window.DL.app) return;
    if (!force && busyScreen()) { st.pending = true; showChip(); return; }
    st.pending = false;
    window.DL.app.render();
  }
  function showChip() {
    var el = document.getElementById('live-chip');
    if (!el) return;
    var label, cls;
    if (st.status === 'offline') { label = 'Offline. Showing what was last loaded.'; cls = 'off'; }
    else if (st.live === 'live') { label = 'Live'; cls = 'live'; }
    else if (st.live === 'reconnecting') { label = 'Reconnecting…'; cls = 'warn'; }
    else { label = 'Online'; cls = 'live'; }
    el.className = 'live-chip ' + cls;
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span>' + label + '</span>' + (st.pending ? ' <button type="button" class="chip-btn" id="chip-refresh">Show new updates</button>' : '');
    el.hidden = false;
    var b = document.getElementById('chip-refresh');
    if (b) b.onclick = function () { repaint(true); };
  }
  function changed() {
    clearTimeout(st.debounce);
    st.debounce = setTimeout(function () { refresh().then(function () { repaint(false); }).catch(function () { /* chip shows offline */ }); }, 350);
  }

  /* ---------- realtime ---------- */
  function startRealtime() {
    try {
      if (channel) { sb.removeChannel(channel); channel = null; }
      channel = sb.channel('dl-feed-' + Math.random().toString(36).slice(2, 7))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'change_feed' }, function () { changed(); })
        .subscribe(function (status) {
          st.live = status === 'SUBSCRIBED' ? 'live' : (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'reconnecting' : st.live);
          showChip();
        });
    } catch (e) { st.live = 'reconnecting'; showChip(); }
  }
  function startPolling() {
    clearInterval(st.poll);
    st.poll = setInterval(function () {
      if (document.hidden) return;
      if (st.live === 'live' && Date.now() - st.lastOk < POLL_MS * 4) return;      // realtime is healthy: no need
      refresh().then(function () { repaint(false); }).catch(function () { });
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) changed(); });
    window.addEventListener('online', function () { changed(); });
    window.addEventListener('offline', function () { st.status = 'offline'; showChip(); });
  }

  /* ---------- photos ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function dataUrlToBlob(d) {
    var parts = d.split(','), mime = (/data:([^;]+)/.exec(parts[0]) || [])[1] || 'image/jpeg', bin = atob(parts[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function upload(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.indexOf('data:') !== 0) return null;
    var me = store().me();
    if (!me) throw new Error('Please log in first.');
    var path = 'u/' + me.id + '/' + uuid() + '.jpg', blob = dataUrlToBlob(dataUrl), lastErr;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
        if (!r.error) return path;
        lastErr = r.error;
      } catch (e) { lastErr = e; }
    }
    var f = friendly(lastErr);
    if (/exceeded|too large|payload/i.test(f.message)) throw new Error('That photo is too large. Try a smaller one.');
    throw new Error(/reach the server/.test(f.message) ? f.message : 'We could not upload the photo. Check your connection and try again.');
  }

  /* ---------- changes ---------- */
  function id(x) { return Number(x); }
  var CMD = {
    toggleUpvote: function (a) { return ['toggle_upvote', { rid: id(a[1]) }]; },
    addComment: function (a) { return ['add_comment', { rid: id(a[1]), body: a[2] }]; },
    flagComplaint: function (a) { return ['flag_report', { rid: id(a[1]), reason: a[2], note: a[3] || '' }]; },
    startWork: function (a) { return ['start_work', { rid: id(a[1]) }]; },
    transfer: function (a) { return ['transfer_report', { rid: id(a[1]), to_dept: a[2], reason: a[3] }]; },
    escalate: function (a) { return ['escalate_report', { rid: id(a[1]), reason: a[2] }]; },
    confirmFix: function (a) { return ['confirm_fix', { rid: id(a[1]), rating: Number(a[2] && a[2].rating), remark: (a[2] && a[2].comment) || '' }]; },
    submitVerificationInfo: function (a) { return ['submit_verification_info', { body: a[1] }]; },
    keepReport: function (a) { return ['keep_report', { rid: id(a[0]), reason: a[1] }]; },
    markUnderReview: function (a) { return ['mark_under_review', { rid: id(a[0]), reason: a[1] }]; },
    rejectReport: function (a) { return ['reject_report', { rid: id(a[0]), outcome: a[1], reason: a[2] }]; },
    markDuplicate: function (a) { return ['mark_duplicate', { rid: id(a[0]), original: id(String(a[1]).replace(/\D/g, '')), reason: a[2] }]; },
    archiveReport: function (a) { return ['archive_report', { rid: id(a[0]), reason: a[1] }]; },
    restoreReport: function (a) { return ['restore_report', { rid: id(a[0]), reason: a[1] }]; },
    setLocationPrivacy: function (a) { return ['set_location_privacy', { rid: id(a[0]), level: a[1], reason: a[2] }]; },
    warnUser: function (a) { return ['warn_user', { uid: a[0], reason: a[1] }]; },
    suspendUser: function (a) { return ['suspend_user', { uid: a[0], days: Number(a[1]), reason: a[2] }]; },
    banUser: function (a) { return ['ban_user', { uid: a[0], reason: a[1], confirm_word: a[2] }]; },
    reinstateUser: function (a) { return ['reinstate_user', { uid: a[0], reason: a[1] }]; },
    approveAuthority: function (a) { return ['authority_action', { uid: a[0], act: 'approve', note: a[1] || '' }]; },
    rejectAuthority: function (a) { return ['authority_action', { uid: a[0], act: 'reject', note: a[1] || '' }]; },
    requestInfo: function (a) { return ['authority_action', { uid: a[0], act: 'request_info', note: a[1] || '' }]; },
    suspendAuthority: function (a) { return ['authority_action', { uid: a[0], act: 'suspend', note: a[1] || '' }]; },
    reinstateAuthority: function (a) { return ['authority_action', { uid: a[0], act: 'reinstate', note: a[1] || '' }]; },
    saveDepartment: function (a) { return ['save_department', { p: a[0] }]; },
    setCategoryDept: function (a) { return ['set_category_dept', { cat: a[0], dept: a[1] }]; },
    saveSettings: function (a) { return ['save_settings', { p: a[0] }]; },
    markRead: function (a) { return ['mark_read', { ids: [a[1]] }]; },
    markAllRead: function () { return ['mark_all_read', {}]; }
  };
  var WITH_PHOTO = { createComplaint: 1, resolve: 1, disputeFix: 1 };
  function returnsPromise(name) { return !!WITH_PHOTO[name]; }

  /* a refused change: show why, then put the screen back in line with the database */
  function refused(e) {
    var msg = (e && e.message) || 'That could not be saved. Please try again.';
    try { ui().toast(msg, 'bad'); } catch (x) { /* ignore */ }
    refresh().then(function () { repaint(false); }).catch(function () { });
  }

  function command(name, args, local) {
    if (WITH_PHOTO[name]) return photoCommand(name, args);
    var spec = CMD[name];
    if (!spec) return Promise.resolve(local);
    var call = spec(args);
    var p = rpc(call[0], call[1]).then(function () { return refresh().then(function () { repaint(false); }); });
    p.catch(refused);
    return p.then(function () { return local; }, function () { return local; });
  }

  async function photoCommand(name, args) {
    try {
      var out;
      if (name === 'createComplaint') {
        var f = args[1];
        var path = await upload(f.image);
        var newId = await rpc('create_report', { p: { clientUuid: f.clientUuid || uuid(), category: f.category, title: f.title, description: f.description, state: f.state, district: f.district,
          city: f.city, pincode: f.pincode, address: f.address, latitude: f.latitude, longitude: f.longitude, isAnonymous: !!f.isAnonymous, imagePath: path } });
        await refresh();
        out = store().getComplaint(newId);
        if (!out) throw new Error('Your report was saved, but it could not be shown yet. Open My reports to see it.');
      } else if (name === 'resolve') {
        var o = args[2], proof = await upload(o.proof);
        await rpc('resolve_report', { rid: id(args[1]), response: o.response, proof_path: proof });
        await refresh(); out = store().getComplaint(args[1]);
      } else {
        var d = args[2], photo = await upload(d.photo);
        await rpc('dispute_fix', { rid: id(args[1]), reason_id: d.reasonId, note: d.note, photo_path: photo || null });
        await refresh(); out = store().getComplaint(args[1]);
      }
      repaint(false);
      return out;
    } catch (e) {
      refresh().catch(function () { });
      throw e;
    }
  }

  /* ---------- sign-in ---------- */
  function siteUrl() { return location.origin + location.pathname; }
  function cleanAuthError(e) {
    var m = (e && e.message) || '';
    if (/Invalid login credentials/i.test(m)) return new Error('Wrong email or password. Check them and try again.');
    if (/Email not confirmed/i.test(m)) return new Error('Please confirm your email first. Check your inbox for the link we sent.');
    if (/already registered|already been registered|User already/i.test(m)) return new Error('An account with this email already exists. Try logging in.');
    if (/password.*(at least|short|weak)|Password should/i.test(m)) return new Error('Choose a stronger password (at least 8 characters).');
    var lim2 = limitMessage(e); if (lim2) return lim2;
    if (/signups? (not allowed|are disabled)|disabled/i.test(m)) return new Error('New sign-ups are switched off right now.');
    return friendly(e, 'Something went wrong. Please try again.');
  }
  var auth = {
    async register(f) {
      var email = (f.email || '').trim().toLowerCase();
      var r;
      try {
        r = await sb.auth.signUp({ email: email, password: f.password, options: { emailRedirectTo: siteUrl(), data: {
          name: f.name, phone: f.phone || '', state: f.state || '', district: f.district || '', city: f.city || '', pincode: f.pincode || '',
          role: f.role === 'official' ? 'official' : 'citizen', deptId: f.deptId || '', authorityRole: f.authorityRole || '', idProof: f.idProof || '' } } });
      } catch (e) { throw cleanAuthError(e); }
      if (r.error) throw cleanAuthError(r.error);
      if (r.data && r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new Error('An account with this email already exists. Try logging in.');
      if (r.data && r.data.session) { await refresh(); repaint(true); return store().me() || { role: f.role === 'official' ? 'official' : 'citizen', name: f.name }; }
      return { needsConfirm: true, email: email, role: f.role === 'official' ? 'official' : 'citizen', name: f.name };
    },
    async login(email, password) {
      var r;
      try { r = await sb.auth.signInWithPassword({ email: String(email || '').trim().toLowerCase(), password: password }); } catch (e) { throw cleanAuthError(e); }
      if (r.error) throw cleanAuthError(r.error);
      await refresh();
      startRealtime();
      var me = store().me();
      if (!me) {
        await sb.auth.signOut();
        await refresh().catch(function () { });
        throw new Error('This account has been blocked. Contact the site owner if you think this is a mistake.');
      }
      return me;
    },
    async logout() {
      try { await sb.auth.signOut(); } catch (e) { /* the local session is already gone */ }
      try { await refresh(); startRealtime(); } catch (e) { /* offline: the chip says so */ }
      repaint(true);
    },
    async setupAdmin(f) {
      var sessionNow = (await sb.auth.getSession()).data.session;
      if (!sessionNow) {
        var r;
        try { r = await sb.auth.signUp({ email: (f.email || '').trim().toLowerCase(), password: f.password, options: { emailRedirectTo: siteUrl(), data: { name: f.name, role: 'citizen' } } }); } catch (e) { throw cleanAuthError(e); }
        if (r.error) throw cleanAuthError(r.error);
        if (!r.data.session) {
          var r2 = await sb.auth.signInWithPassword({ email: (f.email || '').trim().toLowerCase(), password: f.password });
          if (r2.error) throw new Error('Account created. Open the confirmation link we emailed you, then log in and open the setup page again to finish.');
        }
      }
      try { await rpc('claim_first_admin'); } catch (e) { throw e; }
      await refresh(); startRealtime(); repaint(true);
      return store().me();
    },
    async requestReset(email) {
      var r = await sb.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), { redirectTo: siteUrl() });
      if (r.error && !/not found|rate/i.test(r.error.message)) throw cleanAuthError(r.error);
      if (r.error && /rate/i.test(r.error.message)) throw cleanAuthError(r.error);
      return true;
    },
    async updatePassword(pw) {
      var r = await sb.auth.updateUser({ password: pw });
      if (r.error) throw cleanAuthError(r.error);
      st.recovery = false; return true;
    }
  };

  /* ---------- start ---------- */
  async function boot(adoptFn) {
    adopt = adoptFn;
    if (!sb) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'dl_auth' },
        realtime: { params: { eventsPerSecond: 5 } }
      });
      sb.auth.onAuthStateChange(function (ev) {
        if (ev === 'PASSWORD_RECOVERY') { st.recovery = true; location.hash = '#/reset'; }
        if (ev === 'TOKEN_REFRESHED' || ev === 'SIGNED_IN') startRealtime();
      });
    }
    try { await sb.auth.getSession(); } catch (e) { /* offline at start */ }
    try { await refresh(); } catch (e) { /* offline: an empty, honest page with the chip */ }
    startRealtime(); startPolling();
  }

  var log = function (level, area, message) {
    if (!sb) return;
    try { sb.auth.getSession().then(function (s) { if (s.data.session) sb.rpc('client_log', { lvl: level, area: area, msg: String(message).slice(0, 280) }); }); } catch (e) { /* never block the screen */ }
  };

  window.DL.remote = {
    enabled: enabled, boot: boot, auth: auth, command: command, returnsPromise: returnsPromise, log: log, refresh: refresh,
    auditCheck: function () { return st.auditCheck || { ok: true, count: (store().auditList({}) || []).length, unknown: true }; },
    status: function () { return st.status; }, isRecovery: function () { return st.recovery; },
    requestReset: auth.requestReset, updatePassword: auth.updatePassword
  };
})();
