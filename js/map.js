/* Disaster Lens – map engine (Phase 5)
 *
 * A small, self-contained map: no map library, no API key, no network needed.
 *   - Web Mercator maths, so a street-map background can be switched on later (off by default)
 *   - drag / pinch / wheel / keyboard to move and zoom
 *   - clustering (many close reports become one numbered bubble)
 *   - every marker has a SHAPE and a text label, never colour alone
 *   - optional heat layer drawn on a canvas
 *   - the map only draws what the data layer gave it; it never fetches or invents anything
 */
(function () {
  var G = window.DL.geo, NS = 'http://www.w3.org/2000/svg';
  var MIN_Z = 3, MAX_Z = 18, CLUSTER_PX = 64, NO_CLUSTER_Z = 16;

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function div(cls, parent) { var d = document.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var PR_LABEL = { critical: 'Urgent', high: 'High priority', normal: 'Normal', resolved: 'Resolved' };

  /* The shape of a marker says what it is: triangle = urgent, diamond = high, circle = normal, square = resolved, hexagon = under review */
  var SHAPES = {
    critical: { path: 'M0,-15 L14,11 L-14,11 Z', fill: '#B3261E', glyph: '<text x="0" y="8" text-anchor="middle" font-size="15" font-weight="800" fill="#fff" font-family="sans-serif">!</text>' },
    high:     { path: 'M0,-15 L14,0 L0,15 L-14,0 Z', fill: '#A84300', glyph: '<path d="M0,6 L0,-6 M-5,-1 L0,-7 L5,-1" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    normal:   { path: 'M0,-12 A12,12 0 1 1 -0.01,-12 Z', fill: '#7A5200', glyph: '<circle cx="0" cy="0" r="3.4" fill="#fff"/>' },
    resolved: { path: 'M-11,-11 H11 V11 H-11 Z', fill: '#1B6E36', glyph: '<path d="M-5,0 L-1,4 L6,-4" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    review:   { path: 'M-6,-13 L6,-13 L13,0 L6,13 L-6,13 L-13,0 Z', fill: '#4A5663', glyph: '<text x="0" y="5" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="sans-serif">?</text>' }
  };

  function create(host, opt) {
    opt = opt || {};
    var st = {
      center: opt.center || { lat: G.INDIA.lat, lng: G.INDIA.lng }, zoom: opt.zoom || G.INDIA.zoom, w: 320, h: 320,
      points: [], heat: [], mode: 'markers', selected: null, user: null, hot: [], raf: 0, moveTimer: 0, tileFails: 0, destroyed: false, lastTap: 0
    };
    var tilesOn = !!(opt.tiles && opt.tiles.enabled && opt.tiles.url);

    host.classList.add('map'); host.innerHTML = '';
    host.setAttribute('tabindex', '0'); host.setAttribute('role', 'group');
    host.setAttribute('aria-label', opt.label || 'Map of reports. Use the arrow keys to move the map, and plus or minus to zoom.');
    var tileLayer = div('map-tiles', host);
    var canvas = document.createElement('canvas'); canvas.className = 'map-heat'; canvas.setAttribute('aria-hidden', 'true'); host.appendChild(canvas);
    var svg = svgEl('svg', { 'class': 'map-svg' }); host.appendChild(svg);
    var gGrid = svgEl('g', { 'aria-hidden': 'true' }, svg), gLabels = svgEl('g', { 'aria-hidden': 'true' }, svg), gMarkers = svgEl('g', {}, svg), gUser = svgEl('g', {}, svg);
    var ctrl = div('map-ctrl', host);
    ctrl.innerHTML = '<button type="button" class="map-btn" data-act="in" aria-label="Zoom in">+</button><button type="button" class="map-btn" data-act="out" aria-label="Zoom out">\u2212</button>';
    var scale = div('map-scale', host); scale.setAttribute('aria-hidden', 'true');
    var attrib = div('map-attrib', host);
    if (tilesOn && opt.tiles.attribution) attrib.innerHTML = opt.tiles.attribution; else attrib.textContent = 'Base map off: place names are approximate';
    var card = div('map-card', host); card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Report summary'); card.setAttribute('tabindex', '-1');

    /* ---------- geometry ---------- */
    function measure() { st.w = host.clientWidth || 320; st.h = host.clientHeight || 320; }
    function toScreen(lat, lng) {
      var c = G.project(st.center.lat, st.center.lng, st.zoom), p = G.project(lat, lng, st.zoom);
      return { x: p.x - c.x + st.w / 2, y: p.y - c.y + st.h / 2 };
    }
    function fromScreen(x, y) {
      var c = G.project(st.center.lat, st.center.lng, st.zoom);
      return G.unproject(c.x + x - st.w / 2, c.y + y - st.h / 2, st.zoom);
    }
    function bounds() { var sw = fromScreen(0, st.h), ne = fromScreen(st.w, 0); return [sw.lat, sw.lng, ne.lat, ne.lng]; }
    function setView(lat, lng, z, quiet) {
      if (!isFinite(lat) || !isFinite(lng)) return;
      st.center = { lat: clamp(lat, -80, 80), lng: clamp(lng, -179, 179) };
      if (z != null && isFinite(z)) st.zoom = clamp(z, MIN_Z, MAX_Z);
      schedule(quiet);
    }
    function zoomAt(x, y, dz) {
      var z2 = clamp(st.zoom + dz, MIN_Z, MAX_Z);
      if (z2 === st.zoom) return;
      var geo = fromScreen(x, y), p = G.project(geo.lat, geo.lng, z2);
      var c = G.unproject(p.x - (x - st.w / 2), p.y - (y - st.h / 2), z2);
      st.zoom = z2; st.center = { lat: clamp(c.lat, -80, 80), lng: clamp(c.lng, -179, 179) }; schedule();
    }
    function panBy(dx, dy) {
      var c = G.project(st.center.lat, st.center.lng, st.zoom), n = G.unproject(c.x - dx, c.y - dy, st.zoom);
      st.center = { lat: clamp(n.lat, -80, 80), lng: clamp(n.lng, -179, 179) }; schedule();
    }
    function fitPoints(pts, pad) {
      pts = (pts || []).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); });
      if (!pts.length) return false;
      measure();
      var s = 90, n = -90, w = 180, e = -180;
      pts.forEach(function (p) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng); });
      var cLat = (s + n) / 2, cLng = (w + e) / 2, z = 15, padPx = pad == null ? 48 : pad;
      if (pts.length > 1 && (n - s > 0.0004 || e - w > 0.0004)) {
        for (z = 17; z > MIN_Z; z -= 0.25) {
          var a = G.project(n, w, z), b = G.project(s, e, z);
          if (Math.abs(b.x - a.x) <= st.w - padPx * 2 && Math.abs(b.y - a.y) <= st.h - padPx * 2) break;
        }
      }
      setView(cLat, cLng, Math.min(z, 16));
      return true;
    }

    /* ---------- drawing ---------- */
    function schedule(quiet) {
      if (st.destroyed) return;
      st.quiet = quiet;
      if (!st.raf) st.raf = requestAnimationFrame(function () { st.raf = 0; render(); });
    }

    function drawTiles() {
      tileLayer.style.display = tilesOn ? 'block' : 'none';
      if (!tilesOn) return;
      var z = clamp(Math.round(st.zoom), 3, 18), f = Math.pow(2, st.zoom - z), size = 256 * f;
      var c = G.project(st.center.lat, st.center.lng, z), cs = G.project(st.center.lat, st.center.lng, st.zoom);
      var topLeft = { x: cs.x - st.w / 2, y: cs.y - st.h / 2 };
      var x0 = Math.floor(topLeft.x / size), x1 = Math.floor((topLeft.x + st.w) / size), y0 = Math.floor(topLeft.y / size), y1 = Math.floor((topLeft.y + st.h) / size);
      var max = Math.pow(2, z), want = {};
      for (var tx = x0; tx <= x1; tx++) for (var ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= max) continue;
        var wx = ((tx % max) + max) % max, key = z + '/' + wx + '/' + ty + '@' + tx;
        want[key] = true;
        var img = tileLayer.querySelector('[data-k="' + key + '"]');
        if (!img) {
          img = document.createElement('img'); img.setAttribute('data-k', key); img.alt = ''; img.setAttribute('referrerpolicy', 'no-referrer'); img.draggable = false;
          img.onerror = function () { st.tileFails++; if (st.tileFails === 4 && opt.onTilesFailed) opt.onTilesFailed(); };
          img.src = opt.tiles.url.replace('{z}', z).replace('{x}', wx).replace('{y}', ty);
          tileLayer.appendChild(img);
        }
        img.style.width = img.style.height = size + 'px';
        img.style.transform = 'translate(' + (tx * size - topLeft.x) + 'px,' + (ty * size - topLeft.y) + 'px)';
      }
      Array.prototype.slice.call(tileLayer.children).forEach(function (im) { if (!want[im.getAttribute('data-k')]) tileLayer.removeChild(im); });
    }

    function drawGrid() {
      gGrid.innerHTML = '';
      if (tilesOn) return;
      var steps = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005], step = steps[0], b = bounds();
      for (var i = 0; i < steps.length; i++) {
        var a = toScreen(0, 0), c2 = toScreen(0, steps[i]);
        step = steps[i];
        if (Math.abs(c2.x - a.x) < 110) break;
      }
      var la = Math.ceil(b[0] / step) * step, lo = Math.ceil(b[1] / step) * step, k;
      for (k = la; k <= b[2] && k < 90; k += step) { var y = toScreen(k, b[1]).y; svgEl('line', { x1: 0, x2: st.w, y1: y, y2: y, 'class': 'map-grid' }, gGrid); var t = svgEl('text', { x: 6, y: y - 4, 'class': 'map-grid-t' }, gGrid); t.textContent = (Math.round(k * 1000) / 1000) + '\u00B0N'; }
      for (k = lo; k <= b[3] && k < 180; k += step) { var x = toScreen(b[0], k).x; svgEl('line', { x1: x, x2: x, y1: 0, y2: st.h, 'class': 'map-grid' }, gGrid); var t2 = svgEl('text', { x: x + 4, y: st.h - 6, 'class': 'map-grid-t' }, gGrid); t2.textContent = (Math.round(k * 1000) / 1000) + '\u00B0E'; }
    }

    function drawLabels() {
      gLabels.innerHTML = '';
      if (opt.labels === false || st.zoom < 4.5) return;
      var maxRank = st.zoom < 6 ? 1 : (st.zoom < 7.5 ? 2 : (st.zoom < 9 ? 3 : 4)), placed = [], count = 0;
      G.CITIES.slice().sort(function (a, b) { return a[3] - b[3]; }).forEach(function (c) {
        if (c[3] > maxRank || count > 28) return;
        var p = toScreen(c[1], c[2]);
        if (p.x < 6 || p.y < 12 || p.x > st.w - 6 || p.y > st.h - 6) return;
        var wpx = c[0].length * 6.6 + 10, r = { x: p.x - 4, y: p.y - 12, w: wpx, h: 16 };
        for (var i = 0; i < placed.length; i++) { var q = placed[i]; if (r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y) return; }
        placed.push(r); count++;
        svgEl('circle', { cx: p.x, cy: p.y, r: 2.5, 'class': 'map-city' }, gLabels);
        var t = svgEl('text', { x: p.x + 6, y: p.y + 4, 'class': 'map-city-t' }, gLabels); t.textContent = c[0];
      });
    }

    function drawScale() {
      var mpp = 156543.03392 * Math.cos(st.center.lat * Math.PI / 180) / Math.pow(2, st.zoom), nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000], m = nice[0];
      for (var i = 0; i < nice.length; i++) { m = nice[i]; if (m / mpp >= 56) break; }
      scale.innerHTML = '<span style="width:' + Math.round(m / mpp) + 'px"></span>' + (m >= 1000 ? (m / 1000) + ' km' : m + ' m');
    }

    /* grouping: close markers become one numbered bubble */
    function groups(vis) {
      if (st.zoom >= NO_CLUSTER_Z) {
        var seen = {};
        return vis.map(function (v) {
          var k = Math.round(v.x) + ',' + Math.round(v.y), n = seen[k] = (seen[k] || 0) + 1;
          if (n > 1) { var ang = n * 2.4, r = 10 + n * 2; v = { p: v.p, x: v.x + Math.cos(ang) * r, y: v.y + Math.sin(ang) * r }; }
          return { items: [v] };
        });
      }
      var cells = {};
      vis.forEach(function (v) { var k = Math.floor(v.x / CLUSTER_PX) + ',' + Math.floor(v.y / CLUSTER_PX); (cells[k] = cells[k] || []).push(v); });
      return Object.keys(cells).map(function (k) { return { items: cells[k] }; });
    }

    function drawMarkers() {
      gMarkers.innerHTML = '';
      var vis = [];
      st.points.forEach(function (p) {
        if (!isFinite(p.lat) || !isFinite(p.lng)) return;                  // bad data never crashes the map
        var s = toScreen(p.lat, p.lng);
        if (s.x < -40 || s.y < -40 || s.x > st.w + 40 || s.y > st.h + 40) return;
        vis.push({ p: p, x: s.x, y: s.y });
      });
      st.visibleCount = vis.length;
      groups(vis).forEach(function (g) {
        if (g.items.length === 1) return marker(g.items[0]);
        cluster(g.items);
      });
      if (st.selected) { var sp = st.points.filter(function (p) { return p.id === st.selected; })[0]; if (sp && !card.hidden) placeCard(sp); }
    }

    function marker(v) {
      var p = v.p, key = p.review ? 'review' : p.pr, sh = SHAPES[key] || SHAPES.normal;
      var label = (p.catName || 'Report') + ', ' + (p.review ? 'under review' : (PR_LABEL[p.pr] || '')) + ', ' + (p.status || '') + (p.area ? ', ' + p.area : '') + (p.q === 'area' ? ', approximate area' : '') + '. Press Enter for details.';
      var g = svgEl('g', { 'class': 'mk' + (st.selected === p.id ? ' mk-sel' : '') + (p.q === 'area' ? ' mk-area' : ''), transform: 'translate(' + v.x.toFixed(1) + ',' + v.y.toFixed(1) + ')', tabindex: '0', role: 'button', 'aria-label': label, 'data-id': p.id }, gMarkers);
      if (st.selected === p.id) svgEl('circle', { r: 21, 'class': 'mk-ring' }, g);
      svgEl('path', { d: sh.path, fill: sh.fill, stroke: '#fff', 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-dasharray': p.q === 'area' ? '4 3' : 'none' }, g);
      var gl = svgEl('g', {}, g); gl.innerHTML = sh.glyph;
    }

    function cluster(items) {
      var n = items.length, x = 0, y = 0, crit = 0;
      items.forEach(function (v) { x += v.x; y += v.y; if (v.p.pr === 'critical') crit++; });
      x /= n; y /= n;
      var r = 16 + Math.min(14, Math.log(n) / Math.LN2 * 4);
      var g = svgEl('g', { 'class': 'cl', transform: 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')', tabindex: '0', role: 'button',
        'aria-label': n + ' reports here' + (crit ? ', ' + crit + ' urgent' : '') + '. Press Enter to zoom in.', 'data-cl': '1' }, gMarkers);
      g._items = items.map(function (v) { return v.p; });
      svgEl('circle', { r: r, 'class': 'cl-c' }, g);
      var t = svgEl('text', { y: 5, 'text-anchor': 'middle', 'class': 'cl-t' }, g); t.textContent = n > 99 ? '99+' : n;
      if (crit) { var b = svgEl('g', { transform: 'translate(' + (r * 0.72) + ',' + (-r * 0.72) + ')' }, g); svgEl('path', { d: 'M0,-8 L8,6 L-8,6 Z', fill: '#B3261E', stroke: '#fff', 'stroke-width': 1.6 }, b); var bt = svgEl('text', { y: 4.5, 'text-anchor': 'middle', 'class': 'cl-b' }, b); bt.textContent = '!'; }
    }

    function drawUser() {
      gUser.innerHTML = '';
      if (!st.user) return;
      var s = toScreen(st.user.lat, st.user.lng);
      var g = svgEl('g', { transform: 'translate(' + s.x + ',' + s.y + ')', role: 'img', 'aria-label': 'You are here' }, gUser);
      svgEl('circle', { r: 16, 'class': 'me-ring' }, g); svgEl('circle', { r: 7, 'class': 'me-dot' }, g);
      var t = svgEl('text', { y: -22, 'text-anchor': 'middle', 'class': 'me-t' }, g); t.textContent = 'You are here';
    }

    /* heat: draw soft blobs, then turn the blob density into colours. It only draws real points it was given. */
    var LUT = (function () {
      var stops = [[0, [46, 158, 87], 0], [0.15, [46, 158, 87], 120], [0.4, [242, 194, 48], 185], [0.7, [237, 125, 30], 205], [1, [198, 40, 40], 225]], out = [];
      for (var i = 0; i < 256; i++) {
        var t = i / 255, a = stops[0], b = stops[stops.length - 1];
        for (var k = 0; k < stops.length - 1; k++) if (t >= stops[k][0] && t <= stops[k + 1][0]) { a = stops[k]; b = stops[k + 1]; break; }
        var u = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
        out.push([a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u, a[1][2] + (b[1][2] - a[1][2]) * u, a[2] + (b[2] - a[2]) * u]);
      }
      return out;
    })();
    function drawHeat() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(st.w * dpr), H = Math.round(st.h * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      if (st.mode !== 'heat' || !st.heat.length || !ctx.getImageData) { canvas.style.visibility = 'hidden'; return; }
      canvas.style.visibility = 'visible';
      var maxW = 0; st.heat.forEach(function (p) { if (p.w > maxW) maxW = p.w; });
      var R = 34 * dpr;
      st.heat.forEach(function (p) {
        var s = toScreen(p.lat, p.lng), x = s.x * dpr, y = s.y * dpr;
        if (x < -R || y < -R || x > W + R || y > H + R) return;
        var a = 0.14 + 0.04 * (p.w / (maxW || 1)), gr = ctx.createRadialGradient(x, y, 0, x, y, R);
        gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      });
      var img = ctx.getImageData(0, 0, W, H), d = img.data, peak = 0, i;
      for (i = 3; i < d.length; i += 4) if (d[i] > peak) peak = d[i];
      var norm = 255 / Math.max(peak, 230);                                   // one lone report stays green; only real overlap turns orange and red
      for (i = 0; i < d.length; i += 4) {
        var al = d[i + 3];
        if (!al) continue;
        var c = LUT[Math.min(255, Math.round(al * norm))];
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
      }
      ctx.putImageData(img, 0, 0);
    }

    function drawHotspots() {
      st.hotG && st.hotG.parentNode && st.hotG.parentNode.removeChild(st.hotG);
      if (st.mode !== 'heat' || !st.hot.length) return;
      st.hotG = svgEl('g', {}, svg);
      st.hot.slice(0, 3).forEach(function (h, i) {
        var s = toScreen(h.lat, h.lng);
        if (s.x < 0 || s.y < 0 || s.x > st.w || s.y > st.h) return;
        var g = svgEl('g', { transform: 'translate(' + s.x + ',' + s.y + ')', role: 'img', 'aria-label': 'Hotspot ' + (i + 1) + ': ' + h.count + ' reports near ' + h.label }, st.hotG);
        svgEl('circle', { r: 11, 'class': 'hot-b' }, g);
        var t = svgEl('text', { y: 4.5, 'text-anchor': 'middle', 'class': 'hot-t' }, g); t.textContent = i + 1;
      });
    }

    function render() {
      measure();
      drawTiles(); drawGrid(); drawLabels();
      drawHeat();
      if (st.mode === 'heat') { gMarkers.innerHTML = ''; st.visibleCount = 0; } else drawMarkers();
      drawHotspots(); drawUser(); drawScale();
      if (!st.quiet) { clearTimeout(st.moveTimer); st.moveTimer = setTimeout(function () { if (opt.onMove && !st.destroyed) opt.onMove(api.getView()); }, 250); }
    }

    /* ---------- the small report card ---------- */
    function placeCard(p) {
      card.className = 'map-card' + (st.w < 560 ? ' as-sheet' : '');
      if (st.w >= 560) {
        var s = toScreen(p.lat, p.lng), cw = 280, ch = card.offsetHeight || 190;
        var left = clamp(s.x - cw / 2, 8, st.w - cw - 8), top = s.y - ch - 22;
        if (top < 8) top = Math.min(st.h - ch - 8, s.y + 22);
        card.style.left = left + 'px'; card.style.top = top + 'px'; card.style.width = cw + 'px';
      } else { card.style.left = card.style.top = card.style.width = ''; }
    }
    function openCard(p, focus) {
      st.selected = p.id;
      card.innerHTML = '<button type="button" class="map-card-x" data-act="close">Close</button>' + (opt.card ? opt.card(p) : '');
      card.hidden = false; placeCard(p);
      if (focus) card.focus();
      schedule(true);
    }
    function closeCard() { if (card.hidden) return; card.hidden = true; st.selected = null; schedule(true); }

    function activate(el) {
      if (!el) return;
      if (el.getAttribute('data-cl')) {
        var items = el._items || [];
        var lo = items.reduce(function (a, p) { return Math.min(a, p.lat); }, 90), hi = items.reduce(function (a, p) { return Math.max(a, p.lat); }, -90);
        var wl = items.reduce(function (a, p) { return Math.min(a, p.lng); }, 180), el2 = items.reduce(function (a, p) { return Math.max(a, p.lng); }, -180);
        if (hi - lo < 0.0003 && el2 - wl < 0.0003) setView((lo + hi) / 2, (wl + el2) / 2, Math.min(MAX_Z, st.zoom + 3));
        else fitPoints(items, 60);
        if (st.zoom + 0.01 >= MAX_Z) return;
        return;
      }
      var id = Number(el.getAttribute('data-id')), p = st.points.filter(function (x) { return x.id === id; })[0];
      if (p) { openCard(p, false); if (opt.onSelect) opt.onSelect(p); }
    }

    /* ---------- input ---------- */
    var ptrs = {}, drag = null, pinch = null;
    function pos(e) { var r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    host.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.map-ctrl') || e.target.closest('.map-card')) return;
      ptrs[e.pointerId] = pos(e);
      var ids = Object.keys(ptrs);
      if (ids.length === 1) drag = { id: e.pointerId, start: pos(e), last: pos(e), t: Date.now(), moved: false, target: e.target };
      if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; }
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    function onMove(e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = pos(e);
      var ids = Object.keys(ptrs);
      if (ids.length === 2 && pinch) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0 && d > 0) { zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, Math.log(d / pinch.d) / Math.LN2); pinch.d = d; }
        return;
      }
      if (drag && drag.id === e.pointerId) {
        var p = pos(e), dx = p.x - drag.last.x, dy = p.y - drag.last.y;
        if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 6) { drag.moved = true; if (st.w >= 560) closeCard(); }
        if (drag.moved) { panBy(dx, dy); drag.last = p; }
      }
    }
    function onUp(e) {
      if (!ptrs[e.pointerId]) return;
      var d = drag; delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinch = null;
      if (d && d.id === e.pointerId) {
        drag = null;
        if (!d.moved && Date.now() - d.t < 600) {
          var t = e.target && e.target.closest ? e.target.closest('.mk, .cl') : null;
          if (t) { st.lastTap = Date.now(); activate(t); } else if (!e.target.closest('.map-card')) closeCard();
        }
      }
    }
    host.addEventListener('click', function (e) {
      var b = e.target.closest('.map-btn'); if (b) { var act = b.getAttribute('data-act'); zoomAt(st.w / 2, st.h / 2, act === 'in' ? 1 : -1); return; }
      var x = e.target.closest('[data-act="close"]'); if (x) { closeCard(); host.focus(); return; }
      var t = e.target.closest('.mk, .cl');
      if (t && Date.now() - st.lastTap > 500) activate(t);           // keyboard and screen-reader activation
    });
    host.addEventListener('dblclick', function (e) { var p = pos(e); zoomAt(p.x, p.y, 1); });
    host.addEventListener('wheel', function (e) { e.preventDefault(); var p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 0.5 : -0.5); }, { passive: false });
    host.addEventListener('keydown', function (e) {
      var t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.closest && t.closest('.mk, .cl')) { e.preventDefault(); activate(t.closest('.mk, .cl')); var c = card; setTimeout(function () { if (!c.hidden) c.focus(); }, 0); return; }
      if (e.key === 'Escape') { if (!card.hidden) { closeCard(); host.focus(); } return; }
      if (t !== host) return;
      var k = e.key, step = 80;
      if (k === 'ArrowLeft') panBy(step, 0); else if (k === 'ArrowRight') panBy(-step, 0); else if (k === 'ArrowUp') panBy(0, step); else if (k === 'ArrowDown') panBy(0, -step);
      else if (k === '+' || k === '=') zoomAt(st.w / 2, st.h / 2, 1); else if (k === '-' || k === '_') zoomAt(st.w / 2, st.h / 2, -1); else return;
      e.preventDefault();
    });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { schedule(); }) : null;
    if (ro) ro.observe(host); else window.addEventListener('resize', schedule);

    var api = {
      setPoints: function (pts) { st.points = (pts || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); }); if (st.selected && !st.points.some(function (p) { return p.id === st.selected; })) closeCard(); schedule(true); },
      setHeat: function (pts, hot) { st.heat = (pts || []).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); }); st.hot = hot || []; schedule(true); },
      setMode: function (m) { st.mode = m === 'heat' ? 'heat' : 'markers'; if (st.mode === 'heat') closeCard(); schedule(true); },
      fit: function (pts, pad) { return fitPoints(pts, pad); },
      setView: function (lat, lng, z) { setView(lat, lng, z); },
      getView: function () { measure(); return { center: { lat: st.center.lat, lng: st.center.lng }, zoom: st.zoom, bounds: bounds(), visible: st.visibleCount || 0 }; },
      select: function (id, focus) { var p = st.points.filter(function (x) { return x.id === id; })[0]; if (p) { setView(p.lat, p.lng, Math.max(st.zoom, 14), true); openCard(p, focus); if (opt.onSelect) opt.onSelect(p); } return !!p; },
      showUser: function (lat, lng) { st.user = lat == null ? null : { lat: lat, lng: lng }; schedule(true); },
      setTiles: function (cfg) { tilesOn = !!(cfg && cfg.enabled && cfg.url); opt.tiles = cfg || opt.tiles; st.tileFails = 0; tileLayer.innerHTML = ''; attrib.innerHTML = tilesOn && cfg.attribution ? cfg.attribution : 'Base map off: place names are approximate'; schedule(true); },
      zoomBy: function (d) { zoomAt(st.w / 2, st.h / 2, d); },
      refresh: function () { schedule(true); },
      destroy: function () { st.destroyed = true; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); window.removeEventListener('resize', schedule); if (ro) ro.disconnect(); cancelAnimationFrame(st.raf); }
    };
    schedule(true);
    return api;
  }

  /* small inline icons for legends: the same shapes as on the map */
  function legendIcon(kind) {
    var sh = SHAPES[kind];
    return '<svg class="lg-i" viewBox="-17 -17 34 34" width="24" height="24" aria-hidden="true" focusable="false"><path d="' + sh.path + '" fill="' + sh.fill + '" stroke="#fff" stroke-width="2"/>' + sh.glyph + '</svg>';
  }

  window.DL.map = { create: create, legendIcon: legendIcon, PR_LABEL: PR_LABEL, esc: esc };
})();
