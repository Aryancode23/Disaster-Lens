-- =====================================================================
-- Disaster Lens – photo storage (Phase 6). Run last.
-- One bucket for report photos, resolution photos and re-open photos.
--   * only logged-in people can upload, and only into a folder named after their own user id
--   * only JPEG / PNG / WebP, at most 3 MB each (the app also shrinks photos and strips location data)
--   * file names are random, so a photo can only be opened by someone who was given its link
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "photos upload own folder" on storage.objects;
create policy "photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos delete own" on storage.objects;
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos read" on storage.objects;
create policy "photos read" on storage.objects for select using (bucket_id = 'report-photos');
