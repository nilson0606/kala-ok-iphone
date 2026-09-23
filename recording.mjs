import { createRecordingPost } from './recording-post.mjs';
import { createRecordingMix, mixSettings } from './recording-mix.mjs';
import { RecordingStore } from './recording-store.mjs';
const $ = id => document.getElementById(id);
export function createSingerRecorder(options) {
  const store = new RecordingStore();
  try { const saved = localStorage.getItem('karaoke.recording-mode.v1'); if (['voice','mix','off'].includes(saved)) $('recording-mode').value = saved; } catch {}
  let active = null, operation = 0, stopping = Promise.resolve(), previewURL = null;
  try {
    const saved = mixSettings(JSON.parse(localStorage.getItem('karaoke.recording-balance.v1') || '{}'));
    $('recording-manual').checked = saved.manual; $('recording-voice-level').value = saved.voice; $('recording-backing-level').value = saved.backing;
  } catch {}
  function balanceSettings() { return mixSettings({manual:$('recording-manual').checked,voice:Number($('recording-voice-level').value),backing:Number($('recording-backing-level').value)}); }
  const post = createRecordingPost({store, stop:()=>stop(), reference:options.reference, pause:options.pausePlayer});
  const status = text => { $('recording-status').textContent = text; };
  function controls() {
    const mode=$('recording-mode').value, manual=$('recording-manual').checked;
    $('recording-mode').disabled = !!active;
    $('recording-manual').disabled = !!active || mode==='off';
    $('recording-voice-level').disabled = !!active || mode==='off' || !manual;
    $('recording-backing-level').disabled = !!active || mode!=='mix' || !manual;
    $('recording-voice-value').textContent = $('recording-voice-level').value+'%';
    $('recording-backing-value').textContent = $('recording-backing-level').value+'%';
    if (!active) $('recording-balance-status').textContent = mode==='off' ? '不保存錄音，音量平衡不啟動。' : `${manual ? '手動＋自動微調' : '自動平衡'} · 只影響錄音，不影響評分；每輪開始前設定。`;
    $('recording-balance-help').textContent = mode==='off' ? '已關閉錄音，音量平衡不啟動。' : manual ? '手動＋自動：依你的音量設定，兩路各自最多微調 ±3 dB。0% 保持靜音；每輪開始後固定設定。' : '自動平衡：依歌唱者及配樂／和音音量平滑調整，各自最多修正 ±6 dB。下方手動音量不參與；每輪開始後固定設定。';
  }
  function clearPreview() {
    const audio = $('recording-audio'); audio.pause(); audio.removeAttribute('src'); audio.load(); audio.hidden = true;
    if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null;
  }
  async function render() {
    const rows = await store.list(), list = $('recording-list'); list.replaceChildren(); post.refresh(rows);
    if (!rows.length) { const li = document.createElement('li'); li.textContent = '尚無演唱錄音。'; list.append(li); }
    for (const row of rows) {
      const li = document.createElement('li'), label = document.createElement('strong'), info = document.createElement('small'), buttons = document.createElement('div');
      label.textContent = row.title;
      info.textContent = `${new Date(row.created).toLocaleString()} · ${row.mode === 'mix' ? (row.stems?.includes('backing') ? '歌唱者＋配樂／和音' : '歌唱者＋配樂（無獨立和音）') : '歌唱者'}${row.balance ? (row.balance.manual ? ' · 手動＋自動' : ' · 自動平衡') : ''} · ${Math.round(row.seconds)} 秒${row.complete ? '' : ' · 未正常結束，保留已儲存片段'}`;
      buttons.className = 'button-row';
      for (const [text, action] of [
        ['試聽', async () => { await stop(); options.pausePlayer(); clearPreview(); previewURL = URL.createObjectURL(await store.blob(row)); $('recording-audio').src = previewURL; $('recording-audio').hidden = false; await $('recording-audio').play(); }],
        ['後處理', async () => { await stop(); post.select(row.id); }],
        ['下載', async () => download(await store.blob(row), row)],
        ['刪除', async () => { clearPreview(); await store.delete(row.id); await render(); }],
      ]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = text;
        button.addEventListener('click', async () => { button.disabled = true; try { await action(); } catch (error) { status(error.message); } finally { button.disabled = false; } }); buttons.append(button);
      }
      li.append(label, info, buttons); list.append(li);
    }
  }
  function download(blob, meta) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${meta.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)}-${new Date(meta.created).toISOString().replace(/[:.]/g,'-')}.${meta.mime.includes('mp4') ? 'm4a' : 'webm'}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function stopBacking(a) {
    for (const node of a.backing) { try { node.stop(); } catch {} node.disconnect(); }
    a.backing = [];
  }
  function syncBacking(a, time) {
    if (!a.buffers.length || a.recorder.state !== 'recording') return;
    if (!Number.isFinite(time) || time < 0 || a.buffers.every(buffer => time >= buffer.duration)) { stopBacking(a); return; }
    const expected = a.anchorTime + a.context.currentTime - a.anchorContext;
    if (a.backing.length && Math.abs(expected - time) < .15) return;
    stopBacking(a);
    const when = a.context.currentTime;
    // Start accompaniment and harmony on the same audio clock; both follow seeks/pauses.
    for (const buffer of a.buffers) {
      if (time >= buffer.duration) continue;
      const node = a.context.createBufferSource(); node.buffer = buffer; node.connect(a.mix.input); node.start(when,time);
      a.backing.push(node);
    }
    a.anchorTime = time; a.anchorContext = when;
  }
  async function prepare(reference, loadStem, scoring = {}) {
    await stop(); clearPreview();
    const mode = $('recording-mode').value;
    if (mode === 'off') { status('本輪不保存錄音。'); return; }
    const request = ++operation;
    if (!window.MediaRecorder) throw new Error('瀏覽器不支援錄音，請使用桌機 Chrome／Edge，或選不保存錄音。');
    status(mode === 'mix' ? '正在準備錄音配樂／和音…' : '正在準備演唱錄音…');
    const context = options.context(), stream = options.stream();
    if (!context || !stream) throw new Error('麥克風尚未就緒，無法開始錄音。');
    await store.open();
    const stems = [], buffers = [];
    if (mode === 'mix') {
      if (!reference.hasPreview) throw new Error('混音錄音需要已保存的分離音軌；請先補建試聽音軌，或改選歌唱者。');
      // hasPreview is verified by the local library against every required file.
      // Never substitute vocals/lead: that would put the original singer back in.
      stems.push('accompaniment');
      if (reference.vocalMode === 'lead') stems.push('backing');
      for (const stem of stems) {
        buffers.push(await context.decodeAudioData(await loadStem(stem)));
        if (request !== operation || options.context() !== context) throw new Error('錄音準備已取消。');
      }
      if (buffers.some(buffer => Math.abs(buffer.duration - buffers[0].duration) > .15)) throw new Error('配樂與和音長度不一致，請補建音軌後再錄音。');
    }
    if (request !== operation || options.context() !== context) throw new Error('錄音準備已取消。');
    const destination = context.createMediaStreamDestination(), mic = context.createMediaStreamSource(stream);
    // This separate recording branch never changes the input used for pitch scoring.
    const mix = createRecordingMix(context,mic,destination,{mode,settings:balanceSettings(),voiced:()=>options.voiced?.() === true});
    const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
    let recorder, rawRecorder;
    try { recorder = new MediaRecorder(destination.stream, mime ? {mimeType:mime} : {}); rawRecorder = new MediaRecorder(stream, mime ? {mimeType:mime} : {}); }
    catch (error) { mix.disconnect(); destination.stream.getTracks().forEach(t=>t.stop()); throw error; }
    const meta = { id: crypto.randomUUID(), title: reference.title, videoId: reference.videoId, mode, mime: recorder.mimeType, created: Date.now(), seconds: 0, bytes: 0, complete: false, balance: mix.settings, stems, rawBytes:0, post:{version:1, reference:structuredClone(reference), scoring, offsetMs:Number($('offset').value), segments:[], samples:[]} };
    const a = { recorder, rawRecorder, rawCount:0, segment:null, context, mic, mix, destination, buffers, meta, chunks: [], queue: Promise.resolve(), count: 0, elapsed: 0, since: null, backing: [], error: null };
    active = a; controls();
    rawRecorder.ondataavailable = event => {
      if (!event.data.size) return;
      meta.rawBytes += event.data.size;
      const index=a.rawCount++, snapshot=structuredClone(meta);
      a.queue=a.queue.then(()=>store.save(snapshot,event.data,index,'voice')).catch(error=>{a.error=error;status('乾淨歌聲保存失敗：'+error.message);});
    };
    rawRecorder.onerror = event => { a.error = event.error || new Error('乾淨歌聲錄音中斷'); stop(); };
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      a.chunks.push(event.data); meta.bytes += event.data.size; meta.seconds = elapsed(a);
      const index = a.count++, snapshot = structuredClone(meta);
      a.queue = a.queue.then(()=>store.save(snapshot,event.data,index)).catch(error => { a.error = error; status('自動保存失敗，停止後請下載備份：' + error.message); });
    };
    recorder.onerror = event => { a.error = event.error || new Error('錄音中斷'); stop(); };
    status(`錄音已就緒${mode === 'mix' ? (stems.includes('backing') ? ' · 已載入伴奏＋和音' : ' · 已載入伴奏（此版本無獨立和音）') : ''}，影片開始播放時同步錄製。`);
  }
  function closeSegment(a) {
    if (a.segment) { a.segment.duration=Math.max(0,elapsed(a)-a.segment.offset); a.segment=null; }
  }
  function syncTimeline(a,time) {
    const offset=elapsed(a);
    if (a.segment && Math.abs(a.segment.songTime+offset-a.segment.offset-time)<.15) return;
    closeSegment(a); a.segment={offset,songTime:time,duration:0}; a.meta.post.segments.push(a.segment);
  }
  function sample(time,hz) {
    const a=active; if(!a || a.recorder.state!=='recording')return;
    a.meta.post.samples.push({time,hz,offset:elapsed(a)});
  }
  function elapsed(a) { return a.elapsed + (a.since === null ? 0 : (performance.now()-a.since)/1000); }
  function playerState(state, time) {
    const a = active; if (!a) return;
    if (state === 1) {
      if (a.recorder.state === 'inactive') { a.recorder.start(1000); a.rawRecorder.start(1000); }
      else if (a.recorder.state === 'paused') { a.recorder.resume(); a.rawRecorder.resume(); }
      if (a.since === null) a.since = performance.now();
      syncTimeline(a,time); syncBacking(a,time); status(`● 錄音中 · ${a.meta.mode === 'mix' ? (a.meta.stems.includes('backing') ? '歌唱者＋配樂／和音' : '歌唱者＋配樂（無獨立和音）') : '歌唱者'}（自動保存於此瀏覽器）`);
    } else if (state === 0) { stop(); }
    else {
      closeSegment(a);
      if (a.since !== null) { a.elapsed = elapsed(a); a.since = null; }
      if (a.recorder.state === 'recording') { a.recorder.pause(); a.rawRecorder.pause(); }
      stopBacking(a); status(a.recorder.state === 'inactive' ? '錄音已就緒，等待影片播放。' : '錄音暫停，會隨影片續播。');
    }
  }
  function stop() {
    operation++;
    const a = active; if (!a) return stopping;
    closeSegment(a); active = null; a.elapsed = elapsed(a); a.since = null; stopBacking(a); controls();
    const wasStarted = a.recorder.state !== 'inactive' || a.count > 0;
    const ended = Promise.all([a.recorder,a.rawRecorder].map(recorder=>new Promise(resolve=>{
      if(recorder.state==='inactive')resolve();else {recorder.onstop=resolve;recorder.stop();}
    })));
    stopping = (async () => {
      await ended; await a.queue;
      a.mix.disconnect(); a.destination.stream.getTracks().forEach(t=>t.stop());
      if (!wasStarted || !a.meta.bytes) { status('未開始播放，沒有保存空白錄音。'); return; }
      a.meta.seconds = a.elapsed; a.meta.complete = true;
      try {
        if (a.error) throw a.error;
        await store.save(a.meta); status('演唱錄音已保存，可在下方試聽或下載。');
      } catch (error) {
        const panel = $('recording-rescue'); panel.hidden = false;
        const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(a.chunks,{type:a.meta.mime})); link.download = '演唱錄音.'+(a.meta.mime.includes('mp4')?'m4a':'webm');
        link.textContent = `下載未保存錄音：${a.meta.title}（${new Date(a.meta.created).toLocaleTimeString()}）`; panel.append(link);
        status('錄音未完整保存，請先按「下載未保存錄音」備份：'+error.message);
      }
      await render().catch(error=>status('無法讀取錄音清單：'+error.message));
    })();
    return stopping;
  }
  const timer = setInterval(() => {
    const a = active; if (!a || a.recorder.state !== 'recording') return;
    const p = options.player();
    if (p?.getPlayerState?.() === 1) {
      syncTimeline(a,p.getCurrentTime()); syncBacking(a,p.getCurrentTime());
      const levels = a.mix.update();
      $('recording-balance-status').textContent = `${a.meta.balance.manual ? '手動＋自動微調' : '自動平衡'} · 人聲修正 ${levels.voiceDb.toFixed(1)} dB${a.meta.mode==='mix' ? ` · 配樂／和音修正 ${levels.backingDb.toFixed(1)} dB` : ''} · 輸出峰值保護開啟`;
    }
  }, 100);
  window.addEventListener('recording-post-saved',()=>render().catch(error=>status(error.message)));
  $('recording-refresh').addEventListener('click',()=>render().catch(error=>status(error.message)));
  $('recording-mode').addEventListener('change',()=>{ controls(); try { localStorage.setItem('karaoke.recording-mode.v1',$('recording-mode').value); } catch {} status($('recording-mode').value === 'off' ? '不保存錄音；從頭開始唱只收音評分。' : '按「從頭開始唱」後自動錄製；停止收音、結算或播完時保存。'); });
  for(const id of ['recording-manual','recording-voice-level','recording-backing-level']) $(id).addEventListener('input',()=>{
    controls(); try {localStorage.setItem('karaoke.recording-balance.v1',JSON.stringify(balanceSettings()));} catch {}
    $('recording-balance-status').textContent = $('recording-manual').checked ? '下一輪使用手動比例＋自動微調；只影響錄音。' : '下一輪使用自動平衡；只影響錄音。';
  });
  controls();
  window.addEventListener('pagehide',()=>{stop();clearInterval(timer);clearPreview();});
  render().catch(error=>status('瀏覽器錄音儲存不可用：'+error.message));
  return { prepare, stop, playerState, clearPreview, sample, referenceChanged:post.controls };
}
