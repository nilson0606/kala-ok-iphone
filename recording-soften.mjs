// Conservative dynamic high-shelf attenuation on the singer bus only.
// This softens bright/breathy texture; it does not isolate or remove breath sounds.
const presets={off:{label:'關閉',maxDb:0},light:{label:'輕度',maxDb:3},medium:{label:'中度',maxDb:5},strong:{label:'較強',maxDb:8}};
export function softeningProfile(value='off') {
  if(!Object.hasOwn(presets,value))throw new Error('無效的歌聲柔化強度。');
  return {id:value,...presets[value]};
}
export function recordingSofteningSuffix(meta) {
  const id=meta?.vocalSoftening?.strength;
  return id&&id!=='off'&&Object.hasOwn(presets,id)?`_柔化${presets[id].label}`:'';
}
export async function softenedVoice(context,source,raw,placement,strength='off') {
  const profile=softeningProfile(strength);
  if(!profile.maxDb)return source;
  const shelf=context.createBiquadFilter();shelf.type='highshelf';shelf.frequency.value=3500;shelf.gain.value=0;source.connect(shelf);
  const rate=raw.sampleRate,hop=Math.max(1,Math.round(rate*.02));
  const channels=Array.from({length:raw.numberOfChannels},(_,c)=>raw.getChannelData(c));
  const low=new Float64Array(channels.length),alpha=1-Math.exp(-2*Math.PI*2500/rate);
  const first=Math.floor(placement.source*rate),end=Math.min(raw.length,Math.ceil((placement.source+placement.duration)*rate));
  let reduction=0,block=0;
  for(let start=first;start<end;start+=hop){
    let total=0,high=0;const stop=Math.min(end,start+hop);
    for(let i=start;i<stop;i++)for(let c=0;c<channels.length;c++){
      const x=channels[c][i];low[c]+=alpha*(x-low[c]);const h=x-low[c];total+=x*x;high+=h*h;
    }
    const rms=Math.sqrt(total/Math.max(1,(stop-start)*channels.length));
    const ratio=Math.sqrt(high/Math.max(total,1e-20));
    // No boost, no hard gate; reduce only while appreciable upper-band energy is present.
    const activity=Math.min(1,Math.max(0,(20*Math.log10(Math.max(rms,1e-10))+60)/18));
    const target=-profile.maxDb*Math.min(1,Math.max(0,(ratio-.22)/.4))*activity;
    const seconds=(stop-start)/rate,tau=target < reduction ? .025 : .15;
    reduction+=(target-reduction)*(1-Math.exp(-seconds/tau));
    shelf.gain.linearRampToValueAtTime(reduction,placement.when+(stop-first)/rate);
    if(++block%100===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return shelf;
}
