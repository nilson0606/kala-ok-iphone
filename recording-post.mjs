import { rescoreRecording, remixRecording, wavBlob, delaySeconds } from './recording-process.mjs';
const $=id=>document.getElementById(id), BASE='http://127.0.0.1:4174';
async function localRequest(path,body) {
  let response;
  try {
    const session=await fetch(BASE+'/session',{signal:AbortSignal.timeout(8000)});
    if(!session.ok)throw new Error();const info=await session.json();
    if(body&&!info.features?.includes('recording-mp3'))throw new Error('請更新並重新啟動本機工具，才能轉 MP3。');
    response=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'X-Karaoke-Token':info.token,...(body?{'Content-Type':'application/octet-stream'}:{})},body,signal:AbortSignal.timeout(body?180000:30000)});
  }catch(error){throw new Error(error.message.includes('MP3')?error.message:'無法連接本機工具，請啟動後再試。');}
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'所需音軌不存在，請還原相同版本的歌曲音軌。');}
  return response;
}
export function createRecordingPost({store,stop,pause}) {
  let rows=[],selected=null,busy=false,url=null;
  const status=text=>{$('post-status').textContent=text;};
  function clearAudio(){const a=$('post-audio');a.pause();a.removeAttribute('src');a.load();a.hidden=true;if(url)URL.revokeObjectURL(url);url=null;}
  function controls(){
    const editable=!!(selected?.complete&&selected.rawBytes&&selected.post?.segments?.length);
    $('post-recording').disabled=busy;$('post-delay').disabled=busy||!editable;
    $('post-rescore').disabled=busy||!editable;$('post-remix').disabled=busy||!editable;$('post-mp3').disabled=busy||!selected;
  }
  function choose(){
    clearAudio();selected=rows.find(x=>x.id===$('post-recording').value)||null;
    $('post-delay').value=selected?.postResult?.delayMs??selected?.post?.offsetMs??0;
    $('post-info').textContent=selected?(selected.post&&selected.rawBytes?'已保存乾淨歌聲、播放位置與當次基準，可重評／重合成。':'此錄音未保存後處理來源，可轉 MP3 下載。'): '請先保存一段演唱錄音。';
    showScore();controls();
  }
  function showScore(){const r=selected?.postResult;$('post-score').textContent=r?`校正 ${r.delayMs} ms · 總分 ${r.score??'—'} · 音準 ${r.pitch} · 進拍 ${r.rhythm} · 完整度 ${r.coverage}`:'';}
  function refresh(value){rows=value;const old=$('post-recording').value;const options=rows.map(row=>{const o=document.createElement('option');o.value=row.id;o.textContent=`${row.title} · ${new Date(row.created).toLocaleString()}`;return o;});$('post-recording').replaceChildren(...options);if(rows.some(r=>r.id===old))$('post-recording').value=old;if(selected?.id===old&&rows.some(r=>r.id===old)){selected=rows.find(r=>r.id===old);controls();}else if(!busy)choose();}
  function select(id){$('post-recording').value=id;choose();$('recording-post').scrollIntoView({block:'start'});}
  async function run(action){if(busy||!selected)return;busy=true;controls();try{await stop();pause();const row=selected;if(row)await action(row);}catch(error){status(error.message);}finally{busy=false;controls();}}
  $('post-recording').addEventListener('change',choose);
  $('post-rescore').addEventListener('click',()=>run(async row=>{
    const delayMs=Number($('post-delay').value);delaySeconds(delayMs);status('正在以當次基準重新評分…');
    row.postResult={...rescoreRecording(row.post,delayMs),delayMs};await store.save(row);showScore();status('重評完成，已保存於這筆錄音；原始成績紀錄保留。');
  }));
  $('post-remix').addEventListener('click',()=>run(async row=>{
    const delayMs=Number($('post-delay').value);delaySeconds(delayMs);status('正在載入乾淨歌聲與配樂／和音…');
    const context=new AudioContext();
    try{
      const raw=await context.decodeAudioData(await (await store.blob(row,'voice')).arrayBuffer()),tracks=[];
      if(row.mode==='mix')for(const stem of row.stems){const response=await localRequest(`/library/${row.post.reference.cacheId}/${stem}`);tracks.push(await context.decodeAudioData(await response.arrayBuffer()));}
      status('正在校正歌聲位置並合成…');
      const audio=await remixRecording(raw,tracks,row,delayMs),blob=wavBlob(audio);
      const result={id:crypto.randomUUID(),title:`${row.title}（校正 ${delayMs} ms）`,videoId:row.videoId,mode:row.mode,stems:row.stems,mime:'audio/wav',created:Date.now(),seconds:audio.duration,bytes:blob.size,complete:true,parentId:row.id,delayMs};
      await store.save(result,blob,0);refresh(await store.list());$('post-recording').value=result.id;choose();clearAudio();url=URL.createObjectURL(blob);$('post-audio').src=url;$('post-audio').hidden=false;
      status('已另存校正後錄音，請按下方播放鍵試聽；可按「轉 MP3 並下載」。原錄音保留，可選回它再調整。');
      window.dispatchEvent(new Event('recording-post-saved'));
    }finally{await context.close();}
  }));
  $('post-mp3').addEventListener('click',()=>run(async row=>{
    status('正在本機轉成 MP3…');const blob=await store.blob(row),response=await localRequest('/recordings/mp3',blob),mp3=await response.blob();
    const href=URL.createObjectURL(mp3),a=document.createElement('a');a.href=href;a.download=row.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)+'.mp3';a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);status('MP3 已轉換並開始下載。');
  }));
  window.addEventListener('pagehide',clearAudio);
  return {refresh,select};
}
