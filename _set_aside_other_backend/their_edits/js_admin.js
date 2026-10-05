/* Disaster Lens – admin screens (Phase 4)
 * These pages only SHOW things and collect a reason. Every rule and every permission
 * check is in store.js, which refuses the action if the logged-in user is not allowed.
 */
(function () {
  var S = window.DL.store, U = window.DL.ui, V = window.DL.vhelp, esc = U.esc, btn = U.button, icon = U.icon;
  var wrap = V.wrap, sec = V.sec, alertBox = V.alertBox, friendly = V.friendly;

  /* ---------- guard: UI hint only, the store enforces it again on every call ---------- */
  function A(fn) {
    return function (ctx) {
      if (!ctx.me) return V.needLogin('Log in as an administrator to open this page.');
      if (ctx.me.role !== 'admin') return { html: wrap(U.emptyState({ icon: 'shield', title: 'This page is for administrators', text: 'You do not have access to it.', action: btn({ label: 'Go home', href: '#/', kind: 'primary' }) }), 'narrow') };
      try { return fn(ctx); } catch (ex) {
        console.error(ex); S.sysLog('error', 'admin', 'Admin page failed: ' + (ex && ex.message));
        return { html: wrap(U.emptyState({ icon: 'alert', title: 'This page could not open', text: friendly(ex, 'Something went wrong. Please try again.') }), 'narrow') };
      }
    };
  }

  function rerender() { window.DL.app.render(); }
  function qs(o) { var a = []; Object.keys(o).forEach(function (k) { if (o[k] !== '' && o[k] != null) a.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); }); return a.length ? '?' + a.join('&') : ''; }
  function ago(ts) { return U.ago(ts); }
  function searchBar(q) {
    return '<form class="gsearch" id="gs" role="search"><div class="search">' + icon('search') + '<label class="sr" for="gs-q">Search reports, people, departments and places</label>' +
      '<input type="search" id="gs-q" placeholder="Search reports, people, places" value="' + esc(q || '') + '"></div></form>';
  }
  function bindSearch(root) {
    var f = root.querySelector('#gs'); if (!f) return;
    f.addEventListener('submit', function (e) { e.preventDefault(); location.hash = '#/admin/search?q=' + encodeURIComponent(root.querySelector('#gs-q').value.trim()); });
  }
  function stat(n, label, href, hot) { return '<a class="stat' + (hot && n ? ' hot' : '') + '" href="' + href + '"><b>' + n + '</b><span>' + label + '</span></a>'; }
  function tabs(items, cur, base, extra) {
    return '<nav class="tabs" aria-label="Filter">' + items.map(function (t) {
      return '<a href="' + base + qs(Object.assign({}, extra || {}, { [t[2] || 't']: t[0] })) + '"' + (t[0] === cur ? ' aria-current="true"' : '') + '>' + t[1] + (t[3] != null ? ' <span class="tab-n">' + t[3] + '</span>' : '') + '</a>';
    }).join('') + '</nav>';
  }
  function trustBadge(t) {
    var tone = t.status === 'Good standing' ? 'good' : (t.status === 'Needs watching' ? 'warn' : 'danger');
    return '<span class="badge tone-' + tone + '">' + icon(tone === 'good' ? 'check' : 'alert') + '<span>' + t.status + '</span></span>';
  }
  function acctBadge(u) {
    var a = S.accountOf(u);
    if (a.status === 'banned') return '<span class="badge tone-danger-solid">' + icon('x') + '<span>Banned</span></span>';
    if (a.status === 'suspended') return '<span class="badge tone-danger">' + icon('clock') + '<span>Suspended until ' + U.dateOnly(a.until) + '</span></span>';
    return '';
  }
  var VERIF_LABEL = { pending: ['Waiting for review', 'warn', 'clock'], info_requested: ['Waiting for the official\'s reply', 'warn', 'info'], approved: ['Approved', 'good', 'check'], rejected: ['Not approved', 'danger', 'x'], suspended: ['Suspended', 'danger', 'alert'] };
  function verifBadge(u) { var v = VERIF_LABEL[S.verifState(u)] || VERIF_LABEL.pending; return '<span class="badge tone-' + v[1] + '">' + icon(v[2]) + '<span>' + v[0] + '</span></span>'; }

  var VERBS = { 'report.keep': 'cleared', 'report.review': 'put under review', 'report.reject': 'rejected', 'report.duplicate': 'marked as a duplicate:', 'report.archive': 'archived', 'report.restore': 'restored',
    'report.reassign': 'moved to another department:', 'report.location_privacy': 'changed the map privacy of', 'user.warn': 'warned', 'user.suspend': 'suspended', 'user.ban': 'banned', 'user.reinstate': 'reinstated',
    'authority.approve': 'approved official', 'authority.reject': 'did not approve official', 'authority.request_info': 'asked for more information from', 'authority.suspend': 'suspended official',
    'authority.reinstate': 'restored official', 'department.create': 'added department', 'department.update': 'edited department', 'department.routing': 'changed where reports go for',
    'settings.update': 'changed', 'setup.admin_created': 'created the first administrator' };
  function sentence(e) { return esc(e.adminName) + ' ' + (VERBS[e.action] || e.action) + (e.targetLabel ? ' <strong>' + esc(e.targetLabel) + '</strong>' : ''); }

  /* reason dialog used by every admin decision */
  function reasonDialog(o) {
    U.dialog({
      title: o.title,
      body: '<form id="rd" novalidate>' + (o.text ? '<p class="dlg-text">' + esc(o.text) + '</p>' : '') + (o.extra || '') +
        U.field({ id: 'rd-r', label: o.reasonLabel || 'Reason', tag: 'textarea', rows: 3, required: true, hint: o.hint || 'This is saved in the audit log.', value: o.prefill || '', attrs: 'maxlength="300"' }) +
        '<div class="dlg-foot">' + btn({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) + btn({ label: o.confirm, kind: o.danger ? 'danger' : 'primary', type: 'submit', id: 'rd-go' }) + '</div></form>',
      onMount: function (root, close) {
        if (o.onOpen) o.onOpen(root);
        root.querySelector('#rd').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var reason = root.querySelector('#rd-r').value;
          if (reason.trim().length < 5) { U.showError(root, 'rd-r', 'Write a reason of at least 5 characters.'); root.querySelector('#rd-r').focus(); return; }
          var go = root.querySelector('#rd-go'); U.setBusy(go, true, o.busy || 'Saving…');
          U.attempt(function () { return o.run(reason, root); }).then(function () { close(); U.toast(o.done, 'good'); (o.after || rerender)(); })
            .catch(function (ex) { U.setBusy(go, false); U.showError(root, o.errId || 'rd-r', friendly(ex, 'This could not be saved. Please try again.')); });
        });
      }
    });
  }

  /* ================= dashboard ================= */
  var dashboard = A(function () {
    var st = S.adminStats(), at = S.attention(), pend = S.listAuthorities('pending').slice(0, 3), recent = S.auditList({}).slice(0, 6);
    var r = st.reports, m = st.moderation, a = st.authorities;
    var attn = at.items.length
      ? '<ul class="attn">' + at.items.map(function (i) {
        return '<li><div><span class="kind">' + esc(i.kind) + '</span><strong>' + esc(i.title) + '</strong><span class="muted">' + esc(i.detail) + '</span></div>' + btn({ label: i.action, href: i.href, kind: 'primary', small: true }) + '</li>';
      }).join('') + '</ul>' + (at.total > at.items.length ? '<p class="more muted">' + (at.total - at.items.length) + ' more waiting. Open Moderation or Authorities to see them.</p>' : '')
      : U.emptyState({ icon: 'check', title: r.total === 0 ? 'No reports yet' : 'Nothing needs your attention', text: r.total === 0 ? 'Reports submitted by citizens will appear here.' : "You're all caught up." });
    return {
      html: wrap(U.pageHeader({ title: 'Admin dashboard', sub: 'What needs your attention right now' }) + searchBar() +
        sec('Needs attention', attn) +
        sec('Reports', '<div class="stats">' + stat(r.total, 'Total', '#/admin/reports?f=active') + stat(r.fresh, 'New today', '#/admin/reports?f=new') + stat(r.open, 'Open', '#/admin/reports?f=open') +
          stat(r.urgent, 'Urgent', '#/admin/reports?f=urgent', true) + stat(r.late, 'Late', '#/admin/reports?f=late', true) + stat(r.resolved, 'Resolved', '#/admin/reports?f=resolved') + stat(r.flagged, 'Flagged', '#/admin/reports?f=flagged', true) + '</div>') +
        sec('Moderation', '<div class="stats">' + stat(m.pending, 'Pending review', '#/admin/moderation?t=pending', true) + stat(m.flagged, 'Flagged reports', '#/admin/moderation?t=flagged', true) +
          stat(m.suspended, 'Suspended users', '#/admin/citizens?f=suspended') + stat(m.banned, 'Banned users', '#/admin/citizens?f=banned') + '</div>') +
        sec('Authority verification', '<div class="stats">' + stat(a.pending, 'Pending', '#/admin/authorities?t=pending', true) + stat(a.approved, 'Approved', '#/admin/authorities?t=approved') + stat(a.rejected, 'Rejected', '#/admin/authorities?t=rejected') + '</div>' +
          (pend.length ? '<ul class="rlist rlist-gap">' + pend.map(function (u) { return '<li><a class="rc" href="#/admin/authorities/' + u.id + '"><div class="rc-main"><div class="rc-badges">' + verifBadge(u) + '</div><h3 class="rc-title">' + esc(u.name) + '</h3><p class="rc-meta">' + esc(u.department) + ' · ' + esc(u.authorityRole || 'Official') + ' · sent ' + ago(u.verification.submittedAt) + '</p></div>' + icon('right', 'rc-go') + '</a></li>'; }).join('') + '</ul>' : '')) +
        '<p class="more">' + btn({ label: 'Open insights (analytics, map, heatmap)', href: '#/admin/insights', icon: 'dash', kind: 'secondary', block: true }) + '</p>' +
        sec('Recent activity', recent.length ? '<ul class="loglist">' + recent.map(function (e) { return '<li>' + sentence(e) + '<span class="muted"> · ' + ago(e.ts) + '</span></li>'; }).join('') + '</ul><p class="more">' + btn({ label: 'Open all logs', href: '#/admin/logs', kind: 'quiet' }) + '</p>'
          : '<p class="muted">Admin actions will be listed here.</p>')),
      mount: bindSearch
    };
  });

  /* ================= reports list ================= */
  var CHIPS = [['all', 'All'], ['new', 'New'], ['open', 'Open'], ['urgent', 'Urgent'], ['late', 'Late'], ['resolved', 'Resolved'], ['flagged', 'Flagged'], ['review', 'Under review'], ['rejected', 'Rejected'], ['escalated', 'Escalated']];
  var reports = A(function (ctx) {
    var q = ctx.query, f = q.f || 'all', limit = Math.max(40, Number(q.n) || 40);
    var filt = { f: f, q: q.q || '', dept: q.dept || '', cat: q.cat || '', status: q.status || '', from: q.from || '', to: q.to || '', loc: q.loc || '', reporter: q.reporter || '' };
    var all = S.adminReports(filt), items = all.slice(0, limit);
    var extraOpen = q.q || q.dept || q.cat || q.status || q.from || q.to || q.loc || q.reporter;
    var keep = Object.assign({}, filt); delete keep.f;
    var rows = items.map(function (c) {
      var rep = S.reporterInfo(c);
      return U.reportCard(c, { admin: true, id: true, href: '#/admin/r/' + c.id, extra: esc(c.assignedDepartment) + (rep ? ' · by ' + esc(rep.name) : ''), late: true });
    }).join('');
    return {
      html: wrap(U.pageHeader({ title: 'Reports', sub: 'Every report, including those under moderation.' }) + searchBar() +
        '<nav class="tabs" aria-label="Report filter">' + CHIPS.map(function (c) { return '<a href="#/admin/reports' + qs(Object.assign({}, keep, { f: c[0] })) + '"' + (c[0] === f || (f === 'active' && c[0] === 'all') ? ' aria-current="true"' : '') + '>' + c[1] + '</a>'; }).join('') + '</nav>' +
        '<form class="filters" id="rf" novalidate><details class="more-f"' + (extraOpen ? ' open' : '') + '><summary>More filters</summary><div class="f-grid">' +
          U.field({ id: 'rf-q', label: 'Search', value: filt.q, hint: 'Report number, title, description, reporter or place.' }) +
          U.field({ id: 'rf-dept', label: 'Department', tag: 'select', optionsHtml: '<option value="">Any</option>' + U.opts(S.departments(), filt.dept, function (d) { return d.id; }, function (d) { return d.name; }) }) +
          U.field({ id: 'rf-cat', label: 'Category', tag: 'select', optionsHtml: '<option value="">Any</option>' + U.opts(S.CATS, filt.cat, function (c) { return c.id; }, function (c) { return c.name; }) }) +
          U.field({ id: 'rf-status', label: 'Status', tag: 'select', optionsHtml: '<option value="">Any</option>' + U.opts(S.STATUSES, filt.status, function (x) { return x; }, function (x) { return x; }) }) +
          U.field({ id: 'rf-loc', label: 'Location', value: filt.loc, hint: 'Street, city, district or state.' }) +
          U.field({ id: 'rf-rep', label: 'Reporter', value: filt.reporter, hint: 'Name or email.' }) +
          U.field({ id: 'rf-from', label: 'From date', type: 'date', value: filt.from }) + U.field({ id: 'rf-to', label: 'To date', type: 'date', value: filt.to }) +
        '</div><div class="stack-row">' + btn({ label: 'Apply filters', type: 'submit', kind: 'primary' }) + btn({ label: 'Clear', href: '#/admin/reports?f=' + f, kind: 'quiet' }) + '</div></details></form>' +
        '<p class="result-n" aria-live="polite">' + all.length + (all.length === 1 ? ' report' : ' reports') + '</p>' +
        (items.length ? '<ul class="rlist">' + rows + '</ul>' : U.emptyState({ icon: 'file', title: 'No reports yet', text: extraOpen || f !== 'all' ? 'Nothing matches these filters.' : 'Reports submitted by citizens will appear here.' })) +
        (all.length > items.length ? '<p class="more">' + btn({ label: 'Show more', href: '#/admin/reports' + qs(Object.assign({}, filt, { n: limit + 40 })), kind: 'secondary' }) + '</p>' : '')),
      mount: function (root) {
        bindSearch(root);
        root.querySelector('#rf').addEventListener('submit', function (e) {
          e.preventDefault();
          var v = function (id) { return root.querySelector(id).value.trim(); };
          location.hash = '#/admin/reports' + qs({ f: f, q: v('#rf-q'), dept: v('#rf-dept'), cat: v('#rf-cat'), status: v('#rf-status'), loc: v('#rf-loc'), reporter: v('#rf-rep'), from: v('#rf-from'), to: v('#rf-to') });
        });
      }
    };
  });

  /* ================= one report: moderation detail ================= */
  function openReject(c) {
    reasonDialog({ title: 'Reject this report', text: 'The report leaves the active workload, public lists and all statistics. It stays in the audit record. The reporter is told.', confirm: 'Reject report', danger: true,
      extra: '<fieldset class="radios"><legend>Why is it rejected?</legend>' + S.REJECT_OUTCOMES.map(function (o, i) { return '<label class="radio"><input type="radio" name="oc" value="' + o.id + '"' + (i === 0 ? ' checked' : '') + '><span>' + o.label + '</span></label>'; }).join('') +
        '<p class="hint">Only "Fake report" and "Spam" lower the reporter\'s trust.</p></fieldset>',
      run: function (reason, root) { return S.rejectReport(c.id, root.querySelector('input[name=oc]:checked').value, reason); }, done: 'Report rejected. The reporter was told.' });
  }
  function openDuplicate(c) {
    reasonDialog({ title: 'Mark as duplicate', text: 'The original stays as it is. This report is linked to it and leaves the active workload.', confirm: 'Mark as duplicate',
      extra: U.field({ id: 'dp-o', label: 'Original report number', required: true, hint: 'The number after DL-, for example 12.', attrs: 'inputmode="numeric"' }),
      errId: 'dp-o', run: function (reason, root) { return S.markDuplicate(c.id, root.querySelector('#dp-o').value, reason); }, done: 'Linked as a duplicate.' });
  }
  function openUserAction(kind, u, after) {
    var cfg = {
      warn: { title: 'Send a warning', text: 'The citizen gets a notification with your reason. Their access does not change.', confirm: 'Send warning', done: 'Warning sent.', run: function (r) { return S.warnUser(u.id, r); } },
      suspend: { title: 'Suspend this citizen', text: 'They keep their old reports but cannot post, comment or flag until the date ends. Only suspend when there is evidence of abuse.', confirm: 'Suspend', danger: true, done: 'Citizen suspended.',
        extra: U.field({ id: 'sp-d', label: 'For how long', tag: 'select', required: true, optionsHtml: [1, 3, 7, 14, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === 7 ? ' selected' : '') + '>' + d + (d === 1 ? ' day' : ' days') + '</option>'; }).join('') }),
        run: function (r, root) { return S.suspendUser(u.id, root.querySelector('#sp-d').value, r); } },
      ban: { title: 'Ban this citizen permanently', text: 'They will not be able to log in again unless you reinstate them. This is the strongest action, so please be sure.', confirm: 'Ban permanently', danger: true, done: 'Citizen banned.',
        extra: U.field({ id: 'bn-c', label: 'Type BAN to confirm', required: true, attrs: 'autocomplete="off"' }), errId: 'bn-c',
        run: function (r, root) { return S.banUser(u.id, r, root.querySelector('#bn-c').value.trim()); } },
      reinstate: { title: 'Restore this account', text: 'The citizen can use the site normally again.', confirm: 'Restore account', done: 'Account restored.', run: function (r) { return S.reinstateUser(u.id, r); } }
    }[kind];
    reasonDialog({ title: cfg.title, text: cfg.text, confirm: cfg.confirm, danger: cfg.danger, extra: cfg.extra, errId: cfg.errId, done: cfg.done, run: cfg.run, after: after });
  }

  var report = A(function (ctx) {
    var c = S.getComplaint(ctx.params[0]);
    if (!c) return { html: wrap(U.emptyState({ icon: 'search', title: 'Report not found', action: btn({ label: 'Back to reports', href: '#/admin/reports', kind: 'primary' }) }), 'narrow') };
    var ms = S.modOf(c), rep = S.reporterInfo(c), ru = rep ? S.getUser(rep.id) : null, tr = rep ? S.trustFor(rep.id) : null;
    var flags = S.flagsFor(c.id), cat = U.cat(c.category);
    var reasons = {}; flags.forEach(function (f) { reasons[f.reason] = (reasons[f.reason] || 0) + 1; });
    var reasonText = Object.keys(reasons).map(function (k) { return k + ' ×' + reasons[k]; }).join(', ');
    var officer = S.officerName(c);

    var intro = {
      normal: '', flagged: alertBox('info', '<strong>Flagged by ' + c.flagCount + ' ' + (c.flagCount === 1 ? 'person' : 'people') + '.</strong><p>A flag is a request to look, not a decision. The report is still active.</p>'),
      under_review: alertBox('info', '<strong>This report needs a decision.</strong><p>It is hidden from the public list and from officials until you decide.</p>'),
      verified: alertBox('good', '<strong>Cleared.</strong><p>' + esc(c.modReason) + '</p>'),
      rejected: alertBox('danger', '<strong>' + (c.modOutcome === 'duplicate' ? 'Duplicate of <a class="link" href="#/admin/r/' + c.duplicateOf + '">DL-' + c.duplicateOf + '</a>' : 'Rejected: ' + esc((S.REJECT_OUTCOMES.filter(function (o) { return o.id === c.modOutcome; })[0] || { label: 'invalid' }).label)) + '.</strong><p>' + esc(c.modReason) + '</p>'),
      archived: alertBox('info', '<strong>Archived.</strong><p>' + esc(c.modReason) + '</p>')
    }[ms];

    var facts = '<dl class="facts"><div><dt>Report ID</dt><dd>DL-' + c.id + '</dd></div><div><dt>Category</dt><dd>' + esc(cat.name) + '</dd></div>' +
      '<div><dt>Location</dt><dd>' + esc([c.manualLocationAddress, c.city, c.district, c.state, c.pincode].filter(Boolean).join(', ')) + '</dd></div>' +
      '<div><dt>Created</dt><dd>' + U.dateTime(c.timestamp) + '</dd></div>' +
      '<div><dt>Reporter</dt><dd>' + (rep ? '<a class="link" href="#/admin/citizens/' + rep.id + '">' + esc(rep.name) + '</a> · ' + esc(rep.email) : 'Unknown') + (c.isAnonymous ? '<br><span class="muted small">Hidden from the public (anonymous report)</span>' : '') + '</dd></div>' +
      '<div><dt>Status</dt><dd>' + U.statusBadge(c) + '</dd></div><div><dt>Department</dt><dd>' + esc(c.assignedDepartment) + '</dd></div>' +
      '<div><dt>Assigned official</dt><dd>' + (officer ? esc(officer) : '<span class="muted">Nobody has started work</span>') + '</dd></div>' +
      '<div><dt>Map location</dt><dd>' + esc(({ approximate: 'General area only on the public map', hidden: 'Hidden from the public map', exact: 'Exact spot on the public map' })[c.locationPrivacy || 'approximate']) + (c.latitude != null ? '' : ' <span class="muted">(this report has no GPS point)</span>') + '</dd></div>' +
      '<div><dt>Response time</dt><dd>' + esc(U.slaText(c)) + (S.isActive(c) ? '' : ' <span class="muted">(not counted while removed)</span>') + '</dd></div></dl>';

    var flagList = flags.length ? '<ul class="loglist">' + flags.map(function (f) { return '<li><strong>' + esc(f.reason) + '</strong> · flagged by ' + esc(f.userName) + '<span class="muted"> · ' + ago(f.ts) + '</span>' + (f.note ? '<p>' + esc(f.note) + '</p>' : '') + '</li>'; }).join('') + '</ul>'
      : '<p class="muted">Nobody has flagged this report.</p>';
    var modLog = c.modLog.length ? '<ul class="loglist">' + c.modLog.map(function (l) { return '<li><strong>' + esc(l.action) + '</strong> · ' + esc(l.by) + '<span class="muted"> · ' + U.dateTime(l.ts) + '</span>' + (l.note ? '<p>' + esc(l.note) + '</p>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">No earlier moderation on this report.</p>';
    var trust = tr ? '<div class="trustline">' + trustBadge(tr) + '<span>Score ' + tr.score + ' of 100</span><span class="muted">' + tr.counts.fake + ' fake · ' + tr.counts.spam + ' spam · ' + tr.counts.duplicate + ' duplicate · ' + tr.counts.warnings + ' warning' + (tr.counts.warnings === 1 ? '' : 's') + '</span></div>' : '';

    function act(id, label, help, kind) { return '<li>' + btn({ label: label, id: id, kind: kind || 'secondary', block: true }) + '<p class="muted small">' + help + '</p></li>'; }
    var actions = '';
    if (ms === 'rejected' || ms === 'archived') actions = act('m-restore', 'Restore report', 'Bring it back as a normal report. Any trust effect from the rejection is reversed.', 'primary');
    else {
      actions = (ms === 'verified' ? '' : act('m-keep', 'Keep report', 'The report is legitimate. It returns to normal.', 'primary')) +
        (ms === 'under_review' ? '' : act('m-review', 'Mark under review', 'Hide it from the public list and officials while you check.')) +
        act('m-reject', 'Reject report', 'It is invalid, fake or spam. It leaves the workload and statistics.') +
        act('m-dup', 'Mark as duplicate', 'Link it to an earlier report and remove it from the workload.') +
        act('m-arch', 'Remove or archive', 'Use only when appropriate, for example a test report or a request from the reporter.') + act('m-loc', 'Change map privacy', 'Choose whether the public map shows the general area, the exact spot or nothing for this report.') + (ms === 'under_review' && false ? '' : '');
    }
    var reporterAct = ru ? '<h3 class="sub-h">The reporter</h3><p class="muted small">Do not act on one flag alone. Warn or suspend only when there is evidence of abuse.</p><div class="stack-row">' +
      btn({ label: 'Warn reporter', id: 'u-warn', small: true }) + (S.accountOf(ru).status === 'active' ? btn({ label: 'Suspend reporter', id: 'u-susp', small: true }) : '') + btn({ label: 'Open citizen', href: '#/admin/citizens/' + ru.id, small: true, kind: 'quiet' }) + '</div>' : '';

    return {
      html: wrap('<header class="ph ph-detail"><a class="ph-back" href="#/admin/reports">' + icon('left') + '<span>Reports</span></a><h1 id="page-title" tabindex="-1">' + esc(c.title) + '</h1>' +
        '<div class="rc-badges">' + U.urgentBadge(c) + U.statusBadge(c, true) + U.modBadge(c, true) + (ms !== 'normal' && ms !== 'flagged' && ms !== 'verified' ? '<span class="badge tone-neutral">' + icon('eye') + '<span>' + S.MOD_LABELS[ms] + '</span></span>' : '') + U.lateBadge(c) + '</div></header>' +
        intro +
        sec('Report', facts + '<p class="body">' + esc(c.description) + '</p>' + (c.imageUrlProof ? '<img class="photo" ' + U.src(c.imageUrlProof) + ' alt="Photo sent with the report">' : '') +
          (c.resolutionProofUrl ? '<h3 class="sub-h">Photo of the finished work</h3><img class="photo" ' + U.src(c.resolutionProofUrl) + ' alt="Photo of the finished work">' : '') +
          '<p class="more">' + btn({ label: 'Open the public report page', href: '#/c/' + c.id, kind: 'quiet', small: true }) + '</p>') +
        sec('Moderation', '<dl class="facts"><div><dt>Moderation status</dt><dd>' + esc(S.MOD_LABELS[ms]) + '</dd></div><div><dt>Flags</dt><dd>' + c.flagCount + (reasonText ? ' · ' + esc(reasonText) : '') + '</dd></div></dl>' +
          '<h3 class="sub-h">Who flagged it and why</h3>' + flagList + '<h3 class="sub-h">Earlier moderation</h3>' + modLog + '<h3 class="sub-h">Reporter standing</h3>' + (trust || '<p class="muted">Not available.</p>')) +
        sec('Decision', '<ul class="act-list">' + actions + '</ul>' + reporterAct) +
        (c.audit || c.disputes ? sec('Citizen check', '<dl class="facts"><div><dt>Result</dt><dd>' + esc(({ confirmed: 'Confirmed fixed', disputed: 'Reopened', auto_closed: 'Closed automatically (no reply)', pending: 'Waiting for the citizen' })[(c.audit || {}).state] || '') + '</dd></div>' +
          (c.audit && c.audit.rating ? '<div><dt>Rating</dt><dd>' + U.stars(c.audit.rating) + (c.audit.comment ? '<br>' + esc(c.audit.comment) : '') + '</dd></div>' : '') +
          '<div><dt>Times reopened</dt><dd>' + (c.reopenCount || 0) + '</dd></div></dl>' + ((c.disputes || []).length ? '<ul class="loglist">' + c.disputes.map(function (d) { return '<li><strong>' + esc(d.reason) + '</strong><span class="muted"> · ' + U.dateTime(d.ts) + '</span><p>' + esc(d.note) + '</p></li>'; }).join('') + '</ul>' : '')) : '') +
        sec('Progress', U.timeline(c))),
      mount: function (root) {
        var on = function (id, fn) { var b = root.querySelector(id); if (b) b.addEventListener('click', fn); };
        on('#m-keep', function () { reasonDialog({ title: 'Keep this report', text: 'The report is legitimate. Flags stay on record, but the report returns to normal.', confirm: 'Keep report', prefill: 'Checked: the report is legitimate.', run: function (r) { return S.keepReport(c.id, r); }, done: 'Report cleared.' }); });
        on('#m-review', function () { reasonDialog({ title: 'Mark under review', text: 'It will be hidden from the public list and from officials until you decide. The reporter is told it is being checked.', confirm: 'Mark under review', run: function (r) { return S.markUnderReview(c.id, r); }, done: 'Marked under review.' }); });
        on('#m-reject', function () { openReject(c); });
        on('#m-dup', function () { openDuplicate(c); });
        on('#m-arch', function () { reasonDialog({ title: 'Remove or archive', text: 'The report leaves the active workload and statistics and is kept in the record. The reporter is told. This does not lower their trust.', confirm: 'Archive report', run: function (r) { return S.archiveReport(c.id, r); }, done: 'Report archived.' }); });
        on('#m-loc', function () {
          var cur = c.locationPrivacy || 'approximate';
          reasonDialog({ title: 'Map privacy for this report', text: 'Officials and admins always see the exact spot. This changes only what the public map shows.', confirm: 'Save',
            extra: '<fieldset class="radios"><legend>The public map shows</legend>' + [['approximate', 'The general area (recommended)'], ['hidden', 'Nothing: hide it from the public map'], ['exact', 'The exact spot (only for public places)']].map(function (o) { return '<label class="radio"><input type="radio" name="lp" value="' + o[0] + '"' + (o[0] === cur ? ' checked' : '') + '><span>' + o[1] + '</span></label>'; }).join('') + '</fieldset>',
            run: function (r, root) { return S.setLocationPrivacy(c.id, root.querySelector('input[name=lp]:checked').value, r); }, done: 'Map privacy updated.' });
        });
        on('#m-restore', function () { reasonDialog({ title: 'Restore this report', text: 'It becomes a normal active report again.', confirm: 'Restore report', run: function (r) { return S.restoreReport(c.id, r); }, done: 'Report restored.' }); });
        on('#u-warn', function () { openUserAction('warn', ru); });
        on('#u-susp', function () { openUserAction('suspend', ru); });
      }
    };
  });

  /* ================= fake & spam desk ================= */
  var moderation = A(function (ctx) {
    var t = ctx.query.t || 'pending', cn = S.modCounts();
    var TABS = [['pending', 'Pending review', 't', cn.pending], ['flagged', 'Flagged', 't', cn.flagged], ['fake', 'Confirmed fake', 't', cn.fake], ['duplicates', 'Duplicates', 't', cn.duplicates], ['cleared', 'Cleared', 't', cn.cleared]];
    var items = S.modQueue(t);
    var EMPTY = { pending: ['No reports need review', "You're all caught up."], flagged: ['No flagged reports', 'Reports that people flag will appear here.'], fake: ['No confirmed fake reports', 'Reports you reject will be listed here.'],
      duplicates: ['No duplicates', 'Reports you link to an earlier one will be listed here.'], cleared: ['Nothing cleared yet', 'Reports you checked and kept will be listed here.'] }[t] || ['Nothing here', ''];
    return {
      html: wrap(U.pageHeader({ title: 'Fake & spam desk', sub: 'A flag asks for a look. Only you decide.' }) + tabs(TABS, t, '#/admin/moderation') +
        (items.length ? '<ul class="rlist">' + items.map(function (c) {
          var fl = S.flagsFor(c.id), top = fl[0], rep = S.reporterInfo(c);
          return U.reportCard(c, { admin: true, id: true, href: '#/admin/r/' + c.id, late: false, extra: (c.flagCount ? 'flagged by ' + c.flagCount + (top ? ' (' + esc(top.reason) + ')' : '') : esc(c.modReason || '')) + (rep ? ' · reporter ' + esc(rep.name) : '') });
        }).join('') + '</ul>' : U.emptyState({ icon: 'check', title: EMPTY[0], text: EMPTY[1] })))
    };
  });

  /* ================= authorities ================= */
  var authorities = A(function (ctx) {
    var t = ctx.query.t || 'pending', cn = S.authCounts();
    var TABS = [['pending', 'Pending', 't', cn.pending], ['approved', 'Approved', 't', cn.approved], ['rejected', 'Rejected', 't', cn.rejected], ['suspended', 'Suspended', 't', cn.suspended]];
    var items = S.listAuthorities(t);
    return {
      html: wrap(U.pageHeader({ title: 'Authority verification', sub: 'Officials can only work after you approve them.' }) + tabs(TABS, t, '#/admin/authorities') +
        (items.length ? '<ul class="rlist">' + items.map(function (u) {
          return '<li><a class="rc" href="#/admin/authorities/' + u.id + '"><div class="rc-main"><div class="rc-badges">' + verifBadge(u) + (u.idProof ? '<span class="badge tone-neutral">' + icon('file') + '<span>ID details provided</span></span>' : '<span class="badge tone-danger">' + icon('alert') + '<span>No ID details</span></span>') + '</div>' +
            '<h3 class="rc-title">' + esc(u.name) + '</h3><p class="rc-meta">' + esc(u.department) + ' · ' + esc(u.authorityRole || 'Official') + ' · sent ' + U.dateOnly(u.verification.submittedAt) + '</p></div>' + icon('right', 'rc-go') + '</a></li>';
        }).join('') + '</ul>' : U.emptyState({ icon: 'shield', title: t === 'pending' ? 'No officials are waiting' : 'Nothing here', text: t === 'pending' ? "You're all caught up." : 'Officials with this status will appear here.' })))
    };
  });

  var authority = A(function (ctx) {
    var u = S.getAuthority(ctx.params[0]);
    if (!u) return { html: wrap(U.emptyState({ icon: 'search', title: 'Official not found', action: btn({ label: 'Back', href: '#/admin/authorities', kind: 'primary' }) }), 'narrow') };
    var st = S.verifState(u), v = u.verification;
    var acts = '';
    if (st === 'pending') acts = btn({ label: 'Approve', id: 'a-ok', kind: 'primary', block: true }) + btn({ label: 'Request more information', id: 'a-info', block: true }) + btn({ label: 'Reject', id: 'a-no', block: true });
    if (st === 'info_requested') acts = '<p class="muted">Waiting for the official to reply. You can still decide now.</p>' + btn({ label: 'Approve', id: 'a-ok', kind: 'primary', block: true }) + btn({ label: 'Reject', id: 'a-no', block: true });
    if (st === 'approved') acts = btn({ label: 'Revoke access (suspend)', id: 'a-susp', kind: 'secondary', block: true });
    if (st === 'suspended') acts = btn({ label: 'Restore access', id: 'a-re', kind: 'primary', block: true });
    if (st === 'rejected') acts = '<p class="muted">The official can send new details, which puts the application back in the waiting list.</p>';
    return {
      html: wrap('<header class="ph ph-detail"><a class="ph-back" href="#/admin/authorities">' + icon('left') + '<span>Authority verification</span></a><h1 id="page-title" tabindex="-1">' + esc(u.name) + '</h1><div class="rc-badges">' + verifBadge(u) + '</div></header>' +
        sec('Details', '<dl class="facts"><div><dt>Department</dt><dd>' + esc(u.department) + '</dd></div><div><dt>Designation</dt><dd>' + esc(u.authorityRole || '') + '</dd></div><div><dt>Email</dt><dd>' + esc(u.email) + '</dd></div>' +
          (u.phone ? '<div><dt>Mobile</dt><dd>' + esc(u.phone) + '</dd></div>' : '') + '<div><dt>Location</dt><dd>' + esc([u.city, u.district, u.state].filter(Boolean).join(', ')) + '</dd></div><div><dt>Application sent</dt><dd>' + U.dateTime(v.submittedAt) + '</dd></div></dl>') +
        sec('ID proof', '<div class="idbox">' + (u.idProof ? esc(u.idProof) : '<span class="muted">No ID details were sent.</span>') + '</div>' +
          (v.supporting.length ? '<h3 class="sub-h">Supporting information</h3><ul class="loglist">' + v.supporting.map(function (x) { return '<li>' + esc(x.text) + '<span class="muted"> · ' + U.dateTime(x.ts) + '</span></li>'; }).join('') + '</ul>' : '')) +
        sec('Decision', '<div class="act-stack">' + acts + '</div>') +
        sec('History', '<ul class="loglist">' + v.history.map(function (h) { return '<li><strong>' + esc((VERIF_LABEL[h.status] || [h.status])[0]) + '</strong> · ' + esc(h.by) + '<span class="muted"> · ' + U.dateTime(h.ts) + '</span>' + (h.note ? '<p>' + esc(h.note) + '</p>' : '') + '</li>'; }).join('') + '</ul>')),
      mount: function (root) {
        var on = function (id, fn) { var b = root.querySelector(id); if (b) b.addEventListener('click', fn); };
        on('#a-ok', function () { reasonDialog({ title: 'Approve this official', text: 'They can open the desk for ' + u.department + ' and work on its reports.', confirm: 'Approve', prefill: 'ID checked.', run: function (r) { return S.approveAuthority(u.id, r); }, done: 'Official approved.' }); });
        on('#a-no', function () { reasonDialog({ title: 'Do not approve', text: 'They will not be able to do official work. They will see your reason.', confirm: 'Reject application', danger: true, reasonLabel: 'Reason the official will see', run: function (r) { return S.rejectAuthority(u.id, r); }, done: 'Application rejected.' }); });
        on('#a-info', function () { reasonDialog({ title: 'Ask for more information', text: 'The official sees your question and can reply.', confirm: 'Send request', reasonLabel: 'What do you need?', hint: 'Be specific, for example: please send your ID number.', run: function (r) { return S.requestInfo(u.id, r); }, done: 'Request sent.' }); });
        on('#a-susp', function () { reasonDialog({ title: 'Revoke official access', text: 'They will not be able to do official work until you restore access. Reports they started stay as they are.', confirm: 'Revoke access', danger: true, run: function (r) { return S.suspendAuthority(u.id, r); }, done: 'Access revoked.' }); });
        on('#a-re', function () { reasonDialog({ title: 'Restore official access', confirm: 'Restore access', run: function (r) { return S.reinstateAuthority(u.id, r); }, done: 'Access restored.' }); });
      }
    };
  });

  /* ================= citizens ================= */
  var citizens = A(function (ctx) {
    var f = ctx.query.f || 'all', q = ctx.query.q || '';
    var items = S.listUsers({ f: f, q: q });
    var TABS = [['all', 'All'], ['watch', 'Needs watching'], ['suspended', 'Suspended'], ['banned', 'Banned']];
    return {
      html: wrap(U.pageHeader({ title: 'Citizens', sub: 'Trust is explained, never a secret number.' }) +
        '<form class="gsearch" id="cs" role="search"><div class="search">' + icon('search') + '<label class="sr" for="cs-q">Search citizens</label><input type="search" id="cs-q" placeholder="Search by name, email or place" value="' + esc(q) + '"></div></form>' +
        tabs(TABS.map(function (t) { return [t[0], t[1], 'f']; }), f, '#/admin/citizens', { q: q }) +
        (items.length ? '<ul class="rlist">' + items.map(function (u) {
          var tr = S.trustFor(u.id);
          return '<li><a class="rc" href="#/admin/citizens/' + u.id + '"><div class="rc-main"><div class="rc-badges">' + trustBadge(tr) + acctBadge(u) + '</div><h3 class="rc-title">' + esc(u.name) + '</h3><p class="rc-meta">' + esc(u.email) + ' · ' + tr.counts.reports + ' report' + (tr.counts.reports === 1 ? '' : 's') + ' · joined ' + U.dateOnly(u.createdAt) + '</p></div>' + icon('right', 'rc-go') + '</a></li>';
        }).join('') + '</ul>' : U.emptyState({ icon: 'users', title: 'No citizens found', text: q || f !== 'all' ? 'Nothing matches this search.' : 'Citizens who sign up will appear here.' }))),
      mount: function (root) { root.querySelector('#cs').addEventListener('submit', function (e) { e.preventDefault(); location.hash = '#/admin/citizens' + qs({ f: f, q: root.querySelector('#cs-q').value.trim() }); }); }
    };
  });

  var citizen = A(function (ctx) {
    var u = S.getUser(ctx.params[0]);
    if (!u || u.role !== 'citizen') return { html: wrap(U.emptyState({ icon: 'search', title: 'Citizen not found', action: btn({ label: 'Back', href: '#/admin/citizens', kind: 'primary' }) }), 'narrow') };
    var tr = S.trustFor(u.id), acc = S.accountOf(u), mine = S.userReports(u.id);
    var TYPE = { fake: 'Confirmed fake report', spam: 'Confirmed spam', duplicate: 'Duplicate report', warning: 'Warning', suspension: 'Suspended', ban: 'Banned', reinstated: 'Account restored', cleared: 'Report checked and cleared' };
    var hist = (u.modHistory || []).slice(0, 12);
    return {
      html: wrap('<header class="ph ph-detail"><a class="ph-back" href="#/admin/citizens">' + icon('left') + '<span>Citizens</span></a><h1 id="page-title" tabindex="-1">' + esc(u.name) + '</h1><div class="rc-badges">' + trustBadge(tr) + acctBadge(u) + '</div></header>' +
        sec('Trust', '<p class="muted">Every point below comes from a confirmed decision. A flag from another person never lowers it.</p><div class="trustbox"><div class="score"><b>' + tr.score + '</b><span>of 100</span></div><ul class="factors">' +
          tr.factors.map(function (f) { return '<li><span>' + esc(f.label) + '</span><b class="' + (f.points < 0 ? 'neg' : 'pos') + '">' + (f.points > 0 ? '+' : '') + f.points + '</b></li>'; }).join('') + '</ul></div>' +
          '<div class="stats">' + stat(tr.counts.reports, 'Reports', '#/admin/reports?reporter=' + encodeURIComponent(u.email)) + stat(tr.counts.fake, 'Confirmed fake', '#') + stat(tr.counts.spam, 'Confirmed spam', '#') + stat(tr.counts.duplicate, 'Duplicates', '#') +
          stat(tr.counts.warnings, 'Warnings', '#') + stat(tr.counts.suspensions, 'Suspensions', '#') + '</div>') +
        sec('Actions', '<div class="act-stack">' + btn({ label: 'Send a warning', id: 'c-warn', block: true }) +
          (acc.status === 'active' ? btn({ label: 'Suspend for a set time', id: 'c-susp', block: true }) + btn({ label: 'Ban permanently', id: 'c-ban', block: true, kind: 'secondary' }) : '') +
          (acc.status !== 'active' ? btn({ label: 'Restore account', id: 'c-re', kind: 'primary', block: true }) : '') + '</div>' +
          (acc.status !== 'active' ? '<p class="muted small">' + (acc.status === 'banned' ? 'Banned' : 'Suspended until ' + U.dateOnly(acc.until)) + '. Reason: ' + esc(acc.reason) + '</p>' : '')) +
        sec('Recent moderation history', hist.length ? '<ul class="loglist">' + hist.map(function (h) { return '<li><strong>' + esc(TYPE[h.type] || h.type) + '</strong>' + (h.reversed ? ' <span class="badge tone-neutral">Reversed</span>' : '') + '<span class="muted"> · ' + U.dateTime(h.ts) + ' · ' + esc(h.by || '') + '</span>' + (h.reason ? '<p>' + esc(h.reason) + '</p>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">No moderation history.</p>') +
        sec('Details', '<dl class="facts"><div><dt>Email</dt><dd>' + esc(u.email) + '</dd></div>' + (u.phone ? '<div><dt>Mobile</dt><dd>' + esc(u.phone) + '</dd></div>' : '') + '<div><dt>Location</dt><dd>' + esc([u.city, u.district, u.state].filter(Boolean).join(', ')) + '</dd></div><div><dt>Joined</dt><dd>' + U.dateOnly(u.createdAt) + '</dd></div></dl>') +
        sec('Their reports', mine.length ? U.reportList(mine, { admin: true, id: true, href: null }).replace(/href="#\/c\//g, 'href="#/admin/r/') : '<p class="muted">No reports yet.</p>')),
      mount: function (root) {
        var on = function (id, k) { var b = root.querySelector(id); if (b) b.addEventListener('click', function () { openUserAction(k, u); }); };
        on('#c-warn', 'warn'); on('#c-susp', 'suspend'); on('#c-ban', 'ban'); on('#c-re', 'reinstate');
      }
    };
  });

  /* ================= departments ================= */
  function openDept(d) {
    var isNew = !d; d = d || { name: '', description: '', active: true, roles: [] };
    reasonDialog({ title: isNew ? 'Add a department' : 'Edit department', confirm: 'Save', hint: 'Why you are making this change. It is saved in the audit log.', reasonLabel: 'Reason for this change', prefill: isNew ? 'New department added.' : '',
      extra: U.field({ id: 'dp-n', label: 'Name', required: true, value: d.name }) + U.field({ id: 'dp-d', label: 'What it handles', tag: 'textarea', rows: 2, value: d.description }) +
        U.field({ id: 'dp-r', label: 'Responsible roles', value: d.roles.join(', '), hint: 'Separate with commas, for example: Ward Officer, District Officer.' }) +
        '<label class="check"><input type="checkbox" id="dp-a"' + (d.active ? ' checked' : '') + '><span><strong>Active</strong><br><span class="muted">Inactive departments cannot get new reports or transfers.</span></span></label>',
      run: function (reason, root) { return S.saveDepartment({ id: d.id, name: root.querySelector('#dp-n').value, description: root.querySelector('#dp-d').value, active: root.querySelector('#dp-a').checked, roles: root.querySelector('#dp-r').value.split(','), reason: reason }); },
      done: isNew ? 'Department added.' : 'Department saved.' });
  }
  var departments = A(function () {
    var ds = S.departments(), rt = S.deptRatings();
    return {
      html: wrap(U.pageHeader({ title: 'Departments', actions: btn({ label: 'Add department', id: 'd-add', kind: 'primary', small: true, icon: 'plus' }) }) +
        '<ul class="rlist">' + ds.map(function (d) {
          return '<li class="plainrow"><div><strong>' + esc(d.name) + '</strong> ' + (d.active ? '<span class="badge tone-good">' + icon('check') + '<span>Active</span></span>' : '<span class="badge tone-neutral">' + icon('x') + '<span>Inactive</span></span>') +
            '<p class="muted">' + esc(d.description) + '</p>' + (rt[d.id] && rt[d.id].count ? '<p class="small">' + U.stars(Math.round(rt[d.id].avg), 'Average ' + rt[d.id].avg + ' out of 5') + ' <span class="muted">average ' + rt[d.id].avg + ' from ' + rt[d.id].count + (rt[d.id].count === 1 ? ' rating' : ' ratings') + '</span></p>' : '') + (d.roles.length ? '<p class="muted small">Roles: ' + esc(d.roles.join(', ')) + '</p>' : '') + '</div>' + btn({ label: 'Edit', small: true, attrs: 'data-edit="' + d.id + '" aria-label="Edit ' + esc(d.name) + '"' }) + '</li>';
        }).join('') + '</ul>' +
        sec('Where new reports go', '<p class="muted">Each type of problem is sent to one department. You can change it. Reports already filed do not move.</p><div class="routes">' +
          S.CATS.map(function (c) { return U.field({ id: 'rt-' + c.id, label: c.name, tag: 'select', optionsHtml: U.opts(S.activeDepts(), S.deptForCategory(c.id), function (d) { return d.id; }, function (d) { return d.name; }) }); }).join('') + '</div>')),
      mount: function (root) {
        root.querySelector('#d-add').addEventListener('click', function () { openDept(null); });
        root.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openDept(S.departments().filter(function (d) { return d.id === b.getAttribute('data-edit'); })[0]); }); });
        S.CATS.forEach(function (c) {
          root.querySelector('#rt-' + c.id).addEventListener('change', function (e) {
            var dv = e.target.value;
            U.attempt(function () { return S.setCategoryDept(c.id, dv); }).then(function () { U.toast('Saved. New "' + c.name + '" reports go to ' + S.deptName(dv) + '.', 'good'); })
              .catch(function (ex) { U.toast(friendly(ex, 'Could not save.'), 'bad'); rerender(); });
          });
        });
      }
    };
  });

  /* ================= logs ================= */
  var logs = A(function (ctx) {
    var t = ctx.query.t || 'audit', q = ctx.query.q || '';
    var TABS = [['audit', 'Audit log'], ['system', 'System log'], ['notifications', 'Notifications']];
    var body = '', head = '';
    if (t === 'audit') {
      var chk = S.auditVerify(), items = S.auditList({ q: q });
      head = '<p class="muted">What administrators did. Entries can be added but never edited or removed from here.</p>' +
        alertBox(chk.ok ? 'good' : 'danger', chk.ok ? '<strong>Record chain intact.</strong><p>' + chk.count + ' entries checked.</p>' : '<strong>The record chain is broken.</strong><p>An entry was changed or removed outside the app.</p>') +
        '<form class="gsearch" id="ls" role="search"><div class="search">' + icon('search') + '<label class="sr" for="ls-q">Search the audit log</label><input type="search" id="ls-q" placeholder="Search by admin, target or reason" value="' + esc(q) + '"></div></form>';
      body = items.length ? '<ul class="loglist boxed">' + items.slice(0, 100).map(function (e) { return '<li>' + sentence(e) + '<span class="muted"> · ' + U.dateTime(e.ts) + '</span>' + (e.reason ? '<p>Reason: ' + esc(e.reason) + '</p>' : '') + '</li>'; }).join('') + '</ul>'
        : U.emptyState({ icon: 'book', title: 'No admin actions yet', text: 'Decisions you make will be recorded here.' });
    } else if (t === 'system') {
      var sl = S.sysList();
      head = '<p class="muted">What happened technically. Only admins can see this.</p>';
      body = sl.length ? '<ul class="loglist boxed">' + sl.slice(0, 100).map(function (e) { return '<li><span class="badge tone-' + (e.level === 'error' ? 'danger' : (e.level === 'warn' ? 'warn' : 'neutral')) + '">' + esc(e.level) + '</span> <strong>' + esc(e.area) + '</strong> · ' + esc(e.message) + '<span class="muted"> · ' + U.dateTime(e.ts) + '</span></li>'; }).join('') + '</ul>'
        : U.emptyState({ icon: 'check', title: 'No problems recorded', text: 'Technical errors will be listed here.' });
    } else {
      var nl = S.notifList();
      head = '<p class="muted">The last 100 alerts sent to people.</p>';
      body = nl.length ? '<ul class="loglist boxed">' + nl.map(function (n) { return '<li><strong>' + esc(n.title) + '</strong> · to ' + esc(n.recipient) + '<span class="muted"> · ' + esc(n.type.replace('_', ' ')) + ' · ' + esc(n.status) + ' · ' + U.dateTime(n.ts) + '</span>' + (n.reportId ? ' <a class="link" href="#/admin/r/' + n.reportId + '">DL-' + n.reportId + '</a>' : '') + '</li>'; }).join('') + '</ul>'
        : U.emptyState({ icon: 'bell', title: 'No alerts sent yet', text: 'Alerts will be listed here.' });
    }
    return {
      html: wrap(U.pageHeader({ title: 'Logs' }) + tabs(TABS, t, '#/admin/logs') + head + body),
      mount: function (root) { var f = root.querySelector('#ls'); if (f) f.addEventListener('submit', function (e) { e.preventDefault(); location.hash = '#/admin/logs' + qs({ t: 'audit', q: root.querySelector('#ls-q').value.trim() }); }); }
    };
  });

  /* ================= settings ================= */
  var settings = A(function () {
    var s = S.getSettings();
    return {
      html: wrap(U.pageHeader({ title: 'Settings', sub: S.isDemo() ? 'Demo mode: sample data only' : 'Live site' }) +
        '<form id="st" class="form" novalidate>' +
        U.field({ id: 'st-rt', label: 'Flags that send a report to review', type: 'number', value: s.reviewThreshold, hint: 'A report goes to the pending list at this many flags. It is not removed and nobody is punished.', attrs: 'min="2" max="20" inputmode="numeric"' }) +
        U.field({ id: 'st-fd', label: 'Flags one person can send per day', type: 'number', value: s.flagsPerDay, hint: 'Stops one person from flooding the system.', attrs: 'min="1" max="20" inputmode="numeric"' }) +
        U.field({ id: 'st-rh', label: 'Reports one person can send per hour', type: 'number', value: s.reportsPerHour, attrs: 'min="1" max="20" inputmode="numeric"' }) +
        U.field({ id: 'st-ad', label: 'Days a citizen has to check the work', type: 'number', value: s.auditDays, hint: 'After this many days without a reply, a resolved report closes by itself.', attrs: 'min="1" max="30" inputmode="numeric"' }) +
        U.field({ id: 'st-mr', label: 'Times a citizen can reopen one report', type: 'number', value: s.maxReopens, hint: 'When this is reached, admins are told so they can step in.', attrs: 'min="1" max="5" inputmode="numeric"' }) +
        U.field({ id: 'st-gm', label: 'How precise the public map is', tag: 'select', hint: 'Public points are moved to the centre of a square this big, so nobody\u2019s home is shown.', optionsHtml: [[250, 'About 250 m'], [500, 'About 500 m (recommended)'], [1000, 'About 1 km']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.publicGridMeters ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') }) +
        U.field({ id: 'st-al', label: 'Group areas by', tag: 'select', hint: 'Used in Insights. The site does not assume wards or zones.', optionsHtml: [['city', 'City or town'], ['district', 'District'], ['state', 'State']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.areaLevel ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') }) +
        '<label class="check"><input type="checkbox" id="st-tl"' + (s.mapTiles ? ' checked' : '') + '><span><strong>Show a street map behind the reports</strong><br><span class="muted">When on, visitors\u2019 browsers load map pictures from OpenStreetMap, which sees the area they look at. Off by default.</span></span></label>' +
        '<div id="st-alert"></div>' + btn({ label: 'Save settings', type: 'submit', kind: 'primary', block: true, id: 'st-go' }) + '</form>' +
        sec('Data and security', '<ul class="notes"><li>No API keys, passwords or secrets are stored in the page code.</li><li>Every admin action is checked in the data layer using the logged-in account, not just hidden in the menu.</li>' +
          '<li><strong>Important:</strong> for now, data lives in each browser. Real protection against someone editing their own browser data needs the shared backend planned for Phase 6.</li></ul>')),
      mount: function (root) {
        root.querySelector('#st').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var go = root.querySelector('#st-go'); U.setBusy(go, true, 'Saving…');
          U.attempt(function () { return S.saveSettings({ reviewThreshold: root.querySelector('#st-rt').value, flagsPerDay: root.querySelector('#st-fd').value, reportsPerHour: root.querySelector('#st-rh').value, auditDays: root.querySelector('#st-ad').value, maxReopens: root.querySelector('#st-mr').value, publicGridMeters: root.querySelector('#st-gm').value, areaLevel: root.querySelector('#st-al').value, mapTiles: root.querySelector('#st-tl').checked }); }).then(function () { U.setBusy(go, false); U.toast('Settings saved', 'good'); })
            .catch(function (ex) { U.setBusy(go, false); root.querySelector('#st-alert').innerHTML = alertBox('danger', '<strong>Not saved</strong><p>' + esc(friendly(ex, 'Could not save.')) + '</p>'); });
        });
      }
    };
  });

  /* ================= search, more ================= */
  var TYPE_LABEL = { REPORT: 'Report', CITIZEN: 'Citizen', OFFICIAL: 'Official', DEPARTMENT: 'Department', CATEGORY: 'Category', LOCATION: 'Place' };
  var search = A(function (ctx) {
    var q = ctx.query.q || '', res = q.length >= 2 ? S.search(q) : [];
    return {
      html: wrap(U.pageHeader({ title: 'Search' }) + searchBar(q) +
        (q.length < 2 ? '<p class="muted">Type at least 2 letters. You can search by report number, person, department, place or type of problem.</p>'
          : (res.length ? '<ul class="rlist">' + res.map(function (r) { return '<li><a class="rc" href="' + r.href + '"><div class="rc-main"><div class="rc-badges"><span class="badge tone-info">' + (TYPE_LABEL[r.type] || r.type) + '</span></div><h3 class="rc-title">' + esc(r.title) + '</h3><p class="rc-meta">' + esc(r.sub) + '</p></div>' + icon('right', 'rc-go') + '</a></li>'; }).join('') + '</ul>'
            : U.emptyState({ icon: 'search', title: 'Nothing found', text: 'Try a different word or a report number.' })))),
      mount: bindSearch
    };
  });

  var more = A(function () {
    var links = [['#/admin/citizens', 'Citizens', 'users'], ['#/admin/departments', 'Departments', 'building'], ['#/admin/logs', 'Logs', 'book'], ['#/admin/settings', 'Settings', 'gear'], ['#/admin/search', 'Search', 'search'], ['#/profile', 'Profile', 'user']];
    return { html: wrap(U.pageHeader({ title: 'More' }) + '<ul class="rlist">' + links.map(function (l) { return '<li><a class="rc" href="' + l[0] + '"><span class="more-ic">' + icon(l[2]) + '</span><div class="rc-main"><h3 class="rc-title">' + l[1] + '</h3></div>' + icon('right', 'rc-go') + '</a></li>'; }).join('') + '</ul>' +
      '<div class="stack-col">' + btn({ label: 'Log out', id: 'm-out', icon: 'logout', block: true }) + '</div>'),
      mount: function (root) { root.querySelector('#m-out').addEventListener('click', function () { window.DL.app.logout(); }); } };
  });

  window.DL.adminViews = { adminHome: dashboard, adminReports: reports, adminReport: report, adminModeration: moderation, adminAuthorities: authorities, adminAuthority: authority,
    adminCitizens: citizens, adminCitizen: citizen, adminDepartments: departments, adminLogs: logs, adminSettings: settings, adminSearch: search, adminMore: more };
})();
