import { youtubeId, noteOf, detectPitch, playerResponse, alignedTime } from './audio.mjs';
const $ = id => document.getElementById(id);
let player, apiPromise, stream, context, analyser, samples, micTimer;
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
$('song-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = youtubeId($('url').value.trim());
  if (!id) return status('請輸入有效的 YouTube 影片網址。');
  const button = e.currentTarget.querySelector('button'); button.disabled = true;
  status('正在載入 YouTube 播放器…');
  try {
    await loadAPI(); resetOffset();
    if (player) { player.cueVideoById(id); status('影片已切換，請在播放器內按播放。'); }
    else player = new YT.Player('player', { width: '100%', height: '100%', videoId: id,
      playerVars: { playsinline: 1, origin: location.origin, autoplay: 0 },
      events: {
        onReady: () => { $('video-placeholder').style.display = 'none'; status('請按影片上的播放按鈕。'); },
        onStateChange: e => status(({ '-1': '尚未開始', 0: '影片結束', 1: '播放中', 2: '暫停', 3: '緩衝中', 5: '已就緒' }[e.data] || '播放器狀態變更') + ' · 尚無歌曲基準，不計分'),
        onAutoplayBlocked: () => status('請直接點影片上的播放按鈕。'),
        onError: e => status(`影片無法播放（${e.data}）。可能禁止嵌入、已移除或需登入；請換影片。`)
      }
    });
  } catch (err) { status(err.message); } finally { button.disabled = false; }
});
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
async function stopMic(message = '收音已停止，聲音資料已釋放。') {
  generation++; clearInterval(micTimer);
  const oldStream = stream, oldContext = context;
  stream = context = analyser = samples = null; history = [];
  oldStream?.getTracks().forEach(t => t.stop());
  if (oldContext) { oldContext.onstatechange = null; await oldContext.close().catch(() => {}); }
  $('mic-start').disabled = !supported; $('mic-stop').disabled = true;
  $('mic-badge').textContent = '麥克風未開啟'; $('mic-status').textContent = message;
  $('note').textContent = '—'; $('frequency').textContent = '等待收音'; $('cents').textContent = '單音音高 · 65–1000 Hz';
  $('level').value = 0; $('level-text').textContent = '— dBFS'; $('device').textContent = '收音已停止。'; draw();
}
$('mic-start').addEventListener('click', async () => {
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
    samples = new Float32Array(analyser.fftSize); resetOffset();
    const track = stream.getAudioTracks()[0], settings = track.getSettings();
    await refreshInputs();
    if (token !== generation) return;
    $('device').textContent = `輸入：${track.label || '瀏覽器預設麥克風'}\n取樣率：${context.sampleRate} Hz\n輸入延遲：${latency(settings.latency)}\nWeb Audio 輸出延遲：${latency(context.outputLatency)}\n回音消除：${String(settings.echoCancellation ?? '未知')}\n\n輸出估計屬於本頁 AudioContext，不代表 YouTube 的延遲；不會自動填入補償值。`;
    track.onended = () => stopMic('麥克風中斷，請重新開啟。');
    track.onmute = () => { $('mic-status').textContent = '收音暫時中斷，目前音高不可用。'; };
    track.onunmute = () => { $('mic-status').textContent = '收音已恢復。'; };
    context.onstatechange = () => { if (context?.state !== 'running') $('mic-status').textContent = '音訊處理暫停，請停止後重新開啟。'; };
    $('mic-badge').textContent = '● 收音中'; $('mic-status').textContent = '持續唱「啊」試試。不播放人聲、不保存錄音。';
    micTimer = setInterval(readMic, 65);
  } catch (err) {
    pendingStream?.getTracks().forEach(t => t.stop());
    if (pendingContext && pendingContext.state !== 'closed') await pendingContext.close().catch(() => {});
    if (token !== generation) return;
    await stopMic(err.name === 'NotAllowedError' ? '麥克風未獲允許。請點網址列的網站權限圖示，允許麥克風後再重試。' : err.name === 'NotFoundError' ? '找不到麥克風，請檢查裝置。' : `收音失敗：${err.message}`);
  }
});
$('mic-stop').addEventListener('click', () => stopMic());
function readMic() {
  if (!analyser || !samples || context?.state !== 'running') return;
  analyser.getFloatTimeDomainData(samples);
  const result = stream.getAudioTracks()[0]?.muted ? { hz: null, rms: 0 } : detectPitch(samples, context.sampleRate);
  const note = noteOf(result.hz), now = performance.now() / 1000;
  history.push({ time: now, midi: note?.midi ?? null }); history = history.filter(p => now - p.time <= 8);
  $('note').textContent = note?.name ?? '—'; $('frequency').textContent = result.hz ? `${result.hz.toFixed(1)} Hz` : '未偵測到穩定音高';
  $('cents').textContent = note ? `${note.cents >= 0 ? '+' : ''}${note.cents} cents · 相對最近音名，非歌曲分數` : '單音音高 · 65–1000 Hz';
  $('level').value = Math.min(1, result.rms * 4); $('level-text').textContent = result.rms > 0 ? `${Math.max(-90, 20 * Math.log10(result.rms)).toFixed(0)} dBFS` : '— dBFS'; draw();
}
function draw() {
  const canvas = $('pitch-chart'), rect = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale); canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  const w = rect.width, h = rect.height, y = midi => 12 + (84 - midi) / 48 * (h - 24);
  ctx.font = '10px system-ui';
  for (let m = 36; m <= 84; m += 12) { ctx.strokeStyle = '#2e392c'; ctx.beginPath(); ctx.moveTo(28, y(m)); ctx.lineTo(w, y(m)); ctx.stroke(); ctx.fillStyle = '#82907c'; ctx.fillText(`C${m / 12 - 1}`, 0, y(m) + 3); }
  const now = performance.now() / 1000; ctx.strokeStyle = '#d8fa85'; ctx.lineWidth = 2; ctx.beginPath();
  let connected = false, last = 0;
  for (const p of history) {
    if (p.midi === null || now - p.time > 8) { connected = false; continue; }
    const x = 28 + (1 - (now - p.time) / 8) * (w - 28), py = Math.max(12, Math.min(h - 12, y(p.midi)));
    if (connected && p.time - last < .2) ctx.lineTo(x, py); else ctx.moveTo(x, py); connected = true; last = p.time;
  }
  ctx.stroke();
}
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
