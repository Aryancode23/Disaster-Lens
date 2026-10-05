/* Disaster Lens – router and page frame (Phase 2.5) */
(function () {
  var S = window.DL.store, U = window.DL.ui, V = window.DL.views, AV = window.DL.adminViews, AC = window.DL.accountViews, MV = window.DL.mapViews, esc = U.esc;

  var ROUTES = [
    [/^\/?$/, 'home'], [/^\/feed$/, 'feed'], [/^\/new$/, 'newReport'], [/^\/c\/(\d+)$/, 'detail'],
    [/^\/mine$/, 'mine'], [/^\/alerts$/, 'alerts'], [/^\/profile$/, 'profile'], [/^\/login$/, 'login'],
    [/^\/signup$/, 'signup'], [/^\/about$/, 'about'], [/^\/desk$/, 'desk'], [/^\/check-email$/, 'checkEmail'], [/^\/reset$/, 'reset'],
    [/^\/verification$/, 'verification', 'account'], [/^\/setup$/, 'setup', 'account'], [/^\/demo$/, 'demo', 'account'],
    [/^\/admin$/, 'adminHome', 'admin'], [/^\/admin\/reports$/, 'adminReports', 'admin'], [/^\/admin\/r\/(\d+)$/, 'adminReport', 'admin'],
    [/^\/admin\/moderation$/, 'adminModeration', 'admin'], [/^\/admin\/authorities$/, 'adminAuthorities', 'admin'], [/^\/admin\/authorities\/([\w-]+)$/, 'adminAuthority', 'admin'],
    [/^\/admin\/citizens$/, 'adminCitizens', 'admin'], [/^\/admin\/citizens\/([\w-]+)$/, 'adminCitizen', 'admin'], [/^\/admin\/departments$/, 'adminDepartments', 'admin'],
    [/^\/admin\/logs$/, 'adminLogs', 'admin'], [/^\/admin\/settings$/, 'adminSettings', 'admin'], [/^\/admin\/search$/, 'adminSearch', 'admin'], [/^\/admin\/more$/, 'adminMore', 'admin'],
    [/^\/map$/, 'map', 'map'], [/^\/admin\/insights$/, 'adminInsights', 'map']
  ];
  var TITLES = { home: 'Home', feed: 'Community reports', newReport: 'Report a problem', detail: 'Report', mine: 'My reports', alerts: 'Alerts',
    profile: 'Profile', checkEmail: 'Check your email', reset: 'New password', login: 'Log in', signup: 'Create account', about: 'About', desk: 'Desk', verification: 'Verification', setup: 'Set up', demo: 'Demo mode',
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
      '<div class="top-act">' + (me
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

  function offline() { document.getElementById('offline').hidden = navigator.onLine; }
  window.addEventListener('online', offline);
  window.addEventListener('offline', offline);
  window.addEventListener('hashchange', onRoute);

  window.DL.app = { render: render, logout: logout };
  S.init().then(function () { offline(); onRoute(); });
})();
