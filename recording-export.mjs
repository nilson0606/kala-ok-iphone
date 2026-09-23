import { mkdtemp, mkdir, open, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('./.runtime/exports/',import.meta.url));
let busy=false;
export async function exportRecordingMp3(req,res){
  const json=(code,error)=>{if(!res.destroyed){res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({error}));}};
  if(busy){json(409,'另一筆錄音正在轉檔，請稍後再試。');return;}
  busy=true;let directory,handle,child,timer;
  const cancel=()=>child?.kill();res.once('close',cancel);
  try{
    await mkdir(root,{recursive:true});directory=await mkdtemp(path.join(root,'recording-'));
    const input=path.join(directory,'input.audio'),output=path.join(directory,'output.mp3');handle=await open(input,'wx');
    let size=0,header=Buffer.alloc(0);
    for await(const chunk of req){size+=chunk.length;if(size>384*1024*1024)throw new Error('錄音超過 384 MB，請改下載原始錄音。');if(header.length<16)header=Buffer.concat([header,chunk]).subarray(0,16);await handle.writeFile(chunk);}
    await handle.close();handle=null;
    const format=header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WAVE'?'wav':header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))?'matroska':header.toString('ascii',4,8)==='ftyp'?'mov':null;
    if(!format)throw new Error('不支援的錄音格式，請選擇 WebM、WAV 或 M4A 錄音。');
    await new Promise((resolve,reject)=>{
      child=spawn('ffmpeg',['-v','error','-nostdin','-protocol_whitelist','file,pipe','-f',format,'-i',input,'-map','0:a:0','-vn','-threads','2','-c:a','libmp3lame','-b:a','192k',output],{windowsHide:true,stdio:['ignore','ignore','pipe']});
      let error='';child.stderr.on('data',x=>{error=(error+x).slice(-1000);});
      timer=setTimeout(()=>{child.kill();reject(new Error('MP3 轉檔逾時，請重試。'));},120000);
      child.once('error',()=>reject(new Error('無法啟動 FFmpeg，請檢查本機工具。')));
      child.once('close',code=>code===0?resolve():reject(new Error('MP3 轉檔失敗，錄音可能不完整。')));
    });
    const bytes=await readFile(output);if(!bytes.length)throw new Error('MP3 輸出為空。');
    if(!res.destroyed){res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff'});res.end(bytes);}
  }catch(error){json(400,error.message);}
  finally{clearTimeout(timer);res.off('close',cancel);await handle?.close().catch(()=>{});if(directory&&path.dirname(path.resolve(directory))===path.resolve(root))await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});busy=false;}
}
