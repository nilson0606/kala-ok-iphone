import { detectPitch } from './audio.mjs';

const profiles={off:{label:'關閉',amount:0,response:0},light:{label:'輕度',amount:.35,response:.12},medium:{label:'中度',amount:.7,response:.05},strong:{label:'強烈',amount:1,response:.008}};
export function tuningProfile(value='off') {
  if(!Object.hasOwn(profiles,value))throw new Error('無效的電子修音強度。');
  return {id:value,...profiles[value]};
}
export function recordingTuningSuffix(meta) {
  const id=meta?.vocalTuning?.strength;
  return id&&id!=='off'&&Object.hasOwn(profiles,id)?`_修音${profiles[id].label}`:'';
}

// Offline, monophonic TD-PSOLA: move overlapping pitch-synchronous grains,
// not playback speed. All channels share pitch marks; duration is unchanged.
// The target is the nearest chromatic note, not the song's reference melody.
export function tuneChannels(channels,rate,strength='off',progress=()=>{}) {
  const profile=tuningProfile(strength),length=channels[0]?.length;
  if(!channels.length||channels.length>8||!Number.isInteger(rate)||rate<8000||rate>192000||!length||length>rate*3600||channels.some(c=>!(c instanceof Float32Array)||c.length!==length))throw new Error('電子修音音訊格式不支援。');
  if(!profile.amount)return channels;
  const output=channels.map(c=>c.slice()),mono=new Float32Array(length);
  for(let i=0;i<length;i++){
    for(const c of channels){if(!Number.isFinite(c[i]))throw new Error('音訊包含無效數值。');mono[i]+=c[i]/channels.length;}
  }
  // Average down to 8 kHz before F0 estimation; the full-rate waveform is used
  // for synthesis. Uncertain/unvoiced frames and short transients pass through.
  const analysisRate=8000,low=new Float32Array(Math.ceil(length*analysisRate/rate));
  for(let i=0;i<low.length;i++){
    const start=Math.floor(i*rate/analysisRate),end=Math.min(length,Math.floor((i+1)*rate/analysisRate));
    let sum=0;for(let j=start;j<end;j++)sum+=mono[j];low[i]=sum/Math.max(1,end-start);
  }
  const hop=160,window=new Float32Array(640),frames=[];
  for(let center=0;center<low.length;center+=hop){
    window.fill(0);const from=Math.max(0,center-320),to=Math.min(low.length,center+320);
    window.set(low.subarray(from,to),from-center+320);
    const pitch=detectPitch(window,analysisRate);
    let energy=0;for(let j=Math.max(0,center-80);j<Math.min(low.length,center+80);j++)energy+=low[j]*low[j];
    frames.push(pitch.hz&&pitch.confidence>=.88&&energy/160>.000036?pitch.hz:0);
    if(frames.length%50===0)progress(Math.round(center/low.length*65));
  }
  progress(65);
  const fullHop=rate*.02;
  for(let first=0;first<frames.length;){
    if(!frames[first]){first++;continue;}
    let last=first+1;
    while(last<frames.length&&frames[last]&&Math.abs(Math.log2(frames[last]/frames[last-1]))<.2)last++;
    // Leave a guard around uncertain consonants and voiced/unvoiced transitions.
    const start=Math.ceil(first*fullHop+rate*.02),end=Math.min(length,Math.floor((last-1)*fullHop-rate*.02));
    if(end-start>=rate*.04){
      const hzAt=pos=>{
        const x=Math.max(first,Math.min(last-1,pos/fullHop)),i=Math.floor(x),f=x-i;
        return frames[i]*(1-f)+frames[Math.min(last-1,i+1)]*f;
      };
      const corrections=[];let previous=0,target=null;
      for(let f=first;f<last;f++){
        const midi=69+12*Math.log2(frames[f]/440);
        if(target===null||Math.abs(midi-target)>.55)target=Math.round(midi);
        const wanted=Math.max(-.55,Math.min(.55,target-midi))*profile.amount;
        previous+=(wanted-previous)*(1-Math.exp(-.02/profile.response));corrections.push(previous);
      }
      const ratioAt=pos=>{
        const x=Math.max(0,Math.min(corrections.length-1,pos/fullHop-first)),i=Math.floor(x),f=x-i;
        return 2**((corrections[i]*(1-f)+corrections[Math.min(i+1,corrections.length-1)]*f)/12);
      };
      const peak=(predicted,radius)=>{
        let best=Math.max(start,Math.round(predicted-radius)),value=-Infinity;
        for(let i=best;i<=Math.min(end-1,Math.round(predicted+radius));i++)if(mono[i]>value){value=mono[i];best=i;}
        return best;
      };
      const marks=[peak(start+rate/hzAt(start),rate/hzAt(start)*.45)];
      while(true){const mark=marks.at(-1),period=rate/hzAt(mark),next=peak(mark+period,period*.2);if(next>=end-period||next<=mark)break;marks.push(next);}
      if(marks.length>=4){
        const size=end-start,weight=new Float32Array(size),sum=channels.map(()=>new Float32Array(size));
        let sourceIndex=0;
        for(let targetMark=marks[0];targetMark<marks.at(-1);){
          while(sourceIndex+1<marks.length&&Math.abs(marks[sourceIndex+1]-targetMark)<Math.abs(marks[sourceIndex]-targetMark))sourceIndex++;
          const mark=marks[sourceIndex],period=rate/hzAt(mark),radius=Math.ceil(period),center=Math.round(targetMark);
          for(let d=-radius;d<=radius;d++){
            const src=mark+d,dest=center+d-start;
            if(dest<0||dest>=size||src<start||src>=end)continue;
            const w=.5+.5*Math.cos(Math.PI*d/radius);weight[dest]+=w;
            for(let c=0;c<channels.length;c++)sum[c][dest]+=channels[c][src]*w;
          }
          targetMark+=rate/(hzAt(targetMark)*ratioAt(targetMark));
        }
        for(let i=0;i<size;i++){
          // Crossfade only where grains overlap reliably, retain exact original
          // samples outside voiced regions. No gating or time displacement.
          if(weight[i]<.5)continue;
          const edge=Math.min(1,i/(rate*.015),(size-1-i)/(rate*.015));
          const blend=(.5-.5*Math.cos(Math.PI*Math.max(0,edge)))*Math.min(1,(weight[i]-.5)*2);
          for(let c=0;c<channels.length;c++)output[c][start+i]=channels[c][start+i]*(1-blend)+sum[c][i]/weight[i]*blend;
        }
      }
    }
    first=last;progress(65+Math.round(first/frames.length*35));
  }
  progress(100);return output;
}

// Copies go to the worker: the saved/raw AudioBuffer is never detached or edited.
export async function tunedVoiceBuffer(context,raw,strength='off',progress=()=>{}) {
  if(!tuningProfile(strength).amount)return raw;
  const channels=Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c).slice());
  const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./recording-tune.mjs',import.meta.url),{type:'module'});
    const timer=setTimeout(()=>finish(new Error('電子修音逾時，請改用較短錄音。')),600000);
    const finish=(error,value)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    worker.onerror=()=>finish(new Error('電子修音無法啟動，請更新頁面後重試。'));
    worker.onmessage=({data})=>{if(data.error)finish(new Error(data.error));else if(data.channels)finish(null,data.channels);else progress(data.progress);};
    worker.postMessage({channels,rate:raw.sampleRate,strength},channels.map(c=>c.buffer));
  });
  const buffer=context.createBuffer(result.length,raw.length,raw.sampleRate);
  result.forEach((c,i)=>buffer.copyToChannel(c,i));return buffer;
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope){
  self.onmessage=({data})=>{try{
    const channels=tuneChannels(data.channels,data.rate,data.strength,progress=>self.postMessage({progress}));
    self.postMessage({channels},channels.map(c=>c.buffer));
  }catch(error){self.postMessage({error:error.message});}};
}
