/* Disaster Lens – shared components (Phase 2.5)
 * Every screen is built from the functions below, so buttons, badges, cards,
 * forms and dialogs look and behave the same everywhere.
 */
(function () {
  var S = window.DL.store;

  /* ---------- basics ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ago(ts) {
    var s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function dateTime(ts) {
    return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function dateOnly(ts) { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function sameDay(a, b) { var x = new Date(a), y = new Date(b); return x.toDateString() === y.toDateString(); }

  /* ---------- one icon set (24px outline) ---------- */
  var P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    bell: '<path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z"/><path d="M10 21h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5L3 17.6 6.4 21l6.3-6.3a4 4 0 0 0 5-5.4l-2.6 2.6-2.4-.5-.5-2.4z"/>',
    transfer: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    up: '<path d="M7 11v9H4v-9zM7 11l4-7c1.6 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1 6a2 2 0 0 1-2 1.7H7"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    logout: '<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    desk: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9.5 14l2 2 3.5-4"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.7-3.5 3.3-5.5 7-5.5s6.3 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.5 2.4 4 5.2"/>',
    building: '<path d="M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M3 21h18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2L10 21h4l.6-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    dash: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="11" width="8" height="10" rx="1"/><rect x="3" y="14" width="8" height="7" rx="1"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'
  };
  function icon(n, cls) {
    return '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[n] || '') + '</svg>';
  }
  var LOGO = '<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="currentColor"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="16" cy="16" r="3.2" fill="#fff"/></svg>';

  /* ---------- Button ---------- */
  function button(o) {
    var cls = 'btn btn-' + (o.kind || 'secondary') + (o.block ? ' btn-block' : '') + (o.small ? ' btn-sm' : '') + (o.cls ? ' ' + o.cls : '');
    var inner = (o.icon ? icon(o.icon) : '') + '<span>' + esc(o.label) + '</span>';
    var a = (o.id ? ' id="' + o.id + '"' : '') + (o.attrs ? ' ' + o.attrs : '');
    if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '"' + a + '>' + inner + '</a>';
    return '<button type="' + (o.type || 'button') + '" class="' + cls + '"' + a + '>' + inner + '</button>';
  }
  /* Disable a button and show progress text so nothing can be sent twice */
  function setBusy(btn, on, text) {
    if (!btn) return;
    if (on) {
      btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span>' + esc(text || 'Please wait…') + '</span>';
    } else {
      if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  }

  /* ---------- Status ---------- */
  var STATUS = {
    submitted:   { label: 'Submitted',     icon: 'clock',    tone: 'warn',    cit: 'Your report has been received.',                       off: 'This report is waiting for action.' },
    started:     { label: 'Work started',  icon: 'wrench',   tone: 'info',    cit: 'The responsible department is working on it.',         off: 'Work on this report is in progress.' },
    transferred: { label: 'Transferred',   icon: 'transfer', tone: 'warn',    cit: 'Your report was sent to another department.',          off: 'This report was moved to a new department.' },
    escalated:   { label: 'Escalated',     icon: 'alert',    tone: 'danger',  cit: 'The issue has been sent to district administration.',  off: 'This report was sent to the district administration.' },
    resolved:    { label: 'Resolved',      icon: 'check',    tone: 'good',    cit: 'The department marked this issue as fixed.',           off: 'This report is marked as fixed.' },
    review:      { label: 'Under review',  icon: 'eye',      tone: 'neutral', cit: 'This report is hidden while an admin checks it.',      off: 'Hidden from the public list while an admin checks it.' },
    rejected:    { label: 'Removed',       icon: 'x',        tone: 'neutral', cit: 'An admin reviewed this report and removed it.',        off: 'Removed after review.' },
    duplicate:   { label: 'Duplicate',     icon: 'link',     tone: 'neutral', cit: 'This report matches an earlier one.',                  off: 'Duplicate of another report.' },
    archived:    { label: 'Archived',      icon: 'file',     tone: 'neutral', cit: 'An admin archived this report.',                       off: 'Archived by an admin.' },
    reopened:    { label: 'Reopened',      icon: 'alert',    tone: 'warn',    cit: 'You said the problem is still there. The department has been asked to look again.', off: 'The citizen says the problem is still there.' },
    closed:      { label: 'Closed',        icon: 'check',    tone: 'good',    cit: 'This report is closed.',                               off: 'This report is closed.' }
  };

  var NEXT = {
    submitted:   function (c) { return 'The ' + c.assignedDepartment + ' will look at it. ' + slaText(c) + '.'; },
    started:     function () { return 'You will get an alert when the department marks it as fixed.'; },
    transferred: function (c) { return 'The ' + c.assignedDepartment + ' will look at it next.'; },
    escalated:   function () { return 'The district administration will look into it. You will get an alert with any update.'; },
    resolved:    function (c) { return c.audit && c.audit.state === 'pending' || !c.audit ? 'Please check the work and tell us if it is really fixed.' : 'Thank you. This report is closed.'; },
    closed:      function () { return 'Nothing more is needed.'; },
    review:      function () { return 'An admin will check it. It stays hidden from the public list until then.'; },
    rejected:    function () { return 'It no longer counts as an active report.'; },
    duplicate:   function () { return 'Follow the original report instead.'; },
    archived:    function () { return 'It no longer counts as an active report.'; },
    reopened:    function (c) { return 'The ' + c.assignedDepartment + ' will look at it again.'; }
  };

  /* Read what kind of event a timeline entry is from its label */
  function evType(label) {
    if (/^Report submitted/.test(label)) return 'reported';
    if (/^(Work started|Marked in progress)/.test(label)) return 'started';
    if (/^Marked resolved/.test(label)) return 'resolved';
    if (/^Transferred/.test(label)) return 'transferred';
    if (/^Escalated/.test(label)) return 'escalated';
    if (/^Hidden/.test(label)) return 'review';
    if (/^Citizen confirmed/.test(label)) return 'confirmed';
    if (/^Citizen reported the problem/.test(label)) return 'disputed';
    if (/^Closed automatically/.test(label)) return 'closed';
    return 'note';
  }
  function lastType(c) {
    var t = c.timeline || [];
    for (var i = t.length - 1; i >= 0; i--) { var k = evType(t[i].label); if (k !== 'note') return k; }
    return 'reported';
  }
  function statusKey(c) {
    var ms = c.modStatus || 'normal';
    if (ms === 'under_review') return 'review';
    if (ms === 'rejected') return c.modOutcome === 'duplicate' ? 'duplicate' : 'rejected';
    if (ms === 'archived') return 'archived';
    if (c.status === 'Closed') return 'closed';
    if (c.status === 'Resolved') return 'resolved';
    if (c.isEscalated) return 'escalated';
    if (c.status === 'In progress') return 'started';
    if (c.status === 'Reopened') return 'reopened';
    return lastType(c) === 'transferred' ? 'transferred' : 'submitted';
  }

  function statusBadge(c, big) {
    var m = STATUS[statusKey(c)];
    return '<span class="badge tone-' + m.tone + (big ? ' badge-lg' : '') + '">' + icon(m.icon) + '<span>' + m.label + '</span></span>';
  }
  function urgentBadge(c) {
    return c.priority === 'Urgent' && S.isOpen(c) ? '<span class="badge tone-danger-solid">' + icon('alert') + '<span>Urgent</span></span>' : '';
  }
  /* the citizen has something to do: look at the finished work */
  function checkBadge(c) {
    return c.status === 'Resolved' && S.auditInfo(c).pending ? '<span class="badge tone-warn">' + icon('eye') + '<span>Check the work</span></span>' : '';
  }
  function stars(n, label) {
    var out = ''; for (var i = 1; i <= 5; i++) out += '<span class="star' + (i <= n ? ' on' : '') + '" aria-hidden="true">' + (i <= n ? '★' : '☆') + '</span>';
    return '<span class="stars" role="img" aria-label="' + (label || n + ' out of 5 stars') + '">' + out + ' <span class="stars-n">' + n + ' of 5</span></span>';
  }
  /* shown next to the status when a moderator is involved */
  function modBadge(c, admin) {
    var ms = c.modStatus || 'normal';
    if (ms === 'flagged') return '<span class="badge tone-warn">' + icon('flag') + '<span>Flagged</span></span>';
    if (ms === 'verified' && admin) return '<span class="badge tone-good">' + icon('check') + '<span>Cleared</span></span>';
    return '';
  }
  function lateBadge(c) {
    return S.isLate(c) ? '<span class="badge tone-danger">' + icon('clock') + '<span>Late</span></span>' : '';
  }

  function slaText(c) {
    if (!S.isOpen(c)) return 'Resolved';
    var due = (c.slaStart || c.timestamp) + c.slaDeadlineDays * 86400000;
    var left = due - Date.now();
    if (left <= 0) {
      var over = Math.floor(-left / 86400000);
      return over < 1 ? 'Past its response target' : over + (over === 1 ? ' day' : ' days') + ' past its response target';
    }
    var hrs = Math.ceil(left / 3600000);
    return 'It has ' + (hrs < 48 ? hrs + ' hours' : Math.ceil(hrs / 24) + ' days') + ' left to respond';
  }

  /* ---------- Report card (one row in a list) ---------- */
  function placeOf(c) { return c.manualLocationAddress || c.city || c.state; }

  function reportCard(c, o) {
    o = o || {};
    var cat = S.cat(c.category);
    var thumb = c.imageUrlProof ? '<img class="rc-thumb" src="' + c.imageUrlProof + '" alt="" loading="lazy">' : '';
    return '<li><a class="rc" href="' + (o.href || '#/c/' + c.id) + '">' + thumb +
      '<div class="rc-main"><div class="rc-badges">' + urgentBadge(c) + statusBadge(c) + (o.admin ? modBadge(c, true) : '') + (o.mine ? checkBadge(c) : '') + (o.late !== false ? lateBadge(c) : '') + '</div>' +
      '<h3 class="rc-title">' + esc(c.title) + '</h3>' +
      '<p class="rc-meta">' + (o.id ? 'DL-' + c.id + ' · ' : '') + esc(cat.name) + ' · ' + esc(placeOf(c)) + ' · ' + ago(c.timestamp) + (o.extra ? ' · ' + o.extra : '') + '</p></div>' +
      icon('right', 'rc-go') + '</a></li>';
  }
  function reportList(items, o) { return '<ul class="rlist">' + items.map(function (c) { return reportCard(c, o); }).join('') + '</ul>'; }

  /* ---------- Report timeline (only steps that happened) ---------- */
  function timeline(c) {
    var ev = [];
    var origin = c.assignedDepartment;
    (c.timeline || []).forEach(function (t) {
      var m = /^Transferred from (.+?) to /.exec(t.label);
      if (m && ev.every(function (e) { return e.type !== 'transferred'; })) origin = m[1];
      ev.push({ type: evType(t.label), ts: t.ts, label: t.label });
    });
    if (ev.length && ev[0].type === 'reported') ev.splice(1, 0, { type: 'assigned', ts: ev[0].ts, dept: origin });
    var ICON = { reported: 'inbox', assigned: 'right', started: 'wrench', transferred: 'transfer', escalated: 'alert', resolved: 'check', review: 'eye', confirmed: 'check', disputed: 'alert', closed: 'check' };
    var TONE = { reported: 'neutral', assigned: 'neutral', started: 'info', transferred: 'warn', escalated: 'danger', resolved: 'good', review: 'neutral', confirmed: 'good', disputed: 'warn', closed: 'neutral' };
    var items = ev.map(function (e, i) {
      var title, text = '', m;
      switch (e.type) {
        case 'reported': title = 'Reported'; text = 'The report was received.'; break;
        case 'assigned': title = 'Assigned'; text = 'Sent to the ' + e.dept + '.'; break;
        case 'started': title = 'Work started'; m = /by (.+?)( \(|$)/.exec(e.label); text = m ? 'The ' + m[1] + ' began work.' : 'The department began work.'; break;
        case 'transferred': title = 'Transferred'; m = /^Transferred from (.+?) to (.+?)\. Reason: (.*)$/.exec(e.label); text = m ? 'Moved from ' + m[1] + ' to ' + m[2] + '. Reason: ' + m[3] : e.label; break;
        case 'escalated': title = 'Escalated'; m = /Reason: (.*)$/.exec(e.label); text = 'Sent to the district administration.' + (m ? ' Reason: ' + m[1] : ''); break;
        case 'resolved': title = 'Resolved'; text = 'The department marked this as fixed.'; break;
        case 'review': title = 'Under review'; text = 'Hidden from the public list while an admin checks it.'; break;
        case 'confirmed': title = 'Fix confirmed'; m = /\((\d) of 5/.exec(e.label); text = 'The citizen checked the work and confirmed it.' + (m ? ' Rated ' + m[1] + ' of 5.' : ''); break;
        case 'disputed': title = 'Reopened'; m = /Reason: (.*)$/.exec(e.label); text = 'The citizen says the problem is still there.' + (m ? ' ' + m[1] + '.' : ''); break;
        case 'closed': title = 'Closed'; text = 'No reply came in time, so the report was closed.'; break;
        default: title = e.label;
      }
      var last = i === ev.length - 1;
      return '<li class="tl-i' + (last ? ' tl-now' : '') + '"><span class="tl-dot tone-' + (TONE[e.type] || 'neutral') + '">' + icon(ICON[e.type] || 'info') + '</span><div class="tl-b"><strong>' + esc(title) +
        (last ? ' <span class="tl-tag">Latest</span>' : '') + '</strong><p>' + esc(text) + '</p><time>' + dateTime(e.ts) + '</time></div></li>';
    });
    return '<ol class="tl">' + items.join('') + '</ol>';
  }

  /* ---------- Notifications ---------- */
  var TYPE_ICON = { received: ['inbox', 'info'], new_report: ['inbox', 'info'], started: ['wrench', 'info'], resolved: ['check', 'good'], transferred: ['transfer', 'warn'],
    escalated: ['alert', 'danger'], reopened: ['alert', 'warn'], confirmed: ['check', 'good'], closed: ['check', 'neutral'], comment: ['message', 'neutral'], moderation: ['eye', 'neutral'], account: ['alert', 'warn'], verification: ['shield', 'neutral'] };
  function noteIcon(title, type) {
    if (TYPE_ICON[type]) return TYPE_ICON[type];
    var t = title.toLowerCase();
    if (/resolved/.test(t)) return ['check', 'good'];
    if (/started/.test(t)) return ['wrench', 'info'];
    if (/another department|transferred/.test(t)) return ['transfer', 'warn'];
    if (/escalat/.test(t)) return ['alert', 'danger'];
    if (/comment/.test(t)) return ['message', 'neutral'];
    if (/checked|review|official id/.test(t)) return ['eye', 'neutral'];
    return ['inbox', 'info'];
  }
  function notificationItem(n) {
    var ic = noteIcon(n.title, n.type);
    var body = '<span class="ni-ic tone-' + ic[1] + '">' + icon(ic[0]) + '</span><span class="ni-b"><strong>' + esc(n.title) + (n.isRead ? '' : ' <span class="new-tag">New</span>') +
      '</strong><span class="ni-t">' + esc(n.message) + '</span><time>' + ago(n.ts) + '</time></span>';
    return '<li class="ni' + (n.isRead ? '' : ' unread') + '">' + (n.link ? '<a data-note="' + esc(n.id) + '" href="' + esc(n.link) + '">' + body + '</a>' : '<div>' + body + '</div>') + '</li>';
  }

  /* ---------- Empty and loading states ---------- */
  function emptyState(o) {
    return '<div class="empty"><span class="empty-ic">' + icon(o.icon || 'inbox') + '</span><h2>' + esc(o.title) + '</h2>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') + (o.action || '') + '</div>';
  }
  function loading(rows) {
    var r = '';
    for (var i = 0; i < (rows || 3); i++) r += '<li class="skel-row" aria-hidden="true"><span class="skel skel-a"></span><span class="skel skel-b"></span><span class="skel skel-c"></span></li>';
    return '<div class="wrap" role="status"><span class="sr">Loading…</span><div class="skel skel-h" aria-hidden="true"></div><ul class="rlist">' + r + '</ul></div>';
  }

  /* ---------- Form field ---------- */
  function field(o) {
    var id = o.id, hid = id + '-hint', eid = id + '-err';
    var desc = (o.hint ? hid + ' ' : '') + eid;
    var at = ' id="' + id + '" name="' + id + '" aria-describedby="' + desc + '"' + (o.required ? ' required aria-required="true"' : '') + (o.attrs ? ' ' + o.attrs : '');
    var ctl;
    if (o.tag === 'textarea') ctl = '<textarea' + at + ' rows="' + (o.rows || 4) + '">' + esc(o.value || '') + '</textarea>';
    else if (o.tag === 'select') ctl = '<select' + at + '>' + o.optionsHtml + '</select>';
    else ctl = '<input type="' + (o.type || 'text') + '"' + at + ' value="' + esc(o.value || '') + '">';
    return '<div class="field"><label for="' + id + '">' + esc(o.label) + (o.required ? '' : ' <span class="opt">(optional)</span>') + '</label>' +
      (o.hint ? '<p class="hint" id="' + hid + '">' + esc(o.hint) + '</p>' : '') + ctl + '<p class="err" id="' + eid + '" hidden></p></div>';
  }
  function showError(root, id, msg) {
    var el = root.querySelector('#' + id + '-err'), inp = root.querySelector('#' + id);
    if (el) { el.textContent = msg; el.hidden = false; }
    if (inp) inp.setAttribute('aria-invalid', 'true');
  }
  function clearErrors(root) {
    root.querySelectorAll('.err').forEach(function (e) { e.hidden = true; e.textContent = ''; });
    root.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
  }
  function focusFirstError(root) {
    var bad = root.querySelector('[aria-invalid="true"]');
    if (bad) { bad.focus(); if (bad.scrollIntoView) bad.scrollIntoView({ block: 'center' }); }
  }
  function opts(list, sel, getVal, getLabel) {
    return list.map(function (x) { var v = getVal(x); return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(getLabel(x)) + '</option>'; }).join('');
  }

  /* ---------- Page header ---------- */
  function pageHeader(o) {
    return '<header class="ph">' + (o.back ? '<a class="ph-back" href="' + esc(o.back.href) + '" data-back>' + icon('left') + '<span>' + esc(o.back.label || 'Back') + '</span></a>' : '') +
      '<div class="ph-row"><div><h1 id="page-title" tabindex="-1">' + esc(o.title) + '</h1>' + (o.sub ? '<p class="ph-sub">' + esc(o.sub) + '</p>' : '') + '</div>' + (o.actions || '') + '</div></header>';
  }

  /* ---------- Navigation ---------- */
  var ADMIN_NAV = [
    { href: '#/admin', label: 'Dashboard', icon: 'dash', key: '/admin', exact: true },
    { href: '#/admin/reports', label: 'Reports', icon: 'list', key: '/admin/reports' },
    { href: '#/admin/moderation', label: 'Moderation', icon: 'eye', key: '/admin/moderation', count: 'pending' },
    { href: '#/admin/authorities', label: 'Authorities', icon: 'shield', key: '/admin/authorities', count: 'auth' },
    { href: '#/admin/citizens', label: 'Citizens', icon: 'users', key: '/admin/citizens' },
    { href: '#/admin/departments', label: 'Departments', icon: 'building', key: '/admin/departments' },
    { href: '#/admin/insights', label: 'Insights', icon: 'dash', key: '/admin/insights' },
    { href: '#/admin/logs', label: 'Logs', icon: 'book', key: '/admin/logs' },
    { href: '#/admin/settings', label: 'Settings', icon: 'gear', key: '/admin/settings' }
  ];
  function navItems(me, mobile) {
    var unread = me ? S.unreadCount(me.id) : 0;
    if (me && me.role === 'admin') {
      if (mobile) {
        var st = S.adminStats();
        return [
          { href: '#/admin', label: 'Home', icon: 'dash', key: '/admin', exact: true },
          { href: '#/admin/reports', label: 'Reports', icon: 'list', key: '/admin/reports' },
          { href: '#/admin/moderation', label: 'Review', icon: 'eye', key: '/admin/moderation', badge: st.moderation.pending },
          { href: '#/admin/authorities', label: 'Officials', icon: 'shield', key: '/admin/authorities', badge: st.authorities.pending },
          { href: '#/admin/more', label: 'More', icon: 'more', key: '/admin/more' }
        ];
      }
      var s2 = S.adminStats();
      return ADMIN_NAV.map(function (it) { return Object.assign({}, it, { badge: it.count === 'pending' ? s2.moderation.pending : (it.count === 'auth' ? s2.authorities.pending : 0) }); });
    }
    if (me && me.role === 'official') {
      if (S.verifState(me) !== 'approved') return [
        { href: '#/verification', label: 'Verification', icon: 'shield', key: '/verification' },
        { href: '#/alerts', label: 'Alerts', icon: 'bell', key: '/alerts', badge: unread },
        { href: '#/profile', label: 'Profile', icon: 'user', key: '/profile' }
      ];
      return [
        { href: '#/desk', label: 'Desk', icon: 'desk', key: '/desk' },
        { href: '#/feed', label: 'All reports', icon: 'list', key: '/feed' },
        { href: '#/alerts', label: 'Alerts', icon: 'bell', key: '/alerts', badge: unread },
        { href: '#/profile', label: 'Profile', icon: 'user', key: '/profile' }
      ];
    }
    if (me) return [
      { href: '#/', label: 'Home', icon: 'home', key: '/' },
      { href: '#/mine', label: 'My reports', icon: 'file', key: '/mine' },
      { href: '#/alerts', label: 'Alerts', icon: 'bell', key: '/alerts', badge: unread },
      { href: '#/profile', label: 'Profile', icon: 'user', key: '/profile' }
    ];
    return [
      { href: '#/', label: 'Home', icon: 'home', key: '/' },
      { href: '#/feed', label: 'Reports', icon: 'list', key: '/feed' },
      { href: '#/login', label: 'Log in', icon: 'user', key: '/login' }
    ];
  }
  function isActive(it, path) {
    if (it.exact || it.key === '/') return path === it.key;
    return path === it.key || path.indexOf(it.key + '/') === 0 || (it.key === '/admin/reports' && path.indexOf('/admin/r/') === 0) || (it.key === '/admin/moderation' && path.indexOf('/admin/r/') === 0 && false);
  }
  function badgeNum(n) { return n ? '<span class="count" aria-label="' + n + ' waiting">' + n + '</span>' : ''; }
  function navLinks(items, path) {
    return items.map(function (it) {
      return '<a href="' + it.href + '"' + (isActive(it, path) ? ' aria-current="page"' : '') + '>' + icon(it.icon) + '<span>' + it.label + '</span>' + badgeNum(it.badge) + '</a>';
    }).join('');
  }
  function bottomNav(me, path) { return navLinks(navItems(me, true), path); }
  function sidebar(me, path) {
    var home = me.role === 'admin' ? '#/admin' : '#/desk';
    return '<a class="brand" href="' + home + '">' + LOGO + '<span>Disaster Lens</span></a><nav aria-label="Main">' + navLinks(navItems(me, false), path) +
      (me.role === 'admin' ? '' : '') + '</nav>' +
      '<div class="sb-foot"><p><strong>' + esc(me.name) + '</strong><br><span>' + esc(me.role === 'admin' ? 'Admin' : (me.department || 'Official')) + '</span></p>' +
      '<a class="btn btn-quiet btn-sm" href="#/profile">' + icon('user') + '<span>Profile</span></a>' +
      button({ label: 'Log out', icon: 'logout', id: 'logout-sb', kind: 'quiet', small: true }) + '</div>';
  }

  /* ---------- Dialog and confirmation ---------- */
  function dialog(o) {
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = '<div class="modal-bg" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dlg-t">' +
      '<div class="sheet-h"><h2 id="dlg-t">' + esc(o.title) + '</h2><button type="button" class="btn btn-quiet btn-sm" data-close>' + icon('x') + '<span>Close</span></button></div>' +
      '<div class="sheet-b">' + o.body + '</div></div>';
    document.getElementById('modal-root').appendChild(wrap);
    document.body.classList.add('lock');
    var sheet = wrap.querySelector('.sheet');
    function close() {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      if (!document.getElementById('modal-root').children.length) document.body.classList.remove('lock');
      if (prev && prev.focus && document.body.contains(prev)) prev.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = sheet.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    if (o.onMount) o.onMount(wrap, close);
    var target = wrap.querySelector('.sheet-b input, .sheet-b textarea, .sheet-b select') || wrap.querySelector('.sheet-b .btn-primary, .sheet-b .btn-danger') || sheet;
    if (target === sheet) sheet.setAttribute('tabindex', '-1');
    target.focus();
    return close;
  }

  function confirmDialog(o) {
    return dialog({
      title: o.title,
      body: '<p class="dlg-text">' + esc(o.text) + '</p>' + (o.extra || '') +
        '<div class="dlg-foot">' + button({ label: 'Cancel', kind: 'quiet', attrs: 'data-close' }) +
        button({ label: o.confirmLabel || 'Confirm', kind: o.danger ? 'danger' : 'primary', id: 'dlg-ok' }) + '</div>',
      onMount: function (root, close) {
        root.querySelector('#dlg-ok').addEventListener('click', function () { o.onConfirm(root, close); });
      }
    });
  }

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg, kind) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 4000);
  }

  /* ---------- Photos ---------- */
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose a photo (an image file).'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('We could not read that photo. Try another one.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('We could not open that photo. Try another one.')); };
        img.onload = function () {
          var r = Math.min(1, maxSide / Math.max(img.width, img.height));
          var cv = document.createElement('canvas');
          cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', quality));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  window.DL.ui = {
    modBadge: modBadge, checkBadge: checkBadge, stars: stars, esc: esc, ago: ago, dateTime: dateTime, dateOnly: dateOnly, sameDay: sameDay, icon: icon, LOGO: LOGO,
    button: button, setBusy: setBusy, STATUS: STATUS, NEXT: NEXT, statusKey: statusKey, statusBadge: statusBadge, urgentBadge: urgentBadge, lateBadge: lateBadge,
    slaText: slaText, placeOf: placeOf, reportCard: reportCard, reportList: reportList, timeline: timeline, notificationItem: notificationItem,
    emptyState: emptyState, loading: loading, field: field, showError: showError, clearErrors: clearErrors, focusFirstError: focusFirstError, opts: opts,
    pageHeader: pageHeader, navItems: navItems, bottomNav: bottomNav, sidebar: sidebar, dialog: dialog, confirmDialog: confirmDialog,
    toast: toast, compressImage: compressImage, cat: S.cat
  };
})();
