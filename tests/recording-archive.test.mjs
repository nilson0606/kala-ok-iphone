import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {RecordingArchive} from '../recording-archive.mjs';
const fixture=()=>({id:randomUUID(),title:'測試錄音',mime:'audio/webm;codecs=opus',created:Date.now(),seconds:2,bytes:6,rawBytes:5,complete:true,post:{reference:{title:'saved reference'},samples:[{time:.1,hz:440}]}});
function pack(meta,mix=Buffer.from('mix123'),voice=Buffer.from('voice')){const json=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(json.length);return Readable.from([prefix,json,mix,voice]);}
async function cleanup(root){if(path.dirname(root)===tmpdir()&&path.basename(root).startsWith('karaoke-archive-'))await rm(root,{recursive:true,force:true,maxRetries:5});}
test('archive round trip, score update, MP3, idempotent migration and deletion preserve song files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'karaoke-archive-'));try{
 const archive=new RecordingArchive(root),meta=fixture();await writeFile(path.join(root,'song-reference.json'),'keep');
 const result=await archive.import(meta.id,pack(meta));assert.equal(result._archiveRoot,path.join(root,'錄音'));
 assert.deepEqual((await archive.list()).records[0].post,meta.post);
 assert.equal(await readFile((await archive.audio(meta.id,'voice')).file,'utf8'),'voice');
 const changed={...result,postResult:{rhythm:50,delayMs:175}};await archive.update(meta.id,changed);
 assert.equal((await archive.import(meta.id,pack(meta))).postResult.rhythm,50,'retry cannot replace newer metadata');
 await archive.mp3(meta.id,Readable.from([Buffer.from('ID3test')]));assert.equal((await archive.audio(meta.id,'mp3')).size,7);
 await archive.delete(meta.id);assert.equal((await archive.list()).records.length,0);
 await assert.rejects(archive.import(meta.id,pack(meta)),/已刪除/);
 assert.equal(await readFile(path.join(root,'song-reference.json'),'utf8'),'keep');
 }finally{await cleanup(root);}
});
test('failed partial transfers never publish a recording and unsafe/foreign paths cannot be removed',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'karaoke-archive-'));try{
 const archive=new RecordingArchive(root),meta=fixture();
 await assert.rejects(archive.import(meta.id,pack(meta,Buffer.from('bad'))),/長度不符/);
 assert.deepEqual((await archive.list()).records,[]);assert.equal((await readdir(archive.root)).filter(n=>n.startsWith('.incoming')).length,0);
 assert.throws(()=>archive.dir('../outside'));const foreign=randomUUID();await mkdir(archive.dir(foreign));await writeFile(path.join(archive.dir(foreign),'keep.txt'),'keep');
 await assert.rejects(archive.delete(foreign));assert.equal(await readFile(path.join(archive.dir(foreign),'keep.txt'),'utf8'),'keep');
 await archive.import(meta.id,pack(meta));await assert.rejects(archive.update(meta.id,{...meta,bytes:7}),/音檔資訊/);
 }finally{await cleanup(root);}
});
