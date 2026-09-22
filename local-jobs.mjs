import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { readFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalLibrary, cacheKey } from './local-library.mjs';
import { LibraryLocation } from './library-location.mjs';
import { validateReference } from './scoring.mjs';
const root = fileURLToPath(new URL('./', import.meta.url));
const jobsRoot = path.join(root, '.runtime', 'jobs');
const python = path.join(root, '.runtime', 'venv', 'Scripts', 'python.exe');
const token = randomBytes(32).toString('hex');
const jobs = new Map();
const location = new LibraryLocation(path.join(root, '.runtime'));
let library = null, changingLocation = false, folderPicker = null;
async function currentLibrary() {
  if (!library) { const saved = await location.get(); if (saved.configured) library = new LocalLibrary(saved.path); }
  return library;
}
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('Request too large'); }
  return JSON.parse(text);
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
  else child.kill('SIGTERM');
}
async function erase(job) {
  if (!job) return;
  job.deleted = true; clearTimeout(job.timeout);
  await stopChild(job.child);
  await job.persisting?.catch(() => {});
  job.reference = null;
  const dir = path.resolve(jobsRoot, job.id);
  if (/^[a-f0-9]{32}$/.test(job.id) && path.dirname(dir) === path.resolve(jobsRoot)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  jobs.delete(job.id);
}
export function updateSeparation(job, data) {
  if (['cuda', 'cpu'].includes(data.device)) {
    if (job.device !== data.device) job.progress = 0;
    job.device = data.device; job.deviceName = String(data.deviceName || data.device).slice(0, 120);
    job.fallback = data.fallback === true;
  }
  if (Number.isFinite(data.progress)) job.progress = Math.max(job.progress || 0, Math.min(100, Math.max(0, data.progress)));
  job.message = job.fallback ? 'GPU 無法完成分離，已改用 CPU 重新處理…' : job.device === 'cuda' ? '使用 GPU 在本機分離人聲與伴奏…' : '使用 CPU 在本機分離人聲與伴奏…';
}
function summary(job) {
  return { id: job.id, stage: job.stage, message: job.message, progress: job.progress ?? null, device: job.device ?? null, deviceName: job.deviceName ?? null, fallback: !!job.fallback, ready: !!job.reference,
    title: job.reference?.title, duration: job.reference?.duration, bpm: job.reference?.bpm,
    voicedSeconds: job.reference?.voicedSeconds, audioCleared: !!job.reference && !job.reference.hasPreview, cacheId: job.cacheId, cached: !!job.cached, hasPreview: !!job.reference?.hasPreview };
}
async function start(videoId, seconds, preview = false, force = false) {
  const id = randomUUID().replaceAll('-', '');
  const key = cacheKey(videoId, seconds);
  const job = { cacheId: key, id, stage: 'starting', message: '啟動本機工作…', updated: Date.now(), reference: null, deleted: false };
  jobs.set(id, job);
  const cached = await library.get(key);
  if (job.deleted) return job;
  if (!force && cached && (!preview || cached.hasPreview)) {
    job.reference = cached; job.cached = true; job.stage = 'ready'; job.message = '已從本機載入基準，不需重新分析。';
    return job;
  }
  const args = [path.join(root, 'tools', 'audio_pipeline.py'), '--url', `https://www.youtube.com/watch?v=${videoId}`, '--seconds', String(seconds), '--separate', '--reference', '--job-id', id];
  if (preview) args.push('--preview');
  const child = spawn(python, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  let pending = '', stderr = '', events = Promise.resolve();
  const names = { download: '在本機取得 YouTube 音訊…', validated: '格式與完整解碼已確認。', separating: '在本機分離人聲與伴奏…', stem_validated: '分離音軌已驗證。', reference: '建立旋律與節拍基準…' };
  async function event(line) {
    if (job.deleted) return;
    let data; try { data = JSON.parse(line); } catch { return; }
    job.updated = Date.now();
    if (names[data.stage]) { job.stage = data.stage; job.message = names[data.stage]; }
    if (data.stage === 'separating') updateSeparation(job, data);
    if (data.stage === 'failed') { job.stage = 'failed'; job.message = String(data.message || '處理失敗').slice(-1000); }
    if (data.stage === 'complete') {
      try {
        const value = JSON.parse(await readFile(path.join(jobsRoot, id, 'reference.json'), 'utf8'));
        const validated = validateReference(value);
        if (validated.videoId !== videoId || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 905) throw new Error('Invalid reference');
        const beats = Array.isArray(value.beats) ? value.beats.filter(t => Number.isFinite(t) && t >= 0 && t <= value.duration).sort((a,b)=>a-b) : [];
        if (job.deleted) return;
        const reference = { ...validated, duration: value.duration, bpm: Number.isFinite(value.bpm) ? value.bpm : null, beats, voicedSeconds: value.voicedSeconds, quality: 'experimental-separated-vocals', rangeSeconds: seconds };
        job.persisting = library.save(key, reference, path.join(jobsRoot, id), preview, { cancelled: () => job.deleted, replace: force });
        job.reference = await job.persisting;
        if (job.deleted) return;
        job.stage = 'ready'; job.message = preview ? '基準與試聽音軌已保存到本機。' : '基準已保存到本機，暫存音檔已清除。';
        // Library owns durable files; discard the transient processing directory.
        const dir = path.resolve(jobsRoot, id);
        if (path.dirname(dir) === path.resolve(jobsRoot)) await rm(dir, { recursive: true, force: true });
      } catch { job.stage = 'failed'; job.message = '基準讀取或保存失敗，請確認本機剩餘空間，再重新準備歌曲。'; }
    }
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) events = events.then(() => event(line));
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
  child.on('error', () => { job.stage = 'failed'; job.message = '無法啟動本機 Python。請重新執行安裝腳本。'; });
  child.on('close', async code => {
    if (pending.trim()) events = events.then(() => event(pending));
    await events; clearTimeout(job.timeout);
    if (job.deleted) return;
    if (job.stage !== 'ready' && job.stage !== 'failed') { job.stage = 'failed'; job.message = `本機處理未完成（${code}）。請確認安裝與網路，或換另一支影片。`; }
    if (job.stage === 'failed') {
      const dir = path.resolve(jobsRoot, id);
      if (path.dirname(dir) === path.resolve(jobsRoot)) await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    }
    job.updated = Date.now();
  });
  job.timeout = setTimeout(async () => { job.stage = 'failed'; job.message = '本機處理超過 30 分鐘，已停止。'; await erase(job).catch(() => {}); }, 30 * 60000);
  job.timeout.unref();
  return job;
}
export async function handleLocalJobs(req, res) {
  if (req.url === '/session' && req.method === 'GET') { json(res, 200, { token, features: ['library', 'stem-preview', 'library-location', 'separation-progress', 'rebuild-song'] }); return true; }
  if (!req.url.startsWith('/jobs') && !req.url.startsWith('/library') && req.url !== '/shutdown') return false;
  if (req.headers['x-karaoke-token'] !== token) { json(res, 403, { error: 'Session token required' }); return true; }
  if (req.url === '/library/location' && req.method === 'GET') { json(res, 200, { ...await location.get(), selectionPending: !!folderPicker }); return true; }
  if (req.url === '/library/location/cancel' && req.method === 'POST') {
    if (folderPicker) { folderPicker.cancelled = true; await stopChild(folderPicker.child); }
    json(res, 200, { cancelled: true }); return true;
  }
  if (['/library/location', '/library/location/pick'].includes(req.url) && req.method === 'POST') {
    if (changingLocation) { json(res, 409, { error: '資料夾選擇仍在等待。請完成選擇，或按「取消資料夾選擇」後重試。' }); return true; }
    if (jobs.size) { json(res, 409, { error: '目前有歌曲載入中，請先按歌曲區的「取消／卸載」；不會刪除已保存的歌曲。' }); return true; }
    changingLocation = true;
    try {
      let selected;
      if (req.url.endsWith('/pick')) {
        if (process.platform !== 'win32') throw new Error('請在網頁輸入完整資料夾路徑。');
        const picker = { cancelled: false, child: null }; folderPicker = picker;
        const saved = await location.get();
        selected = picker.cancelled ? { cancelled: true } : await new Promise((resolve, reject) => { picker.child = execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools', 'select-library-folder.ps1'), '-InitialPath', saved.path || saved.suggestedPath], { windowsHide: false, timeout: 60000, encoding: 'utf8' }, (error, stdout) => {
          if (picker.cancelled) return resolve({ cancelled: true });
          if (error) return reject(new Error('資料夾選擇已逾時或無法開啟，請重試或直接輸入路徑。'));
          try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch { reject(new Error('無法讀取資料夾選擇結果。')); }
        }); });
      } else selected = await body(req);
      if (selected.cancelled) { json(res, 200, { ...await location.get(), cancelled: true }); return true; }
      const saved = await location.set(selected.path);
      library = new LocalLibrary(saved.path); json(res, 200, saved);
    } catch (error) { json(res, 400, { error: error.message }); }
    finally { folderPicker = null; changingLocation = false; }
    return true;
  }
  if (req.url.startsWith('/library') || (req.url === '/jobs' && req.method === 'POST')) {
    await currentLibrary();
    if (changingLocation) { json(res, 409, { error: '正在設定歌曲庫資料夾，請稍候。' }); return true; }
    if (!library) { json(res, 409, { error: '第一次使用請先指定歌曲庫資料夾，再準備歌曲。' }); return true; }
  }
  if (req.url === '/library' && req.method === 'GET') { json(res, 200, { songs: await library.list() }); return true; }
  if (req.url.startsWith('/library/')) {
    const match = /^\/library\/([\w-]{11}_(?:0|15|30|60)_v1)(?:\/(reference|vocals|accompaniment))?$/.exec(req.url);
    if (!match) { json(res, 400, { error: '無效的本機歌曲。' }); return true; }
    const [, id, asset] = match;
    if (req.method === 'DELETE' && !asset) {
      for (const job of [...jobs.values()]) if (job.cacheId === id) await erase(job);
      await library.delete(id); json(res, 200, { deleted: true }); return true;
    }
    if (req.method === 'GET' && asset === 'reference') {
      const value = await library.get(id); json(res, value ? 200 : 404, value || { error: '本機基準已刪除，請重新準備。' }); return true;
    }
    if (req.method === 'GET' && ['vocals','accompaniment'].includes(asset)) {
      const bytes = await library.audio(id, asset);
      if (!bytes) json(res, 404, { error: '尚未保留試聽音軌，請勾選試聽後重新準備。' });
      else { res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); }
      return true;
    }
    json(res, 405, { error: 'Unsupported method' }); return true;
  }
  if (req.url === '/shutdown' && req.method === 'POST') {
    await clearAllJobs(); json(res, 200, { stopped: true });
    setImmediate(() => process.emit('SIGTERM')); return true;
  }
  if (req.url === '/jobs' && req.method === 'POST') {
    try {
      const data = await body(req);
      if (!/^[\w-]{11}$/.test(data.videoId || '') || ![0, 15, 30, 60].includes(data.seconds)) { json(res, 400, { error: '影片網址或片段長度無效。' }); return true; }
      if ([...jobs.values()].some(j => !['ready','failed'].includes(j.stage))) { json(res, 409, { error: '已有歌曲正在處理，請先取消或等待完成。' }); return true; }
      const job = await start(data.videoId, data.seconds, data.preview === true, data.force === true); json(res, 202, summary(job));
    } catch { json(res, 400, { error: '本機工作請求無效。' }); }
    return true;
  }
  const match = /^\/jobs\/([a-f0-9]{32})(\/reference)?$/.exec(req.url);
  const job = match && jobs.get(match[1]);
  if (!job) { json(res, 404, { error: '工作已清除或不存在，請重新準備歌曲。' }); return true; }
  job.updated = Date.now();
  if (req.method === 'DELETE' && !match[2]) { await erase(job); json(res, 200, { cleared: true }); }
  else if (req.method === 'GET' && match[2]) { if (job.reference) json(res, 200, job.reference); else json(res, 409, { error: '基準尚未就緒。' }); }
  else if (req.method === 'GET') json(res, 200, summary(job));
  else json(res, 405, { error: 'Unsupported method' });
  return true;
}
// Abrupt browser closure cannot always send DELETE. Bound every inactive job's lifetime.
setInterval(() => {
  for (const job of jobs.values()) if (Date.now() - job.updated > 15 * 60000) erase(job).catch(() => {});
}, 60000).unref();
export async function clearAllJobs() { if (folderPicker) { folderPicker.cancelled = true; await stopChild(folderPicker.child); } await Promise.allSettled([...jobs.values()].map(erase)); }
export async function clearStaleJobs() {
  await mkdir(jobsRoot, { recursive: true });
  for (const name of await readdir(jobsRoot)) {
    if (!/^[a-f0-9]{32}$/.test(name) || jobs.has(name)) continue;
    const dir = path.resolve(jobsRoot, name);
    if (path.dirname(dir) !== path.resolve(jobsRoot)) continue;
    const info = await stat(dir);
    if (Date.now() - info.mtimeMs > 15 * 60000) await rm(dir, { recursive: true, force: true });
  }
}

setInterval(() => clearStaleJobs().catch(() => {}), 60000).unref();
