import { RecordingStore } from './recording-store.mjs';
const $ = id => document.getElementById(id);
export function createSingerRecorder(options) {
  const store = new RecordingStore();
  try { const saved = localStorage.getItem('karaoke.recording-mode.v1'); if (['voice','mix','off'].includes(saved)) $('recording-mode').value = saved; } catch {}
  let active = null, operation = 0, stopping = Promise.resolve(), previewURL = null;
  const status = text => { $('recording-status').textContent = text; };
  function controls() { $('recording-mode').disabled = !!active; }
  function clearPreview() {
    const audio = $('recording-audio'); audio.pause(); audio.removeAttribute('src'); audio.load(); audio.hidden = true;
    if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null;
  }
  async function render() {
    const rows = await store.list(), list = $('recording-list'); list.replaceChildren();
    if (!rows.length) { const li = document.createElement('li'); li.textContent = '尚無演唱錄音。'; list.append(li); }
    for (const row of rows) {
      const li = document.createElement('li'), label = document.createElement('strong'), info = document.createElement('small'), buttons = document.createElement('div');
      label.textContent = row.title;
      info.textContent = `${new Date(row.created).toLocaleString()} · ${row.mode === 'mix' ? '歌聲＋伴奏' : '只有歌聲'} · ${Math.round(row.seconds)} 秒${row.complete ? '' : ' · 未正常結束，保留已儲存片段'}`;
      buttons.className = 'button-row';
      for (const [text, action] of [
        ['試聽', async () => { await stop(); options.pausePlayer(); clearPreview(); previewURL = URL.createObjectURL(await store.blob(row)); $('recording-audio').src = previewURL; $('recording-audio').hidden = false; await $('recording-audio').play(); }],
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
  function stopBacking(a) { if (a.backing) { try { a.backing.stop(); } catch {} a.backing.disconnect(); a.backing = null; } }
  function syncBacking(a, time) {
    if (!a.buffer || a.recorder.state !== 'recording') return;
    if (!Number.isFinite(time) || time < 0 || time >= a.buffer.duration) { stopBacking(a); return; }
    const expected = a.anchorTime + a.context.currentTime - a.anchorContext;
    if (a.backing && Math.abs(expected - time) < .15) return;
    stopBacking(a);
    const node = a.context.createBufferSource(); node.buffer = a.buffer; node.connect(a.backingGain); node.start(0,time);
    a.backing = node; a.anchorTime = time; a.anchorContext = a.context.currentTime;
  }
  async function prepare(reference, loadBacking) {
    await stop(); clearPreview();
    const mode = $('recording-mode').value;
    if (mode === 'off') { status('本輪不保存錄音。'); return; }
    const request = ++operation;
    if (!window.MediaRecorder) throw new Error('瀏覽器不支援錄音，請使用桌機 Chrome／Edge，或選不保存錄音。');
    status(mode === 'mix' ? '正在準備錄音伴奏…' : '正在準備演唱錄音…');
    const context = options.context(), stream = options.stream();
    if (!context || !stream) throw new Error('麥克風尚未就緒，無法開始錄音。');
    await store.open();
    let buffer = null;
    if (mode === 'mix') {
      if (!reference.hasPreview) throw new Error('加伴奏錄音需要已保存的伴奏音軌；請先補建試聽音軌，或改選只有歌聲。');
      buffer = await context.decodeAudioData(await loadBacking());
    }
    if (request !== operation || options.context() !== context) throw new Error('錄音準備已取消。');
    const destination = context.createMediaStreamDestination(), mic = context.createMediaStreamSource(stream), micGain = context.createGain(), backingGain = context.createGain();
    // Only the microphone reaches pitch analysis; backing goes exclusively to the recorder.
    micGain.gain.value = mode === 'mix' ? .7 : 1; backingGain.gain.value = .3;
    mic.connect(micGain); micGain.connect(destination); backingGain.connect(destination);
    const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
    let recorder;
    try { recorder = new MediaRecorder(destination.stream, mime ? {mimeType:mime} : {}); }
    catch (error) { mic.disconnect(); micGain.disconnect(); backingGain.disconnect(); destination.stream.getTracks().forEach(t=>t.stop()); throw error; }
    const meta = { id: crypto.randomUUID(), title: reference.title, videoId: reference.videoId, mode, mime: recorder.mimeType, created: Date.now(), seconds: 0, bytes: 0, complete: false };
    const a = { recorder, context, mic, micGain, backingGain, destination, buffer, meta, chunks: [], queue: Promise.resolve(), count: 0, elapsed: 0, since: null, backing: null, error: null };
    active = a; controls();
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      a.chunks.push(event.data); meta.bytes += event.data.size; meta.seconds = elapsed(a);
      const index = a.count++, snapshot = {...meta};
      a.queue = a.queue.then(()=>store.save(snapshot,event.data,index)).catch(error => { a.error = error; status('自動保存失敗，停止後請下載備份：' + error.message); });
    };
    recorder.onerror = event => { a.error = event.error || new Error('錄音中斷'); stop(); };
    status('錄音已就緒，影片開始播放時同步錄製。');
  }
  function elapsed(a) { return a.elapsed + (a.since === null ? 0 : (performance.now()-a.since)/1000); }
  function playerState(state, time) {
    const a = active; if (!a) return;
    if (state === 1) {
      if (a.recorder.state === 'inactive') a.recorder.start(1000);
      else if (a.recorder.state === 'paused') a.recorder.resume();
      if (a.since === null) a.since = performance.now();
      syncBacking(a,time); status(`● 錄音中 · ${a.meta.mode === 'mix' ? '歌聲＋伴奏' : '只有歌聲'}（自動保存於此瀏覽器）`);
    } else if (state === 0) { stop(); }
    else {
      if (a.since !== null) { a.elapsed = elapsed(a); a.since = null; }
      if (a.recorder.state === 'recording') a.recorder.pause();
      stopBacking(a); status(a.recorder.state === 'inactive' ? '錄音已就緒，等待影片播放。' : '錄音暫停，會隨影片續播。');
    }
  }
  function stop() {
    operation++;
    const a = active; if (!a) return stopping;
    active = null; a.elapsed = elapsed(a); a.since = null; stopBacking(a); controls();
    const wasStarted = a.recorder.state !== 'inactive' || a.count > 0;
    const ended = new Promise(resolve => {
      if (a.recorder.state === 'inactive') resolve();
      else { a.recorder.onstop = resolve; a.recorder.stop(); }
    });
    stopping = (async () => {
      await ended; await a.queue;
      a.mic.disconnect(); a.micGain.disconnect(); a.backingGain.disconnect(); a.destination.stream.getTracks().forEach(t=>t.stop());
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
    if (p?.getPlayerState?.() === 1) syncBacking(a,p.getCurrentTime());
  }, 100);
  $('recording-refresh').addEventListener('click',()=>render().catch(error=>status(error.message)));
  $('recording-mode').addEventListener('change',()=>{ try { localStorage.setItem('karaoke.recording-mode.v1',$('recording-mode').value); } catch {} status($('recording-mode').value === 'off' ? '不保存錄音；從頭開始唱只收音評分。' : '按「從頭開始唱」後自動錄製；停止收音、結算或播完時保存。'); });
  window.addEventListener('pagehide',()=>{stop();clearInterval(timer);clearPreview();});
  render().catch(error=>status('瀏覽器錄音儲存不可用：'+error.message));
  return { prepare, stop, playerState, clearPreview };
}
