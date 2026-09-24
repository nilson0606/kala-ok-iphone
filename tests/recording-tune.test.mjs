import test from 'node:test';
import assert from 'node:assert/strict';
import {tuneChannels,tuningProfile,recordingTuningSuffix} from '../recording-tune.mjs';
import {detectPitch} from '../audio.mjs';
const rate=48000;
function tone(hz,seconds=1.5){return Float32Array.from({length:rate*seconds},(_,i)=>.18*Math.sin(2*Math.PI*hz*i/rate)+.06*Math.sin(4*Math.PI*hz*i/rate));}
function pitch(a){const values=[];for(let i=rate*.4;i<rate*1.2;i+=4800)values.push(detectPitch(a.subarray(i,i+6144),rate).hz);assert.ok(values.every(Boolean));return values.reduce((a,b)=>a+b,0)/values.length;}
test('graded tuning corrects both sharp and flat sustained voices without editing the source',()=>{
  for(const [target,cents] of [[110,35],[220,-30],[440,35]]){
    const original=tone(target*2**(cents/1200)),snapshot=original.slice();let error=Infinity;
    for(const level of ['off','light','medium','strong']){
      const result=tuneChannels([original],rate,level)[0],hz=pitch(result),current=Math.abs(1200*Math.log2(hz/target));
      assert.ok(current<error,`${target} ${level}: ${current} cents versus ${error}`);error=current;
      assert.equal(result.length,original.length);assert.ok(result.every(Number.isFinite));
      assert.ok(result.every(x=>Math.abs(x)<=.241),'overlap normalization must not boost peaks');
    }
    assert.ok(error<3);assert.deepEqual(original,snapshot);
  }
});
test('off is an exact bypass; silence and uncertain noise are retained',()=>{
  const input=[tone(450)];assert.equal(tuneChannels(input,rate,'off'),input);
  const silence=new Float32Array(rate);assert.deepEqual(tuneChannels([silence],rate,'strong')[0],silence);
  let seed=1;const noise=Float32Array.from({length:rate},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/2**32-.5)*.1;});
  assert.deepEqual(tuneChannels([noise],rate,'strong')[0],noise);
});
test('stereo shares pitch marks and silence around a voiced region does not move',()=>{
  const a=new Float32Array(rate*2),v=tone(225,1);a.set(v,rate/2);const b=Float32Array.from(a,x=>x*.5);
  const [left,right]=tuneChannels([a,b],rate,'strong');
  assert.equal(left.length,a.length);assert.ok(left.subarray(0,rate/2).every(x=>x===0));assert.ok(left.subarray(rate*1.5).every(x=>x===0));
  assert.ok(right.every((x,i)=>Math.abs(x-left[i]*.5)<1e-7));
});
test('invalid strength and malformed audio fail clearly; filenames describe the applied effect',()=>{
  assert.throws(()=>tuningProfile('wrong'));
  assert.throws(()=>tuneChannels([],rate,'light'));
  assert.throws(()=>tuneChannels([tone(440),new Float32Array(1)],rate,'light'));
  assert.equal(recordingTuningSuffix({}),'');assert.equal(recordingTuningSuffix({vocalTuning:{strength:'off'}}),'');
  assert.equal(recordingTuningSuffix({vocalTuning:{strength:'strong'}}),'_修音強烈');
});

test('strong tuning flattens vibrato more than light tuning while retaining the voice waveform',()=>{
  const a=new Float32Array(rate*3);let phase=0;
  for(let i=0;i<a.length;i++){phase+=2*Math.PI*220*2**((20+25*Math.sin(2*Math.PI*5*i/rate))/1200)/rate;a[i]=.2*Math.sin(phase)+.06*Math.sin(2*phase);}
  const deviation=[];
  for(const strength of ['off','light','medium','strong']){
    const b=tuneChannels([a],rate,strength)[0],cents=[];
    for(let i=rate/2;i<rate*2.5;i+=960){const p=detectPitch(b.subarray(i,i+3840),rate);assert.ok(p.hz);cents.push(1200*Math.log2(p.hz/220));}
    deviation.push(Math.sqrt(cents.reduce((sum,x)=>sum+x*x,0)/cents.length));
  }
  assert.ok(deviation.every((v,i)=>!i||v<deviation[i-1]),JSON.stringify(deviation));
  assert.ok(deviation[3]<3&&deviation[1]>8,JSON.stringify(deviation));
});
