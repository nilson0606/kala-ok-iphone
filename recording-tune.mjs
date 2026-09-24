import { detectPitch } from './audio.mjs';

const profiles={off:{label:'關閉',amount:0,response:0,clarity:1,lock:0},light:{label:'輕度',amount:.35,response:.12,clarity:.82,lock:0},medium:{label:'中度',amount:.85,response:.025,clarity:.75,lock:.025},strong:{label:'強烈',amount:1,response:.001,clarity:.68,lock:.08}};
export function tuningProfile(value='off') {
  if(!Object.hasOwn(profiles,value))throw new Error('無效的電子修音強度。');
  return {id:value,...profiles[value]};
}
export function recordingTuningSuffix(meta) {
  const id=meta?.vocalTuning?.strength;
  return id&&id!=='off'&&Object.hasOwn(profiles,id)?`_修音${profiles[id].label}`:'';
}

// Short-window normalized autocorrelation fallback (NSDF / McLeod method).
// YIN's strict periodicity gate omitted much of real, less-periodic singing.
// See McLeod & Wyvill, ICMC 2005: https://quod.lib.umich.edu/i/icmc/bbp2372.2005.107
function fallbackPitch(input,rate,clarity) {
  const n=input.length,data=new Float32Array(n);let mean=0,energy=0;
  for(const x of input)mean+=x;mean/=n;
  for(let i=0;i<n;i++){data[i]=input[i]-mean;energy+=data[i]*data[i];}
  if(energy/n<.000036)return null;
  const max=Math.min(Math.ceil(rate/65),n>>1),min=Math.floor(rate/1000),curve=new Float64Array(max+2),peaks=[];
  for(let lag=0;lag<=max+1;lag++){
    let cross=0,norm=0;for(let i=0;i<n-lag;i++){const a=data[i],b=data[i+lag];cross+=a*b;norm+=a*a+b*b;}
    curve[lag]=norm?2*cross/norm:0;
  }
  let negative=false;
  for(let i=1;i<=max;i++){
    if(curve[i]<=0)negative=true;
    if(negative&&i>=min&&curve[i]>curve[i-1]&&curve[i]>=curve[i+1]&&curve[i]>=clarity)peaks.push(i);
  }
  if(!peaks.length)return null;
  const best=Math.max(...peaks.map(i=>curve[i])),lag=peaks.find(i=>curve[i]>=best*.92);
  const divisor=curve[lag-1]-2*curve[lag]+curve[lag+1];
  const refined=lag+(divisor ? .5*(curve[lag-1]-curve[lag+1])/divisor : 0),hz=rate/refined;
  return hz>=65&&hz<=1000?hz:null;
}

// Offline, monophonic TD-PSOLA: move overlapping pitch-synchronous grains,
// not playback speed. All channels share pitch marks; duration is unchanged.
// The target is the nearest chromatic note, not the song's reference melody.
export function tuneChannels(channels,rate,strength='off',progress=()=>{},report=()=>{}) {
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
  const hop=80,window=new Float32Array(640),frames=[],active=[];
  for(let center=0;center<low.length;center+=hop){
    window.fill(0);const from=Math.max(0,center-320),to=Math.min(low.length,center+320);
    window.set(low.subarray(from,to),from-center+320);
    const pitch=detectPitch(window,analysisRate);
    let energy=0;for(let j=Math.max(0,center-80);j<Math.min(low.length,center+80);j++)energy+=low[j]*low[j];
    const audible=energy/160>.000036;
    const hz=pitch.hz&&pitch.confidence>=.88?pitch.hz:fallbackPitch(window.subarray(160,480),analysisRate,profile.clarity);
    frames.push(audible?(hz||0):0);active.push(audible);
    if(frames.length%50===0)progress(Math.round(center/low.length*65));
  }
  progress(65);
  // Repair only one-frame dropouts between agreeing voiced neighbors.
  for(let i=1;i<frames.length-1;i++)if(!frames[i]&&active[i]&&frames[i-1]&&frames[i+1]&&Math.abs(Math.log2(frames[i-1]/frames[i+1]))<.08)frames[i]=Math.sqrt(frames[i-1]*frames[i+1]);
  const fullHop=rate*.01;let processed=0;
  for(let first=0;first<frames.length;){
    if(!frames[first]){first++;continue;}
    let last=first+1;
    while(last<frames.length&&frames[last]&&Math.abs(Math.log2(frames[last]/frames[last-1]))<.2)last++;
    // Leave a guard around uncertain consonants and voiced/unvoiced transitions.
    const start=Math.ceil(first*fullHop+rate*.01),end=Math.min(length,Math.floor((last-1)*fullHop-rate*.01));
    if(end-start>=rate*.035){
      const hzAt=pos=>{
        const x=Math.max(first,Math.min(last-1,pos/fullHop)),i=Math.floor(x),f=x-i;
        return frames[i]*(1-f)+frames[Math.min(last-1,i+1)]*f;
      };
      const corrections=[];let previous=0,target=null;
      for(let f=first;f<last;f++){
        const midi=69+12*Math.log2(frames[f]/440);
        if(target===null||Math.abs(midi-target)>.55)target=Math.round(midi);
        const wanted=Math.max(-.55,Math.min(.55,target-midi))*profile.amount;
        previous+=(wanted-previous)*(1-Math.exp(-.01/profile.response));corrections.push(previous);
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
        let sourceIndex=0,lockedIndex=0;
        const amplitudes=marks.map(mark=>{
          let energy=0,count=0;const radius=Math.ceil(rate/hzAt(mark));
          for(let j=Math.max(start,mark-radius);j<Math.min(end,mark+radius);j++){energy+=mono[j]*mono[j];count++;}
          return Math.sqrt(energy/Math.max(1,count));
        });
        for(let targetMark=marks[0];targetMark<marks.at(-1);){
          while(sourceIndex+1<marks.length&&Math.abs(marks[sourceIndex+1]-targetMark)<Math.abs(marks[sourceIndex]-targetMark))sourceIndex++;
          // Strong mode repeats a local vocal grain for 80 ms, making the
          // periodic/robotic color explicit even on an already in-tune note.
          // Preserve the current amplitude envelope, never synthesize a sine voice.
          const anchor=profile.lock?marks[0]+Math.floor((targetMark-marks[0])/(rate*profile.lock))*rate*profile.lock:targetMark;
          while(lockedIndex+1<marks.length&&Math.abs(marks[lockedIndex+1]-anchor)<Math.abs(marks[lockedIndex]-anchor))lockedIndex++;
          const mark=marks[lockedIndex],period=rate/hzAt(mark),radius=Math.ceil(period),center=Math.round(targetMark);
          const gain=Math.min(1.5,amplitudes[sourceIndex]/Math.max(1e-6,amplitudes[lockedIndex]));
          for(let d=-radius;d<=radius;d++){
            const src=mark+d,dest=center+d-start;
            if(dest<0||dest>=size||src<start||src>=end)continue;
            const w=.5+.5*Math.cos(Math.PI*d/radius);weight[dest]+=w;
            for(let c=0;c<channels.length;c++)sum[c][dest]+=channels[c][src]*w*gain;
          }
          targetMark+=rate/(hzAt(targetMark)*ratioAt(targetMark));
        }
        for(let i=0;i<size;i++){
          // Crossfade only where grains overlap reliably, retain exact original
          // samples outside voiced regions. No gating or time displacement.
          if(weight[i]<.5)continue;
          const edge=Math.min(1,i/(rate*.015),(size-1-i)/(rate*.015));
          const blend=(.5-.5*Math.cos(Math.PI*Math.max(0,edge)))*Math.min(1,(weight[i]-.5)*2);
          if(blend>.1)processed++;
          for(let c=0;c<channels.length;c++)output[c][start+i]=channels[c][start+i]*(1-blend)+sum[c][i]/weight[i]*blend;
        }
      }
    }
    first=last;progress(65+Math.round(first/frames.length*35));
  }
  report({processedSeconds:processed/rate,duration:length/rate});progress(100);return output;
}

// Copies go to the worker: the saved/raw AudioBuffer is never detached or edited.
export async function tunedVoiceBuffer(context,raw,strength='off',progress=()=>{},report=()=>{}) {
  if(!tuningProfile(strength).amount)return raw;
  const channels=Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c).slice());
  const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./recording-tune.mjs',import.meta.url),{type:'module'});
    const timer=setTimeout(()=>finish(new Error('電子修音逾時，請改用較短錄音。')),600000);
    const finish=(error,value)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    worker.onerror=()=>finish(new Error('電子修音無法啟動，請更新頁面後重試。'));
    worker.onmessage=({data})=>{if(data.error)finish(new Error(data.error));else if(data.channels){report(data.report);finish(null,data.channels);}else progress(data.progress);};
    worker.postMessage({channels,rate:raw.sampleRate,strength},channels.map(c=>c.buffer));
  });
  const buffer=context.createBuffer(result.length,raw.length,raw.sampleRate);
  result.forEach((c,i)=>buffer.copyToChannel(c,i));return buffer;
}
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope){
  self.onmessage=({data})=>{try{
    let report;const channels=tuneChannels(data.channels,data.rate,data.strength,progress=>self.postMessage({progress}),value=>{report=value;});
    self.postMessage({channels,report},channels.map(c=>c.buffer));
  }catch(error){self.postMessage({error:error.message});}};
}
