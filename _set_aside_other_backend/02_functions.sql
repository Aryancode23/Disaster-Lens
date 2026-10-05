-- =====================================================================
-- Disaster Lens – rules (Phase 6). Run after 01_schema.sql.
-- Every function here is the ONLY way data changes. They run as the database owner
-- (security definer) but start by checking who is calling.
-- =====================================================================

-- ---------- small helpers (not callable from the browser: they live in schema "app") ----------
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and account_status <> 'banned');
$$;

create or replace function app.is_approved_official() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'official' and verification_status = 'approved' and account_status <> 'banned');
$$;

create or replace function app.my_dept() returns text language sql stable security definer set search_path = public as $$
  select dept_id from profiles where id = auth.uid();
$$;

-- may the caller read this report in full? (owner, admin, or an approved official of its department)
create or replace function app.can_see_private(cid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from complaints c
    where c.id = cid and (c.citizen_id = auth.uid() or app.is_admin()
          or (app.is_approved_official() and c.dept_id = app.my_dept() and c.mod_status in ('normal', 'flagged', 'verified')))
  );
$$;

-- may the caller see this report at all? (public reports for everyone, anything else only if allowed above)
create or replace function app.can_see(cid bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from complaints c where c.id = cid and c.mod_status in ('normal', 'flagged', 'verified'))
      or app.can_see_private(cid);
$$;

create or replace function app.syslog(lvl text, area text, msg text) returns void language sql security definer set search_path = public as $$
  insert into system_log (level, area, message) values (lvl, area, left(msg, 300));
$$;

create or replace function app.notify(uid uuid, typ text, ttl text, msg text, lnk text default '', rid bigint default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, message, link, report_id) values (uid, typ, ttl, msg, coalesce(lnk, ''), rid);
$$;

create or replace function app.notify_admins(typ text, ttl text, msg text, lnk text default '', rid bigint default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, message, link, report_id)
  select id, typ, ttl, msg, coalesce(lnk, ''), rid from profiles where role = 'admin';
$$;

create or replace function app.notify_dept(d text, typ text, ttl text, msg text, lnk text default '', rid bigint default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, message, link, report_id)
  select id, typ, ttl, msg, coalesce(lnk, ''), rid from profiles
  where role = 'official' and verification_status = 'approved' and dept_id = d and account_status <> 'banned';
$$;

create or replace function app.event(cid bigint, lbl text) returns void language sql security definer set search_path = public as $$
  insert into complaint_events (complaint_id, label) values (cid, lbl);
$$;

create or replace function app.dept_name(d text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from departments where id = d), 'Unknown department');
$$;

-- append one row to the tamper-evident admin record
create or replace function app.audit(act text, ttype text, tid text, tlabel text, rsn text, m jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare prev text; nm text; t timestamptz := clock_timestamp(); h text;
begin
  perform pg_advisory_xact_lock(7001);
  select hash into prev from audit_log order by seq desc limit 1;
  prev := coalesce(prev, 'genesis');
  select name into nm from profiles where id = auth.uid();
  h := encode(sha256(convert_to(prev || '|' || app.audit_payload(t, auth.uid(), act, ttype, tid, rsn, m), 'UTF8')), 'hex');
  insert into audit_log (ts, admin_id, admin_name, action, target_type, target_id, target_label, reason, meta, prev_hash, hash)
  values (t, auth.uid(), coalesce(nm, 'System'), act, ttype, tid, tlabel, rsn, m, prev, h);
end $$;

create or replace function app.audit_payload(t timestamptz, a uuid, act text, ttype text, tid text, rsn text, m jsonb) returns text
language sql immutable as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || coalesce(a::text, '') || '|' || act || '|' || ttype || '|' || tid || '|' || rsn || '|' || m::text;
$$;

create or replace function app.block_audit_changes() returns trigger language plpgsql as $$
begin raise exception 'The audit log can only be added to, never changed.'; end $$;
drop trigger if exists audit_no_change on public.audit_log;
create trigger audit_no_change before update or delete on public.audit_log for each row execute function app.block_audit_changes();

-- who is calling and may they do this? Raises plain-language errors.
create or replace function app.actor(perm text) returns public.profiles language plpgsql security definer set search_path = public as $$
declare a profiles;
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  select * into a from profiles where id = auth.uid();
  if not found then raise exception 'Your account is not set up yet. Please log in again.'; end if;
  if a.account_status = 'suspended' and a.suspended_until is not null and a.suspended_until < now() then
    update profiles set account_status = 'active', suspended_until = null, account_reason = '' where id = a.id;
    a.account_status := 'active';
  end if;
  if a.account_status = 'banned' then raise exception 'This account has been blocked.'; end if;
  if a.account_status = 'suspended' and perm in ('report.create', 'report.comment', 'report.vote', 'report.flag') then
    raise exception 'Your account is suspended until %. You cannot do this right now.', to_char(a.suspended_until, 'DD Mon YYYY');
  end if;
  if perm in ('report.create', 'report.vote', 'report.flag', 'report.audit') and a.role <> 'citizen' then
    raise exception 'You do not have permission to do this.';
  end if;
  if perm in ('report.work', 'report.comment', 'desk.use') and a.role = 'official' and a.verification_status <> 'approved' then
    raise exception 'Your official access is not approved yet.';
  end if;
  if perm in ('report.work', 'desk.use') and a.role not in ('official', 'admin') then raise exception 'You do not have permission to do this.'; end if;
  if perm like 'admin.%' and a.role <> 'admin' then raise exception 'You do not have permission to do this.'; end if;
  return a;
end $$;

create or replace function app.detect_priority(t text, d text, cat text) returns jsonb language plpgsql immutable as $$
declare txt text := ' ' || lower(coalesce(t, '')) || ' ' || lower(coalesce(d, '')) || ' '; w text;
  words text[] := array['accident','bleeding','collapse','collapsing','collapsed','critical','dead','death','die','drowning','electrocution','electrocuted','emergency',
    'explosion','fatal','fire','flooding','flooded','gas leak','hazard','hospitalized','landslide','life threat','live wire','medical','poison','short circuit','sinkhole',
    'trapped','wound','injured','sparking','earthquake','cyclone'];
begin
  foreach w in array words loop
    if position(w in txt) > 0 then return jsonb_build_object('priority', 'Urgent', 'reason', 'Mentions "' || w || '"'); end if;
  end loop;
  if cat in ('fire', 'flood') then return jsonb_build_object('priority', 'Urgent', 'reason', 'Category is ' || (case when cat = 'fire' then 'fire and safety' else 'flood and waterlogging' end)); end if;
  return jsonb_build_object('priority', 'Routine', 'reason', 'No emergency words found');
end $$;

-- public map: move a point to the centre of a square cell so a home is never pinpointed
create or replace function app.snap_lat(lat double precision, meters int) returns double precision language sql immutable as $$
  select (floor(lat / (meters / 111320.0)) + 0.5) * (meters / 111320.0);
$$;
create or replace function app.snap_lng(lat double precision, lng double precision, meters int) returns double precision language sql immutable as $$
  select (floor(lng / ((meters / 111320.0) / greatest(0.2, cos(radians(app.snap_lat(lat, meters)))))) + 0.5)
         * ((meters / 111320.0) / greatest(0.2, cos(radians(app.snap_lat(lat, meters)))));
$$;

-- ---------- what the public may read ----------
create or replace view public.public_complaints with (security_barrier = true) as
select c.id, c.category, c.title, c.description, c.state, c.district, c.city, c.pincode, c.address,
       c.image_path, c.status, c.priority, c.priority_reason, c.dept_id, c.sla_days, c.sla_start, c.upvote_count,
       c.is_escalated, c.authority_response, c.resolution_path, c.mod_status, c.reopen_count, c.created_at, c.updated_at,
       c.is_anonymous, case when c.is_anonymous then null else c.author_name end as author_name, c.location_privacy,
       case when c.latitude is null or c.location_privacy = 'hidden' then null
            when c.location_privacy = 'exact' then c.latitude
            else app.snap_lat(c.latitude, s.public_grid_meters * (case when c.is_anonymous then 2 else 1 end)) end as latitude,
       case when c.latitude is null or c.location_privacy = 'hidden' then null
            when c.location_privacy = 'exact' then c.longitude
            else app.snap_lng(c.latitude, c.longitude, s.public_grid_meters * (case when c.is_anonymous then 2 else 1 end)) end as longitude
from public.complaints c cross join public.settings s
where s.id = 1 and c.mod_status in ('normal', 'flagged', 'verified');

-- ---------- sign up: the profile is created for you; roles can never be chosen by the browser ----------
create or replace function app.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
        want_off boolean := coalesce(m->>'requested_role', '') = 'official';
        d text := nullif(m->>'dept_id', '');
begin
  if want_off and not exists (select 1 from departments where id = d and active) then want_off := false; end if;
  insert into profiles (id, email, name, phone, state, district, city, pincode, role, designation, dept_id, id_proof, verification_status, verification_submitted)
  values (new.id, new.email,
          left(coalesce(nullif(trim(m->>'name'), ''), split_part(new.email, '@', 1)), 80),
          left(coalesce(m->>'phone', ''), 15), left(coalesce(m->>'state', ''), 60), left(coalesce(m->>'district', ''), 60),
          left(coalesce(m->>'city', ''), 60), left(coalesce(m->>'pincode', ''), 6),
          case when want_off then 'official' else 'citizen' end,
          case when want_off then left(coalesce(m->>'designation', ''), 80) else '' end,
          case when want_off then d end,
          case when want_off then left(coalesce(m->>'id_proof', ''), 600) else '' end,
          case when want_off then 'pending' else 'none' end,
          case when want_off then now() end);
  if want_off then
    insert into verification_history (user_id, status, by_name, note) values (new.id, 'pending', 'applicant', 'Application sent');
    perform app.notify_admins('verification', 'Official ID to check', coalesce(nullif(trim(m->>'name'), ''), new.email) || ' asked for official access.', '#/admin/authorities/' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- keep names in sync if an email changes
create or replace function app.sync_email() returns trigger language plpgsql security definer set search_path = public as $$
begin update profiles set email = new.email where id = new.id; return new; end $$;
drop trigger if exists on_auth_user_email on auth.users;
create trigger on_auth_user_email after update of email on auth.users for each row when (old.email is distinct from new.email) execute function app.sync_email();

-- ONLY the database owner can run this (from the SQL editor). It is how the first admin is created.
create or replace function public.make_admin(user_email text) returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update profiles set role = 'admin', dept_id = null, verification_status = 'none', account_status = 'active' where lower(email) = lower(user_email);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No account with that email. Sign up in the app first, then run this again.'; end if;
  return 'Done. ' || user_email || ' is now an administrator.';
end $$;
revoke all on function public.make_admin(text) from public, anon, authenticated;

-- ---------- my own profile ----------
create or replace function public.update_my_profile(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare a profiles; nm text := trim(coalesce(p->>'name', ''));
begin
  a := app.actor('profile');
  if char_length(nm) < 2 then raise exception 'Enter your name.'; end if;
  if coalesce(p->>'phone', '') <> '' and (p->>'phone') !~ '^[0-9]{10}$' then raise exception 'A mobile number has 10 digits.'; end if;
  if coalesce(p->>'pincode', '') <> '' and (p->>'pincode') !~ '^[0-9]{6}$' then raise exception 'A pincode has 6 digits.'; end if;
  update profiles set name = left(nm, 80), phone = coalesce(p->>'phone', phone), state = left(coalesce(p->>'state', state), 60),
         district = left(coalesce(p->>'district', district), 60), city = left(coalesce(p->>'city', city), 60), pincode = coalesce(p->>'pincode', pincode)
   where id = a.id;
end $$;

-- ---------- reports ----------
create or replace function public.create_complaint(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare a profiles; s settings; cat categories; pr jsonb; did text; lat double precision; lng double precision; cid bigint; recent int;
        img text; ttl text; descr text; anon boolean := coalesce((p->>'is_anonymous')::boolean, false);
begin
  a := app.actor('report.create');
  select * into s from settings where id = 1;
  ttl := trim(coalesce(p->>'title', '')); descr := trim(coalesce(p->>'description', ''));
  if char_length(ttl) < 5 or char_length(ttl) > 90 then raise exception 'Write a short title of at least 5 letters.'; end if;
  if char_length(descr) < 15 or char_length(descr) > 800 then raise exception 'Add a few more words. At least 15 letters, please.'; end if;
  select * into cat from categories where id = p->>'category';
  if not found then raise exception 'Choose the kind of problem.'; end if;
  if trim(coalesce(p->>'state', '')) = '' then raise exception 'Choose your state.'; end if;
  if trim(coalesce(p->>'address', '')) = '' then raise exception 'Tell us the landmark or street.'; end if;
  select count(*) into recent from complaints where citizen_id = a.id and created_at > now() - interval '1 hour';
  if recent >= s.reports_per_hour then
    raise exception 'You have sent % reports in the last hour. Please wait a little before sending another.', recent;
  end if;
  begin lat := nullif(p->>'latitude', '')::double precision; lng := nullif(p->>'longitude', '')::double precision;
  exception when others then lat := null; lng := null; end;
  if lat is not null and lng is not null and not (lat between 6 and 38 and lng between 68 and 98) then
    lat := null; lng := null; perform app.syslog('warn', 'report', 'Ignored GPS coordinates that were not valid');
  end if;
  if lat is null or lng is null then lat := null; lng := null; end if;
  img := nullif(p->>'image_path', '');
  if img is not null and split_part(img, '/', 1) <> a.id::text then raise exception 'That photo does not belong to your account.'; end if;
  pr := app.detect_priority(ttl, descr, cat.id);
  did := coalesce(s.category_dept->>cat.id, cat.dept_id);
  if not exists (select 1 from departments where id = did and active) then did := s.fallback_dept; end if;
  insert into complaints (citizen_id, author_name, is_anonymous, category, title, description, state, district, city, pincode, address,
                          latitude, longitude, image_path, priority, priority_reason, dept_id, sla_days)
  values (a.id, a.name, anon, cat.id, ttl, descr, left(p->>'state', 60), left(coalesce(p->>'district', ''), 60), left(coalesce(p->>'city', ''), 60),
          left(coalesce(p->>'pincode', ''), 6), left(trim(p->>'address'), 160), lat, lng, img, pr->>'priority', pr->>'reason', did,
          case when pr->>'priority' = 'Urgent' then 1 else cat.sla_days end)
  returning id into cid;
  perform app.event(cid, 'Report submitted');
  perform app.notify(a.id, 'received', 'Report received', 'We sent "' || ttl || '" to the ' || app.dept_name(did) || '.', '#/c/' || cid, cid);
  perform app.notify_dept(did, 'new_report', case when pr->>'priority' = 'Urgent' then 'New urgent report' else 'New report for your department' end,
                          '"' || ttl || '" in ' || coalesce(nullif(p->>'city', ''), p->>'state') || '.', '#/c/' || cid, cid);
  return cid;
end $$;

create or replace function public.toggle_upvote(cid bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare a profiles; c complaints; voted boolean; n int;
begin
  a := app.actor('report.vote');
  select * into c from complaints where id = cid;
  if not found or c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'Report not found.'; end if;
  if exists (select 1 from upvotes where user_id = a.id and complaint_id = cid) then
    delete from upvotes where user_id = a.id and complaint_id = cid; voted := false;
  else insert into upvotes (user_id, complaint_id) values (a.id, cid); voted := true; end if;
  select count(*) into n from upvotes where complaint_id = cid;
  update complaints set upvote_count = n where id = cid;
  return jsonb_build_object('voted', voted, 'count', n);
end $$;

create or replace function public.add_comment(cid bigint, body text) returns void language plpgsql security definer set search_path = public as $$
declare a profiles; c complaints; t text := trim(coalesce(body, ''));
begin
  a := app.actor('report.comment');
  if t = '' then raise exception 'Write something first.'; end if;
  select * into c from complaints where id = cid;
  if not found or not app.can_see(cid) then raise exception 'This report is not available.'; end if;
  insert into complaint_comments (complaint_id, user_id, author_name, author_role, text) values (cid, a.id, a.name, a.role, left(t, 600));
  if c.citizen_id <> a.id then
    perform app.notify(c.citizen_id, 'comment', 'New comment on your report', a.name || ' commented on "' || c.title || '".', '#/c/' || cid, cid);
  end if;
end $$;

create or replace function public.flag_complaint(cid bigint, reason_id text, note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare a profiles; c complaints; s settings; used int; first boolean; to_review boolean := false;
        labels jsonb := '{"false_info":"False information","duplicate":"Duplicate report","spam":"Spam","wrong_location":"Wrong location","offensive":"Offensive content","misleading_photo":"Misleading photo","not_civic":"Not a civic issue","other":"Other"}';
begin
  a := app.actor('report.flag');
  select * into s from settings where id = 1;
  select * into c from complaints where id = cid for update;
  if not found then raise exception 'Report not found.'; end if;
  if c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'This report is already being handled by an admin.'; end if;
  if c.citizen_id = a.id then raise exception 'You cannot flag your own report.'; end if;
  if c.mod_status = 'verified' then raise exception 'An admin has already checked this report and found no problem.'; end if;
  if exists (select 1 from flags where user_id = a.id and complaint_id = cid) then raise exception 'You already flagged this report.'; end if;
  if not labels ? reason_id then raise exception 'Choose a reason for the flag.'; end if;
  select count(*) into used from flags where user_id = a.id and ts > now() - interval '1 day';
  if used >= s.flags_per_day then raise exception 'You have used your % flags for today. You can flag again tomorrow.', s.flags_per_day; end if;
  insert into flags (user_id, complaint_id, reason_id, note) values (a.id, cid, reason_id, left(coalesce(note, ''), 200));
  first := c.mod_status = 'normal';
  update complaints set flag_count = flag_count + 1, mod_status = case when mod_status = 'normal' then 'flagged' else mod_status end where id = cid returning * into c;
  if c.flag_count >= s.review_threshold and c.mod_status <> 'under_review' then
    update complaints set mod_status = 'under_review' where id = cid; to_review := true;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, 'System', 'Sent to review', c.flag_count || ' people flagged it. No decision has been made.');
    perform app.notify(c.citizen_id, 'moderation', 'Your report is being checked', 'Other users flagged "' || c.title || '". An admin will review it. No decision has been made.', '#/c/' || cid, cid);
  end if;
  if first or to_review then
    perform app.notify_admins('moderation', case when to_review then 'Report sent to review' else 'A report was flagged' end, '"' || c.title || '" (' || (labels->>reason_id) || ').', '#/admin/r/' || cid, cid);
  end if;
  return jsonb_build_object('count', c.flag_count, 'toReview', to_review);
end $$;

-- ---------- official work ----------
create or replace function app.work_guard(cid bigint) returns public.complaints language plpgsql security definer set search_path = public as $$
declare a profiles; c complaints;
begin
  a := app.actor('report.work');
  select * into c from complaints where id = cid for update;
  if not found then raise exception 'Report not found.'; end if;
  if c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'This report is not part of the active workload. An admin has to clear it first.'; end if;
  if a.role = 'official' and c.dept_id <> a.dept_id then raise exception 'Only the assigned department can do this.'; end if;
  if c.status in ('Resolved', 'Closed') then raise exception 'This report is already resolved.'; end if;
  return c;
end $$;

create or replace function public.start_work(cid bigint) returns void language plpgsql security definer set search_path = public as $$
declare c complaints; a profiles;
begin
  c := app.work_guard(cid); select * into a from profiles where id = auth.uid();
  update complaints set status = 'In progress', assigned_officer = a.id, updated_at = now() where id = cid;
  perform app.event(cid, 'Work started by ' || app.dept_name(c.dept_id) || ' (' || a.name || ')');
  perform app.notify(c.citizen_id, 'started', 'Work has started', app.dept_name(c.dept_id) || ' started work on "' || c.title || '".', '#/c/' || cid, cid);
end $$;

create or replace function public.resolve_complaint(cid bigint, response text, proof_path text) returns void language plpgsql security definer set search_path = public as $$
declare c complaints; a profiles; r text := trim(coalesce(response, ''));
begin
  c := app.work_guard(cid); select * into a from profiles where id = auth.uid();
  if char_length(r) < 10 then raise exception 'Write what was done, at least 10 characters.'; end if;
  if coalesce(proof_path, '') = '' then raise exception 'Add a photo that shows the finished work.'; end if;
  if split_part(proof_path, '/', 1) <> a.id::text then raise exception 'That photo does not belong to your account.'; end if;
  update complaints set status = 'Resolved', authority_response = left(r, 800), resolution_path = proof_path, assigned_officer = a.id,
         audit_state = 'pending', updated_at = now() where id = cid;
  perform app.event(cid, 'Marked resolved by ' || app.dept_name(c.dept_id) || ' (' || a.name || ')');
  perform app.notify(c.citizen_id, 'resolved', 'Your report was resolved', app.dept_name(c.dept_id) || ' marked "' || c.title || '" as fixed. Please check the work and tell us if it is really fixed.', '#/c/' || cid, cid);
end $$;

create or replace function public.transfer_complaint(cid bigint, to_dept text, reason text) returns void language plpgsql security definer set search_path = public as $$
declare c complaints; a profiles; d departments; r text := trim(coalesce(reason, ''));
begin
  c := app.work_guard(cid); select * into a from profiles where id = auth.uid();
  select * into d from departments where id = to_dept and active;
  if not found then raise exception 'Choose a department.'; end if;
  if to_dept = c.dept_id then raise exception 'The report is already with that department.'; end if;
  if char_length(r) < 5 then raise exception 'Say why it is being transferred.'; end if;
  update complaints set dept_id = to_dept, assigned_officer = null, updated_at = now() where id = cid;
  perform app.event(cid, 'Transferred from ' || app.dept_name(c.dept_id) || ' to ' || d.name || '. Reason: ' || left(r, 200));
  perform app.notify(c.citizen_id, 'transferred', 'Report sent to another department', '"' || c.title || '" is now with the ' || d.name || '.', '#/c/' || cid, cid);
  perform app.notify_dept(to_dept, 'transferred', 'A report was transferred to you', '"' || c.title || '" came from ' || app.dept_name(c.dept_id) || '.', '#/c/' || cid, cid);
  if a.role = 'admin' then perform app.audit('report.reassign', 'report', cid::text, 'DL-' || cid || ' ' || c.title, r, jsonb_build_object('from', app.dept_name(c.dept_id), 'to', d.name)); end if;
end $$;

create or replace function public.escalate_complaint(cid bigint, reason text) returns void language plpgsql security definer set search_path = public as $$
declare c complaints; r text := trim(coalesce(reason, ''));
begin
  c := app.work_guard(cid);
  if c.is_escalated then raise exception 'This report is already escalated.'; end if;
  if char_length(r) < 5 then raise exception 'Say why it needs escalation.'; end if;
  update complaints set is_escalated = true, updated_at = now() where id = cid;
  perform app.event(cid, 'Escalated to district administration. Reason: ' || left(r, 200));
  perform app.notify(c.citizen_id, 'escalated', 'Your report was escalated', '"' || c.title || '" was sent to the district administration.', '#/c/' || cid, cid);
  perform app.notify_admins('escalated', 'A report was escalated', '"' || c.title || '"', '#/admin/r/' || cid, cid);
end $$;

-- ---------- the citizen checks the work ----------
create or replace function app.resolved_at(cid bigint) returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce((select max(ts) from complaint_events where complaint_id = cid and label like 'Marked resolved%'), (select updated_at from complaints where id = cid));
$$;

create or replace function app.audit_case(cid bigint) returns public.complaints language plpgsql security definer set search_path = public as $$
declare a profiles; c complaints; s settings;
begin
  a := app.actor('report.audit');
  select * into s from settings where id = 1;
  select * into c from complaints where id = cid for update;
  if not found then raise exception 'Report not found.'; end if;
  if c.citizen_id <> a.id then raise exception 'Only the person who made this report can do this.'; end if;
  if c.mod_status not in ('normal', 'flagged', 'verified') then raise exception 'This report is not active right now.'; end if;
  if c.status <> 'Resolved' or c.audit_state <> 'pending' or app.resolved_at(cid) + make_interval(days => s.audit_days) <= now() then
    raise exception '%', case when c.status = 'Closed' then 'This report is already closed.' when c.status = 'Resolved' then 'The time to reply has ended, so the report was closed.' else 'There is nothing to check on this report right now.' end;
  end if;
  return c;
end $$;

create or replace function public.confirm_fix(cid bigint, rating int, comment text default '') returns void language plpgsql security definer set search_path = public as $$
declare c complaints;
begin
  c := app.audit_case(cid);
  if rating is null or rating < 1 or rating > 5 then raise exception 'Choose a star rating from 1 to 5.'; end if;
  update complaints set audit_state = 'confirmed', audit_rating = rating, audit_comment = left(coalesce(comment, ''), 300), audit_dept = dept_id, audit_at = now(), status = 'Closed', updated_at = now() where id = cid;
  perform app.event(cid, 'Citizen confirmed the fix (' || rating || ' of 5 stars)');
  perform app.notify_dept(c.dept_id, 'confirmed', 'The citizen confirmed the fix', '"' || c.title || '" was rated ' || rating || ' of 5.', '#/c/' || cid, cid);
  perform app.notify(c.citizen_id, 'closed', 'Thank you', '"' || c.title || '" is now closed.', '#/c/' || cid, cid);
end $$;

create or replace function public.dispute_fix(cid bigint, reason_id text, note text, photo_path text default null) returns void language plpgsql security definer set search_path = public as $$
declare c complaints; s settings; a profiles; lbl text; n text := trim(coalesce(note, ''));
begin
  c := app.audit_case(cid); select * into s from settings where id = 1; select * into a from profiles where id = auth.uid();
  lbl := case reason_id when 'still_there' then 'The problem is still there' when 'incomplete' then 'The work is not finished' when 'wrong_place' then 'The wrong place was fixed' when 'other' then 'Something else' end;
  if lbl is null then raise exception 'Choose what is wrong.'; end if;
  if char_length(n) < 5 then raise exception 'Tell the department what is still wrong, at least 5 letters.'; end if;
  if c.reopen_count >= s.max_reopens then
    raise exception 'This report was already reopened % times. An admin has been asked to look at it, so it cannot be reopened again.', c.reopen_count;
  end if;
  if coalesce(photo_path, '') <> '' and split_part(photo_path, '/', 1) <> a.id::text then raise exception 'That photo does not belong to your account.'; end if;
  insert into resolutions (complaint_id, dept_id, officer_id, response, proof_path, resolved_at, disputed_reason, disputed_note)
  values (cid, c.dept_id, c.assigned_officer, c.authority_response, c.resolution_path, app.resolved_at(cid), lbl, left(n, 300));
  insert into disputes (complaint_id, reason_id, reason, note, photo_path) values (cid, reason_id, lbl, left(n, 300), nullif(photo_path, ''));
  update complaints set authority_response = '', resolution_path = null, status = 'Reopened', reopen_count = reopen_count + 1, audit_state = 'disputed',
         audit_at = now(), sla_start = now(), updated_at = now() where id = cid returning * into c;
  perform app.event(cid, 'Citizen reported the problem is still there. Reason: ' || lbl);
  perform app.notify_dept(c.dept_id, 'reopened', 'A report was reopened', '"' || c.title || '": the citizen says it is not fixed (' || lower(lbl) || ').', '#/c/' || cid, cid);
  perform app.notify(c.citizen_id, 'reopened', 'Your report was reopened', 'We asked the ' || app.dept_name(c.dept_id) || ' to look at "' || c.title || '" again.', '#/c/' || cid, cid);
  if c.reopen_count >= s.max_reopens then
    perform app.notify_admins('escalated', 'A report keeps coming back', '"' || c.title || '" was reopened ' || c.reopen_count || ' times.', '#/admin/r/' || cid, cid);
  end if;
end $$;

-- reports nobody answered close by themselves; safe to call any time, any number of times
create or replace function public.sweep_audits() returns int language plpgsql security definer set search_path = public as $$
declare s settings; r record; n int := 0;
begin
  select * into s from settings where id = 1;
  for r in select id, title, citizen_id from complaints where status = 'Resolved' and audit_state = 'pending' and app.resolved_at(id) + make_interval(days => s.audit_days) <= now() for update loop
    update complaints set status = 'Closed', audit_state = 'auto_closed', audit_dept = dept_id, audit_at = now(), updated_at = now() where id = r.id;
    perform app.event(r.id, 'Closed automatically after ' || s.audit_days || ' days without a reply');
    perform app.notify(r.citizen_id, 'closed', 'Your report was closed', '"' || r.title || '" was closed because no one replied within ' || s.audit_days || ' days.', '#/c/' || r.id, r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- moderation (admin only; always a written reason; always audited) ----------
create or replace function public.admin_moderate(cid bigint, action text, reason text, extra jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a profiles; c complaints; o complaints; rsn text := trim(coalesce(reason, '')); ms text; had_flags boolean; lvl text; oc text; oclabel text;
begin
  a := app.actor('admin.moderate');
  select * into c from complaints where id = cid for update;
  if not found then raise exception 'Report not found.'; end if;
  if char_length(rsn) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  ms := c.mod_status; had_flags := c.flag_count > 0;

  if action = 'keep' then
    if ms = 'verified' then raise exception 'This report was already cleared.'; end if;
    if ms in ('rejected', 'archived') then raise exception 'Restore the report first.'; end if;
    update complaints set mod_status = 'verified', mod_outcome = '', mod_reason = rsn, updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Cleared: report is legitimate', rsn);
    if had_flags then insert into mod_history (user_id, type, report_id, reason, by_name) values (c.citizen_id, 'cleared', cid, rsn, a.name); end if;
    if ms = 'under_review' then perform app.notify(c.citizen_id, 'moderation', 'Your report is visible again', 'An admin checked "' || c.title || '" and found no problem.', '#/c/' || cid, cid); end if;
    perform app.audit('report.keep', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn);

  elsif action = 'review' then
    if ms = 'under_review' then raise exception 'This report is already under review.'; end if;
    if ms not in ('normal', 'flagged', 'verified') then raise exception 'Restore the report first.'; end if;
    update complaints set mod_status = 'under_review', mod_reason = rsn, updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Marked under review', rsn);
    perform app.notify(c.citizen_id, 'moderation', 'Your report is being checked', 'An admin is checking "' || c.title || '". No decision has been made.', '#/c/' || cid, cid);
    perform app.audit('report.review', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn);

  elsif action = 'reject' then
    oc := extra->>'outcome';
    oclabel := case oc when 'fake' then 'Fake report' when 'spam' then 'Spam' when 'not_civic' then 'Not a civic issue' when 'other' then 'Other reason' end;
    if oclabel is null then raise exception 'Choose why the report is rejected.'; end if;
    if ms in ('rejected', 'archived') then raise exception 'This report is already closed by moderation.'; end if;
    update complaints set mod_status = 'rejected', mod_outcome = oc, mod_reason = rsn, updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Rejected: ' || oclabel, rsn);
    if oc in ('fake', 'spam') then insert into mod_history (user_id, type, report_id, reason, by_name) values (c.citizen_id, oc, cid, rsn, a.name); end if;
    perform app.notify(c.citizen_id, 'moderation', 'Your report was removed', 'An admin reviewed "' || c.title || '" and removed it (' || lower(oclabel) || '). ' || rsn, '#/c/' || cid, cid);
    perform app.audit('report.reject', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn, jsonb_build_object('outcome', oc));

  elsif action = 'duplicate' then
    select * into o from complaints where id = nullif(regexp_replace(coalesce(extra->>'original', ''), '[^0-9]', '', 'g'), '')::bigint;
    if not found then raise exception 'We could not find the original report. Enter its number, for example 12.'; end if;
    if o.id = cid then raise exception 'A report cannot be a duplicate of itself.'; end if;
    if o.mod_status not in ('normal', 'flagged', 'verified') or o.duplicate_of is not null then raise exception 'Choose an active report as the original.'; end if;
    if ms in ('rejected', 'archived') then raise exception 'This report is already closed by moderation.'; end if;
    update complaints set mod_status = 'rejected', mod_outcome = 'duplicate', duplicate_of = o.id, mod_reason = rsn, updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Marked as duplicate of DL-' || o.id, rsn);
    insert into mod_history (user_id, type, report_id, reason, by_name) values (c.citizen_id, 'duplicate', cid, rsn, a.name);
    perform app.notify(c.citizen_id, 'moderation', 'Your report matches an existing one', '"' || c.title || '" duplicates report DL-' || o.id || '. Please follow that report.', '#/c/' || o.id, o.id);
    perform app.audit('report.duplicate', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn, jsonb_build_object('original', o.id));

  elsif action = 'archive' then
    if ms = 'archived' then raise exception 'This report is already archived.'; end if;
    update complaints set mod_status = 'archived', mod_outcome = '', mod_reason = rsn, updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Archived', rsn);
    perform app.notify(c.citizen_id, 'moderation', 'Your report was archived', '"' || c.title || '" was archived by an admin. ' || rsn, '#/c/' || cid, cid);
    perform app.audit('report.archive', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn);

  elsif action = 'restore' then
    if ms in ('normal', 'flagged', 'verified') then raise exception 'This report is already active.'; end if;
    update mod_history set reversed = true where user_id = c.citizen_id and report_id = cid and not reversed and type in ('fake', 'spam', 'duplicate', 'cleared');
    update complaints set mod_status = 'normal', mod_outcome = '', duplicate_of = null, mod_reason = '', updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Restored', rsn);
    perform app.notify(c.citizen_id, 'moderation', 'Your report was restored', 'An admin restored "' || c.title || '". It is active again.', '#/c/' || cid, cid);
    perform app.audit('report.restore', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn);

  elsif action = 'privacy' then
    lvl := extra->>'level';
    if lvl not in ('approximate', 'hidden', 'exact') then raise exception 'Choose how the location is shown.'; end if;
    if c.location_privacy = lvl then raise exception 'The location is already shown that way.'; end if;
    update complaints set location_privacy = lvl, updated_at = now() where id = cid;
    insert into mod_log (complaint_id, by_name, action, note) values (cid, a.name, 'Map privacy set to "' || lvl || '"', rsn);
    perform app.audit('report.location_privacy', 'report', cid::text, 'DL-' || cid || ' ' || c.title, rsn, jsonb_build_object('from', c.location_privacy, 'to', lvl));
  else
    raise exception 'Unknown action.';
  end if;
end $$;

-- ---------- people (admin) ----------
create or replace function public.admin_user_action(uid uuid, action text, reason text, days int default null, confirm text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a profiles; u profiles; rsn text := trim(coalesce(reason, '')); untilts timestamptz;
begin
  a := app.actor('admin.users');
  select * into u from profiles where id = uid;
  if not found then raise exception 'Account not found.'; end if;
  if u.role = 'admin' then raise exception 'Admin accounts cannot be moderated here.'; end if;
  if u.id = a.id then raise exception 'You cannot do this to your own account.'; end if;
  if char_length(rsn) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  if action = 'warn' then
    insert into mod_history (user_id, type, reason, by_name) values (uid, 'warning', rsn, a.name);
    perform app.notify(uid, 'account', 'You received a warning', 'An admin sent you a warning: ' || rsn, '#/profile');
  elsif action = 'suspend' then
    if days is null or days < 1 or days > 90 then raise exception 'Choose between 1 and 90 days.'; end if;
    if u.account_status = 'banned' then raise exception 'This account is already banned.'; end if;
    untilts := now() + make_interval(days => days);
    update profiles set account_status = 'suspended', suspended_until = untilts, account_reason = rsn where id = uid;
    insert into mod_history (user_id, type, reason, by_name, days) values (uid, 'suspension', rsn, a.name, days);
    perform app.notify(uid, 'account', 'Your account is suspended', 'You cannot post, comment or flag until ' || to_char(untilts, 'DD Mon YYYY') || '. Reason: ' || rsn, '#/profile');
  elsif action = 'ban' then
    if confirm is distinct from 'BAN' then raise exception 'Type BAN to confirm a permanent ban.'; end if;
    update profiles set account_status = 'banned', suspended_until = null, account_reason = rsn where id = uid;
    insert into mod_history (user_id, type, reason, by_name) values (uid, 'ban', rsn, a.name);
  elsif action = 'reinstate' then
    if u.account_status = 'active' then raise exception 'This account is already active.'; end if;
    update profiles set account_status = 'active', suspended_until = null, account_reason = '' where id = uid;
    insert into mod_history (user_id, type, reason, by_name) values (uid, 'reinstated', rsn, a.name);
    perform app.notify(uid, 'account', 'Your account is active again', 'An admin restored your account. ' || rsn, '#/profile');
  else raise exception 'Unknown action.'; end if;
  perform app.audit('user.' || action, 'user', uid::text, u.name, rsn, case when days is null then '{}'::jsonb else jsonb_build_object('days', days) end);
end $$;

create or replace function public.admin_authority_action(uid uuid, action text, note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare a profiles; u profiles; n text := trim(coalesce(note, '')); to_st text; from_ok text[]; ttl text; msg text; need_reason boolean := true;
begin
  a := app.actor('admin.authorities');
  select * into u from profiles where id = uid and role = 'official';
  if not found then raise exception 'Official not found.'; end if;
  case action
    when 'approve'      then to_st := 'approved';       from_ok := array['pending', 'info_requested']; ttl := 'Your official access was approved'; msg := 'You can now open your department desk.'; need_reason := false;
    when 'reject'       then to_st := 'rejected';       from_ok := array['pending', 'info_requested']; ttl := 'Your official access was not approved'; msg := 'Reason:';
    when 'request_info' then to_st := 'info_requested'; from_ok := array['pending'];                   ttl := 'More information needed'; msg := 'The admin asked:';
    when 'suspend'      then to_st := 'suspended';      from_ok := array['approved'];                  ttl := 'Your official access was suspended'; msg := 'Reason:';
    when 'reinstate'    then to_st := 'approved';       from_ok := array['suspended'];                 ttl := 'Your official access was restored'; msg := 'You can use your department desk again.';
    else raise exception 'Unknown action.';
  end case;
  if not (u.verification_status = any (from_ok)) then raise exception 'This is not possible while the status is "%".', replace(u.verification_status, '_', ' '); end if;
  if need_reason and char_length(n) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  if n = '' and action = 'approve' then n := 'ID checked'; end if;
  update profiles set verification_status = to_st, verification_note = n where id = uid;
  insert into verification_history (user_id, status, by_name, note) values (uid, to_st, a.name, n);
  perform app.notify(uid, 'verification', ttl, msg || case when action in ('reject', 'request_info', 'suspend') then ' ' || n else '' end, '#/verification');
  perform app.audit('authority.' || action, 'official', uid::text, u.name || ' (' || app.dept_name(u.dept_id) || ')', n, jsonb_build_object('from', u.verification_status, 'to', to_st));
end $$;

create or replace function public.official_submit_info(body text) returns void language plpgsql security definer set search_path = public as $$
declare a profiles; t text := trim(coalesce(body, ''));
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  select * into a from profiles where id = auth.uid();
  if a.role <> 'official' then raise exception 'Only officials can send verification details.'; end if;
  if a.verification_status not in ('info_requested', 'rejected') then raise exception 'There is nothing to update right now.'; end if;
  if char_length(t) < 5 then raise exception 'Write the details the admin asked for.'; end if;
  insert into verification_info (user_id, text) values (a.id, left(t, 600));
  update profiles set verification_status = 'pending' where id = a.id;
  insert into verification_history (user_id, status, by_name, note) values (a.id, 'pending', 'applicant', 'Sent more information');
  perform app.notify_admins('verification', 'Official sent more information', a.name || ' replied to your request.', '#/admin/authorities/' || a.id);
end $$;

-- ---------- departments and settings (admin) ----------
create or replace function public.admin_save_department(p jsonb) returns text language plpgsql security definer set search_path = public as $$
declare a profiles; d departments; nm text := trim(coalesce(p->>'name', '')); did text := nullif(p->>'id', ''); act boolean := coalesce((p->>'active')::boolean, true);
        role_list text[]; rsn text := coalesce(nullif(p->>'reason', ''), 'Department edited'); s settings;
begin
  a := app.actor('admin.departments'); select * into s from settings where id = 1;
  if char_length(nm) < 3 then raise exception 'Give the department a name of at least 3 letters.'; end if;
  if exists (select 1 from departments where lower(name) = lower(nm) and id is distinct from did) then raise exception 'A department with this name already exists.'; end if;
  select coalesce(array_agg(trim(x)) filter (where trim(x) <> ''), '{}') into role_list from jsonb_array_elements_text(coalesce(p->'roles', '[]'::jsonb)) x;
  if did is not null then
    select * into d from departments where id = did;
    if not found then raise exception 'Department not found.'; end if;
    if not act and did = s.fallback_dept then raise exception 'This is the fallback department for unrouted reports, so it must stay active.'; end if;
    if not act and d.active and (select count(*) from departments where active) <= 1 then raise exception 'At least one department must stay active.'; end if;
    update departments set name = nm, description = left(coalesce(p->>'description', ''), 300), active = act, roles = role_list where id = did;
    perform app.audit('department.update', 'department', did, nm, rsn, jsonb_build_object('before', jsonb_build_object('name', d.name, 'active', d.active), 'after', jsonb_build_object('name', nm, 'active', act)));
  else
    did := trim(both '-' from regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g'));
    if did = '' or exists (select 1 from departments where id = did) then did := did || '-' || (select count(*) from departments); end if;
    insert into departments (id, name, description, active, roles) values (did, nm, left(coalesce(p->>'description', ''), 300), act, role_list);
    perform app.audit('department.create', 'department', did, nm, coalesce(nullif(p->>'reason', ''), 'Department added'));
  end if;
  return did;
end $$;

create or replace function public.admin_set_routing(cat_id text, dept text) returns void language plpgsql security definer set search_path = public as $$
declare a profiles; c categories; d departments;
begin
  a := app.actor('admin.departments');
  select * into d from departments where id = dept and active;
  if not found then raise exception 'Choose an active department.'; end if;
  select * into c from categories where id = cat_id;
  if not found then raise exception 'Unknown category.'; end if;
  update settings set category_dept = category_dept || jsonb_build_object(cat_id, dept) where id = 1;
  perform app.audit('department.routing', 'category', cat_id, c.name, 'New reports of this type now go to ' || d.name, jsonb_build_object('dept', d.name));
end $$;

create or replace function public.admin_save_settings(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare a profiles; s settings; rt int; fd int; rh int; ad int; mr int; gm int; lvl text; tiles boolean;
begin
  a := app.actor('admin.settings'); select * into s from settings where id = 1;
  rt := coalesce((p->>'reviewThreshold')::int, s.review_threshold); fd := coalesce((p->>'flagsPerDay')::int, s.flags_per_day);
  rh := coalesce((p->>'reportsPerHour')::int, s.reports_per_hour); ad := coalesce((p->>'auditDays')::int, s.audit_days);
  mr := coalesce((p->>'maxReopens')::int, s.max_reopens); gm := coalesce((p->>'publicGridMeters')::int, s.public_grid_meters);
  lvl := coalesce(p->>'areaLevel', s.area_level); tiles := coalesce((p->>'mapTiles')::boolean, s.map_tiles);
  if rt not between 2 and 20 then raise exception 'Flags needed for review must be a whole number from 2 to 20.'; end if;
  if fd not between 1 and 20 then raise exception 'Flags per person per day must be a whole number from 1 to 20.'; end if;
  if rh not between 1 and 20 then raise exception 'Reports per person per hour must be a whole number from 1 to 20.'; end if;
  if ad not between 1 and 30 then raise exception 'Days a citizen has to check the work must be a whole number from 1 to 30.'; end if;
  if mr not between 1 and 5 then raise exception 'Times a report can be reopened must be a whole number from 1 to 5.'; end if;
  if gm not in (250, 500, 1000) then raise exception 'Choose how precise the public map is.'; end if;
  if lvl not in ('state', 'district', 'city') then raise exception 'Choose how areas are grouped.'; end if;
  update settings set review_threshold = rt, flags_per_day = fd, reports_per_hour = rh, audit_days = ad, max_reopens = mr, public_grid_meters = gm, area_level = lvl, map_tiles = tiles where id = 1;
  perform app.audit('settings.update', 'settings', 'limits', 'Moderation limits', 'Settings changed',
    jsonb_build_object('before', to_jsonb(s) - 'category_dept', 'after', jsonb_build_object('reviewThreshold', rt, 'flagsPerDay', fd, 'reportsPerHour', rh, 'auditDays', ad, 'maxReopens', mr, 'publicGridMeters', gm, 'areaLevel', lvl, 'mapTiles', tiles)));
end $$;

-- ---------- notifications and logs ----------
create or replace function public.mark_notifications_read(ids bigint[] default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  update notifications set is_read = true where user_id = auth.uid() and (ids is null or id = any (ids));
end $$;

create or replace function public.log_system(lvl text, area text, msg text) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if (select count(*) from system_log where ts > now() - interval '1 minute') > 200 then return; end if;
  insert into system_log (level, area, message) values (case when lvl in ('info', 'warn', 'error') then lvl else 'info' end, left(coalesce(area, ''), 40), left(coalesce(msg, ''), 300));
end $$;

create or replace function public.verify_audit() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; prev text := 'genesis'; n int := 0; h text;
begin
  perform app.actor('admin.logs');
  for r in select * from audit_log order by seq loop
    h := encode(sha256(convert_to(prev || '|' || app.audit_payload(r.ts, r.admin_id, r.action, r.target_type, r.target_id, r.reason, r.meta), 'UTF8')), 'hex');
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> h then return jsonb_build_object('ok', false, 'count', n, 'brokenAt', r.seq); end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- ---------- real-time pings: "something changed", no private data ----------
create or replace function app.ping() returns trigger language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  rid := (to_jsonb(new) ->> (case tg_table_name when 'complaints' then 'id' else 'complaint_id' end))::bigint;
  insert into pings (kind, report_id) values (tg_table_name, rid);
  if random() < 0.02 then delete from pings where ts < now() - interval '1 hour'; end if;
  return null;
end $$;
drop trigger if exists ping_complaints on public.complaints;
create trigger ping_complaints after insert or update on public.complaints for each row execute function app.ping();
drop trigger if exists ping_comments on public.complaint_comments;
create trigger ping_comments after insert on public.complaint_comments for each row execute function app.ping();
drop trigger if exists ping_events on public.complaint_events;
create trigger ping_events after insert on public.complaint_events for each row execute function app.ping();

-- lets the app tell a first-time visitor whether an administrator exists yet (answers only yes or no)
create or replace function public.has_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where role = 'admin');
$$;
