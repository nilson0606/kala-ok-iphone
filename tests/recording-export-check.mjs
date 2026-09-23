import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {exportRecordingMp3} from '../recording-export.mjs';
import {wavBlob} from '../recording-process.mjs';
const rate=48000, signal=Float32Array.from({length:rate},(_,i)=>Math.sin(2*Math.PI*440*i/rate)*.2);
const wav=wavBlob({numberOfChannels:1,length:rate,sampleRate:rate,getChannelData:()=>signal});
const previous=await readdir(new URL('../.runtime/exports/',import.meta.url)).catch(()=>[]);
const server=http.createServer(exportRecordingMp3);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 const base=`http://127.0.0.1:${server.address().port}`;
 const invalid=await fetch(base,{method:'POST',body:'not audio'});assert.equal(invalid.status,400);await invalid.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,200));
 const response=await fetch(base,{method:'POST',body:wav});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');
 const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>10000);
 const pcm=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-f','f32le','-ac','1','-ar','48000','pipe:1'],{input:bytes,windowsHide:true});
 let peak=0;for(let i=0;i<pcm.length;i+=4)peak=Math.max(peak,Math.abs(pcm.readFloatLE(i)));assert.ok(peak>.1&&peak<.3,peak);
 await new Promise(resolve=>setTimeout(resolve,200));assert.deepEqual(await readdir(new URL('../.runtime/exports/',import.meta.url)),previous);
 console.log(JSON.stringify({mp3Bytes:bytes.length,decodedSeconds:pcm.length/4/rate,peak,invalidRejected:true,temporaryFilesRemoved:true}));
} finally {await new Promise(resolve=>server.close(resolve));}
