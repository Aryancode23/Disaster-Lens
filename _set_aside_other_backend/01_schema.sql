-- =====================================================================
-- Disaster Lens – database schema (Phase 6)
-- Run this whole file once in the Supabase SQL editor (Project -> SQL editor -> New query).
-- Then run 02_functions.sql, 03_policies.sql and 04_storage.sql, in that order.
--
-- Design rules:
--   * Every table has Row Level Security (RLS). Nobody writes to tables directly.
--   * All changes go through the functions in 02_functions.sql, which check who is calling
--     (auth.uid()) before doing anything. This is the "server" the earlier phases were missing.
--   * Private details (who reported, exact coordinates) are only in the base tables.
--     The public only ever reads the view public_complaints.
-- =====================================================================

create schema if not exists app;
grant usage on schema app to anon, authenticated;

-- ---------- reference data ----------
create table if not exists public.departments (
  id          text primary key,
  name        text not null unique check (char_length(name) between 3 and 80),
  description text not null default '',
  active      boolean not null default true,
  roles       text[] not null default '{}'
);

create table if not exists public.categories (
  id       text primary key,
  name     text not null,
  dept_id  text not null references public.departments(id),
  sla_days int  not null check (sla_days between 1 and 60)
);

create table if not exists public.settings (
  id                 int primary key default 1 check (id = 1),
  review_threshold   int not null default 5  check (review_threshold between 2 and 20),
  flags_per_day      int not null default 5  check (flags_per_day between 1 and 20),
  reports_per_hour   int not null default 5  check (reports_per_hour between 1 and 20),
  audit_days         int not null default 7  check (audit_days between 1 and 30),
  max_reopens        int not null default 2  check (max_reopens between 1 and 5),
  public_grid_meters int not null default 500 check (public_grid_meters in (250, 500, 1000)),
  map_tiles          boolean not null default false,
  area_level         text not null default 'city' check (area_level in ('state', 'district', 'city')),
  fallback_dept      text not null default 'municipal' references public.departments(id),
  category_dept      jsonb not null default '{}'::jsonb
);

-- ---------- people ----------
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  role                   text not null default 'citizen' check (role in ('citizen', 'official', 'admin')),
  name                   text not null,
  email                  text not null,
  phone                  text not null default '',
  state                  text not null default '',
  district               text not null default '',
  city                   text not null default '',
  pincode                text not null default '',
  designation            text not null default '',
  dept_id                text references public.departments(id),
  id_proof               text not null default '',
  verification_status    text not null default 'none' check (verification_status in ('none', 'pending', 'info_requested', 'approved', 'rejected', 'suspended')),
  verification_submitted timestamptz,
  verification_note      text not null default '',
  account_status         text not null default 'active' check (account_status in ('active', 'suspended', 'banned')),
  suspended_until        timestamptz,
  account_reason         text not null default '',
  created_at             timestamptz not null default now()
);

create table if not exists public.verification_history (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status  text not null,
  by_name text not null,
  note    text not null default '',
  ts      timestamptz not null default now()
);

create table if not exists public.verification_info (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text    text not null,
  ts      timestamptz not null default now()
);

create table if not exists public.mod_history (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  type      text not null,
  report_id bigint,
  reason    text not null default '',
  by_name   text not null default '',
  days      int,
  reversed  boolean not null default false,
  ts        timestamptz not null default now()
);

-- ---------- reports ----------
create table if not exists public.complaints (
  id               bigint generated always as identity primary key,
  citizen_id       uuid not null references public.profiles(id),
  author_name      text not null default '',
  is_anonymous     boolean not null default false,
  category         text not null references public.categories(id),
  title            text not null check (char_length(title) between 5 and 90),
  description      text not null check (char_length(description) between 15 and 800),
  state            text not null default '',
  district         text not null default '',
  city             text not null default '',
  pincode          text not null default '',
  address          text not null default '',
  latitude         double precision check (latitude is null or latitude between 6 and 38),
  longitude        double precision check (longitude is null or longitude between 68 and 98),
  location_privacy text not null default 'approximate' check (location_privacy in ('approximate', 'hidden', 'exact')),
  image_path       text,
  status           text not null default 'Submitted' check (status in ('Submitted', 'In progress', 'Resolved', 'Reopened', 'Closed')),
  priority         text not null default 'Routine' check (priority in ('Urgent', 'Routine')),
  priority_reason  text not null default '',
  dept_id          text not null references public.departments(id),
  sla_days         int  not null default 7,
  sla_start        timestamptz,
  upvote_count     int  not null default 0,
  flag_count       int  not null default 0,
  is_escalated     boolean not null default false,
  authority_response text not null default '',
  resolution_path  text,
  assigned_officer uuid references public.profiles(id),
  mod_status       text not null default 'normal' check (mod_status in ('normal', 'flagged', 'under_review', 'verified', 'rejected', 'archived')),
  mod_outcome      text not null default '',
  mod_reason       text not null default '',
  duplicate_of     bigint references public.complaints(id),
  reopen_count     int  not null default 0,
  audit_state      text not null default '' check (audit_state in ('', 'pending', 'confirmed', 'disputed', 'auto_closed')),
  audit_rating     int  check (audit_rating is null or audit_rating between 1 and 5),
  audit_comment    text not null default '',
  audit_dept       text,
  audit_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists complaints_citizen_idx on public.complaints (citizen_id);
create index if not exists complaints_dept_idx    on public.complaints (dept_id, status);
create index if not exists complaints_mod_idx     on public.complaints (mod_status, created_at desc);
create index if not exists complaints_created_idx on public.complaints (created_at desc);
create index if not exists complaints_cat_idx     on public.complaints (category);
create index if not exists complaints_prio_idx    on public.complaints (priority);
create index if not exists complaints_geo_idx     on public.complaints (latitude, longitude) where latitude is not null;

create table if not exists public.complaint_events (
  id           bigint generated always as identity primary key,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  label        text not null,
  ts           timestamptz not null default now()
);
create index if not exists events_complaint_idx on public.complaint_events (complaint_id, ts);

create table if not exists public.complaint_comments (
  id           bigint generated always as identity primary key,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  author_name  text not null,
  author_role  text not null,
  text         text not null check (char_length(text) between 1 and 600),
  ts           timestamptz not null default now()
);
create index if not exists comments_complaint_idx on public.complaint_comments (complaint_id, ts);

create table if not exists public.upvotes (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  ts           timestamptz not null default now(),
  primary key (user_id, complaint_id)
);

create table if not exists public.flags (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  reason_id    text not null,
  note         text not null default '',
  ts           timestamptz not null default now(),
  unique (user_id, complaint_id)
);
create index if not exists flags_user_ts_idx on public.flags (user_id, ts);

create table if not exists public.resolutions (
  id               bigint generated always as identity primary key,
  complaint_id     bigint not null references public.complaints(id) on delete cascade,
  dept_id          text,
  officer_id       uuid,
  response         text not null default '',
  proof_path       text,
  resolved_at      timestamptz not null default now(),
  disputed_reason  text not null default '',
  disputed_note    text not null default ''
);

create table if not exists public.disputes (
  id           bigint generated always as identity primary key,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  reason_id    text not null,
  reason       text not null,
  note         text not null,
  photo_path   text,
  ts           timestamptz not null default now()
);

create table if not exists public.mod_log (
  id           bigint generated always as identity primary key,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  by_name      text not null,
  action       text not null,
  note         text not null default '',
  ts           timestamptz not null default now()
);

create table if not exists public.notifications (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  type      text not null default 'general',
  title     text not null,
  message   text not null,
  link      text not null default '',
  report_id bigint,
  is_read   boolean not null default false,
  status    text not null default 'delivered',
  ts        timestamptz not null default now()
);
create index if not exists notif_user_idx on public.notifications (user_id, ts desc);

-- append-only record of what administrators did; each row carries the hash of the one before it
create table if not exists public.audit_log (
  seq          bigint generated always as identity primary key,
  ts           timestamptz not null default clock_timestamp(),
  admin_id     uuid,
  admin_name   text not null,
  action       text not null,
  target_type  text not null,
  target_id    text not null default '',
  target_label text not null default '',
  reason       text not null default '',
  meta         jsonb not null default '{}'::jsonb,
  prev_hash    text not null,
  hash         text not null
);

create table if not exists public.system_log (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  level   text not null default 'info',
  area    text not null default '',
  message text not null
);

-- tiny table that only exists so every visitor's browser hears "something changed" in real time
create table if not exists public.pings (
  id        bigint generated always as identity primary key,
  kind      text not null,
  report_id bigint,
  ts        timestamptz not null default now()
);

-- ---------- seed reference data ----------
insert into public.departments (id, name, description) values
  ('municipal',   'Municipal Office',          'General civic problems and anything that fits nowhere else.'),
  ('works',       'Public Works Department',   'Roads, bridges, footpaths and public buildings.'),
  ('water',       'Water & Sewerage Board',    'Drinking water, drains and sewers.'),
  ('electricity', 'Electricity Board',         'Street lights, poles and live wires.'),
  ('sanitation',  'Municipal Sanitation',      'Garbage collection and cleanliness.'),
  ('disaster',    'Disaster Management Cell',  'Floods, waterlogging and emergencies.'),
  ('fire',        'Fire Services',             'Fire and safety hazards.'),
  ('housing',     'Building & Housing',        'Damaged and unsafe buildings.'),
  ('health',      'Health Department',         'Health centres and medical supplies.'),
  ('police',      'Police',                    'Cases that need the police.')
on conflict (id) do nothing;

insert into public.categories (id, name, dept_id, sla_days) values
  ('road',     'Roads & potholes',           'works',       7),
  ('water',    'Water & drainage',           'water',       5),
  ('power',    'Electricity & live wires',   'electricity', 2),
  ('waste',    'Waste & sanitation',         'sanitation',  5),
  ('flood',    'Flood & waterlogging',       'disaster',    1),
  ('fire',     'Fire & safety',              'fire',        1),
  ('building', 'Building damage & collapse', 'housing',     2),
  ('health',   'Health & medical',           'health',      2),
  ('other',    'Something else',             'municipal',   7)
on conflict (id) do nothing;

insert into public.settings (id) values (1) on conflict (id) do nothing;
