// Real browser + Web Audio input. Deterministic player/helper fixtures isolate session behavior.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const site = `http://localhost:${process.env.PORT || 4173}`;
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
    await page.route(site+'/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(/^\/[a-z-]+\.(?:mjs|css)$/.test(pathname)) {
        bareRequests.push(pathname);
        await route.fulfill({body:pathname.endsWith('.css')?'body{display:none}':"throw new Error('Cached old release loaded')",contentType:pathname.endsWith('.css')?'text/css':'text/javascript'});
      } else await route.fallback();
    });
  }
  let serial = 0, supportModels = true;
  const library = new Map();
  await page.route('http://127.0.0.1:4174/**', async route => {
    const req=route.request(), url=new URL(req.url()); let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song','lead-vocals',...(supportModels?['separation-models']:[])]};
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture-only'};
    else if(url.pathname==='/library')value={songs:[...library.values()].map(r=>({id:r.cacheId,title:r.title,videoId:r.videoId,seconds:r.rangeSeconds,hasPreview:r.hasPreview,vocalMode:r.vocalMode,separationModel:r.separationModel,bytes:1000}))};
    else if(req.method()==='DELETE') {removed.push(url.pathname);value={cleared:true};}
    else if(req.method()==='POST') {requests.push(req.postDataJSON());value={id:String(++serial).padStart(32,'0')};}
    else if(url.pathname.endsWith('/reference')) {
      const request=requests[Number(url.pathname.split('/')[2])-1];
      value={version:1,videoId:request.videoId,vocalMode:request.vocalMode||'all',separationModel:request.separationModel||'demucs',cacheId:request.videoId+'_30'+(request.vocalMode==='lead'?'_lead':'')+(request.separationModel==='bs-roformer'?'_bs-roformer':'')+'_v1',title:'Preview fixture',step:.1,duration:30,frames:Array(300).fill(440),rangeSeconds:request.seconds,hasPreview:Number(url.pathname.split('/')[2]) > 1,beats:[],bpm:0};
      library.set(value.cacheId,value);
    } else if(url.pathname.startsWith('/library/')) {
      await route.fulfill({body:data,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;
    } else value={stage:'ready',ready:true,message:'ready'};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':site}});
  });
  await page.goto(site+'/');
  assert.equal(await page.locator('#vocal-mode').inputValue(),'all');
  assert.equal(await page.locator('#separation-model').inputValue(),'demucs');
  await page.locator('#preview-panel summary').click();
  assert.ok(await page.locator('#lead-preview-buttons').isHidden());
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
  await page.locator('#vocal-mode').selectOption('lead');
  assert.match(await page.locator('#prepare-status').textContent(),/尚未套用/);
  await page.locator('#rebuild-song').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-lead').disabled);
  assert.deepEqual(requests[3],{videoId:'M7lc1UVf-VE',seconds:30,preview:true,vocalMode:'lead',force:true});
  assert.ok(await page.locator('#lead-preview-buttons').isVisible());
  assert.match(await page.locator('#result-title').textContent(),/以主唱評分/);
  assert.match(await page.locator('#prepare-status').textContent(),/主唱／和音模式/);
  for (const stem of ['lead','backing']) {
    await page.locator('#preview-'+stem).click();
    await page.waitForFunction(()=>{const a=document.querySelector('#stem-audio');return a.duration>2&&a.currentTime>.1&&!a.paused;});
  }
  await page.locator('#vocal-mode').selectOption('all');
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-vocals').disabled);
  assert.ok(await page.locator('#lead-preview-buttons').isHidden());
  assert.equal(requests[4].vocalMode,undefined);
  // A new first-stage model must not reuse Demucs results, and both vocal modes work.
  await page.locator('#separation-model').selectOption('bs-roformer');
  assert.match(await page.locator('#prepare-status').textContent(),/尚未套用/);
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(requests[5].separationModel,'bs-roformer');
  assert.match(await page.locator('#prepare-status').textContent(),/BS-RoFormer/);
  await page.locator('#preview-vocals').click();
  await page.waitForFunction(()=>document.querySelector('#stem-audio').currentTime>.1);
  assert.match(await page.locator('#preview-status').textContent(),/BS-RoFormer/);
  await page.locator('#vocal-mode').selectOption('lead');
  await page.locator('#rebuild-song').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-lead').disabled);
  assert.equal(requests[6].separationModel,'bs-roformer');
  assert.equal(requests[6].vocalMode,'lead');
  assert.equal(requests[6].force,true);
  await page.locator('#preview-lead').click();
  await page.waitForFunction(()=>document.querySelector('#stem-audio').currentTime>.1);
  await page.locator('#library-panel summary').click();
  await page.locator('[data-song-id="M7lc1UVf-VE_30_v1"]').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(await page.locator('#separation-model').inputValue(),'demucs');
  assert.match(await page.locator('#prepare-status').textContent(),/Demucs/);
  assert.equal(requests[7].separationModel,undefined);
  await page.locator('[data-song-id="M7lc1UVf-VE_30_lead_bs-roformer_v1"]').click();
  await page.waitForFunction(()=>!document.querySelector('#preview-lead').disabled);
  assert.equal(requests[8].separationModel,'bs-roformer');
  assert.equal(requests[8].vocalMode,'lead');
  // An old helper cannot silently create a Demucs reference for a BS-RoFormer request.
  supportModels=false;
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.includes('本機工具需要更新才能使用 BS-RoFormer'));
  assert.equal(requests.length,9);
  // The manual must open a separate tab and every table-of-contents link must resolve.
  const opened=context.waitForEvent('page');
  await page.locator('a[href="manual.html"]').click();
  const manual=await opened; await manual.waitForLoadState();
  assert.ok(manual.url().endsWith('/manual.html'));
  assert.equal(await manual.locator('h1').textContent(),'從選歌，到唱完一輪');
  assert.equal(await manual.evaluate(()=>window.opener),null);
  assert.ok(await manual.evaluate(()=>[...document.querySelectorAll('nav a')].every(a=>document.querySelector(a.hash))));
  await manual.setViewportSize({width:1440,height:1000});
  await manual.screenshot({path:'test-results/manual-desktop.png'});
  await manual.setViewportSize({width:390,height:844});
  assert.ok(await manual.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await manual.screenshot({path:'test-results/manual-mobile.png'});
  await manual.close();
  // Failed capability check has already unloaded the active preview.
  assert.ok(await page.locator('#stem-audio').isHidden());
  assert.equal(await page.locator('#stem-audio').getAttribute('src'),null);
  assert.deepEqual(errors,[]);
  assert.deepEqual(bareRequests,[], 'production must bypass stale bare module and CSS URLs');
  console.log('Demucs/BS-RoFormer caches, legacy reload, helper capability, default/lead modes, missing-preview upgrade, four decoded previews, rebuild, unload, manual new tab and responsive layout passed.');
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
