import { youtubeId, noteOf, detectPitch, playerResponse, alignedTime } from './audio.mjs';
import { createCalibration } from './calibration.mjs';
import { createKaraokeSession } from './session.mjs';
const $ = id => document.getElementById(id);
let player, playerReady, apiPromise, stream, context, analyser, samples, micTimer;
let calibration, micStartPromise, micPitch = null;
let generation = 0, history = [], beatTimer, beatStart, probeController;
const supported = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
$('environment').textContent = supported ? '桌機收音環境就緒。可測試麥克風與播放器；未取得歌曲基準前不計分。' : '無法開啟麥克風。請用桌機 Chrome／Edge 開啟 HTTPS 網址，並確認瀏覽器有收音權限。';
$('environment').classList.toggle('error', !supported);
$('mic-start').disabled = !supported;
const status = text => { $('player-status').textContent = text; };
function resetOffset() { $('offset').value = 0; $('offset-value').textContent = '0 ms'; }
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); apiPromise = null; reject(new Error('YouTube 載入失敗或逾時，請檢查網路並重試。')); };
    const timer = setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
    script.src = 'https://www.youtube.com/iframe_api'; script.onerror = fail; document.head.append(script);
  });
  return apiPromise;
}
async function loadVideo(e) {
  e?.preventDefault();
  const id = youtubeId($('url').value.trim());
  if (!id) return status('請輸入有效的 YouTube 影片網址。');
  const button = $('song-form').querySelector('button'); button.disabled = true;
  status('正在載入 YouTube 播放器…');
  try {
    await singing.changeSong(id);
    await loadAPI();
    if (player) { player.cueVideoById(id); status('影片已切換，請在播放器內按播放。'); }
    else { playerReady = new Promise((resolve, reject) => {
      const readyTimeout = setTimeout(() => reject(new Error('播放器初始化逾時，請重新載入頁面。')), 20000);
      player = new YT.Player('player', { width: '100%', height: '100%', videoId: id,
      playerVars: { playsinline: 1, origin: location.origin, autoplay: 0 },
      events: {
        onReady: () => { clearTimeout(readyTimeout); resolve(); $('video-placeholder').style.display = 'none'; status('請按影片上的播放按鈕。'); },
        onStateChange: e => { status(({ '-1': '尚未開始', 0: '影片結束', 1: '播放中', 2: '暫停', 3: '緩衝中', 5: '已就緒' }[e.data] || '播放器狀態變更')); if (e.data === 1) calibration?.cancel(); singing.playerState(e.data); },
        onAutoplayBlocked: () => status('請直接點影片上的播放按鈕。'),
        onError: e => { clearTimeout(readyTimeout); reject(new Error(`影片無法播放（${e.data}），請換影片。`)); status(`影片無法播放（${e.data}）。可能禁止嵌入、已移除或需登入；請換影片。`); singing.playerState(2); }
      }
    });
    }); }
    await playerReady; return true;
  } catch (err) { status(err.message); return false; } finally { button.disabled = false; }
}
$('song-form').addEventListener('submit', loadVideo);
function log(text, cls = '') { const li = document.createElement('li'); li.textContent = text; li.className = cls; $('probe-log').append(li); }
async function readLimited(response, max, partial = false) {
  if (!response.body) throw new Error('瀏覽器未提供可讀取的串流。');
  const reader = response.body.getReader(); let length = 0; const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (value.length > max - length && !partial) throw new Error('回應超過測試大小上限。');
      const part = value.subarray(0, max - length); parts.push(part); length += part.length;
      if (length >= max) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
$('probe').addEventListener('click', async () => {
  const id = youtubeId($('url').value.trim()); $('probe-log').replaceChildren();
  if (!id) return log('請先填入有效的 YouTube 影片網址。', 'fail');
  $('probe').disabled = true;
  const controller = new AbortController(); probeController = controller;
  const timer = setTimeout(() => controller.abort(), 15000); let stage = '影片頁面';
  try {
    log('本機瀏覽器直接讀取 YouTube 頁面…');
    const response = await fetch(`https://www.youtube.com/watch?v=${id}`, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = playerResponse(new TextDecoder().decode(await readLimited(response, 3 * 1024 * 1024)));
    log('影片頁面可讀取。', 'pass');
    const formats = [...(data?.streamingData?.adaptiveFormats || []), ...(data?.streamingData?.formats || [])];
    const format = formats.find(f => /^audio\//.test(f.mimeType || '') && f.url);
    if (!format) { log('未找到可直接讀取的音訊 URL。可能需要播放器簽章、登入或頁面結構不同；原型未實作這些處理。', 'fail'); return; }
    const url = new URL(format.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com')) throw new Error('不是預期的 HTTPS YouTube 媒體來源。');
    stage = '音訊串流'; log('讀取最多 128 KiB 音訊串流…');
    const response2 = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!response2.ok) throw new Error(`HTTP ${response2.status}`);
    const bytes = await readLimited(response2, 128 * 1024, true);
    if (!bytes.length) throw new Error('音訊回應為空。');
    log(`讀取成功：${bytes.length.toLocaleString()} bytes，只在本機記憶體中，未保存。`, 'pass');
    log('這只證明串流可讀取；尚未解碼、人聲分離或建立基準。');
  } catch (err) {
    const reason = err.name === 'AbortError' ? '逾時或測試已中止。' : err instanceof TypeError ? '瀏覽器拒絕讀取；可能是 CORS、網路或內容阻擋，此訊息無法區分原因。' : err.message;
    log(`${stage}測試未通過：${reason}`, 'fail');
    log('未取得可分析音訊，不能建立基準或評分。嵌入播放仍可獨立測試。', 'fail');
  } finally { clearTimeout(timer); if (probeController === controller) probeController = null; $('probe').disabled = false; }
});
function latency(x) { return Number.isFinite(x) ? `${Math.round(x * 1000)} ms（估計）` : '未提供，不能當作 0 ms'; }
$('offset').addEventListener('input', () => { $('offset-value').textContent = `${$('offset').value} ms`; });
async function stopMic(message = '收音已停止，麥克風已釋放；錄音結果請查看下方錄音狀態。', rewind = false) {
  generation++; clearInterval(micTimer); calibration?.cancel();
  const recordingEnd = singing.stopRecording();
  const oldStream = stream, oldContext = context;
  stream = context = analyser = samples = null; micPitch = null; history = [];
  oldStream?.getTracks().forEach(t => t.stop());
  if (oldContext) oldContext.onstatechange = null;
  $('mic-start').disabled = !supported; $('mic-stop').disabled = true;
  $('mic-badge').textContent = '麥克風未開啟'; $('mic-status').textContent = message;
  $('note').textContent = '—'; $('frequency').textContent = '等待收音'; $('cents').textContent = '單音音高 · 65–1000 Hz';
  $('level').value = 0; $('level-text').textContent = '— dBFS'; $('device').textContent = '收音已停止。'; singing.micStopped({ rewind, reason: message }); draw();
  await recordingEnd;
  if (oldContext) await oldContext.close().catch(() => {});
}
function startMic() {
  if (stream && context?.state === 'running') return Promise.resolve(true);
  if (!micStartPromise) micStartPromise = activateMic().finally(() => { micStartPromise = null; });
  return micStartPromise;
}
async function activateMic() {
  const token = ++generation; let pendingStream, pendingContext;
  $('mic-start').disabled = true; $('mic-stop').disabled = false; $('mic-status').textContent = '請允許網站使用麥克風…';
  try {
    pendingContext = new AudioContext({ latencyHint: 'interactive' });
    const resumed = pendingContext.resume().catch(() => {});
    pendingStream = await navigator.mediaDevices.getUserMedia({ audio: { ...($('input-device').value ? { deviceId: { exact: $('input-device').value } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    await resumed;
    if (token !== generation) { pendingStream.getTracks().forEach(t => t.stop()); await pendingContext.close(); return; }
    stream = pendingStream; context = pendingContext;
    const source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser(); analyser.fftSize = 4096; source.connect(analyser);
    samples = new Float32Array(analyser.fftSize);
    const track = stream.getAudioTracks()[0], settings = track.getSettings();
    await refreshInputs();
    if (token !== generation) return;
    $('device').textContent = `輸入：${track.label || '瀏覽器預設麥克風'}\n取樣率：${context.sampleRate} Hz\n輸入延遲：${latency(settings.latency)}\nWeb Audio 輸出延遲：${latency(context.outputLatency)}\n回音消除：${String(settings.echoCancellation ?? '未知')}\n\n輸出估計屬於本頁 AudioContext，不代表 YouTube 的延遲；不會自動填入補償值。`;
    track.onended = () => stopMic('麥克風中斷，請重新開啟。');
    track.onmute = () => { $('mic-status').textContent = '收音暫時中斷，目前音高不可用。'; };
    track.onunmute = () => { $('mic-status').textContent = '收音已恢復。'; };
    context.onstatechange = () => { if (context?.state !== 'running') $('mic-status').textContent = '音訊處理暫停，請停止後重新開啟。'; };
    $('mic-badge').textContent = '● 收音中'; $('mic-status').textContent = '持續唱「啊」試試。單獨測試麥克風不保存；按「從頭開始唱」依錄音選項保存。';
    micTimer = setInterval(readMic, 65); singing.micStarted(); return true;
  } catch (err) {
    pendingStream?.getTracks().forEach(t => t.stop());
    if (pendingContext && pendingContext.state !== 'closed') await pendingContext.close().catch(() => {});
    if (token !== generation) return;
    await stopMic(err.name === 'NotAllowedError' ? '麥克風未獲允許。請點網址列的網站權限圖示，允許麥克風後再重試。' : err.name === 'NotFoundError' ? '找不到麥克風，請檢查裝置。' : `收音失敗：${err.message}`);
  }
}
$('mic-start').addEventListener('click', startMic);
$('mic-stop').addEventListener('click', () => stopMic(undefined, true));
function readMic() {
  if (!analyser || !samples || context?.state !== 'running') return;
  analyser.getFloatTimeDomainData(samples);
  const result = stream.getAudioTracks()[0]?.muted ? { hz: null, rms: 0 } : detectPitch(samples, context.sampleRate);
  micPitch = result.hz;
  const note = noteOf(result.hz), now = performance.now() / 1000;
  history.push({ time: now, midi: note?.midi ?? null }); history = history.filter(p => now - p.time <= 8);
  calibration?.sample(now - analyser.fftSize / (2 * context.sampleRate), result.hz);
  if (player?.getCurrentTime) singing.sample(player.getCurrentTime() - Number($('offset').value) / 1000 - analyser.fftSize / (2 * context.sampleRate), result.hz);
  $('note').textContent = note?.name ?? '—'; $('frequency').textContent = result.hz ? `${result.hz.toFixed(1)} Hz` : '未偵測到穩定音高';
  $('cents').textContent = note ? `${note.cents >= 0 ? '+' : ''}${note.cents} cents · 相對最近音名，非歌曲分數` : '單音音高 · 65–1000 Hz';
  $('level').value = Math.min(1, result.rms * 4); $('level-text').textContent = result.rms > 0 ? `${Math.max(-90, 20 * Math.log10(result.rms)).toFixed(0)} dBFS` : '— dBFS'; draw();
}
let chartPalette;
function draw() {
  if (!chartPalette) {
    const style = getComputedStyle(document.documentElement);
    chartPalette = { grid: style.getPropertyValue('--chart-grid').trim(), label: style.getPropertyValue('--chart-label').trim(), voice: style.getPropertyValue('--accent').trim() };
  }
  const canvas = $('pitch-chart'), rect = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  const w = rect.width, h = rect.height, y = midi => 12 + (84 - midi) / 48 * (h - 24);
  ctx.font = '10px system-ui';
  for (let m = 36; m <= 84; m += 12) { ctx.strokeStyle = chartPalette.grid; ctx.beginPath(); ctx.moveTo(28, y(m)); ctx.lineTo(w, y(m)); ctx.stroke(); ctx.fillStyle = chartPalette.label; ctx.fillText(`C${m / 12 - 1}`, 0, y(m) + 3); }
  const now = performance.now() / 1000; ctx.strokeStyle = chartPalette.voice; ctx.lineWidth = 2; ctx.beginPath();
  let connected = false, last = 0;
  for (const p of history) {
    if (p.midi === null || now - p.time > 8) { connected = false; continue; }
    const x = 28 + (1 - (now - p.time) / 8) * (w - 28), py = Math.max(12, Math.min(h - 12, y(p.midi)));
    if (connected && p.time - last < .2) ctx.lineTo(x, py); else ctx.moveTo(x, py); connected = true; last = p.time;
  }
  ctx.stroke();
  const reference = singing.reference();
  if (reference && player?.getCurrentTime) {
    const time = player.getCurrentTime() - Number($('offset').value) / 1000;
    ctx.strokeStyle = '#90cbef'; ctx.lineWidth = 1.5; ctx.beginPath(); let linked = false;
    for (let x = 28; x <= w; x += 2) {
      const t = time - 8 * (1 - (x - 28) / (w - 28));
      const note = noteOf(reference.frames[Math.floor(t / reference.step)]);
      if (!note) { linked = false; continue; }
      const py = Math.max(12, Math.min(h - 12, y(note.midi)));
      if (linked) ctx.lineTo(x, py); else ctx.moveTo(x, py); linked = true;
    }
    ctx.stroke();
  }
}
window.addEventListener('karaoke-theme-change', () => { chartPalette = null; draw(); });
new ResizeObserver(draw).observe($('pitch-chart'));
function stopBeats() { clearInterval(beatTimer); beatTimer = null; $('beat-toggle').textContent = '啟動節拍燈'; [...$('beats').children].forEach(d => d.classList.remove('active')); }
function updateBeat() {
  const bpm = Number($('bpm').value); if (bpm < 40 || bpm > 220 || !Number.isFinite(bpm)) return stopBeats();
  const beat = Math.floor((performance.now() - beatStart) / (60000 / bpm)) % 4;
  [...$('beats').children].forEach((d, i) => d.classList.toggle('active', i === beat));
}
$('beat-toggle').addEventListener('click', () => {
  if (beatTimer) return stopBeats(); if (!$('bpm').reportValidity() || !$('bpm').value) return;
  beatStart = performance.now(); $('beat-toggle').textContent = '停止節拍燈'; beatTimer = setInterval(updateBeat, 35); updateBeat();
});
$('bpm').addEventListener('input', () => { if (beatTimer) { beatStart = performance.now(); updateBeat(); } });
setInterval(() => {
  if (!player?.getCurrentTime) return; const t = player.getCurrentTime(); if (!Number.isFinite(t)) return;
  $('player-time').textContent = `${t.toFixed(2)} s`; $('aligned-time').textContent = `${alignedTime(t, Number($('offset').value)).toFixed(2)} s`;
}, 100);
navigator.mediaDevices?.addEventListener('devicechange', () => { resetOffset(); if (stream) stopMic('裝置已變更，補償已歸零。請重新開啟收音並校正。'); });
function cleanup() { probeController?.abort(); stopBeats(); stopMic('頁面已離開前景，收音已停止。請重新開啟。'); }
document.addEventListener('visibilitychange', () => { if (document.hidden) cleanup(); }); window.addEventListener('pagehide', cleanup);

async function refreshInputs() {
  const select = $('input-device'), previous = select.value;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    select.replaceChildren(new Option('系統預設麥克風', ''));
    for (const [i, d] of devices.filter(d => d.kind === 'audioinput').entries()) {
      if (d.deviceId && d.deviceId !== 'default') select.append(new Option(d.label || `麥克風 ${i + 1}`, d.deviceId));
    }
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  } catch { /* Device labels are optional; default recording remains available. */ }
}
$('input-device').addEventListener('change', () => {
  resetOffset(); stopMic('已切換麥克風，補償已歸零。請按開啟麥克風使用新裝置。');
});

const localToolNames = { python: 'Python 環境', node: 'Node.js 22+', ffmpeg: 'FFmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', demucs: 'Demucs', torch: 'PyTorch', torchaudio: 'TorchAudio', soundfile: 'SoundFile' };
$('local-check').addEventListener('click', async () => {
  const button = $('local-check'), panel = document.querySelector('.local-tools');
  button.disabled = true; panel.dataset.state = 'checking';
  $('local-status').textContent = '正在檢查這台電腦的本機工具…';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('http://127.0.0.1:4174/health', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('本機工具回應失敗。');
    const result = await response.json();
    if (result.app !== 'karaoke-local-helper' || result.version !== 1 || typeof result.checks !== 'object' || !result.checks) throw new Error('本機工具版本不相容，請重新下載工具包。');
    if (!result.features?.includes('separation-progress')) throw new Error('本機工具需要更新，請重新下載工具包，停止舊工具後再啟動。');
    const missing = Object.entries(localToolNames).filter(([key]) => result.checks[key] !== true).map(([, name]) => name);
    if (missing.length || !result.ready) {
      panel.dataset.state = 'warning'; $('install-guide').open = true;
      $('local-status').textContent = '已連線，但本機安裝尚未完整。';
      $('local-detail').textContent = '缺少或無法使用：' + (missing.join('、') || '請重新執行安裝腳本') + '。請參考下方安裝指引。';
    } else {
      panel.dataset.state = 'ready';
      window.dispatchEvent(new Event('local-tools-ready'));
      $('local-status').textContent = '✓ 本機工具已啟動，音訊處理環境已就緒。';
      $('local-detail').textContent = 'yt-dlp、FFmpeg 與 Demucs 已找到。音訊在你的電腦處理；目前此按鈕只檢查環境，不會下載或錄音。';
    }
  } catch (error) {
    panel.dataset.state = 'warning'; $('install-guide').open = true;
    $('local-status').textContent = '尚未連上本機工具，無法判定是否已安裝。';
    $('local-detail').textContent = error.name === 'AbortError' ? '連線逾時。若工具已安裝，請啟動 start-local.ps1，並允許瀏覽器的本機網路存取後重試。' : error instanceof TypeError ? '可能尚未啟動、尚未安裝，或瀏覽器阻擋本機連線。已安裝者請先執行 start-local.ps1；首次使用請看安裝指引。' : error.message;
  } finally { clearTimeout(timer); button.disabled = false; }
});

const singing = createKaraokeSession({ voiced: () => micPitch !== null, context: () => context, stream: () => stream, player: () => player, micReady: () => !!stream && context?.state === 'running', stopMic: () => stopMic(), startMic, stopBeats, loadVideo: () => loadVideo(), cancelCalibration: () => calibration?.cancel() });

calibration = createCalibration({ context: () => context, micReady: () => !!stream && context?.state === 'running', beforeStart: () => singing.pauseForCalibration() });

window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
