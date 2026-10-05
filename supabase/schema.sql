-- =====================================================================
-- Disaster Lens – Supabase backend (Phase 6)
-- Run this whole file once in the Supabase SQL editor (or with the Supabase CLI).
--
-- Design in one paragraph: browsers never read or write tables directly. Every
-- table has row-level security switched on with NO policies, so direct access is
-- denied. All reading goes through get_snapshot() and all changes go through the
-- functions below. Each function re-checks who is calling (auth.uid()), their role,
-- their account state and the rules of the app. The page can be changed by anyone
-- with developer tools; this file cannot.
-- =====================================================================

-- ---------- helpers ----------
create or replace function now_ms() returns bigint language sql stable as
$$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function ms(ts timestamptz) returns bigint language sql immutable as
$$ select case when ts is null then null else (extract(epoch from ts) * 1000)::bigint end $$;

-- ---------- tables ----------
create table if not exists departments (
  id text primary key,
  name text not null unique,
  description text not null default '',
  active boolean not null default true,
  roles jsonb not null default '[]'
);

create table if not exists categories (
  id text primary key,
  name text not null,
  sla_days int not null,
  default_dept text not null references departments(id)
);

create table if not exists app_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'citizen' check (role in ('citizen', 'official', 'admin')),
  name text not null,
  email text not null default '',
  phone text not null default '',
  state text not null default '',
  district text not null default '',
  city text not null default '',
  pincode text not null default '',
  created_at timestamptz not null default now(),
  account_status text not null default 'active' check (account_status in ('active', 'suspended', 'banned')),
  account_until timestamptz,
  account_reason text not null default '',
  account_by text not null default '',
  mod_history jsonb not null default '[]',
  authority_role text not null default '',
  dept_id text references departments(id),
  id_proof text not null default '',
  verification jsonb
);

create table if not exists reports (
  id bigint generated always as identity primary key,
  client_uuid uuid unique,
  citizen_id uuid not null references profiles(id),
  is_anonymous boolean not null default false,
  category text not null references categories(id),
  title text not null,
  description text not null,
  state text not null default '',
  district text not null default '',
  city text not null default '',
  pincode text not null default '',
  address text not null default '',
  lat double precision,
  lng double precision,
  location_privacy text not null default 'approximate' check (location_privacy in ('approximate', 'hidden', 'exact')),
  image_path text,
  status text not null default 'Submitted' check (status in ('Submitted', 'In progress', 'Resolved', 'Reopened', 'Closed')),
  priority text not null default 'Routine' check (priority in ('Urgent', 'Routine')),
  priority_reason text not null default '',
  dept_id text not null references departments(id),
  sla_days int not null,
  sla_start timestamptz,
  is_escalated boolean not null default false,
  authority_response text not null default '',
  resolution_path text,
  assigned_officer uuid references profiles(id),
  mod_status text not null default 'normal' check (mod_status in ('normal', 'flagged', 'under_review', 'verified', 'rejected', 'archived')),
  mod_outcome text not null default '',
  mod_reason text not null default '',
  duplicate_of bigint references reports(id),
  mod_log jsonb not null default '[]',
  timeline jsonb not null default '[]',
  resolutions jsonb not null default '[]',
  disputes jsonb not null default '[]',
  audit jsonb,
  reopen_count int not null default 0,
  flag_count int not null default 0,
  upvote_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reports_status_idx on reports (status);
create index if not exists reports_category_idx on reports (category);
create index if not exists reports_dept_idx on reports (dept_id);
create index if not exists reports_created_idx on reports (created_at desc);
create index if not exists reports_citizen_idx on reports (citizen_id);
create index if not exists reports_mod_idx on reports (mod_status);
create index if not exists reports_geo_idx on reports (lat, lng) where lat is not null;

create table if not exists report_media (
  path text primary key,
  report_id bigint not null references reports(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  report_id bigint not null references reports(id) on delete cascade,
  author_id uuid not null references profiles(id),
  author_name text not null,
  author_role text not null,
  text text not null check (char_length(text) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists comments_report_idx on comments (report_id);

create table if not exists upvotes (
  user_id uuid not null references profiles(id) on delete cascade,
  report_id bigint not null references reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, report_id)
);

create table if not exists flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  report_id bigint not null references reports(id) on delete cascade,
  reason_id text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, report_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null default 'general',
  title text not null,
  message text not null default '',
  link text not null default '',
  report_id bigint,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- append-only record of admin actions; every row carries a hash of the row before it
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  ts bigint not null default now_ms(),
  admin_id uuid,
  admin_name text not null default 'System',
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  target_label text not null default '',
  reason text not null default '',
  meta jsonb not null default '{}',
  prev text not null,
  hash text not null
);

create table if not exists system_log (
  id bigint generated always as identity primary key,
  ts bigint not null default now_ms(),
  level text not null,
  area text not null,
  message text not null,
  meta jsonb not null default '{}'
);

-- a tiny, non-sensitive stream that browsers listen to in real time ("something changed, fetch again")
create table if not exists change_feed (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,
  report_id bigint,
  user_id uuid
);
create index if not exists change_feed_ts_idx on change_feed (ts);

-- ---------- lock everything down ----------
alter table departments enable row level security;
alter table categories enable row level security;
alter table app_settings enable row level security;
alter table profiles enable row level security;
alter table reports enable row level security;
alter table report_media enable row level security;
alter table comments enable row level security;
alter table upvotes enable row level security;
alter table flags enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table system_log enable row level security;
alter table change_feed enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- the only table a browser may read directly: the change stream, and only rows meant for everyone or for that user
drop policy if exists change_feed_read on change_feed;
create policy change_feed_read on change_feed for select to anon, authenticated
  using (user_id is null or user_id = auth.uid());
grant select on change_feed to anon, authenticated;

-- audit log can never be edited or removed, not even by the owner role
create or replace function block_audit_changes() returns trigger language plpgsql as
$$ begin raise exception 'The audit log cannot be changed.'; end $$;
drop trigger if exists audit_no_update on audit_log;
create trigger audit_no_update before update or delete on audit_log for each row execute function block_audit_changes();
drop trigger if exists audit_no_truncate on audit_log;
create trigger audit_no_truncate before truncate on audit_log for each statement execute function block_audit_changes();

-- ---------- seed data that is configuration, not fake content ----------
insert into departments (id, name, description) values
  ('municipal', 'Municipal Office', 'General civic problems and anything that fits nowhere else.'),
  ('works', 'Public Works Department', 'Roads, bridges, footpaths and public buildings.'),
  ('water', 'Water & Sewerage Board', 'Drinking water, drains and sewers.'),
  ('electricity', 'Electricity Board', 'Street lights, poles and live wires.'),
  ('sanitation', 'Municipal Sanitation', 'Garbage collection and cleanliness.'),
  ('disaster', 'Disaster Management Cell', 'Floods, waterlogging and emergencies.'),
  ('fire', 'Fire Services', 'Fire and safety hazards.'),
  ('housing', 'Building & Housing', 'Damaged and unsafe buildings.'),
  ('health', 'Health Department', 'Health centres and medical supplies.'),
  ('police', 'Police', 'Cases that need the police.')
on conflict (id) do nothing;

insert into categories (id, name, sla_days, default_dept) values
  ('road', 'Roads & potholes', 7, 'works'), ('water', 'Water & drainage', 5, 'water'),
  ('power', 'Electricity & live wires', 2, 'electricity'), ('waste', 'Waste & sanitation', 5, 'sanitation'),
  ('flood', 'Flood & waterlogging', 1, 'disaster'), ('fire', 'Fire & safety', 1, 'fire'),
  ('building', 'Building damage & collapse', 2, 'housing'), ('health', 'Health & medical', 2, 'health'),
  ('other', 'Something else', 7, 'municipal')
on conflict (id) do nothing;

insert into app_settings (id, data) values (1, '{
  "reviewThreshold": 5, "flagsPerDay": 5, "reportsPerHour": 5, "auditDays": 7, "maxReopens": 2,
  "publicGridMeters": 500, "mapTiles": false, "areaLevel": "city", "fallbackDeptId": "municipal", "categoryDept": {}
}') on conflict (id) do nothing;

-- =====================================================================
-- internal helpers (not callable from the browser)
-- =====================================================================
create or replace function cfg(k text) returns jsonb language sql stable security definer set search_path = public as
$$ select data -> k from app_settings where id = 1 $$;

create or replace function dept_name(d text) returns text language sql stable security definer set search_path = public as
$$ select coalesce((select name from departments where id = d), 'Unknown department') $$;

create or replace function is_active_report(m text) returns boolean language sql immutable as
$$ select m in ('normal', 'flagged', 'verified') $$;

create or replace function is_approved(p profiles) returns boolean language sql immutable as
$$ select p.role = 'official' and coalesce(p.verification ->> 'status', '') = 'approved' $$;

-- the logged-in person, with account rules applied. perm: create | comment | vote | flag | audit | work | any
create or replace function require_user(perm text default 'any') returns profiles
language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  select * into u from profiles where id = auth.uid();
  if not found then raise exception 'Please log in first.'; end if;
  if u.account_status = 'suspended' and u.account_until is not null and u.account_until < now() then
    update profiles set account_status = 'active', account_until = null, account_reason = '', account_by = '' where id = u.id returning * into u;
  end if;
  if u.account_status = 'banned' then raise exception 'This account has been blocked.'; end if;
  if u.account_status = 'suspended' and perm in ('create', 'comment', 'vote', 'flag') then
    raise exception 'Your account is suspended until %. You cannot do this right now.', to_char(u.account_until, 'DD Mon YYYY');
  end if;
  if u.role = 'official' and not is_approved(u) and perm in ('comment', 'work') then
    raise exception 'Your official access is not approved yet.';
  end if;
  return u;
end $$;

create or replace function require_admin() returns profiles language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  u := require_user('any');
  if u.role <> 'admin' then raise exception 'You do not have permission to do this.'; end if;
  return u;
end $$;

create or replace function notify(uid uuid, t text, ttl text, msg text, lnk text, rid bigint default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if uid is null then return; end if;
  insert into notifications (user_id, type, title, message, link, report_id) values (uid, t, ttl, msg, coalesce(lnk, ''), rid);
end $$;

create or replace function notify_admins(t text, ttl text, msg text, lnk text, rid bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select id from profiles where role = 'admin' loop perform notify(a.id, t, ttl, msg, lnk, rid); end loop;
end $$;

create or replace function notify_dept(d text, t text, ttl text, msg text, lnk text, rid bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  for o in select id from profiles where role = 'official' and dept_id = d and verification ->> 'status' = 'approved' and account_status <> 'banned' loop
    perform notify(o.id, t, ttl, msg, lnk, rid);
  end loop;
end $$;

create or replace function add_event(rid bigint, lbl text) returns void language sql security definer set search_path = public as
$$ update reports set timeline = timeline || jsonb_build_array(jsonb_build_object('ts', now_ms(), 'label', lbl)), updated_at = now() where id = rid $$;

-- chained, append-only record of admin actions
create or replace function write_audit(act text, ttype text, tid text, tlabel text, why text, meta jsonb default '{}', who profiles default null)
returns void language plpgsql security definer set search_path = public as $$
declare prev_hash text; actor profiles; t bigint := now_ms();
begin
  actor := coalesce(who, (select p from profiles p where p.id = auth.uid()));
  select hash into prev_hash from audit_log order by id desc limit 1;
  prev_hash := coalesce(prev_hash, 'genesis');
  insert into audit_log (ts, admin_id, admin_name, action, target_type, target_id, target_label, reason, meta, prev, hash)
  values (t, actor.id, coalesce(actor.name, 'System'), act, ttype, tid, tlabel, coalesce(why, ''), coalesce(meta, '{}'), prev_hash,
          md5(prev_hash || '|' || t::text || '|' || coalesce(actor.id::text, '') || '|' || act || '|' || tid || '|' || coalesce(why, '') || '|' || coalesce(meta, '{}')::text));
end $$;

create or replace function log_system(lvl text, area text, msg text) returns void language sql security definer set search_path = public as
$$ insert into system_log (level, area, message) values (lvl, area, left(msg, 300)) $$;

create or replace function add_history(uid uuid, typ text, rid bigint, why text, byname text, extra jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  update profiles set mod_history = jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'ts', now_ms(), 'type', typ, 'reportId', rid, 'reason', why, 'by', byname) || coalesce(extra, '{}')) || mod_history where id = uid
$$;

create or replace function reverse_history(uid uuid, rid bigint) returns void language sql security definer set search_path = public as $$
  update profiles set mod_history = coalesce((
    select jsonb_agg(case when (h ->> 'reportId')::bigint = rid and h ->> 'type' in ('fake', 'spam', 'duplicate', 'cleared') and coalesce(h ->> 'reversed', 'false') <> 'true'
                          then h || '{"reversed": true}'::jsonb else h end order by ord)
    from jsonb_array_elements(mod_history) with ordinality as t(h, ord)), '[]'::jsonb) where id = uid
$$;

create or replace function can_view_report(rid bigint) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r reports; u profiles;
begin
  select * into r from reports where id = rid;
  if not found then return false; end if;
  select * into u from profiles where id = auth.uid();
  if is_active_report(r.mod_status) then return true; end if;
  return u.id is not null and (u.id = r.citizen_id or u.role = 'admin');
end $$;

create or replace function can_read_media(p text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from report_media m where m.path = p and can_view_report(m.report_id)) $$;

-- plain keyword rule, no AI
create or replace function detect_priority(ttl text, descr text, cat text) returns text[] language plpgsql immutable as $$
declare txt text := ' ' || lower(ttl || ' ' || descr) || ' '; w text;
  words text[] := array['accident','bleeding','collapse','collapsing','collapsed','critical','dead','death','die','drowning','electrocution','electrocuted','emergency',
    'explosion','fatal','fire','flooding','flooded','gas leak','hazard','hospitalized','landslide','life threat','live wire','medical','poison','short circuit','sinkhole',
    'trapped','wound','injured','sparking','earthquake','cyclone'];
begin
  foreach w in array words loop
    if position(w in txt) > 0 then return array['Urgent', 'Mentions "' || w || '"']; end if;
  end loop;
  if cat in ('fire', 'flood') then return array['Urgent', 'Category is ' || (select lower(name) from categories where id = cat)]; end if;
  return array['Routine', 'No emergency words found'];
end $$;

-- =====================================================================
-- citizens
-- =====================================================================
create or replace function create_report(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare u profiles; c categories; pr text[]; d text; lat_ double precision; lng_ double precision; img text; n int; rid bigint; cu uuid; ttl text; descr text;
begin
  u := require_user('create');
  if u.role <> 'citizen' then raise exception 'Only citizens can send reports.'; end if;
  cu := nullif(p ->> 'clientUuid', '')::uuid;
  if cu is not null then select id into rid from reports where client_uuid = cu and citizen_id = u.id; if found then return rid; end if; end if;
  ttl := btrim(coalesce(p ->> 'title', '')); descr := btrim(coalesce(p ->> 'description', ''));
  if char_length(ttl) < 5 then raise exception 'Write a short title of at least 5 letters.'; end if;
  if char_length(descr) < 15 then raise exception 'Add a few more words. At least 15 letters, please.'; end if;
  select * into c from categories where id = p ->> 'category';
  if not found then raise exception 'Choose the kind of problem.'; end if;
  select count(*) into n from reports where citizen_id = u.id and created_at > now() - interval '1 hour';
  if n >= (cfg('reportsPerHour'))::int then raise exception 'You have sent % reports in the last hour. Please wait a little before sending another.', n; end if;
  pr := detect_priority(ttl, descr, c.id);
  d := coalesce(cfg('categoryDept') ->> c.id, c.default_dept);
  if not exists (select 1 from departments where id = d and active) then d := cfg('fallbackDeptId') #>> '{}'; end if;
  lat_ := nullif(p ->> 'latitude', '')::double precision; lng_ := nullif(p ->> 'longitude', '')::double precision;
  if lat_ is null or lng_ is null or lat_ not between 6 and 38 or lng_ not between 68 and 98 then lat_ := null; lng_ := null; end if;
  img := nullif(p ->> 'imagePath', '');
  if img is not null and img not like 'u/' || u.id::text || '/%' then raise exception 'That photo could not be used.'; end if;
  insert into reports (client_uuid, citizen_id, is_anonymous, category, title, description, state, district, city, pincode, address, lat, lng, image_path,
                       priority, priority_reason, dept_id, sla_days, timeline)
  values (cu, u.id, coalesce((p ->> 'isAnonymous')::boolean, false), c.id, left(ttl, 90), left(descr, 800), left(coalesce(p ->> 'state', ''), 60), left(coalesce(p ->> 'district', ''), 80),
          left(coalesce(p ->> 'city', ''), 80), left(coalesce(p ->> 'pincode', ''), 6), left(coalesce(p ->> 'address', ''), 160), lat_, lng_, img, pr[1], pr[2], d,
          case when pr[1] = 'Urgent' then 1 else c.sla_days end, jsonb_build_array(jsonb_build_object('ts', now_ms(), 'label', 'Report submitted')))
  returning id into rid;
  if img is not null then insert into report_media (path, report_id, kind) values (img, rid, 'report'); end if;
  perform notify(u.id, 'received', 'Report received', 'We sent "' || ttl || '" to the ' || dept_name(d) || '.', '#/c/' || rid, rid);
  perform notify_dept(d, 'new_report', case when pr[1] = 'Urgent' then 'New urgent report' else 'New report for your department' end,
                      '"' || ttl || '" in ' || coalesce(nullif(p ->> 'city', ''), nullif(p ->> 'state', ''), 'your area') || '.', '#/c/' || rid, rid);
  return rid;
end $$;

create or replace function toggle_upvote(rid bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u profiles; r reports; had boolean; n_ int;
begin
  u := require_user('vote');
  if u.role <> 'citizen' then raise exception 'You do not have permission to do this.'; end if;
  select * into r from reports where id = rid;
  if not found or not is_active_report(r.mod_status) then return null; end if;
  delete from upvotes where user_id = u.id and report_id = rid; get diagnostics n_ = row_count; had := n_ > 0;
  if not had then insert into upvotes (user_id, report_id) values (u.id, rid); end if;
  update reports set upvote_count = (select count(*) from upvotes where report_id = rid) where id = rid returning upvote_count into n_;
  return jsonb_build_object('voted', not had, 'count', n_);
end $$;

create or replace function add_comment(rid bigint, body text) returns void language plpgsql security definer set search_path = public as $$
declare u profiles; r reports; t text := btrim(coalesce(body, ''));
begin
  u := require_user('comment');
  if t = '' then raise exception 'Write something first.'; end if;
  select * into r from reports where id = rid;
  if not found or not can_view_report(rid) then raise exception 'This report is not available.'; end if;
  insert into comments (report_id, author_id, author_name, author_role, text) values (rid, u.id, u.name, u.role, left(t, 600));
  update reports set updated_at = now() where id = rid;
  if r.citizen_id <> u.id then perform notify(r.citizen_id, 'comment', 'New comment on your report', u.name || ' commented on "' || r.title || '".', '#/c/' || rid, rid); end if;
end $$;

create or replace function flag_report(rid bigint, reason text, note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare u profiles; r reports; used int; first_flag boolean; to_review boolean := false; valid text[] := array['false_info','duplicate','spam','wrong_location','offensive','misleading_photo','not_civic','other'];
begin
  u := require_user('flag');
  if u.role <> 'citizen' then raise exception 'You do not have permission to do this.'; end if;
  select * into r from reports where id = rid for update;
  if not found then raise exception 'Report not found.'; end if;
  if not is_active_report(r.mod_status) then raise exception 'This report is already being handled by an admin.'; end if;
  if r.citizen_id = u.id then raise exception 'You cannot flag your own report.'; end if;
  if r.mod_status = 'verified' then raise exception 'An admin has already checked this report and found no problem.'; end if;
  if exists (select 1 from flags where user_id = u.id and report_id = rid) then raise exception 'You already flagged this report.'; end if;
  if not (reason = any (valid)) then raise exception 'Choose a reason for the flag.'; end if;
  select count(*) into used from flags where user_id = u.id and created_at > now() - interval '1 day';
  if used >= (cfg('flagsPerDay'))::int then raise exception 'You have used your % flags for today. You can flag again tomorrow.', cfg('flagsPerDay'); end if;
  insert into flags (user_id, report_id, reason_id, note) values (u.id, rid, reason, left(coalesce(note, ''), 200));
  first_flag := r.mod_status = 'normal';
  update reports set flag_count = flag_count + 1, mod_status = case when mod_status = 'normal' then 'flagged' else mod_status end, updated_at = now() where id = rid returning * into r;
  if r.flag_count >= (cfg('reviewThreshold'))::int and r.mod_status <> 'under_review' then
    to_review := true;
    update reports set mod_status = 'under_review',
      mod_log = jsonb_build_array(jsonb_build_object('ts', now_ms(), 'by', 'System', 'action', 'Sent to review', 'note', r.flag_count || ' people flagged it. No decision has been made.')) || mod_log where id = rid;
    perform notify(r.citizen_id, 'moderation', 'Your report is being checked', 'Other users flagged "' || r.title || '". An admin will review it. No decision has been made.', '#/c/' || rid, rid);
  end if;
  if first_flag or to_review then
    perform notify_admins('moderation', case when to_review then 'Report sent to review' else 'A report was flagged' end, '"' || r.title || '".', '#/admin/r/' || rid, rid);
  end if;
  return jsonb_build_object('count', r.flag_count, 'toReview', to_review);
end $$;

-- the citizen checks the finished work
create or replace function audit_case(rid bigint) returns reports language plpgsql security definer set search_path = public as $$
declare u profiles; r reports; resolved_at bigint;
begin
  u := require_user('any');
  if u.role <> 'citizen' then raise exception 'You do not have permission to do this.'; end if;
  perform sweep_audits();
  select * into r from reports where id = rid for update;
  if not found then raise exception 'Report not found.'; end if;
  if r.citizen_id <> u.id then raise exception 'Only the person who made this report can do this.'; end if;
  if not is_active_report(r.mod_status) then raise exception 'This report is not active right now.'; end if;
  if r.status <> 'Resolved' or coalesce(r.audit ->> 'state', 'pending') <> 'pending' then
    raise exception '%', case when r.status = 'Closed' then 'This report is already closed.' else 'There is nothing to check on this report right now.' end;
  end if;
  return r;
end $$;

create or replace function confirm_fix(rid bigint, rating int, remark text default '') returns void language plpgsql security definer set search_path = public as $$
declare r reports;
begin
  r := audit_case(rid);
  if rating is null or rating < 1 or rating > 5 then raise exception 'Choose a star rating from 1 to 5.'; end if;
  update reports set audit = jsonb_build_object('state', 'confirmed', 'rating', rating, 'comment', left(coalesce(remark, ''), 300), 'ts', now_ms(), 'deptId', r.dept_id), status = 'Closed', updated_at = now() where id = rid;
  perform add_event(rid, 'Citizen confirmed the fix (' || rating || ' of 5 stars)');
  perform notify_dept(r.dept_id, 'confirmed', 'The citizen confirmed the fix', '"' || r.title || '" was rated ' || rating || ' of 5.', '#/c/' || rid, rid);
  perform notify(r.citizen_id, 'closed', 'Thank you', '"' || r.title || '" is now closed.', '#/c/' || rid, rid);
end $$;

create or replace function dispute_fix(rid bigint, reason_id text, note text, photo_path text default null) returns void language plpgsql security definer set search_path = public as $$
declare r reports; lbl text; n text := btrim(coalesce(note, '')); resolved_at bigint; photo text;
begin
  r := audit_case(rid);
  photo_path := nullif(photo_path, '');
  lbl := case reason_id when 'still_there' then 'The problem is still there' when 'incomplete' then 'The work is not finished' when 'wrong_place' then 'The wrong place was fixed' when 'other' then 'Something else' end;
  if lbl is null then raise exception 'Choose what is wrong.'; end if;
  if char_length(n) < 5 then raise exception 'Tell the department what is still wrong, at least 5 letters.'; end if;
  if r.reopen_count >= (cfg('maxReopens'))::int then raise exception 'This report was already reopened % times. An admin has been asked to look at it, so it cannot be reopened again.', r.reopen_count; end if;
  if photo_path is not null and photo_path not like 'u/' || auth.uid()::text || '/%' then raise exception 'That photo could not be used.'; end if;
  photo := case when photo_path is null then '' else 'storage:' || photo_path end;
  select coalesce(max((e ->> 'ts')::bigint), ms(r.updated_at)) into resolved_at from jsonb_array_elements(r.timeline) e where e ->> 'label' like 'Marked resolved%';
  update reports set
    resolutions = jsonb_build_array(jsonb_build_object('ts', resolved_at, 'response', r.authority_response, 'proof', case when r.resolution_path is null then '' else 'storage:' || r.resolution_path end,
                  'deptId', r.dept_id, 'officerId', r.assigned_officer, 'disputedReason', lbl, 'disputedNote', left(n, 300))) || resolutions,
    disputes = jsonb_build_array(jsonb_build_object('ts', now_ms(), 'reasonId', reason_id, 'reason', lbl, 'note', left(n, 300), 'photo', photo)) || disputes,
    authority_response = '', resolution_path = null, status = 'Reopened', reopen_count = reopen_count + 1, audit = jsonb_build_object('state', 'disputed', 'ts', now_ms()),
    sla_start = now(), updated_at = now()
  where id = rid;
  if photo_path is not null then insert into report_media (path, report_id, kind) values (photo_path, rid, 'dispute') on conflict do nothing; end if;
  perform add_event(rid, 'Citizen reported the problem is still there. Reason: ' || lbl);
  perform notify_dept(r.dept_id, 'reopened', 'A report was reopened', '"' || r.title || '": the citizen says it is not fixed (' || lower(lbl) || ').', '#/c/' || rid, rid);
  perform notify(r.citizen_id, 'reopened', 'Your report was reopened', 'We asked the ' || dept_name(r.dept_id) || ' to look at "' || r.title || '" again.', '#/c/' || rid, rid);
  if r.reopen_count + 1 >= (cfg('maxReopens'))::int then
    perform notify_admins('escalated', 'A report keeps coming back', '"' || r.title || '" was reopened ' || (r.reopen_count + 1) || ' times.', '#/admin/r/' || rid, rid);
  end if;
end $$;

-- resolved reports nobody answers close by themselves
create or replace function sweep_audits() returns void language plpgsql security definer set search_path = public as $$
declare r record; resolved_at bigint; days int := (cfg('auditDays'))::int;
begin
  for r in select * from reports where status = 'Resolved' and coalesce(audit ->> 'state', 'pending') = 'pending' loop
    select coalesce(max((e ->> 'ts')::bigint), ms(r.updated_at)) into resolved_at from jsonb_array_elements(r.timeline) e where e ->> 'label' like 'Marked resolved%';
    if now_ms() >= resolved_at + days * 86400000::bigint then
      update reports set status = 'Closed', audit = jsonb_build_object('state', 'auto_closed', 'ts', now_ms(), 'deptId', r.dept_id), updated_at = now() where id = r.id;
      perform add_event(r.id, 'Closed automatically after ' || days || ' days without a reply');
      perform notify(r.citizen_id, 'closed', 'Your report was closed', '"' || r.title || '" was closed because no one replied within ' || days || ' days.', '#/c/' || r.id, r.id);
    end if;
  end loop;
end $$;

create or replace function mark_read(ids uuid[]) returns void language plpgsql security definer set search_path = public as $$
begin perform require_user('any'); update notifications set is_read = true where user_id = auth.uid() and id = any (ids); end $$;
create or replace function mark_all_read() returns void language plpgsql security definer set search_path = public as $$
begin perform require_user('any'); update notifications set is_read = true where user_id = auth.uid() and not is_read; end $$;

-- =====================================================================
-- officials (own department only; admin may work on any)
-- =====================================================================
create or replace function guard_work(rid bigint) returns reports language plpgsql security definer set search_path = public as $$
declare u profiles; r reports;
begin
  u := require_user('work');
  if u.role not in ('official', 'admin') then raise exception 'You do not have permission to do this.'; end if;
  select * into r from reports where id = rid for update;
  if not found then raise exception 'Report not found.'; end if;
  if not is_active_report(r.mod_status) then raise exception 'This report is not part of the active workload. An admin has to clear it first.'; end if;
  if u.role = 'official' and u.dept_id is distinct from r.dept_id then raise exception 'Only the assigned department can do this.'; end if;
  if r.status in ('Resolved', 'Closed') then raise exception 'This report is already resolved.'; end if;
  return r;
end $$;

create or replace function start_work(rid bigint) returns void language plpgsql security definer set search_path = public as $$
declare r reports; u profiles := require_user('work');
begin
  r := guard_work(rid);
  update reports set status = 'In progress', assigned_officer = u.id, updated_at = now() where id = rid;
  perform add_event(rid, 'Work started by ' || dept_name(r.dept_id) || ' (' || u.name || ')');
  perform notify(r.citizen_id, 'started', 'Work has started', dept_name(r.dept_id) || ' started work on "' || r.title || '".', '#/c/' || rid, rid);
end $$;

create or replace function resolve_report(rid bigint, response text, proof_path text) returns void language plpgsql security definer set search_path = public as $$
declare r reports; u profiles := require_user('work'); t text := btrim(coalesce(response, ''));
begin
  r := guard_work(rid);
  if char_length(t) < 10 then raise exception 'Write what was done, at least 10 characters.'; end if;
  if proof_path is null or proof_path = '' then raise exception 'Add a photo that shows the finished work.'; end if;
  if proof_path not like 'u/' || u.id::text || '/%' then raise exception 'That photo could not be used.'; end if;
  update reports set status = 'Resolved', authority_response = left(t, 800), resolution_path = proof_path, assigned_officer = u.id, audit = '{"state": "pending"}'::jsonb, updated_at = now() where id = rid;
  insert into report_media (path, report_id, kind) values (proof_path, rid, 'resolution') on conflict do nothing;
  perform add_event(rid, 'Marked resolved by ' || dept_name(r.dept_id) || ' (' || u.name || ')');
  perform notify(r.citizen_id, 'resolved', 'Your report was resolved', dept_name(r.dept_id) || ' marked "' || r.title || '" as fixed. Please check the work and tell us if it is really fixed.', '#/c/' || rid, rid);
end $$;

create or replace function transfer_report(rid bigint, to_dept text, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports; u profiles := require_user('work'); why text := btrim(coalesce(reason, '')); tn text;
begin
  r := guard_work(rid);
  select name into tn from departments where id = to_dept and active;
  if tn is null then raise exception 'Choose a department.'; end if;
  if to_dept = r.dept_id then raise exception 'The report is already with that department.'; end if;
  if char_length(why) < 5 then raise exception 'Say why it is being transferred.'; end if;
  update reports set dept_id = to_dept, assigned_officer = null, updated_at = now() where id = rid;
  perform add_event(rid, 'Transferred from ' || dept_name(r.dept_id) || ' to ' || tn || '. Reason: ' || left(why, 200));
  perform notify(r.citizen_id, 'transferred', 'Report sent to another department', '"' || r.title || '" is now with the ' || tn || '.', '#/c/' || rid, rid);
  perform notify_dept(to_dept, 'transferred', 'A report was transferred to you', '"' || r.title || '" came from ' || dept_name(r.dept_id) || '.', '#/c/' || rid, rid);
  if u.role = 'admin' then perform write_audit('report.reassign', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why, jsonb_build_object('from', dept_name(r.dept_id), 'to', tn)); end if;
end $$;

create or replace function escalate_report(rid bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports; why text := btrim(coalesce(reason, ''));
begin
  r := guard_work(rid);
  if r.is_escalated then raise exception 'This report is already escalated.'; end if;
  if char_length(why) < 5 then raise exception 'Say why it needs escalation.'; end if;
  update reports set is_escalated = true, updated_at = now() where id = rid;
  perform add_event(rid, 'Escalated to district administration. Reason: ' || left(why, 200));
  perform notify(r.citizen_id, 'escalated', 'Your report was escalated', '"' || r.title || '" was sent to the district administration.', '#/c/' || rid, rid);
  perform notify_admins('escalated', 'A report was escalated', '"' || r.title || '"', '#/admin/r/' || rid, rid);
end $$;

create or replace function submit_verification_info(body text) returns void language plpgsql security definer set search_path = public as $$
declare u profiles; v jsonb; st text; t text := btrim(coalesce(body, ''));
begin
  u := require_user('any');
  if u.role <> 'official' then raise exception 'Only officials can send verification details.'; end if;
  st := u.verification ->> 'status';
  if st not in ('info_requested', 'rejected') then raise exception 'There is nothing to update right now.'; end if;
  if char_length(t) < 5 then raise exception 'Write the details the admin asked for.'; end if;
  v := u.verification;
  v := jsonb_set(v, '{supporting}', jsonb_build_array(jsonb_build_object('ts', now_ms(), 'text', left(t, 600))) || coalesce(v -> 'supporting', '[]'));
  v := jsonb_set(v, '{status}', '"pending"');
  v := jsonb_set(v, '{history}', jsonb_build_array(jsonb_build_object('ts', now_ms(), 'status', 'pending', 'by', 'applicant', 'note', 'Sent more information')) || coalesce(v -> 'history', '[]'));
  update profiles set verification = v where id = u.id;
  perform notify_admins('verification', 'Official sent more information', u.name || ' replied to your request.', '#/admin/authorities/' || u.id);
end $$;

-- =====================================================================
-- admin: moderation (always with a written reason, always audited)
-- =====================================================================
create or replace function mod_case(rid bigint, reason text) returns reports language plpgsql security definer set search_path = public as $$
declare r reports;
begin
  perform require_admin();
  if char_length(btrim(coalesce(reason, ''))) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  select * into r from reports where id = rid for update;
  if not found then raise exception 'Report not found.'; end if;
  return r;
end $$;

create or replace function log_mod(rid bigint, act text, note text) returns void language sql security definer set search_path = public as $$
  update reports set mod_log = jsonb_build_array(jsonb_build_object('ts', now_ms(), 'by', (select name from profiles where id = auth.uid()), 'action', act, 'note', note)) || mod_log, updated_at = now() where id = rid
$$;

create or replace function keep_report(rid bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason); u profiles := require_admin();
begin
  if r.mod_status = 'verified' then raise exception 'This report was already cleared.'; end if;
  if r.mod_status in ('rejected', 'archived') then raise exception 'Restore the report first.'; end if;
  update reports set mod_status = 'verified', mod_outcome = '', mod_reason = why where id = rid;
  perform log_mod(rid, 'Cleared: report is legitimate', why);
  if r.flag_count > 0 then perform add_history(r.citizen_id, 'cleared', rid, why, u.name); end if;
  if r.mod_status = 'under_review' then perform notify(r.citizen_id, 'moderation', 'Your report is visible again', 'An admin checked "' || r.title || '" and found no problem.', '#/c/' || rid, rid); end if;
  perform write_audit('report.keep', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why);
end $$;

create or replace function mark_under_review(rid bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason);
begin
  if r.mod_status = 'under_review' then raise exception 'This report is already under review.'; end if;
  if not is_active_report(r.mod_status) then raise exception 'Restore the report first.'; end if;
  update reports set mod_status = 'under_review', mod_reason = why where id = rid;
  perform log_mod(rid, 'Marked under review', why);
  perform notify(r.citizen_id, 'moderation', 'Your report is being checked', 'An admin is checking "' || r.title || '". No decision has been made.', '#/c/' || rid, rid);
  perform write_audit('report.review', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why);
end $$;

create or replace function reject_report(rid bigint, outcome text, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason); u profiles := require_admin(); lbl text;
begin
  lbl := case outcome when 'fake' then 'Fake report' when 'spam' then 'Spam' when 'not_civic' then 'Not a civic issue' when 'other' then 'Other reason' end;
  if lbl is null then raise exception 'Choose why the report is rejected.'; end if;
  if r.mod_status in ('rejected', 'archived') then raise exception 'This report is already closed by moderation.'; end if;
  update reports set mod_status = 'rejected', mod_outcome = outcome, mod_reason = why where id = rid;
  perform log_mod(rid, 'Rejected: ' || lbl, why);
  if outcome in ('fake', 'spam') then perform add_history(r.citizen_id, outcome, rid, why, u.name); end if;
  perform notify(r.citizen_id, 'moderation', 'Your report was removed', 'An admin reviewed "' || r.title || '" and removed it (' || lower(lbl) || '). ' || why, '#/c/' || rid, rid);
  perform write_audit('report.reject', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why, jsonb_build_object('outcome', outcome));
end $$;

create or replace function mark_duplicate(rid bigint, original bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason); u profiles := require_admin(); o reports;
begin
  select * into o from reports where id = original;
  if not found then raise exception 'We could not find the original report. Enter its number, for example 12.'; end if;
  if o.id = r.id then raise exception 'A report cannot be a duplicate of itself.'; end if;
  if not is_active_report(o.mod_status) or o.duplicate_of is not null then raise exception 'Choose an active report as the original.'; end if;
  if r.mod_status in ('rejected', 'archived') then raise exception 'This report is already closed by moderation.'; end if;
  update reports set mod_status = 'rejected', mod_outcome = 'duplicate', duplicate_of = o.id, mod_reason = why where id = rid;
  perform log_mod(rid, 'Marked as duplicate of DL-' || o.id, why);
  perform add_history(r.citizen_id, 'duplicate', rid, why, u.name);
  perform notify(r.citizen_id, 'moderation', 'Your report matches an existing one', '"' || r.title || '" duplicates report DL-' || o.id || '. Please follow that report.', '#/c/' || o.id, o.id);
  perform write_audit('report.duplicate', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why, jsonb_build_object('original', o.id));
end $$;

create or replace function archive_report(rid bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason);
begin
  if r.mod_status = 'archived' then raise exception 'This report is already archived.'; end if;
  update reports set mod_status = 'archived', mod_outcome = '', mod_reason = why where id = rid;
  perform log_mod(rid, 'Archived', why);
  perform notify(r.citizen_id, 'moderation', 'Your report was archived', '"' || r.title || '" was archived by an admin. ' || why, '#/c/' || rid, rid);
  perform write_audit('report.archive', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why);
end $$;

create or replace function restore_report(rid bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason);
begin
  if is_active_report(r.mod_status) and r.mod_status <> 'under_review' then raise exception 'This report is already active.'; end if;
  perform reverse_history(r.citizen_id, rid);
  update reports set mod_status = 'normal', mod_outcome = '', duplicate_of = null, mod_reason = '' where id = rid;
  perform log_mod(rid, 'Restored', why);
  perform notify(r.citizen_id, 'moderation', 'Your report was restored', 'An admin restored "' || r.title || '". It is active again.', '#/c/' || rid, rid);
  perform write_audit('report.restore', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why);
end $$;

create or replace function set_location_privacy(rid bigint, level text, reason text) returns void language plpgsql security definer set search_path = public as $$
declare r reports := mod_case(rid, reason); why text := btrim(reason);
begin
  if level not in ('approximate', 'hidden', 'exact') then raise exception 'Choose how the location is shown.'; end if;
  if r.location_privacy = level then raise exception 'The location is already shown that way.'; end if;
  update reports set location_privacy = level where id = rid;
  perform log_mod(rid, 'Map privacy set to "' || level || '"', why);
  perform write_audit('report.location_privacy', 'report', rid::text, 'DL-' || rid || ' ' || r.title, why, jsonb_build_object('from', r.location_privacy, 'to', level));
end $$;

-- =====================================================================
-- admin: people
-- =====================================================================
create or replace function user_case(uid uuid, reason text) returns profiles language plpgsql security definer set search_path = public as $$
declare a profiles := require_admin(); t profiles;
begin
  select * into t from profiles where id = uid;
  if not found then raise exception 'Account not found.'; end if;
  if t.role = 'admin' then raise exception 'Admin accounts cannot be moderated here.'; end if;
  if t.id = a.id then raise exception 'You cannot do this to your own account.'; end if;
  if char_length(btrim(coalesce(reason, ''))) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  return t;
end $$;

create or replace function warn_user(uid uuid, reason text) returns void language plpgsql security definer set search_path = public as $$
declare t profiles := user_case(uid, reason); a profiles := require_admin(); why text := btrim(reason);
begin
  perform add_history(uid, 'warning', null, why, a.name);
  perform notify(uid, 'account', 'You received a warning', 'An admin sent you a warning: ' || why, '#/profile');
  perform write_audit('user.warn', 'user', uid::text, t.name, why);
end $$;

create or replace function suspend_user(uid uuid, days int, reason text) returns void language plpgsql security definer set search_path = public as $$
declare t profiles := user_case(uid, reason); a profiles := require_admin(); why text := btrim(reason); untl timestamptz;
begin
  if days is null or days < 1 or days > 90 then raise exception 'Choose between 1 and 90 days.'; end if;
  if t.account_status = 'banned' then raise exception 'This account is already banned.'; end if;
  untl := now() + make_interval(days => days);
  update profiles set account_status = 'suspended', account_until = untl, account_reason = why, account_by = a.name where id = uid;
  perform add_history(uid, 'suspension', null, why, a.name, jsonb_build_object('days', days));
  perform notify(uid, 'account', 'Your account is suspended', 'You cannot post, comment or flag until ' || to_char(untl, 'DD Mon YYYY') || '. Reason: ' || why, '#/profile');
  perform write_audit('user.suspend', 'user', uid::text, t.name, why, jsonb_build_object('days', days));
end $$;

create or replace function ban_user(uid uuid, reason text, confirm_word text) returns void language plpgsql security definer set search_path = public as $$
declare t profiles := user_case(uid, reason); a profiles := require_admin(); why text := btrim(reason);
begin
  if confirm_word is distinct from 'BAN' then raise exception 'Type BAN to confirm a permanent ban.'; end if;
  update profiles set account_status = 'banned', account_until = null, account_reason = why, account_by = a.name where id = uid;
  perform add_history(uid, 'ban', null, why, a.name);
  perform write_audit('user.ban', 'user', uid::text, t.name, why);
end $$;

create or replace function reinstate_user(uid uuid, reason text) returns void language plpgsql security definer set search_path = public as $$
declare t profiles := user_case(uid, reason); a profiles := require_admin(); why text := btrim(reason);
begin
  if t.account_status = 'active' then raise exception 'This account is already active.'; end if;
  update profiles set account_status = 'active', account_until = null, account_reason = '', account_by = '' where id = uid;
  perform add_history(uid, 'reinstated', null, why, a.name);
  perform notify(uid, 'account', 'Your account is active again', 'An admin restored your account. ' || why, '#/profile');
  perform write_audit('user.reinstate', 'user', uid::text, t.name, why);
end $$;

create or replace function authority_action(uid uuid, act text, note text default '') returns void language plpgsql security definer set search_path = public as $$
declare a profiles := require_admin(); t profiles; st text; froms text[]; tos text; ttl text; msg text; need_reason boolean := true; why text := btrim(coalesce(note, '')); v jsonb;
begin
  select * into t from profiles where id = uid;
  if not found or t.role <> 'official' then raise exception 'Official not found.'; end if;
  st := t.verification ->> 'status';
  if act = 'approve' then froms := array['pending', 'info_requested']; tos := 'approved'; ttl := 'Your official access was approved'; msg := 'You can now open your department desk.'; need_reason := false; if why = '' then why := 'ID checked'; end if;
  elsif act = 'reject' then froms := array['pending', 'info_requested']; tos := 'rejected'; ttl := 'Your official access was not approved'; msg := 'Reason:';
  elsif act = 'request_info' then froms := array['pending']; tos := 'info_requested'; ttl := 'More information needed'; msg := 'The admin asked:';
  elsif act = 'suspend' then froms := array['approved']; tos := 'suspended'; ttl := 'Your official access was suspended'; msg := 'Reason:';
  elsif act = 'reinstate' then froms := array['suspended']; tos := 'approved'; ttl := 'Your official access was restored'; msg := 'You can use your department desk again.';
  else raise exception 'Unknown action.'; end if;
  if not (st = any (froms)) then raise exception 'This is not possible while the status is "%".', replace(st, '_', ' '); end if;
  if need_reason and char_length(why) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  v := jsonb_set(t.verification, '{status}', to_jsonb(tos));
  v := jsonb_set(v, '{adminNote}', to_jsonb(why));
  v := jsonb_set(v, '{history}', jsonb_build_array(jsonb_build_object('ts', now_ms(), 'status', tos, 'by', a.name, 'note', why)) || coalesce(v -> 'history', '[]'));
  update profiles set verification = v where id = uid;
  perform notify(uid, 'verification', ttl, msg || case when why <> '' then ' ' || why else '' end, '#/verification');
  perform write_audit('authority.' || act, 'official', uid::text, t.name || ' (' || dept_name(t.dept_id) || ')', why, jsonb_build_object('from', st, 'to', tos));
end $$;

-- =====================================================================
-- admin: configuration
-- =====================================================================
create or replace function save_department(p jsonb) returns text language plpgsql security definer set search_path = public as $$
declare a profiles := require_admin(); nm text := btrim(coalesce(p ->> 'name', '')); did text := nullif(p ->> 'id', ''); active_ boolean := coalesce((p ->> 'active')::boolean, true);
        d departments; why text := coalesce(nullif(btrim(p ->> 'reason'), ''), 'Department edited'); newid text;
begin
  if char_length(nm) < 3 then raise exception 'Give the department a name of at least 3 letters.'; end if;
  if exists (select 1 from departments where lower(name) = lower(nm) and id is distinct from did) then raise exception 'A department with this name already exists.'; end if;
  if did is not null then
    select * into d from departments where id = did;
    if not found then raise exception 'Department not found.'; end if;
    if not active_ and did = (cfg('fallbackDeptId') #>> '{}') then raise exception 'This is the fallback department for unrouted reports, so it must stay active.'; end if;
    if not active_ and d.active and (select count(*) from departments where active) <= 1 then raise exception 'At least one department must stay active.'; end if;
    update departments set name = nm, description = btrim(coalesce(p ->> 'description', '')), active = active_, roles = coalesce(p -> 'roles', '[]') where id = did;
    perform write_audit('department.update', 'department', did, nm, why, jsonb_build_object('before', jsonb_build_object('name', d.name, 'active', d.active), 'after', jsonb_build_object('name', nm, 'active', active_)));
    return did;
  end if;
  newid := trim(both '-' from regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g'));
  if newid = '' or exists (select 1 from departments where id = newid) then newid := coalesce(nullif(newid, ''), 'dept') || '-' || (select count(*) from departments); end if;
  insert into departments (id, name, description, active, roles) values (newid, nm, btrim(coalesce(p ->> 'description', '')), active_, coalesce(p -> 'roles', '[]'));
  perform write_audit('department.create', 'department', newid, nm, why);
  return newid;
end $$;

create or replace function set_category_dept(cat text, dept text) returns void language plpgsql security definer set search_path = public as $$
declare a profiles := require_admin(); dn text;
begin
  select name into dn from departments where id = dept and active;
  if dn is null then raise exception 'Choose an active department.'; end if;
  if not exists (select 1 from categories where id = cat) then raise exception 'Unknown category.'; end if;
  update app_settings set data = jsonb_set(data, array['categoryDept', cat], to_jsonb(dept), true) where id = 1;
  perform write_audit('department.routing', 'category', cat, (select name from categories where id = cat), 'New reports of this type now go to ' || dn, jsonb_build_object('dept', dn));
end $$;

create or replace function save_settings(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare a profiles := require_admin(); cur jsonb; nxt jsonb; k text; lim jsonb := '{"reviewThreshold":[2,20],"flagsPerDay":[1,20],"reportsPerHour":[1,20],"auditDays":[1,30],"maxReopens":[1,5]}';
begin
  select data into cur from app_settings where id = 1; nxt := cur;
  for k in select jsonb_object_keys(lim) loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric <> floor((p ->> k)::numeric) or (p ->> k)::numeric < (lim -> k ->> 0)::numeric or (p ->> k)::numeric > (lim -> k ->> 1)::numeric then
        raise exception '% must be a whole number from % to %.', k, lim -> k ->> 0, lim -> k ->> 1;
      end if;
      nxt := jsonb_set(nxt, array[k], p -> k);
    end if;
  end loop;
  if p ? 'publicGridMeters' then
    if (p ->> 'publicGridMeters')::int not in (250, 500, 1000) then raise exception 'Choose how precise the public map is.'; end if;
    nxt := jsonb_set(nxt, '{publicGridMeters}', p -> 'publicGridMeters');
  end if;
  if p ? 'areaLevel' then
    if p ->> 'areaLevel' not in ('state', 'district', 'city') then raise exception 'Choose how areas are grouped.'; end if;
    nxt := jsonb_set(nxt, '{areaLevel}', p -> 'areaLevel');
  end if;
  if p ? 'mapTiles' then nxt := jsonb_set(nxt, '{mapTiles}', to_jsonb((p ->> 'mapTiles')::boolean)); end if;
  update app_settings set data = nxt where id = 1;
  perform write_audit('settings.update', 'settings', 'limits', 'Moderation limits', 'Settings changed', jsonb_build_object('before', cur - 'categoryDept', 'after', nxt - 'categoryDept'));
end $$;

-- =====================================================================
-- sign-up and first administrator
-- =====================================================================
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'); want_official boolean := (m ->> 'role') = 'official'; d text := nullif(m ->> 'deptId', '');
begin
  if want_official and not exists (select 1 from departments where id = d and active) then raise exception 'Choose a department.'; end if;
  insert into profiles (id, role, name, email, phone, state, district, city, pincode, authority_role, dept_id, id_proof, verification)
  values (new.id, case when want_official then 'official' else 'citizen' end, left(coalesce(nullif(btrim(m ->> 'name'), ''), split_part(new.email, '@', 1)), 80), coalesce(new.email, ''),
          left(coalesce(m ->> 'phone', ''), 15), left(coalesce(m ->> 'state', ''), 60), left(coalesce(m ->> 'district', ''), 80), left(coalesce(m ->> 'city', ''), 80), left(coalesce(m ->> 'pincode', ''), 6),
          case when want_official then left(coalesce(m ->> 'authorityRole', ''), 80) else '' end, case when want_official then d else null end,
          case when want_official then left(coalesce(m ->> 'idProof', ''), 400) else '' end,
          case when want_official then jsonb_build_object('status', 'pending', 'submittedAt', now_ms(), 'supporting', '[]'::jsonb, 'adminNote', '',
                 'history', jsonb_build_array(jsonb_build_object('ts', now_ms(), 'status', 'pending', 'by', 'applicant', 'note', 'Application sent'))) else null end);
  if want_official then
    perform notify_admins('verification', 'Official ID to check', coalesce(nullif(btrim(m ->> 'name'), ''), 'Someone') || ' asked for official access.', '#/admin/authorities/' || new.id);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create or replace function has_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where role = 'admin') $$;

create or replace function claim_first_admin() returns void language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  perform pg_advisory_xact_lock(7001);
  u := require_user('any');
  if exists (select 1 from profiles where role = 'admin') then raise exception 'An administrator already exists.'; end if;
  update profiles set role = 'admin', dept_id = null, verification = null, authority_role = '', id_proof = '' where id = u.id returning * into u;
  perform write_audit('setup.admin_created', 'user', u.id::text, u.name, 'First administrator created on the setup screen', '{}', u);
end $$;

-- =====================================================================
-- reading: one function that returns exactly what this person may see
-- =====================================================================
create or replace function profile_json(p profiles) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p.id, 'role', p.role, 'name', p.name, 'email', p.email, 'phone', p.phone, 'state', p.state, 'district', p.district, 'city', p.city,
    'pincode', p.pincode, 'createdAt', ms(p.created_at), 'modHistory', p.mod_history,
    'account', jsonb_build_object('status', p.account_status, 'until', ms(p.account_until), 'reason', p.account_reason, 'by', p.account_by),
    'authorityRole', p.authority_role, 'deptId', p.dept_id, 'idProof', p.id_proof, 'verification', p.verification)
$$;

create or replace function snap_coord(v double precision, meters int, lat_ double precision, is_lat boolean) returns double precision language sql immutable as $$
  select case when is_lat then (floor(v / (meters / 111320.0)) + 0.5) * (meters / 111320.0)
         else (floor(v / ((meters / 111320.0) / greatest(0.2, cos(radians(lat_)))) ) + 0.5) * ((meters / 111320.0) / greatest(0.2, cos(radians(lat_)))) end
$$;

create or replace function report_json(r reports, viewer uuid, tier text, vdept text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare is_owner boolean := viewer is not null and viewer = r.citizen_id; exact boolean; work boolean; la double precision; ln double precision; step int := (cfg('publicGridMeters'))::int * case when r.is_anonymous then 2 else 1 end;
begin
  work := tier = 'admin' or is_owner or (tier = 'official' and vdept = r.dept_id);
  exact := work;
  if exact then la := r.lat; ln := r.lng;
  elsif r.location_privacy = 'hidden' or r.lat is null then la := null; ln := null;
  elsif r.location_privacy = 'exact' then la := r.lat; ln := r.lng;
  else la := snap_coord(r.lat, step, r.lat, true); ln := snap_coord(r.lng, step, snap_coord(r.lat, step, r.lat, true), false); end if;
  return jsonb_build_object(
    'id', r.id, 'clientUuid', r.client_uuid, 'citizenId', case when r.is_anonymous and not (is_owner or tier = 'admin') then null else r.citizen_id end, 'isAnonymous', r.is_anonymous,
    'category', r.category, 'title', r.title, 'description', r.description, 'state', r.state, 'district', r.district, 'city', r.city, 'pincode', r.pincode,
    'manualLocationAddress', r.address, 'latitude', la, 'longitude', ln, 'locationPrivacy', r.location_privacy,
    'imageUrlProof', case when r.image_path is null then '' else 'storage:' || r.image_path end, 'status', r.status, 'priority', r.priority, 'priorityReason', r.priority_reason,
    'deptId', r.dept_id, 'slaDeadlineDays', r.sla_days, 'slaStart', ms(r.sla_start), 'isEscalated', r.is_escalated, 'authorityResponse', r.authority_response,
    'resolutionProofUrl', case when r.resolution_path is null then '' else 'storage:' || r.resolution_path end,
    'assignedOfficerId', case when work then coalesce(r.assigned_officer::text, '') else '' end,
    'modStatus', r.mod_status, 'modOutcome', r.mod_outcome, 'modReason', case when is_owner or tier = 'admin' then r.mod_reason else '' end, 'duplicateOf', r.duplicate_of,
    'modLog', case when is_owner or tier = 'admin' then r.mod_log else '[]'::jsonb end, 'timeline', r.timeline,
    'resolutions', case when work then r.resolutions else '[]'::jsonb end, 'disputes', case when work then r.disputes else '[]'::jsonb end,
    'audit', case when work then r.audit else (case when r.audit is null then null else jsonb_build_object('state', r.audit ->> 'state') end) end,
    'reopenCount', r.reopen_count, 'flagCount', r.flag_count, 'upvoteCount', r.upvote_count, 'timestamp', ms(r.created_at), 'dateUpdated', ms(r.updated_at));
end $$;

create or replace function get_snapshot() returns jsonb language plpgsql security definer set search_path = public as $$
declare u profiles; viewer uuid := auth.uid(); tier text := 'public'; vdept text; res jsonb; rep jsonb; ids bigint[];
begin
  perform sweep_audits();
  if viewer is not null then
    select * into u from profiles where id = viewer;
    if found then
      if u.account_status = 'suspended' and u.account_until < now() then
        update profiles set account_status = 'active', account_until = null, account_reason = '', account_by = '' where id = u.id returning * into u;
      end if;
      if u.role = 'admin' then tier := 'admin'; elsif is_approved(u) then tier := 'official'; vdept := u.dept_id; end if;
    end if;
  end if;
  select coalesce(array_agg(id), '{}') into ids from (
    select id from reports where tier = 'admin' or is_active_report(mod_status) or citizen_id = viewer order by id desc limit 3000) x;
  select coalesce(jsonb_agg(report_json(r, viewer, tier, vdept) order by r.id desc), '[]') into rep from reports r where r.id = any (ids);

  res := jsonb_build_object(
    'v', 2, 'isDemo', false, 'remote', true, 'updatedAt', now_ms(), 'rev', now_ms(), 'seq', coalesce((select max(id) from reports), 0), 'hasAdmin', has_admin(),
    'me', case when u.id is null then null else u.id end,
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'active', active, 'roles', roles) order by name), '[]') from departments),
    'settings', (select data from app_settings where id = 1),
    'complaints', rep,
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'complaintId', c.report_id, 'authorName', c.author_name, 'authorRole', c.author_role, 'text', c.text, 'ts', ms(c.created_at)) order by c.created_at), '[]')
                 from comments c where c.report_id = any (ids)),
    'upvotes', (select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'complaintId', report_id, 'ts', ms(created_at))), '[]') from upvotes where user_id = viewer),
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'userId', user_id, 'complaintId', report_id, 'reasonId', reason_id, 'note', note, 'ts', ms(created_at))), '[]')
              from flags where tier = 'admin' or user_id = viewer),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'userId', n.user_id, 'type', n.type, 'title', n.title, 'message', n.message, 'link', n.link, 'reportId', n.report_id,
                       'isRead', n.is_read, 'status', 'delivered', 'ts', ms(n.created_at)) order by n.created_at desc), '[]')
                      from (select * from notifications where user_id = viewer order by created_at desc limit 200) n),
    'users', case
      when tier = 'admin' then (select coalesce(jsonb_agg(profile_json(p)), '[]') from profiles p)
      else (select coalesce(jsonb_agg(x), '[]') from (
              select profile_json(u) as x where u.id is not null
              union all
              select jsonb_build_object('id', p.id, 'role', p.role, 'name', p.name) from profiles p
                where p.id <> coalesce(viewer, '00000000-0000-0000-0000-000000000000') and p.id in (select citizen_id from reports where id = any (ids) and not is_anonymous)) q) end,
    'audit', case when tier = 'admin' then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ts', ts, 'adminId', admin_id, 'adminName', admin_name, 'action', action, 'targetType', target_type,
                       'targetId', target_id, 'targetLabel', target_label, 'reason', reason, 'meta', meta, 'prev', prev, 'hash', hash) order by id desc), '[]') from audit_log) else '[]'::jsonb end,
    'logs', case when tier = 'admin' then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ts', ts, 'level', level, 'area', area, 'message', message, 'meta', meta) order by id desc), '[]')
                      from (select * from system_log order by id desc limit 300) s) else '[]'::jsonb end,
    'loginFails', '{}'::jsonb);
  return res;
end $$;

create or replace function audit_verify() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; prev_hash text := 'genesis'; n int := 0; h text;
begin
  perform require_admin();
  for r in select * from audit_log order by id asc loop
    n := n + 1;
    h := md5(prev_hash || '|' || r.ts::text || '|' || coalesce(r.admin_id::text, '') || '|' || r.action || '|' || r.target_id || '|' || r.reason || '|' || r.meta::text);
    if r.prev <> prev_hash or r.hash <> h then return jsonb_build_object('ok', false, 'brokenAt', r.id, 'count', n); end if;
    prev_hash := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- the browser may log a technical problem (admins read these); nothing sensitive is accepted
create or replace function client_log(lvl text, area text, msg text) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from system_log where ts > now_ms() - 60000) > 120 then return; end if;
  perform log_system(case when lvl in ('error', 'warn', 'info') then lvl else 'info' end, left(coalesce(area, 'app'), 30), coalesce(msg, ''));
end $$;

-- ---------- real-time change stream ----------
create or replace function feed_report() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into change_feed (kind, report_id) values ('report', coalesce(new.id, old.id)); return new; end $$;
drop trigger if exists reports_feed on reports;
create trigger reports_feed after insert or update on reports for each row execute function feed_report();

create or replace function feed_comment() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into change_feed (kind, report_id) values ('comment', new.report_id); return new; end $$;
drop trigger if exists comments_feed on comments;
create trigger comments_feed after insert on comments for each row execute function feed_comment();

create or replace function feed_notification() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into change_feed (kind, report_id, user_id) values ('notification', new.report_id, new.user_id); return new; end $$;
drop trigger if exists notifications_feed on notifications;
create trigger notifications_feed after insert on notifications for each row execute function feed_notification();

create or replace function feed_misc() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into change_feed (kind) values ('misc'); return coalesce(new, old); end $$;
drop trigger if exists profiles_feed on profiles;
create trigger profiles_feed after update on profiles for each row execute function feed_misc();
drop trigger if exists settings_feed on app_settings;
create trigger settings_feed after update on app_settings for each row execute function feed_misc();
drop trigger if exists departments_feed on departments;
create trigger departments_feed after insert or update on departments for each row execute function feed_misc();

-- keep the stream small
create or replace function prune_change_feed() returns void language sql security definer set search_path = public as
$$ delete from change_feed where ts < now() - interval '1 day' $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table change_feed; exception when duplicate_object then null; end;
  end if;
end $$;

-- =====================================================================
-- who may call what
-- =====================================================================
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function has_admin(), get_snapshot() to anon, authenticated;
grant execute on function
  create_report(jsonb), toggle_upvote(bigint), add_comment(bigint, text), flag_report(bigint, text, text), confirm_fix(bigint, int, text), dispute_fix(bigint, text, text, text),
  mark_read(uuid[]), mark_all_read(), start_work(bigint), resolve_report(bigint, text, text), transfer_report(bigint, text, text), escalate_report(bigint, text),
  submit_verification_info(text), keep_report(bigint, text), mark_under_review(bigint, text), reject_report(bigint, text, text), mark_duplicate(bigint, bigint, text),
  archive_report(bigint, text), restore_report(bigint, text), set_location_privacy(bigint, text, text), warn_user(uuid, text), suspend_user(uuid, int, text), ban_user(uuid, text, text),
  reinstate_user(uuid, text), authority_action(uuid, text, text), audit_verify(), save_department(jsonb), set_category_dept(text, text), save_settings(jsonb), claim_first_admin(), client_log(text, text, text)
to authenticated;

-- ---------- photo storage (private bucket, 2 MB, images only) ----------
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('report-images', 'report-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

    execute 'drop policy if exists "report images: upload to your own folder" on storage.objects';
    execute $p$create policy "report images: upload to your own folder" on storage.objects for insert to authenticated
      with check (bucket_id = 'report-images' and split_part(name, '/', 1) = 'u' and split_part(name, '/', 2) = auth.uid()::text)$p$;
    execute 'drop policy if exists "report images: read what you may see" on storage.objects';
    execute $p$create policy "report images: read what you may see" on storage.objects for select to anon, authenticated
      using (bucket_id = 'report-images' and (split_part(name, '/', 2) = auth.uid()::text or public.can_read_media(name)))$p$;
  end if;
end $$;
grant execute on function can_read_media(text) to anon, authenticated;
