/* Disaster Lens – router and page frame (Phase 2.5) */
(function () {
  var S = window.DL.store, U = window.DL.ui, V = window.DL.views, AV = window.DL.adminViews, AC = window.DL.accountViews, MV = window.DL.mapViews, esc = U.esc;

  var ROUTES = [
    [/^\/?$/, 'home'], [/^\/feed$/, 'feed'], [/^\/new$/, 'newReport'], [/^\/c\/(\d+)$/, 'detail'],
    [/^\/mine$/, 'mine'], [/^\/alerts$/, 'alerts'], [/^\/profile$/, 'profile'], [/^\/login$/, 'login'],
    [/^\/signup$/, 'signup'], [/^\/about$/, 'about'], [/^\/desk$/, 'desk'],
    [/^\/verification$/, 'verification', 'account'], [/^\/forgot$/, 'forgot', 'account'], [/^\/reset$/, 'reset', 'account'], [/^\/setup$/, 'setup', 'account'], [/^\/demo$/, 'demo', 'account'],
    [/^\/admin$/, 'adminHome', 'admin'], [/^\/admin\/reports$/, 'adminReports', 'admin'], [/^\/admin\/r\/(\d+)$/, 'adminReport', 'admin'],
    [/^\/admin\/moderation$/, 'adminModeration', 'admin'], [/^\/admin\/authorities$/, 'adminAuthorities', 'admin'], [/^\/admin\/authorities\/([\w-]+)$/, 'adminAuthority', 'admin'],
    [/^\/admin\/citizens$/, 'adminCitizens', 'admin'], [/^\/admin\/citizens\/([\w-]+)$/, 'adminCitizen', 'admin'], [/^\/admin\/departments$/, 'adminDepartments', 'admin'],
    [/^\/admin\/logs$/, 'adminLogs', 'admin'], [/^\/admin\/settings$/, 'adminSettings', 'admin'], [/^\/admin\/search$/, 'adminSearch', 'admin'], [/^\/admin\/more$/, 'adminMore', 'admin'],
    [/^\/map$/, 'map', 'map'], [/^\/admin\/insights$/, 'adminInsights', 'map']
  ];
  var TITLES = { home: 'Home', feed: 'Community reports', newReport: 'Report a problem', detail: 'Report', mine: 'My reports', alerts: 'Alerts',
    profile: 'Profile', login: 'Log in', signup: 'Create account', about: 'About', desk: 'Desk', verification: 'Verification', forgot: 'Forgot password', reset: 'New password', setup: 'Set up', demo: 'Demo mode',
    adminHome: 'Admin dashboard', adminReports: 'Admin reports', adminReport: 'Moderate report', adminModeration: 'Fake & spam desk', adminAuthorities: 'Authority verification',
    adminAuthority: 'Official', adminCitizens: 'Citizens', adminCitizen: 'Citizen', adminDepartments: 'Departments', adminLogs: 'Logs', adminSettings: 'Settings', adminSearch: 'Search', adminMore: 'More', map: 'Reports map', adminInsights: 'Insights' };

  function parseHash() {
    var raw = (location.hash || '#/').slice(1);
    var parts = raw.split('?');
    var query = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      try { query[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) { /* ignore bad escape */ }
    });
    return { path: parts[0] || '/', query: query };
  }

  /* small indicator of the live connection (online mode only) */
  function connLabel() {
    var st = S.cloudStatus();
    if (st === 'local') return null;
    return { live: ['live', 'Live', 'Live updates are on'], polling: ['sync', 'Syncing', 'Checking for updates every few seconds'], offline: ['off', 'Offline', 'You are offline'] }[st] || ['sync', 'Connecting', 'Connecting'];
  }
  function conn() {
    var c = connLabel();
    return c ? '<span class="conn conn-' + c[0] + '" id="conn" role="status" title="' + c[2] + '"><i aria-hidden="true"></i>' + c[1] + '</span>' : '';
  }
  function paintConnection() {
    var el = document.getElementById('conn'), c = connLabel();
    if (el && c) { el.className = 'conn conn-' + c[0]; el.title = c[2]; el.innerHTML = '<i aria-hidden="true"></i>' + c[1]; }
    else if (!el && c) render();
    offline();
  }

  /* Re-draw after data arrives from the server, but never while someone is typing or a dialog is open. */
  var HOLD = /^\/(new|login|signup|forgot|reset|setup|demo)$/;
  function softRender() {
    var path = parseHash().path, ae = document.activeElement, typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && document.getElementById('app').contains(ae);
    var dialog = document.getElementById('modal-root').children.length > 0;
    if (HOLD.test(path) || typing || dialog) { showFresh(!HOLD.test(path)); return; }
    hideFresh(); render();
  }
  function showFresh(on) {
    var el = document.getElementById('fresh');
    if (!on) return;
    el.hidden = false; el.innerHTML = '<button type="button" class="btn btn-primary btn-sm" id="fresh-go">New updates \u00B7 Refresh</button>';
    document.getElementById('fresh-go').addEventListener('click', function () { hideFresh(); render(); });
  }
  function hideFresh() { var el = document.getElementById('fresh'); if (el) el.hidden = true; }

  function logout() { S.logout(); U.toast('You are logged out'); location.hash = '#/'; render(); }

  function frame(me, path) {
    var official = !!me && me.role !== 'citizen';
    var bar = document.getElementById('demo-bar');
    bar.hidden = !S.isDemo();
    document.documentElement.style.setProperty('--bar', S.isDemo() && window.innerWidth >= 900 ? '38px' : '0px');
    bar.innerHTML = S.isDemo() ? '<span><strong>Demo mode.</strong> This is sample data, not real reports.</span> <a class="link-on-dark" href="#/demo">Demo options</a>' : '';
    document.getElementById('shell').className = 'shell' + (official ? ' has-sidebar' : '');
    document.getElementById('sidebar').innerHTML = official ? U.sidebar(me, path) : '';
    var sb = document.getElementById('logout-sb'); if (sb) sb.addEventListener('click', logout);

    var links = U.navItems(me, false).map(function (it) {
      var on = it.key === '/' ? path === '/' : (path === it.key || path.indexOf(it.key + '/') === 0);
      return '<a href="' + it.href + '"' + (on ? ' aria-current="page"' : '') + '>' + it.label + (it.badge ? '<span class="count" aria-label="' + it.badge + ' unread">' + it.badge + '</span>' : '') + '</a>';
    }).join('');
    var commOn = path === '/feed';
    if (me && !official) links = links.replace('<a href="#/alerts"', '<a href="#/feed"' + (commOn ? ' aria-current="page"' : '') + '>Community</a><a href="#/alerts"');
    document.getElementById('top').innerHTML =
      '<div class="top-in"><a class="brand" href="' + (official ? '#/desk' : '#/') + '" aria-label="Disaster Lens home">' + U.LOGO + '<span>Disaster Lens</span></a>' +
      '<nav class="top-nav" aria-label="Main">' + links + '</nav>' +
      conn() + '<div class="top-act">' + (me
        ? (official ? '' : '<a class="btn btn-primary btn-sm" href="#/new">Report a problem</a>')
        : '<a class="btn btn-secondary btn-sm" href="#/login">Log in</a><a class="btn btn-primary btn-sm" href="#/signup">Sign up</a>') + '</div></div>';

    document.getElementById('tabbar').innerHTML = U.bottomNav(me, path);
    document.body.classList.toggle('flow', path === '/new' && !!me && !official);
    document.body.classList.toggle('is-admin', !!me && me.role === 'admin');
    var d = V.DEV;
    document.getElementById('foot').innerHTML = '<div class="foot-in"><span>Disaster Lens · Built by ' + esc(d.team) + '</span><span><a class="link" href="#/about">About</a> · <a class="link" href="mailto:' + d.email + '">' + d.email + '</a></span></div>';
  }

  function render() {
    var loc = parseHash();
    var me = S.me();
    var view, params = [];
    var set = V;
    for (var i = 0; i < ROUTES.length; i++) {
      var m = ROUTES[i][0].exec(loc.path);
      if (m) { view = ROUTES[i][1]; params = m.slice(1); set = ROUTES[i][2] === 'admin' ? AV : (ROUTES[i][2] === 'account' ? AC : (ROUTES[i][2] === 'map' ? MV : V)); break; }
    }
    var out;
    try {
      out = view ? set[view]({ me: me, params: params, query: loc.query, path: loc.path })
        : { html: '<div class="wrap narrow">' + U.emptyState({ icon: 'search', title: 'Page not found', text: 'The page you are looking for does not exist.', action: U.button({ label: 'Go home', href: '#/', kind: 'primary' }) }) + '</div>' };
    } catch (e) {
      console.error(e);
      out = { html: '<div class="wrap narrow">' + U.emptyState({ icon: 'alert', title: 'Something went wrong', text: 'Please reload the page. If it keeps happening, reset the demo data from the About page.', action: U.button({ label: 'Reload', href: '#/', kind: 'primary', attrs: 'onclick="location.reload()"' }) }) + '</div>' };
    }
    var app = document.getElementById('app');
    app.innerHTML = out.html;
    if (!app.querySelector('h1')) { // pages made only of an empty state still need one main heading
      var eh = app.querySelector('.empty h2');
      if (eh) { var h1 = document.createElement('h1'); h1.id = 'page-title'; h1.tabIndex = -1; h1.className = eh.className; h1.innerHTML = eh.innerHTML; eh.replaceWith(h1); }
    }
    frame(me, loc.path);
    document.title = (view ? TITLES[view] + ' – ' : '') + 'Disaster Lens' + (S.isDemo() ? ' (demo)' : '');
    if (out.mount) out.mount(app);
  }

  var lastPath = null;
  function onRoute() {
    var p = location.hash;
    var changed = p.split('?')[0] !== lastPath;
    render();
    if (changed) {
      window.scrollTo(0, 0);
      var h = document.getElementById('page-title') || document.getElementById('app');
      if (h && h.focus) h.focus({ preventScroll: true });
    }
    lastPath = p.split('?')[0];
  }

  function offline() {
    var el = document.getElementById('offline'), off = !navigator.onLine || S.cloudStatus() === 'offline';
    el.hidden = !off;
    el.textContent = S.isCloud() ? 'You are offline. You can look at saved reports, but you can only make changes when you are back online.' : 'You are offline. Your reports are saved on this device.';
  }
  window.addEventListener('online', offline);
  window.addEventListener('offline', offline);
  window.addEventListener('hashchange', onRoute);

  window.DL.app = { render: render, softRender: softRender, paintConnection: paintConnection, logout: logout };
  function boot() {
    S.init().then(function () { offline(); onRoute(); }).catch(function (ex) {
      console.error(ex);
      document.getElementById('app').innerHTML = '<div class="wrap narrow">' + U.emptyState({ icon: 'alert', title: 'Cannot connect', text: (ex && ex.message) || 'We could not reach the server. Check your internet connection and try again.',
        action: U.button({ label: 'Try again', id: 'boot-retry', kind: 'primary' }) }) + '</div>';
      document.getElementById('boot-retry').addEventListener('click', function () { document.getElementById('app').innerHTML = '<div class="wrap"><div class="skel skel-h"></div></div>'; boot(); });
    });
  }
  boot();
})();
