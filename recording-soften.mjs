// Graded timbre effect on the singer bus: shelf + presence dip + high cut.
// This softens bright/breathy texture; it does not isolate or remove breath sounds.
const presets={off:{label:'關閉',maxDb:0},light:{label:'輕度',baseDb:2,maxDb:5,shelf:3500,presence:1,cutoff:12000},medium:{label:'中度',baseDb:5,maxDb:11,shelf:2800,presence:3,cutoff:7500},strong:{label:'強烈',baseDb:10,maxDb:18,shelf:2000,presence:6,cutoff:4500}};
export function softeningProfile(value='off') {
  if(!Object.hasOwn(presets,value))throw new Error('無效的歌聲柔化強度。');
  return {id:value,...presets[value]};
}
export function recordingSofteningSuffix(meta) {
  const id=meta?.vocalSoftening?.strength;
  return id&&id!=='off'&&Object.hasOwn(presets,id)?`_柔化${id==="strong"&&!(meta.vocalSoftening.version>=2)?"較強":presets[id].label}`:'';
}
export async function softenedVoice(context,source,raw,placement,strength='off') {
  const profile=softeningProfile(strength);
  if(!profile.maxDb)return source;
  const shelf=context.createBiquadFilter();shelf.type='highshelf';shelf.frequency.value=profile.shelf;shelf.gain.value=-profile.baseDb;source.connect(shelf);
  const presence=context.createBiquadFilter();presence.type='peaking';presence.frequency.value=2500;presence.Q.value=1.1;presence.gain.value=-profile.presence;shelf.connect(presence);
  const cutoff=context.createBiquadFilter();cutoff.type='lowpass';cutoff.frequency.value=Math.min(profile.cutoff,raw.sampleRate*.45);cutoff.Q.value=Math.SQRT1_2;presence.connect(cutoff);
  const rate=raw.sampleRate,hop=Math.max(1,Math.round(rate*.02));
  const channels=Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c));
  const low=new Float64Array(channels.length),alpha=1-Math.exp(-2*Math.PI*2500/rate);
  const first=Math.floor(placement.source*rate),end=Math.min(raw.length,Math.ceil((placement.source+placement.duration)*rate));
  let reduction=-profile.baseDb,block=0;
  for(let start=first;start<end;start+=hop){
    let total=0,high=0;const stop=Math.min(end,start+hop);
    for(let i=start;i<stop;i++)for(let c=0;c<channels.length;c++){
      const x=channels[c][i];low[c]+=alpha*(x-low[c]);const h=x-low[c];total+=x*x;high+=h*h;
    }
    const rms=Math.sqrt(total/Math.max(1,(stop-start)*channels.length));
    const ratio=Math.sqrt(high/Math.max(total,1e-20));
    // A fixed tonal change makes the option audible even when the old dynamic
    // detector would stay inactive; extra attenuation follows bright passages.
    const activity=Math.min(1,Math.max(0,(20*Math.log10(Math.max(rms,1e-10))+60)/18));
    const target=-profile.baseDb-(profile.maxDb-profile.baseDb)*Math.min(1,Math.max(0,(ratio-.12)/.35))*activity;
    const seconds=(stop-start)/rate,tau=target < reduction ? .025 : .15;
    reduction+=(target-reduction)*(1-Math.exp(-seconds/tau));
    shelf.gain.linearRampToValueAtTime(reduction,placement.when+(stop-first)/rate);
    if(++block%100===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return cutoff;
}
