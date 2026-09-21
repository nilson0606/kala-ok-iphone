import { youtubeId, noteOf } from './audio.mjs';
import { ScoringTake, validateReference, savedResult, pitchDifference } from './scoring.mjs';
const $ = id => document.getElementById(id);
const BASE = 'http://127.0.0.1:4174';
const HISTORY = 'karaoke.scores.v1';
export function createKaraokeSession(options) {
  let reference = null, take = null, jobId = null, token = null, generation = 0, timer;
  let phase = 'idle', loadedVideo = null, lastProgress = 0;
  let previewUrl = null, previewRequest = null, previewSerial = 0;
  const message = text => { $('score-status').textContent = text; };
  function controls() {
    $('prepare-song').disabled = ['preparing', 'finishing'].includes(phase);
    $('keep-preview').disabled = ['preparing', 'finishing'].includes(phase);
    for (const stem of ['vocals','accompaniment']) $('preview-' + stem).disabled = !reference?.hasPreview || ['preparing','finishing'].includes(phase);
    $('library-list').querySelectorAll('button').forEach(button => button.disabled = ['preparing','finishing'].includes(phase));
    $('pitch-mode').disabled = !!take;
    $('url').disabled = ['preparing', 'finishing'].includes(phase);
    $('clip-seconds').disabled = ['preparing', 'finishing'].includes(phase);
    $('cancel-song').disabled = phase === 'finishing' || (!jobId && phase !== 'preparing' && !reference);
    $('sing-start').disabled = !reference || !options.micReady() || phase === 'finishing';
    $('finish-song').disabled = !take || ['result', 'finishing'].includes(phase);
    $('song-form').querySelector('button').disabled = ['preparing', 'finishing'].includes(phase);
  }
  async function api(url, init = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(BASE + url, { ...init, signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { ...(token ? { 'X-Karaoke-Token': token } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '本機工具連線失敗。');
      return data;
    } finally { clearTimeout(timeout); }
  }
  async function removeJob(id) {
    if (!id || !token) return true;
    try { await api(`/jobs/${id}`, { method: 'DELETE' }); return true; } catch { return false; }
  }
  function beatReset() {
    $('beat-toggle').disabled = false; $('bpm').disabled = false;
    $('beat-note').textContent = '手動節拍燈，沒有歌曲基準時不代表實際歌曲拍點。';
    [...$('beats').children].forEach(dot => dot.classList.remove('active'));
  }
  async function clear(text = '已取消／卸載本次工作；已保存的歌曲仍在本機歌曲庫。', finishing = false) {
    generation++; clearTimeout(timer); stopPreview();
    const id = jobId; jobId = null; reference = null;
    take?.clear(); take = null; phase = finishing ? 'finishing' : 'idle';
    beatReset(); $('live-feedback').textContent = '等待歌曲基準'; $('target-note').textContent = '—'; $('prepare-status').textContent = text;
    message('準備歌曲並開啟麥克風後，按播放就開始評分。'); controls();
    if (!await removeJob(id)) $('prepare-status').textContent = text + ' 本機工具未回覆清除結果；閒置工作會於約 15 分鐘後自動清理。';
  }
  async function ensureSession() {
    const response = await fetch(BASE + '/session', { credentials: 'omit', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('請先啟動本機工具。');
    const data = await response.json();
    if (!data.token || !data.features?.includes('library')) throw new Error('本機工具需要更新，請停止後重新啟動 start-local.ps1。');
    token = data.token;
  }
  function stopPreview() {
    previewSerial++; previewRequest?.abort(); previewRequest = null;
    const audio = $('stem-audio'); audio.pause(); audio.removeAttribute('src'); audio.load();
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    $('preview-status').textContent = '尚未載入試聽音軌。';
  }
  async function playPreview(stem) {
    if (!reference?.hasPreview || !reference.cacheId) return;
    const id = reference.cacheId;
    stopPreview(); const serial = previewSerial;
    options.player()?.pauseVideo?.(); options.cancelCalibration?.();
    const controller = new AbortController(); previewRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    $('preview-status').textContent = '正在從本機載入音軌…';
    try {
      const response = await fetch(`${BASE}/library/${id}/${stem}`, { headers: { 'X-Karaoke-Token': token }, credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('音軌不存在或已刪除，請勾選保留試聽後重新準備。');
      const blob = await response.blob(); if (serial !== previewSerial) return;
      previewUrl = URL.createObjectURL(blob); $('stem-audio').src = previewUrl;
      $('preview-status').textContent = stem === 'vocals' ? '人聲試聽 · 本機音檔' : '伴奏試聽 · 本機音檔';
      await $('stem-audio').play();
    } catch (error) {
      if (serial === previewSerial) $('preview-status').textContent = error.name === 'NotAllowedError' ? '音軌已載入，請點音訊播放器的播放鍵。' : error.message;
    } finally { clearTimeout(timeout); }
  }
  $('stem-audio').addEventListener('play', () => { options.player()?.pauseVideo?.(); options.cancelCalibration?.(); });
  for (const stem of ['vocals','accompaniment']) $('preview-' + stem).addEventListener('click', () => playPreview(stem));
  async function refreshLibrary() {
    $('library-refresh').disabled = true;
    try {
      await ensureSession(); const { songs } = await api('/library');
      if (!Array.isArray(songs)) throw new Error('本機工具回應不相容，請重新啟動。');
      const list = $('library-list'); list.replaceChildren();
      for (const song of songs) {
        const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small'), buttons = document.createElement('div');
        title.textContent = song.title;
        detail.textContent = `${song.seconds ? '前 ' + song.seconds + ' 秒' : '完整歌曲'} · ${(song.bytes / 1024 / 1024).toFixed(2)} MB · ${song.hasPreview ? '含人聲／伴奏試聽' : '只有旋律基準'}`;
        buttons.className = 'button-row';
        const load = document.createElement('button'), remove = document.createElement('button');
        load.type = remove.type = 'button'; load.className = remove.className = 'secondary'; load.textContent = '載入'; remove.textContent = '刪除';
        load.addEventListener('click', () => {
          if (['preparing','finishing'].includes(phase)) return;
          $('url').value = `https://www.youtube.com/watch?v=${song.videoId}`;
          $('clip-seconds').value = String(song.seconds); $('keep-preview').checked = song.hasPreview;
          $('prepare-song').click();
        });
        remove.addEventListener('click', async () => {
          if (['preparing','finishing'].includes(phase)) return;
          remove.disabled = load.disabled = true;
          try {
            if (reference?.cacheId === song.id) { options.player()?.pauseVideo?.(); await clear('已卸載這首歌，正在刪除本機檔案…'); }
            await api('/library/' + song.id, { method: 'DELETE' });
            await refreshLibrary(); $('library-status').textContent = '已刪除：' + song.title + '（基準與試聽音軌）。';
          } catch (error) { $('library-status').textContent = '刪除失敗：' + error.message; remove.disabled = load.disabled = false; }
        });
        buttons.append(load, remove); li.append(title, detail, buttons); list.append(li);
      }
      $('library-status').textContent = `這台電腦已保存 ${songs.length} 個歌曲基準。`; controls();
    } catch (error) { $('library-status').textContent = '無法讀取歌曲庫：' + error.message; }
    finally { $('library-refresh').disabled = false; }
  }
  $('library-refresh').addEventListener('click', refreshLibrary);
  window.addEventListener('local-tools-ready', refreshLibrary);
  function historyRows() {
    try {
      const values = JSON.parse(localStorage.getItem(HISTORY) || '[]');
      return Array.isArray(values) ? values.slice(-100).map(x => savedResult(x.title, x.score)) : [];
    } catch { return []; }
  }
  function renderHistory() {
    const list = $('score-history'); list.replaceChildren();
    const rows = historyRows();
    if (!rows.length) { const li = document.createElement('li'); li.textContent = '還沒有演唱紀錄。'; list.append(li); }
    for (const row of rows.reverse()) { const li = document.createElement('li'), title = document.createElement('span'), score = document.createElement('b'); title.textContent = row.title; score.textContent = `${row.score} 分`; li.append(title, score); list.append(li); }
  }
  async function finish() {
    if (!take || !reference || ['result', 'finishing'].includes(phase)) return;
    phase = 'finishing'; controls();
    const result = take.result(), title = reference.title;
    $('total-score').textContent = String(result.score);
    $('pitch-score').textContent = String(result.pitch); $('rhythm-score').textContent = String(result.rhythm); $('coverage-score').textContent = String(result.coverage);
    $('result-title').textContent = title;
    let saved = true;
    try { localStorage.setItem(HISTORY, JSON.stringify([...historyRows(), savedResult(title, result.score)].slice(-100))); } catch { saved = false; }
    options.player()?.pauseVideo?.();
    await options.stopMic();
    await clear('本次演唱結束；已保存的基準可從本機歌曲庫直接載入再唱。', true);
    phase = 'result';
    message(saved ? '已結算，只保存歌名與分數。此為自動基準的練習分數。' : '已結算，但瀏覽器不允許儲存紀錄；分數仍顯示在這裡。');
    renderHistory(); controls();
  }
  async function poll(id, current) {
    if (current !== generation || jobId !== id) return;
    try {
      const state = await api(`/jobs/${id}`);
      if (current !== generation) return;
      $('prepare-status').textContent = state.message;
      if (state.stage === 'failed') throw new Error(state.message);
      if (state.ready) {
        const data = await api(`/jobs/${id}/reference`);
        if (current !== generation) return;
        reference = { ...validateReference(data), duration: data.duration, beats: data.beats || [], bpm: data.bpm, cacheId: data.cacheId, hasPreview: data.hasPreview };
        if (reference.videoId !== loadedVideo) throw new Error('影片已切換，請重新準備歌曲。');
        phase = 'ready';
        $('prepare-status').textContent = `已就緒：${reference.title} · ${Math.round(reference.duration)} 秒 · ${state.cached ? '直接載入本機基準' : '已保存到本機'}${reference.hasPreview ? '，可試聽分離結果' : '，音檔已清除'}。`;
        $('result-title').textContent = reference.title;
        for (const id of ['total-score','pitch-score','rhythm-score','coverage-score']) $(id).textContent = '—';
        if (reference.beats.length && reference.bpm) {
          options.stopBeats(); $('bpm').value = reference.bpm; $('bpm').disabled = true; $('beat-toggle').disabled = true;
          $('beat-note').textContent = `自動估計約 ${reference.bpm} BPM；播放時顯示拍點，可能出現半速／倍速誤差。`;
        }
        message('基準就緒。開啟麥克風後，按「從頭開始唱」或 YouTube 播放按鈕。'); controls();
        refreshLibrary().catch(() => {});
        return;
      }
      timer = setTimeout(() => poll(id, current), 1500);
    } catch (error) {
      if (current !== generation) return;
      await clear('準備失敗：' + (error instanceof TypeError ? '無法連線到本機工具。請確認啟動與本機網路權限。' : error.message));
      $('install-guide').open = true;
    }
  }
  $('prepare-song').addEventListener('click', async () => {
    const id = youtubeId($('url').value.trim());
    if (!id) { $('prepare-status').textContent = '請先填入有效的 YouTube 影片網址。'; return; }
    const clearing = clear('正在連接本機工具…');
    const current = generation; loadedVideo = id;
    phase = 'preparing'; controls();
    await clearing;
    if (current !== generation) return;
    try {
      if (!await options.loadVideo()) throw new Error('播放器尚未就緒，請重新載入影片後再試。');
      if (current !== generation) return;
      options.player()?.pauseVideo?.();
      await ensureSession();
      if (current !== generation) return;
      const created = await api('/jobs', { method: 'POST', body: JSON.stringify({ videoId: id, seconds: Number($('clip-seconds').value), preview: $('keep-preview').checked }) });
      if (current !== generation) { await removeJob(created.id); return; }
      jobId = created.id; controls(); await poll(jobId, current);
    } catch (error) {
      if (current !== generation) return;
      phase = 'idle'; $('prepare-status').textContent = '無法準備歌曲：' + (error instanceof TypeError || error.name === 'TimeoutError' ? '請先啟動本機工具，並允許本機網路存取。' : error.message);
      $('install-guide').open = true; controls();
    }
  });
  $('cancel-song').addEventListener('click', () => { options.player()?.pauseVideo?.(); clear(); });
  $('sing-start').addEventListener('click', () => {
    if (!reference || !options.micReady()) return;
    stopPreview();
    take?.clear(); take = new ScoringTake(reference, { allowOctave: $('pitch-mode').value === 'octave' }); phase = 'singing';
    $('total-score').textContent = '…'; $('pitch-score').textContent = '—'; $('rhythm-score').textContent = '—'; $('coverage-score').textContent = '—';
    options.player()?.seekTo?.(0, true); options.player()?.playVideo?.();
    message('演唱中。音準與完整度即時更新，歌曲結束時計算總分。'); controls();
  });
  $('finish-song').addEventListener('click', finish);
  $('clear-history').addEventListener('click', () => { try { localStorage.removeItem(HISTORY); renderHistory(); } catch { message('無法清除瀏覽器紀錄。'); } });
  function playerState(state) {
    if (state === 1) stopPreview();
    if (!reference || phase === 'finishing' || phase === 'result') return;
    if (state === 1 && options.micReady() && phase !== 'preparing' && phase !== 'result') {
      if (!take) { take = new ScoringTake(reference, { allowOctave: $('pitch-mode').value === 'octave' }); $('total-score').textContent = '…'; }
      phase = 'singing'; message('演唱中。跳過的段落會計入漏唱，重播不會重複加分。');
    } else if ([2, 3, -1].includes(state) && take) { phase = 'paused'; message(state === 3 ? '影片緩衝中，評分暫停。' : '播放已暫停，評分同步暫停。'); }
    else if (state === 0 && take) finish();
    else if (state === 1 && !options.micReady()) message('影片可以播放，但麥克風尚未開啟。請先開啟收音，再從頭開始唱。');
    controls();
  }
  function sample(time, hz) {
    if (!reference || !take || phase !== 'singing' || options.player()?.getPlayerState?.() !== 1) return;
    take.sample(time, hz);
    const expected = reference.frames[Math.floor(time / reference.step)];
    const target = noteOf(expected); $('target-note').textContent = target ? `${target.name} · ${expected.toFixed(1)} Hz` : '休息';
    if (expected && hz) { const cents = Math.round(pitchDifference(hz, expected, take.allowOctave)); $('live-feedback').textContent = Math.abs(cents) <= 25 ? (take.allowOctave ? '音準吻合（允許八度差）' : '音準吻合') : `${cents > 0 ? '偏高' : '偏低'} ${Math.abs(cents)} cents`; }
    else $('live-feedback').textContent = expected ? '等待歌聲' : '前奏／間奏，不計分';
    if (performance.now() - lastProgress > 500) {
      lastProgress = performance.now(); const result = take.result(false);
      $('pitch-score').textContent = result.pitch; $('coverage-score').textContent = result.coverage;
    }
  }
  const heartbeat = setInterval(() => {
    const p = options.player(); if (!reference || !p?.getCurrentTime) return;
    const t = p.getCurrentTime();
    if (take && phase === 'singing' && t >= reference.duration - .05) { finish(); return; }
    if (reference.beats.length) {
      let index = -1;
      for (let i = 0; i < reference.beats.length && reference.beats[i] <= t; i++) index = i;
      [...$('beats').children].forEach((dot, i) => dot.classList.toggle('active', phase === 'singing' && index >= 0 && i === index % 4));
    }
  }, 100);
  // Keep active reference available while the user is setting up or singing.
  const keepalive = setInterval(() => { if (jobId && reference) api(`/jobs/${jobId}`).catch(() => {}); }, 60000);
  window.addEventListener('pagehide', () => {
    generation++; clearTimeout(timer); stopPreview(); clearInterval(heartbeat); clearInterval(keepalive);
    if (jobId && token) fetch(BASE + `/jobs/${jobId}`, { method: 'DELETE', headers: { 'X-Karaoke-Token': token }, keepalive: true, credentials: 'omit' }).catch(() => {});
    reference = null; take?.clear(); take = null;
  });
  renderHistory(); controls();
  return {
    reference: () => reference, sample, playerState,
    pauseForCalibration() { options.player()?.pauseVideo?.(); stopPreview(); },
    async changeSong(id) { if (loadedVideo !== id) { await clear(); loadedVideo = id; } },
    micStarted() { controls(); },
    micStopped() { if (phase === 'singing') { phase = 'paused'; options.player()?.pauseVideo?.(); message('麥克風已停止，評分暫停。重新開啟收音後可繼續。'); } controls(); },
  };
}
