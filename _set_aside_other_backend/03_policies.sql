-- =====================================================================
-- Disaster Lens – access rules (Phase 6). Run after 02_functions.sql.
-- Turns on Row Level Security everywhere and says who may READ what.
-- Nobody gets insert / update / delete on any table: changes go through the functions.
-- =====================================================================

-- start from nothing, then grant only what is needed
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter table public.departments          enable row level security;
alter table public.categories           enable row level security;
alter table public.settings             enable row level security;
alter table public.profiles             enable row level security;
alter table public.verification_history enable row level security;
alter table public.verification_info    enable row level security;
alter table public.mod_history          enable row level security;
alter table public.complaints           enable row level security;
alter table public.complaint_events     enable row level security;
alter table public.complaint_comments   enable row level security;
alter table public.upvotes              enable row level security;
alter table public.flags                enable row level security;
alter table public.resolutions          enable row level security;
alter table public.disputes             enable row level security;
alter table public.mod_log              enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_log            enable row level security;
alter table public.system_log           enable row level security;
alter table public.pings                enable row level security;

-- reference data: everyone may read
grant select on public.departments, public.categories, public.settings, public.pings to anon, authenticated;
drop policy if exists ref_read_departments on public.departments;
create policy ref_read_departments on public.departments for select using (true);
drop policy if exists ref_read_categories on public.categories;
create policy ref_read_categories on public.categories for select using (true);
drop policy if exists ref_read_settings on public.settings;
create policy ref_read_settings on public.settings for select using (true);
drop policy if exists ref_read_pings on public.pings;
create policy ref_read_pings on public.pings for select using (true);

-- the public report list (private fields are not in this view)
grant select on public.public_complaints to anon, authenticated;

-- people
grant select on public.profiles, public.verification_history, public.verification_info to authenticated;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or app.is_admin());
drop policy if exists verif_hist_read on public.verification_history;
create policy verif_hist_read on public.verification_history for select to authenticated using (user_id = auth.uid() or app.is_admin());
drop policy if exists verif_info_read on public.verification_info;
create policy verif_info_read on public.verification_info for select to authenticated using (user_id = auth.uid() or app.is_admin());

grant select on public.mod_history, public.audit_log, public.system_log, public.flags, public.mod_log to authenticated;
drop policy if exists mod_history_read on public.mod_history;
create policy mod_history_read on public.mod_history for select to authenticated using (app.is_admin());
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (app.is_admin());
drop policy if exists syslog_read on public.system_log;
create policy syslog_read on public.system_log for select to authenticated using (app.is_admin());
drop policy if exists flags_read on public.flags;
create policy flags_read on public.flags for select to authenticated using (user_id = auth.uid() or app.is_admin());
drop policy if exists modlog_read on public.mod_log;
create policy modlog_read on public.mod_log for select to authenticated using (app.is_admin());

-- reports: the full row (reporter, exact coordinates) only for the owner, an admin, or the department's approved officials
grant select on public.complaints to authenticated;
drop policy if exists complaints_read on public.complaints;
create policy complaints_read on public.complaints for select to authenticated
  using (citizen_id = auth.uid() or app.is_admin()
         or (app.is_approved_official() and dept_id = app.my_dept() and mod_status in ('normal', 'flagged', 'verified')));

-- things attached to a report
grant select on public.complaint_events, public.complaint_comments to anon, authenticated;
drop policy if exists events_read on public.complaint_events;
create policy events_read on public.complaint_events for select using (app.can_see(complaint_id));
drop policy if exists comments_read on public.complaint_comments;
create policy comments_read on public.complaint_comments for select using (app.can_see(complaint_id));

grant select on public.resolutions, public.disputes, public.upvotes, public.notifications to authenticated;
drop policy if exists resolutions_read on public.resolutions;
create policy resolutions_read on public.resolutions for select to authenticated using (app.can_see_private(complaint_id));
drop policy if exists disputes_read on public.disputes;
create policy disputes_read on public.disputes for select to authenticated using (app.can_see_private(complaint_id));
drop policy if exists upvotes_read on public.upvotes;
create policy upvotes_read on public.upvotes for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());

-- the only functions the browser may call
grant execute on function public.has_admin() to anon, authenticated;
grant execute on function
  public.update_my_profile(jsonb), public.create_complaint(jsonb), public.toggle_upvote(bigint), public.add_comment(bigint, text),
  public.flag_complaint(bigint, text, text), public.start_work(bigint), public.resolve_complaint(bigint, text, text),
  public.transfer_complaint(bigint, text, text), public.escalate_complaint(bigint, text), public.confirm_fix(bigint, int, text),
  public.dispute_fix(bigint, text, text, text), public.sweep_audits(), public.admin_moderate(bigint, text, text, jsonb),
  public.admin_user_action(uuid, text, text, int, text), public.admin_authority_action(uuid, text, text), public.official_submit_info(text),
  public.admin_save_department(jsonb), public.admin_set_routing(text, text), public.admin_save_settings(jsonb),
  public.mark_notifications_read(bigint[]), public.log_system(text, text, text), public.verify_audit()
  to authenticated;

-- make_admin is NOT granted to anyone: only the database owner (SQL editor) can run it.

-- real time: tell browsers when something changed (pings carry no private data; notifications are filtered to their owner)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.pings; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  end if;
end $$;
