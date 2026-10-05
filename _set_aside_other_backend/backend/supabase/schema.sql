-- =====================================================================================
--  Disaster Lens – Supabase backend (Phase 6)
--  Run this whole file once in Supabase: SQL Editor -> New query -> paste -> Run.
--  It is safe to run again (it uses "create or replace" / "if not exists").
--
--  What it gives you
--    * Real accounts (Supabase Auth) with a private profile for each person
--    * Row-level security: every table is locked; people only see what their role allows
--    * ALL rules live in database functions (report, flag, moderate, verify, rate, audit ...)
--      so a browser cannot skip them. The website only calls these functions.
--    * Private photo storage, public reports show only an APPROXIMATE position
--    * Realtime: changes are pushed to every open browser
--
--  No secret key is needed in the website. Only the project URL and the public "anon" key.
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------- tables
create table if not exists public.departments (
  id text primary key,
  name text not null unique,
  description text not null default '',
  active boolean not null default true,
  roles text[] not null default '{}'
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  review_threshold int not null default 5 check (review_threshold between 2 and 20),
  flags_per_day int not null default 5 check (flags_per_day between 1 and 20),
  reports_per_hour int not null default 5 check (reports_per_hour between 1 and 20),
  audit_days int not null default 7 check (audit_days between 1 and 30),
  max_reopens int not null default 2 check (max_reopens between 1 and 5),
  public_grid_meters int not null default 500 check (public_grid_meters in (250, 500, 1000)),
  map_tiles boolean not null default false,
  area_level text not null default 'city' check (area_level in ('state', 'district', 'city')),
  fallback_dept text not null default 'municipal',
  category_dept jsonb not null default '{}'
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'citizen' check (role in ('citizen', 'official', 'admin')),
  name text not null,
  email text not null,
  phone text not null default '',
  state text not null default '',
  district text not null default '',
  city text not null default '',
  pincode text not null default '',
  created_at timestamptz not null default now(),
  account_status text not null default 'active' check (account_status in ('active', 'suspended', 'banned')),
  account_until timestamptz,
  account_reason text not null default '',
  authority_role text not null default '',
  dept_id text references public.departments (id),
  id_proof text not null default '',
  verification_status text not null default 'none' check (verification_status in ('none', 'pending', 'info_requested', 'approved', 'rejected', 'suspended')),
  verification_submitted timestamptz,
  verification_note text not null default '',
  verification_history jsonb not null default '[]',
  verification_supporting jsonb not null default '[]'
);

create table if not exists public.mod_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  report_id bigint,
  reason text not null default '',
  by_name text not null default '',
  days int,
  reversed boolean not null default false,
  created_at timestamptz not null default now()
);

-- The public face of a report. It has NO owner and NO exact position.
create table if not exists public.complaints (
  id bigint generated always as identity primary key,
  category text not null check (category in ('road', 'water', 'power', 'waste', 'flood', 'fire', 'building', 'health', 'other')),
  title text not null check (char_length(title) between 5 and 90),
  description text not null check (char_length(description) between 15 and 800),
  state text not null default '',
  district text not null default '',
  city text not null default '',
  pincode text not null default '',
  address text not null default '',
  is_anonymous boolean not null default false,
  author_label text not null default 'Citizen',
  status text not null default 'Submitted' check (status in ('Submitted', 'In progress', 'Resolved', 'Reopened', 'Closed')),
  priority text not null default 'Routine' check (priority in ('Urgent', 'Routine')),
  priority_reason text not null default '',
  dept_id text not null references public.departments (id),
  sla_days int not null default 7,
  sla_start timestamptz,
  upvote_count int not null default 0,
  flag_count int not null default 0,
  is_escalated boolean not null default false,
  authority_response text not null default '',
  resolution_photo text not null default '',
  image_path text not null default '',
  assigned_officer uuid,
  resolved_at timestamptz,
  audit_state text not null default '',
  reopen_count int not null default 0,
  mod_status text not null default 'normal' check (mod_status in ('normal', 'flagged', 'under_review', 'verified', 'rejected', 'archived')),
  location_privacy text not null default 'approximate' check (location_privacy in ('approximate', 'hidden', 'exact')),
  has_gps boolean not null default false,
  pub_lat double precision,
  pub_lng double precision,
  timeline jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists complaints_status_idx on public.complaints (status);
create index if not exists complaints_dept_idx on public.complaints (dept_id);
create index if not exists complaints_mod_idx on public.complaints (mod_status);
create index if not exists complaints_cat_idx on public.complaints (category);
create index if not exists complaints_created_idx on public.complaints (created_at desc);
create index if not exists complaints_pub_geo_idx on public.complaints (pub_lat, pub_lng) where pub_lat is not null;

-- Who wrote it and exactly where it is. Only the owner, that department's officials and admins can read this.
create table if not exists public.report_private (
  report_id bigint primary key references public.complaints (id) on delete cascade,
  owner_id uuid not null references public.profiles (id),
  lat double precision,
  lng double precision
);
create index if not exists report_private_owner_idx on public.report_private (owner_id);

-- Moderation notes, the citizen's check of the work, earlier attempts. Same readers as report_private.
create table if not exists public.report_extra (
  report_id bigint primary key references public.complaints (id) on delete cascade,
  mod_outcome text not null default '',
  mod_reason text not null default '',
  duplicate_of bigint,
  mod_log jsonb not null default '[]',
  audit jsonb not null default '{}',
  resolutions jsonb not null default '[]',
  disputes jsonb not null default '[]',
  photo_paths text[] not null default '{}'
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  report_id bigint not null references public.complaints (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  author_name text not null,
  author_role text not null,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists comments_report_idx on public.comments (report_id, created_at);

create table if not exists public.upvotes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id bigint not null references public.complaints (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, report_id)
);

create table if not exists public.flags (
  id uuid primary key default gen_random_uuid(),
  report_id bigint not null references public.complaints (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason_id text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (report_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'general',
  title text not null,
  message text not null default '',
  link text not null default '',
  report_id bigint,
  is_read boolean not null default false,
  status text not null default 'delivered',
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Append-only record of what admins did. Each row carries the hash of the row before it.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  admin_id uuid,
  admin_name text not null default 'System',
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  target_label text not null default '',
  reason text not null default '',
  meta jsonb not null default '{}',
  ts_ms bigint not null default 0,
  prev_hash text not null,
  hash text not null
);
alter table public.audit_log add column if not exists ts_ms bigint not null default 0;

create table if not exists public.system_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  level text not null default 'info',
  area text not null default '',
  message text not null,
  user_id uuid
);

-- A tiny signal table: every change inserts one row; browsers listen to it and then reload what THEY are allowed to see.
-- It carries no data, so it can never leak anything.
create table if not exists public.pings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------- seed data
insert into public.departments (id, name, description) values
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
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------- change signal, timestamps
create or replace function public._ping() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pings default values;
  if random() < 0.02 then delete from public.pings where created_at < now() - interval '15 minutes'; end if;
  return null;
end $$;
create or replace function public._touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists complaints_touch on public.complaints;
create trigger complaints_touch before update on public.complaints for each row execute function public._touch();
do $$ declare t text; begin
  foreach t in array array['complaints', 'comments', 'notifications', 'report_extra', 'report_private', 'profiles', 'departments', 'settings', 'flags', 'upvotes', 'mod_history', 'audit_log'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_ping', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public._ping()', t || '_ping', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------- small helpers
create or replace function public._ms() returns bigint language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function public._fmt(t timestamptz) returns text language sql stable as $$ select to_char(t at time zone 'Asia/Kolkata', 'DD Mon YYYY') $$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and account_status <> 'banned') $$;

create or replace function public.is_official_of(dept text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'official' and verification_status = 'approved' and dept_id = dept and account_status <> 'banned') $$;

create or replace function public.owns_report(rid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.report_private where report_id = rid and owner_id = auth.uid()) $$;

create or replace function public.report_is_active(rid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.complaints where id = rid and mod_status in ('normal', 'flagged', 'verified')) $$;

-- may the caller see a report at all?  (public if active; owner and admin always)
create or replace function public.can_see_report(rid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.report_is_active(rid) or public.is_admin() or public.owns_report(rid) $$;

-- may the caller read the private parts (exact position, notes, citizen check)?
create or replace function public.can_read_private(rid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.owns_report(rid)
      or exists (select 1 from public.complaints c where c.id = rid and c.mod_status in ('normal', 'flagged', 'verified') and public.is_official_of(c.dept_id)) $$;

-- Raises a plain-language error unless the caller may do `perm`. Returns the caller's profile.
create or replace function public._need(perm text) returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Please log in first.'; end if;
  if p.account_status = 'suspended' and p.account_until is not null and p.account_until <= now() then
    update public.profiles set account_status = 'active', account_until = null, account_reason = '' where id = p.id;
    p.account_status := 'active';
  end if;
  if p.account_status = 'banned' then raise exception 'This account has been blocked.'; end if;
  if p.account_status = 'suspended' and perm in ('create', 'comment', 'vote', 'flag') then
    raise exception 'Your account is suspended until %. You cannot do this right now.', public._fmt(p.account_until);
  end if;
  if perm in ('create', 'vote', 'flag', 'audit') and p.role <> 'citizen' then raise exception 'You do not have permission to do this.'; end if;
  if perm in ('comment', 'work') and p.role = 'official' and p.verification_status <> 'approved' then raise exception 'Your official access is not approved yet.'; end if;
  if perm = 'work' and p.role = 'citizen' then raise exception 'You do not have permission to do this.'; end if;
  if perm = 'admin' and p.role <> 'admin' then raise exception 'You do not have permission to do this.'; end if;
  return p;
end $$;

create or replace function public._dept_name(d text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.departments where id = d), 'Unknown department') $$;

create or replace function public._notify(uid uuid, ntype text, ntitle text, nmessage text, nlink text, rid bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, message, link, report_id)
  select uid, ntype, ntitle, nmessage, nlink, rid where uid is not null $$;

create or replace function public._notify_admins(ntype text, ntitle text, nmessage text, nlink text, rid bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, message, link, report_id)
  select id, ntype, ntitle, nmessage, nlink, rid from public.profiles where role = 'admin' and account_status <> 'banned' $$;

create or replace function public._notify_dept(dept text, ntype text, ntitle text, nmessage text, nlink text, rid bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, message, link, report_id)
  select id, ntype, ntitle, nmessage, nlink, rid from public.profiles
   where role = 'official' and verification_status = 'approved' and dept_id = dept and account_status <> 'banned' $$;

create or replace function public._tl(rid bigint, label text) returns void language sql security definer set search_path = public as $$
  update public.complaints set timeline = timeline || jsonb_build_array(jsonb_build_object('ts', public._ms(), 'label', label)), updated_at = now() where id = rid $$;

-- append one audit row, chained to the previous one (cannot be edited or removed: see triggers below)
create or replace function public._audit(act text, ttype text, tid text, tlabel text, why text, m jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare prev text; who public.profiles; ts_ms bigint := public._ms(); h text;
begin
  perform pg_advisory_xact_lock(70011);
  select hash into prev from public.audit_log order by id desc limit 1;
  prev := coalesce(prev, 'genesis');
  select * into who from public.profiles where id = auth.uid();
  h := encode(digest(prev || '|' || coalesce(who.id::text, '') || '|' || act || '|' || ttype || '|' || tid || '|' || why || '|' || ts_ms::text, 'sha256'), 'hex');
  insert into public.audit_log (admin_id, admin_name, action, target_type, target_id, target_label, reason, meta, ts_ms, prev_hash, hash)
  values (who.id, coalesce(who.name, 'System'), act, ttype, tid, tlabel, why, coalesce(m, '{}'), ts_ms, prev, h);
end $$;

create or replace function public._block_change() returns trigger language plpgsql as $$
begin raise exception 'The audit log can only be added to.'; end $$;
drop trigger if exists audit_no_update on public.audit_log;
create trigger audit_no_update before update or delete on public.audit_log for each row execute function public._block_change();
drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log for each statement execute function public._block_change();

create or replace function public._hist(uid uuid, htype text, rid bigint, why text, byname text, d int)
returns void language sql security definer set search_path = public as $$
  insert into public.mod_history (user_id, type, report_id, reason, by_name, days) values (uid, htype, rid, why, byname, d) $$;

-- the same simple keyword rule as the website (no AI)
create or replace function public._priority(ttl text, descr text, cat text) returns text[] language plpgsql immutable as $$
declare words text[] := array['accident','bleeding','collapse','collapsing','collapsed','critical','dead','death','die','drowning','electrocution','electrocuted','emergency','explosion','fatal','fire','flooding','flooded','gas leak','hazard','hospitalized','landslide','life threat','live wire','medical','poison','short circuit','sinkhole','trapped','wound','injured','sparking','earthquake','cyclone'];
        w text; txt text := ' ' || lower(ttl || ' ' || descr) || ' ';
begin
  foreach w in array words loop
    if position(w in txt) > 0 then return array['Urgent', 'Mentions "' || w || '"']; end if;
  end loop;
  if cat in ('fire', 'flood') then return array['Urgent', 'Category is ' || cat]; end if;
  return array['Routine', 'No emergency words found'];
end $$;

-- public points are moved to the centre of a square cell so a home is never shown
create or replace function public._snap(lat double precision, lng double precision, meters int) returns double precision[] language plpgsql immutable as $$
declare step double precision := greatest(50, meters) / 111320.0; la double precision; ls double precision;
begin
  la := (floor(lat / step) + 0.5) * step;
  ls := step / greatest(0.2, cos(radians(la)));
  return array[la, (floor(lng / ls) + 0.5) * ls];
end $$;

create or replace function public._cat_dept(cat text) returns text language plpgsql stable security definer set search_path = public as $$
declare s public.settings; d text;
begin
  select * into s from public.settings where id = 1;
  d := coalesce(s.category_dept ->> cat, case cat when 'road' then 'works' when 'water' then 'water' when 'power' then 'electricity' when 'waste' then 'sanitation'
        when 'flood' then 'disaster' when 'fire' then 'fire' when 'building' then 'housing' when 'health' then 'health' else 'municipal' end);
  if not exists (select 1 from public.departments where id = d and active) then d := s.fallback_dept; end if;
  return d;
end $$;

create or replace function public.has_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where role = 'admin') $$;

-- ---------------------------------------------------------------------------- new accounts
-- Runs when someone signs up. The role can only ever be citizen, or an UNAPPROVED official.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'); want_official boolean := (m ->> 'role') = 'official'; d text := nullif(m ->> 'dept_id', '');
begin
  if want_official and (d is null or not exists (select 1 from public.departments where id = d and active)) then want_official := false; end if;
  insert into public.profiles (id, role, name, email, phone, state, district, city, pincode, authority_role, dept_id, id_proof, verification_status, verification_submitted, verification_history)
  values (new.id, case when want_official then 'official' else 'citizen' end, left(coalesce(nullif(trim(m ->> 'name'), ''), split_part(new.email, '@', 1)), 80), new.email,
          left(coalesce(m ->> 'phone', ''), 15), left(coalesce(m ->> 'state', ''), 60), left(coalesce(m ->> 'district', ''), 60), left(coalesce(m ->> 'city', ''), 60), left(coalesce(m ->> 'pincode', ''), 10),
          case when want_official then left(coalesce(m ->> 'authority_role', ''), 80) else '' end, case when want_official then d else null end,
          case when want_official then left(coalesce(m ->> 'id_proof', ''), 600) else '' end,
          case when want_official then 'pending' else 'none' end, case when want_official then now() end,
          case when want_official then jsonb_build_array(jsonb_build_object('ts', public._ms(), 'status', 'pending', 'by', 'applicant', 'note', 'Application sent')) else '[]'::jsonb end);
  if want_official then
    perform public._notify_admins('verification', 'Official ID to check', coalesce(nullif(trim(m ->> 'name'), ''), new.email) || ' asked for official access.', '#/admin/authorities/' || new.id, null);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------- reports
create or replace function public.create_report(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('create'); s public.settings; cat text := p ->> 'category'; ttl text := trim(coalesce(p ->> 'title', '')); descr text := trim(coalesce(p ->> 'description', ''));
  pr text[]; dpt text; sla int; lat double precision; lng double precision; gps boolean := false; pub double precision[]; rid bigint; img text := coalesce(p ->> 'image_path', ''); anon boolean := coalesce((p ->> 'is_anonymous')::boolean, false);
  recent int;
begin
  select * into s from public.settings where id = 1;
  if cat is null or cat not in ('road', 'water', 'power', 'waste', 'flood', 'fire', 'building', 'health', 'other') then raise exception 'Choose the kind of problem.'; end if;
  if char_length(ttl) < 5 or char_length(ttl) > 90 then raise exception 'Write a short title of 5 to 90 letters.'; end if;
  if char_length(descr) < 15 or char_length(descr) > 800 then raise exception 'Write details of 15 to 800 letters.'; end if;
  if coalesce(trim(p ->> 'state'), '') = '' then raise exception 'Choose your state.'; end if;
  select count(*) into recent from public.report_private rp join public.complaints c on c.id = rp.report_id where rp.owner_id = me.id and c.created_at > now() - interval '1 hour';
  if recent >= s.reports_per_hour then raise exception 'You have sent % reports in the last hour. Please wait a little before sending another.', recent; end if;
  if img <> '' and img not like me.id::text || '/%' then raise exception 'That photo does not belong to you.'; end if;
  pr := public._priority(ttl, descr, cat); dpt := public._cat_dept(cat);
  sla := case when pr[1] = 'Urgent' then 1 else case cat when 'road' then 7 when 'water' then 5 when 'power' then 2 when 'waste' then 5 when 'flood' then 1 when 'fire' then 1 when 'building' then 2 when 'health' then 2 else 7 end end;
  begin lat := (p ->> 'lat')::double precision; lng := (p ->> 'lng')::double precision; exception when others then lat := null; lng := null; end;
  if lat is not null and lng is not null and lat between 6 and 38 and lng between 68 and 98 then
    gps := true; pub := public._snap(lat, lng, s.public_grid_meters * case when anon then 2 else 1 end);
  else lat := null; lng := null; end if;
  insert into public.complaints (category, title, description, state, district, city, pincode, address, is_anonymous, author_label, priority, priority_reason, dept_id, sla_days,
                                 image_path, has_gps, pub_lat, pub_lng, timeline)
  values (cat, ttl, descr, left(p ->> 'state', 60), left(coalesce(p ->> 'district', ''), 60), left(coalesce(p ->> 'city', ''), 60), left(coalesce(p ->> 'pincode', ''), 10), left(coalesce(p ->> 'address', ''), 200),
          anon, case when anon then 'Anonymous citizen' else me.name end, pr[1], pr[2], dpt, sla, img, gps, case when gps then pub[1] end, case when gps then pub[2] end,
          jsonb_build_array(jsonb_build_object('ts', public._ms(), 'label', 'Report submitted')))
  returning id into rid;
  insert into public.report_private (report_id, owner_id, lat, lng) values (rid, me.id, lat, lng);
  insert into public.report_extra (report_id, photo_paths) values (rid, case when img <> '' then array[img] else '{}' end);
  perform public._notify(me.id, 'received', 'Report received', 'We sent "' || ttl || '" to the ' || public._dept_name(dpt) || '.', '#/c/' || rid, rid);
  perform public._notify_dept(dpt, 'new_report', case when pr[1] = 'Urgent' then 'New urgent report' else 'New report for your department' end, '"' || ttl || '" in ' || coalesce(nullif(trim(p ->> 'city'), ''), p ->> 'state') || '.', '#/c/' || rid, rid);
  return rid;
end $$;

create or replace function public.toggle_upvote(rid bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('vote'); c public.complaints; had boolean;
begin
  select * into c from public.complaints where id = rid for update;
  if c.id is null or c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'Report not found.'; end if;
  delete from public.upvotes where user_id = me.id and report_id = rid;
  get diagnostics had = row_count;
  if had then update public.complaints set upvote_count = greatest(0, upvote_count - 1) where id = rid;
  else insert into public.upvotes (user_id, report_id) values (me.id, rid); update public.complaints set upvote_count = upvote_count + 1 where id = rid; end if;
  select upvote_count into c.upvote_count from public.complaints where id = rid;
  return jsonb_build_object('voted', not had, 'count', c.upvote_count);
end $$;

create or replace function public.add_comment(rid bigint, txt text) returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('comment'); c public.complaints; cid uuid; own uuid; b text := left(trim(coalesce(txt, '')), 600);
begin
  if b = '' then raise exception 'Write something first.'; end if;
  select * into c from public.complaints where id = rid;
  if c.id is null or not public.can_see_report(rid) then raise exception 'This report is not available.'; end if;
  insert into public.comments (report_id, author_id, author_name, author_role, body) values (rid, me.id, me.name, me.role, b) returning id into cid;
  select owner_id into own from public.report_private where report_id = rid;
  if own is not null and own <> me.id then perform public._notify(own, 'comment', 'New comment on your report', me.name || ' commented on "' || c.title || '".', '#/c/' || rid, rid); end if;
  return cid;
end $$;

create or replace function public.flag_report(rid bigint, reason text, note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('flag'); c public.complaints; s public.settings; own uuid; used int; first_flag boolean; to_review boolean := false; rl text;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.complaints where id = rid for update;
  if c.id is null then raise exception 'Report not found.'; end if;
  if c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'This report is already being handled by an admin.'; end if;
  select owner_id into own from public.report_private where report_id = rid;
  if own = me.id then raise exception 'You cannot flag your own report.'; end if;
  if c.mod_status = 'verified' then raise exception 'An admin has already checked this report and found no problem.'; end if;
  if exists (select 1 from public.flags where report_id = rid and user_id = me.id) then raise exception 'You already flagged this report.'; end if;
  rl := case reason when 'false_info' then 'False information' when 'duplicate' then 'Duplicate report' when 'spam' then 'Spam' when 'wrong_location' then 'Wrong location'
        when 'offensive' then 'Offensive content' when 'misleading_photo' then 'Misleading photo' when 'not_civic' then 'Not a civic issue' when 'other' then 'Other' end;
  if rl is null then raise exception 'Choose a reason for the flag.'; end if;
  select count(*) into used from public.flags where user_id = me.id and created_at > now() - interval '1 day';
  if used >= s.flags_per_day then raise exception 'You have used your % flags for today. You can flag again tomorrow.', s.flags_per_day; end if;
  insert into public.flags (report_id, user_id, reason_id, note) values (rid, me.id, reason, left(coalesce(note, ''), 200));
  first_flag := c.mod_status = 'normal';
  update public.complaints set flag_count = flag_count + 1, mod_status = case when mod_status = 'normal' then 'flagged' else mod_status end, updated_at = now() where id = rid returning * into c;
  if c.flag_count >= s.review_threshold and c.mod_status <> 'under_review' then
    update public.complaints set mod_status = 'under_review' where id = rid;
    update public.report_extra set mod_log = jsonb_build_array(jsonb_build_object('ts', public._ms(), 'by', 'System', 'action', 'Sent to review', 'note', c.flag_count || ' people flagged it. No decision has been made.')) || mod_log where report_id = rid;
    perform public._notify(own, 'moderation', 'Your report is being checked', 'Other users flagged "' || c.title || '". An admin will review it. No decision has been made.', '#/c/' || rid, rid);
    to_review := true;
  end if;
  if first_flag or to_review then
    perform public._notify_admins('moderation', case when to_review then 'Report sent to review' else 'A report was flagged' end, '"' || c.title || '" (' || rl || ').', '#/admin/r/' || rid, rid);
  end if;
  return jsonb_build_object('count', c.flag_count, 'toReview', to_review);
end $$;

-- ---------------------------------------------------------------------------- official work
create or replace function public._work_case(rid bigint) returns public.complaints language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('work'); c public.complaints;
begin
  select * into c from public.complaints where id = rid for update;
  if c.id is null then raise exception 'Report not found.'; end if;
  if c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'This report is not part of the active workload. An admin has to clear it first.'; end if;
  if me.role <> 'admin' and c.dept_id <> me.dept_id then raise exception 'Only the assigned department can do this.'; end if;
  if c.status in ('Resolved', 'Closed') then raise exception 'This report is already resolved.'; end if;
  return c;
end $$;

create or replace function public.start_work(rid bigint) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('work'); c public.complaints := public._work_case(rid);
begin
  update public.complaints set status = 'In progress', assigned_officer = me.id where id = rid;
  perform public._tl(rid, 'Work started by ' || public._dept_name(c.dept_id) || ' (' || me.name || ')');
  perform public._notify((select owner_id from public.report_private where report_id = rid), 'started', 'Work has started', public._dept_name(c.dept_id) || ' started work on "' || c.title || '".', '#/c/' || rid, rid);
end $$;

create or replace function public.resolve_report(rid bigint, response text, photo text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('work'); c public.complaints := public._work_case(rid); r text := left(trim(coalesce(response, '')), 800);
begin
  if char_length(r) < 10 then raise exception 'Write what was done, at least 10 characters.'; end if;
  if coalesce(photo, '') = '' then raise exception 'Add a photo that shows the finished work.'; end if;
  if photo not like me.id::text || '/%' then raise exception 'That photo does not belong to you.'; end if;
  update public.complaints set status = 'Resolved', authority_response = r, resolution_photo = photo, assigned_officer = me.id, resolved_at = now(), audit_state = 'pending' where id = rid;
  update public.report_extra set audit = jsonb_build_object('state', 'pending'), photo_paths = array_append(photo_paths, photo) where report_id = rid;
  perform public._tl(rid, 'Marked resolved by ' || public._dept_name(c.dept_id) || ' (' || me.name || ')');
  perform public._notify((select owner_id from public.report_private where report_id = rid), 'resolved', 'Your report was resolved', public._dept_name(c.dept_id) || ' marked "' || c.title || '" as fixed. Please check the work and tell us if it is really fixed.', '#/c/' || rid, rid);
end $$;

create or replace function public.transfer_report(rid bigint, to_dept text, why text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('work'); c public.complaints := public._work_case(rid); r text := trim(coalesce(why, ''));
begin
  if not exists (select 1 from public.departments where id = to_dept and active) then raise exception 'Choose a department.'; end if;
  if to_dept = c.dept_id then raise exception 'The report is already with that department.'; end if;
  if char_length(r) < 5 then raise exception 'Say why it is being transferred.'; end if;
  update public.complaints set dept_id = to_dept, assigned_officer = null where id = rid;
  perform public._tl(rid, 'Transferred from ' || public._dept_name(c.dept_id) || ' to ' || public._dept_name(to_dept) || '. Reason: ' || left(r, 200));
  perform public._notify((select owner_id from public.report_private where report_id = rid), 'transferred', 'Report sent to another department', '"' || c.title || '" is now with the ' || public._dept_name(to_dept) || '.', '#/c/' || rid, rid);
  perform public._notify_dept(to_dept, 'transferred', 'A report was transferred to you', '"' || c.title || '" came from ' || public._dept_name(c.dept_id) || '.', '#/c/' || rid, rid);
  if me.role = 'admin' then perform public._audit('report.reassign', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, jsonb_build_object('from', public._dept_name(c.dept_id), 'to', public._dept_name(to_dept))); end if;
end $$;

create or replace function public.escalate_report(rid bigint, why text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('work'); c public.complaints := public._work_case(rid); r text := trim(coalesce(why, ''));
begin
  if c.is_escalated then raise exception 'This report is already escalated.'; end if;
  if char_length(r) < 5 then raise exception 'Say why it needs escalation.'; end if;
  update public.complaints set is_escalated = true where id = rid;
  perform public._tl(rid, 'Escalated to district administration. Reason: ' || left(r, 200));
  perform public._notify((select owner_id from public.report_private where report_id = rid), 'escalated', 'Your report was escalated', '"' || c.title || '" was sent to the district administration.', '#/c/' || rid, rid);
  perform public._notify_admins('escalated', 'A report was escalated', '"' || c.title || '"', '#/admin/r/' || rid, rid);
end $$;

-- ---------------------------------------------------------------------------- the citizen checks the work
create or replace function public._audit_case(rid bigint) returns public.complaints language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('audit'); c public.complaints; s public.settings;
begin
  select * into s from public.settings where id = 1;
  select * into c from public.complaints where id = rid for update;
  if c.id is null then raise exception 'Report not found.'; end if;
  if not public.owns_report(rid) then raise exception 'Only the person who made this report can do this.'; end if;
  if c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'This report is not active right now.'; end if;
  if c.status = 'Closed' then raise exception 'This report is already closed.'; end if;
  if c.status <> 'Resolved' then raise exception 'There is nothing to check on this report right now.'; end if;
  if c.audit_state <> 'pending' or c.resolved_at + make_interval(days => s.audit_days) <= now() then raise exception 'The time to reply has ended, so the report was closed.'; end if;
  return c;
end $$;

create or replace function public.confirm_fix(rid bigint, rating int, comment text default '') returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('audit'); c public.complaints := public._audit_case(rid);
begin
  if rating is null or rating < 1 or rating > 5 then raise exception 'Choose a star rating from 1 to 5.'; end if;
  update public.complaints set status = 'Closed', audit_state = 'confirmed' where id = rid;
  update public.report_extra set audit = jsonb_build_object('state', 'confirmed', 'rating', rating, 'comment', left(coalesce(comment, ''), 300), 'ts', public._ms(), 'deptId', c.dept_id) where report_id = rid;
  perform public._tl(rid, 'Citizen confirmed the fix (' || rating || ' of 5 stars)');
  perform public._notify_dept(c.dept_id, 'confirmed', 'The citizen confirmed the fix', '"' || c.title || '" was rated ' || rating || ' of 5.', '#/c/' || rid, rid);
  perform public._notify(me.id, 'closed', 'Thank you', '"' || c.title || '" is now closed.', '#/c/' || rid, rid);
end $$;

create or replace function public.dispute_fix(rid bigint, reason_id text, note text, photo text default '') returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles := public._need('audit'); c public.complaints := public._audit_case(rid); s public.settings; x public.report_extra; rl text; n text := left(trim(coalesce(note, '')), 300);
begin
  select * into s from public.settings where id = 1;
  rl := case reason_id when 'still_there' then 'The problem is still there' when 'incomplete' then 'The work is not finished' when 'wrong_place' then 'The wrong place was fixed' when 'other' then 'Something else' end;
  if rl is null then raise exception 'Choose what is wrong.'; end if;
  if char_length(n) < 5 then raise exception 'Tell the department what is still wrong, at least 5 letters.'; end if;
  if c.reopen_count >= s.max_reopens then raise exception 'This report was already reopened % times. An admin has been asked to look at it, so it cannot be reopened again.', c.reopen_count; end if;
  if coalesce(photo, '') <> '' and photo not like me.id::text || '/%' then raise exception 'That photo does not belong to you.'; end if;
  select * into x from public.report_extra where report_id = rid;
  update public.report_extra set
    resolutions = jsonb_build_array(jsonb_build_object('ts', (extract(epoch from c.resolved_at) * 1000)::bigint, 'response', c.authority_response, 'proof', c.resolution_photo, 'deptId', c.dept_id, 'officerId', c.assigned_officer, 'disputedReason', rl, 'disputedNote', n)) || resolutions,
    disputes = jsonb_build_array(jsonb_build_object('ts', public._ms(), 'reasonId', reason_id, 'reason', rl, 'note', n, 'photo', coalesce(photo, ''))) || disputes,
    audit = jsonb_build_object('state', 'disputed', 'ts', public._ms()),
    photo_paths = case when coalesce(photo, '') <> '' then array_append(photo_paths, photo) else photo_paths end
  where report_id = rid;
  update public.complaints set status = 'Reopened', authority_response = '', resolution_photo = '', reopen_count = reopen_count + 1, audit_state = 'disputed', sla_start = now() where id = rid returning * into c;
  perform public._tl(rid, 'Citizen reported the problem is still there. Reason: ' || rl);
  perform public._notify_dept(c.dept_id, 'reopened', 'A report was reopened', '"' || c.title || '": the citizen says it is not fixed (' || lower(rl) || ').', '#/c/' || rid, rid);
  perform public._notify(me.id, 'reopened', 'Your report was reopened', 'We asked the ' || public._dept_name(c.dept_id) || ' to look at "' || c.title || '" again.', '#/c/' || rid, rid);
  if c.reopen_count >= s.max_reopens then perform public._notify_admins('escalated', 'A report keeps coming back', '"' || c.title || '" was reopened ' || c.reopen_count || ' times.', '#/admin/r/' || rid, rid); end if;
end $$;

-- closes resolved reports nobody answered. Safe to call often; schedule it with pg_cron if you like (see SETUP.md).
create or replace function public.sweep_audits() returns int language plpgsql security definer set search_path = public as $$
declare s public.settings; r record; n int := 0;
begin
  select * into s from public.settings where id = 1;
  for r in select c.id, c.title, rp.owner_id from public.complaints c join public.report_private rp on rp.report_id = c.id
            where c.status = 'Resolved' and c.audit_state = 'pending' and c.resolved_at + make_interval(days => s.audit_days) <= now() for update of c loop
    update public.complaints set status = 'Closed', audit_state = 'auto_closed' where id = r.id;
    update public.report_extra set audit = jsonb_build_object('state', 'auto_closed', 'ts', public._ms()) where report_id = r.id;
    perform public._tl(r.id, 'Closed automatically after ' || s.audit_days || ' days without a reply');
    perform public._notify(r.owner_id, 'closed', 'Your report was closed', '"' || r.title || '" was closed because no one replied within ' || s.audit_days || ' days.', '#/c/' || r.id, r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------- moderation (admin)
create or replace function public._mod_case(rid bigint, why text) returns public.complaints language plpgsql security definer set search_path = public as $$
declare c public.complaints;
begin
  perform public._need('admin');
  select * into c from public.complaints where id = rid for update;
  if c.id is null then raise exception 'Report not found.'; end if;
  if char_length(trim(coalesce(why, ''))) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  return c;
end $$;

create or replace function public._mod_log(rid bigint, act text, note text) returns void language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from public.profiles where id = auth.uid();
  update public.report_extra set mod_log = jsonb_build_array(jsonb_build_object('ts', public._ms(), 'by', who, 'action', act, 'note', note)) || mod_log where report_id = rid;
  update public.complaints set updated_at = now() where id = rid;
end $$;

create or replace function public._owner(rid bigint) returns uuid language sql stable security definer set search_path = public as $$ select owner_id from public.report_private where report_id = rid $$;

create or replace function public.mod_keep(rid bigint, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); r text := trim(why); me text; had_flags boolean;
begin
  if c.mod_status = 'verified' then raise exception 'This report was already cleared.'; end if;
  if c.mod_status in ('rejected', 'archived') then raise exception 'Restore the report first.'; end if;
  select name into me from public.profiles where id = auth.uid();
  had_flags := c.flag_count > 0;
  update public.complaints set mod_status = 'verified' where id = rid;
  update public.report_extra set mod_outcome = '', mod_reason = r where report_id = rid;
  perform public._mod_log(rid, 'Cleared: report is legitimate', r);
  if had_flags then perform public._hist(public._owner(rid), 'cleared', rid, r, me, null); end if;
  if c.mod_status = 'under_review' then perform public._notify(public._owner(rid), 'moderation', 'Your report is visible again', 'An admin checked "' || c.title || '" and found no problem.', '#/c/' || rid, rid); end if;
  perform public._audit('report.keep', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, '{}');
end $$;

create or replace function public.mod_review(rid bigint, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); r text := trim(why);
begin
  if c.mod_status = 'under_review' then raise exception 'This report is already under review.'; end if;
  if c.mod_status in ('rejected', 'archived') then raise exception 'Restore the report first.'; end if;
  update public.complaints set mod_status = 'under_review' where id = rid;
  update public.report_extra set mod_reason = r where report_id = rid;
  perform public._mod_log(rid, 'Marked under review', r);
  perform public._notify(public._owner(rid), 'moderation', 'Your report is being checked', 'An admin is checking "' || c.title || '". No decision has been made.', '#/c/' || rid, rid);
  perform public._audit('report.review', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, '{}');
end $$;

create or replace function public.mod_reject(rid bigint, outcome text, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); r text := trim(why); lbl text; me text;
begin
  lbl := case outcome when 'fake' then 'Fake report' when 'spam' then 'Spam' when 'not_civic' then 'Not a civic issue' when 'other' then 'Other reason' end;
  if lbl is null then raise exception 'Choose why the report is rejected.'; end if;
  if c.mod_status in ('rejected', 'archived') then raise exception 'This report is already closed by moderation.'; end if;
  select name into me from public.profiles where id = auth.uid();
  update public.complaints set mod_status = 'rejected' where id = rid;
  update public.report_extra set mod_outcome = outcome, mod_reason = r where report_id = rid;
  perform public._mod_log(rid, 'Rejected: ' || lbl, r);
  if outcome in ('fake', 'spam') then perform public._hist(public._owner(rid), outcome, rid, r, me, null); end if;
  perform public._notify(public._owner(rid), 'moderation', 'Your report was removed', 'An admin reviewed "' || c.title || '" and removed it (' || lower(lbl) || '). ' || r, '#/c/' || rid, rid);
  perform public._audit('report.reject', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, jsonb_build_object('outcome', outcome));
end $$;

create or replace function public.mod_duplicate(rid bigint, original bigint, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); o public.complaints; r text := trim(why); me text;
begin
  select * into o from public.complaints where id = original;
  if o.id is null then raise exception 'We could not find the original report. Enter its number, for example 12.'; end if;
  if o.id = rid then raise exception 'A report cannot be a duplicate of itself.'; end if;
  if o.mod_status not in ('normal', 'flagged', 'verified') or exists (select 1 from public.report_extra where report_id = o.id and duplicate_of is not null) then raise exception 'Choose an active report as the original.'; end if;
  if c.mod_status in ('rejected', 'archived') then raise exception 'This report is already closed by moderation.'; end if;
  select name into me from public.profiles where id = auth.uid();
  update public.complaints set mod_status = 'rejected' where id = rid;
  update public.report_extra set mod_outcome = 'duplicate', mod_reason = r, duplicate_of = original where report_id = rid;
  perform public._mod_log(rid, 'Marked as duplicate of DL-' || original, r);
  perform public._hist(public._owner(rid), 'duplicate', rid, r, me, null);
  perform public._notify(public._owner(rid), 'moderation', 'Your report matches an existing one', '"' || c.title || '" duplicates report DL-' || original || '. Please follow that report.', '#/c/' || original, original);
  perform public._audit('report.duplicate', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, jsonb_build_object('original', original));
end $$;

create or replace function public.mod_archive(rid bigint, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); r text := trim(why);
begin
  if c.mod_status = 'archived' then raise exception 'This report is already archived.'; end if;
  update public.complaints set mod_status = 'archived' where id = rid;
  update public.report_extra set mod_outcome = '', mod_reason = r where report_id = rid;
  perform public._mod_log(rid, 'Archived', r);
  perform public._notify(public._owner(rid), 'moderation', 'Your report was archived', '"' || c.title || '" was archived by an admin. ' || r, '#/c/' || rid, rid);
  perform public._audit('report.archive', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, '{}');
end $$;

create or replace function public.mod_restore(rid bigint, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); r text := trim(why);
begin
  if c.mod_status in ('normal', 'flagged', 'verified') then raise exception 'This report is already active.'; end if;
  update public.mod_history set reversed = true where user_id = public._owner(rid) and report_id = rid and type in ('fake', 'spam', 'duplicate', 'cleared') and not reversed;
  update public.complaints set mod_status = 'normal' where id = rid;
  update public.report_extra set mod_outcome = '', mod_reason = '', duplicate_of = null where report_id = rid;
  perform public._mod_log(rid, 'Restored', r);
  perform public._notify(public._owner(rid), 'moderation', 'Your report was restored', 'An admin restored "' || c.title || '". It is active again.', '#/c/' || rid, rid);
  perform public._audit('report.restore', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, '{}');
end $$;

create or replace function public.set_location_privacy(rid bigint, lvl text, why text) returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints := public._mod_case(rid, why); r text := trim(why); s public.settings; pr public.report_private; pub double precision[]; ex_anon boolean;
begin
  if lvl not in ('approximate', 'hidden', 'exact') then raise exception 'Choose how the location is shown.'; end if;
  if c.location_privacy = lvl then raise exception 'The location is already shown that way.'; end if;
  select * into s from public.settings where id = 1; select * into pr from public.report_private where report_id = rid;
  if c.has_gps then
    if lvl = 'hidden' then pub := array[null, null]::double precision[];
    elsif lvl = 'exact' then pub := array[pr.lat, pr.lng];
    else pub := public._snap(pr.lat, pr.lng, s.public_grid_meters * case when c.is_anonymous then 2 else 1 end); end if;
    update public.complaints set pub_lat = pub[1], pub_lng = pub[2] where id = rid;
  end if;
  update public.complaints set location_privacy = lvl where id = rid;
  perform public._mod_log(rid, 'Map privacy set to "' || lvl || '"', r);
  perform public._audit('report.location_privacy', 'report', rid::text, 'DL-' || rid || ' ' || c.title, r, jsonb_build_object('from', c.location_privacy, 'to', lvl));
end $$;

-- ---------------------------------------------------------------------------- people (admin)
create or replace function public._user_case(uid uuid, why text) returns public.profiles language plpgsql security definer set search_path = public as $$
declare a public.profiles := public._need('admin'); u public.profiles;
begin
  select * into u from public.profiles where id = uid;
  if u.id is null then raise exception 'Account not found.'; end if;
  if u.role = 'admin' then raise exception 'Admin accounts cannot be moderated here.'; end if;
  if u.id = a.id then raise exception 'You cannot do this to your own account.'; end if;
  if char_length(trim(coalesce(why, ''))) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  return u;
end $$;

create or replace function public.admin_warn(uid uuid, why text) returns void language plpgsql security definer set search_path = public as $$
declare u public.profiles := public._user_case(uid, why); r text := trim(why); me text;
begin
  select name into me from public.profiles where id = auth.uid();
  perform public._hist(uid, 'warning', null, r, me, null);
  perform public._notify(uid, 'account', 'You received a warning', 'An admin sent you a warning: ' || r, '#/profile', null);
  perform public._audit('user.warn', 'user', uid::text, u.name, r, '{}');
end $$;

create or replace function public.admin_suspend(uid uuid, days int, why text) returns void language plpgsql security definer set search_path = public as $$
declare u public.profiles := public._user_case(uid, why); r text := trim(why); me text; until_ts timestamptz;
begin
  if days is null or days < 1 or days > 90 then raise exception 'Choose between 1 and 90 days.'; end if;
  if u.account_status = 'banned' then raise exception 'This account is already banned.'; end if;
  select name into me from public.profiles where id = auth.uid();
  until_ts := now() + make_interval(days => days);
  update public.profiles set account_status = 'suspended', account_until = until_ts, account_reason = r where id = uid;
  perform public._hist(uid, 'suspension', null, r, me, days);
  perform public._notify(uid, 'account', 'Your account is suspended', 'You cannot post, comment or flag until ' || public._fmt(until_ts) || '. Reason: ' || r, '#/profile', null);
  perform public._audit('user.suspend', 'user', uid::text, u.name, r, jsonb_build_object('days', days));
end $$;

create or replace function public.admin_ban(uid uuid, why text, confirm_word text) returns void language plpgsql security definer set search_path = public as $$
declare u public.profiles := public._user_case(uid, why); r text := trim(why); me text;
begin
  if confirm_word is distinct from 'BAN' then raise exception 'Type BAN to confirm a permanent ban.'; end if;
  select name into me from public.profiles where id = auth.uid();
  update public.profiles set account_status = 'banned', account_until = null, account_reason = r where id = uid;
  perform public._hist(uid, 'ban', null, r, me, null);
  perform public._audit('user.ban', 'user', uid::text, u.name, r, '{}');
end $$;

create or replace function public.admin_reinstate(uid uuid, why text) returns void language plpgsql security definer set search_path = public as $$
declare u public.profiles := public._user_case(uid, why); r text := trim(why); me text;
begin
  if u.account_status = 'active' then raise exception 'This account is already active.'; end if;
  select name into me from public.profiles where id = auth.uid();
  update public.profiles set account_status = 'active', account_until = null, account_reason = '' where id = uid;
  perform public._hist(uid, 'reinstated', null, r, me, null);
  perform public._notify(uid, 'account', 'Your account is active again', 'An admin restored your account. ' || r, '#/profile', null);
  perform public._audit('user.reinstate', 'user', uid::text, u.name, r, '{}');
end $$;

-- official verification
create or replace function public._auth_case(uid uuid, allowed text[], to_status text, act text, why text, need_why boolean, ntitle text, nmsg text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.profiles := public._need('admin'); u public.profiles; r text := trim(coalesce(why, ''));
begin
  select * into u from public.profiles where id = uid and role = 'official';
  if u.id is null then raise exception 'Official not found.'; end if;
  if not (u.verification_status = any (allowed)) then raise exception 'This is not possible while the status is "%".', replace(u.verification_status, '_', ' '); end if;
  if need_why and char_length(r) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  update public.profiles set verification_status = to_status, verification_note = r,
         verification_history = jsonb_build_array(jsonb_build_object('ts', public._ms(), 'status', to_status, 'by', a.name, 'note', r)) || verification_history where id = uid;
  perform public._notify(uid, 'verification', ntitle, nmsg || case when r <> '' then ' ' || r else '' end, '#/verification', null);
  perform public._audit(act, 'official', uid::text, u.name || ' (' || public._dept_name(u.dept_id) || ')', r, jsonb_build_object('from', u.verification_status, 'to', to_status));
end $$;
create or replace function public.auth_approve(uid uuid, note text default 'ID checked') returns void language sql security definer set search_path = public as $$
  select public._auth_case(uid, array['pending', 'info_requested'], 'approved', 'authority.approve', coalesce(nullif(trim(note), ''), 'ID checked'), false, 'Your official access was approved', 'You can now open your department desk.') $$;
create or replace function public.auth_reject(uid uuid, why text) returns void language sql security definer set search_path = public as $$
  select public._auth_case(uid, array['pending', 'info_requested'], 'rejected', 'authority.reject', why, true, 'Your official access was not approved', 'Reason:') $$;
create or replace function public.auth_request_info(uid uuid, msg text) returns void language sql security definer set search_path = public as $$
  select public._auth_case(uid, array['pending'], 'info_requested', 'authority.request_info', msg, true, 'More information needed', 'The admin asked:') $$;
create or replace function public.auth_suspend(uid uuid, why text) returns void language sql security definer set search_path = public as $$
  select public._auth_case(uid, array['approved'], 'suspended', 'authority.suspend', why, true, 'Your official access was suspended', 'Reason:') $$;
create or replace function public.auth_reinstate(uid uuid, why text) returns void language sql security definer set search_path = public as $$
  select public._auth_case(uid, array['suspended'], 'approved', 'authority.reinstate', why, true, 'Your official access was restored', 'You can use your department desk again.') $$;

create or replace function public.submit_verification_info(txt text) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; t text := left(trim(coalesce(txt, '')), 600);
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'official' then raise exception 'Only officials can send verification details.'; end if;
  if me.verification_status not in ('info_requested', 'rejected') then raise exception 'There is nothing to update right now.'; end if;
  if char_length(t) < 5 then raise exception 'Write the details the admin asked for.'; end if;
  update public.profiles set verification_status = 'pending',
    verification_supporting = jsonb_build_array(jsonb_build_object('ts', public._ms(), 'text', t)) || verification_supporting,
    verification_history = jsonb_build_array(jsonb_build_object('ts', public._ms(), 'status', 'pending', 'by', 'applicant', 'note', 'Sent more information')) || verification_history where id = me.id;
  perform public._notify_admins('verification', 'Official sent more information', me.name || ' replied to your request.', '#/admin/authorities/' || me.id, null);
end $$;

create or replace function public.update_my_profile(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Please log in first.'; end if;
  update public.profiles set name = left(coalesce(nullif(trim(p ->> 'name'), ''), name), 80), phone = left(coalesce(p ->> 'phone', phone), 15), state = left(coalesce(p ->> 'state', state), 60),
         district = left(coalesce(p ->> 'district', district), 60), city = left(coalesce(p ->> 'city', city), 60), pincode = left(coalesce(p ->> 'pincode', pincode), 10) where id = me.id;
end $$;

-- ---------------------------------------------------------------------------- departments and settings (admin)
create or replace function public.save_department(p jsonb) returns text language plpgsql security definer set search_path = public as $$
declare a public.profiles := public._need('admin'); s public.settings; d public.departments; nm text := trim(coalesce(p ->> 'name', '')); did text := nullif(p ->> 'id', ''); rl text[]; why text := coalesce(nullif(trim(p ->> 'reason'), ''), 'Department edited'); act boolean := coalesce((p ->> 'active')::boolean, true);
begin
  select * into s from public.settings where id = 1;
  if char_length(nm) < 3 then raise exception 'Give the department a name of at least 3 letters.'; end if;
  if exists (select 1 from public.departments where lower(name) = lower(nm) and id is distinct from did) then raise exception 'A department with this name already exists.'; end if;
  select coalesce(array_agg(trim(x)) filter (where trim(x) <> ''), '{}') into rl from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) x;
  if did is not null then
    select * into d from public.departments where id = did;
    if d.id is null then raise exception 'Department not found.'; end if;
    if not act and d.id = s.fallback_dept then raise exception 'This is the fallback department for unrouted reports, so it must stay active.'; end if;
    if not act and d.active and (select count(*) from public.departments where active) <= 1 then raise exception 'At least one department must stay active.'; end if;
    update public.departments set name = nm, description = left(coalesce(p ->> 'description', ''), 300), active = act, roles = rl where id = did;
    perform public._audit('department.update', 'department', did, nm, why, jsonb_build_object('before', jsonb_build_object('name', d.name, 'active', d.active), 'after', jsonb_build_object('name', nm, 'active', act)));
    return did;
  end if;
  did := coalesce(nullif(regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g'), ''), 'dept');
  if exists (select 1 from public.departments where id = did) then did := did || '-' || (select count(*) from public.departments); end if;
  insert into public.departments (id, name, description, active, roles) values (did, nm, left(coalesce(p ->> 'description', ''), 300), act, rl);
  perform public._audit('department.create', 'department', did, nm, why, '{}');
  return did;
end $$;

create or replace function public.set_category_dept(cat text, dept text) returns void language plpgsql security definer set search_path = public as $$
declare a public.profiles := public._need('admin');
begin
  if cat not in ('road', 'water', 'power', 'waste', 'flood', 'fire', 'building', 'health', 'other') then raise exception 'Unknown category.'; end if;
  if not exists (select 1 from public.departments where id = dept and active) then raise exception 'Choose an active department.'; end if;
  update public.settings set category_dept = category_dept || jsonb_build_object(cat, dept) where id = 1;
  perform public._audit('department.routing', 'category', cat, cat, 'New reports of this type now go to ' || public._dept_name(dept), jsonb_build_object('dept', public._dept_name(dept)));
end $$;

create or replace function public.save_settings(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare a public.profiles := public._need('admin'); b public.settings; n public.settings;
begin
  select * into b from public.settings where id = 1;
  begin
    update public.settings set
      review_threshold = coalesce((p ->> 'review_threshold')::int, review_threshold), flags_per_day = coalesce((p ->> 'flags_per_day')::int, flags_per_day),
      reports_per_hour = coalesce((p ->> 'reports_per_hour')::int, reports_per_hour), audit_days = coalesce((p ->> 'audit_days')::int, audit_days),
      max_reopens = coalesce((p ->> 'max_reopens')::int, max_reopens), public_grid_meters = coalesce((p ->> 'public_grid_meters')::int, public_grid_meters),
      map_tiles = coalesce((p ->> 'map_tiles')::boolean, map_tiles), area_level = coalesce(p ->> 'area_level', area_level) where id = 1;
  exception when check_violation then raise exception 'One of the numbers is outside its allowed range.';
            when invalid_text_representation then raise exception 'One of the settings is not a valid value.'; end;
  select * into n from public.settings where id = 1;
  perform public._audit('settings.update', 'settings', 'limits', 'Moderation limits', 'Settings changed',
    jsonb_build_object('before', to_jsonb(b) - 'category_dept', 'after', to_jsonb(n) - 'category_dept'));
end $$;

-- ---------------------------------------------------------------------------- small utilities
create or replace function public.mark_notifications_read(ids uuid[] default null) returns void language sql security definer set search_path = public as $$
  update public.notifications set is_read = true where user_id = auth.uid() and (ids is null or id = any (ids)) $$;

create or replace function public.log_system(lvl text, area text, msg text) returns void language sql security definer set search_path = public as $$
  insert into public.system_logs (level, area, message, user_id) select case when lvl in ('info', 'warn', 'error') then lvl else 'info' end, left(coalesce(area, ''), 40), left(coalesce(msg, ''), 300), auth.uid() where auth.uid() is not null $$;

create or replace function public.verify_audit_chain() returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r record; prev text := 'genesis';
begin
  perform public._need('admin');
  for r in select * from public.audit_log order by id asc loop
    if r.prev_hash <> prev then return jsonb_build_object('ok', false, 'brokenAt', r.id); end if;
    if r.hash <> encode(digest(r.prev_hash || '|' || coalesce(r.admin_id::text, '') || '|' || r.action || '|' || r.target_type || '|' || r.target_id || '|' || r.reason || '|' || r.ts_ms::text, 'sha256'), 'hex') then return jsonb_build_object('ok', false, 'brokenAt', r.id); end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'count', (select count(*) from public.audit_log));
end $$;

-- ---------------------------------------------------------------------------- row-level security
alter table public.departments enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.mod_history enable row level security;
alter table public.complaints enable row level security;
alter table public.report_private enable row level security;
alter table public.report_extra enable row level security;
alter table public.comments enable row level security;
alter table public.upvotes enable row level security;
alter table public.flags enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table public.system_logs enable row level security;
alter table public.pings enable row level security;

drop policy if exists p_ping_read on public.pings;            create policy p_ping_read on public.pings for select to anon, authenticated using (true);
drop policy if exists p_dept_read on public.departments;      create policy p_dept_read on public.departments for select to anon, authenticated using (true);
drop policy if exists p_settings_read on public.settings;     create policy p_settings_read on public.settings for select to anon, authenticated using (true);
drop policy if exists p_profile_read on public.profiles;      create policy p_profile_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists p_hist_read on public.mod_history;      create policy p_hist_read on public.mod_history for select to authenticated using (public.is_admin());
drop policy if exists p_cmp_read on public.complaints;        create policy p_cmp_read on public.complaints for select to anon, authenticated
  using (mod_status in ('normal', 'flagged', 'verified') or public.is_admin() or public.owns_report(id));
drop policy if exists p_priv_read on public.report_private;   create policy p_priv_read on public.report_private for select to authenticated using (public.can_read_private(report_id));
drop policy if exists p_extra_read on public.report_extra;    create policy p_extra_read on public.report_extra for select to authenticated using (public.can_read_private(report_id));
drop policy if exists p_cmt_read on public.comments;          create policy p_cmt_read on public.comments for select to anon, authenticated using (public.can_see_report(report_id));
drop policy if exists p_up_read on public.upvotes;            create policy p_up_read on public.upvotes for select to authenticated using (user_id = auth.uid());
drop policy if exists p_flag_read on public.flags;            create policy p_flag_read on public.flags for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists p_note_read on public.notifications;    create policy p_note_read on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists p_audit_read on public.audit_log;       create policy p_audit_read on public.audit_log for select to authenticated using (public.is_admin());
drop policy if exists p_sys_read on public.system_logs;       create policy p_sys_read on public.system_logs for select to authenticated using (public.is_admin());
-- No insert / update / delete policies exist on any table: every change goes through the functions above.

-- ---------------------------------------------------------------------------- privileges
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.departments, public.settings, public.complaints, public.comments, public.pings to anon, authenticated;
grant select on public.profiles, public.mod_history, public.report_private, public.report_extra, public.upvotes, public.flags, public.notifications, public.audit_log, public.system_logs to authenticated;
grant execute on function public.has_admin() to anon, authenticated;
grant execute on function public.is_admin(), public.is_official_of(text), public.owns_report(bigint), public.report_is_active(bigint), public.can_see_report(bigint), public.can_read_private(bigint) to anon, authenticated;
grant execute on function
  public.create_report(jsonb), public.toggle_upvote(bigint), public.add_comment(bigint, text), public.flag_report(bigint, text, text),
  public.start_work(bigint), public.resolve_report(bigint, text, text), public.transfer_report(bigint, text, text), public.escalate_report(bigint, text),
  public.confirm_fix(bigint, int, text), public.dispute_fix(bigint, text, text, text), public.sweep_audits(),
  public.mod_keep(bigint, text), public.mod_review(bigint, text), public.mod_reject(bigint, text, text), public.mod_duplicate(bigint, bigint, text),
  public.mod_archive(bigint, text), public.mod_restore(bigint, text), public.set_location_privacy(bigint, text, text),
  public.admin_warn(uuid, text), public.admin_suspend(uuid, int, text), public.admin_ban(uuid, text, text), public.admin_reinstate(uuid, text),
  public.auth_approve(uuid, text), public.auth_reject(uuid, text), public.auth_request_info(uuid, text), public.auth_suspend(uuid, text), public.auth_reinstate(uuid, text),
  public.submit_verification_info(text), public.update_my_profile(jsonb), public.save_department(jsonb), public.set_category_dept(text, text), public.save_settings(jsonb),
  public.mark_notifications_read(uuid[]), public.log_system(text, text, text), public.verify_audit_chain()
  to authenticated;

-- ---------------------------------------------------------------------------- photos (private bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- who may open a photo: its owner, admins, and anyone who may see the report that uses it
create or replace function public.can_read_photo(path text) returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is not null and (storage.foldername(path))[1] = auth.uid()::text)
      or public.is_admin()
      or exists (select 1 from public.complaints c where (c.image_path = path or c.resolution_photo = path) and c.mod_status in ('normal', 'flagged', 'verified'))
      or exists (select 1 from public.report_extra e where path = any (e.photo_paths) and public.can_read_private(e.report_id)) $$;
grant execute on function public.can_read_photo(text) to anon, authenticated;

drop policy if exists photo_read on storage.objects;
create policy photo_read on storage.objects for select to anon, authenticated using (bucket_id = 'report-photos' and public.can_read_photo(name));
drop policy if exists photo_insert on storage.objects;
create policy photo_insert on storage.objects for insert to authenticated with check (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists photo_delete on storage.objects;
create policy photo_delete on storage.objects for delete to authenticated using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------- realtime
do $$ declare t text; begin
  foreach t in array array['pings', 'notifications'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

-- =====================================================================================
--  AFTER running this file
--    1. Sign up on the website with the email you want to use as administrator.
--    2. In the SQL Editor run (with your email):
--         update public.profiles set role = 'admin' where email = 'you@example.com';
--    That is the only way to create an admin. No one can promote themselves from the website.
-- =====================================================================================
