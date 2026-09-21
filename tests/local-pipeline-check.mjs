// Opt-in online integration test: local download -> separation -> reference -> deletion.
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
const base = 'http://127.0.0.1:4174', origin = 'https://nilson0606.github.io';
const headers = { Origin: origin };
assert.equal((await fetch(base + '/session', { headers: { Origin: 'https://example.org' } })).status, 403);
assert.equal((await fetch(base + '/jobs', { method: 'POST', headers })).status, 403);
const { token } = await (await fetch(base + '/session', { headers })).json();
headers['X-Karaoke-Token'] = token; headers['Content-Type'] = 'application/json';
assert.equal((await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify({ videoId: '../../bad', seconds: 30, preview: true }) })).status, 400);
let job, reused;
const cacheId = 'yCjJyiqpAuU_30_v1';
try {
  const response = await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify({ videoId: 'yCjJyiqpAuU', seconds: 30, preview: true }) });
  assert.equal(response.status, 202); job = await response.json();
  let last, ready = false;
  const start = Date.now();
  while (Date.now() - start < 600000) {
    const state = await (await fetch(`${base}/jobs/${job.id}`, { headers })).json();
    if (state.stage !== last) { console.log(state.stage, state.message); last = state.stage; }
    assert.notEqual(state.stage, 'failed', state.message);
    if (state.ready) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  assert.ok(ready, 'pipeline timeout');
  const ref = await (await fetch(`${base}/jobs/${job.id}/reference`, { headers })).json();
  assert.equal(ref.videoId, 'yCjJyiqpAuU'); assert.ok(ref.voicedSeconds >= 3);
  assert.ok(ref.duration > 29 && ref.duration < 31);
  assert.ok(ref.frames.some(Number.isFinite));
  assert.equal(ref.hasPreview, true);
  const preview = await fetch(`${base}/library/${cacheId}/vocals`, { headers });
  assert.equal(preview.headers.get('content-type'), 'audio/mpeg');
  assert.ok((await preview.arrayBuffer()).byteLength > 1000);
  const again = await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify({ videoId: 'yCjJyiqpAuU', seconds: 30, preview: true }) });
  reused = await again.json(); assert.equal(reused.cached, true); assert.equal(reused.ready, true);
  await assert.rejects(access(path.resolve('.runtime/jobs', job.id)), 'generated audio and disk reference must be gone');
  console.log(JSON.stringify({ title: ref.title, duration: ref.duration, voicedSeconds: ref.voicedSeconds, bpm: ref.bpm, elapsedSeconds: Math.round((Date.now() - start) / 1000), transientFilesCleared: true, librarySaved: true, previewReadable: true, cacheReused: true }));
} finally {
  if (reused) await fetch(`${base}/jobs/${reused.id}`, { method: 'DELETE', headers });
  if (job) {
    const response = await fetch(`${base}/jobs/${job.id}`, { method: 'DELETE', headers });
    assert.equal(response.status, 200);
    assert.equal((await fetch(`${base}/jobs/${job.id}/reference`, { headers })).status, 404);
    console.log('Session removed; persistent reference remains in the local song library for listening.');
  }
}
