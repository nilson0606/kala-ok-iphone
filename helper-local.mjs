// Loopback-only health bridge. Does not receive or upload audio.
import http from 'node:http';
import { handleLocalJobs, clearAllJobs, clearStaleJobs } from './local-jobs.mjs';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const python = fileURLToPath(new URL('./.runtime/venv/Scripts/python.exe', import.meta.url));
const port = Number(process.env.KARAOKE_HELPER_PORT || 4174);
const origins = new Set(['https://nilson0606.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173']);
function check(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '', finished = false;
    const done = code => { if (finished) return; finished = true; clearTimeout(timer); resolve({ ok: code === 0, text }); };
    const timer = setTimeout(() => { child.kill(); done(-1); }, 6000);
    child.stdout.on('data', chunk => { if (text.length < 10000) text += chunk; });
    child.on('error', () => done(-1)); child.on('close', done);
  });
}
let pending, cache, cacheTime = 0;
async function health() {
  if (cache && Date.now() - cacheTime < 5000) return cache;
  if (pending) return pending;
  pending = (async () => {
    const [packages, ffmpeg, ffprobe] = await Promise.all([
      check(python, ['-c', 'import importlib.util,json; print(json.dumps({n:bool(importlib.util.find_spec(n)) for n in ["yt_dlp","demucs","torch","torchaudio","soundfile"]}))']),
      check('ffmpeg', ['-version']), check('ffprobe', ['-version'])
    ]);
    let modules = {};
    try { modules = JSON.parse(packages.text); } catch { /* Missing/broken environment. */ }
    const checks = { python: packages.ok, node: Number(process.versions.node.split('.')[0]) >= 22, ffmpeg: ffmpeg.ok, ffprobe: ffprobe.ok,
      ytDlp: modules.yt_dlp === true, demucs: modules.demucs === true, torch: modules.torch === true,
      torchaudio: modules.torchaudio === true, soundfile: modules.soundfile === true };
    cache = { app: 'karaoke-local-helper', version: 1, features: ['library', 'stem-preview', 'library-location', 'separation-progress', 'rebuild-song', 'lead-vocals', 'separation-models', 'score-masks', 'pitch-methods', 'residual-separation', 'mel-roformer'], ready: Object.values(checks).every(Boolean), checks, audioUpload: false };
    cacheTime = Date.now(); return cache;
  })().finally(() => { pending = null; });
  return pending;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(req.headers.host)) { res.writeHead(403); res.end(); return; }
  if (!origins.has(req.headers.origin)) { res.writeHead(403); res.end(); return; }
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Karaoke-Token'); res.writeHead(204); res.end(); return; }
  try { if (await handleLocalJobs(req, res)) return; } catch { res.writeHead(500); res.end(JSON.stringify({error:'本機工作處理失敗。'})); return; }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (req.url !== '/health') { res.writeHead(404); res.end(); return; }
  try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(await health())); }
  catch { res.writeHead(500); res.end(JSON.stringify({ error: 'Local environment check failed' })); }
});
server.on('error', err => { console.error(err.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Local tool status: http://127.0.0.1:${port}/health`));

await clearStaleJobs();
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await clearAllJobs(); server.close(() => process.exit(0)); });
