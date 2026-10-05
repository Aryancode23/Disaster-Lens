const {PGlite}=require('@electric-sql/pglite'); const fs=require('fs');
async function make(){
  const db=new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
   create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
   grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
   create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
   alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated; grant select, insert on storage.objects to anon, authenticated;`);
  await db.exec(fs.readFileSync(process.argv[2]||'/mnt/user-data/outputs/disaster-lens/supabase/schema.sql','utf8'));
  return db;
}
module.exports={make};
if(require.main===module) make().then(()=>console.log('schema loaded OK')).catch(e=>{console.log('ERR',e.message, e.position||'', (e.detail||''));process.exit(1)});
