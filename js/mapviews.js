/* Disaster Lens – map page and admin insights (Phase 5)
 * These screens only ask the data layer for points and numbers and draw them.
 * Who may see what is decided in store.js, not here.
 */
(function () {
  var S = window.DL.store, U = window.DL.ui, V = window.DL.vhelp, M = window.DL.map, G = window.DL.geo;
  var esc = U.esc, btn = U.button, icon = U.icon, wrap = V.wrap, sec = V.sec, alertBox = V.alertBox, friendly = V.friendly;

  var PR_ORDER = { critical: 0, high: 1, normal: 2, resolved: 3 };
  var TIME_LABEL = { all: 'All time', today: 'Today', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', custom: 'Custom dates' };

  function ageText(ts) {
    if (!ts) return 'not yet saved';
    var m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : (m < 60 ? m + ' min ago' : U.ago(ts));
  }
  /* honest freshness line: data lives on this device for now */
  function freshness() {
    var off = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (off ? '<span class="off-pill">' + icon('info') + 'You\u2019re offline. Showing saved data.</span> ' : '') + 'Data on this device last updated ' + ageText(S.dataAge()) + '.';
  }

  /* ---------- the toggle that sits on Community reports and on the map ---------- */
  function viewToggle(cur) {
    return '<nav class="seg2" aria-label="How to see reports"><a href="#/feed"' + (cur === 'list' ? ' aria-current="page"' : '') + '>' + icon('list') + '<span>List</span></a>' +
      '<a href="#/map"' + (cur === 'map' ? ' aria-current="page"' : '') + '>' + icon('pin') + '<span>Map</span></a></nav>';
  }

  /* ---------- legend (shape + words, never colour alone) ---------- */
  function legend(admin) {
    var items = [['critical', 'Urgent'], ['high', 'High priority'], ['normal', 'Normal'], ['resolved', 'Resolved']];
    if (admin) items.push(['review', 'Under review']);
    return '<ul class="legend" aria-label="What the markers mean">' + items.map(function (i) { return '<li>' + M.legendIcon(i[0]) + '<span>' + i[1] + '</span></li>'; }).join('') +
      '<li><svg class="lg-i" viewBox="0 0 34 34" width="24" height="24" aria-hidden="true"><circle cx="17" cy="17" r="12" fill="#fff" stroke="#4A5663" stroke-width="2" stroke-dasharray="4 3"/></svg><span>Dashed outline: approximate area</span></li>' +
      '<li><svg class="lg-i" viewBox="0 0 34 34" width="24" height="24" aria-hidden="true"><circle cx="17" cy="17" r="14" fill="#0F3577"/><text x="17" y="22" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="sans-serif">9</text></svg><span>A number: that many reports close together</span></li></ul>';
  }
  function heatLegend() {
    return '<ul class="legend heat-lg" aria-label="Heatmap colours"><li><span class="sw sw-hi" aria-hidden="true"></span><span><strong>High</strong> concentration</span></li>' +
      '<li><span class="sw sw-mid" aria-hidden="true"></span><span><strong>Medium</strong> concentration</span></li><li><span class="sw sw-lo" aria-hidden="true"></span><span><strong>Low</strong> concentration</span></li></ul>' +
      '<p class="muted small">Colours are relative to the busiest spot in the numbers below, so always read the counts.</p>';
  }

  /* ---------- the small card on the map ---------- */
  function card(p) {
    var pr = p.review ? 'Under review' : (M.PR_LABEL[p.pr] || '');
    return '<h3 class="mc-t">' + esc(p.catName) + '</h3><dl class="mc-d"><div><dt>Status</dt><dd>' + esc(p.status === 'Closed' ? 'Resolved' : p.status) + '</dd></div>' +
      '<div><dt>Priority</dt><dd>' + esc(pr) + '</dd></div><div><dt>Area</dt><dd>' + esc(p.area || 'Not given') + (p.q === 'area' ? ' <span class="muted">(approximate)</span>' : '') + '</dd></div>' +
      '<div><dt>Reported</dt><dd>' + U.ago(p.ts) + '</dd></div></dl><a class="btn btn-primary btn-sm btn-block" href="#/c/' + p.id + '">View report</a>';
  }

  function tileConfig() {
    var ps = S.publicSettings();
    return ps.mapTiles ? { enabled: true, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '\u00A9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' } : { enabled: false };
  }

  /* ---------- persistent filter state for this tab ---------- */
  var FKEY = 'dl_mapfilters';
  function loadF(role) {
    var d = { scope: 'all', status: 'all', priority: 'all', cat: 'all', dept: 'all', range: role === 'public' ? 'all' : '30', from: '', to: '', metric: 'unresolved', mode: 'markers' };
    try { var s = JSON.parse(sessionStorage.getItem(FKEY + role) || 'null'); if (s) Object.keys(d).forEach(function (k) { if (s[k] != null) d[k] = s[k]; }); } catch (e) { /* ignore */ }
    return d;
  }
  function saveF(role, f) { try { sessionStorage.setItem(FKEY + role, JSON.stringify(f)); } catch (e) { /* ignore */ } }

  function describe(f, role) {
    var bits = [];
    if (f.mode === 'heat') return '';
    bits.push(f.status !== 'all' ? (f.status === 'under_review' ? 'under review' : f.status.toLowerCase()) : 'all statuses');
    if (f.scope === 'open') bits[0] = 'open reports'; if (f.scope === 'resolved') bits[0] = 'resolved reports';
    if (f.priority !== 'all') bits.push(({ critical: 'urgent', high: 'high priority', normal: 'normal priority' })[f.priority]);
    if (f.cat !== 'all') bits.push(S.cat(f.cat).name.toLowerCase());
    if (role === 'admin' && f.dept !== 'all') bits.push(S.deptName(f.dept));
    bits.push(f.range === 'custom' ? 'custom dates' : TIME_LABEL[f.range].toLowerCase());
    return bits.join(' \u00B7 ');
  }

  /* =====================================================================
   * the map component: used on the Map page and inside admin Insights
   * ===================================================================== */
  function mapHtml(role) {
    var work = role !== 'public';
    return '<div class="mapwrap" id="mw">' +
      '<div class="mapbar">' + (role === 'public'
        ? '<div class="chips2" role="group" aria-label="Which reports to show">' + [['all', 'All'], ['near', 'Nearby'], ['open', 'Open'], ['resolved', 'Resolved']].map(function (c) { return '<button type="button" class="chip2" data-scope="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>'
        : '<div class="chips2" role="group" aria-label="Map view"><button type="button" class="chip2" data-mode="markers">' + icon('pin') + 'Reports</button><button type="button" class="chip2" data-mode="heat">' + icon('dash') + 'Heatmap</button></div>') +
      '<div class="mapbar-r">' + (work ? btn({ label: 'Filters', icon: 'search', id: 'mf-open', small: true }) : '') + '</div></div>' +
      '<form class="mapsearch" id="ms" role="search"><label class="sr" for="ms-q">Search for a place</label><input id="ms-q" type="search" list="ms-l" placeholder="Search for a place" autocomplete="off"><datalist id="ms-l"></datalist>' +
      btn({ label: 'Go', type: 'submit', small: true }) + '</form>' +
      '<p class="map-summary" id="msum" aria-live="polite"></p><p id="mnote" class="map-note" role="status" hidden></p>' +
      '<div class="mapgrid"><div class="mapcol"><div class="mapbox"><div id="maphost"></div><div class="map-state" id="mstate" hidden></div></div>' +
      '<div class="mtabs" role="group" aria-label="Show"><button type="button" class="chip2 is-on" data-pane="map" aria-pressed="true">Map</button><button type="button" class="chip2" data-pane="list" aria-pressed="false">List</button></div>' +
      '<p class="muted small fresh" id="mfresh"></p></div>' +
      '<aside class="mapside" id="mside"><div id="mheat" hidden></div><section aria-labelledby="lg-h"><h2 class="sec-h" id="lg-h">What you are seeing</h2><div id="mlegend"></div></section>' +
      '<section aria-labelledby="ls-h"><h2 class="sec-h" id="ls-h">Reports in this view</h2><div id="mlist"></div></section></aside></div></div>';
  }

  function filterDialog(role, f, apply) {
    var cats = '<option value="all">All</option>' + U.opts(S.CATS, f.cat, function (c) { return c.id; }, function (c) { return c.name; });
    var statuses = ['all', 'Submitted', 'In progress', 'Resolved', 'Reopened'].concat(role === 'admin' ? ['under_review'] : []);
    var depts = role === 'admin' ? '<option value="all">All departments</option>' + U.opts(S.departments(), f.dept, function (d) { return d.id; }, function (d) { return d.name; }) : '';
    U.dialog({
      title: 'Filter the map',
      body: '<form id="ff" novalidate>' +
        U.field({ id: 'ff-s', required: true, label: 'Status', tag: 'select', optionsHtml: U.opts(statuses, f.status, function (x) { return x; }, function (x) { return x === 'all' ? 'All' : (x === 'under_review' ? 'Under review (moderation)' : x); }) }) +
        U.field({ id: 'ff-p', required: true, label: 'Priority', tag: 'select', hint: 'Urgent is set by emergency words. High means escalated, reopened or late.', optionsHtml: U.opts(['all', 'critical', 'high', 'normal'], f.priority, function (x) { return x; }, function (x) { return ({ all: 'All', critical: 'Urgent', high: 'High', normal: 'Normal' })[x]; }) }) +
        U.field({ id: 'ff-c', required: true, label: 'Problem type', tag: 'select', optionsHtml: cats }) +
        U.field({ id: 'ff-t', required: true, label: 'When', tag: 'select', optionsHtml: U.opts(['today', '7', '30', '90', 'all', 'custom'], f.range, function (x) { return x; }, function (x) { return TIME_LABEL[x]; }) }) +
        '<div id="ff-cu"' + (f.range === 'custom' ? '' : ' hidden') + '><div class="two">' + U.field({ id: 'ff-f', label: 'From', type: 'date', value: f.from }) + U.field({ id: 'ff-to', label: 'To', type: 'date', value: f.to }) + '</div></div>' +
        (role === 'admin' ? U.field({ id: 'ff-d', required: true, label: 'Department', tag: 'select', optionsHtml: depts }) : '<p class="muted small">You see reports for ' + esc(S.me().department || 'your department') + '.</p>') +
        '<div class="dlg-foot">' + btn({ label: 'Clear filters', id: 'ff-clear', kind: 'quiet' }) + btn({ label: 'Show reports', type: 'submit', kind: 'primary', id: 'ff-go' }) + '</div></form>',
      onMount: function (root, close) {
        root.querySelector('#ff-t').addEventListener('change', function (e) { root.querySelector('#ff-cu').hidden = e.target.value !== 'custom'; });
        root.querySelector('#ff-clear').addEventListener('click', function () { var d = loadF('x'); apply({ status: 'all', priority: 'all', cat: 'all', dept: 'all', range: role === 'public' ? 'all' : '30', from: '', to: '', scope: 'all' }); close(); });
        root.querySelector('#ff').addEventListener('submit', function (e) {
          e.preventDefault(); U.clearErrors(root);
          var v = function (id) { return root.querySelector(id).value; }, n = { status: v('#ff-s'), priority: v('#ff-p'), cat: v('#ff-c'), range: v('#ff-t'), from: v('#ff-f') || '', to: v('#ff-to') || '', dept: role === 'admin' ? v('#ff-d') : 'all' };
          if (n.range === 'custom' && n.from && n.to && n.from > n.to) { U.showError(root, 'ff-f', 'The start date must come before the end date.'); return; }
          apply(n); close();
        });
      }
    });
  }

  /* wires everything: loading, errors, filters, list, heatmap */
  function mountMap(root, o) {
    var role = o.role, F = Object.assign(loadF(role), o.preset || {});
    if (o.forceMode) F.mode = o.forceMode;
    if (role === 'public') F.mode = 'markers';
    var map = null, data = null, near = null, loaded = null, listN = 20, destroyed = false;
    var q = function (s) { return root.querySelector(s); };
    var hostEl = q('#maphost');
    function alive() { return !destroyed && hostEl && hostEl.isConnected; }   // never touch a page that has been replaced
    var $state = q('#mstate'), $note = q('#mnote'), $sum = q('#msum');

    function state(kind, html) { if (!kind) { $state.hidden = true; $state.innerHTML = ''; return; } $state.hidden = false; $state.className = 'map-state ' + kind; $state.innerHTML = html; }
    function skeleton() { state('loading', '<div class="spin big" aria-hidden="true"></div><p>Loading the map\u2026</p>'); }
    function fail(ex) {
      console.error(ex); S.sysLog('error', 'map', 'Map failed: ' + (ex && ex.message));
      state('error', '<p><strong>Map couldn\u2019t load.</strong></p><p class="muted">Please try again.</p>' + btn({ label: 'Retry', id: 'mretry', kind: 'primary' }));
      var r = q('#mretry'); if (r) r.addEventListener('click', start);
    }

    function query(extra) {
      var f = { scope: F.scope === 'near' ? 'all' : F.scope, status: F.status, priority: F.priority, cat: F.cat, dept: F.dept, range: F.range, from: F.from, to: F.to };
      if (role === 'public') { f.range = 'all'; f.status = 'all'; f.priority = 'all'; f.cat = 'all'; f.dept = 'all'; }
      if (F.scope === 'near' && near) f.near = { lat: near.lat, lng: near.lng, km: 5 };
      return Object.assign(f, extra || {});
    }

    function inView(pts, b) { return pts.filter(function (p) { return p.lat >= b[0] && p.lat <= b[2] && p.lng >= b[1] && p.lng <= b[3]; }); }

    function drawList() {
      if (!alive() || !map || !data) return;
      var v = map.getView(), pts = inView(data.points, v.bounds).sort(function (a, b) { return PR_ORDER[a.pr] - PR_ORDER[b.pr] || b.ts - a.ts; });
      var el = q('#mlist');
      if (!pts.length) { el.innerHTML = '<p class="muted">' + (data.points.length ? 'Nothing in this part of the map. Move or zoom out to see more.' : 'No reports in this area yet.') + '</p>'; return; }
      el.innerHTML = '<ul class="mlist">' + pts.slice(0, listN).map(function (p) {
        return '<li><a class="ml" href="#/c/' + p.id + '"><span class="ml-i">' + M.legendIcon(p.review ? 'review' : p.pr) + '</span><span class="ml-b"><strong>' + esc(p.catName) + '</strong><span>' + esc(p.status === 'Closed' ? 'Resolved' : p.status) + ' \u00B7 ' +
          esc(M.PR_LABEL[p.pr] || '') + ' \u00B7 ' + esc(p.area || 'Area not given') + ' \u00B7 ' + U.ago(p.ts) + '</span></span></a><button type="button" class="link-btn ml-show" data-show="' + p.id + '" aria-label="Show ' + esc(p.catName) + ' on the map">Show on map</button></li>';
      }).join('') + '</ul>' + (pts.length > listN ? '<p class="more">' + btn({ label: 'Show more (' + (pts.length - listN) + ')', id: 'mmore', kind: 'secondary', small: true }) + '</p>' : '');
      var more = q('#mmore'); if (more) more.addEventListener('click', function () { listN += 20; drawList(); });
      el.querySelectorAll('[data-show]').forEach(function (b) { b.addEventListener('click', function () { setPane('map'); map.select(Number(b.getAttribute('data-show')), true); }); });
    }

    function summary() {
      if (!data) return;
      var parts = [];
      if (F.mode === 'heat') return;
      var n = data.located;
      parts.push('Showing ' + n + (n === 1 ? ' report' : ' reports') + (F.scope === 'near' && near ? ' within 5 km of you' : '') + (role === 'public' ? '' : ' \u00B7 ' + describe(F, role)));
      if (data.noLocation) parts.push(data.noLocation + (data.noLocation === 1 ? ' report has' : ' reports have') + ' no location and ' + (data.noLocation === 1 ? 'isn\u2019t' : 'aren\u2019t') + ' on the map. You can find ' + (data.noLocation === 1 ? 'it' : 'them') + ' in the list of reports.');
      if (data.areaOnly) parts.push(data.areaOnly + ' shown at the city centre (approximate).');
      if (data.truncated) parts.push('Zoom in to see all reports. Showing the first ' + data.points.length + '.');
      $sum.textContent = parts[0]; $note.hidden = parts.length < 2; $note.textContent = parts.slice(1).join(' ');
    }

    function heat() {
      var h; try { h = S.heatData({ metric: F.metric, cat: F.cat, dept: F.dept, range: F.range === 'all' || F.range === 'today' ? '30' : F.range, from: F.from, to: F.to }); } catch (ex) { return fail(ex); }
      data = { points: [], located: 0 };
      var el = q('#mheat'); el.hidden = false;
      var rangeTxt = F.range === 'custom' ? 'in the chosen dates' : 'from the ' + (TIME_LABEL[F.range === 'all' || F.range === 'today' ? '30' : F.range] || '').toLowerCase();
      var sentence = 'Showing ' + h.metricLabel + ' ' + rangeTxt + (F.cat !== 'all' ? ' \u00B7 ' + S.cat(F.cat).name : '') + '.';
      $sum.textContent = sentence; $note.hidden = !h.noGps; $note.textContent = h.noGps ? h.noGps + ' matching ' + (h.noGps === 1 ? 'report has' : 'reports have') + ' no GPS point, so ' + (h.noGps === 1 ? 'it isn\u2019t' : 'they aren\u2019t') + ' in the heatmap.' : '';
      el.innerHTML = '<section aria-labelledby="hc-h"><h2 class="sec-h" id="hc-h">Heatmap</h2>' +
        U.field({ id: 'hm-m', required: true, label: 'What to show', tag: 'select', optionsHtml: Object.keys(S.HEAT_METRICS).map(function (k) { return '<option value="' + k + '"' + (k === F.metric ? ' selected' : '') + '>' + ({ total: 'Total complaints', unresolved: 'Unresolved complaints', urgent: 'Urgent complaints', avg_resolution: 'Average resolution time', reopened: 'Reopened complaints' })[k] + '</option>'; }).join('') }) +
        U.field({ id: 'hm-t', required: true, label: 'Time', tag: 'select', optionsHtml: ['7', '30', '90', 'custom'].map(function (k) { var cur = F.range === 'all' || F.range === 'today' ? '30' : F.range; return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + TIME_LABEL[k] + '</option>'; }).join('') }) +
        U.field({ id: 'hm-c', required: true, label: 'Problem type', tag: 'select', optionsHtml: '<option value="all">All</option>' + U.opts(S.CATS, F.cat, function (c) { return c.id; }, function (c) { return c.name; }) }) +
        '<div id="hm-cu"' + (F.range === 'custom' ? '' : ' hidden') + '><div class="two">' + U.field({ id: 'hm-f', label: 'From', type: 'date', value: F.from }) + U.field({ id: 'hm-to', label: 'To', type: 'date', value: F.to }) + '</div></div></section>' +
        '<section aria-labelledby="hs-h"><h2 class="sec-h" id="hs-h">Where reports are concentrated</h2>' +
        (h.enough ? heatLegend() + '<ol class="hotlist">' + h.hotspots.map(function (s, i) {
          return '<li><span class="hot-n" aria-hidden="true">' + (i + 1) + '</span><span><strong>' + esc(s.label) + '</strong><span class="muted"> \u00B7 ' + (F.metric === 'avg_resolution' ? s.value + ' days on average (' + s.count + ' reports)' : s.count + (s.count === 1 ? ' report' : ' reports')) +
            ' \u00B7 ' + ({ high: 'High', medium: 'Medium', low: 'Low' })[s.level] + ' concentration</span></span></li>'; }).join('') + '</ol>'
          : '<p class="muted">' + (h.used === 0 ? 'No reports with a GPS point match this view yet.' : 'Not enough reports to show a heatmap yet. At least 3 reports with GPS points are needed, and there ' + (h.used === 1 ? 'is 1.' : 'are ' + h.used + '.')) + '</p>') + '</section>';
      var sel = function (id, fn) { el.querySelector(id).addEventListener('change', fn); };
      sel('#hm-m', function (e) { F.metric = e.target.value; saveF(role, F); heat(); });
      sel('#hm-t', function (e) { F.range = e.target.value; saveF(role, F); heat(); });
      sel('#hm-c', function (e) { F.cat = e.target.value; saveF(role, F); heat(); });
      ['#hm-f', '#hm-to'].forEach(function (id) { var x = el.querySelector(id); if (x) x.addEventListener('change', function () { F.from = el.querySelector('#hm-f').value; F.to = el.querySelector('#hm-to').value; saveF(role, F); heat(); }); });
      map.setHeat(h.enough ? h.points : [], h.enough ? h.hotspots : []);
      map.setMode('heat');
      if (h.enough && !heat._fit) { map.fit(h.points, 60); heat._fit = true; }
      q('#mlist').innerHTML = h.enough ? '<p class="muted">Switch to Reports to see each report in this area.</p>' : '';
      state(h.used === 0 ? 'empty' : null, h.used === 0 ? '<p><strong>No reports to show yet.</strong></p><p class="muted">The heatmap only uses real reports that have a GPS point.</p>' : '');
      q('#mfresh').innerHTML = freshness();
    }

    function load(fitToo) {
      skeleton();
      requestAnimationFrame(function () {
        if (!alive()) return;
        try {
          if (F.mode === 'heat') { q('#mlegend').innerHTML = legend(role === 'admin'); heat(); return; }
          q('#mheat').hidden = true; map.setMode('markers');
          data = S.mapPoints(query({ limit: 1000 })); loaded = { bbox: null };
          map.setPoints(data.points);
          if (fitToo && data.points.length) map.fit(data.points, 56);
          else if (fitToo) { var me = S.me(), hit = me && (G.lookup(me.city) || G.lookup(me.district)); if (hit) map.setView(hit.lat, hit.lng, 10); }
          summary(); drawList(); q('#mfresh').innerHTML = freshness();
          if (!data.points.length) state('empty', '<p><strong>No reports in this area yet.</strong></p>' + (role === 'public' && S.me() && S.me().role === 'citizen' ? '<p class="muted">Be the first to report a civic issue.</p>' + btn({ label: 'Report a problem', href: '#/new', kind: 'primary', small: true }) : '<p class="muted">Reports will appear here as they come in.</p>'));
          else state(null);
        } catch (ex) { fail(ex); }
      });
    }

    function setMode(m) {
      F.mode = m; saveF(role, F); heat._fit = false;
      root.querySelectorAll('[data-mode]').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
      load(m === 'markers');
    }
    function setPane(p) {
      root.querySelector('#mw').classList.toggle('show-list', p === 'list');
      root.querySelectorAll('[data-pane]').forEach(function (b) { var on = b.getAttribute('data-pane') === p; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
      if (p === 'map' && map) map.refresh();
    }
    function paintScope() { root.querySelectorAll('[data-scope]').forEach(function (b) { var on = b.getAttribute('data-scope') === F.scope; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }); }

    function start() {
      try {
        if (map) map.destroy();
        map = M.create(q('#maphost'), { tiles: tileConfig(), card: card, label: 'Map of reports. Use the arrow keys to move the map, and plus or minus to zoom.',
          onMove: function () { if (!alive()) return; listN = 20; drawList(); },
          onTilesFailed: function () { $note.hidden = false; $note.textContent = 'The street map background couldn\u2019t load, so only the reports are shown. This is normal when offline or when the site blocks outside images.'; } });
        q('#mlegend').innerHTML = legend(role === 'admin');
        paintScope();
        root.querySelectorAll('[data-mode]').forEach(function (b) { var on = b.getAttribute('data-mode') === F.mode; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
        var focus = o.focus ? Number(o.focus) : 0;
        load(true);
        if (focus) setTimeout(function () { if (map && data) map.select(focus, false); }, 120);
      } catch (ex) { fail(ex); }
    }

    // wiring
    root.querySelectorAll('[data-scope]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = b.getAttribute('data-scope');
        if (s !== 'near') { F.scope = s; saveF(role, F); paintScope(); return load(true); }
        if (!navigator.geolocation) { $note.hidden = false; $note.textContent = 'Your device can\u2019t share its location. Search for a place instead.'; return; }
        $note.hidden = false; $note.textContent = 'Finding your location\u2026';
        navigator.geolocation.getCurrentPosition(function (pos) {
          near = { lat: pos.coords.latitude, lng: pos.coords.longitude }; F.scope = 'near'; paintScope(); map.showUser(near.lat, near.lng); load(false); map.setView(near.lat, near.lng, 13);
        }, function () { $note.hidden = false; $note.textContent = 'We couldn\u2019t get your location. Allow location access in your browser, or search for a place.'; }, { timeout: 10000 });
      });
    });
    root.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    root.querySelectorAll('[data-pane]').forEach(function (b) { b.addEventListener('click', function () { setPane(b.getAttribute('data-pane')); }); });
    var fo = q('#mf-open'); if (fo) fo.addEventListener('click', function () { filterDialog(role, F, function (n) { Object.assign(F, n); saveF(role, F); paintScope(); load(true); }); });
    var inp = q('#ms-q');
    inp.addEventListener('input', function () {
      var names = G.suggest(inp.value, 6); (data ? data.points : []).forEach(function (p) { if (p.area && p.area.toLowerCase().indexOf(inp.value.toLowerCase()) === 0 && names.indexOf(p.area) < 0) names.push(p.area); });
      q('#ms-l').innerHTML = names.slice(0, 8).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
    });
    q('#ms').addEventListener('submit', function (e) {
      e.preventDefault();
      var term = inp.value.trim(); if (!term) return;
      var hit = G.lookup(term);
      if (!hit && data) { var m = data.points.filter(function (p) { return (p.area || '').toLowerCase() === term.toLowerCase(); }); if (m.length) { map.fit(m, 60); $note.hidden = true; return; } }
      if (hit) { map.setView(hit.lat, hit.lng, 11); $note.hidden = true; } else { $note.hidden = false; $note.textContent = 'We couldn\u2019t find \u201C' + term + '\u201D. Try the name of a nearby city.'; }
    });
    window.addEventListener('online', refreshFresh); window.addEventListener('offline', refreshFresh);
    function refreshFresh() { if (alive() && q('#mfresh')) q('#mfresh').innerHTML = freshness(); }

    start();
    return { destroy: function () { destroyed = true; if (map) map.destroy(); window.removeEventListener('online', refreshFresh); window.removeEventListener('offline', refreshFresh); } };
  }

  var live = null;   // the map on screen, cleaned up when the page changes
  window.addEventListener('hashchange', function () { if (live) { live.destroy(); live = null; } });   // the next page builds its own map if it needs one

  /* ============================ Map page (everyone) ============================ */
  function mapPage(ctx) {
    var me = ctx.me, role = me && me.role === 'admin' ? 'admin' : (me && me.role === 'official' && S.verifState(me) === 'approved' ? 'official' : 'public');
    return {
      html: wrap(U.pageHeader({ title: 'Reports map', sub: role === 'public' ? 'See what has been reported around you. Places are approximate to protect privacy.' : (role === 'official' ? 'Reports for ' + S.me().department + '.' : 'All active reports.'), actions: viewToggle('map') }) + mapHtml(role), 'wide mapfull'),
      mount: function (root) { if (live) live.destroy(); live = mountMap(root, { role: role, focus: ctx.query.focus }); }
    };
  }

  /* ============================ charts ============================ */
  function summaryTable(headers, rows, caption) {
    return '<details class="tbl"><summary>Show as a table</summary><div class="tbl-w"><table><caption class="sr">' + esc(caption) + '</caption><thead><tr>' + headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return (i === 0 ? '<th scope="row">' : '<td>') + esc(c) + (i === 0 ? '</th>' : '</td>'); }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
  }

  function trendChart(tr, unit) {
    var b = tr.buckets, W = 640, H = 220, pl = 34, pb = 26, pt = 10, iw = W - pl - 8, ih = H - pb - pt;
    var max = 1; b.forEach(function (x) { max = Math.max(max, x.created, x.resolved); });
    var top = Math.max(2, max % 2 ? max + 1 : max), gw = iw / b.length, bw = Math.max(2, Math.min(14, gw * 0.38)), out = '';
    [0, 0.5, 1].forEach(function (t) { var y = pt + ih - ih * t; out += '<line x1="' + pl + '" x2="' + (W - 8) + '" y1="' + y + '" y2="' + y + '" class="ch-grid"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ch-t">' + Math.round(top * t) + '</text>'; });
    b.forEach(function (x, i) {
      var cx = pl + gw * i + gw / 2, h1 = ih * x.created / top, h2 = ih * x.resolved / top;
      out += '<rect x="' + (cx - bw - 1) + '" y="' + (pt + ih - h1) + '" width="' + bw + '" height="' + h1 + '" class="ch-a"><title>' + x.label + ': ' + x.created + ' received</title></rect>';
      out += '<rect x="' + (cx + 1) + '" y="' + (pt + ih - h2) + '" width="' + bw + '" height="' + h2 + '" class="ch-b" fill="url(#hatch)"><title>' + x.label + ': ' + x.resolved + ' resolved</title></rect>';
    });
    [0, Math.floor((b.length - 1) / 2), b.length - 1].forEach(function (i, k) { if (b[i]) out += '<text x="' + (pl + gw * i + gw / 2) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? 'start' : (k === 2 ? 'end' : 'middle')) + '" class="ch-t">' + b[i].label + '</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Bar chart of reports received and resolved per ' + unit + '. A text summary and a table follow."><defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#1B6E36"/><line x1="0" y1="0" x2="0" y2="4" stroke="#fff" stroke-width="1.6"/></pattern></defs>' + out + '</svg>' +
      '<ul class="legend inline"><li><span class="sw sw-a" aria-hidden="true"></span><span>Received</span></li><li><span class="sw sw-b" aria-hidden="true"></span><span>Resolved (striped)</span></li></ul>';
  }

  function barRows(items, labelFn, valFn, pctFn, cls) {
    return '<ul class="bars">' + items.map(function (i) { return '<li><div class="bar-h"><span>' + esc(labelFn(i)) + '</span><strong>' + valFn(i) + '</strong></div><div class="bar-t" aria-hidden="true"><span class="' + (cls || '') + '" style="width:' + Math.max(2, pctFn(i)) + '%"></span></div></li>'; }).join('') + '</ul>';
  }

  /* ============================ Admin Insights ============================ */
  function insights(ctx) {
    if (!ctx.me) return V.needLogin('Log in as an administrator to open this page.');
    if (ctx.me.role !== 'admin') return { html: wrap(U.emptyState({ icon: 'shield', title: 'This page is for administrators', text: 'You do not have access to it.', action: btn({ label: 'Go home', href: '#/', kind: 'primary' }) }), 'narrow') };
    var t = ctx.query.t || 'analytics';
    var tabs = [['analytics', 'Analytics'], ['map', 'Map'], ['heat', 'Heatmap']];
    var nav = '<nav class="tabs" aria-label="Insights">' + tabs.map(function (x) { return '<a href="#/admin/insights?t=' + x[0] + '"' + (x[0] === t ? ' aria-current="true"' : '') + '>' + x[1] + '</a>'; }).join('') + '</nav>';
    if (t === 'map' || t === 'heat') {
      return { html: wrap(U.pageHeader({ title: 'Insights', sub: t === 'heat' ? 'Where complaints are concentrated' : 'All active reports on a map' }) + nav + mapHtml('admin'), 'wide mapfull'),
        mount: function (root) { if (live) live.destroy(); live = mountMap(root, { role: 'admin', forceMode: t === 'heat' ? 'heat' : 'markers', preset: t === 'map' ? { mode: 'markers' } : { mode: 'heat' } }); } };
    }
    var range = ctx.query.range || '30', level = ctx.query.level || '', from = ctx.query.from || '', to = ctx.query.to || '';
    var a;
    try { a = S.analytics({ range: range, from: from, to: to, level: level }); } catch (ex) {
      console.error(ex); S.sysLog('error', 'analytics', 'Analytics failed: ' + (ex && ex.message));
      return { html: wrap(U.pageHeader({ title: 'Insights' }) + nav + '<div class="empty"><h2>Couldn\u2019t load analytics.</h2>' + btn({ label: 'Retry', id: 'an-retry', kind: 'primary' }) + '</div>', 'wide'),
        mount: function (root) { root.querySelector('#an-retry').addEventListener('click', function () { window.DL.app.render(); }); } };
    }
    var T = a.totals, rg = a.range;
    var ranges = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']];
    var ctl = '<div class="an-ctl"><nav class="tabs" aria-label="Time range">' + ranges.map(function (r) { return '<a href="#/admin/insights?t=analytics&range=' + r[0] + (level ? '&level=' + level : '') + '"' + (r[0] === a.rangeKey ? ' aria-current="true"' : '') + '>' + r[1] + '</a>'; }).join('') + '</nav>' +
      (a.rangeKey === 'custom' ? '<form id="cr" class="an-cr" novalidate>' + U.field({ id: 'cr-f', label: 'From', type: 'date', value: from }) + U.field({ id: 'cr-t', label: 'To', type: 'date', value: to }) + btn({ label: 'Apply', type: 'submit', small: true, kind: 'primary' }) + '</form>' : '') + '</div>';
    var noData = U.emptyState({ icon: 'dash', title: 'Not enough data yet', text: 'There are no reports in this period. Numbers appear here as real reports come in.' });
    var fresh = '<p class="muted small fresh">Showing ' + esc(rg.label) + '. ' + freshness() + (a.isDemo ? ' <strong>Demo data.</strong>' : '') + '</p>';

    var avg = T.avgResolutionDays == null ? '\u2014' : T.avgResolutionDays + ' days';
    var cards = '<div class="stats">' + [[T.total, 'Total reports'], [T.open, 'Open'], [T.resolved, 'Resolved'], [T.urgent, 'Urgent (open)'], [avg, 'Average time to resolve'], [T.reopened, 'Reopened']].map(function (c) { return '<div class="stat"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>'; }).join('') + '</div>' +
      (T.avgResolutionDays == null ? '<p class="muted small">No resolved reports in this period yet, so there is no average.</p>' : '<p class="muted small">Average time from report to final resolution, using resolved reports only.</p>');

    var body = '';
    if (!a.enough) body = noData;
    else {
      var tr = a.trend, busiest = tr.buckets.reduce(function (m, x) { return x.created > m.created ? x : m; }, tr.buckets[0]);
      var trendTxt = 'In ' + rg.label + ', ' + T.total + (T.total === 1 ? ' report was' : ' reports were') + ' received and ' + tr.buckets.reduce(function (s, x) { return s + x.resolved; }, 0) + ' resolved. The busiest ' + tr.unit + (tr.unit === 'week' ? ' started on ' : ' was ') + busiest.label + ' with ' + busiest.created + '.';
      var cats = a.categories, top = cats[0];
      var catTxt = esc(top.name) + ' is currently the most reported category (' + top.pct + '%, ' + top.count + ' of ' + T.total + ' reports).';
      var wk = a.status.work, wtot = wk.reduce(function (s, x) { return s + x.count; }, 0) || 1, md = a.status.moderation;
      var MODL = [['normal', 'Normal'], ['flagged', 'Flagged by users'], ['under_review', 'Under review'], ['verified', 'Checked and cleared'], ['rejected', 'Rejected'], ['archived', 'Archived']];
      var sl = a.sla, slPct = sl.resolved.pct;
      body =
        sec('Reports over time', trendChart(tr, tr.unit) + '<p class="chart-sum">' + esc(trendTxt) + '</p>' + summaryTable(['Period starting', 'Received', 'Resolved'], tr.buckets.map(function (x) { return [x.label, x.created, x.resolved]; }), 'Reports received and resolved per ' + tr.unit)) +
        sec('What people report', barRows(cats, function (c) { return c.name; }, function (c) { return c.pct + '% \u00B7 ' + c.count; }, function (c) { return c.pct; }, 'bar-a') + '<p class="chart-sum">' + catTxt + '</p>' +
          summaryTable(['Category', 'Reports', 'Share'], cats.map(function (c) { return [c.name, c.count, c.pct + '%']; }), 'Reports per category')) +
        sec('Work status', '<p class="muted">Where each active report is in the work. This is separate from moderation.</p><div class="stackbar" role="img" aria-label="' + wk.map(function (x) { return x.label + ' ' + x.count; }).join(', ') + '">' + wk.map(function (x, i) { return x.count ? '<span class="sb sb' + i + '" style="width:' + (x.count / wtot * 100) + '%"><b>' + x.count + '</b></span>' : ''; }).join('') + '</div>' +
          '<ul class="legend inline">' + wk.map(function (x, i) { return '<li><span class="sw sb' + i + '" aria-hidden="true"></span><span>' + x.label + ': ' + x.count + '</span></li>'; }).join('') + '</ul>') +
        sec('Moderation status', '<p class="muted">Checks on the report itself. <strong>Being flagged does not mean a report is fake.</strong> Only an admin decision rejects a report.</p><ul class="modlist">' +
          MODL.map(function (m) { return '<li><span>' + m[1] + '</span><strong>' + md[m[0]] + '</strong></li>'; }).join('') + '</ul><p class="muted small">Counted from ' + a.status.moderationTotal + ' reports in this period. Rejected and archived reports are left out of every other number on this page.</p>') +
        sec('Response targets', '<p class="muted">Each type of problem has a target number of days. These numbers use the targets already set in the system.</p>' +
          (slPct == null ? '<p class="muted">No resolved reports yet, so there is nothing to measure.</p>' : '<div class="meter" role="img" aria-label="' + slPct + ' percent of resolved reports were within target"><span style="width:' + slPct + '%"></span></div><p><strong>' + slPct + '%</strong> of resolved reports were fixed within target (' + sl.resolved.within + ' of ' + sl.resolved.total + ').</p>') +
          '<ul class="modlist"><li><span>Open, within target</span><strong>' + sl.open.within + '</strong></li><li><span>Open, nearly out of time</span><strong>' + sl.open.near + '</strong></li><li><span>Open, past target</span><strong>' + sl.open.over + '</strong></li></ul>') +
        sec('Departments', '<p class="muted">Shown in alphabetical order. These numbers are for understanding the workload, not for ranking.</p><ul class="rlist">' + a.departments.map(function (d) {
          return '<li class="plainrow"><div><strong>' + esc(d.name) + '</strong><p class="muted">Open ' + d.open + ' \u00B7 Resolved ' + d.resolved + ' \u00B7 Average ' + (d.avgDays == null ? 'not yet' : d.avgDays + ' days') + (d.slaPct == null ? '' : ' \u00B7 ' + d.slaPct + '% within target') + (d.rating ? ' \u00B7 Citizen rating ' + d.rating.avg + ' of 5' : '') + '</p></div></li>'; }).join('') + '</ul>') +
        sec('Areas', '<div class="an-area"><label for="lv">Group by</label><select id="lv">' + [['city', 'City or town'], ['district', 'District'], ['state', 'State']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === a.level ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
          (a.areas.length ? '<ul class="rlist">' + a.areas.slice(0, 12).map(function (r) { return '<li class="plainrow"><div><strong>' + esc(r.name) + '</strong><p class="muted">Reports ' + r.reports + ' \u00B7 Open ' + r.open + ' \u00B7 Urgent ' + r.urgent + ' \u00B7 Resolved ' + r.rate + '% \u00B7 Average ' + (r.avgDays == null ? 'not yet' : r.avgDays + ' days') + '</p></div></li>'; }).join('') + '</ul>' +
            (a.areas.length > 12 ? '<p class="muted small">Showing the 12 areas with the most reports.</p>' : '') : '<p class="muted">Not enough data yet.</p>') +
          '<p class="muted small">Areas come from what people typed when they reported. The site does not assume wards or zones.</p>') +
        (T.noGps ? '<p class="muted small">' + T.noGps + (T.noGps === 1 ? ' report has' : ' reports have') + ' no GPS point. ' + (T.noGps === 1 ? 'It is' : 'They are') + ' counted here but can\u2019t appear in the heatmap.</p>' : '');
    }
    return {
      html: wrap(U.pageHeader({ title: 'Insights', sub: 'Numbers from real, active reports only' }) + nav + ctl + fresh + (a.enough ? sec('Overview', cards) : '') + body, 'wide insights'),
      mount: function (root) {
        var lv = root.querySelector('#lv'); if (lv) lv.addEventListener('change', function () { location.hash = '#/admin/insights?t=analytics&range=' + a.rangeKey + '&level=' + lv.value + (from ? '&from=' + from : '') + (to ? '&to=' + to : ''); });
        var cr = root.querySelector('#cr'); if (cr) cr.addEventListener('submit', function (e) { e.preventDefault(); var f = root.querySelector('#cr-f').value, t2 = root.querySelector('#cr-t').value; if (f && t2 && f > t2) { U.clearErrors(root); U.showError(root, 'cr-f', 'The start date must come before the end date.'); return; } location.hash = '#/admin/insights?t=analytics&range=custom&from=' + f + '&to=' + t2 + (level ? '&level=' + level : ''); });
      }
    };
  }

  window.DL.mapViews = { map: mapPage, adminInsights: insights, viewToggle: viewToggle, freshness: freshness };
})();
