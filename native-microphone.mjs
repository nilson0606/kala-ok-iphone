const base='http://127.0.0.1:4174';
async function session(signal){
 const r=await fetch(base+'/session',{cache:'no-store',signal});if(!r.ok)throw Error('無法連線本機工具。');
 const s=await r.json();if(!s.features?.includes('native-microphone'))throw Error('請先更新並重新啟動本機工具，才能使用本機相容收音。');return s;
}
export async function nativeInputDevices(){
 const signal=AbortSignal.timeout(25000),s=await session(signal);
 const r=await fetch(base+'/microphone/devices',{headers:{'X-Karaoke-Token':s.token},signal});
 const data=await r.json();if(!r.ok)throw Error(data.error||'無法取得本機麥克風清單。');return data.devices;
}
export async function openNativeMicrophone(context,{deviceId='',signal,onError}){
 const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 let reader,node,destination,stopped=false,started=false,resolveReady,rejectReady;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 // Attach a handler immediately: setup can fail before the ready promise is awaited.
 ready.catch(()=>{});
 const timer=setTimeout(()=>{rejectReady(Error('本機收音啟動逾時。'));controller.abort();},30000);
 const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);controller.abort();signal.removeEventListener('abort',abort);reader?.cancel().catch(()=>{});node?.disconnect();destination?.stream.getTracks().forEach(t=>t.stop());};
 const fail=error=>{rejectReady(error);if(started&&!stopped)onError(error);stop();};
 try{
  const s=await session(controller.signal);
  await context.audioWorklet.addModule(new URL('./native-mic-worklet.mjs',import.meta.url));
  const response=await fetch(base+'/microphone/stream',{method:'POST',headers:{'Content-Type':'application/json','X-Karaoke-Token':s.token},body:JSON.stringify({deviceId}),signal:controller.signal});
  if(!response.ok){const e=await response.json();throw Error(e.error||'本機收音無法啟動。');}
  reader=response.body.getReader();let prefix=new Uint8Array(0),meta;
  while(!meta){const {done,value}=await reader.read();if(done)throw Error('本機收音在啟動前中斷。');const bytes=new Uint8Array(prefix.length+value.length);bytes.set(prefix);bytes.set(value,prefix.length);prefix=bytes;const n=prefix.indexOf(10);if(n>=0){meta=JSON.parse(new TextDecoder().decode(prefix.subarray(0,n)));prefix=prefix.slice(n+1);}else if(prefix.length>4096)throw Error('本機收音回應過大。');}
  if(meta.sampleRate!==context.sampleRate||meta.channels!==1)throw Error('本機收音取樣率不相容。');
  node=new AudioWorkletNode(context,'local-microphone',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
  destination=context.createMediaStreamDestination();node.connect(destination);
  node.port.onmessage=({data})=>{if(data.error)fail(Error(data.error));if(data.ready)resolveReady();};
  let carry=new Uint8Array(0);
  const feed=bytes=>{const all=new Uint8Array(carry.length+bytes.length);all.set(carry);all.set(bytes,carry.length);const n=all.length-all.length%4;carry=all.slice(n);if(n){const pcm=new Float32Array(all.buffer.slice(0,n));node.port.postMessage(pcm,[pcm.buffer]);}};
  feed(prefix);
  const pump=(async()=>{while(!stopped){const {done,value}=await reader.read();if(done)throw Error('本機收音連線已中斷。');feed(value);}})();pump.catch(error=>{if(!stopped)fail(error);});
  await ready;clearTimeout(timer);if(controller.signal.aborted)throw new DOMException('已取消','AbortError');started=true;
  return{stream:destination.stream,label:meta.label,stop};
 }catch(error){stop();throw error;}
}
