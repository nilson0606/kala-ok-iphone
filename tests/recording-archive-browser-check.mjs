import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {RecordingArchive,handleRecordingArchive,serializeArchive} from '../recording-archive.mjs';
const {chromium}=createRequire('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const root=await mkdtemp(path.join(tmpdir(),'karaoke-archive-browser-')),archive=new RecordingArchive(root),site='http://localhost:4276';
const helper=http.createServer((req,res)=>serializeArchive(()=>handleRecordingArchive(req,res,{get:async()=>({configured:true,path:root})})));
await new Promise(resolve=>helper.listen(0,'127.0.0.1',resolve));const api='http://127.0.0.1:'+helper.address().port;
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4276'},windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--disable-gpu']});let offline=false;
 async function client(){const context=await browser.newContext();const page=await context.newPage();
  await page.route(site+'/archive-fixture',r=>r.fulfill({contentType:'text/html',body:'<title>Archive fixture</title>'}));
  await page.route('http://127.0.0.1:4174/**',async route=>{
   const req=route.request(),url=new URL(req.url());if(offline){await route.abort();return;}
   if(url.pathname==='/session'){await route.fulfill({json:{token:'test',features:['recording-library']}});return;}
   const response=await fetch(api+url.pathname+url.search,{method:req.method(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()});
   await route.fulfill({status:response.status,body:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')||'application/json'});
  });
  await page.goto(site+'/archive-fixture');await page.evaluate(async()=>{const {RecordingStore,BrowserRecordingStore}=await import('/recording-store.mjs');window.localStore=new BrowserRecordingStore();window.diskStore=new RecordingStore();});return{context,page};
 }
 const {page}=await client();
 const meta=await page.evaluate(async()=>{const row={id:crypto.randomUUID(),title:'Legacy song',mime:'audio/webm',created:Date.now(),seconds:2,bytes:6,rawBytes:5,complete:true,post:{reference:{pitchMethod:'yin'},samples:[{time:1,hz:440}]}};await localStore.save(row,new Blob(['mix123']),0);await localStore.save(row,new Blob(['voice']),0,'voice');return row;});
 offline=true;assert.equal((await page.evaluate(()=>diskStore.list())).length,1);assert.equal((await page.evaluate(()=>localStore.list())).length,1,'offline migration must preserve original');offline=false;
 const migrated=await page.evaluate(()=>diskStore.list());assert.equal(migrated[0]._archiveRoot,archive.root);assert.equal((await page.evaluate(()=>localStore.list())).length,0);
 assert.equal(await readFile((await archive.audio(meta.id,'voice')).file,'utf8'),'voice');
 const other=await client();const cross=await other.page.evaluate(()=>diskStore.list());assert.equal(cross[0].id,meta.id,'fresh browser reads disk without IndexedDB');
 await other.page.evaluate(async()=>{const row=(await diskStore.list())[0];row.postResult={rhythm:50,delayMs:175};await diskStore.save(row);await diskStore.saveMp3(row,new Blob(['ID3mp3']));});
 assert.equal((await archive.get(meta.id)).postResult.rhythm,50);assert.equal((await archive.audio(meta.id,'mp3')).size,6);
 // Interrupted publication retries keep disk's newer result, then remove duplicate local bytes.
 await page.evaluate(async row=>{await localStore.save(row,new Blob(['mix123']),0);await localStore.save(row,new Blob(['voice']),0,'voice');await diskStore.list();},meta);
 assert.equal((await archive.get(meta.id)).postResult.rhythm,50);
 await other.page.evaluate(async id=>{await diskStore.delete(id);},meta.id);
 await page.evaluate(async row=>{await localStore.save(row,new Blob(['mix123']),0);await localStore.save(row,new Blob(['voice']),0,'voice');},meta);
 assert.equal((await page.evaluate(()=>diskStore.list())).length,0,'deleted disk record must not resurrect from stale browser');
 await page.evaluate(async()=>{for(let i=0;i<2;i++){const row={id:crypto.randomUUID(),title:'Remix '+i,mime:'audio/wav',created:Date.now(),seconds:1,bytes:3,complete:true};await diskStore.save(row,new Blob(['wav']),0);}});
 assert.equal((await archive.list()).records.length,2);await writeFile(path.join(root,'song-kept.txt'),'keep');
 assert.equal(await page.evaluate(()=>diskStore.deleteAll()),2);assert.equal((await archive.list()).records.length,0);assert.equal(await readFile(path.join(root,'song-kept.txt'),'utf8'),'keep');
 console.log('Real browser migration, interrupted/offline retry, cross-browser listing, metadata/MP3 persistence, stale-copy deletion and delete-all passed.');
}finally{await browser?.close();server.kill();await new Promise(resolve=>helper.close(resolve));if(path.dirname(root)===tmpdir()&&path.basename(root).startsWith('karaoke-archive-browser-'))await rm(root,{recursive:true,force:true,maxRetries:5});}
