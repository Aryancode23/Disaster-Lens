/* TEST ONLY. Replaces js/vendor/supabase.js in the browser tests.
 * The database underneath is real PostgreSQL (PGlite, WebAssembly) running the project's real supabase/schema.sql, so every
 * rule, privilege and row-level-security policy is the real thing. What is imitated is only the transport: sign-in tokens,
 * the HTTP calls, the storage service and the realtime socket. Those are imitated in the most literal way possible.
 */
(function () {
  var ENGINE = 'http://127.0.0.1:8766';
  var STUBS = "create role anon nologin; create role authenticated nologin; create schema auth;" +
    "create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');" +
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;" +
    "grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;" +
    "create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
    "create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);" +
    "alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated; grant select, insert on storage.objects to anon, authenticated;" +
    "create table public.mock_creds(email text primary key, pw text not null, uid uuid not null, confirmed boolean not null default true);" +
    "create table public.mock_blobs(path text primary key, data text not null);";

  var failSignUp = null, dbReady = null, queue = Promise.resolve(), net = true, failNext = null, confirmRequired = false, listeners = [], lastFeed = 0, blobs = {}, mails = [], authCbs = [];
  var SESSION_KEY = 'dl_auth';

  function boot() {
    if (dbReady) return dbReady;
    dbReady = (async function () {
      var mod = await import(ENGINE + '/pglite/index.js');
      var db = new mod.PGlite('idb://dl-mock');
      await db.waitReady;
      var has = (await db.query("select to_regclass('public.reports') as t")).rows[0].t;
      if (!has) { await db.exec(STUBS); await db.exec(await (await fetch(ENGINE + '/schema.sql')).text()); }
      lastFeed = (await db.query('select coalesce(max(id),0)::int m from change_feed')).rows[0].m;
      return db;
    })();
    return dbReady;
  }
  function serial(fn) { var p = queue.then(fn, fn); queue = p.then(function () { }, function () { }); return p; }
  function session() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function netCheck() { if (!net) throw new TypeError('Failed to fetch'); }

  async function asRole(db, uid, sql, params) {
    await db.exec('reset role');
    if (uid) { await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]); }
    else { await db.exec('set role anon'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
    try { return await db.query(sql, params || []); } finally { await db.exec('reset role'); }
  }

  /* what Realtime would do: tell every open listener about new rows in the change stream that THEY are allowed to see */
  async function pump() {
    var db = await boot();
    var rows = await serial(async function () {
      var all = (await db.query('select id from change_feed where id > $1 order by id', [lastFeed])).rows;
      if (!all.length) return [];
      var top = all[all.length - 1].id, s = session();
      var vis = (await asRole(db, s && s.uid, 'select * from change_feed where id > $1 order by id', [lastFeed])).rows;
      lastFeed = top; return vis;
    });
    if (rows.length) setTimeout(function () { rows.forEach(function (r) { listeners.forEach(function (l) { if (l.status === 'on') l.cb({ eventType: 'INSERT', new: r }); }); }); }, 40);
  }

  async function callRpc(uid, name, args) {
    var db = await boot();
    if (failNext) { var m = failNext; failNext = null; return { data: null, error: { message: m } }; }
    var keys = Object.keys(args || {});
    var sql = 'select ' + name + '(' + keys.map(function (k, i) { return k + ' => $' + (i + 1); }).join(', ') + ') as v';
    var params = keys.map(function (k) { var v = args[k]; return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v; });
    try {
      var r = await serial(function () { return asRole(db, uid, sql, params); });
      var out = { data: r.rows[0] ? r.rows[0].v : null, error: null };
      pump();
      return out;
    } catch (e) {
      var msg = String(e && e.message || e);
      if (/does not exist|function .* not unique/i.test(msg) && /function/i.test(msg)) return { data: null, error: { message: 'Could not find the function public.' + name, code: 'PGRST202' } };
      pump();
      return { data: null, error: { message: msg, code: 'P0001' } };
    }
  }

  function emitAuth(ev, s) { authCbs.forEach(function (cb) { try { cb(ev, s); } catch (e) { } }); }
  function sess(uid, email) { return uid ? { access_token: 'mock.' + uid, user: { id: uid, email: email } } : null; }

  function createClient() {
    var client = {
      auth: {
        onAuthStateChange: function (cb) { authCbs.push(cb); return { data: { subscription: { unsubscribe: function () { } } } }; },
        getSession: async function () { netCheck(); var s = session(); return { data: { session: s ? sess(s.uid, s.email) : null }, error: null }; },
        signUp: async function (a) {
          netCheck(); if (failSignUp) { var f = failSignUp; return { data: { user: null, session: null }, error: { message: f.message, code: f.code, status: 429 } }; } var db = await boot(); var email = a.email.toLowerCase();
          var existing = (await db.query('select uid from mock_creds where email=$1', [email])).rows[0];
          if (existing) return { data: { user: { id: existing.uid, identities: [] }, session: null }, error: null };   // real Supabase hides "already registered" like this
          try {
            var id = (await serial(async function () {
              await db.exec('reset role');
              var r = await db.query('insert into auth.users(email, raw_user_meta_data) values ($1,$2) returning id', [email, JSON.stringify((a.options && a.options.data) || {})]);
              await db.query('insert into mock_creds(email,pw,uid,confirmed) values ($1,$2,$3,$4)', [email, a.password, r.rows[0].id, !confirmRequired]);
              return r.rows[0].id;
            }));
            if (confirmRequired) { mails.push({ to: email, kind: 'confirm' }); pump(); return { data: { user: { id: id, identities: [{}] }, session: null }, error: null }; }
            localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: id, email: email })); pump(); emitAuth('SIGNED_IN', sess(id, email));
            return { data: { user: { id: id, identities: [{}] }, session: sess(id, email) }, error: null };
          } catch (e) { return { data: { user: null, session: null }, error: { message: String(e.message || e).replace(/^.*?ERROR:\s*/, '') } }; }
        },
        signInWithPassword: async function (a) {
          netCheck(); var db = await boot(); var email = a.email.toLowerCase();
          var row = (await serial(function () { return db.query('select uid,pw,confirmed from mock_creds where email=$1', [email]); })).rows[0];
          if (!row || row.pw !== a.password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
          if (!row.confirmed) return { data: { user: null, session: null }, error: { message: 'Email not confirmed' } };
          localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: row.uid, email: email })); emitAuth('SIGNED_IN', sess(row.uid, email));
          return { data: { user: { id: row.uid }, session: sess(row.uid, email) }, error: null };
        },
        signOut: async function () { localStorage.removeItem(SESSION_KEY); emitAuth('SIGNED_OUT', null); return { error: null }; },
        resetPasswordForEmail: async function (email) { netCheck(); mails.push({ to: email.toLowerCase(), kind: 'reset' }); return { data: {}, error: null }; },
        updateUser: async function (a) {
          netCheck(); var s = session(); if (!s) return { data: null, error: { message: 'Auth session missing!' } };
          var db = await boot(); if (a.password) await serial(function () { return db.query('update mock_creds set pw=$1 where uid=$2', [a.password, s.uid]); });
          return { data: { user: { id: s.uid } }, error: null };
        }
      },
      rpc: async function (name, args) { netCheck(); var s = session(); return callRpc(s && s.uid, name, args); },
      storage: {
        from: function (bucket) {
          return {
            upload: async function (path, blob) {
              netCheck(); var db = await boot(), s = session();
              try {
                await serial(function () { return asRole(db, s && s.uid, 'insert into storage.objects(bucket_id,name,owner) values ($1,$2,$3)', [bucket, path, s && s.uid]); });
                var buf = new Uint8Array(await blob.arrayBuffer()), bin = ''; for (var i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                await serial(function () { return db.query('insert into mock_blobs(path,data) values ($1,$2)', [path, 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(bin)]); });
                return { data: { path: path }, error: null };
              } catch (e) { return { data: null, error: { message: 'new row violates row-level security policy' } }; }
            },
            createSignedUrls: async function (paths) {
              netCheck(); var db = await boot(), s = session();
              var found = (await serial(function () { return asRole(db, s && s.uid, 'select name from storage.objects where bucket_id=$1 and name = any($2)', [bucket, paths]); })).rows.map(function (r) { return r.name; });
              var datas = found.length ? (await serial(function () { return db.query('select path,data from mock_blobs where path = any($1)', [found]); })).rows : [], by = {}; datas.forEach(function (r) { by[r.path] = r.data; });
              return { data: paths.map(function (p) { return by[p] ? { path: p, signedUrl: by[p], error: null } : { path: p, signedUrl: null, error: 'Object not found' }; }), error: null };
            }
          };
        }
      },
      channel: function () {
        var l = { cb: null, status: 'off' };
        var ch = { on: function (t, f, cb) { l.cb = cb; return ch; }, subscribe: function (statusCb) { listeners.push(l); setTimeout(function () { l.status = net ? 'on' : 'off'; statusCb && statusCb(net ? 'SUBSCRIBED' : 'CHANNEL_ERROR'); }, 20); return ch; }, _l: l };
        return ch;
      },
      removeChannel: function (ch) { if (ch && ch._l) { ch._l.status = 'off'; listeners = listeners.filter(function (x) { return x !== ch._l; }); } }
    };
    return client;
  }

  window.supabase = { createClient: createClient };

  /* handles for the test script (never part of the real site) */
  window.__sb = {
    ready: boot,
    sql: async function (q, p) { var db = await boot(); return serial(async function () { await db.exec('reset role'); return (await db.query(q, p || [])).rows; }); },
    as: function (email) { return { rpc: async function (name, args) { var db = await boot(); var row = (await serial(function () { return db.query('select uid from mock_creds where email=$1', [email.toLowerCase()]); })).rows[0]; return callRpc(row && row.uid, name, args); } }; },
    net: function (on) { net = !!on; listeners.forEach(function (l) { l.status = on ? 'on' : 'off'; }); },
    failNext: function (m) { failNext = m; },
    failSignUp: function (f) { failSignUp = f; },
    confirmRequired: function (on) { confirmRequired = !!on; },
    confirm: async function (email) { var db = await boot(); await serial(function () { return db.query('update mock_creds set confirmed=true where email=$1', [email.toLowerCase()]); }); },
    recover: async function (email) { var db = await boot(); var row = (await serial(function () { return db.query('select uid from mock_creds where email=$1', [email.toLowerCase()]); })).rows[0]; localStorage.setItem(SESSION_KEY, JSON.stringify({ uid: row.uid, email: email })); emitAuth('PASSWORD_RECOVERY', sess(row.uid, email)); },
    mails: mails, pump: pump,
    wipe: function () { return new Promise(function (res) { var r = indexedDB.deleteDatabase('/pglite/dl-mock'); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); }
  };
})();
