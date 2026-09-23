import { ScoringTake, validateReference } from './scoring.mjs';
import { balanceGains, createRecordingMix } from './recording-mix.mjs';
export function delaySeconds(ms) {
  if(!Number.isFinite(ms)||Math.abs(ms)>2000)throw new Error('延時需介於 −2000 與 +2000 ms。');
  return ms/1000;
}
export function recordedSongTime(segments, offset) {
  const segment=segments.find(s=>offset>=s.offset&&offset<s.offset+s.duration);
  return segment ? segment.songTime+offset-segment.offset : null;
}
export function referenceForRescore(post, current) {
  if (!current) throw new Error('請先載入這首歌的新基準；只更改音高選項還不算載入。');
  const original=post.reference;
  validateReference(current);
  if(current.videoId!==original.videoId)throw new Error('目前載入的是另一支影片，不能用來重評這筆錄音。');
  const duration=ref=>ref.duration??ref.frames.length*ref.step;
  if((original.rangeSeconds!=null&&current.rangeSeconds!=null&&original.rangeSeconds!==current.rangeSeconds)||
    Math.abs(duration(current)-duration(original))>.15||Math.abs(current.frames.length*current.step-original.frames.length*original.step)>.15)
    throw new Error('請載入與錄音當時相同分析範圍的基準，避免改變計分範圍。');
  // Change only the melody. Preserve this take's masks and remix stem identity.
  const selected=structuredClone({...current,masks:original.masks||[]});
  validateReference(selected);
  return selected;
}
export function rescoreRecording(post, ms) {
  const shift=delaySeconds(ms), take=new ScoringTake(post.reference,post.scoring);
  take.begin(0);
  for(const segment of post.segments)take.advance(segment.songTime+segment.duration);
  const end=take.endIndex;
  if(post.audioAnalysis?.source==='decoded-voice-v1') {
    // Move the audio first, then map to the accompaniment timeline, just as remix does.
    for(const {offset,hz} of post.audioAnalysis.samples) {
      const time=recordedSongTime(post.segments,offset-shift);
      if(time!==null)take.sample(time,hz);
    }
  } else for(const {time,hz} of post.samples)take.sample(time-shift,hz);
  // Moving notes must not expand or shrink the performed interval denominator.
  take.endIndex=end;
  return take.result();
}
export function voicePlacement(duration, ms) {
  const shift=delaySeconds(ms), source=Math.max(0,shift), when=Math.max(0,-shift);
  return {source,when,duration:Math.max(0,duration-source)};
}
export function wavBlob(buffer) {
  const channels=buffer.numberOfChannels, frames=buffer.length, bytes=new ArrayBuffer(44+frames*channels*2), view=new DataView(bytes);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes.byteLength-44,true);
  const data=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const x=Math.max(-1,Math.min(1,data[c][i]));view.setInt16(44+2*(i*channels+c),Math.round(x*(x<0?32768:32767)),true);}
  return new Blob([bytes],{type:'audio/wav'});
}
export async function remixRecording(raw, tracks, meta, ms) {
  const shift=delaySeconds(ms), rate=raw.sampleRate;
  const duration=Math.max(raw.duration+Math.max(0,-shift),meta.seconds);
  if(duration>3600)throw new Error('後處理一次最多一小時。');
  const context=new OfflineAudioContext(2,Math.ceil(duration*rate),rate), voice=context.createBufferSource();voice.buffer=raw;
  const mix=createRecordingMix(context,voice,context.destination,{mode:meta.mode,settings:meta.balance,voiced:()=>false});
  const p=voicePlacement(raw.duration,ms);if(p.duration>0)voice.start(p.when,p.source,p.duration);
  const rms=(buffer,time)=>{
    const a=buffer.getChannelData(0),start=Math.max(0,Math.floor(time*rate)),end=Math.min(a.length,start+Math.floor(.1*rate));
    if(time<0||end<=start)return 0;let sum=0;for(let i=start;i<end;i++)sum+=a[i]*a[i];return Math.sqrt(sum/(end-start));
  };
  for(const segment of meta.post.segments)for(const buffer of tracks){
    const length=Math.min(segment.duration,buffer.duration-segment.songTime);
    if(length<=0||segment.songTime<0)continue;
    const node=context.createBufferSource();node.buffer=buffer;node.connect(mix.input);node.start(segment.offset,segment.songTime,length);
  }
  // Automate the same two buses offline. Both accompaniment and harmony share one gain.
  let sampleIndex=0;
  for(let t=0;t<duration;t+=.1){
    const sourceTime=t+shift, segment=meta.post.segments.find(s=>t>=s.offset&&t<s.offset+s.duration);
    while(sampleIndex+1<meta.post.samples.length&&meta.post.samples[sampleIndex+1].offset<=sourceTime)sampleIndex++;
    const sample=meta.post.samples[sampleIndex];
    const voiced=!!sample?.hz&&Math.abs(sample.offset-sourceTime)<.2;
    const backingRms=segment?Math.hypot(...tracks.map(b=>rms(b,segment.songTime+t-segment.offset))):0;
    mix.setLevels(balanceGains({mode:meta.mode,settings:meta.balance,voiceRms:rms(raw,sourceTime),backingRms,voiced}),t);
    if(Math.round(t*10)%100===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const rendered=await context.startRendering();mix.disconnect();return rendered;
}
