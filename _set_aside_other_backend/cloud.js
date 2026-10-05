/* Disaster Lens – online backend (Phase 6)
 *
 * When js/config.js has a Supabase URL and anon key, the app runs in "cloud mode":
 *   - people sign up and log in with Supabase Auth (sessions survive a reload)
 *   - data is read from the database (what each person may see is decided by the database, not this file)
 *   - every change is a call to a database function that checks who is calling (backend/supabase/schema.sql)
 *   - photos are uploaded to a PRIVATE storage bucket and shown through short-lived signed links
 *   - changes made by other people arrive live (Realtime), with a polling fallback
 *
 * The screens keep reading from a cache in the same shape they always used, so nothing about
 * how a screen looks had to change. Only the way data gets in and out is different.
 *
 * No secrets live here. The anon key is public by design; the service_role key must never be used.
 */
(function () {
  var cfg = window.DL_CONFIG || {};
  var BUCKET = 'report-photos', PAGE = 1000, POLL_MS = cfg.pollMs || 20000, SNAP_KEY = 'dl_cloud_snapshot';
  var sb = null, host = null, S = null, session = null, me = null, db = null, channel = null;
  var state = { status: 'idle', pollTimer: 0, refreshing: false, again: false, debounce: 0, lastOk: 0, adminExists: true, auditCheck: null, sweptAt: 0, bannedMsg: '', recovery: false };
  var urlCache = {};

  function enabled() { return !!(cfg.supabaseUrl && cfg.supabaseAnonKey); }
  function ms(t) { return t ? Date.parse(t) : 0; }

  /* ---------- plain-language errors ---------- */
  function fe(e) {
    var m = (e && e.message) || '', code = e && e.code;
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed/i.test(m)) return new Error('We could not reach the server. Check your internet connection and try again.');
    if (/JWT expired|invalid JWT|session.*(missing|expired)|not authenticated/i.test(m)) return new Error('Your session ended. Please log in again.');
    if (code === 'PGRST202' || /Could not find the function/i.test(m)) return new Error('The server is missing an update. Ask the site owner to run the latest database file (backend/supabase/schema.sql).');
    if (/rate limit|too many requests|over_.*_rate_limit/i.test(m)) return new Error('Too many tries. Please wait a minute and try again.');
    return new Error(m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong. Please try again.');
  }
  function offlineGuard() { if (state.status === 'offline') throw new Error('You are offline. You can look at saved reports, but you can only make changes when you are back online.'); }

  async function rpc(fn, args) {
    offlineGuard();
    var r;
    try { r = await sb.rpc(fn, args || {}); } catch (e) { throw fe(e); }
    if (r.error) throw fe(r.error);
    return r.data;
  }

  /* ---------- photos (private bucket, signed links) ---------- */
  function dataUrlToBlob(d) {
    var parts = String(d).split(','), mime = (/data:([^;]+)/.exec(parts[0]) || [])[1] || 'image/jpeg', bin = atob(parts[1] || ''), n = bin.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  async function upload(dataUrl) {
    if (!dataUrl) return '';
    if (!/^data:/.test(dataUrl)) return dataUrl;                       // already a stored path
    offlineGuard();
    var uid = session && session.user && session.user.id;
    if (!uid) throw new Error('Please log in first.');
    var blob = dataUrlToBlob(dataUrl);
    if (blob.size > 5 * 1024 * 1024) throw new Error('That photo is too large. Try a smaller one (under 5 MB).');
    var ext = blob.type === 'image/png' ? 'png' : (blob.type === 'image/webp' ? 'webp' : 'jpg'), path = uid + '/' + uuid() + '.' + ext, r;
    try { r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false, cacheControl: '3600' }); } catch (e) { throw fe(e); }
    if (r.error) { if (/size|too large|exceeded/i.test(r.error.message)) throw new Error('That photo is too large. Try a smaller one.'); throw new Error('We could not upload the photo. Check your connection and try again.'); }
    return path;
  }
  function dropUpload(path) { if (path) sb.storage.from(BUCKET).remove([path]).catch(function () {}); }

  async function signed(paths) {
    var need = paths.filter(function (p) { var c = urlCache[p]; return p && !/^data:/.test(p) && (!c || c.exp < Date.now() + 60000); });
    if (!need.length || !sb) return;
    try {
      var r = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
      if (r.error) return;
      (r.data || []).forEach(function (x) { if (x.signedUrl && x.path) urlCache[x.path] = { url: x.signedUrl, exp: Date.now() + 55 * 60000 }; });
    } catch (e) { /* shown as unavailable */ }
  }
  function hydrate(root) {
    if (!sb) return;
    var imgs = Array.prototype.slice.call((root || document).querySelectorAll('img[data-path]:not([data-done])'));
    if (!imgs.length) return;
    var paths = imgs.map(function (i) { return i.getAttribute('data-path'); }).filter(function (p, i, a) { return p && a.indexOf(p) === i; });
    signed(paths).then(function () {
      imgs.forEach(function (img) {
        var p = img.getAttribute('data-path'), c = urlCache[p];
        img.setAttribute('data-done', '1');
        if (c) { img.onerror = function () { delete urlCache[p]; img.alt = 'Photo unavailable'; img.classList.add('img-missing'); }; img.src = c.url; }
        else { img.alt = 'Photo unavailable'; img.classList.add('img-missing'); }
      });
    });
  }
  if (window.MutationObserver) {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) {
        var n = list[i].addedNodes[j];
        if (n.nodeType === 1 && ((n.matches && n.matches('img[data-path]')) || (n.querySelector && n.querySelector('img[data-path]')))) { hydrate(document); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------- server rows -> the shapes the screens already use ---------- */
  function mapReport(r, priv, ex) {
    var audit = ex && ex.audit && Object.keys(ex.audit).length ? ex.audit : { state: r.audit_state || '' };
    return { id: Number(r.id), clientUuid: '', citizenId: priv ? priv.owner_id : '', isAnonymous: !!r.is_anonymous, authorLabel: r.author_label, category: r.category, title: r.title, description: r.description,
      state: r.state, district: r.district, city: r.city, pincode: r.pincode, manualLocationAddress: r.address, latitude: priv ? priv.lat : null, longitude: priv ? priv.lng : null,
      pubLat: r.pub_lat, pubLng: r.pub_lng, hasGps: !!r.has_gps, locationPrivacy: r.location_privacy || 'approximate', imageUrlProof: r.image_path || '', status: r.status, priority: r.priority,
      priorityReason: r.priority_reason, deptId: r.dept_id, slaDeadlineDays: r.sla_days, slaStart: r.sla_start ? ms(r.sla_start) : undefined, upvoteCount: r.upvote_count, flagCount: r.flag_count,
      isEscalated: !!r.is_escalated, authorityResponse: r.authority_response || '', resolutionProofUrl: r.resolution_photo || '', assignedOfficerId: r.assigned_officer || '',
      modStatus: r.mod_status, modOutcome: ex ? ex.mod_outcome : '', modReason: ex ? ex.mod_reason : '', duplicateOf: ex ? ex.duplicate_of : null, modLog: ex ? ex.mod_log || [] : [],
      reopenCount: r.reopen_count || 0, audit: audit, resolutions: ex ? ex.resolutions || [] : [], disputes: ex ? ex.disputes || [] : [], timeline: r.timeline || [],
      timestamp: ms(r.created_at), dateUpdated: ms(r.updated_at), demo: false };
  }
  function mapProfile(p) {
    return { id: p.id, role: p.role, name: p.name, email: p.email, phone: p.phone, state: p.state, district: p.district, city: p.city, pincode: p.pincode, createdAt: ms(p.created_at),
      account: { status: p.account_status, until: p.account_until ? ms(p.account_until) : null, reason: p.account_reason || '', by: '' }, modHistory: [],
      authorityRole: p.authority_role, deptId: p.dept_id || undefined, idProof: p.id_proof,
      verification: p.role === 'official' ? { status: p.verification_status, submittedAt: ms(p.verification_submitted), history: p.verification_history || [], supporting: p.verification_supporting || [], adminNote: p.verification_note || '' } : undefined };
  }
  function mapSettings(s) {
    return { reviewThreshold: s.review_threshold, flagsPerDay: s.flags_per_day, reportsPerHour: s.reports_per_hour, auditDays: s.audit_days, maxReopens: s.max_reopens,
      publicGridMeters: s.public_grid_meters, mapTiles: !!s.map_tiles, areaLevel: s.area_level, fallbackDeptId: s.fallback_dept, categoryDept: s.category_dept || {} };
  }

  /* ---------- reading everything this person may see ---------- */
  async function q(p) { var r = await p; if (r.error) throw r.error; return r.data || []; }
  async function pages(make, max) {                               // 1000 rows per request, up to `max` rows
    var out = [], page = 0, rows;
    do { rows = await q(make().range(page * PAGE, page * PAGE + PAGE - 1)); out = out.concat(rows); page++; } while (rows.length === PAGE && out.length < (max || 3000));
    return out;
  }

  async function loadAll() {
    var uid = session && session.user && session.user.id, prof = null;
    var base = await Promise.all([
      q(sb.from('departments').select('*')), q(sb.from('settings').select('*').eq('id', 1)),
      pages(function () { return sb.from('complaints').select('*').order('id', { ascending: false }); }, 3000),
      pages(function () { return sb.from('comments').select('*').order('created_at', { ascending: false }); }, 3000),
      sb.rpc('has_admin')
    ]);
    var d = S._emptyDb(false);
    d.departments = base[0].map(function (x) { return { id: x.id, name: x.name, description: x.description, active: x.active, roles: x.roles || [] }; });
    d.settings = Object.assign(d.settings, base[1][0] ? mapSettings(base[1][0]) : {});
    state.adminExists = base[4] && base[4].data === true;
    var priv = {}, extra = {}, users = [], rest = { ups: [], flags: [], notes: [], hist: [], audit: [], logs: [] };

    if (uid) {
      var me0 = await q(sb.from('profiles').select('*'));
      prof = me0.filter(function (x) { return x.id === uid; })[0] || null;
      if (prof) {
        var isAdmin = prof.role === 'admin';
        var jobs = [
          pages(function () { return sb.from('report_private').select('*').order('report_id'); }, 6000),
          pages(function () { return sb.from('report_extra').select('*').order('report_id'); }, 6000),
          q(sb.from('upvotes').select('*')), q(sb.from('flags').select('*').limit(3000)),
          q(sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(300))
        ];
        if (isAdmin) jobs.push(q(sb.from('mod_history').select('*').order('created_at', { ascending: false }).limit(5000)), q(sb.from('audit_log').select('*').order('id', { ascending: false }).limit(2000)),
          q(sb.from('system_logs').select('*').order('id', { ascending: false }).limit(300)), sb.rpc('verify_audit_chain'));
        var got = await Promise.all(jobs);
        got[0].forEach(function (x) { priv[x.report_id] = x; }); got[1].forEach(function (x) { extra[x.report_id] = x; });
        rest.ups = got[2]; rest.flags = got[3]; rest.notes = got[4];
        users = me0.map(mapProfile);
        if (isAdmin) { rest.hist = got[5]; rest.audit = got[6]; rest.logs = got[7]; state.auditCheck = got[8] && !got[8].error ? got[8].data : null; }
      }
    }

    d.complaints = base[2].map(function (r) { return mapReport(r, priv[r.id], extra[r.id]); }).sort(function (a, b) { return b.timestamp - a.timestamp; });
    d.comments = base[3].map(function (m) { return { id: String(m.id), complaintId: Number(m.report_id), authorName: m.author_name, authorRole: m.author_role, text: m.body, ts: ms(m.created_at) }; });
    var uMap = {}; users.forEach(function (u) { uMap[u.id] = u; });
    rest.hist.forEach(function (h) { var u = uMap[h.user_id]; if (u) u.modHistory.push({ id: String(h.id), type: h.type, reportId: h.report_id, reason: h.reason, by: h.by_name, days: h.days, reversed: !!h.reversed, ts: ms(h.created_at) }); });
    d.users = users;
    d.upvotes = rest.ups.map(function (x) { return { userId: x.user_id, complaintId: Number(x.report_id), ts: ms(x.created_at) }; });
    d.flags = rest.flags.map(function (x) { return { id: String(x.id), userId: x.user_id, complaintId: Number(x.report_id), reasonId: x.reason_id, note: x.note, ts: ms(x.created_at) }; });
    d.notifications = rest.notes.map(function (n) { return { id: String(n.id), userId: n.user_id, type: n.type, title: n.title, message: n.message, link: n.link, reportId: n.report_id, isRead: !!n.is_read, status: n.status, ts: ms(n.created_at) }; });
    d.audit = rest.audit.map(function (a) { return { id: String(a.id), ts: ms(a.created_at), adminId: a.admin_id, adminName: a.admin_name, action: a.action, targetType: a.target_type, targetId: a.target_id, targetLabel: a.target_label, reason: a.reason, meta: a.meta || {}, prev: a.prev_hash, hash: a.hash }; });
    d.logs = rest.logs.map(function (l) { return { id: String(l.id), ts: ms(l.created_at), level: l.level, area: l.area, message: l.message, meta: {} }; });
    d.updatedAt = Date.now(); d.rev = (db && db.rev || 0) + 1;
    db = d; host.setDb(d);
    me = prof ? uMap[prof.id] || null : null;
    state.lastOk = Date.now();
    if (me && me.account.status === 'banned') {
      state.bannedMsg = 'This account has been blocked. Reason: ' + (me.account.reason || 'policy violation') + '.';
      me = null; session = null; await sb.auth.signOut().catch(function () {});
    }
    if (!(me && me.role !== 'citizen')) saveSnapshot(d);
  }

  /* a citizen's or visitor's last view, so the app still opens without a signal. Staff data is never kept on the device. */
  function saveSnapshot(d) { try { localStorage.setItem(SNAP_KEY, JSON.stringify({ at: Date.now(), uid: me ? me.id : null, db: d })); } catch (e) { /* too big: skip */ } }
  function loadSnapshot() {
    try { var s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); if (s && s.db && (!s.uid || (session && session.user && session.user.id === s.uid))) return s; } catch (e) { /* ignore */ }
    return null;
  }

  /* ---------- refresh (never two at once; calls that arrive meanwhile are folded into one more) ---------- */
  async function refresh() {
    if (state.refreshing) { state.again = true; return; }
    state.refreshing = true;
    try {
      do { state.again = false; await loadAll(); } while (state.again);
      if (state.status === 'offline') setStatus(channel ? 'live' : 'polling');
    } catch (e) {
      if (!navigator.onLine || /fetch|network/i.test((e && e.message) || '')) setStatus('offline'); else { console.error(e); S.sysLog('error', 'cloud', 'Refresh failed: ' + (e && e.message)); }
    } finally { state.refreshing = false; }
    changed();
  }
  function changed() { if (window.DL.app && window.DL.app.softRender) window.DL.app.softRender(); }
  function soon() { clearTimeout(state.debounce); state.debounce = setTimeout(refresh, 400); }

  /* ---------- live updates ---------- */
  function setStatus(s) { if (state.status !== s) { state.status = s; if (window.DL.app && window.DL.app.paintConnection) window.DL.app.paintConnection(); } }
  function stopLive() { if (channel) { try { sb.removeChannel(channel); } catch (e) { /* ignore */ } channel = null; } clearInterval(state.pollTimer); state.pollTimer = 0; }
  function startPolling() { if (!state.pollTimer) state.pollTimer = setInterval(function () { if (navigator.onLine && !document.hidden) refresh(); }, POLL_MS); }
  function startLive() {
    stopLive();
    var uid = me && me.id;
    try {
      var ch = sb.channel('dl-live-' + (uid || 'public'));
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings' }, soon);          // "something changed": each browser reloads what IT may see
      if (uid) {
        ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + uid }, function (p) {
          var n = p && p.new; if (n && window.DL.ui) window.DL.ui.toast(n.title, 'good'); soon();
        });
      }
      ch.subscribe(function (st) {
        if (st === 'SUBSCRIBED') { clearInterval(state.pollTimer); state.pollTimer = 0; setStatus('live'); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { setStatus(navigator.onLine ? 'polling' : 'offline'); startPolling(); }
      });
      channel = ch;
    } catch (e) { setStatus('polling'); }
    startPolling();                                   // safety net until the live channel confirms; it is switched off once connected
  }
  window.addEventListener('online', function () { if (sb) { setStatus('polling'); refresh(); if (!channel) startLive(); } });
  window.addEventListener('offline', function () { if (sb) setStatus('offline'); });
  document.addEventListener('visibilitychange', function () { if (sb && !document.hidden && navigator.onLine && state.lastOk && Date.now() - state.lastOk > POLL_MS) refresh(); });

  /* ---------- start up ---------- */
  function cleanUrl() {
    if (/[?&](code|error|error_description)=/.test(location.search)) { try { history.replaceState(null, '', location.pathname + (location.hash || '#/')); } catch (e) { /* ignore */ } }
  }
  async function init(h) {
    host = h; S = h.store;
    if (!(window.supabase && window.supabase.createClient)) throw new Error('We could not load the online tools. Check your internet connection and reload the page.');
    if (sb) stopLive();
    sb = sb || window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }, realtime: { params: { eventsPerSecond: 5 } } });
    sb.auth.onAuthStateChange(function (ev, s) {
      session = s;
      if (ev === 'PASSWORD_RECOVERY') { state.recovery = true; location.hash = '#/reset'; }
      if (ev === 'SIGNED_OUT') { me = null; }
    });
    try {
      var g = await sb.auth.getSession(); session = g.data && g.data.session;
      if (session) { try { var chk = await sb.auth.getUser(); if (chk.error) { await sb.auth.signOut(); session = null; } } catch (e) { /* offline: keep going */ } }
      await loadAll();
      setStatus('polling');
      startLive();
      sweep(); cleanUrl();
    } catch (e) {
      console.error(e);
      var snap = loadSnapshot();
      if (snap) { db = snap.db; host.setDb(db); me = snap.uid ? (db.users || []).filter(function (u) { return u.id === snap.uid; })[0] || null : null; setStatus('offline'); }
      else { setStatus('offline'); throw new Error('We could not reach the server. Check your internet connection and try again.'); }
    }
  }
  function sweep() { if (me && Date.now() - state.sweptAt > 600000) { state.sweptAt = Date.now(); sb.rpc('sweep_audits').then(function (r) { if (r && r.data > 0) refresh(); }).catch(function () {}); } }

  /* ---------- accounts ---------- */
  async function register(f) {
    offlineGuard();
    var email = (f.email || '').trim().toLowerCase(), r;
    try {
      r = await sb.auth.signUp({ email: email, password: f.password, options: {
        emailRedirectTo: location.origin + location.pathname,
        data: { name: f.name, phone: f.phone || '', state: f.state, district: f.district, city: f.city, pincode: f.pincode || '', role: f.role === 'official' ? 'official' : 'citizen',
                dept_id: f.deptId || '', authority_role: f.authorityRole || '', id_proof: f.idProof || '' } } });
    } catch (e) { throw fe(e); }
    if (r.error) {
      if (/already registered|already been registered|exists/i.test(r.error.message)) throw new Error('An account with this email already exists. Try logging in.');
      if (/password/i.test(r.error.message)) throw new Error('That password is too weak. Use at least 8 characters with letters and numbers.');
      throw fe(r.error);
    }
    if (r.data && r.data.user && r.data.user.identities && r.data.user.identities.length === 0) throw new Error('An account with this email already exists. Try logging in.');
    if (!r.data.session) return { needsConfirm: true, email: email, name: f.name };
    session = r.data.session; await loadAll(); startLive(); changed();
    return me;
  }
  async function login(email, password) {
    offlineGuard();
    state.bannedMsg = '';
    var r;
    try { r = await sb.auth.signInWithPassword({ email: (email || '').trim().toLowerCase(), password: password }); } catch (e) { throw fe(e); }
    if (r.error) {
      if (/Invalid login credentials/i.test(r.error.message)) throw new Error('Wrong email or password. Check them and try again.');
      if (/Email not confirmed/i.test(r.error.message)) throw new Error('Please confirm your email first. Check your inbox for the link we sent.');
      throw fe(r.error);
    }
    session = r.data.session;
    await loadAll();
    if (!me) { throw new Error(state.bannedMsg || 'We could not open your account. Please try again.'); }
    startLive(); sweep();
    return me;
  }
  function logout() {
    me = null; session = null; stopLive();
    try { localStorage.removeItem(SNAP_KEY); } catch (e) { /* ignore */ }
    sb.auth.signOut().catch(function () {}).then(function () { return loadAll(); }).then(function () { startLive(); changed(); }).catch(function () {});
  }
  async function resetPassword(email) {
    offlineGuard();
    var r; try { r = await sb.auth.resetPasswordForEmail((email || '').trim().toLowerCase(), { redirectTo: location.origin + location.pathname }); } catch (e) { throw fe(e); }
    if (r.error) throw fe(r.error);
    return true;                                       // same answer whether or not the email exists, so nobody can probe for accounts
  }
  async function setPassword(pw) {
    offlineGuard();
    if (!pw || pw.length < 8) throw new Error('Use at least 8 characters.');
    var r; try { r = await sb.auth.updateUser({ password: pw }); } catch (e) { throw fe(e); }
    if (r.error) { if (/same password|different from the old/i.test(r.error.message)) throw new Error('Choose a password you have not used before.'); throw fe(r.error); }
    state.recovery = false;
    return true;
  }
  async function resendConfirmation(email) {
    var r = await sb.auth.resend({ type: 'signup', email: (email || '').trim().toLowerCase(), options: { emailRedirectTo: location.origin + location.pathname } });
    if (r.error) throw fe(r.error);
    return true;
  }

  /* ---------- changes: each one is a call to a database function ---------- */
  function after(fn) { return async function () { var out = await fn.apply(null, arguments); await refresh(); return out; }; }
  function rid(x) { return Number(x); }
  function get(id) { return S.getComplaint(id); }
  function digits(x) { return Number(String(x == null ? '' : x).replace(/\D/g, '')) || 0; }

  var impl = {
    createComplaint: async function (passed, f) {
      var path = await upload(f.image);
      try {
        var id = await rpc('create_report', { p: { category: f.category, title: f.title, description: f.description, state: f.state, district: f.district, city: f.city, pincode: f.pincode,
          address: f.address, lat: f.latitude, lng: f.longitude, is_anonymous: !!f.isAnonymous, image_path: path } });
        await refresh(); return get(id);
      } catch (e) { dropUpload(path); throw e; }
    },
    toggleUpvote: async function (p, id) { var r = await rpc('toggle_upvote', { rid: rid(id) }); await refresh(); return r; },
    addComment: after(function (p, id, text) { return rpc('add_comment', { rid: rid(id), txt: text }); }),
    flagComplaint: async function (p, id, reason, note) { var r = await rpc('flag_report', { rid: rid(id), reason: reason, note: note || '' }); await refresh(); return r; },
    startWork: async function (p, id) { await rpc('start_work', { rid: rid(id) }); await refresh(); return get(id); },
    resolve: async function (p, id, o) {
      var path = await upload(o && o.proof);
      try { await rpc('resolve_report', { rid: rid(id), response: (o && o.response) || '', photo: path || '' }); await refresh(); return get(id); } catch (e) { dropUpload(path); throw e; }
    },
    transfer: async function (p, id, dept, why) { await rpc('transfer_report', { rid: rid(id), to_dept: dept, why: why }); await refresh(); return get(id); },
    escalate: async function (p, id, why) { await rpc('escalate_report', { rid: rid(id), why: why }); await refresh(); return get(id); },
    confirmFix: async function (p, id, o) { await rpc('confirm_fix', { rid: rid(id), rating: Number(o && o.rating), comment: (o && o.comment) || '' }); await refresh(); return get(id); },
    disputeFix: async function (p, id, o) {
      var path = await upload(o && o.photo);
      try { await rpc('dispute_fix', { rid: rid(id), reason_id: o && o.reasonId, note: (o && o.note) || '', photo: path || '' }); await refresh(); return get(id); } catch (e) { dropUpload(path); throw e; }
    },
    keepReport: async function (id, why) { await rpc('mod_keep', { rid: rid(id), why: why }); await refresh(); return get(id); },
    markUnderReview: async function (id, why) { await rpc('mod_review', { rid: rid(id), why: why }); await refresh(); return get(id); },
    rejectReport: async function (id, outcome, why) { await rpc('mod_reject', { rid: rid(id), outcome: outcome, why: why }); await refresh(); return get(id); },
    markDuplicate: async function (id, original, why) { await rpc('mod_duplicate', { rid: rid(id), original: digits(original), why: why }); await refresh(); return get(id); },
    archiveReport: async function (id, why) { await rpc('mod_archive', { rid: rid(id), why: why }); await refresh(); return get(id); },
    restoreReport: async function (id, why) { await rpc('mod_restore', { rid: rid(id), why: why }); await refresh(); return get(id); },
    setLocationPrivacy: async function (id, level, why) { await rpc('set_location_privacy', { rid: rid(id), lvl: level, why: why }); await refresh(); return get(id); },
    warnUser: after(function (id, why) { return rpc('admin_warn', { uid: id, why: why }); }),
    suspendUser: after(function (id, days, why) { return rpc('admin_suspend', { uid: id, days: Number(days), why: why }); }),
    banUser: after(function (id, why, word) { return rpc('admin_ban', { uid: id, why: why, confirm_word: word }); }),
    reinstateUser: after(function (id, why) { return rpc('admin_reinstate', { uid: id, why: why }); }),
    approveAuthority: after(function (id, note) { return rpc('auth_approve', { uid: id, note: note || 'ID checked' }); }),
    rejectAuthority: after(function (id, why) { return rpc('auth_reject', { uid: id, why: why }); }),
    requestInfo: after(function (id, msg) { return rpc('auth_request_info', { uid: id, msg: msg }); }),
    suspendAuthority: after(function (id, why) { return rpc('auth_suspend', { uid: id, why: why }); }),
    reinstateAuthority: after(function (id, why) { return rpc('auth_reinstate', { uid: id, why: why }); }),
    submitVerificationInfo: after(function (p, text) { return rpc('submit_verification_info', { txt: text }); }),
    saveDepartment: async function (f) {
      var id = await rpc('save_department', { p: { id: f.id || null, name: f.name, description: f.description || '', active: f.active !== false, roles: f.roles || [], reason: f.reason || '' } });
      await refresh(); return S.departments().filter(function (d) { return d.id === id; })[0];
    },
    setCategoryDept: after(function (cat, dept) { return rpc('set_category_dept', { cat: cat, dept: dept }); }),
    saveSettings: after(function (f) {
      var map = { reviewThreshold: 'review_threshold', flagsPerDay: 'flags_per_day', reportsPerHour: 'reports_per_hour', auditDays: 'audit_days', maxReopens: 'max_reopens', publicGridMeters: 'public_grid_meters', mapTiles: 'map_tiles', areaLevel: 'area_level' }, p = {};
      Object.keys(map).forEach(function (k) { if (f[k] !== undefined && f[k] !== null && f[k] !== '') p[map[k]] = (k === 'mapTiles') ? !!f[k] : (k === 'areaLevel' ? f[k] : Number(f[k])); });
      return rpc('save_settings', { p: p });
    }),
    updateProfile: after(function (f) { return rpc('update_my_profile', { p: f }); }),
    markAllRead: function () {
      (db.notifications || []).forEach(function (n) { n.isRead = true; });
      return rpc('mark_notifications_read', { ids: null }).catch(function () {});
    },
    markRead: function (uid, id) {
      (db.notifications || []).forEach(function (n) { if (n.id === id) n.isRead = true; });
      return rpc('mark_notifications_read', { ids: [String(id)] }).catch(function () {});
    },
    sysLog: function (level, area, msg) { if (sb && me && state.status !== 'offline') sb.rpc('log_system', { lvl: level, area: area, msg: String(msg).slice(0, 300) }).then(function () {}, function () {}); }
  };

  window.DL = window.DL || {};
  window.DL.cloud = {
    enabled: enabled, init: init, impl: impl, refresh: refresh, user: function () { return me; }, status: function () { return state.status; }, hasAdmin: function () { return state.adminExists; },
    auditStatus: function () { return state.auditCheck ? { ok: !!state.auditCheck.ok, count: state.auditCheck.count, brokenAt: state.auditCheck.brokenAt } : { ok: true, count: 0 }; },
    register: register, login: login, logout: logout, resetPassword: resetPassword, setPassword: setPassword, resendConfirmation: resendConfirmation,
    inRecovery: function () { return !!state.recovery; }, bannedMessage: function () { return state.bannedMsg; }, lastSync: function () { return state.lastOk; }, hydrate: hydrate
  };
})();
