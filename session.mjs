import { youtubeId, noteOf } from './audio.mjs';
import { ScoringTake, validateReference, savedResult, pitchDifference } from './scoring.mjs';
const $ = id => document.getElementById(id);
const BASE = 'http://127.0.0.1:4174';
const HISTORY = 'karaoke.scores.v1';
export async function seekPlayerToStart(player, cancelled = () => false, timeoutMs = 10000) {
  player.pauseVideo();
  const deadline = performance.now() + timeoutMs;
  let requested = false;
  while (performance.now() < deadline) {
    if (cancelled()) throw new Error('同步已取消。');
    if (!requested && [0, 2, 5, -1].includes(player.getPlayerState())) { player.seekTo(0, true); requested = true; }
    if (requested && player.getCurrentTime() <= .05) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('YouTube 尚未確認回到開頭，請重試「從頭開始唱」。');
}

export function createKaraokeSession(options) {
  let reference = null, take = null, jobId = null, token = null, generation = 0, timer;
  let phase = 'idle', loadedVideo = null, lastProgress = 0, rangeComplete = false;
  let libraryLocation = null, locationBusy = false;
  let previewUrl = null, previewRequest = null, previewSerial = 0, restartToken = 0;
  const message = text => { $('score-status').textContent = text; };
  function controls() {
    if (phase === 'finishing') { $('mic-start').disabled = true; $('mic-stop').disabled = true; }
    $('prepare-song').disabled = locationBusy || libraryLocation?.configured === false || ['preparing', 'finishing', 'restarting'].includes(phase);
    for (const id of ['library-path','library-choose','library-use-path']) $(id).disabled = locationBusy || !!reference || ['preparing','finishing','restarting'].includes(phase);
    $('keep-preview').disabled = ['preparing', 'finishing', 'restarting'].includes(phase);
    for (const stem of ['vocals','accompaniment']) $('preview-' + stem).disabled = !reference?.hasPreview || ['preparing','finishing','restarting'].includes(phase);
    $('library-list').querySelectorAll('button').forEach(button => { button.disabled = ['preparing','finishing','restarting'].includes(phase); if (button.dataset.songId) { if (button.dataset.songId === reference?.cacheId) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current'); } });
    $('pitch-mode').disabled = !!take; $('score-range').disabled = !!take;
    $('url').disabled = ['preparing', 'finishing', 'restarting'].includes(phase);
    $('clip-seconds').disabled = ['preparing', 'finishing', 'restarting'].includes(phase);
    $('cancel-song').disabled = phase === 'finishing' || (!jobId && phase !== 'preparing' && !reference);
    $('sing-start').disabled = !reference || ['finishing','restarting'].includes(phase);
    $('finish-song').disabled = !take || ['result', 'finishing', 'restarting'].includes(phase);
    $('song-form').querySelector('button').disabled = ['preparing', 'finishing', 'restarting'].includes(phase);
  }
  async function api(url, init = {}, timeoutMs = 10000) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    generation++; restartToken++; clearTimeout(timer); stopPreview();
    const id = jobId; jobId = null; reference = null;
    options.player()?.pauseVideo?.(); $('prepare-progress-panel').hidden = true;
    take?.clear(); take = null; rangeComplete = false; phase = finishing ? 'finishing' : 'idle';
    beatReset(); $('live-feedback').textContent = '等待歌曲基準'; $('target-note').textContent = '—'; $('prepare-status').textContent = text;
    message('準備歌曲並開啟麥克風後，按播放就開始評分。'); controls();
    if (!await removeJob(id)) $('prepare-status').textContent = text + ' 本機工具未回覆清除結果；閒置工作會於約 15 分鐘後自動清理。';
  }
  async function ensureSession() {
    const response = await fetch(BASE + '/session', { credentials: 'omit', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('請先啟動本機工具。');
    const data = await response.json();
    if (!data.token || !data.features?.includes('separation-progress')) throw new Error('本機工具需要更新，請重新下載工具包，停止舊工具後再執行 start-local.ps1。');
    token = data.token;
    renderLocation(await api('/library/location'));
  }
  function renderLocation(value) {
    libraryLocation = value;
    $('library-cancel-pick').hidden = !value.selectionPending;
    if (document.activeElement !== $('library-path')) $('library-path').value = value.path || value.suggestedPath || '';
    $('library-location-status').textContent = value.configured ? `歌曲庫位置：${value.path}。已記住這台電腦的設定。` : value.existingLibrary ? '找到原有歌曲庫。請按「使用此位置」保留現有位置，或另外選擇。' : '第一次使用請先選擇或指定歌曲庫資料夾，再準備歌曲。';
    if (value.selectionPending) $('library-location-status').textContent = '資料夾選擇仍在等待。可完成 Windows 選擇視窗，或按「取消資料夾選擇」。';
    controls();
  }
  async function chooseLocation(picker) {
    if (locationBusy || reference || ['preparing','finishing','restarting'].includes(phase)) return;
    const entered = $('library-path').value;
    locationBusy = true; controls();
    try {
      await ensureSession();
      $('library-location-status').textContent = picker ? '請在這台電腦開啟的視窗中選擇資料夾…' : '正在保存歌曲庫位置…';
      if (picker) $('library-cancel-pick').hidden = false;
      const value = await api(picker ? '/library/location/pick' : '/library/location', { method: 'POST', body: JSON.stringify(picker ? {} : { path: entered }) }, picker ? 70000 : 10000);
      renderLocation(value);
      if (value.cancelled) $('library-location-status').textContent = '已取消選擇，歌曲庫位置未變更。';
      if (value.configured) await refreshLibrary();
    } catch (error) { $('library-location-status').textContent = '無法設定歌曲庫：' + error.message; }
    finally { locationBusy = false; controls(); }
  }
  $('library-cancel-pick').addEventListener('click', async () => {
    $('library-cancel-pick').disabled = true;
    try {
      if (!token) await ensureSession();
      await api('/library/location/cancel', { method: 'POST', body: '{}' });
      $('library-cancel-pick').hidden = true;
      $('library-location-status').textContent = '已取消資料夾選擇；原歌曲庫與歌曲都保留，可重新選擇。';
    } catch (error) { $('library-location-status').textContent = error.message; }
    finally { $('library-cancel-pick').disabled = false; }
  });
  $('library-choose').addEventListener('click', () => chooseLocation(true));
  $('library-use-path').addEventListener('click', () => chooseLocation(false));
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
      await ensureSession();
      if (!libraryLocation.configured) { $('library-list').replaceChildren(); $('library-status').textContent = '請先指定歌曲庫資料夾。'; return; }
      const { songs } = await api('/library');
      if (!Array.isArray(songs)) throw new Error('本機工具回應不相容，請重新啟動。');
      const list = $('library-list'); list.replaceChildren();
      for (const song of songs) {
        const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
        title.textContent = song.title;
        detail.textContent = `${song.seconds ? '前 ' + song.seconds + ' 秒' : '完整歌曲'} · ${(song.bytes / 1024 / 1024).toFixed(2)} MB · ${song.hasPreview ? '含人聲／伴奏試聽' : '只有旋律基準'}`;
        const load = document.createElement('button'), remove = document.createElement('button');
        load.type = remove.type = 'button'; load.className = 'song-choice'; remove.className = 'secondary song-delete'; remove.textContent = '刪除';
        load.dataset.songId = song.id; load.setAttribute('aria-label', '載入 ' + song.title); load.append(title, detail);
        if (reference?.cacheId === song.id) load.setAttribute('aria-current', 'true');
        load.addEventListener('click', () => {
          if (['preparing','finishing','restarting'].includes(phase)) return;
          if (reference?.cacheId === song.id) { message('這首歌已載入，可直接按「從頭開始唱」。'); return; }
          $('url').value = `https://www.youtube.com/watch?v=${song.videoId}`;
          $('clip-seconds').value = String(song.seconds); $('keep-preview').checked = song.hasPreview;
          $('prepare-song').click();
        });
        remove.addEventListener('click', async () => {
          if (['preparing','finishing','restarting'].includes(phase)) return;
          remove.disabled = load.disabled = true;
          try {
            if (reference?.cacheId === song.id) { options.player()?.pauseVideo?.(); await clear('已卸載這首歌，正在刪除本機檔案…'); }
            await api('/library/' + song.id, { method: 'DELETE' });
            await refreshLibrary(); $('library-status').textContent = '已刪除：' + song.title + '（基準與試聽音軌）。';
          } catch (error) { $('library-status').textContent = '刪除失敗：' + error.message; remove.disabled = load.disabled = false; }
        });
        li.append(load, remove); list.append(li);
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
    restartToken++; phase = 'finishing'; controls();
    if (options.micReady() && options.player()?.getPlayerState?.() === 1) take.advance(options.player().getCurrentTime());
    const result = take.result(), title = reference.title;
    $('total-score').textContent = result.score === null ? '—' : String(result.score);
    $('pitch-score').textContent = String(result.pitch); $('rhythm-score').textContent = String(result.rhythm); $('coverage-score').textContent = String(result.coverage);
    $('result-title').textContent = title;
    let saved = true;
    if (result.score !== null) { try { localStorage.setItem(HISTORY, JSON.stringify([...historyRows(), savedResult(title, result.score)].slice(-100))); } catch { saved = false; } }
    options.player()?.pauseVideo?.();
    await options.stopMic();
    take.clear(); take = null; rangeComplete = false;
    $('live-feedback').textContent = '本輪已結束，歌曲已保留'; $('target-note').textContent = '—';
    $('prepare-status').textContent = `已就緒：${reference.title} · 基準已保留，直接按「從頭開始唱」即可再唱。`;
    phase = 'result'; $('mic-start').disabled = false;
    message(result.score === null ? '這段沒有可評分的原唱人聲，未保存分數。歌曲已保留，可直接重新開始。' : saved ? '已結算，只保存歌名與分數。歌曲已保留，可直接按「從頭開始唱」。' : '已結算，但瀏覽器不允許儲存紀錄；分數仍顯示在這裡。');
    renderHistory(); controls();
  }
  function renderPreparation(state) {
    const panel = $('prepare-progress-panel'), bar = $('prepare-progress');
    panel.hidden = false;
    const steps = ['download', 'separating', 'reference', 'ready'];
    const stage = state.ready ? 'ready' : state.stage === 'validated' ? 'download' : state.stage === 'stem_validated' ? 'separating' : state.stage;
    const index = steps.indexOf(stage);
    [...$('prepare-steps').children].forEach((item, i) => { item.classList.toggle('done', i < index); item.classList.toggle('active', i === index); });
    if (state.ready) { bar.value = 100; $('prepare-progress-label').textContent = state.cached ? '已從歌曲庫載入' : '歌曲準備完成'; }
    else if (stage === 'separating' && Number.isFinite(state.progress)) { bar.value = state.progress; $('prepare-progress-label').textContent = `人聲／伴奏分離 ${Math.round(state.progress)}%`; }
    else { bar.removeAttribute('value'); $('prepare-progress-label').textContent = state.message || '正在準備…'; }
  }
  async function poll(id, current) {
    if (current !== generation || jobId !== id) return;
    try {
      const state = await api(`/jobs/${id}`);
      if (current !== generation) return;
      $('prepare-status').textContent = state.message; renderPreparation(state);
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
        if (options.player()?.getPlayerState?.() === 1) playerState(1);
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
    phase = 'preparing'; renderPreparation({ stage: 'starting', message: '正在連接本機工具…' }); controls();
    await clearing;
    if (current !== generation) return;
    try {
      await ensureSession();
      if (!libraryLocation.configured) throw new Error('請先指定歌曲庫資料夾，再準備歌曲。');
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
      phase = 'idle'; $('prepare-progress-panel').hidden = true; $('prepare-status').textContent = '無法準備歌曲：' + (error instanceof TypeError || error.name === 'TimeoutError' ? '請先啟動本機工具，並允許本機網路存取。' : error.message);
      $('install-guide').open = true; controls();
    }
  });
  $('cancel-song').addEventListener('click', () => { options.player()?.pauseVideo?.(); clear(); });
  $('sing-start').addEventListener('click', async () => {
    if (!reference || phase === 'restarting') return;
    stopPreview(); options.cancelCalibration?.();
    const request = ++restartToken, p = options.player();
    phase = 'restarting'; message('正在同步 YouTube 到 0 秒…'); controls();
    try {
      if (!options.micReady()) await options.startMic();
      if (request !== restartToken || !reference || !options.micReady()) { if (request === restartToken) { phase = take ? 'paused' : 'ready'; controls(); } return; }
      await seekPlayerToStart(p, () => request !== restartToken || !reference || !options.micReady());
      if (request !== restartToken || !reference || !options.micReady()) return;
      take?.clear(); take = new ScoringTake(reference, { allowOctave: $('pitch-mode').value === 'octave', rangeMode: $('score-range').value });
      take.begin(0); lastProgress = 0; rangeComplete = false; phase = 'paused';
      $('total-score').textContent = '…'; $('pitch-score').textContent = '—'; $('rhythm-score').textContent = '—'; $('coverage-score').textContent = '—';
      message('影片已回到開頭，等待播放開始。'); controls(); p.playVideo();
      if (p.getPlayerState() === 1) playerState(1);
    } catch (error) {
      if (request !== restartToken) return;
      phase = 'paused'; p?.pauseVideo?.(); message(error.message); controls();
    }
  });
  $('finish-song').addEventListener('click', finish);
  $('clear-history').addEventListener('click', () => { try { localStorage.removeItem(HISTORY); renderHistory(); } catch { message('無法清除瀏覽器紀錄。'); } });
  function playerState(state) {
    if (state === 1) { stopPreview(); options.cancelCalibration?.(); }
    if (!reference || ['finishing','result','restarting'].includes(phase)) return;
    if (state === 1 && options.micReady() && phase !== 'preparing' && phase !== 'result') {
      if (!take && options.player()?.getCurrentTime?.() >= reference.duration) { message('目前播放位置超出分析範圍，請按「從頭開始唱」。'); controls(); return; }
      if (!take) { take = new ScoringTake(reference, { allowOctave: $('pitch-mode').value === 'octave', rangeMode: $('score-range').value }); take.begin(options.player()?.getCurrentTime?.() || 0); $('total-score').textContent = '…'; }
      take.advance(options.player()?.getCurrentTime?.() || 0); phase = 'singing'; message('演唱中。跳過的段落會計入漏唱，重播不會重複加分。');
    } else if ([2, 3, -1].includes(state) && take) { if (phase === 'singing' && options.micReady()) take.advance(options.player()?.getCurrentTime?.() || 0); phase = 'paused'; message(state === 3 ? '影片緩衝中，評分暫停。' : '播放已暫停，評分同步暫停。'); }
    else if (state === 0 && take && options.micReady()) { take.advance(options.player()?.getCurrentTime?.() || 0); finish(); }
    else if (state === 1 && !options.micReady()) message('影片可以播放，但麥克風尚未開啟。請先開啟收音，再從頭開始唱。');
    controls();
  }
  function sample(time, hz) {
    if (!reference || !take || phase !== 'singing' || options.player()?.getPlayerState?.() !== 1) return;
    if (time >= reference.duration) {
      if (!rangeComplete) message('已到本次分析範圍結尾。資料已保留，可停止收音後按「結束並結算」。');
      rangeComplete = true; $('target-note').textContent = '—'; $('live-feedback').textContent = '超出分析範圍，不再計分';
      return;
    }
    if (rangeComplete) message('繼續評分中。停止收音後可按「結束並結算」。');
    rangeComplete = false; take.sample(time, hz);
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
    if (!take && phase === 'ready' && options.micReady() && p.getPlayerState?.() === 1 && t < reference.duration) playerState(1);
    if (take && phase === 'singing' && options.micReady() && p.getPlayerState?.() === 1) take.advance(t);
    if (reference.beats.length) {
      let index = -1;
      for (let i = 0; i < reference.beats.length && reference.beats[i] <= t; i++) index = i;
      [...$('beats').children].forEach((dot, i) => dot.classList.toggle('active', phase === 'singing' && index >= 0 && i === index % 4));
    }
  }, 100);
  // Keep active reference available while the user is setting up or singing.
  const keepalive = setInterval(() => { if (jobId && reference) api(`/jobs/${jobId}`).catch(() => {}); }, 60000);
  window.addEventListener('pagehide', () => {
    generation++; restartToken++; clearTimeout(timer); stopPreview(); clearInterval(heartbeat); clearInterval(keepalive);
    if (jobId && token) fetch(BASE + `/jobs/${jobId}`, { method: 'DELETE', headers: { 'X-Karaoke-Token': token }, keepalive: true, credentials: 'omit' }).catch(() => {});
    reference = null; take?.clear(); take = null;
  });
  renderHistory(); controls();
  return {
    reference: () => reference, sample, playerState,
    pauseForCalibration() { if (phase === 'restarting') { restartToken++; phase = take ? 'paused' : 'ready'; } options.player()?.pauseVideo?.(); stopPreview(); controls(); },
    async changeSong(id) { if (loadedVideo !== id) { await clear(); loadedVideo = id; } },
    micStarted() {
      if (reference && options.player()?.getPlayerState?.() === 1) playerState(1);
      controls();
    },
    micStopped({ rewind = false } = {}) {
      if (phase === 'restarting') { restartToken++; phase = take ? 'paused' : 'ready'; }
      if (phase === 'singing') { take?.advance(options.player()?.getCurrentTime?.() || 0); phase = 'paused'; options.player()?.pauseVideo?.(); }
      if (take && phase === 'paused') message('收音已停止，本次演唱資料已保留。可按「結束並結算」，或「從頭開始唱」重新計分。');
      if (rewind && options.player()?.seekTo && !['preparing','finishing','result'].includes(phase)) {
        const request = ++restartToken;
        seekPlayerToStart(options.player(), () => request !== restartToken).then(() => {
          if (request === restartToken && take) message('收音已停止，播放器已回到 0 秒。可結算本次演唱，或按「從頭開始唱」重新計分。');
        }).catch(error => { if (request === restartToken) message(error.message + ' 本次演唱資料仍保留，可先結算。'); });
      }
      controls();
    },
  };
}
