import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRecordedVoice} from '../recording-analysis.mjs';
import {rescoreRecording,recordedSongTime} from '../recording-process.mjs';
test('decoded voice with known 175 ms lag/lead scores better at its measured audio alignment',()=>{
 const rate=16000,duration=8,notes=[440,523.25,659.25,392];
 const melody=t=>t<.4||t>=7.4?null:notes[Math.floor((t-.4)/.6)%notes.length];
 const reference={version:1,videoId:'M7lc1UVf-VE',title:'Recorded waveform',step:.1,duration,frames:Array.from({length:80},(_,i)=>melody(i*.1)),masks:[]};
 for(const lag of [.175,-.175]){
  const audio=Float32Array.from({length:rate*duration},(_,i)=>{const hz=melody(i/rate-lag);return hz ? .15*Math.sin(2*Math.PI*hz*i/rate) : 0;});
  const analysis=analyzeRecordedVoice(audio,rate);
  const post={reference,scoring:{rangeMode:'performed'},segments:[{offset:0,songTime:0,duration}],samples:Array.from({length:80},(_,i)=>({time:i*.1,hz:reference.frames[i]})),audioAnalysis:analysis};
  const before=rescoreRecording(post,0),after=rescoreRecording(post,lag*1000);
  assert.ok(after.rhythm>before.rhythm,JSON.stringify({lag,before,after}));assert.ok(after.pitch>before.pitch,JSON.stringify({lag,before,after}));
  console.log('Audio-clock scoring:',JSON.stringify({lag,before,after}));
 }
});
test('audio is shifted before timeline mapping, including replay and seek boundaries',()=>{
 const segments=[{offset:0,songTime:5,duration:1},{offset:1,songTime:10,duration:1}];
 assert.equal(recordedSongTime(segments,1.1-.175),5.925);
 assert.equal(recordedSongTime(segments,1.175-.175),10);
 assert.equal(recordedSongTime(segments,-.1),null);assert.equal(recordedSongTime(segments,2),null);
});
