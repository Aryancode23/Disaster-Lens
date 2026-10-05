// Uses the REAL supabase-js library (the same file the website ships) against a local recorder, to check the exact requests my code makes.
const http=require('http'); const {createClient}=require('@supabase/supabase-js');
const seen=[];
const srv=http.createServer((req,res)=>{ let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
  seen.push({m:req.method,u:req.url.split('?')[0],q:req.url.split('?')[1]||'',h:{auth:(req.headers.authorization||'').slice(0,12),apikey:(req.headers.apikey||'').slice(0,10)},b:b.slice(0,200)});
  res.setHeader('content-type','application/json');
  if(req.url.startsWith('/auth/v1/signup')) return res.end(JSON.stringify({id:'u1',email:'a@x.org',identities:[{}],user_metadata:{}}));
  if(req.url.startsWith('/auth/v1/token')) return res.end(JSON.stringify({access_token:'h.eyJzdWIiOiJ1MSIsImV4cCI6OTk5OTk5OTk5OX0.s',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:9999999999,user:{id:'u1',email:'a@x.org'}}));
  if(req.url.startsWith('/auth/v1/recover')) return res.end('{}');
  if(req.url.startsWith('/rest/v1/rpc/get_snapshot')) return res.end(JSON.stringify({complaints:[],me:null}));
  if(req.url.startsWith('/rest/v1/rpc/')) return res.end('null');
  if(req.url.startsWith('/storage/v1/object/sign/')) return res.end(JSON.stringify([{path:'u/u1/x.jpg',signedURL:'/object/sign/report-images/u/u1/x.jpg?token=t',error:null}]));
  if(req.url.startsWith('/storage/v1/object/')) return res.end(JSON.stringify({Key:'report-images/u/u1/x.jpg'}));
  res.statusCode=404; res.end('{}'); }); });
srv.listen(8791,async()=>{
  const sb=createClient('http://127.0.0.1:8791','eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce'}});
  const out={};
  out.signUp=await sb.auth.signUp({email:'a@x.org',password:'Password123',options:{data:{name:'A',role:'citizen'},emailRedirectTo:'http://site/'}});
  out.signIn=await sb.auth.signInWithPassword({email:'a@x.org',password:'Password123'});
  out.snap=await sb.rpc('get_snapshot');
  out.named=await sb.rpc('flag_report',{rid:7,reason:'spam',note:''});
  out.jsonArg=await sb.rpc('create_report',{p:{title:'x',latitude:26.8}});
  out.arr=await sb.rpc('mark_read',{ids:['a','b']});
  out.reset=await sb.auth.resetPasswordForEmail('a@x.org',{redirectTo:'http://site/'});
  out.up=await sb.storage.from('report-images').upload('u/u1/x.jpg',new Blob(['abc'],{type:'image/jpeg'}),{contentType:'image/jpeg',upsert:false,cacheControl:'3600'});
  out.sign=await sb.storage.from('report-images').createSignedUrls(['u/u1/x.jpg'],3600);
  const find=(p)=>seen.find(s=>s.u.includes(p));
  const rows=[
   ['sign-up goes to /auth/v1/signup with the profile fields in user metadata', !!find('/auth/v1/signup') && /"name":"A"/.test(find('/auth/v1/signup').b)],
   ['sign-in goes to /auth/v1/token?grant_type=password', !!seen.find(s=>s.u==='/auth/v1/token'&&/grant_type=password/.test(s.q))],
   ['sign-up and sign-in succeed and return a session', !out.signUp.error && !!out.signIn.data.session],
   ['rpc uses POST /rest/v1/rpc/<name> with the public key', seen.filter(s=>s.u.includes('/rest/v1/rpc/')).every(s=>s.m==='POST'&&s.h.apikey.startsWith('eyJ'))],
   ['rpc sends NAMED arguments exactly as the SQL expects', /"rid":7/.test(seen.find(s=>s.u.endsWith('/flag_report')).b) && /"reason":"spam"/.test(seen.find(s=>s.u.endsWith('/flag_report')).b)],
   ['a json argument and an array argument arrive intact', /"p":\{"title":"x"/.test(seen.find(s=>s.u.endsWith('/create_report')).b) && /"ids":\["a","b"\]/.test(seen.find(s=>s.u.endsWith('/mark_read')).b)],
   ['a void function (null body) returns data null, no error', out.named.error===null && out.named.data===null],
   ['password reset hits /auth/v1/recover', !!find('/auth/v1/recover') && !out.reset.error],
   ['photo upload goes to /storage/v1/object/report-images/<path>', !!seen.find(s=>s.m==='POST'&&s.u==='/storage/v1/object/report-images/u/u1/x.jpg') && !out.up.error],
   ['signed links are requested in one batch call', !!find('/storage/v1/object/sign/report-images') && Array.isArray(out.sign.data) && out.sign.data[0].signedUrl.includes('token=')],
   ['logged-in calls carry the user token (bearer)', seen.filter(s=>s.u.includes('/rest/v1/rpc/')&&s.u.endsWith('flag_report')).every(s=>s.h.auth.startsWith('Bearer h.'))],
  ];
  let bad=0; rows.forEach(([n,c])=>{ console.log((c?'PASS ':'FAIL ')+n); if(!c)bad++; });
  console.log(`\n${rows.length-bad}/${rows.length} passed`); srv.close(); process.exit(bad?1:0);
});
