// Real browser + Web Audio input. Deterministic player/helper fixtures isolate session behavior.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const root = path.resolve(import.meta.dirname, '..');
const rate = 48000, data = Buffer.alloc(44 + rate * 3 * 2);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
for (let i = 0; i < rate * 3; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 10000), 44 + i * 2);
const fixture = path.join(tmpdir(), `karaoke-flow-${process.pid}.wav`); await writeFile(fixture, data);
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.stderr.once('data', chunk => reject(new Error(chunk.toString()))); });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.YT = { Player: class {
      constructor(id, options) { this.options = options; this.time = 0; this.state = -1; window.fixturePlayer = this; setTimeout(() => options.events.onReady({ target: this }), 5); }
      cueVideoById(videoId) { this.videoId = videoId; this.time = 0; this.state = 5; }
      getCurrentTime() { return this.time + (this.state === 1 ? (performance.now() - this.started) / 1000 : 0); }
      getPlayerState() { return this.state; }
      seekTo(t) { this.lastSeek = t; setTimeout(() => { this.time = t; this.started = performance.now(); }, this.seekDelay || 0); }
      playVideo() { this.lastPlayPosition = this.time; this.started = performance.now(); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.time = this.getCurrentTime(); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
      endVideo() { this.time = this.getCurrentTime(); this.state = 0; this.options.events.onStateChange({ data: 0 }); }
      buffer() { this.time = this.getCurrentTime(); this.state = 3; this.options.events.onStateChange({ data: 3 }); }
    }};
  });
  const page = await context.newPage(), errors = [], requests = [], removed = [];
  page.on('pageerror', error => errors.push(error.message));
  let serial = 0;
  await page.route('http://127.0.0.1:4174/**', async route => {
    const req=route.request(), url=new URL(req.url()); let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song']};
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture-only'};
    else if(url.pathname==='/library')value={songs:[]};
    else if(req.method()==='DELETE') {removed.push(url.pathname);value={cleared:true};}
    else if(req.method()==='POST') {requests.push(req.postDataJSON());value={id:String(++serial).padStart(32,'0')};}
    else if(url.pathname.endsWith('/reference')) {
      const request=requests[Number(url.pathname.split('/')[2])-1];
      value={version:1,videoId:request.videoId,cacheId:request.videoId+'_30_v1',title:'Preview fixture',step:.1,duration:30,frames:Array(300).fill(440),rangeSeconds:request.seconds,hasPreview:Number(url.pathname.split('/')[2]) > 1,beats:[],bpm:0};
    } else if(url.pathname.startsWith('/library/')) {
      await route.fulfill({body:data,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'http://localhost:4173'}});return;
    } else value={stage:'ready',ready:true,message:'ready'};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':'http://localhost:4173'}});
  });
  await page.goto('http://localhost:4173/');
  await page.locator('#preview-panel summary').click();
  assert.match(await page.locator('#preview-status').textContent(),/先載入歌曲/);
  assert.ok(await page.locator('#stem-audio').isHidden());
  await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await page.locator('#clip-seconds').selectOption('30');
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.ok(await page.locator('#keep-preview').isChecked());
  assert.equal(requests[0].preview,true);
  assert.match(await page.locator('#preview-status').textContent(),/未保留/);
  assert.ok(await page.locator('#preview-vocals').isDisabled());
  assert.ok(await page.locator('#preview-build').isEnabled());
  // Editing unrelated source controls must not change which cached song is upgraded.
  await page.locator('#url').fill('https://www.youtube.com/watch?v=yCjJyiqpAuU');
  await page.locator('#clip-seconds').selectOption('0');
  await page.locator('#preview-build').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-vocals').disabled);
  assert.deepEqual(requests[1],{videoId:'M7lc1UVf-VE',seconds:30,preview:true});
  assert.ok(removed.every(x=>x.startsWith('/jobs/')));
  assert.ok(await page.locator('#preview-build').isHidden());
  assert.match(await page.locator('#preview-status').textContent(),/音軌已就緒/);
  for(const stem of ['vocals','accompaniment']) {
    await page.locator('#preview-'+stem).click();
    await page.waitForFunction(()=>{const a=document.querySelector('#stem-audio');return a.duration>2&&a.currentTime>.1&&!a.paused;});
    assert.ok(await page.locator('#stem-audio').isVisible());
  }
  await page.locator('#rebuild-song').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-vocals').disabled);
  assert.deepEqual(requests[2],{videoId:'M7lc1UVf-VE',seconds:30,preview:true,force:true});
  await page.locator('#cancel-song').click();
  assert.ok(await page.locator('#stem-audio').isHidden());
  assert.equal(await page.locator('#stem-audio').getAttribute('src'),null);
  assert.deepEqual(errors,[]);
  console.log('Missing preview explanation, upgrade of original song/range, both decoded previews and unloading passed.');
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
