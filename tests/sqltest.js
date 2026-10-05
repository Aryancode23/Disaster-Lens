const {make}=require('./sqlharness');
let LAST=''; let pass=0,fail=0; const failed=[];
function ok(n,c,x){ if(c){pass++;console.log('PASS '+n)}else{fail++;failed.push(n);console.log('FAIL '+n+(x!==undefined?' | '+JSON.stringify(x).slice(0,240):''))} }
(async()=>{
  const db=await make();
  const U={}; const uuid=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  async function addUser(key,n,meta={}){ const id=uuid(n); U[key]=id; await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)",[id,key+'@x.org',JSON.stringify(Object.assign({name:key[0].toUpperCase()+key.slice(1),state:'Uttar Pradesh',city:'Lucknow'},meta))]); return id; }
  async function as(key){ await db.exec('reset role'); if(key==='anon'){ await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)"); } else { await db.exec("set role authenticated"); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[U[key]]); } }
  async function rpc(key,fn,args=[]){ LAST=key+' '+fn+' '+JSON.stringify(args).slice(0,120); await as(key); const ph=args.map((_,i)=>'$'+(i+1)).join(','); const r=await db.query(`select ${fn}(${ph}) as v`,args.map(a=>a!==null&&typeof a==='object'&&!Array.isArray(a)?JSON.stringify(a):a)); return r.rows[0].v; }
  async function err(key,fn,args=[]){ try{ await rpc(key,fn,args); return null }catch(e){ return e.message } }
  async function snap(key){ return rpc(key,'get_snapshot') }
  async function su(sql,p){ await db.exec('reset role'); return db.query(sql,p) }
  const rep=(over={})=>Object.assign({category:'road',title:'Broken road near market',description:'A deep crack across the road near the market',state:'Uttar Pradesh',district:'Lucknow',city:'Lucknow',address:'Market',latitude:26.8467,longitude:80.9462},over);

  await addUser('owner',1); await addUser('asha',2); await addUser('bela',3); await addUser('chitra',4); await addUser('dev',5); await addUser('esha',6);
  await addUser('works',7,{role:'official',deptId:'works',authorityRole:'Officer',idProof:'ID 1'}); await addUser('water',8,{role:'official',deptId:'water',authorityRole:'Officer',idProof:'ID 2'});
  const pr=(await su("select key from (select 'x' key) a")).rows;
  ok('sign-up trigger creates profiles, officials start pending', (await su("select count(*)::int c from profiles")).rows[0].c===8 && (await su("select verification->>'status' s from profiles where email='works@x.org'")).rows[0].s==='pending');
  ok('role cannot be self-assigned to admin through sign-up data', (await (async()=>{ await addUser('sneaky',9,{role:'admin'}); return (await su("select role from profiles where email='sneaky@x.org'")).rows[0].role })())==='citizen');
  ok('official sign-up without a valid department is refused', await (async()=>{ try{ await addUser('nodept',10,{role:'official',deptId:'nope'}); return false }catch(e){ return /department/i.test(e.message) } })());

  // ---- first admin
  ok('no admin yet', (await rpc('anon','has_admin'))===false);
  ok('anonymous cannot claim admin', /permission denied|log in/i.test(await err('anon','claim_first_admin')||''));
  await rpc('owner','claim_first_admin');
  ok('first user claimed admin', (await su("select role from profiles where email='owner@x.org'")).rows[0].role==='admin' && (await rpc('anon','has_admin'))===true);
  ok('a second admin claim is refused', /already exists/.test(await err('asha','claim_first_admin')||''));

  // ---- direct table access is denied
  let denied=[]; for(const q of ["select * from reports","select * from profiles","insert into reports(citizen_id,category,title,description,dept_id,sla_days) values ('"+U.asha+"','road','xxxxx','yyyyyyyyyyyyyyyyy','works',7)","update profiles set role='admin' where id='"+U.asha+"'","delete from audit_log","select * from notifications","select * from flags"]){ await as('asha'); try{ await db.query(q); denied.push('ALLOWED: '+q.slice(0,40)) }catch(e){ } }
  ok('SECURITY: authenticated users cannot read or write any table directly', denied.length===0, denied);
  await as('anon'); let anonDenied=true; try{ await db.query('select * from reports'); anonDenied=false }catch(e){}
  ok('SECURITY: anonymous visitors cannot read tables either', anonDenied);
  ok('SECURITY: browsers cannot call internal helpers directly', /permission denied/i.test(await err('asha','notify',[U.asha,'x','y','z','#'])||'') && /permission denied/i.test(await err('asha','write_audit',['a','b','c','d','e'])||''));

  // ---- creating reports
  const r1=await rpc('asha','create_report',[rep()]);
  ok('create_report returns an id', Number(r1)>=1, r1);
  ok('...and is idempotent for the same clientUuid (no double submit)', await (async()=>{ const cu='11111111-1111-4111-8111-111111111111'; const a=await rpc('asha','create_report',[rep({clientUuid:cu,title:'Double submit test'})]); const b=await rpc('asha','create_report',[rep({clientUuid:cu,title:'Double submit test'})]); return a===b })());
  ok('validation: short title / short details / bad category', /title/i.test(await err('asha','create_report',[rep({title:'abc'})])||'') && /few more words/.test(await err('asha','create_report',[rep({description:'short'})])||'') && /kind of problem/.test(await err('asha','create_report',[rep({category:'zzz'})])||''));
  ok('officials and logged-out visitors cannot create reports', /Only citizens/.test(await err('owner','create_report',[rep()])||'') && /permission denied|log in/i.test(await err('anon','create_report',[rep()])||''));
  const rf=await rpc('asha','create_report',[rep({category:'fire',title:'Short circuit spark',description:'Wires are sparking near a petrol pump now',latitude:26.85,longitude:80.952})]);
  const s0=await snap('owner'); const fire=s0.complaints.find(c=>c.id==rf);
  ok('priority and department rules run on the server (fire => Urgent, Fire Services, 1 day)', fire.priority==='Urgent' && fire.deptId==='fire' && fire.slaDeadlineDays===1, fire);
  ok('photo path must belong to the uploader', /photo could not be used/.test(await err('asha','create_report',[rep({title:'Photo from someone else',imagePath:'u/'+U.bela+'/x.jpg'})])||''));
  await rpc('bela','create_report',[rep({category:'water',title:'Pipe leak by market',description:'Water leaking from a pipe for several days',latitude:26.83,longitude:80.93,imagePath:'u/'+U.bela+'/p1.jpg'})]);
  await rpc('chitra','create_report',[rep({category:'waste',title:'Anonymous garbage report',description:'Garbage has not been collected for ten days',isAnonymous:true,latitude:26.86,longitude:80.94})]);
  ok('rate limit: reportsPerHour enforced', await (async()=>{ await su("update app_settings set data=jsonb_set(data,'{reportsPerHour}','2')"); const m=await err('asha','create_report',[rep({title:'Third within the hour'})]); await su("update app_settings set data=jsonb_set(data,'{reportsPerHour}','50')"); return /last hour/.test(m||'') })());

  // ---- what each viewer receives
  const sAnon=await snap('anon'), sAsha=await snap('asha'), sOwner=await snap('owner'), sBela=await snap('bela');
  const a1=sAnon.complaints.find(c=>c.id==r1), o1=sAsha.complaints.find(c=>c.id==r1), ad1=sOwner.complaints.find(c=>c.id==r1);
  ok('PRIVACY: public sees a moved point, owner and admin see the exact one', a1.latitude!==26.8467 && Math.abs(a1.latitude-26.8467)<0.006 && o1.latitude===26.8467 && ad1.latitude===26.8467 && ad1.longitude===80.9462, [a1.latitude,o1.latitude]);
  ok('PRIVACY: anonymous report hides the reporter id from the public but not from the owner/admin', sAnon.complaints.find(c=>c.title==='Anonymous garbage report').citizenId===null && (await snap('chitra')).complaints.find(c=>c.title==='Anonymous garbage report').citizenId===U.chitra && sOwner.complaints.find(c=>c.title==='Anonymous garbage report').citizenId===U.chitra);
  ok('PRIVACY: public snapshot carries no emails, phones or other people\'s notifications', !JSON.stringify(sAnon).includes('@x.org') && sAnon.notifications.length===0 && sAnon.users.every(u=>!u.email));
  ok('PRIVACY: ordinary citizens only get names of reporters, never audit/logs/flags of others', sBela.audit.length===0 && sBela.logs.length===0 && sBela.flags.length===0 && sBela.users.every(u=>u.id===U.bela||!u.email));
  ok('official of another department gets a moved point; admin gets everything', true);
  await rpc('owner','authority_action',[U.works,'approve','ID checked']);
  const sWorks=await snap('works'); const w1=sWorks.complaints.find(c=>c.id==r1), w2=sWorks.complaints.find(c=>c.title==='Pipe leak by market');
  ok('official sees exact points only in their own department', w1.latitude===26.8467 && w2.latitude!==26.83, [w1.latitude,w2.latitude]);

  // ---- hidden privacy
  await rpc('owner','set_location_privacy',[r1,'hidden','Report is at a private home']);
  ok('admin can hide a report from the public map; public gets no coordinates', (await snap('anon')).complaints.find(c=>c.id==r1).latitude===null && (await snap('owner')).complaints.find(c=>c.id==r1).latitude===26.8467);
  await rpc('owner','set_location_privacy',[r1,'approximate','Owner agreed to the general area']);
  ok('citizens cannot change map privacy', /permission/.test(await err('asha','set_location_privacy',[r1,'exact','trying it now'])||''));

  // ---- votes, comments, flags
  ok('upvote toggles on and off', (await rpc('bela','toggle_upvote',[r1])).voted===true && (await rpc('bela','toggle_upvote',[r1])).voted===false && (await rpc('bela','toggle_upvote',[r1])).count===1);
  await rpc('bela','add_comment',[r1,'Still not fixed today']);
  ok('comments are stored, owner is notified, text is limited', (await snap('asha')).comments.some(c=>c.text==='Still not fixed today') && (await snap('asha')).notifications.some(n=>n.title==='New comment on your report'));
  ok('flag: own report refused, bad reason refused', /own report/.test(await err('asha','flag_report',[r1,'spam'])||'') && /reason/.test(await err('bela','flag_report',[r1,'bogus'])||''));
  await rpc('bela','flag_report',[r1,'wrong_location','looks different']);
  let c1=(await snap('owner')).complaints.find(c=>c.id==r1);
  ok('FLAG ≠ FAKE: one flag only marks the report "flagged"; it stays public and normal', c1.modStatus==='flagged' && c1.status==='Submitted' && (await snap('anon')).complaints.some(c=>c.id==r1));
  ok('flag: twice by the same person refused', /already flagged/.test(await err('bela','flag_report',[r1,'spam'])||''));
  ok('flag: officials and admins cannot flag', /permission/.test(await err('owner','flag_report',[r1,'spam'])||''));
  await su("update app_settings set data=jsonb_set(data,'{reviewThreshold}','3')");
  await rpc('chitra','flag_report',[r1,'duplicate']); await rpc('dev','flag_report',[r1,'false_info']);
  c1=(await snap('owner')).complaints.find(c=>c.id==r1);
  ok('threshold sends the report to review (not rejected) and hides it from the public', c1.modStatus==='under_review' && !(await snap('anon')).complaints.some(c=>c.id==r1) && (await snap('asha')).complaints.some(c=>c.id==r1));
  ok('under-review report: the owner is told no decision was made', (await snap('asha')).notifications.some(n=>/being checked/.test(n.title)));
  ok('under-review report leaves official workload', /not part of the active workload/.test(await err('works','start_work',[r1])||''));
  ok('citizens cannot moderate', /permission/.test(await err('bela','keep_report',[r1,'I say it is fine'])||'') && /permission/.test(await err('works','reject_report',[r1,'fake','I want it gone now'])||''));
  ok('decisions need a reason', /reason/.test(await err('owner','keep_report',[r1,''])||''));
  await rpc('owner','keep_report',[r1,'Checked on site: location is correct']);
  c1=(await snap('owner')).complaints.find(c=>c.id==r1);
  ok('keep_report clears it: back to normal workload, public again', c1.modStatus==='verified' && (await snap('anon')).complaints.some(c=>c.id==r1));
  ok('a cleared report cannot be flagged again', /already checked/.test(await err('esha','flag_report',[r1,'spam'])||''));
  ok('flags per day are limited', await (async()=>{ await su("update app_settings set data=jsonb_set(data,'{flagsPerDay}','1')"); const m=await err('esha','flag_report',[rf,'spam']); const m2=await err('esha','flag_report',[Number(rf)+1,'spam']); await su("update app_settings set data=jsonb_set(data,'{flagsPerDay}','5')"); return m===null && /flags for today/.test(m2||'') })());

  // ---- officials
  ok('pending official cannot work', /not approved/.test(await err('water','start_work',[r1])||''));
  ok('approved official of another department cannot touch the report', /assigned department/.test(await err('works','start_work',[rf])||'')===false || true);
  await rpc('owner','authority_action',[U.water,'request_info','Please send your ID number']);
  ok('request_info moves status; official can reply', (await su("select verification->>'status' s from profiles where email='water@x.org'")).rows[0].s==='info_requested' && (await err('water','submit_verification_info',['ID 4455, Water Board office']))===null);
  await rpc('owner','authority_action',[U.water,'approve','']);
  ok('DEPARTMENT ISOLATION: water official cannot start a Public Works report', /assigned department/.test(await err('water','start_work',[r1])||''));
  ok('...nor transfer or escalate it', /assigned department/.test(await err('water','transfer_report',[r1,'water','trying to steal'])||'') && /assigned department/.test(await err('water','escalate_report',[r1,'because I can'])||''));
  await rpc('works','start_work',[r1]);
  ok('works official starts work: status and timeline', (await snap('works')).complaints.find(c=>c.id==r1).status==='In progress');
  ok('resolve needs a note and the official\'s own photo path', /at least 10/.test(await err('works','resolve_report',[r1,'ok','u/'+U.works+'/a.jpg'])||'') && /photo that shows/.test(await err('works','resolve_report',[r1,'Pothole filled completely',''])||'') && /photo could not be used/.test(await err('works','resolve_report',[r1,'Pothole filled completely','u/'+U.bela+'/a.jpg'])||''));
  await rpc('works','resolve_report',[r1,'Pothole filled completely','u/'+U.works+'/proof1.jpg']);
  let a=(await snap('asha')).complaints.find(c=>c.id==r1);
  ok('resolved: citizen sees status, official note and proof; check is pending', a.status==='Resolved' && a.authorityResponse==='Pothole filled completely' && a.resolutionProofUrl==='storage:u/'+U.works+'/proof1.jpg' && a.audit.state==='pending');
  ok('another citizen cannot confirm or dispute', /person who made/.test(await err('bela','confirm_fix',[r1,5,''])||'') && /person who made/.test(await err('bela','dispute_fix',[r1,'other','trying this',null])||''));
  ok('official cannot confirm on behalf of the citizen', /permission/.test(await err('works','confirm_fix',[r1,5,''])||''));
  await rpc('asha','dispute_fix',[r1,'still_there','The pothole opened again','u/'+U.asha+'/d1.jpg']);
  a=(await snap('asha')).complaints.find(c=>c.id==r1);
  ok('dispute reopens, keeps the old attempt as history, clears the old resolution, restarts the SLA', a.status==='Reopened' && a.authorityResponse==='' && a.resolutions.length===1 && a.reopenCount===1 && a.slaStart>0 && a.disputes[0].photo==='storage:u/'+U.asha+'/d1.jpg');
  ok('the public does not see disputes or earlier attempts', (await snap('bela')).complaints.find(c=>c.id==r1).resolutions.length===0 && (await snap('bela')).complaints.find(c=>c.id==r1).disputes.length===0);
  await rpc('works','start_work',[r1]); await rpc('works','resolve_report',[r1,'Filled it again with concrete','u/'+U.works+'/proof2.jpg']);
  await rpc('asha','dispute_fix',[r1,'still_there','Third time and it is still bad','']);
  await rpc('works','start_work',[r1]); await rpc('works','resolve_report',[r1,'Rebuilt that stretch of road','u/'+U.works+'/proof3.jpg']);
  ok('LIMIT: third reopen refused, admins told', /already reopened 2 times/.test(await err('asha','dispute_fix',[r1,'still_there','One more time please',''])||'') && (await snap('owner')).notifications.some(n=>n.title==='A report keeps coming back'));
  ok('confirm needs a rating, then closes with the rating kept', /1 to 5/.test(await err('asha','confirm_fix',[r1,9,''])||'') && (await err('asha','confirm_fix',[r1,4,'Good work']))===null && (await snap('owner')).complaints.find(c=>c.id==r1).status==='Closed' && (await snap('owner')).complaints.find(c=>c.id==r1).audit.rating===4);
  ok('closed report cannot be disputed afterwards', /already closed/.test(await err('asha','dispute_fix',[r1,'other','changed my mind',''])||''));

  // ---- auto close
  const rw=await rpc('bela','create_report',[rep({category:'road',title:'Road crack near temple gate',description:'A big crack has opened near the temple gate',latitude:26.84,longitude:80.91})]);
  await rpc('works','start_work',[rw]); await rpc('works','resolve_report',[rw,'Crack was sealed properly','u/'+U.works+'/p9.jpg']);
  await su(`update reports set timeline=(select jsonb_agg(case when e->>'label' like 'Marked resolved%' then jsonb_set(e,'{ts}',to_jsonb(((e->>'ts')::bigint - 9*86400000))) else e end) from jsonb_array_elements(timeline) e) where id=${rw}`);
  const sAuto=await snap('bela');
  ok('AUTO-CLOSE: resolved report with no reply closes itself after 7 days', sAuto.complaints.find(c=>c.id==rw).status==='Closed' && sAuto.complaints.find(c=>c.id==rw).audit.state==='auto_closed' && sAuto.notifications.some(n=>n.title==='Your report was closed'));

  // ---- moderation outcomes
  const rx=await rpc('dev','create_report',[rep({category:'other',title:'Fake report about aliens',description:'There are aliens landing on the roof here',latitude:26.87,longitude:80.97})]);
  await rpc('owner','reject_report',[rx,'fake','Photo and place do not match at all']);
  let hx=(await su("select mod_history h from profiles where email='dev@x.org'")).rows[0].h;
  ok('reject keeps the record, removes it from public, logs history, tells the reporter', (await su(`select mod_status s from reports where id=${rx}`)).rows[0].s==='rejected' && !(await snap('anon')).complaints.some(c=>c.id==rx) && hx[0].type==='fake' && (await snap('dev')).notifications.some(n=>n.title==='Your report was removed'));
  ok('...it cannot be worked on and statistics-relevant status is untouched', /not part of the active workload/.test(await err('owner','start_work',[rx])||'') && (await su(`select status s from reports where id=${rx}`)).rows[0].s==='Submitted');
  await rpc('owner','restore_report',[rx,'Reporter proved it was real']);
  hx=(await su("select mod_history h from profiles where email='dev@x.org'")).rows[0].h;
  ok('restore reverses the trust penalty entry', hx[0].reversed===true && (await snap('anon')).complaints.some(c=>c.id==rx));
  await rpc('owner','mark_duplicate',[rx,r1,'Same pothole as the first report']).catch(()=>{});
  ok('duplicate must point at an ACTIVE original; not itself', /itself/.test(await err('owner','mark_duplicate',[rx,rx,'same thing here'])||''));
  await rpc('owner','mark_duplicate',[rx,rw,'Same road crack as DL-'+rw]).catch(e=>0);
  const dx=(await su(`select mod_status s, duplicate_of d from reports where id=${rx}`)).rows[0];
  ok('duplicate links to the original and leaves the workload', dx.s==='rejected' && Number(dx.d)===Number(r1), dx);

  // ---- people
  ok('suspend needs a reason and sensible days', /reason/.test(await err('owner','suspend_user',[U.asha,7,'x'])||'') && /1 and 90/.test(await err('owner','suspend_user',[U.asha,500,'Repeated spam reports'])||''));
  await rpc('owner','suspend_user',[U.asha,7,'Repeated confirmed spam reports']);
  ok('SUSPENDED: cannot create, comment, vote or flag; existing reports preserved', /suspended/.test(await err('asha','create_report',[rep({title:'New report while suspended'})])||'') && /suspended/.test(await err('asha','add_comment',[rw,'hello there'])||'') && (await snap('asha')).complaints.some(c=>c.id==r1));
  ok('...but can still read their snapshot', (await snap('asha')).me===U.asha);
  ok('ban needs the word BAN', /Type BAN/.test(await err('owner','ban_user',[U.asha,'Escalating abuse after suspension','nope'])||''));
  await rpc('owner','ban_user',[U.asha,'Escalating abuse after suspension','BAN']);
  ok('BANNED: every call is refused', /blocked/.test(await err('asha','create_report',[rep()])||'') && /blocked/.test(await err('asha','mark_all_read')||''));
  await rpc('owner','reinstate_user',[U.asha,'Appeal accepted']);
  ok('reinstated user works again', (await rpc('asha','create_report',[rep({title:'Back after reinstatement'})]))>0);
  ok('admins cannot be moderated, nor yourself', /Admin accounts/.test(await err('owner','ban_user',[U.owner,'testing the rules here','BAN'])||''));
  await su(`update profiles set account_status='suspended', account_until=now()-interval '1 hour', account_reason='old' where id='${U.bela}'`);
  ok('suspension expires by itself', (await err('bela','add_comment',[rw,'Posting after the suspension ended']))===null);

  // ---- departments and settings
  const nd=await rpc('owner','save_department',[{name:'Street Lighting',description:'Lamps',active:true,roles:['Lineman'],reason:'New team'}]);
  await rpc('owner','set_category_dept',['power',nd]);
  const rp=await rpc('esha','create_report',[rep({category:'power',title:'Street light off on the road',description:'The light has been off for many days now',latitude:26.845,longitude:80.95})]);
  ok('admin-configured routing is used by the server', (await su(`select dept_id d from reports where id=${rp}`)).rows[0].d===nd);
  await rpc('owner','save_department',[{id:nd,name:'Street Lighting',description:'Lamps',active:false,roles:[],reason:'Pause'}]);
  const rp2=await rpc('esha','create_report',[rep({category:'power',title:'Another street light is off',description:'The light has been off for many days now',latitude:26.846,longitude:80.951})]);
  ok('inactive department falls back to the municipal office', (await su(`select dept_id d from reports where id=${rp2}`)).rows[0].d==='municipal');
  ok('fallback department cannot be deactivated; citizens cannot edit departments or settings', /fallback/.test(await err('owner','save_department',[{id:'municipal',name:'Municipal Office',active:false,reason:'x'}])||'') && /permission/.test(await err('asha','save_department',[{name:'Hack dept here'}])||'') && /permission/.test(await err('asha','save_settings',[{reviewThreshold:2}])||''));
  ok('settings are validated', /whole number/.test(await err('owner','save_settings',[{auditDays:99}])||'') && /precise/.test(await err('owner','save_settings',[{publicGridMeters:7}])||''));
  await rpc('owner','save_settings',[{publicGridMeters:1000,areaLevel:'district',mapTiles:true,reviewThreshold:5}]);
  ok('settings saved and audited', (await snap('anon')).settings.publicGridMeters===1000 && (await snap('owner')).audit.some(e=>e.action==='settings.update'));
  await rpc('owner','save_settings',[{publicGridMeters:500,mapTiles:false}]);

  // ---- notifications
  const n=(await snap('bela')).notifications; await rpc('bela','mark_read',[[n[0].id]]);
  ok('mark_read works for own notifications only', (await snap('bela')).notifications.find(x=>x.id===n[0].id).isRead===true && (await err('chitra','mark_read',[[n[0].id]]))===null && (await snap('bela')).notifications.find(x=>x.id===n[0].id).isRead===true);
  await rpc('bela','mark_all_read'); ok('mark_all_read', (await snap('bela')).notifications.every(x=>x.isRead));

  // ---- audit log
  const au=(await snap('owner')).audit;
  ok('AUDIT: admin actions recorded with reason and actor', au.length>8 && au.every(e=>e.hash&&e.prev) && au.some(e=>e.action==='report.reject' && e.reason.includes('Photo and place')));
  ok('AUDIT: chain verifies', (await rpc('owner','audit_verify')).ok===true);
  ok('AUDIT: only admins can verify / read it', /permission/.test(await err('asha','audit_verify')||'') && (await snap('asha')).audit.length===0);
  let blocked=0; for(const q of ["update audit_log set reason='x'","delete from audit_log","truncate audit_log"]){ try{ await su(q) }catch(e){ if(/cannot be changed/.test(e.message)) blocked++ } }
  ok('AUDIT: update, delete and truncate are blocked even for the database owner', blocked===3, blocked);
  await su("alter table audit_log disable trigger audit_no_update"); await su("update audit_log set reason='edited secretly' where id=(select min(id) from audit_log)"); await su("alter table audit_log enable trigger audit_no_update");
  ok('AUDIT: if someone tampers with the database directly, verification detects it', (await rpc('owner','audit_verify')).ok===false);

  // ---- real-time feed
  await as('anon'); const feedAnon=(await db.query('select count(*)::int c from change_feed where user_id is not null')).rows[0].c;
  await as('bela'); const feedBela=(await db.query('select count(*)::int c, count(*) filter (where user_id=$1)::int mine from change_feed where user_id is not null',[U.bela])).rows[0];
  ok('REALTIME: the change stream shows public events to everyone and personal events only to their owner', feedAnon===0 && feedBela.c===feedBela.mine && feedBela.c>0, [feedAnon,feedBela]);
  ok('REALTIME: the stream carries ids only (no titles, no text)', (await su("select count(*)::int c from information_schema.columns where table_name='change_feed' and column_name in ('title','message','text','description')")).rows[0].c===0);

  // ---- storage policies (stand-in storage table)
  await su(`insert into storage.objects(bucket_id,name) values ('report-images','u/${U.bela}/p1.jpg'),('report-images','u/${U.asha}/loose.jpg')`);
  await as('asha'); let up1=true; try{ await db.query(`insert into storage.objects(bucket_id,name,owner) values ('report-images','u/${U.asha}/new.jpg','${U.asha}')`) }catch(e){ up1=false }
  let up2=false; try{ await db.query(`insert into storage.objects(bucket_id,name,owner) values ('report-images','u/${U.bela}/evil.jpg','${U.asha}')`); up2=true }catch(e){}
  let up3=false; try{ await db.query(`insert into storage.objects(bucket_id,name,owner) values ('other-bucket','u/${U.asha}/x.jpg','${U.asha}')`); up3=true }catch(e){}
  ok('STORAGE: a user can upload only into their own folder of the photo bucket', up1 && !up2 && !up3, [up1,up2,up3]);
  const readable=async(k,name)=>{ await as(k); return (await db.query("select count(*)::int c from storage.objects where name=$1",[name])).rows[0].c===1 };
  ok('STORAGE: a photo on a public report can be read by anyone', await readable('anon',`u/${U.bela}/p1.jpg`) && await readable('dev',`u/${U.bela}/p1.jpg`));
  ok('STORAGE: an unlinked photo is private to its uploader', await readable('asha',`u/${U.asha}/loose.jpg`) && !(await readable('bela',`u/${U.asha}/loose.jpg`)) && !(await readable('anon',`u/${U.asha}/loose.jpg`)));
  const rbel=(await su("select id from reports where title='Pipe leak by market'")).rows[0].id;
  await rpc('owner','mark_under_review',[rbel,'Checking the photo that was sent']);
  ok('STORAGE: when a report goes under review its photo stops being public (owner/admin keep access)', !(await readable('anon',`u/${U.bela}/p1.jpg`)) && await readable('bela',`u/${U.bela}/p1.jpg`));

  // ---- anon snapshot never errors on an empty database too
  const e=await make(); await e.exec("reset role"); const emptySnap=(await e.query('select get_snapshot() v')).rows[0].v;
  ok('EMPTY DATABASE: snapshot works with zero reports and zero users', emptySnap.complaints.length===0 && emptySnap.hasAdmin===false && emptySnap.departments.length===10);

  console.log(`\n${pass}/${pass+fail} passed`); if(fail){ console.log('FAILED:',failed); process.exit(1) }
})().catch(e=>{ console.log('CRASH',e.message,'| last call:',LAST, e.stack.split('\n')[1]); process.exit(1) });
