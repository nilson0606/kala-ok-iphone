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
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`] });
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
  const bareRequests=[];
  if(process.env.KARAOKE_SITE_DIR) {
    // A returning browser may still have stale responses at these pre-versioning URLs.
    await page.route('http://localhost:4173/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(/^\/[a-z-]+\.(?:mjs|css)$/.test(pathname)) {
        bareRequests.push(pathname);
        await route.fulfill({body:pathname.endsWith('.css')?'body{display:none}':"throw new Error('Cached old release loaded')",contentType:pathname.endsWith('.css')?'text/css':'text/javascript'});
      } else await route.fallback();
    });
  }
  let serial = 0;
  await page.route('http://127.0.0.1:4174/**', async route => {
    const req=route.request(), url=new URL(req.url()); let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song','lead-vocals']};
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture-only'};
    else if(url.pathname==='/library')value={songs:[]};
    else if(req.method()==='DELETE') {removed.push(url.pathname);value={cleared:true};}
    else if(req.method()==='POST') {requests.push(req.postDataJSON());value={id:String(++serial).padStart(32,'0')};}
    else if(url.pathname.endsWith('/reference')) {
      const request=requests[Number(url.pathname.split('/')[2])-1];
      value={version:1,videoId:request.videoId,vocalMode:request.vocalMode||'all',cacheId:request.videoId+(request.vocalMode==='lead'?'_30_lead_v1':'_30_v1'),title:'Preview fixture',step:.1,duration:30,frames:Array(300).fill(440),rangeSeconds:request.seconds,hasPreview:Number(url.pathname.split('/')[2]) > 1,beats:[],bpm:0};
    } else if(url.pathname.startsWith('/library/')) {
      await route.fulfill({body:data,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'http://localhost:4173'}});return;
    } else value={stage:'ready',ready:true,message:'ready'};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':'http://localhost:4173'}});
  });
  await page.goto('http://localhost:4173/');
  await page.locator('#pitch-method').selectOption('yin'); // This scenario uses a saved YIN fixture.
  assert.equal(await page.locator('#score-range').inputValue(),'performed');
  assert.equal(await page.locator('#score-difficulty').inputValue(),'standard');
  await page.locator('#url').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#clip-seconds').selectOption('30');
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  for(const [difficulty,label] of [['standard','標準'],['strict','嚴格'],['relaxed','寬鬆']]) {
    await page.locator('#score-difficulty').selectOption(difficulty);
    if(difficulty==='standard') {
      await page.locator('#mic-start').click();
      await page.evaluate(()=>window.fixturePlayer.playVideo());
    } else await page.locator('#sing-start').click();
    await page.waitForFunction(()=>window.fixturePlayer.getPlayerState()===1&&document.querySelector('#score-status').textContent.includes('演唱中'));
    assert.ok(await page.locator('#score-difficulty').isDisabled());
    assert.match(await page.locator('#take-difficulty').textContent(),new RegExp(label));
    await page.waitForFunction(()=>window.fixturePlayer.getCurrentTime()>1);
    await page.locator('#finish-song').click();
    await page.waitForFunction(()=>document.querySelector('#score-difficulty').disabled===false);
    assert.match(await page.locator('#take-difficulty').textContent(),new RegExp('已結算.*'+label));
    assert.equal(await page.locator('#score-range').inputValue(),'performed');
  }
  assert.equal(requests.length,1,'changing difficulty must not rebuild the song');
  await page.locator('#score-difficulty').selectOption('standard');
  assert.match(await page.locator('#take-difficulty').textContent(),/已結算.*寬鬆/,'changing the next round must not relabel the previous result');
  await page.locator('#score-section').screenshot({path:'test-results/difficulty-score.png'});
  assert.deepEqual(errors,[]);
  console.log('All difficulty options, button/native playback, per-round locking, result labels, performed default and reusable reference passed.');
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
