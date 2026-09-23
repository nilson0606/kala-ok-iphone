import { detectPitch } from './audio.mjs';
// Centered windows on the decoded recording clock, independent of live UI timestamps.
export function analyzeRecordedVoice(audio, sampleRate, progress=()=>{}) {
  if(!(audio instanceof Float32Array)||!Number.isFinite(sampleRate)||sampleRate<8000)throw new Error('錄音取樣資料無效。');
  const hop=Math.round(sampleRate*.02),size=Math.round(sampleRate*.128),half=Math.floor(size/2),window=new Float32Array(size),samples=[];
  for(let center=0;center<audio.length;center+=hop){
    window.fill(0);const start=Math.max(0,center-half),end=Math.min(audio.length,center-half+size);
    window.set(audio.subarray(start,end),Math.max(0,half-center));
    samples.push({offset:center/sampleRate,hz:detectPitch(window,sampleRate).hz});
    if(samples.length%100===0)progress(Math.round(100*center/audio.length));
  }
  progress(100);return {version:1,source:'decoded-voice-v1',duration:audio.length/sampleRate,samples};
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope){
  self.onmessage=({data})=>{try{const result=analyzeRecordedVoice(data.audio,data.sampleRate,progress=>self.postMessage({progress}));self.postMessage({result});}catch(error){self.postMessage({error:error.message});}};
}
