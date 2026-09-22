import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LibraryLocation } from '../library-location.mjs';
import { LocalLibrary, cacheKey } from '../local-library.mjs';

async function removeFixture(dir) {
  if (path.dirname(path.resolve(dir)) === path.resolve(tmpdir()) && path.basename(dir).startsWith('karaoke-location-')) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
}

test('first run requires a choice; existing library is suggested; paths persist and switching preserves files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'karaoke-location-'));
  try {
    const runtime = path.join(dir, 'runtime'), home = path.join(dir, 'user');
    const location = new LibraryLocation(runtime, home);
    assert.deepEqual(await location.get(), { configured: false, path: '', suggestedPath: path.join(home, 'Music', 'Karaoke'), existingLibrary: false });
    const legacy = path.join(runtime, 'library'); await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'existing-song.txt'), 'keep');
    assert.equal((await location.get()).suggestedPath, legacy);
    assert.equal((await location.get()).configured, false);
    await assert.rejects(location.set('../relative'));
    await assert.rejects(location.set(path.parse(dir).root));
    await assert.rejects(location.set(path.join(runtime, 'jobs', 'bad')));
    const selected = path.join(dir, '我的 歌曲庫');
    await location.set(selected);
    assert.equal((await new LibraryLocation(runtime, home).get()).path, selected);
    await location.set(legacy);
    assert.equal(await readFile(path.join(legacy, 'existing-song.txt'), 'utf8'), 'keep');
  } finally { await removeFixture(dir); }
});

test('helper enforces setup, auth and idle-only changes; selected library survives helper restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'karaoke-location-')); let child;
  const origin = 'http://localhost:4173'; let base, token;
  async function start() {
    child = spawn(process.execPath, [path.join(dir, 'helper-local.mjs')], { windowsHide: true, env: { ...process.env, KARAOKE_HELPER_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('helper startup timeout')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.once('data', chunk => { clearTimeout(timer); resolve(chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]); });
    });
    token = (await (await fetch(base + '/session', { headers: { Origin: origin } })).json()).token;
  }
  async function request(url, method = 'GET', value, authorized = true) {
    return fetch(base + url, { method, headers: { Origin: origin, 'X-Karaoke-Token': authorized ? token : 'bad', 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  }
  async function stop() { if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } }
  try {
    for (const file of ['helper-local.mjs', 'local-jobs.mjs', 'local-library.mjs', 'library-location.mjs', 'scoring.mjs']) await copyFile(new URL('../' + file, import.meta.url), path.join(dir, file));
    // Bind a random test port without exposing the helper outside loopback.
    const helper = path.join(dir, 'helper-local.mjs');
    let source = await readFile(helper, 'utf8');
    source = source.replace('`127.0.0.1:${port}`, `localhost:${port}`', '`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`').replace('${port}/health', '${server.address().port}/health');
    await writeFile(helper, source);
    await start();
    assert.equal((await request('/library/location', 'GET', undefined, false)).status, 403);
    assert.equal((await (await request('/library/location')).json()).configured, false);
    assert.equal((await request('/jobs', 'POST', { videoId: 'M7lc1UVf-VE', seconds: 30 })).status, 409);
    const first = path.join(dir, 'first'), second = path.join(dir, 'second');
    assert.equal((await request('/library/location', 'POST', { path: first })).status, 200);
    const library = new LocalLibrary(first), id = cacheKey('M7lc1UVf-VE', 30);
    await library.save(id, { version: 1, videoId: 'M7lc1UVf-VE', title: 'Retained', step: .1, frames: Array(40).fill(440), duration: 4, rangeSeconds: 30 }, dir, false);
    assert.equal((await request('/jobs','POST',{videoId:'M7lc1UVf-VE',seconds:30,separationModel:'unknown'})).status,400);
    const bsId=cacheKey('M7lc1UVf-VE',30,'all','bs-roformer');
    await writeFile(path.join(dir,'vocals.mp3'),'bs-vocals'); await writeFile(path.join(dir,'accompaniment.mp3'),'bs-accompaniment');
    await library.save(bsId,{version:1,videoId:'M7lc1UVf-VE',title:'BS fixture',step:.1,frames:Array(40).fill(440),duration:4,rangeSeconds:30,separationModel:'bs-roformer'},dir,true);
    const bsJob=await (await request('/jobs','POST',{videoId:'M7lc1UVf-VE',seconds:30,separationModel:'bs-roformer',preview:true})).json();
    assert.equal(bsJob.cached,true); assert.equal(bsJob.separationModel,'bs-roformer'); assert.equal(bsJob.cacheId,bsId);
    assert.equal((await (await request('/library/'+bsId+'/reference')).json()).separationModel,'bs-roformer');
    assert.equal(await (await request('/library/'+bsId+'/vocals')).text(),'bs-vocals');
    await request('/library/'+bsId,'DELETE');
    assert.equal((await request('/jobs/'+bsJob.id)).status,404);
    assert.ok(await library.get(id));
    const job = await (await request('/jobs', 'POST', { videoId: 'M7lc1UVf-VE', seconds: 30 })).json();
    assert.equal(job.cached, true);
    assert.equal((await request('/library/location', 'POST', { path: second })).status, 409);
    await request('/jobs/' + job.id, 'DELETE');
    const rebuilt = await (await request('/jobs', 'POST', { videoId:'M7lc1UVf-VE', seconds:30, force:true })).json();
    assert.equal(rebuilt.cached, false, 'force must bypass an existing song cache');
    let failed;
    for(let attempt=0; attempt<50; attempt++) {
      failed=await (await request('/jobs/'+rebuilt.id)).json();
      if(failed.stage==='failed')break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(failed.stage,'failed','isolated test helper intentionally has no Python runtime');
    assert.equal((await library.get(id)).title,'Retained');
    await request('/jobs/'+rebuilt.id,'DELETE');

    assert.equal((await request('/library/location', 'POST', { path: second })).status, 200);
    assert.equal((await (await request('/library')).json()).songs.length, 0);
    await request('/library/location', 'POST', { path: first });
    await stop(); await start();
    assert.equal((await (await request('/library/location')).json()).path, first);
    assert.equal((await (await request('/library')).json()).songs[0].title, 'Retained');
  } finally { await stop(); await removeFixture(dir); }
});
