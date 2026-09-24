import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../native-mic-worklet.mjs',import.meta.url),'utf8');
function processor(){let Type;const messages=[];vm.runInNewContext(source,{Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},registerProcessor:(name,cls)=>Type=cls});return{p:new Type(),messages};}
const render=p=>{const out=new Float32Array(128);p.process([],[[out]]);return out;};
test('native PCM retains sample order across packets; preroll is silent until ready',()=>{const {p,messages}=processor();p.port.onmessage({data:Float32Array.from({length:960},(_,i)=>i/2000)});assert.ok(render(p).every(x=>x===0));p.port.onmessage({data:Float32Array.from({length:960},(_,i)=>(i+960)/2000)});const output=[];for(let i=0;i<15;i++)output.push(...render(p));assert.deepEqual(output,Array.from(Float32Array.from({length:1920},(_,i)=>i/2000)));assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{ready:true}]);});
test('native PCM stops reporting audio on excessive delay or stalled capture',()=>{const a=processor();a.p.port.onmessage({data:new Float32Array(12001)});assert.ok(a.messages[0].error);const b=processor();b.p.port.onmessage({data:new Float32Array(1920).fill(.2)});for(let i=0;i<110;i++)render(b.p);assert.ok(b.messages.some(x=>x.error));assert.ok(render(b.p).every(x=>x===0));});
