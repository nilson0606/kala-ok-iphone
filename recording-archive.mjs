// Durable local recordings. Caller authenticates and supplies the configured library only.
import {mkdir,mkdtemp,readFile,writeFile,rename,rm,readdir,lstat,stat,open} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_AUDIO=384*1024*1024,MAX_META=16*1024*1024;
const ext=mime=>mime?.startsWith('audio/webm')?'webm':mime?.startsWith('audio/mp4')?'m4a':mime==='audio/wav'?'wav':null;
const clean=meta=>{const {_archiveRoot,...value}=meta;return value;};
function validate(meta,id){
 if(!meta||meta.id!==id||!ID.test(id)||typeof meta.title!=='string'||meta.title.length>500||!ext(meta.mime)||(meta.rawMime&&!ext(meta.rawMime))||!Number.isFinite(meta.created)||!Number.isFinite(meta.seconds)||meta.seconds<0||meta.seconds>3601||!Number.isSafeInteger(meta.bytes)||meta.bytes<1||meta.bytes>MAX_AUDIO||!Number.isSafeInteger(meta.rawBytes??0)||(meta.rawBytes??0)<0||(meta.rawBytes??0)>MAX_AUDIO)throw new Error('錄音資料或大小無效。');
 return clean(meta);
}
async function regular(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw new Error('錄音檔案位置無效。');return s;}
export class RecordingArchive {
 constructor(library){this.root=path.resolve(library,'錄音');}
 async ready(){await mkdir(this.root,{recursive:true});const s=await lstat(this.root);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('錄音目錄不能是連結。');}
 dir(id){if(!ID.test(id))throw new Error('錄音 ID 無效。');const dir=path.resolve(this.root,id);if(path.dirname(dir)!==this.root)throw new Error('錄音位置無效。');return dir;}
 async owned(id){const dir=this.dir(id),s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('錄音目錄無效。');return dir;}
 async deleted(){try{await regular(path.join(this.root,'.deleted.json'));return JSON.parse(await readFile(path.join(this.root,'.deleted.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async atomic(file,value){const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,value,{flag:'wx'});await rename(temporary,file);}finally{await rm(temporary,{force:true});}}
 async get(id){
  const dir=await this.owned(id);await regular(path.join(dir,'metadata.json'));
  const value=JSON.parse(await readFile(path.join(dir,'metadata.json'),'utf8'));
  if(value.format!=='karaoke-recording-v1')throw new Error('這個目錄不是本工具的錄音。');
  const meta=validate(value.recording,id),suffix=ext(meta.mime);
  if((await regular(path.join(dir,'mix.'+suffix))).size!==meta.bytes)throw new Error('錄音成品不完整。');
  if(meta.rawBytes&&(await regular(path.join(dir,'voice.'+ext(meta.rawMime||meta.mime)))).size!==meta.rawBytes)throw new Error('原始歌聲不完整。');
  return {...meta,_archiveRoot:this.root};
 }
 async list(){await this.ready();const records=[],deleted=new Set(await this.deleted());for(const d of await readdir(this.root,{withFileTypes:true})){if(d.isDirectory()&&ID.test(d.name)&&!deleted.has(d.name)){try{records.push(await this.get(d.name));}catch{/* Incomplete or foreign folders are never exposed or removed. */}}}return {path:this.root,records:records.sort((a,b)=>b.created-a.created),deleted:[...deleted]};}
 async import(id,input){
  await this.ready();if((await this.deleted()).includes(id))throw new Error('這筆錄音已刪除，不能從舊副本自動搬回。');
  const target=this.dir(id);if(await stat(target).catch(()=>null))return this.get(id); // A retry cannot overwrite newer results.
  const stage=await mkdtemp(path.join(this.root,'.incoming-'));
  try{
   const bundle=path.join(stage,'upload.bin'),handle=await open(bundle,'wx');let size=0;
   try{for await(const chunk of input){size+=chunk.length;if(size>2*MAX_AUDIO+MAX_META+4)throw new Error('錄音太大。');await handle.writeFile(chunk);}}finally{await handle.close();}
   const reader=await open(bundle,'r');let meta,offset;
   try{const prefix=Buffer.alloc(4);if((await reader.read(prefix,0,4,0)).bytesRead!==4)throw new Error('錄音封包不完整。');const n=prefix.readUInt32LE();if(n<2||n>MAX_META)throw new Error('錄音資料太大。');const bytes=Buffer.alloc(n);if((await reader.read(bytes,0,n,4)).bytesRead!==n)throw new Error('錄音資料不完整。');meta=validate(JSON.parse(bytes.toString('utf8')),id);offset=4+n;}finally{await reader.close();}
   if(size!==offset+meta.bytes+(meta.rawBytes||0))throw new Error('音檔長度不符，保留瀏覽器原檔供重試。');
   for(const [name,length]of [['mix',meta.bytes],['voice',meta.rawBytes||0]]){if(length){await pipeline(createReadStream(bundle,{start:offset,end:offset+length-1}),createWriteStream(path.join(stage,name+'.'+ext(name==='voice'?(meta.rawMime||meta.mime):meta.mime)),{flags:'wx'}));offset+=length;}}
   await writeFile(path.join(stage,'metadata.json'),JSON.stringify({format:'karaoke-recording-v1',recording:meta}));
   await rm(bundle);await rename(stage,target);return this.get(id);
  }finally{if(path.dirname(path.resolve(stage))===this.root&&path.basename(stage).startsWith('.incoming-'))await rm(stage,{recursive:true,force:true,maxRetries:3});}
 }
 async update(id,value){const prior=await this.get(id),meta=validate(value,id);if(meta.bytes!==prior.bytes||(meta.rawBytes||0)!==(prior.rawBytes||0)||meta.mime!==prior.mime||(meta.rawMime||meta.mime)!==(prior.rawMime||prior.mime))throw new Error('不能在更新成績時改寫音檔資訊。');await this.atomic(path.join(this.dir(id),'metadata.json'),JSON.stringify({format:'karaoke-recording-v1',recording:meta}));return this.get(id);}
 async audio(id,track){const meta=await this.get(id);if(!['mix','voice','mp3'].includes(track))throw new Error('無效音軌。');const file=path.join(this.dir(id),track==='mp3'?'export.mp3':track+'.'+ext(track==='voice'?(meta.rawMime||meta.mime):meta.mime));const size=(await regular(file)).size;return{file,size,mime:track==='mp3'?'audio/mpeg':track==='voice'?(meta.rawMime||meta.mime):meta.mime};}
 async mp3(id,input){await this.get(id);const file=path.join(this.dir(id),'export.mp3'),temporary=file+'.'+randomUUID()+'.tmp';let length=0;const handle=await open(temporary,'wx');try{for await(const chunk of input){length+=chunk.length;if(length>MAX_AUDIO)throw new Error('MP3 太大。');await handle.writeFile(chunk);}if(!length)throw new Error('MP3 為空。');await handle.close();await rename(temporary,file);}finally{await handle.close().catch(()=>{});await rm(temporary,{force:true});}return {path:file};}
 async delete(id){
  await this.ready();this.dir(id);const deleted=await this.deleted();
  if(!deleted.includes(id)){await this.get(id);deleted.push(id);await this.atomic(path.join(this.root,'.deleted.json'),JSON.stringify(deleted));}
  const dir=this.dir(id);if(await lstat(dir).catch(()=>null)){await this.owned(id);if(path.dirname(path.resolve(dir))!==this.root)throw new Error('錄音位置無效。');await rm(dir,{recursive:true,force:true,maxRetries:3});}
 }
}
let pending=Promise.resolve();
export function serializeArchive(work){const result=pending.then(work);pending=result.catch(()=>{});return result;}
export async function handleRecordingArchive(req,res,location){
 const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 try{
  const saved=await location.get();if(!saved.configured)throw new Error('請先指定歌曲庫資料夾。');
  const archive=new RecordingArchive(saved.path),url=new URL(req.url,'http://localhost');
  if(url.searchParams.has('root')&&url.searchParams.get('root')!==archive.root)throw new Error('歌曲庫位置已變更，請重新整理錄音清單。');
  if(url.pathname==='/recordings'&&req.method==='GET'){json(200,await archive.list());return;}
  const match=/^\/recordings\/([a-f0-9-]+)(?:\/(metadata|mix|voice|mp3))?$/.exec(url.pathname);
  if(!match||!ID.test(match[1])){json(400,{error:'錄音網址無效。'});return;}
  const [,id,asset]=match;
  if(req.method==='POST'&&!asset){json(200,await archive.import(id,req));return;}
  if(req.method==='POST'&&asset==='metadata'){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_META)throw new Error('錄音資料太大。');chunks.push(chunk);}json(200,await archive.update(id,JSON.parse(Buffer.concat(chunks).toString('utf8'))));return;}
  if(req.method==='POST'&&asset==='mp3'){json(200,await archive.mp3(id,req));return;}
  if(req.method==='DELETE'&&!asset){await archive.delete(id);json(200,{deleted:true});return;}
  if(req.method==='GET'&&['mix','voice','mp3'].includes(asset)){const audio=await archive.audio(id,asset);res.writeHead(200,{'Content-Type':audio.mime,'Content-Length':audio.size,'X-Content-Type-Options':'nosniff'});await pipeline(createReadStream(audio.file),res);return;}
  json(405,{error:'不支援此操作。'});
 }catch(error){if(!res.headersSent)json(400,{error:error.message});else res.destroy();}
}
