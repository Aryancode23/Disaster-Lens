// Tiny static server (with CORS) that gives the browser test page its Postgres-in-WebAssembly engine, the schema, and the mock client.
const http=require('http'),fs=require('fs'),path=require('path');
const roots={'/pglite/':path.join(__dirname,'node_modules/@electric-sql/pglite/dist/'),'/schema.sql':'/mnt/user-data/outputs/disaster-lens/supabase/schema.sql','/mock.js':path.join(__dirname,'mock-supabase.js')};
const mime={'.js':'text/javascript','.wasm':'application/wasm','.data':'application/octet-stream','.sql':'text/plain','.json':'application/json','.map':'application/json'};
http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','no-store');
  const u=req.url.split('?')[0]; let file=null;
  if(u==='/schema.sql') file=roots[u]; else if(u==='/mock.js') file=roots[u]; else if(u.startsWith('/pglite/')) file=path.join(roots['/pglite/'],u.slice(8));
  if(!file||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;return res.end('nf')}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream'); fs.createReadStream(file).pipe(res);
}).listen(8766,'127.0.0.1',()=>console.log('engine server on 8766'));
