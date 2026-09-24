import { detectPitch } from './audio.mjs';

const profiles={off:{label:'關閉',amount:0,synth:0},light:{label:'輕度',amount:1,synth:.18},medium:{label:'中度',amount:1,synth:.48},strong:{label:'強烈',amount:1,synth:.78}};
export function tuningProfile(value='off') {
  if(!Object.hasOwn(profiles,value))throw new Error('無效的合成器效果強度。');
  return {id:value,...profiles[value]};
}
export function recordingTuningSuffix(meta) {
  const id=meta?.vocalTuning?.strength;
  return id&&id!=='off'&&Object.hasOwn(profiles,id)?`_${meta.vocalTuning.version>=3?"合成器":"修音"}${profiles[id].label}`:'';
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

// A warm, band-limited keyboard/lead wavetable with decreasing harmonics.
// No pulse train, frozen vocal grains or vocoder-like robotic modulation. Normalize RMS so strength is a timbre
// control rather than an implicit volume boost. No model or MIDI file needed.
function synthTable(rate,maxHz) {
  const size=4096,table=new Float32Array(size+1),harmonics=Math.max(1,Math.min(7,Math.floor(Math.min(7000,rate*.45)/maxHz)));
  let energy=0;
  for(let i=0;i<size;i++){
    const phase=2*Math.PI*i/size;let value=0;
    for(let h=1;h<=harmonics;h++){
      const amplitude=[0,1,.32,.16,.09,.05,.025,.012][h];
      value+=amplitude*Math.cos(h*phase);
    }
    table[i]=value;energy+=value*value;
  }
  const scale=1/Math.sqrt(energy/size);
  for(let i=0;i<size;i++)table[i]*=scale;table[size]=table[0];return table;
}

// Blend a separate musical synth voice into the original vocal. The original
// waveform is not retuned, chopped or time-stretched. Strength changes the
// instrument/voice blend, not the amount of robotic pitch locking.
export function tuneChannels(channels,rate,strength='off',progress=()=>{},report=()=>{}) {
  const profile=tuningProfile(strength),length=channels[0]?.length;
  if(!channels.length||channels.length>8||!Number.isInteger(rate)||rate<8000||rate>192000||!length||length>rate*3600||channels.some(c=>!(c instanceof Float32Array)||c.length!==length))throw new Error('合成器效果音訊格式不支援。');
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
    const hz=pitch.hz&&pitch.confidence>=.88?pitch.hz:fallbackPitch(window.subarray(160,480),analysisRate,.75);
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
    const start=Math.ceil(first*fullHop+rate*.01),end=Math.min(length,Math.floor((last-1)*fullHop-rate*.01));
    if(end-start>=rate*.035){
      const melody=[],envelopes=channels.map(()=>[]);let smoothed=null,target=null;
      for(let f=first;f<last;f++){
        const midi=69+12*Math.log2(frames[f]/440);
        if(target===null||Math.abs(midi-target)>.6)target=Math.round(midi);
        // Soft note transitions on the instrument only; the singer stays intact.
        smoothed=smoothed===null?midi:smoothed+(target-smoothed)*(1-Math.exp(-.01/.04));
        melody.push(440*2**((smoothed-69)/12));
        const center=Math.round(f*fullHop),from=Math.max(start,center-Math.round(rate*.01)),to=Math.min(end,center+Math.round(rate*.01));
        for(let c=0;c<channels.length;c++){
          let energy=0;for(let j=from;j<to;j++)energy+=channels[c][j]**2;
          envelopes[c].push(Math.sqrt(energy/Math.max(1,to-from)));
        }
      }
      // Loop instead of spread: a sustained tone may contain many frames.
      let highest=0;for(const hz of melody)highest=Math.max(highest,hz);
      const table=synthTable(rate,highest);let phase=0;
      for(let position=start;position<end;position++){
        const x=Math.max(0,Math.min(melody.length-1,position/fullHop-first)),index=Math.floor(x),fraction=x-index,next=Math.min(melody.length-1,index+1);
        const hz=melody[index]*(1-fraction)+melody[next]*fraction;
        phase=(phase+hz/rate)%1;
        const lookup=phase*4096,i=Math.floor(lookup),part=lookup-i;
        const carrier=table[i]*(1-part)+table[i+1]*part;
        const edge=Math.max(0,Math.min(1,(position-start)/(rate*.02),(end-1-position)/(rate*.02)));
        const fade=.5-.5*Math.cos(Math.PI*edge),wet=profile.synth*fade;
        if(fade>.1)processed++;
        for(let c=0;c<channels.length;c++){
          const envelope=envelopes[c][index]*(1-fraction)+envelopes[c][next]*fraction;
          output[c][position]=channels[c][position]*(1-wet)+carrier*envelope*wet;
        }
      }
    }
    first=last;progress(65+Math.round(first/frames.length*35));
  }
  report({processedSeconds:processed/rate,duration:length/rate,synthMix:profile.synth});progress(100);return output;
}

// Copies go to the worker: the saved/raw AudioBuffer is never detached or edited.
export async function tunedVoiceBuffer(context,raw,strength='off',progress=()=>{},report=()=>{}) {
  if(!tuningProfile(strength).amount)return raw;
  const channels=Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c).slice());
  const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./recording-tune.mjs',import.meta.url),{type:'module'});
    const timer=setTimeout(()=>finish(new Error('合成器效果處理逾時，請改用較短錄音。')),600000);
    const finish=(error,value)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    worker.onerror=()=>finish(new Error('合成器效果無法啟動，請更新頁面後重試。'));
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
