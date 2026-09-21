import { youtubeId, noteOf } from './audio.mjs';
import { ScoringTake, validateReference, savedResult, pitchDifference } from './scoring.mjs';
const $ = id => document.getElementById(id);
const BASE = 'http://127.0.0.1:4174';
const HISTORY = 'karaoke.scores.v1';
export function createKaraokeSession(options) {
  let reference = null, take = null, jobId = null, token = null, generation = 0, timer;
  let phase = 'idle', loadedVideo = null, lastProgress = 0;
  const message = text => { $('score-status').textContent = text; };
  function controls() {
    $('prepare-song').disabled = ['preparing', 'finishing'].includes(phase);
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
  async function clear(text = '已取消並清除本次基準。', finishing = false) {
    generation++; clearTimeout(timer);
    const id = jobId; jobId = null; reference = null;
    take?.clear(); take = null; phase = finishing ? 'finishing' : 'idle';
    beatReset(); $('live-feedback').textContent = '等待歌曲基準'; $('target-note').textContent = '—'; $('prepare-status').textContent = text;
    message('準備歌曲並開啟麥克風後，按播放就開始評分。'); controls();
    if (!await removeJob(id)) $('prepare-status').textContent = text + ' 本機工具未回覆清除結果；閒置工作會於約 15 分鐘後自動清理。';
  }
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
    await clear('本次演唱結束；音訊與旋律基準已清除。再唱一次需重新準備。', true);
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
        reference = { ...validateReference(data), duration: data.duration, beats: data.beats || [], bpm: data.bpm };
        if (reference.videoId !== loadedVideo) throw new Error('影片已切換，請重新準備歌曲。');
        phase = 'ready';
        $('prepare-status').textContent = `已就緒：${reference.title} · ${Math.round(reference.duration)} 秒 · 暫存音檔已清除。`;
        $('result-title').textContent = reference.title;
        for (const id of ['total-score','pitch-score','rhythm-score','coverage-score']) $(id).textContent = '—';
        if (reference.beats.length && reference.bpm) {
          options.stopBeats(); $('bpm').value = reference.bpm; $('bpm').disabled = true; $('beat-toggle').disabled = true;
          $('beat-note').textContent = `自動估計約 ${reference.bpm} BPM；播放時顯示拍點，可能出現半速／倍速誤差。`;
        }
        message('基準就緒。開啟麥克風後，按「從頭開始唱」或 YouTube 播放按鈕。'); controls();
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
      const response = await fetch(BASE + '/session', { credentials: 'omit', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('本機工具尚未更新，請重新啟動。');
      if (current !== generation) return;
      token = (await response.json()).token;
      if (!token) throw new Error('本機工具回應無效，請重新啟動。');
      const created = await api('/jobs', { method: 'POST', body: JSON.stringify({ videoId: id, seconds: Number($('clip-seconds').value) }) });
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
    take?.clear(); take = new ScoringTake(reference, { allowOctave: $('pitch-mode').value === 'octave' }); phase = 'singing';
    $('total-score').textContent = '…'; $('pitch-score').textContent = '—'; $('rhythm-score').textContent = '—'; $('coverage-score').textContent = '—';
    options.player()?.seekTo?.(0, true); options.player()?.playVideo?.();
    message('演唱中。音準與完整度即時更新，歌曲結束時計算總分。'); controls();
  });
  $('finish-song').addEventListener('click', finish);
  $('clear-history').addEventListener('click', () => { try { localStorage.removeItem(HISTORY); renderHistory(); } catch { message('無法清除瀏覽器紀錄。'); } });
  function playerState(state) {
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
    generation++; clearTimeout(timer); clearInterval(heartbeat); clearInterval(keepalive);
    if (jobId && token) fetch(BASE + `/jobs/${jobId}`, { method: 'DELETE', headers: { 'X-Karaoke-Token': token }, keepalive: true, credentials: 'omit' }).catch(() => {});
    reference = null; take?.clear(); take = null;
  });
  renderHistory(); controls();
  return {
    reference: () => reference, sample, playerState,
    async changeSong(id) { if (loadedVideo !== id) { await clear(); loadedVideo = id; } },
    micStarted() { controls(); },
    micStopped() { if (phase === 'singing') { phase = 'paused'; options.player()?.pauseVideo?.(); message('麥克風已停止，評分暫停。重新開啟收音後可繼續。'); } controls(); },
  };
}
