import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
const python=fileURLToPath(new URL('./.runtime/venv/Scripts/python.exe',import.meta.url));
const worker=fileURLToPath(new URL('./tools/native_microphone.py',import.meta.url));
const run=promisify(execFile);
let active=null;
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
export function stopNativeMicrophone(){active?.stop();}
// Called only after loopback host/origin and session-token validation.
export async function handleNativeMicrophone(req,res,readBody){
 if(req.url==='/microphone/devices'&&req.method==='GET'){
  try{const {stdout}=await run(python,['-X','utf8',worker,'--list'],{cwd:root,windowsHide:true,timeout:20000,maxBuffer:65536});json(res,200,JSON.parse(stdout));}
  catch{json(res,503,{error:'本機收音元件尚未就緒，請更新本機工具並安裝 tools/requirements-audio.txt。'});}
  return;
 }
 if(req.url!=='/microphone/stream'||req.method!=='POST'){json(res,405,{error:'Unsupported microphone request'});return;}
 const input=await readBody(req);
 if(typeof input.deviceId!=='string'||input.deviceId.length>512){json(res,400,{error:'Invalid microphone'});return;}
 if(active){json(res,409,{error:'本機麥克風已被另一個分頁使用，請先停止該頁收音。'});return;}
 const child=spawn(python,['-X','utf8',worker,'--device',input.deviceId],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let header=Buffer.alloc(0),ended=false;
 const operation={stop:()=>{if(ended)return;ended=true;clearTimeout(timer);child.kill();if(!res.writableEnded)res.destroy();}};
 active=operation;
 const fail=message=>{if(ended)return;if(!res.headersSent)json(res,503,{error:message});operation.stop();};
 let timer=setTimeout(()=>fail('本機麥克風啟動逾時，請確認 Python 收音權限。'),25000);
 res.once('close',()=>operation.stop());
 child.once('error',()=>fail('本機收音程式無法啟動。'));
 child.stderr.on('data',()=>{}); // Never log microphone data or environment paths.
 child.once('close',()=>{if(active===operation)active=null;fail('本機收音已中斷，請重新開啟。');clearTimeout(timer);});
 child.stdout.on('data',function first(chunk){
  if(ended)return;
  header=Buffer.concat([header,chunk]);const newline=header.indexOf(10);
  if(newline<0){if(header.length>4096)fail('本機收音回應不正確。');return;}
  try{const meta=JSON.parse(header.subarray(0,newline));if(meta.sampleRate!==48000||meta.channels!==1||typeof meta.label!=='string')throw Error();}
  catch{fail('本機收音格式不正確。');return;}
  clearTimeout(timer);child.stdout.removeListener('data',first);
  res.writeHead(200,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'});
  res.write(header);header=null;child.stdout.pipe(res);
  const heartbeat=()=>{clearTimeout(timer);timer=setTimeout(()=>fail('本機收音串流逾時。'),5000);};
  child.stdout.on('data',heartbeat);heartbeat();
 });
}
