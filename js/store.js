/* Disaster Lens – data and rules layer (Phase 4)
 *
 * This file plays the part of the "server". Every rule lives here and every
 * privileged function checks who is calling (from the session, never from what
 * the page passes in) before it does anything. The pages only show things.
 *
 * HONEST LIMIT: for now this runs inside the browser and stores data in
 * localStorage, so a person who opens the developer tools on their OWN device can
 * still edit their OWN copy of the data. These checks stop normal use and mistakes,
 * and they are written so they can move to a real server unchanged (Phase 6).
 * There are no API keys or secrets anywhere in this code.
 *
 * Two completely separate databases exist:
 *   real  -> dl_real_v2  (starts EMPTY; the first admin is created on a setup screen)
 *   demo  -> dl_demo_v2  (sample data, only ever visible in Demo mode)
 */
(function () {
  var G = window.DL.geo;
  var DAY = 86400000;
  var MODE_KEY = 'dl_mode';
  var OLD_KEY = 'dl_db_v1';

  /* ---------- fixed lists ---------- */
  var CATS = [
    { id: 'road',     name: 'Roads & potholes',           dept: 'works',       sla: 7 },
    { id: 'water',    name: 'Water & drainage',           dept: 'water',       sla: 5 },
    { id: 'power',    name: 'Electricity & live wires',   dept: 'electricity', sla: 2 },
    { id: 'waste',    name: 'Waste & sanitation',         dept: 'sanitation',  sla: 5 },
    { id: 'flood',    name: 'Flood & waterlogging',       dept: 'disaster',    sla: 1 },
    { id: 'fire',     name: 'Fire & safety',              dept: 'fire',        sla: 1 },
    { id: 'building', name: 'Building damage & collapse', dept: 'housing',     sla: 2 },
    { id: 'health',   name: 'Health & medical',           dept: 'health',      sla: 2 },
    { id: 'other',    name: 'Something else',             dept: 'municipal',   sla: 7 }
  ];
  var STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala',
    'Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
    'Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi',
    'Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'];
  var STATUSES = ['Submitted', 'In progress', 'Resolved', 'Reopened'];
  var FLAG_REASONS = [
    { id: 'false_info', label: 'False information' }, { id: 'duplicate', label: 'Duplicate report' }, { id: 'spam', label: 'Spam' },
    { id: 'wrong_location', label: 'Wrong location' }, { id: 'offensive', label: 'Offensive content' }, { id: 'misleading_photo', label: 'Misleading photo' },
    { id: 'not_civic', label: 'Not a civic issue' }, { id: 'other', label: 'Other' }
  ];
  var DISPUTE_REASONS = [
    { id: 'still_there', label: 'The problem is still there' }, { id: 'incomplete', label: 'The work is not finished' },
    { id: 'wrong_place', label: 'The wrong place was fixed' }, { id: 'other', label: 'Something else' }
  ];
  var REJECT_OUTCOMES = [
    { id: 'fake', label: 'Fake report' }, { id: 'spam', label: 'Spam' }, { id: 'not_civic', label: 'Not a civic issue' }, { id: 'other', label: 'Other reason' }
  ];
  var MOD_LABELS = { normal: 'Normal', flagged: 'Flagged', under_review: 'Under review', verified: 'Cleared', rejected: 'Rejected', archived: 'Archived' };

  /* Who may do what. A role is just a list of permissions, so new roles can be added here. */
  var ROLE_PERMS = {
    citizen:  ['report.create', 'report.comment', 'report.vote', 'report.flag', 'report.audit'],
    official: ['report.comment', 'desk.use', 'report.work', 'map.work'],
    admin:    ['report.comment', 'desk.use', 'report.work', 'admin.access', 'admin.reports', 'admin.moderate', 'admin.users', 'admin.authorities',
               'admin.departments', 'admin.logs', 'admin.settings', 'admin.search', 'map.work', 'admin.analytics']
  };
  var ROLE_LABELS = { citizen: 'Citizen', official: 'Official', admin: 'Admin' };
  var SUSPEND_BLOCKS = ['report.create', 'report.comment', 'report.vote', 'report.flag'];

  var URGENT_WORDS = ['accident','bleeding','collapse','collapsing','collapsed','critical','dead','death','die','drowning','electrocution','electrocuted','emergency',
    'explosion','fatal','fire','flooding','flooded','gas leak','hazard','hospitalized','landslide','life threat','live wire','medical','poison','short circuit','sinkhole',
    'trapped','wound','injured','sparking','earthquake','cyclone'];

  function defaultDepartments() {
    var d = [['municipal', 'Municipal Office', 'General civic problems and anything that fits nowhere else.'],
      ['works', 'Public Works Department', 'Roads, bridges, footpaths and public buildings.'],
      ['water', 'Water & Sewerage Board', 'Drinking water, drains and sewers.'],
      ['electricity', 'Electricity Board', 'Street lights, poles and live wires.'],
      ['sanitation', 'Municipal Sanitation', 'Garbage collection and cleanliness.'],
      ['disaster', 'Disaster Management Cell', 'Floods, waterlogging and emergencies.'],
      ['fire', 'Fire Services', 'Fire and safety hazards.'],
      ['housing', 'Building & Housing', 'Damaged and unsafe buildings.'],
      ['health', 'Health Department', 'Health centres and medical supplies.'],
      ['police', 'Police', 'Cases that need the police.']];
    return d.map(function (x) { return { id: x[0], name: x[1], description: x[2], active: true, roles: [] }; });
  }
  function defaultSettings() { return { reviewThreshold: 5, flagsPerDay: 5, reportsPerHour: 5, auditDays: 7, maxReopens: 2, publicGridMeters: 500, mapTiles: false, areaLevel: 'city', fallbackDeptId: 'municipal', categoryDept: {} }; }
  function emptyDb(isDemo) {
    return { v: 2, isDemo: !!isDemo, users: [], complaints: [], comments: [], upvotes: [], flags: [], notifications: [], logs: [], audit: [],
      departments: defaultDepartments(), settings: defaultSettings(), loginFails: {}, seq: 0 };
  }

  var db = null;
  var REMOTE = null;   // the shared online backend (js/remote.js) when it is configured; null = everything stays in this browser
  var subtle = (window.crypto && window.crypto.subtle) || null;

  /* ---------- helpers ---------- */
  function E(msg) { return new Error(msg); }
  function now() { return Date.now(); }
  function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9) + now().toString(36).slice(-4); }
  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

  function hash(pw, salt) {
    var text = salt + '::' + pw;
    if (subtle && window.TextEncoder) {
      return subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    var h = 5381;
    for (var i = 0; i < text.length; i++) { h = ((h << 5) + h + text.charCodeAt(i)) | 0; }
    return Promise.resolve('x' + (h >>> 0).toString(16));
  }
  /* small fast hash used to chain audit entries together (tamper-evident, not secret) */
  function chainHash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for (var i = 0; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  /* ---------- which database is active ---------- */
  function mode() { return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real'; }
  function dbKey() { return mode() === 'demo' ? 'dl_demo_v2' : 'dl_real_v2'; }
  function sKey() { return mode() === 'demo' ? 'dl_session_demo' : 'dl_session_real'; }
  function isDemo() { return mode() === 'demo'; }

  function save() {
    if (REMOTE) { db.updatedAt = now(); db.rev = (db.rev || 0) + 1; return true; }   // online: the database is the source of truth, nothing is kept on this device
    try { db.updatedAt = now(); db.rev = (db.rev || 0) + 1; localStorage.setItem(dbKey(), JSON.stringify(db)); return true; } catch (e) { return false; } }

  function deptName(id) { var d = dept(id); return d ? d.name : 'Unknown department'; }
  function dept(id) { for (var i = 0; i < db.departments.length; i++) if (db.departments[i].id === id) return db.departments[i]; return null; }

  /* give records a read-only "department name" so pages never need an id lookup */
  function H(c) {
    if (c && !has(c, 'assignedDepartment')) Object.defineProperty(c, 'assignedDepartment', { get: function () { return deptName(c.deptId); }, enumerable: false, configurable: true });
    return c;
  }
  function HU(u) {
    if (u && !has(u, 'department')) Object.defineProperty(u, 'department', { get: function () { return u.deptId ? deptName(u.deptId) : ''; }, enumerable: false, configurable: true });
    return u;
  }
  function hydrateAll() { db.complaints.forEach(H); db.users.forEach(HU); }

  /* run a change that carries a big photo; undo everything if the device is full */
  function tx(fn) {
    var snap = JSON.stringify(db), out;
    try {
      out = fn();
      if (!save()) throw E('This device has no storage left for that photo. Use a smaller photo.');
      return out;
    } catch (e) { db = JSON.parse(snap); hydrateAll(); throw e; }
  }

  /* ---------- logs ---------- */
  function sysLog(level, area, message, meta) {
    if (!db) return;
    if (REMOTE) { REMOTE.log(level, area, message); return; }
    db.logs.unshift({ id: uid('s'), ts: now(), level: level, area: area, message: String(message).slice(0, 300), meta: meta || {} });
    if (db.logs.length > 500) db.logs.length = 500;
    save();
  }

  /* append-only list of what administrators did; each entry carries the hash of the one before it */
  function audit(action, targetType, targetId, targetLabel, reason, meta, who) {
    var a = who || sessionUser();
    var prev = db.audit.length ? db.audit[0].hash : 'genesis';
    var e = { id: uid('a'), ts: now(), adminId: a ? a.id : '', adminName: a ? a.name : 'System', action: action, targetType: targetType, targetId: String(targetId || ''),
      targetLabel: targetLabel || '', reason: reason || '', meta: meta || {}, prev: prev };
    e.hash = chainHash(prev + '|' + JSON.stringify([e.ts, e.adminId, e.action, e.targetType, e.targetId, e.reason, e.meta]));
    db.audit.unshift(e);
    return e;
  }
  function auditVerify() {
    need('admin.logs');
    if (REMOTE) return REMOTE.auditCheck();
    var prev = 'genesis';
    for (var i = db.audit.length - 1; i >= 0; i--) {
      var e = db.audit[i];
      var h = chainHash(prev + '|' + JSON.stringify([e.ts, e.adminId, e.action, e.targetType, e.targetId, e.reason, e.meta]));
      if (e.prev !== prev || e.hash !== h) return { ok: false, brokenAt: e.id, count: db.audit.length };
      prev = e.hash;
    }
    return { ok: true, count: db.audit.length };
  }

  function notify(userId, type, title, message, link, reportId) {
    if (!userId) return;
    db.notifications.unshift({ id: uid('n'), userId: userId, type: type, title: title, message: message, link: link || '', reportId: reportId || null, isRead: false, status: 'delivered', ts: now() });
    if (db.notifications.length > 1000) db.notifications.length = 1000;
  }
  function notifyAdmins(type, title, message, link, reportId) {
    db.users.forEach(function (u) { if (u.role === 'admin') notify(u.id, type, title, message, link, reportId); });
  }
  function notifyDept(deptId, type, title, message, link, reportId) {
    db.users.forEach(function (u) { if (isApproved(u) && u.role === 'official' && u.deptId === deptId && account(u).status !== 'banned') notify(u.id, type, title, message, link, reportId); });
  }

  /* ---------- users, sessions, permissions ---------- */
  function findUser(id) { for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i]; return null; }

  function account(u) {
    if (!u.account) u.account = { status: 'active', until: null, reason: '', by: '' };
    if (u.account.status === 'suspended' && u.account.until && now() > u.account.until) { u.account = { status: 'active', until: null, reason: '', by: '' }; save(); }
    return u.account;
  }
  function isApproved(u) { return !!u && u.role === 'official' && !!u.verification && u.verification.status === 'approved'; }

  function sessionUser() {
    if (!db) return null;
    var id = localStorage.getItem(sKey());
    if (!id) return null;
    var u = findUser(id);
    if (!u || account(u).status === 'banned') { localStorage.removeItem(sKey()); return null; }
    return u;
  }
  function me() { return sessionUser(); }

  function can(u, perm) {
    if (!u) return false;
    if ((ROLE_PERMS[u.role] || []).indexOf(perm) < 0) return false;
    var acc = account(u);
    if (acc.status === 'banned') return false;
    if (acc.status === 'suspended' && SUSPEND_BLOCKS.indexOf(perm) >= 0) return false;
    if (u.role === 'official' && !isApproved(u)) return false;
    return true;
  }
  function denyReason(u, perm) {
    if (!u) return 'Please log in first.';
    var acc = account(u);
    if (acc.status === 'suspended' && SUSPEND_BLOCKS.indexOf(perm) >= 0) return 'Your account is suspended until ' + fmtDate(acc.until) + '. You cannot do this right now.';
    if (u.role === 'official' && !isApproved(u)) return 'Your official access is not approved yet.';
    return 'You do not have permission to do this.';
  }
  /* the one gate every privileged function goes through */
  function need(perm, passed) {
    var u = sessionUser();
    if (!u) throw E('Please log in first.');
    if (passed && passed.id && passed.id !== u.id) throw E('Your session changed. Please log in again.');
    if (!can(u, perm)) throw E(denyReason(u, perm));
    return u;
  }

  /* ---------- departments and categories ---------- */
  function departments() { return db.departments.map(function (d) { return { id: d.id, name: d.name, description: d.description, active: d.active, roles: d.roles.slice() }; }); }
  function activeDepts() { return departments().filter(function (d) { return d.active; }); }
  function deptForCategory(catId) {
    var base = null; CATS.forEach(function (c) { if (c.id === catId) base = c.dept; });
    var id = (db.settings.categoryDept || {})[catId] || base || db.settings.fallbackDeptId;
    var d = dept(id);
    return d && d.active ? id : db.settings.fallbackDeptId;
  }
  function cat(id) {
    var c = CATS.filter(function (x) { return x.id === id; })[0] || CATS[CATS.length - 1];
    var did = db ? deptForCategory(c.id) : c.dept;
    return { id: c.id, name: c.name, sla: c.sla, deptId: did, dept: db ? deptName(did) : '' };
  }

  /* ---------- priority (plain keyword rule, no AI) ---------- */
  function detectPriority(title, description, category) {
    var text = (' ' + title + ' ' + description + ' ').toLowerCase();
    for (var i = 0; i < URGENT_WORDS.length; i++) if (text.indexOf(URGENT_WORDS[i]) !== -1) return { priority: 'Urgent', reason: 'Mentions "' + URGENT_WORDS[i] + '"' };
    if (category === 'fire' || category === 'flood') return { priority: 'Urgent', reason: 'Category is ' + lcCat(category) };
    return { priority: 'Routine', reason: 'No emergency words found' };
  }
  function lcCat(id) { return CATS.filter(function (c) { return c.id === id; })[0].name.toLowerCase(); }

  /* ---------- moderation state helpers ---------- */
  function modOf(c) { return c.modStatus || 'normal'; }
  /* "active" = part of normal life: shown publicly, in official workload and in every statistic */
  function isActive(c) { var m = modOf(c); return m === 'normal' || m === 'flagged' || m === 'verified'; }
  function isOpen(c) { return c.status !== 'Resolved' && c.status !== 'Closed'; }
  function slaFrom(c) { return c.slaStart || c.timestamp; }
  function isLate(c) { return isActive(c) && isOpen(c) && now() > slaFrom(c) + c.slaDeadlineDays * 86400000; }
  function canView(u, c) { return !!c && (isActive(c) || (!!u && (u.id === c.citizenId || u.role === 'admin'))); }
  function canManage(u, c) {
    if (!u || !c || !isActive(c)) return false;
    if (u.role === 'admin') return can(u, 'report.work');
    return u.role === 'official' && can(u, 'report.work') && u.deptId === c.deptId;
  }

  /* ---------- trust (every point is explained; only confirmed outcomes count) ---------- */
  function trustFor(userId) {
    var u = findUser(userId);
    if (!u) return null;
    var hist = (u.modHistory || []).filter(function (h) { return !h.reversed; });
    var count = function (t) { return hist.filter(function (h) { return h.type === t; }).length; };
    var resolved = db.complaints.filter(function (c) { return c.citizenId === userId && isActive(c) && !isOpen(c); }).length;
    var factors = [{ label: 'Starting score', points: 80 }];
    var plus = Math.min(10, resolved);
    if (plus) factors.push({ label: resolved + ' resolved report' + (resolved === 1 ? '' : 's') + ' (+1 each, up to +10)', points: plus });
    var cleared = Math.min(3, count('cleared'));
    if (cleared) factors.push({ label: cleared + ' report' + (cleared === 1 ? '' : 's') + ' checked and cleared by an admin (+2 each, up to +6)', points: cleared * 2 });
    if (count('fake')) factors.push({ label: count('fake') + ' confirmed fake report' + (count('fake') === 1 ? '' : 's') + ' (-20 each)', points: -20 * count('fake') });
    if (count('spam')) factors.push({ label: count('spam') + ' confirmed spam report' + (count('spam') === 1 ? '' : 's') + ' (-15 each)', points: -15 * count('spam') });
    var extraDup = Math.max(0, count('duplicate') - 2);
    if (extraDup) factors.push({ label: count('duplicate') + ' duplicate reports (first 2 are free, -3 for each after)', points: -3 * extraDup });
    var score = factors.reduce(function (s, f) { return s + f.points; }, 0);
    score = Math.max(0, Math.min(100, score));
    var acc = account(u);
    var status = acc.status === 'banned' ? 'Banned' : (score >= 70 ? 'Good standing' : (score >= 40 ? 'Needs watching' : 'Low trust'));
    return {
      score: score, status: status, factors: factors,
      counts: { fake: count('fake'), spam: count('spam'), duplicate: count('duplicate'), warnings: count('warning'), suspensions: count('suspension'), bans: count('ban'), cleared: count('cleared'), resolved: resolved,
        reports: db.complaints.filter(function (c) { return c.citizenId === userId; }).length }
    };
  }
  function addHistory(u, entry) { u.modHistory = u.modHistory || []; entry.id = uid('h'); entry.ts = now(); u.modHistory.unshift(entry); }

  /* ---------- start up ---------- */
  function migrateV1(old) {
    var map = { 'Public Works Department': 'works', 'Water & Sewerage Board': 'water', 'Electricity Board': 'electricity', 'Municipal Sanitation': 'sanitation',
      'Disaster Management Cell': 'disaster', 'Fire Services': 'fire', 'Building & Housing': 'housing', 'Health Department': 'health', 'Municipal Office': 'municipal' };
    var d = emptyDb(true);
    d.seq = old.seq || 200;
    d.users = (old.users || []).map(function (u) {
      var o = (u.role === 'authority');
      var n = { id: u.id, role: o ? 'official' : u.role, name: u.name, email: u.email, phone: u.phone || '', passwordHash: u.passwordHash, salt: u.salt, state: u.state, district: u.district, city: u.city,
        pincode: u.pincode || '', createdAt: now(), account: { status: u.isBanned ? 'banned' : 'active', until: null, reason: '', by: '' }, modHistory: [], demo: true };
      if (o) { n.authorityRole = u.authorityRole || ''; n.deptId = map[u.department] || 'municipal'; n.idProof = u.idProof || '';
        n.verification = { status: u.isVerified ? 'approved' : 'pending', submittedAt: now(), history: [], supporting: [] }; }
      return n;
    });
    d.complaints = (old.complaints || []).map(function (c) {
      var r = JSON.parse(JSON.stringify(c));
      r.deptId = map[c.assignedDepartment] || 'municipal'; delete r.assignedDepartment;
      r.modStatus = (c.isHidden || c.status === 'Under review') ? 'under_review' : 'normal';
      if (r.status === 'Under review') r.status = 'Submitted';
      delete r.isHidden; r.modLog = []; r.demo = true;
      return r;
    });
    d.comments = old.comments || []; d.upvotes = old.upvotes || []; d.flags = (old.flags || []).map(function (f) { f.reasonId = 'other'; return f; });
    d.notifications = (old.notifications || []).map(function (n) { n.type = 'general'; n.status = 'delivered'; n.reportId = null; return n; });
    return d;
  }

  /* the online backend hands over a fresh snapshot; this replaces the in-memory copy the screens read from */
  function adopt(snap) {
    snap.loginFails = {}; snap.v = 2; snap.isDemo = false;
    ['users', 'complaints', 'comments', 'upvotes', 'flags', 'notifications', 'audit', 'logs', 'departments'].forEach(function (k) { snap[k] = snap[k] || []; });
    snap.settings = Object.assign(defaultSettings(), snap.settings || {});
    db = snap; hydrateAll();
    if (snap.me) localStorage.setItem(sKey(), snap.me); else localStorage.removeItem(sKey());
    mapCache = { key: '', val: null };
  }

  function init() {
    if (mode() === 'real' && window.DL.remote && window.DL.remote.enabled) { REMOTE = window.DL.remote; return REMOTE.boot(adopt); }
    REMOTE = null;
    // Anything created by older test builds is kept, but only inside Demo mode, never in the real database.
    var oldRaw = localStorage.getItem(OLD_KEY);
    if (oldRaw && !localStorage.getItem('dl_demo_v2')) {
      try { localStorage.setItem('dl_demo_v2', JSON.stringify(migrateV1(JSON.parse(oldRaw)))); localStorage.removeItem(OLD_KEY); localStorage.removeItem('dl_session_v1'); } catch (e) { /* leave old data alone */ }
    }
    var raw = localStorage.getItem(dbKey());
    if (raw) { try { db = JSON.parse(raw); } catch (e) { db = null; } }
    if (db && db.v === 2) { db.settings = Object.assign(defaultSettings(), db.settings || {}); hydrateAll(); if (sweepAudits()) save(); return Promise.resolve(); }
    if (mode() === 'demo') return seedDemo();
    db = emptyDb(false); save(); return Promise.resolve();
  }

  function helpers() { return { hash: hash, now: now, uid: uid, emptyDb: emptyDb, detectPriority: detectPriority, urgentWords: URGENT_WORDS }; }
  function seedDemo() {
    if (!window.DL.demoSeed) return Promise.reject(E('Demo data is not available in this build.'));
    return window.DL.demoSeed(helpers()).then(function (d) { db = d; hydrateAll(); save(); });
  }
  function startDemo() { localStorage.setItem(MODE_KEY, 'demo'); db = null; REMOTE = null; return init(); }
  function exitDemo() { localStorage.setItem(MODE_KEY, 'real'); localStorage.removeItem('dl_session_demo'); db = null; return init(); }
  function resetDemo() {
    if (mode() !== 'demo') return Promise.reject(E('Only Demo mode can be reset.'));
    localStorage.removeItem('dl_demo_v2'); localStorage.removeItem('dl_session_demo'); db = null; return init();
  }
  function hasAdmin() { if (REMOTE) return !!db.hasAdmin; return db.users.some(function (u) { return u.role === 'admin'; }); }

  /* ---------- sign up, log in ---------- */
  function newUser(f, role) {
    return { id: uid('u'), role: role, name: f.name.trim(), email: f.email.trim().toLowerCase(), phone: (f.phone || '').trim(), state: f.state, district: (f.district || '').trim(),
      city: (f.city || '').trim(), pincode: (f.pincode || '').trim(), createdAt: now(), account: { status: 'active', until: null, reason: '', by: '' }, modHistory: [] };
  }

  function setupAdmin(f) {
    if (REMOTE) return REMOTE.auth.setupAdmin(f);
    if (hasAdmin()) return Promise.reject(E('An administrator already exists.'));
    if (mode() === 'demo') return Promise.reject(E('Demo mode already has a demo admin.'));
    if (!f.password || f.password.length < 10) return Promise.reject(E('Use a password of at least 10 characters for the administrator.'));
    var email = (f.email || '').trim().toLowerCase();
    if (db.users.some(function (u) { return u.email === email; })) return Promise.reject(E('That email already has an account. Use a different email for the administrator.'));
    var salt = uid('s');
    return hash(f.password, salt).then(function (ph) {
      var u = newUser({ name: f.name, email: email, state: f.state || '', district: f.district || '', city: f.city || '' }, 'admin');
      u.passwordHash = ph; u.salt = salt; HU(u);
      db.users.push(u);
      audit('setup.admin_created', 'user', u.id, u.name, 'First administrator created on the setup screen', {}, u);
      save(); localStorage.setItem(sKey(), u.id);
      return u;
    });
  }

  function register(f) {
    if (REMOTE) return REMOTE.auth.register(f);
    var email = (f.email || '').trim().toLowerCase();
    if (db.users.some(function (u) { return u.email === email; })) return Promise.reject(E('An account with this email already exists. Try logging in.'));
    var isOff = f.role === 'official';
    if (isOff && activeDepts().every(function (d) { return d.id !== f.deptId; })) return Promise.reject(E('Choose a department.'));
    var salt = uid('s');
    return hash(f.password, salt).then(function (ph) {
      var u = newUser(f, isOff ? 'official' : 'citizen');
      u.passwordHash = ph; u.salt = salt;
      if (isOff) {
        u.authorityRole = (f.authorityRole || '').trim(); u.deptId = f.deptId; u.idProof = (f.idProof || '').trim();
        u.verification = { status: 'pending', submittedAt: now(), history: [{ ts: now(), status: 'pending', by: 'applicant', note: 'Application sent' }], supporting: [], adminNote: '' };
      }
      HU(u); db.users.push(u);
      if (isOff) notifyAdmins('verification', 'Official ID to check', u.name + ' asked for official access.', '#/admin/authorities/' + u.id);
      save();
      localStorage.setItem(sKey(), u.id); // officials can log in to follow their application; they cannot do official work until approved
      return u;
    });
  }

  function login(email, password) {
    if (REMOTE) return REMOTE.auth.login(email, password);
    email = (email || '').trim().toLowerCase();
    var fails = (db.loginFails[email] || []).filter(function (t) { return now() - t < 10 * 60000; });
    if (fails.length >= 5) { sysLog('warn', 'auth', 'Login locked for ' + email + ' after repeated failures'); return Promise.reject(E('Too many wrong attempts. Please wait 10 minutes and try again.')); }
    var u = db.users.filter(function (x) { return x.email === email; })[0];
    function failed(msg) { fails.push(now()); db.loginFails[email] = fails; save(); throw E(msg); }
    if (!u) return Promise.resolve().then(function () { failed('No account found with this email.'); });
    return hash(password, u.salt).then(function (ph) {
      if (ph !== u.passwordHash) failed('Wrong password. Check it and try again.');
      var acc = account(u);
      if (acc.status === 'banned') throw E('This account has been blocked. Reason: ' + (acc.reason || 'policy violation') + '.');
      delete db.loginFails[email];
      localStorage.setItem(sKey(), u.id); save();
      return u;
    });
  }
  function logout() { localStorage.removeItem(sKey()); if (REMOTE) REMOTE.auth.logout(); }

  /* ---------- reports ---------- */
  function authorName(c) {
    if (c.isAnonymous) return 'Anonymous citizen';
    var u = findUser(c.citizenId);
    return u ? u.name : 'Citizen';
  }

  function createComplaint(passed, f) {
    var u = need('report.create', passed);
    var hourAgo = now() - 3600000;
    var recent = db.complaints.filter(function (c) { return c.citizenId === u.id && c.timestamp > hourAgo; }).length;
    if (recent >= db.settings.reportsPerHour) throw E('You have sent ' + recent + ' reports in the last hour. Please wait a little before sending another.');
    var p = detectPriority(f.title, f.description, f.category);
    var ci = cat(f.category), t = now();
    var gpsOk = f.latitude != null && f.longitude != null && G.valid(f.latitude, f.longitude);
    if (!gpsOk && (f.latitude != null || f.longitude != null)) sysLog('warn', 'report', 'Ignored GPS coordinates that were not valid');
    return tx(function () {
      var item = H({
        id: ++db.seq, clientUuid: uid('c'), citizenId: u.id, isAnonymous: !!f.isAnonymous, category: f.category,
        title: f.title.trim(), description: f.description.trim(), state: f.state, district: (f.district || '').trim(), city: (f.city || '').trim(), pincode: (f.pincode || '').trim(),
        manualLocationAddress: (f.address || '').trim(), latitude: gpsOk ? Number(f.latitude) : null, longitude: gpsOk ? Number(f.longitude) : null, locationPrivacy: 'approximate',
        imageUrlProof: f.image || '', status: 'Submitted', priority: p.priority, priorityReason: p.reason, deptId: ci.deptId,
        slaDeadlineDays: p.priority === 'Urgent' ? 1 : ci.sla, upvoteCount: 0, flagCount: 0, isEscalated: false, authorityResponse: '', resolutionProofUrl: '',
        assignedOfficerId: '', modStatus: 'normal', modOutcome: '', modReason: '', duplicateOf: null, modLog: [],
        timestamp: t, dateUpdated: t, timeline: [{ ts: t, label: 'Report submitted' }]
      });
      db.complaints.unshift(item);
      notify(u.id, 'received', 'Report received', 'We sent "' + item.title + '" to the ' + ci.dept + '.', '#/c/' + item.id, item.id);
      notifyDept(ci.deptId, 'new_report', p.priority === 'Urgent' ? 'New urgent report' : 'New report for your department', '"' + item.title + '" in ' + (item.city || item.state) + '.', '#/c/' + item.id, item.id);
      return item;
    });
  }

  function getComplaint(id) {
    id = Number(id);
    for (var i = 0; i < db.complaints.length; i++) if (db.complaints[i].id === id) return H(db.complaints[i]);
    return null;
  }

  function list(o) {
    o = o || {};
    var q = lc(o.q);
    var out = db.complaints.filter(function (c) {
      if (o.userId) { if (c.citizenId !== o.userId) return false; } else if (!isActive(c)) return false;
      if (o.status && o.status !== 'all' && !(c.status === o.status || (o.status === 'Resolved' && c.status === 'Closed'))) return false;
      if (o.category && o.category !== 'all' && c.category !== o.category) return false;
      if (o.priority && o.priority !== 'all' && c.priority !== o.priority) return false;
      if (q && lc(c.title + ' ' + c.description + ' ' + c.city + ' ' + c.district + ' ' + c.manualLocationAddress + ' DL-' + c.id).indexOf(q) === -1) return false;
      return true;
    }).map(H);
    var sort = o.sort || 'new';
    out.sort(function (a, b) {
      if (sort === 'votes') return b.upvoteCount - a.upvoteCount || b.timestamp - a.timestamp;
      if (sort === 'urgent') return (b.priority === 'Urgent') - (a.priority === 'Urgent') || b.timestamp - a.timestamp;
      return b.timestamp - a.timestamp;
    });
    return out;
  }

  function stats() {
    var vis = db.complaints.filter(isActive);
    return { total: vis.length, open: vis.filter(isOpen).length, resolved: vis.filter(function (c) { return !isOpen(c); }).length,
      urgent: vis.filter(function (c) { return c.priority === 'Urgent' && isOpen(c); }).length };
  }

  /* ---------- votes, comments, flags ---------- */
  function hasUpvoted(userId, cid) { return db.upvotes.some(function (v) { return v.userId === userId && v.complaintId === cid; }); }
  function toggleUpvote(passed, cid) {
    var u = need('report.vote', passed), c = getComplaint(cid);
    if (!c || !isActive(c)) return null;
    var i = -1;
    db.upvotes.forEach(function (v, k) { if (v.userId === u.id && v.complaintId === c.id) i = k; });
    if (i >= 0) { db.upvotes.splice(i, 1); c.upvoteCount = Math.max(0, c.upvoteCount - 1); } else { db.upvotes.push({ userId: u.id, complaintId: c.id, ts: now() }); c.upvoteCount++; }
    save();
    return { voted: i < 0, count: c.upvoteCount };
  }
  function commentsFor(cid) { return db.comments.filter(function (m) { return m.complaintId === Number(cid); }).sort(function (a, b) { return a.ts - b.ts; }); }
  function addComment(passed, cid, text) {
    var u = need('report.comment', passed), c = getComplaint(cid);
    text = (text || '').trim();
    if (!c || !text) return null;
    if (!canView(u, c)) throw E('This report is not available.');
    var m = { id: uid('m'), complaintId: c.id, authorName: u.name, authorRole: u.role, text: text.slice(0, 600), ts: now() };
    db.comments.push(m);
    if (c.citizenId !== u.id) notify(c.citizenId, 'comment', 'New comment on your report', u.name + ' commented on "' + c.title + '".', '#/c/' + c.id, c.id);
    save();
    return m;
  }

  function hasFlagged(userId, cid) { return db.flags.some(function (f) { return f.userId === userId && f.complaintId === cid; }); }
  /* A flag is only a request for a human to look. It never decides anything by itself. */
  function flagComplaint(passed, cid, reasonId, note) {
    var u = need('report.flag', passed), c = getComplaint(cid);
    if (!c) throw E('Report not found.');
    if (!isActive(c)) throw E('This report is already being handled by an admin.');
    if (c.citizenId === u.id) throw E('You cannot flag your own report.');
    if (modOf(c) === 'verified') throw E('An admin has already checked this report and found no problem.');
    if (hasFlagged(u.id, c.id)) throw E('You already flagged this report.');
    var reason = FLAG_REASONS.filter(function (r) { return r.id === reasonId; })[0];
    if (!reason) throw E('Choose a reason for the flag.');
    var dayAgo = now() - 86400000;
    var used = db.flags.filter(function (f) { return f.userId === u.id && f.ts > dayAgo; }).length;
    if (used >= db.settings.flagsPerDay) throw E('You have used your ' + db.settings.flagsPerDay + ' flags for today. You can flag again tomorrow.');
    db.flags.push({ id: uid('f'), userId: u.id, complaintId: c.id, reasonId: reason.id, note: (note || '').trim().slice(0, 200), ts: now() });
    c.flagCount++;
    var first = modOf(c) === 'normal';
    if (first) c.modStatus = 'flagged';
    var toReview = false;
    if (c.flagCount >= db.settings.reviewThreshold && modOf(c) !== 'under_review') {
      c.modStatus = 'under_review'; toReview = true;
      c.modLog.unshift({ ts: now(), by: 'System', action: 'Sent to review', note: c.flagCount + ' people flagged it. No decision has been made.' });
      notify(c.citizenId, 'moderation', 'Your report is being checked', 'Other users flagged "' + c.title + '". An admin will review it. No decision has been made.', '#/c/' + c.id, c.id);
    }
    if (first || toReview) notifyAdmins('moderation', toReview ? 'Report sent to review' : 'A report was flagged', '"' + c.title + '" (' + reason.label + ').', '#/admin/r/' + c.id, c.id);
    save();
    return { count: c.flagCount, toReview: toReview };
  }

  /* ---------- official work (only active reports of your own department; admin may work on any) ---------- */
  function guard(cid) {
    var u = need('report.work');
    var c = getComplaint(cid);
    if (!c) throw E('Report not found.');
    if (!isActive(c)) throw E('This report is not part of the active workload. An admin has to clear it first.');
    if (!canManage(u, c)) throw E('Only the assigned department can do this.');
    if (!isOpen(c)) throw E('This report is already resolved.');
    return { u: u, c: c };
  }

  function startWork(passed, cid) {
    var g = guard(cid), c = g.c;
    c.status = 'In progress'; c.assignedOfficerId = g.u.id; c.dateUpdated = now();
    c.timeline.push({ ts: now(), label: 'Work started by ' + deptName(c.deptId) + ' (' + g.u.name + ')' });
    notify(c.citizenId, 'started', 'Work has started', deptName(c.deptId) + ' started work on "' + c.title + '".', '#/c/' + c.id, c.id);
    save();
    return c;
  }

  function resolve(passed, cid, o) {
    var g = guard(cid), c = g.c;
    var response = ((o && o.response) || '').trim();
    if (response.length < 10) throw E('Write what was done, at least 10 characters.');
    if (!o.proof) throw E('Add a photo that shows the finished work.');
    return tx(function () {
      c.status = 'Resolved'; c.authorityResponse = response.slice(0, 800); c.resolutionProofUrl = o.proof; c.assignedOfficerId = g.u.id; c.dateUpdated = now(); c.audit = { state: 'pending' };
      c.timeline.push({ ts: now(), label: 'Marked resolved by ' + deptName(c.deptId) + ' (' + g.u.name + ')' });
      notify(c.citizenId, 'resolved', 'Your report was resolved', deptName(c.deptId) + ' marked "' + c.title + '" as fixed. Please check the work and tell us if it is really fixed.', '#/c/' + c.id, c.id);
      return c;
    });
  }

  function transfer(passed, cid, deptId, reason) {
    var g = guard(cid), c = g.c;
    reason = (reason || '').trim();
    var target = dept(deptId);
    if (!target || !target.active) throw E('Choose a department.');
    if (deptId === c.deptId) throw E('The report is already with that department.');
    if (reason.length < 5) throw E('Say why it is being transferred.');
    var from = c.deptId;
    c.deptId = deptId; c.dateUpdated = now(); c.assignedOfficerId = '';
    c.timeline.push({ ts: now(), label: 'Transferred from ' + deptName(from) + ' to ' + target.name + '. Reason: ' + reason.slice(0, 200) });
    notify(c.citizenId, 'transferred', 'Report sent to another department', '"' + c.title + '" is now with the ' + target.name + '.', '#/c/' + c.id, c.id);
    notifyDept(deptId, 'transferred', 'A report was transferred to you', '"' + c.title + '" came from ' + deptName(from) + '.', '#/c/' + c.id, c.id);
    if (g.u.role === 'admin') audit('report.reassign', 'report', c.id, 'DL-' + c.id + ' ' + c.title, reason, { from: deptName(from), to: target.name });
    save();
    return c;
  }

  function escalate(passed, cid, reason) {
    var g = guard(cid), c = g.c;
    reason = (reason || '').trim();
    if (c.isEscalated) throw E('This report is already escalated.');
    if (reason.length < 5) throw E('Say why it needs escalation.');
    c.isEscalated = true; c.dateUpdated = now();
    c.timeline.push({ ts: now(), label: 'Escalated to district administration. Reason: ' + reason.slice(0, 200) });
    notify(c.citizenId, 'escalated', 'Your report was escalated', '"' + c.title + '" was sent to the district administration.', '#/c/' + c.id, c.id);
    notifyAdmins('escalated', 'A report was escalated', '"' + c.title + '"', '#/admin/r/' + c.id, c.id);
    save();
    return c;
  }

  function deskList(passed, o) {
    var u = need('desk.use', passed);
    var f = (o && o.filter) || 'open';
    var out = db.complaints.filter(function (c) {
      if (!canManage(u, c)) return false;
      if (f === 'open') return isOpen(c);
      if (f === 'urgent') return isOpen(c) && c.priority === 'Urgent';
      if (f === 'late') return isLate(c);
      if (f === 'resolved') return !isOpen(c);
      return true;
    }).map(H);
    function rank(c) { return !isOpen(c) ? 4 : (c.priority === 'Urgent' ? 0 : (c.status === 'Reopened' ? 1 : (isLate(c) ? 2 : 3))); }
    out.sort(function (a, b) { return rank(a) - rank(b) || (b.dateUpdated || b.timestamp) - (a.dateUpdated || a.timestamp); });
    return out;
  }
  function deskStats(passed) {
    var u = need('desk.use', passed);
    var mine = db.complaints.filter(function (c) { return canManage(u, c); });
    return { open: mine.filter(isOpen).length, urgent: mine.filter(function (c) { return isOpen(c) && c.priority === 'Urgent'; }).length,
      late: mine.filter(isLate).length, resolved: mine.filter(function (c) { return !isOpen(c); }).length, rating: u.role === 'official' ? deptRating(u.deptId) : null };
  }


  /* ---------- the citizen checks the work (Phase 3) ---------- */
  function resolvedAt(c) {
    var t = c.timeline || [];
    for (var i = t.length - 1; i >= 0; i--) if (/^Marked resolved/.test(t[i].label)) return t[i].ts;
    return c.dateUpdated || c.timestamp;
  }
  /* what the citizen can still do about a resolved report */
  function auditInfo(c) {
    if (c.status !== 'Resolved') return { pending: false, state: (c.audit && c.audit.state) || '' };
    var a = c.audit || { state: 'pending' };
    if (a.state !== 'pending') return { pending: false, state: a.state };
    var ends = resolvedAt(c) + db.settings.auditDays * 86400000, left = ends - now();
    return { pending: left > 0, state: 'pending', endsAt: ends, daysLeft: Math.max(0, Math.ceil(left / 86400000)) };
  }
  /* reports nobody answered close by themselves after the waiting time */
  function sweepAudits() {
    var changed = false;
    db.complaints.forEach(function (c) {
      if (c.status !== 'Resolved') return;
      var a = c.audit || { state: 'pending' };
      if (a.state !== 'pending') return;
      if (now() < resolvedAt(c) + db.settings.auditDays * 86400000) return;
      c.status = 'Closed'; c.audit = { state: 'auto_closed', ts: now(), deptId: c.deptId };
      c.timeline.push({ ts: now(), label: 'Closed automatically after ' + db.settings.auditDays + ' days without a reply' });
      notify(c.citizenId, 'closed', 'Your report was closed', '"' + c.title + '" was closed because no one replied within ' + db.settings.auditDays + ' days.', '#/c/' + c.id, c.id);
      changed = true;
    });
    return changed;
  }
  function auditCase(cid) {
    var u = need('report.audit');
    var c = getComplaint(cid);
    if (!c) throw E('Report not found.');
    if (c.citizenId !== u.id) throw E('Only the person who made this report can do this.');
    if (!isActive(c)) throw E('This report is not active right now.');
    var ai = auditInfo(c);
    if (!ai.pending) throw E(c.status === 'Closed' ? 'This report is already closed.' : (c.status === 'Resolved' ? 'The time to reply has ended, so the report was closed.' : 'There is nothing to check on this report right now.'));
    return { u: u, c: c };
  }
  function confirmFix(passed, cid, o) {
    var k = auditCase(cid), c = k.c;
    var rating = Number(o && o.rating);
    if (!(rating >= 1 && rating <= 5) || Math.floor(rating) !== rating) throw E('Choose a star rating from 1 to 5.');
    c.audit = { state: 'confirmed', rating: rating, comment: ((o && o.comment) || '').trim().slice(0, 300), ts: now(), deptId: c.deptId };
    c.status = 'Closed'; c.dateUpdated = now();
    c.timeline.push({ ts: now(), label: 'Citizen confirmed the fix (' + rating + ' of 5 stars)' });
    notifyDept(c.deptId, 'confirmed', 'The citizen confirmed the fix', '"' + c.title + '" was rated ' + rating + ' of 5.', '#/c/' + c.id, c.id);
    notify(k.u.id, 'closed', 'Thank you', '"' + c.title + '" is now closed.', '#/c/' + c.id, c.id);
    save();
    return c;
  }
  function disputeFix(passed, cid, o) {
    var k = auditCase(cid), c = k.c;
    var reason = DISPUTE_REASONS.filter(function (r) { return r.id === (o && o.reasonId); })[0];
    if (!reason) throw E('Choose what is wrong.');
    var note = ((o && o.note) || '').trim();
    if (note.length < 5) throw E('Tell the department what is still wrong, at least 5 letters.');
    var count = c.reopenCount || 0;
    if (count >= db.settings.maxReopens) throw E('This report was already reopened ' + count + ' times. An admin has been asked to look at it, so it cannot be reopened again.');
    return tx(function () {
      c.resolutions = c.resolutions || [];
      c.resolutions.unshift({ ts: resolvedAt(c), response: c.authorityResponse, proof: c.resolutionProofUrl, deptId: c.deptId, officerId: c.assignedOfficerId, disputedReason: reason.label, disputedNote: note });
      c.disputes = c.disputes || [];
      c.disputes.unshift({ ts: now(), reasonId: reason.id, reason: reason.label, note: note.slice(0, 300), photo: (o && o.photo) || '' });
      c.authorityResponse = ''; c.resolutionProofUrl = '';
      c.status = 'Reopened'; c.reopenCount = count + 1; c.audit = { state: 'disputed', ts: now() }; c.slaStart = now(); c.dateUpdated = now();
      c.timeline.push({ ts: now(), label: 'Citizen reported the problem is still there. Reason: ' + reason.label });
      notifyDept(c.deptId, 'reopened', 'A report was reopened', '"' + c.title + '": the citizen says it is not fixed (' + reason.label.toLowerCase() + ').', '#/c/' + c.id, c.id);
      notify(k.u.id, 'reopened', 'Your report was reopened', 'We asked the ' + deptName(c.deptId) + ' to look at "' + c.title + '" again.', '#/c/' + c.id, c.id);
      if (c.reopenCount >= db.settings.maxReopens) notifyAdmins('escalated', 'A report keeps coming back', '"' + c.title + '" was reopened ' + c.reopenCount + ' times.', '#/admin/r/' + c.id, c.id);
      return c;
    });
  }
  /* average citizen rating for a department, only from confirmed fixes on active reports */
  function deptRating(deptId) {
    var rs = db.complaints.filter(function (c) { return isActive(c) && c.audit && c.audit.state === 'confirmed' && c.audit.deptId === deptId; }).map(function (c) { return c.audit.rating; });
    if (!rs.length) return { avg: 0, count: 0 };
    return { avg: Math.round(rs.reduce(function (a, b) { return a + b; }, 0) / rs.length * 10) / 10, count: rs.length };
  }
  function deptRatings() {
    need('admin.departments');
    var out = {}; db.departments.forEach(function (d) { out[d.id] = deptRating(d.id); }); return out;
  }
  function pendingChecks(userId) {
    return db.complaints.filter(function (c) { return c.citizenId === userId && isActive(c) && auditInfo(c).pending; }).map(H);
  }

  /* ---------- official verification ---------- */
  function verifState(u) { return u.verification ? u.verification.status : 'none'; }
  function addVerifHistory(u, status, by, note) {
    u.verification.status = status; u.verification.history.unshift({ ts: now(), status: status, by: by, note: note || '' });
  }
  function submitVerificationInfo(passed, text) {
    var u = sessionUser();
    if (!u || u.role !== 'official') throw E('Only officials can send verification details.');
    if (passed && passed.id && passed.id !== u.id) throw E('Your session changed. Please log in again.');
    var st = verifState(u);
    if (st !== 'info_requested' && st !== 'rejected') throw E('There is nothing to update right now.');
    text = (text || '').trim();
    if (text.length < 5) throw E('Write the details the admin asked for.');
    u.verification.supporting.unshift({ ts: now(), text: text.slice(0, 600) });
    addVerifHistory(u, 'pending', 'applicant', 'Sent more information');
    notifyAdmins('verification', 'Official sent more information', u.name + ' replied to your request.', '#/admin/authorities/' + u.id);
    save();
    return u;
  }

  function authorityAction(userId, from, to, action, reason, notifyTitle, notifyMsg, requireReason) {
    var a = need('admin.authorities');
    var u = findUser(userId);
    if (!u || u.role !== 'official') throw E('Official not found.');
    var st = verifState(u);
    if (from.indexOf(st) < 0) throw E('This is not possible while the status is "' + st.replace('_', ' ') + '".');
    reason = (reason || '').trim();
    if (requireReason && reason.length < 5) throw E('Write a reason of at least 5 characters.');
    addVerifHistory(u, to, a.name, reason);
    u.verification.adminNote = reason;
    notify(u.id, 'verification', notifyTitle, notifyMsg + (reason ? ' ' + reason : ''), '#/verification');
    audit(action, 'official', u.id, u.name + ' (' + deptName(u.deptId) + ')', reason, { from: st, to: to });
    save();
    return u;
  }
  function approveAuthority(id, note) { return authorityAction(id, ['pending', 'info_requested'], 'approved', 'authority.approve', note || 'ID checked', 'Your official access was approved', 'You can now open your department desk.', false); }
  function rejectAuthority(id, reason) { return authorityAction(id, ['pending', 'info_requested'], 'rejected', 'authority.reject', reason, 'Your official access was not approved', 'Reason:', true); }
  function requestInfo(id, message) { return authorityAction(id, ['pending'], 'info_requested', 'authority.request_info', message, 'More information needed', 'The admin asked:', true); }
  function suspendAuthority(id, reason) { return authorityAction(id, ['approved'], 'suspended', 'authority.suspend', reason, 'Your official access was suspended', 'Reason:', true); }
  function reinstateAuthority(id, reason) { return authorityAction(id, ['suspended'], 'approved', 'authority.reinstate', reason, 'Your official access was restored', 'You can use your department desk again.', true); }

  function listAuthorities(tab) {
    need('admin.authorities');
    var map = { pending: ['pending', 'info_requested'], approved: ['approved'], rejected: ['rejected'], suspended: ['suspended'] };
    var want = map[tab || 'pending'] || map.pending;
    return db.users.filter(function (u) { return u.role === 'official' && want.indexOf(verifState(u)) >= 0; }).map(HU)
      .sort(function (a, b) { return b.verification.submittedAt - a.verification.submittedAt; });
  }
  function authCounts() {
    need('admin.authorities');
    var offs = db.users.filter(function (u) { return u.role === 'official'; });
    var n = function (arr) { return offs.filter(function (u) { return arr.indexOf(verifState(u)) >= 0; }).length; };
    return { pending: n(['pending', 'info_requested']), approved: n(['approved']), rejected: n(['rejected']), suspended: n(['suspended']) };
  }
  function getAuthority(id) {
    need('admin.authorities');
    var u = findUser(id);
    return u && u.role === 'official' ? HU(u) : null;
  }

  /* ---------- moderation (admin only, always with a written reason, always audited) ---------- */
  function modCase(cid, reason, minReason) {
    var a = need('admin.moderate');
    var c = getComplaint(cid);
    if (!c) throw E('Report not found.');
    reason = (reason || '').trim();
    if (reason.length < (minReason || 5)) throw E('Write a reason of at least 5 characters.');
    return { a: a, c: c, reason: reason };
  }
  function logMod(c, a, action, note) { c.modLog.unshift({ ts: now(), by: a.name, action: action, note: note }); c.dateUpdated = now(); }
  function reporterOf(c) { return findUser(c.citizenId); }
  function reverseHistory(u, reportId) { (u.modHistory || []).forEach(function (h) { if (h.reportId === reportId && !h.reversed && ['fake', 'spam', 'duplicate', 'cleared'].indexOf(h.type) >= 0) h.reversed = true; }); }
  function auditReport(action, c, reason, meta) { audit(action, 'report', c.id, 'DL-' + c.id + ' ' + c.title, reason, meta); }

  function keepReport(cid, reason) {
    var m = modCase(cid, reason), c = m.c;
    if (isActive(c) && modOf(c) === 'verified') throw E('This report was already cleared.');
    if (modOf(c) === 'rejected' || modOf(c) === 'archived') throw E('Restore the report first.');
    var wasHidden = modOf(c) === 'under_review', hadFlags = c.flagCount > 0;
    c.modStatus = 'verified'; c.modOutcome = ''; c.modReason = m.reason;
    logMod(c, m.a, 'Cleared: report is legitimate', m.reason);
    var u = reporterOf(c);
    if (u && hadFlags) addHistory(u, { type: 'cleared', reportId: c.id, reason: m.reason, by: m.a.name });
    if (wasHidden) notify(c.citizenId, 'moderation', 'Your report is visible again', 'An admin checked "' + c.title + '" and found no problem.', '#/c/' + c.id, c.id);
    auditReport('report.keep', c, m.reason, {});
    save(); return c;
  }
  function markUnderReview(cid, reason) {
    var m = modCase(cid, reason), c = m.c;
    if (modOf(c) === 'under_review') throw E('This report is already under review.');
    if (!isActive(c)) throw E('Restore the report first.');
    c.modStatus = 'under_review'; c.modReason = m.reason;
    logMod(c, m.a, 'Marked under review', m.reason);
    notify(c.citizenId, 'moderation', 'Your report is being checked', 'An admin is checking "' + c.title + '". No decision has been made.', '#/c/' + c.id, c.id);
    auditReport('report.review', c, m.reason, {});
    save(); return c;
  }
  function rejectReport(cid, outcome, reason) {
    var m = modCase(cid, reason), c = m.c;
    var oc = REJECT_OUTCOMES.filter(function (o) { return o.id === outcome; })[0];
    if (!oc) throw E('Choose why the report is rejected.');
    if (modOf(c) === 'rejected' || modOf(c) === 'archived') throw E('This report is already closed by moderation.');
    c.modStatus = 'rejected'; c.modOutcome = oc.id; c.modReason = m.reason;
    logMod(c, m.a, 'Rejected: ' + oc.label, m.reason);
    var u = reporterOf(c);
    if (u && (oc.id === 'fake' || oc.id === 'spam')) addHistory(u, { type: oc.id, reportId: c.id, reason: m.reason, by: m.a.name });
    notify(c.citizenId, 'moderation', 'Your report was removed', 'An admin reviewed "' + c.title + '" and removed it (' + oc.label.toLowerCase() + '). ' + m.reason, '#/c/' + c.id, c.id);
    auditReport('report.reject', c, m.reason, { outcome: oc.id });
    save(); return c;
  }
  function markDuplicate(cid, originalId, reason) {
    var m = modCase(cid, reason), c = m.c;
    var o = getComplaint(String(originalId).replace(/\D/g, ''));
    if (!o) throw E('We could not find the original report. Enter its number, for example 12.');
    if (o.id === c.id) throw E('A report cannot be a duplicate of itself.');
    if (!isActive(o) || o.duplicateOf) throw E('Choose an active report as the original.');
    if (modOf(c) === 'rejected' || modOf(c) === 'archived') throw E('This report is already closed by moderation.');
    c.modStatus = 'rejected'; c.modOutcome = 'duplicate'; c.duplicateOf = o.id; c.modReason = m.reason;
    logMod(c, m.a, 'Marked as duplicate of DL-' + o.id, m.reason);
    var u = reporterOf(c);
    if (u) addHistory(u, { type: 'duplicate', reportId: c.id, reason: m.reason, by: m.a.name });
    notify(c.citizenId, 'moderation', 'Your report matches an existing one', '"' + c.title + '" duplicates report DL-' + o.id + '. Please follow that report.', '#/c/' + o.id, o.id);
    auditReport('report.duplicate', c, m.reason, { original: o.id });
    save(); return c;
  }
  function archiveReport(cid, reason) {
    var m = modCase(cid, reason), c = m.c;
    if (modOf(c) === 'archived') throw E('This report is already archived.');
    c.modStatus = 'archived'; c.modOutcome = ''; c.modReason = m.reason;
    logMod(c, m.a, 'Archived', m.reason);
    notify(c.citizenId, 'moderation', 'Your report was archived', '"' + c.title + '" was archived by an admin. ' + m.reason, '#/c/' + c.id, c.id);
    auditReport('report.archive', c, m.reason, {});
    save(); return c;
  }
  function restoreReport(cid, reason) {
    var m = modCase(cid, reason), c = m.c;
    if (isActive(c) && modOf(c) !== 'under_review') throw E('This report is already active.');
    var u = reporterOf(c);
    if (u) reverseHistory(u, c.id);
    c.modStatus = 'normal'; c.modOutcome = ''; c.duplicateOf = null; c.modReason = '';
    logMod(c, m.a, 'Restored', m.reason);
    notify(c.citizenId, 'moderation', 'Your report was restored', 'An admin restored "' + c.title + '". It is active again.', '#/c/' + c.id, c.id);
    auditReport('report.restore', c, m.reason, {});
    save(); return c;
  }

  function flagsFor(cid) {
    need('admin.moderate');
    return db.flags.filter(function (f) { return f.complaintId === Number(cid); }).map(function (f) {
      var u = findUser(f.userId), r = FLAG_REASONS.filter(function (x) { return x.id === f.reasonId; })[0];
      return { id: f.id, userId: f.userId, userName: u ? u.name : 'Unknown', reasonId: f.reasonId, reason: r ? r.label : 'Other', note: f.note || '', ts: f.ts };
    }).sort(function (a, b) { return b.ts - a.ts; });
  }
  function modCounts() {
    need('admin.moderate');
    var q = function (t) { return modQueue(t).length; };
    return { pending: q('pending'), flagged: q('flagged'), fake: q('fake'), duplicates: q('duplicates'), cleared: q('cleared') };
  }
  function modQueue(tab) {
    need('admin.moderate');
    var out = db.complaints.filter(function (c) {
      var m = modOf(c);
      if (tab === 'pending') return m === 'under_review';
      if (tab === 'flagged') return m === 'flagged';
      if (tab === 'fake') return m === 'rejected' && c.modOutcome !== 'duplicate';
      if (tab === 'duplicates') return m === 'rejected' && c.modOutcome === 'duplicate';
      if (tab === 'cleared') return m === 'verified' && c.flagCount > 0;
      return false;
    }).map(H);
    out.sort(function (a, b) { return b.flagCount - a.flagCount || b.dateUpdated - a.dateUpdated; });
    return out;
  }

  /* ---------- people (admin) ---------- */
  function strip(u) { var c = JSON.parse(JSON.stringify(u)); delete c.passwordHash; delete c.salt; return HU(c); }
  function listUsers(o) {
    need('admin.users');
    o = o || {};
    var q = lc(o.q);
    return db.users.filter(function (u) {
      if (u.role !== 'citizen') return false;
      var st = account(u).status;
      if (o.f === 'suspended' && st !== 'suspended') return false;
      if (o.f === 'banned' && st !== 'banned') return false;
      if (o.f === 'watch') { var t = trustFor(u.id); if (t.status === 'Good standing' || st === 'banned') return false; }
      if (q && lc(u.name + ' ' + u.email + ' ' + u.phone + ' ' + u.city + ' ' + u.district).indexOf(q) === -1) return false;
      return true;
    }).map(strip).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }
  function getUser(id) { need('admin.users'); var u = findUser(id); return u ? strip(u) : null; }
  function userReports(id) { need('admin.users'); return db.complaints.filter(function (c) { return c.citizenId === id; }).map(H); }

  function userCase(userId, reason) {
    var a = need('admin.users'), u = findUser(userId);
    if (!u) throw E('Account not found.');
    if (u.role === 'admin') throw E('Admin accounts cannot be moderated here.');
    if (u.id === a.id) throw E('You cannot do this to your own account.');
    reason = (reason || '').trim();
    if (reason.length < 5) throw E('Write a reason of at least 5 characters.');
    return { a: a, u: u, reason: reason };
  }
  function warnUser(userId, reason) {
    var m = userCase(userId, reason);
    addHistory(m.u, { type: 'warning', reason: m.reason, by: m.a.name });
    notify(m.u.id, 'account', 'You received a warning', 'An admin sent you a warning: ' + m.reason, '#/profile');
    audit('user.warn', 'user', m.u.id, m.u.name, m.reason, {}); save(); return m.u;
  }
  function suspendUser(userId, days, reason) {
    var m = userCase(userId, reason);
    days = Number(days);
    if (!(days >= 1 && days <= 90)) throw E('Choose between 1 and 90 days.');
    if (account(m.u).status === 'banned') throw E('This account is already banned.');
    m.u.account = { status: 'suspended', until: now() + days * 86400000, reason: m.reason, by: m.a.name };
    addHistory(m.u, { type: 'suspension', reason: m.reason, by: m.a.name, days: days });
    notify(m.u.id, 'account', 'Your account is suspended', 'You cannot post, comment or flag until ' + fmtDate(m.u.account.until) + '. Reason: ' + m.reason, '#/profile');
    audit('user.suspend', 'user', m.u.id, m.u.name, m.reason, { days: days }); save(); return m.u;
  }
  function banUser(userId, reason, confirmWord) {
    var m = userCase(userId, reason);
    if (confirmWord !== 'BAN') throw E('Type BAN to confirm a permanent ban.');
    m.u.account = { status: 'banned', until: null, reason: m.reason, by: m.a.name };
    addHistory(m.u, { type: 'ban', reason: m.reason, by: m.a.name });
    audit('user.ban', 'user', m.u.id, m.u.name, m.reason, {}); save(); return m.u;
  }
  function reinstateUser(userId, reason) {
    var m = userCase(userId, reason);
    if (account(m.u).status === 'active') throw E('This account is already active.');
    m.u.account = { status: 'active', until: null, reason: '', by: '' };
    addHistory(m.u, { type: 'reinstated', reason: m.reason, by: m.a.name });
    notify(m.u.id, 'account', 'Your account is active again', 'An admin restored your account. ' + m.reason, '#/profile');
    audit('user.reinstate', 'user', m.u.id, m.u.name, m.reason, {}); save(); return m.u;
  }
  function accountOf(u) { return Object.assign({}, account(u)); }

  /* ---------- departments and settings (admin) ---------- */
  function saveDepartment(f) {
    var a = need('admin.departments');
    var name = (f.name || '').trim();
    if (name.length < 3) throw E('Give the department a name of at least 3 letters.');
    if (db.departments.some(function (d) { return lc(d.name) === lc(name) && d.id !== f.id; })) throw E('A department with this name already exists.');
    var roles = (f.roles || []).map(function (r) { return String(r).trim(); }).filter(Boolean);
    var d = f.id ? dept(f.id) : null;
    if (f.id && !d) throw E('Department not found.');
    if (d) {
      if (!f.active && d.id === db.settings.fallbackDeptId) throw E('This is the fallback department for unrouted reports, so it must stay active.');
      if (!f.active && d.active && db.departments.filter(function (x) { return x.active; }).length <= 1) throw E('At least one department must stay active.');
      var before = { name: d.name, active: d.active };
      d.name = name; d.description = (f.description || '').trim(); d.active = !!f.active; d.roles = roles;
      audit('department.update', 'department', d.id, d.name, f.reason || 'Department edited', { before: before, after: { name: d.name, active: d.active } });
    } else {
      var id = lc(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('d');
      if (dept(id)) id = id + '-' + db.departments.length;
      d = { id: id, name: name, description: (f.description || '').trim(), active: f.active !== false, roles: roles };
      db.departments.push(d);
      audit('department.create', 'department', d.id, d.name, f.reason || 'Department added', {});
    }
    save(); return d;
  }
  function setCategoryDept(catId, deptId) {
    need('admin.departments');
    var d = dept(deptId);
    if (!d || !d.active) throw E('Choose an active department.');
    if (!CATS.some(function (c) { return c.id === catId; })) throw E('Unknown category.');
    db.settings.categoryDept = db.settings.categoryDept || {};
    db.settings.categoryDept[catId] = deptId;
    audit('department.routing', 'category', catId, cat(catId).name, 'New reports of this type now go to ' + d.name, { dept: d.name });
    save();
  }
  function getSettings() { need('admin.settings'); return JSON.parse(JSON.stringify(db.settings)); }
  function publicSettings() { return { mapTiles: !!db.settings.mapTiles, gridMeters: db.settings.publicGridMeters, areaLevel: db.settings.areaLevel }; }
  function saveSettings(f) {
    need('admin.settings');
    var chk = function (v, lo, hi, label) { v = Number(v); if (!(v >= lo && v <= hi) || Math.floor(v) !== v) throw E(label + ' must be a whole number from ' + lo + ' to ' + hi + '.'); return v; };
    var before = { reviewThreshold: db.settings.reviewThreshold, flagsPerDay: db.settings.flagsPerDay, reportsPerHour: db.settings.reportsPerHour, auditDays: db.settings.auditDays, maxReopens: db.settings.maxReopens, publicGridMeters: db.settings.publicGridMeters, areaLevel: db.settings.areaLevel, mapTiles: !!db.settings.mapTiles };
    var grid = f.publicGridMeters == null ? db.settings.publicGridMeters : Number(f.publicGridMeters);
    if ([250, 500, 1000].indexOf(grid) < 0) throw E('Choose how precise the public map is.');
    var lvl = f.areaLevel == null ? db.settings.areaLevel : f.areaLevel;
    if (['state', 'district', 'city'].indexOf(lvl) < 0) throw E('Choose how areas are grouped.');
    var tiles = f.mapTiles == null ? !!db.settings.mapTiles : !!f.mapTiles;
    var next = { reviewThreshold: chk(f.reviewThreshold, 2, 20, 'Flags needed for review'), flagsPerDay: chk(f.flagsPerDay, 1, 20, 'Flags per person per day'), reportsPerHour: chk(f.reportsPerHour, 1, 20, 'Reports per person per hour'),
      auditDays: chk(f.auditDays == null ? db.settings.auditDays : f.auditDays, 1, 30, 'Days a citizen has to check the work'), maxReopens: chk(f.maxReopens == null ? db.settings.maxReopens : f.maxReopens, 1, 5, 'Times a report can be reopened'),
      publicGridMeters: grid, areaLevel: lvl, mapTiles: tiles };
    Object.assign(db.settings, next);
    audit('settings.update', 'settings', 'limits', 'Moderation limits', 'Settings changed', { before: before, after: next });
    save();
  }

  /* ---------- admin overview, search, logs ---------- */
  function adminStats() {
    need('admin.access');
    var act = db.complaints.filter(isActive);
    var dayAgo = now() - 86400000;
    var users = db.users;
    var offs = users.filter(function (u) { return u.role === 'official'; });
    var vs = function (arr) { return offs.filter(function (u) { return arr.indexOf(verifState(u)) >= 0; }).length; };
    return {
      reports: { total: act.length, fresh: act.filter(function (c) { return c.status === 'Submitted' && c.timestamp > dayAgo; }).length, open: act.filter(isOpen).length,
        urgent: act.filter(function (c) { return isOpen(c) && c.priority === 'Urgent'; }).length, late: act.filter(isLate).length,
        resolved: act.filter(function (c) { return !isOpen(c); }).length, flagged: db.complaints.filter(function (c) { return modOf(c) === 'flagged'; }).length },
      moderation: { pending: db.complaints.filter(function (c) { return modOf(c) === 'under_review'; }).length, flagged: db.complaints.filter(function (c) { return modOf(c) === 'flagged'; }).length,
        suspended: users.filter(function (u) { return account(u).status === 'suspended'; }).length, banned: users.filter(function (u) { return account(u).status === 'banned'; }).length },
      authorities: { pending: vs(['pending', 'info_requested']), approved: vs(['approved']), rejected: vs(['rejected']), suspended: vs(['suspended']) }
    };
  }

  function attention() {
    need('admin.access');
    var items = [];
    var flagged = db.complaints.filter(function (c) { return modOf(c) === 'under_review' || modOf(c) === 'flagged'; }).sort(function (a, b) { return (modOf(b) === 'under_review') - (modOf(a) === 'under_review') || b.flagCount - a.flagCount; });
    flagged.slice(0, 3).forEach(function (c) {
      items.push({ kind: modOf(c) === 'under_review' ? 'Needs a decision' : 'Flagged by users', title: c.title, detail: 'DL-' + c.id + ' · flagged by ' + c.flagCount + ' ' + (c.flagCount === 1 ? 'person' : 'people'), href: '#/admin/r/' + c.id, action: 'Review' });
    });
    db.complaints.filter(function (c) { return isActive(c) && c.isEscalated && isOpen(c); }).slice(0, 2).forEach(function (c) {
      items.push({ kind: 'Escalated', title: c.title, detail: 'DL-' + c.id + ' · sent to district administration', href: '#/admin/r/' + c.id, action: 'Open' });
    });
    db.complaints.filter(function (c) { return isActive(c) && isOpen(c) && (c.reopenCount || 0) >= db.settings.maxReopens; }).slice(0, 2).forEach(function (c) {
      items.push({ kind: 'Keeps coming back', title: c.title, detail: 'DL-' + c.id + ' · reopened ' + c.reopenCount + ' times by the citizen', href: '#/admin/r/' + c.id, action: 'Open' });
    });
    db.users.filter(function (u) { return u.role === 'official' && ['pending', 'info_requested'].indexOf(verifState(u)) >= 0; }).slice(0, 2).forEach(function (u) {
      items.push({ kind: 'Official waiting', title: u.name, detail: deptName(u.deptId) + ' · ' + (u.authorityRole || 'Official') + (verifState(u) === 'info_requested' ? ' · waiting for the official to reply' : ''), href: '#/admin/authorities/' + u.id, action: 'Check ID' });
    });
    db.users.filter(function (u) { return u.role === 'citizen' && account(u).status !== 'banned'; }).forEach(function (u) {
      var t = trustFor(u.id);
      if (t.counts.fake + t.counts.spam >= 2 || t.counts.duplicate >= 3) items.push({ kind: 'Repeated problems', title: u.name, detail: t.counts.fake + t.counts.spam + ' confirmed fake or spam · ' + t.counts.duplicate + ' duplicates', href: '#/admin/citizens/' + u.id, action: 'Review' });
    });
    return { total: items.length, items: items.slice(0, 6) };
  }

  function adminReports(o) {
    need('admin.reports');
    o = o || {};
    var f = o.f || 'all', q = lc(o.q), loc = lc(o.loc), rep = lc(o.reporter);
    var from = o.from ? new Date(o.from + 'T00:00:00').getTime() : 0, to = o.to ? new Date(o.to + 'T23:59:59').getTime() : 0;
    var dayAgo = now() - 86400000;
    var out = db.complaints.filter(function (c) {
      var m = modOf(c);
      if (f === 'active' && !isActive(c)) return false;
      if (f === 'new' && !(isActive(c) && c.status === 'Submitted' && c.timestamp > dayAgo)) return false;
      if (f === 'open' && !(isActive(c) && isOpen(c))) return false;
      if (f === 'urgent' && !(isActive(c) && isOpen(c) && c.priority === 'Urgent')) return false;
      if (f === 'late' && !isLate(c)) return false;
      if (f === 'resolved' && !(isActive(c) && !isOpen(c))) return false;
      if (f === 'flagged' && m !== 'flagged') return false;
      if (f === 'review' && m !== 'under_review') return false;
      if (f === 'rejected' && m !== 'rejected' && m !== 'archived') return false;
      if (f === 'escalated' && !(isActive(c) && c.isEscalated)) return false;
      if (o.dept && c.deptId !== o.dept) return false;
      if (o.cat && c.category !== o.cat) return false;
      if (o.status && !(c.status === o.status || (o.status === 'Resolved' && c.status === 'Closed'))) return false;
      if (from && c.timestamp < from) return false;
      if (to && c.timestamp > to) return false;
      var u = findUser(c.citizenId);
      var where = lc(c.manualLocationAddress + ' ' + c.city + ' ' + c.district + ' ' + c.state + ' ' + c.pincode);
      if (loc && where.indexOf(loc) === -1) return false;
      if (rep && lc((u ? u.name + ' ' + u.email : '')).indexOf(rep) === -1) return false;
      if (q && lc('dl-' + c.id + ' ' + c.title + ' ' + c.description + ' ' + (u ? u.name + ' ' + u.email : '') + ' ' + where).indexOf(q) === -1) return false;
      return true;
    }).map(H);
    out.sort(function (a, b) { return b.timestamp - a.timestamp; });
    return out;
  }

  function reporterInfo(c) { need('admin.reports'); var u = findUser(c.citizenId); return u ? { id: u.id, name: u.name, email: u.email, phone: u.phone } : null; }
  function officerName(c) { var u = c.assignedOfficerId ? findUser(c.assignedOfficerId) : null; return u ? u.name : ''; }

  function search(q) {
    need('admin.search');
    q = lc(q).trim();
    if (q.length < 2) return [];
    var res = [];
    var num = q.replace(/^dl-?/, '');
    db.complaints.forEach(function (c) {
      var ci = CATS.filter(function (x) { return x.id === c.category; })[0];
      var hay = lc('dl-' + c.id + ' ' + c.title + ' ' + c.description + ' ' + c.city + ' ' + c.district + ' ' + c.manualLocationAddress + ' ' + (ci ? ci.name : ''));
      if (hay.indexOf(q) >= 0 || (/^\d+$/.test(num) && String(c.id) === num)) res.push({ type: 'REPORT', title: 'DL-' + c.id + ' · ' + c.title, sub: [c.city || c.state, c.status, MOD_LABELS[modOf(c)]].join(' · '), href: '#/admin/r/' + c.id });
    });
    db.users.forEach(function (u) {
      if (lc(u.name + ' ' + u.email + ' ' + u.phone).indexOf(q) < 0 && !(u.role === 'official' && lc(deptName(u.deptId)).indexOf(q) >= 0)) return;
      if (u.role === 'citizen') res.push({ type: 'CITIZEN', title: u.name, sub: u.email, href: '#/admin/citizens/' + u.id });
      if (u.role === 'official') res.push({ type: 'OFFICIAL', title: u.name, sub: deptName(u.deptId) + ' · ' + verifState(u).replace('_', ' '), href: '#/admin/authorities/' + u.id });
    });
    db.departments.forEach(function (d) { if (lc(d.name).indexOf(q) >= 0) res.push({ type: 'DEPARTMENT', title: d.name, sub: d.active ? 'Active' : 'Inactive', href: '#/admin/departments' }); });
    CATS.forEach(function (c) { if (lc(c.name).indexOf(q) >= 0) res.push({ type: 'CATEGORY', title: c.name, sub: db.complaints.filter(function (x) { return x.category === c.id; }).length + ' reports', href: '#/admin/reports?cat=' + c.id }); });
    var seen = {};
    db.complaints.forEach(function (c) { [c.city, c.district].forEach(function (p) { if (p && lc(p).indexOf(q) >= 0 && !seen[lc(p)]) { seen[lc(p)] = 1; res.push({ type: 'LOCATION', title: p, sub: 'See reports from here', href: '#/admin/reports?loc=' + encodeURIComponent(p) }); } }); });
    return res.slice(0, 40);
  }

  function auditList(o) {
    need('admin.logs');
    var q = lc(o && o.q);
    return db.audit.filter(function (e) { return !q || lc(e.action + ' ' + e.adminName + ' ' + e.targetLabel + ' ' + e.reason).indexOf(q) >= 0; });
  }
  function sysList() { need('admin.logs'); return db.logs.slice(); }
  function notifList() {
    need('admin.logs');
    return db.notifications.slice(0, 100).map(function (n) { var u = findUser(n.userId); return { id: n.id, recipient: u ? u.name : 'Unknown', role: u ? u.role : '', type: n.type || 'general', title: n.title, status: n.status || 'delivered', ts: n.ts, reportId: n.reportId }; });
  }


  /* =====================================================================
   * Phase 5: map points, heatmap and analytics
   * Everything below is computed from real, active reports. The role of the caller decides
   * what comes back: public callers get moved (approximate) points and no private fields,
   * officials get exact points for their own department only, admins get everything valid.
   * ===================================================================== */
  function viewer() {
    var u = sessionUser();
    if (u && can(u, 'admin.analytics')) return { tier: 'admin', u: u };
    if (u && can(u, 'map.work')) return { tier: 'official', u: u };
    return { tier: 'public', u: u };
  }
  /* sample records can only exist in the demo database; this also blocks any that slip into the real one */
  function realRecord(c) { return !(c.demo && !db.isDemo); }

  function geoOf(c) {
    if (c.latitude == null || c.longitude == null) return null;
    var la = Number(c.latitude), ln = Number(c.longitude);
    return G.valid(la, ln) ? { lat: la, lng: ln } : null;
  }
  function areaGuess(c) { var hit = G.lookup(c.city) || G.lookup(c.district); return hit ? { lat: hit.lat, lng: hit.lng, name: hit.name } : null; }

  /* where may THIS viewer see this report? mode 'public' => moved point, 'work' => exact point */
  function locationFor(c, mode) {
    if (!mode) {
      var v = viewer();
      mode = 'public';
      if (v.u && v.u.id === c.citizenId) mode = 'work';
      else if (v.tier === 'admin') mode = 'work';
      else if (v.tier === 'official' && v.u.deptId === c.deptId) mode = 'work';
    }
    var g = geoOf(c), priv = c.locationPrivacy || 'approximate';
    if (mode === 'work') {
      if (g) return { lat: g.lat, lng: g.lng, quality: 'exact' };
      var a = areaGuess(c); return a ? { lat: a.lat, lng: a.lng, quality: 'area' } : null;
    }
    if (priv === 'hidden') return null;
    if (g) {
      if (priv === 'exact') return { lat: g.lat, lng: g.lng, quality: 'exact' };
      var sn = G.snap(g.lat, g.lng, db.settings.publicGridMeters * (c.isAnonymous ? 2 : 1));
      return { lat: sn.lat, lng: sn.lng, quality: 'approx' };
    }
    var ar = areaGuess(c);
    return ar ? { lat: ar.lat, lng: ar.lng, quality: 'area' } : null;
  }

  /* priority on the map: derived, never typed by hand */
  function mapPriority(c) {
    if (!isOpen(c)) return 'resolved';
    if (c.priority === 'Urgent') return 'critical';
    if (c.isEscalated || c.status === 'Reopened' || isLate(c)) return 'high';
    return 'normal';
  }
  function rangeOf(f) {
    var r = String((f && f.range) || 'all'), t = now();
    if (r === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return { from: d.getTime(), to: t, label: 'today' }; }
    if (r === '7' || r === '30' || r === '90') return { from: t - Number(r) * DAY, to: t, label: 'the last ' + r + ' days' };
    if (r === 'custom') {
      var from = f.from ? new Date(f.from + 'T00:00:00').getTime() : 0, to = f.to ? new Date(f.to + 'T23:59:59').getTime() : t;
      if (isFinite(from) && isFinite(to)) return { from: from, to: to, label: (f.from ? 'from ' + fmtDate(from) : 'up to') + (f.to ? ' to ' + fmtDate(to) : ' now') };
    }
    return { from: 0, to: t, label: 'all time' };
  }
  function inRange(c, rg) { return c.timestamp >= rg.from && c.timestamp <= rg.to; }

  function passes(c, f, v, rg) {
    var m = modOf(c);
    if (f.status === 'under_review') { if (v.tier !== 'admin' || m !== 'under_review') return false; }
    else {
      if (!isActive(c)) return false;
      if (f.status && f.status !== 'all') {
        if (f.status === 'Resolved') { if (c.status !== 'Resolved' && c.status !== 'Closed') return false; }
        else if (c.status !== f.status) return false;
      }
    }
    if (v.tier === 'official' && c.deptId !== v.u.deptId) return false;
    if (f.scope === 'open' && !isOpen(c)) return false;
    if (f.scope === 'resolved' && isOpen(c)) return false;
    if (f.priority && f.priority !== 'all' && mapPriority(c) !== f.priority) return false;
    if (f.cat && f.cat !== 'all' && c.category !== f.cat) return false;
    if (f.dept && f.dept !== 'all' && v.tier === 'admin' && c.deptId !== f.dept) return false;
    return inRange(c, rg);
  }

  /* the one query the map uses. A real server would run this against a geo index (PostGIS); the
     arguments (filters, bbox, limit) are already shaped for that. */
  var mapCache = { key: '', val: null };
  function mapPoints(f) {
    f = f || {};
    var v = viewer(), rg = rangeOf(f);
    var key = JSON.stringify([f, v.tier, v.u && v.u.id, db.rev, db.settings.publicGridMeters]);
    if (mapCache.key === key) return mapCache.val;
    var mode = v.tier === 'public' ? 'public' : 'work';
    var limit = Math.min(Number(f.limit) || 1000, 2000), bb = Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox.map(Number) : null;
    var matching = 0, noLoc = 0, areaOnly = 0, out = [], inView = 0;
    db.complaints.forEach(function (c) {
      if (!realRecord(c) || !passes(c, f, v, rg)) return;
      matching++;
      var loc = locationFor(c, mode);
      if (!loc || !G.valid(loc.lat, loc.lng)) { noLoc++; return; }
      if (loc.quality === 'area') areaOnly++;
      if (f.near && G.km({ lat: Number(f.near.lat), lng: Number(f.near.lng) }, loc) > (Number(f.near.km) || 5)) return;
      if (bb && !(loc.lat >= bb[0] && loc.lat <= bb[2] && loc.lng >= bb[1] && loc.lng <= bb[3])) return;
      inView++;
      if (out.length >= limit) return;
      var ci = CATS.filter(function (x) { return x.id === c.category; })[0];
      var pt = { id: c.id, title: c.title, cat: c.category, catName: ci ? ci.name : 'Other', status: c.status, pr: mapPriority(c), ts: c.timestamp, lat: loc.lat, lng: loc.lng, q: loc.quality,
        area: c.city || c.district || c.state || '', review: modOf(c) === 'under_review' };
      if (mode === 'work') { pt.place = c.manualLocationAddress || ''; pt.dept = deptName(c.deptId); }
      out.push(pt);
    });
    var res = { points: out, matching: matching, located: matching - noLoc, noLocation: noLoc, areaOnly: areaOnly, inView: inView, truncated: inView > out.length, tier: v.tier, updatedAt: db.updatedAt || 0 };
    mapCache = { key: key, val: res };
    return res;
  }

  function resolvedTimes(c) {
    var t = c.timeline || [], first = 0;
    for (var i = 0; i < t.length; i++) if (/^Marked resolved/.test(t[i].label)) { first = t[i].ts; break; }
    return { first: first || null, last: resolvedAt(c) };
  }
  function resDays(c) { return (resolvedAt(c) - c.timestamp) / DAY; }
  function mean(arr) { return arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length * 10) / 10 : null; }

  var HEAT_METRICS = { total: 'all complaints', unresolved: 'unresolved complaints', urgent: 'urgent complaints that are still open', avg_resolution: 'average days to resolve', reopened: 'complaints reopened by citizens' };
  function heatData(f) {
    f = f || {};
    var v = viewer();
    if (!(v.u && can(v.u, 'map.work'))) throw E(v.u ? denyReason(v.u, 'map.work') : 'Please log in first.');
    var metric = HEAT_METRICS[f.metric] ? f.metric : 'total', rg = rangeOf(f);
    var pts = [], noGps = 0, cells = {}, used = 0;
    db.complaints.forEach(function (c) {
      if (!realRecord(c) || !isActive(c)) return;
      if (v.tier === 'official' && c.deptId !== v.u.deptId) return;
      if (f.cat && f.cat !== 'all' && c.category !== f.cat) return;
      if (f.dept && f.dept !== 'all' && v.tier === 'admin' && c.deptId !== f.dept) return;
      if (!inRange(c, rg)) return;
      if (metric === 'unresolved' && !isOpen(c)) return;
      if (metric === 'urgent' && !(isOpen(c) && c.priority === 'Urgent')) return;
      if (metric === 'avg_resolution' && isOpen(c)) return;
      if (metric === 'reopened' && !(c.reopenCount > 0)) return;
      var g = geoOf(c);
      if (!g) { noGps++; return; }                       // only real GPS points make heat, never a guessed city centre
      var w = metric === 'avg_resolution' ? Math.max(0.1, resDays(c)) : 1;
      pts.push({ lat: g.lat, lng: g.lng, w: w });
      used++;
      var k = Math.floor(g.lat / 0.01) + ',' + Math.floor(g.lng / 0.01);
      var cell = cells[k] || (cells[k] = { lat: 0, lng: 0, n: 0, sum: 0, names: {} });
      cell.n++; cell.sum += w; cell.lat += g.lat; cell.lng += g.lng;
      var nm = (c.manualLocationAddress ? c.manualLocationAddress + ', ' : '') + (c.city || c.district || c.state || '');
      cell.names[nm] = (cell.names[nm] || 0) + 1;
    });
    var list = Object.keys(cells).map(function (k) {
      var c = cells[k], name = Object.keys(c.names).sort(function (a, b) { return c.names[b] - c.names[a]; })[0] || 'Unnamed area';
      return { lat: c.lat / c.n, lng: c.lng / c.n, count: c.n, value: metric === 'avg_resolution' ? Math.round(c.sum / c.n * 10) / 10 : c.n, label: name };
    }).sort(function (a, b) { return b.value - a.value || b.count - a.count; });
    var max = list.length ? list[0].value : 0;
    list.forEach(function (h) { var t = max ? h.value / max : 0; h.level = t >= 0.66 ? 'high' : (t >= 0.33 ? 'medium' : 'low'); });
    return { points: pts, used: used, noGps: noGps, hotspots: list.slice(0, 5), metric: metric, metricLabel: HEAT_METRICS[metric], rangeLabel: rg.label,
      enough: used >= 3, tier: v.tier, updatedAt: db.updatedAt || 0 };
  }

  function bucketsFor(rg, valid) {
    var span = Math.max(1, Math.ceil((rg.to - rg.from) / DAY));
    var weekly = span > 31, unit = weekly ? 7 : 1, n = Math.ceil(span / unit), out = [];
    var start = rg.to - n * unit * DAY;
    for (var i = 0; i < n; i++) out.push({ from: start + i * unit * DAY, to: start + (i + 1) * unit * DAY, created: 0, resolved: 0 });
    valid.forEach(function (c) {
      var ib = Math.floor((c.timestamp - start) / (unit * DAY));
      if (ib >= 0 && ib < n) out[ib].created++;
      var r = resolvedTimes(c).first;
      if (r) { var jb = Math.floor((r - start) / (unit * DAY)); if (jb >= 0 && jb < n) out[jb].resolved++; }
    });
    out.forEach(function (b) { b.label = new Date(b.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); });
    return { unit: weekly ? 'week' : 'day', buckets: out };
  }

  function analytics(f) {
    need('admin.analytics');
    f = f || {};
    var rg = rangeOf({ range: f.range || '30', from: f.from, to: f.to });
    var level = ['state', 'district', 'city'].indexOf(f.level) >= 0 ? f.level : db.settings.areaLevel;
    var all = db.complaints.filter(function (c) { return realRecord(c) && inRange(c, rg); });
    var valid = all.filter(isActive);
    var resolved = valid.filter(function (c) { return !isOpen(c); });
    var total = valid.length;

    var catCount = {};
    valid.forEach(function (c) { catCount[c.category] = (catCount[c.category] || 0) + 1; });
    var categories = CATS.map(function (c) { return { id: c.id, name: c.name, count: catCount[c.id] || 0, pct: total ? Math.round((catCount[c.id] || 0) / total * 100) : 0 }; })
      .filter(function (c) { return c.count > 0; }).sort(function (a, b) { return b.count - a.count; });

    var work = [['Submitted', function (c) { return c.status === 'Submitted'; }], ['In progress', function (c) { return c.status === 'In progress'; }],
      ['Resolved', function (c) { return c.status === 'Resolved' || c.status === 'Closed'; }], ['Reopened', function (c) { return c.status === 'Reopened'; }]]
      .map(function (x) { return { label: x[0], count: valid.filter(x[1]).length }; });
    var moderation = {}; ['normal', 'flagged', 'under_review', 'verified', 'rejected', 'archived'].forEach(function (m) { moderation[m] = all.filter(function (c) { return modOf(c) === m; }).length; });

    function sla(list) {
      var rs = list.filter(function (c) { return !isOpen(c); }), within = 0, over = 0;
      rs.forEach(function (c) { var t = resolvedTimes(c).first || resolvedAt(c); if (t <= c.timestamp + c.slaDeadlineDays * DAY) within++; else over++; });
      var os = list.filter(isOpen), ow = 0, on = 0, oo = 0;
      os.forEach(function (c) {
        var due = slaFrom(c) + c.slaDeadlineDays * DAY, left = due - now();
        if (left <= 0) oo++; else if (left < c.slaDeadlineDays * DAY * 0.25) on++; else ow++;
      });
      return { resolved: { within: within, over: over, total: rs.length, pct: rs.length ? Math.round(within / rs.length * 100) : null }, open: { within: ow, near: on, over: oo, total: os.length } };
    }

    var departments = db.departments.map(function (d) {
      var list = valid.filter(function (c) { return c.deptId === d.id; });
      if (!list.length) return null;
      var rs = list.filter(function (c) { return !isOpen(c); }), s = sla(list), rt = deptRating(d.id);
      return { id: d.id, name: d.name, open: list.length - rs.length, resolved: rs.length, avgDays: mean(rs.map(resDays)), slaPct: s.resolved.pct, rating: rt.count ? rt : null };
    }).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var groups = {};
    valid.forEach(function (c) {
      var raw = String(c[level] || '').trim();
      var name = raw ? raw.replace(/\s+/g, ' ').replace(/\b\w/g, function (x) { return x.toUpperCase(); }) : 'Not given';
      var g = groups[name] || (groups[name] = []); g.push(c);
    });
    var areas = Object.keys(groups).map(function (n) {
      var list = groups[n], rs = list.filter(function (c) { return !isOpen(c); });
      return { name: n, reports: list.length, open: list.length - rs.length, urgent: list.filter(function (c) { return isOpen(c) && c.priority === 'Urgent'; }).length,
        rate: Math.round(rs.length / list.length * 100), avgDays: mean(rs.map(resDays)) };
    }).sort(function (a, b) { return b.reports - a.reports || a.name.localeCompare(b.name); });

    var tr = bucketsFor(rg, valid);
    return {
      range: rg, rangeKey: String(f.range || '30'), level: level, enough: total > 0, updatedAt: db.updatedAt || 0, isDemo: !!db.isDemo,
      totals: { total: total, open: total - resolved.length, resolved: resolved.length, urgent: valid.filter(function (c) { return isOpen(c) && c.priority === 'Urgent'; }).length,
        reopened: valid.filter(function (c) { return c.reopenCount > 0; }).length, avgResolutionDays: mean(resolved.map(resDays)), noGps: valid.filter(function (c) { return !geoOf(c); }).length },
      trend: tr, categories: categories, status: { work: work, moderation: moderation, moderationTotal: all.length }, sla: sla(valid), departments: departments, areas: areas
    };
  }

  /* admin: change how a report's location is shown publicly */
  function setLocationPrivacy(cid, level, reason) {
    var m = modCase(cid, reason), c = m.c;
    if (['approximate', 'hidden', 'exact'].indexOf(level) < 0) throw E('Choose how the location is shown.');
    if ((c.locationPrivacy || 'approximate') === level) throw E('The location is already shown that way.');
    var before = c.locationPrivacy || 'approximate';
    c.locationPrivacy = level;
    logMod(c, m.a, 'Map privacy set to "' + level + '"', m.reason);
    auditReport('report.location_privacy', c, m.reason, { from: before, to: level });
    save(); return c;
  }
  function dataAge() { return db.updatedAt || 0; }

  /* ---------- notifications (own) ---------- */
  function notificationsFor(userId) { return db.notifications.filter(function (n) { return n.userId === userId; }); }
  function unreadCount(userId) { return notificationsFor(userId).filter(function (n) { return !n.isRead; }).length; }
  function markAllRead(userId) { notificationsFor(userId).forEach(function (n) { n.isRead = true; }); save(); }
  function markRead(userId, id) { notificationsFor(userId).forEach(function (n) { if (n.id === id) n.isRead = true; }); save(); }

  /* Online, every change is applied here first (so the screen answers instantly) and is then sent to the
     database, which checks it again and has the final say. If the database refuses, the screen is put right. */
  var SYNCED = ['createComplaint', 'toggleUpvote', 'addComment', 'flagComplaint', 'startWork', 'resolve', 'transfer', 'escalate', 'confirmFix', 'disputeFix', 'submitVerificationInfo',
    'keepReport', 'markUnderReview', 'rejectReport', 'markDuplicate', 'archiveReport', 'restoreReport', 'setLocationPrivacy', 'warnUser', 'suspendUser', 'banUser', 'reinstateUser',
    'approveAuthority', 'rejectAuthority', 'requestInfo', 'suspendAuthority', 'reinstateAuthority', 'saveDepartment', 'setCategoryDept', 'saveSettings', 'markRead', 'markAllRead'];
  function synced(name, fn) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      if (!REMOTE) return fn.apply(null, args);
      var local = fn.apply(null, args);               // the same rules run here first, so mistakes are explained at once
      var p = REMOTE.command(name, args, local);
      return REMOTE.returnsPromise(name) ? p : local;
    };
  }

  window.DL = window.DL || {};
  window.DL.store = {
    CATS: CATS, STATES: STATES, STATUSES: STATUSES, FLAG_REASONS: FLAG_REASONS, REJECT_OUTCOMES: REJECT_OUTCOMES, MOD_LABELS: MOD_LABELS, ROLE_LABELS: ROLE_LABELS,
    cat: cat, init: init, mode: mode, isDemo: isDemo, startDemo: startDemo, exitDemo: exitDemo, resetDemo: resetDemo, hasAdmin: hasAdmin,
    me: me, can: function (perm) { return can(sessionUser(), perm); }, setupAdmin: setupAdmin, register: register, login: login, logout: logout, submitVerificationInfo: submitVerificationInfo,
    departments: departments, activeDepts: activeDepts, deptName: deptName, deptForCategory: deptForCategory,
    detectPriority: detectPriority, createComplaint: createComplaint, getComplaint: getComplaint, list: list, stats: stats, authorName: authorName,
    modOf: modOf, isActive: isActive, isOpen: isOpen, isLate: isLate, canView: function (c) { return canView(sessionUser(), c); }, canManage: function (u, c) { return canManage(sessionUser(), c); },
    hasUpvoted: hasUpvoted, toggleUpvote: toggleUpvote, commentsFor: commentsFor, addComment: addComment, hasFlagged: hasFlagged, flagComplaint: flagComplaint,
    auditInfo: auditInfo, confirmFix: confirmFix, disputeFix: disputeFix, sweepAudits: function () { var c = sweepAudits(); if (c) save(); return c; }, pendingChecks: pendingChecks, deptRating: deptRating, deptRatings: deptRatings, DISPUTE_REASONS: DISPUTE_REASONS,
    startWork: startWork, resolve: resolve, transfer: transfer, escalate: escalate, deskList: deskList, deskStats: deskStats,
    verifState: verifState, listAuthorities: listAuthorities, authCounts: authCounts, getAuthority: getAuthority, approveAuthority: approveAuthority, rejectAuthority: rejectAuthority,
    requestInfo: requestInfo, suspendAuthority: suspendAuthority, reinstateAuthority: reinstateAuthority,
    keepReport: keepReport, markUnderReview: markUnderReview, rejectReport: rejectReport, markDuplicate: markDuplicate, archiveReport: archiveReport, restoreReport: restoreReport,
    flagsFor: flagsFor, modQueue: modQueue, modCounts: modCounts,
    listUsers: listUsers, getUser: getUser, userReports: userReports, trustFor: trustFor, accountOf: accountOf, warnUser: warnUser, suspendUser: suspendUser, banUser: banUser, reinstateUser: reinstateUser,
    saveDepartment: saveDepartment, setCategoryDept: setCategoryDept, getSettings: getSettings, saveSettings: saveSettings,
    mapPoints: mapPoints, heatData: heatData, analytics: analytics, locationFor: locationFor, mapPriority: mapPriority, setLocationPrivacy: setLocationPrivacy, dataAge: dataAge, publicSettings: publicSettings, HEAT_METRICS: HEAT_METRICS,
    adminStats: adminStats, attention: attention, adminReports: adminReports, reporterInfo: reporterInfo, officerName: officerName, search: search,
    auditList: auditList, auditVerify: auditVerify, sysLog: sysLog, sysList: sysList, notifList: notifList,
    notificationsFor: notificationsFor, unreadCount: unreadCount, markAllRead: markAllRead, markRead: markRead
  };
  SYNCED.forEach(function (n) { if (window.DL.store[n]) window.DL.store[n] = synced(n, window.DL.store[n]); });
  window.DL.store.isRemote = function () { return !!REMOTE; };
  window.DL.store.requestPasswordReset = function (email) { return REMOTE ? REMOTE.auth.requestReset(email) : Promise.reject(new Error('Password reset works on the online version of the site.')); };
  window.DL.store.updatePassword = function (pw) { return REMOTE ? REMOTE.auth.updatePassword(pw) : Promise.reject(new Error('Password reset works on the online version of the site.')); };
})();
