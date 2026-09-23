import test from 'node:test';
import assert from 'node:assert/strict';
import {rescoreRecording,voicePlacement} from '../recording-process.mjs';
const reference={version:1,videoId:'M7lc1UVf-VE',title:'Delayed melody',step:.1,duration:8,frames:Array.from({length:80},(_,i)=>[440,523.25,659.25,392][Math.floor(i/10)%4]),masks:[]};
test('positive delay advances voice and rescoring uses original samples every time',()=>{
 const post={reference,scoring:{rangeMode:'performed'},segments:[{offset:0,songTime:0,duration:8}],samples:reference.frames.map((hz,i)=>({time:i*.1+.301,hz}))};
 const before=rescoreRecording(post,0),after=rescoreRecording(post,300);
 assert.equal(after.score,100);assert.ok(before.score<after.score);assert.deepEqual(rescoreRecording(post,300),after);
 assert.deepEqual(voicePlacement(8,100),{source:.1,when:0,duration:7.9});
 assert.deepEqual(voicePlacement(8,-100),{source:0,when:.1,duration:8});
 assert.throws(()=>voicePlacement(8,NaN));assert.throws(()=>voicePlacement(8,2001));
});
test('post scoring retains masks, performed bounds, skipped gaps, and full-song denominator',()=>{
 const post={reference:{...reference,masks:[{start:1,end:2}]},scoring:{rangeMode:'performed'},segments:[{offset:0,songTime:0,duration:3}],samples:reference.frames.slice(0,30).map((hz,i)=>({time:i*.1+.101,hz:i>=10&&i<20?800:hz}))};
 assert.equal(rescoreRecording(post,100).score,100);assert.equal(rescoreRecording(post,100).referenceSeconds,2);
 assert.equal(rescoreRecording(post,-100).referenceSeconds,2);
 const full=rescoreRecording({...post,scoring:{rangeMode:'full'}},100);assert.equal(full.referenceSeconds,7);assert.ok(full.score<100);
 const gaps={...post,reference,segments:[{offset:0,songTime:0,duration:1},{offset:1,songTime:2,duration:1}],samples:post.samples.filter(x=>x.time<1||x.time>=2.1)};
 assert.ok(rescoreRecording(gaps,100).coverage<100);
});

test('dense samples with note changes between reference timestamps improve after the correct delay',()=>{
 const notes=[440,523.25,659.25,392], melody=t=>t<.05?440:notes[Math.floor((t-.05)/.5)%4];
 const reference={version:1,videoId:'M7lc1UVf-VE',title:'100 ms late',step:.1,duration:8,frames:Array.from({length:80},(_,i)=>melody(i*.1)),masks:[]};
 const samples=Array.from({length:800},(_,i)=>{const time=(i+.1)*.01;return{time,hz:time<.1?null:melody(time-.1)}});
 const post={reference,scoring:{rangeMode:'performed'},segments:[{offset:0,songTime:0,duration:8}],samples};
 const before=rescoreRecording(post,0),after=rescoreRecording(post,100);
 assert.ok(after.score>before.score,JSON.stringify({before,after}));assert.equal(after.pitch,100);assert.equal(after.rhythm,100);
 console.log('Known 100 ms delay:',JSON.stringify({before,after}));
});
