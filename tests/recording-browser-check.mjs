// Real browser + Web Audio input. Deterministic player/helper fixtures isolate session behavior.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { normalizeMasks } from '../scoring.mjs';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const site = `http://localhost:${process.env.PORT || 4173}`;
const root = path.resolve(import.meta.dirname, '..');
const rate = 48000, data = Buffer.alloc(44 + rate * 3 * 2);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
for (let i = 0; i < rate * 3; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 10000), 44 + i * 2);
const bsData=Buffer.from(data);
for(let i=0;i<rate*3;i++)bsData.writeInt16LE(Math.round(Math.sin(2*Math.PI*660*i/rate)*10000),44+i*2);
const melData=Buffer.from(data);
for(let i=0;i<rate*3;i++)melData.writeInt16LE(Math.round(Math.sin(2*Math.PI*880*i/rate)*10000),44+i*2);
const audioHash=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let serial=0, hasPreview=true, backingRequests=0;
  const ref=()=>({version:1,videoId:'M7lc1UVf-VE',title:'Recording fixture',cacheId:'M7lc1UVf-VE_30_v1',step:.1,duration:30,rangeSeconds:30,frames:Array(300).fill(440),beats:[],bpm:0,hasPreview});
  await page.route('http://127.0.0.1:4174/**',async route=>{
    const req=route.request(),url=new URL(req.url());let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song','lead-vocals','score-masks','pitch-methods','separation-models']};
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture'};
    else if(url.pathname==='/library')value={songs:[]};
    else if(url.pathname.endsWith('/accompaniment')) {backingRequests++;await route.fulfill({body:bsData,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(req.method()==='DELETE')value={cleared:true};
    else if(req.method()==='POST')value={id:String(++serial).padStart(32,'0')};
    else if(url.pathname.endsWith('/reference'))value=ref();
    else value={stage:'ready',ready:true};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':site}});
  });
  await page.goto(site+'/');
  await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {RecordingStore}=await import(new URL('recording-store.mjs',script));
    window.recordStore=new RecordingStore();
    window.recorderCreated=0;const NativeRecorder=window.MediaRecorder;window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);window.recorderCreated++;}};
  });
  const records=()=>page.evaluate(()=>recordStore.list());
  async function waitRecords(count){await page.waitForFunction(async n=>(await recordStore.list()).filter(x=>x.complete).length===n,count);}
  async function start(){await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('● 錄音中'));}
  async function delay(ms){await page.waitForTimeout(ms);}
  async function spectrum(id,offset=.35){return page.evaluate(async ({id,offset})=>{
    const rows=await recordStore.list(),row=rows.find(x=>x.id===id),blob=await recordStore.blob(row),ctx=new AudioContext();
    const audio=await ctx.decodeAudioData(await blob.arrayBuffer()),samples=audio.getChannelData(0),rate=audio.sampleRate;
    const from=Math.floor(rate*offset),length=Math.min(Math.floor(rate*.5),samples.length-from);
    function power(hz){let c=0,s=0;for(let i=0;i<length;i++){c+=samples[from+i]*Math.cos(2*Math.PI*hz*i/rate);s+=samples[from+i]*Math.sin(2*Math.PI*hz*i/rate);}return 2*Math.hypot(c,s)/length;}
    const result={voice:power(440),backing:power(660),duration:audio.duration,bytes:blob.size};await ctx.close();return result;
  },{id,offset});}
  await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.locator('#clip-seconds').selectOption('30');await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(await page.locator('#recording-mode').inputValue(),'voice');
  assert.equal(await page.locator('#recording-manual').isChecked(),false);
  assert.ok(await page.locator('#recording-voice-level').isDisabled());
  // Testing the microphone alone must not store audio.
  await page.locator('#mic-start').click();await delay(500);assert.equal((await records()).length,0);
  await start();await delay(1600);
  const chunksDuring=await records();assert.equal(chunksDuring.length,1);assert.equal(chunksDuring[0].complete,false);
  await page.locator('#mic-stop').click();await waitRecords(1);
  await page.waitForFunction(()=>fixturePlayer.getCurrentTime()<=.05);
  assert.ok(await page.locator('#finish-song').isEnabled());
  const voice=(await records())[0],voiceAudio=await spectrum(voice.id);
  assert.ok(voiceAudio.voice>.05,JSON.stringify(voiceAudio));assert.ok(voiceAudio.backing<.01,JSON.stringify(voiceAudio));assert.equal(backingRequests,0);
  await page.locator('#finish-song').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  assert.equal((await records()).length,1,'manual scoring after stopping must not duplicate recording');
  await page.locator('#recording-mode').selectOption('mix');
  await page.locator('#recording-manual').check();
  await page.locator('#recording-voice-level').fill('60');await page.locator('#recording-backing-level').fill('80');
  assert.match(await page.locator('#recording-balance-help').textContent(),/±3 dB/);

  await start();assert.ok(await page.locator('#recording-manual').isDisabled());await delay(1000);
  await page.evaluate(()=>fixturePlayer.pauseVideo());await delay(900);
  const pauseSeconds=(await records())[0].seconds;
  const balanceStatus=await page.locator('#recording-balance-status').textContent();assert.match(balanceStatus,/人聲修正.*伴奏修正/);
  await page.evaluate(()=>fixturePlayer.seekTo(10));await delay(60);
  await page.evaluate(()=>fixturePlayer.playVideo());await delay(900);
  await page.evaluate(()=>fixturePlayer.endVideo());await waitRecords(2);
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  const mixed=(await records()).find(x=>x.mode==='mix'),mixedAudio=await spectrum(mixed.id);
  assert.ok(mixedAudio.voice>.03&&mixedAudio.backing>mixedAudio.voice*1.1,JSON.stringify(mixedAudio));
  assert.deepEqual(mixed.balance,{manual:true,voice:60,backing:80});assert.equal(voice.balance.manual,false);
  assert.ok(mixed.seconds<2.6&&mixed.seconds>1.5,JSON.stringify(mixed));
  const afterSeek=await spectrum(mixed.id,1.3);assert.ok(afterSeek.voice>.03&&afterSeek.backing<.01,JSON.stringify(afterSeek));
  assert.ok(backingRequests>0);assert.ok(pauseSeconds<1.8);
  // Restarting saves the old recording and creates another one; finishing saves once.
  await page.locator('#recording-mode').selectOption('voice');await start();await delay(650);
  await start();await waitRecords(3);await delay(650);await page.locator('#finish-song').click();await waitRecords(4);
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  assert.equal(new Set((await records()).map(x=>x.id)).size,4);
  // Off leaves microphone scoring available and writes no audio.
  const beforeOff=await page.evaluate(()=>recorderCreated);
  await page.locator('#recording-mode').selectOption('off');await page.locator('#sing-start').click();await delay(650);await page.locator('#finish-song').click();
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));assert.equal((await records()).length,4);
  assert.equal(await page.evaluate(()=>recorderCreated),beforeOff,'off must not even construct a MediaRecorder');
  // Storage exhaustion must preserve a downloadable in-memory backup, never report saved.
  await page.evaluate(()=>{window.storeSave=Object.getPrototypeOf(recordStore).save;Object.getPrototypeOf(recordStore).save=async()=>{throw new DOMException('Fixture quota','QuotaExceededError');};});
  await page.locator('#recording-mode').selectOption('voice');await start();await delay(1200);await page.locator('#finish-song').click();
  await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('錄音未完整保存'));
  assert.ok(await page.locator('#recording-rescue').isVisible());
  const rescueDownload=page.waitForEvent('download');await page.locator('#recording-rescue a').first().click();assert.ok((await rescueDownload).suggestedFilename().endsWith('.webm'));
  await page.evaluate(()=>{Object.getPrototypeOf(recordStore).save=window.storeSave;});assert.equal((await records()).length,4);
  // Waiting for autoplay cannot create a misleading empty recording.
  await page.evaluate(()=>{window.playOriginal=fixturePlayer.playVideo;fixturePlayer.playVideo=()=>{};});
  await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('影片已回到開頭'));
  await page.locator('#mic-stop').click();await delay(200);assert.equal((await records()).length,4);
  await page.evaluate(()=>{fixturePlayer.playVideo=window.playOriginal;});await page.locator('#finish-song').click();
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('歌曲已保留'));
  // Same-name scores are selected independently and deletion never affects recordings.
  await page.evaluate(()=>{localStorage.setItem('karaoke.scores.v1',JSON.stringify([{title:'Same song',score:70},{title:'Same song',score:80},{title:'Other song',score:90}]));window.dispatchEvent(new StorageEvent('storage',{key:'karaoke.scores.v1'}));});
  await page.locator('#history-panel summary').click();
  await page.locator('#score-history input[value="1"]').check();
  assert.ok(await page.locator('#history-select-all').evaluate(x=>x.indeterminate));
  await page.locator('#delete-history-selected').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('karaoke.scores.v1'))),[{title:'Same song',score:70},{title:'Other song',score:90}]);
  await page.locator('#history-select-all').check();assert.equal(await page.locator('#score-history input:checked').count(),2);
  await page.locator('#history-select-all').uncheck();assert.ok(await page.locator('#delete-history-selected').isDisabled());
  await page.locator('#clear-history').click();assert.equal(await page.evaluate(()=>localStorage.getItem('karaoke.scores.v1')),null);assert.equal((await records()).length,4);
  await page.locator('#recordings-panel summary').click();
  await page.locator('#recording-list').getByRole('button',{name:'試聽',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('#recording-audio').currentTime>.1);
  const downloaded=page.waitForEvent('download');await page.locator('#recording-list').getByRole('button',{name:'下載',exact:true}).first().click();
  assert.ok((await downloaded).suggestedFilename().endsWith('.webm'));
  // Reload preserves all recordings; delete only removes the selected recording.
  await page.locator('#recording-mode').selectOption('off');
  await page.reload();assert.equal(await page.locator('#recording-mode').inputValue(),'off');assert.ok(await page.locator('#recording-manual').isChecked());assert.equal(await page.locator('#recording-voice-level').inputValue(),'60');assert.equal(await page.locator('#recording-backing-level').inputValue(),'80');await page.locator('#recordings-panel summary').click();await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===12);
  await page.locator('#recording-list').getByRole('button',{name:'刪除',exact:true}).first().click();await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===9);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const peak=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {createRecordingMix}=await import(new URL('recording-mix.mjs',script));
    const ctx=new OfflineAudioContext(1,48000,48000),mic=ctx.createConstantSource(),backing=ctx.createConstantSource();mic.offset.value=1;backing.offset.value=1;
    const mix=createRecordingMix(ctx,mic,ctx.destination,{mode:'mix',settings:{manual:true,voice:100,backing:100},voiced:()=>true});
    backing.connect(mix.input);mic.start();backing.start();const out=await ctx.startRendering();
    return out.getChannelData(0).reduce((peak,x)=>Math.max(peak,Math.abs(x)),0);
  });assert.ok(peak<=.981&&peak>.5,peak);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({voiceAudio,mixedAudio,balanceStatus,peak,manualAutoRatio:true,defaultAuto:true,incrementalSave:true,pauseResume:true,seekBeyondBacking:true,quotaRecovery:true,emptyRecordingAvoided:true,stopRewind:true,automaticFinish:true,restartSeparate:true,off:true,selectiveAndAllScoreDeletion:true,persistence:true,download:true,deleteOne:true,errors}));
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
