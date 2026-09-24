// Real browser + Web Audio input. Deterministic player/helper fixtures isolate session behavior.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { normalizeMasks } from '../scoring.mjs';
import {rescoreRecording} from '../recording-process.mjs';
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
      constructor(id, options) { this.options = options; this.videoId = options.videoId; this.time = 0; this.state = -1; window.fixturePlayer = this; setTimeout(() => options.events.onReady({ target: this }), 5); }
      cueVideoById(videoId) { this.videoId = videoId; this.time = 0; this.state = 5; }
      getCurrentTime() { return this.time + (this.state === 1 ? (performance.now() - this.started) / 1000 : 0); }
      getPlayerState() { return this.state; }
      getVideoData() { return {video_id:this.videoId}; }
      isMuted() { return false; }
      getVolume() { return 100; }
      seekTo(t) { this.lastSeek = t; setTimeout(() => { this.time = t; this.started = performance.now(); }, this.seekDelay || 0); }
      playVideo() { this.lastPlayPosition = this.time; this.started = performance.now(); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.time = this.getCurrentTime(); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
      endVideo() { this.time = this.getCurrentTime(); this.state = 0; this.options.events.onStateChange({ data: 0 }); }
      buffer() { this.time = this.getCurrentTime(); this.state = 3; this.options.events.onStateChange({ data: 3 }); }
    }};
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let serial=0, hasPreview=true, backingRequests=0, harmonyRequests=0, vocalMode='all', missingHarmony=false; const stemRequests=[],playbackTraces=[];
  let fixturePitch='yin',fixtureHz=440;
  const ref=()=>({version:1,videoId:'M7lc1UVf-VE',title:'Recording fixture',cacheId:'M7lc1UVf-VE_30_v1',step:.1,duration:30,rangeSeconds:30,frames:Array(300).fill(fixtureHz),pitchMethod:fixturePitch,beats:[],bpm:0,hasPreview,vocalMode});
  await page.route('http://127.0.0.1:4174/**',async route=>{
    const req=route.request(),url=new URL(req.url());let value={};
    if(url.pathname==='/session')value={token:'fixture',features:['library','library-location','separation-progress','rebuild-song','lead-vocals','score-masks','pitch-methods','separation-models','recording-mp3','playback-trace']};
    else if(url.pathname==='/playback-trace'){playbackTraces.push(req.postDataJSON());value={saved:true};}
    else if(url.pathname==='/library/location')value={configured:true,path:'C:/fixture'};
    else if(url.pathname==='/library')value={songs:[]};
    else if(url.pathname.endsWith('/backing')) {harmonyRequests++;stemRequests.push('backing');await route.fulfill({status:missingHarmony?404:200,body:missingHarmony?'missing':melData,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(url.pathname.endsWith('/accompaniment')) {backingRequests++;stemRequests.push('accompaniment');await route.fulfill({body:bsData,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(url.pathname==='/recordings/mp3'){assert.ok(req.postDataBuffer().length>1000);await route.fulfill({body:Buffer.from('ID3fixture'),contentType:'audio/mpeg',headers:{'Access-Control-Allow-Origin':site}});return;}
    else if(req.method()==='DELETE')value={cleared:true};
    else if(req.method()==='POST')value={id:String(++serial).padStart(32,'0')};
    else if(url.pathname.endsWith('/reference'))value=ref();
    else value={stage:'ready',ready:true};
    await route.fulfill({json:value,headers:{'Access-Control-Allow-Origin':site}});
  });
  await page.goto(site+'/?tracePlayback=1');
  assert.equal(await page.locator('#prepare-settings').getAttribute('open'),null);
  await page.locator('#prepare-settings > summary').click();
  await page.locator('#pitch-method').selectOption('yin'); // This scenario uses a saved YIN fixture.
  await page.locator('#separation-method').selectOption('single');
  await page.locator('#separation-model').selectOption('demucs');await page.locator('#vocal-mode').selectOption('all');
  await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {RecordingStore}=await import(new URL('recording-store.mjs',script));
    window.recordStore=new RecordingStore();
    window.recorderCreated=0;const NativeRecorder=window.MediaRecorder;window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);window.recorderCreated++;}};
  });
  const records=()=>page.evaluate(()=>recordStore.list());
  async function waitRecords(count){const end=Date.now()+20000;while(Date.now()<end){if((await records()).filter(x=>x.complete).length===count)return;await delay(50);}assert.fail('Recording did not finish saving');}
  async function start(){await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('● 錄音中'));}
  async function delay(ms){await page.waitForTimeout(ms);}
  async function spectrum(id,offset=.35,track='mix'){return page.evaluate(async ({id,offset,track})=>{
    const rows=await recordStore.list(),row=rows.find(x=>x.id===id),blob=await recordStore.blob(row,track),ctx=new AudioContext();
    const audio=await ctx.decodeAudioData(await blob.arrayBuffer()),samples=audio.getChannelData(0),rate=audio.sampleRate;
    const from=Math.floor(rate*offset),length=Math.min(Math.floor(rate*.5),samples.length-from);
    function power(hz){let c=0,s=0;for(let i=0;i<length;i++){c+=samples[from+i]*Math.cos(2*Math.PI*hz*i/rate);s+=samples[from+i]*Math.sin(2*Math.PI*hz*i/rate);}return 2*Math.hypot(c,s)/length;}
    const result={voice:power(440),backing:power(660),harmony:power(880),duration:audio.duration,bytes:blob.size};await ctx.close();return result;
  },{id,offset,track});}
  await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');await page.locator('#clip-seconds').selectOption('30');await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.equal(await page.locator('#recording-mode').inputValue(),'voice');
  assert.equal(await page.locator('#recording-delay').inputValue(),'150');
  assert.equal(await page.locator('#recording-manual').isChecked(),false);
  assert.ok(await page.locator('#recording-voice-level').isDisabled());
  // Testing the microphone alone must not store audio.
  await page.locator('#mic-start').click();await delay(1500);assert.equal((await records()).length,0);
  const micBefore=playbackTraces.find(x=>x.stage==='mic-before'),micAfter=playbackTraces.find(x=>x.stage==='mic-after-1s');
  assert.ok(micBefore && micAfter,'Mic transitions must reach the local diagnostic endpoint');
  assert.equal(micAfter.youtube.videoId,'M7lc1UVf-VE');assert.equal(micAfter.youtube.videoId,micBefore.youtube.videoId);
  assert.equal(micAfter.youtube.muted,false);assert.equal(micAfter.youtube.volume,100);
  assert.ok(micAfter.media.every(x=>x.paused),'Opening mic must not start any local stem or recording');
  assert.ok(!('deviceId' in micAfter.capture));assert.ok(!('groupId' in micAfter.capture));assert.ok(!('token' in micAfter));

  // A post-processing preview left playing must not overlap a new singing take.
  await page.evaluate(async base64=>{const a=document.querySelector('#post-audio');a.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'audio/wav'}));a.loop=true;a.hidden=false;await a.play();},melData.toString('base64'));
  assert.equal(await page.locator('#post-audio').evaluate(a=>a.paused),false);
  await start();
  assert.equal(await page.locator('#post-audio').evaluate(a=>a.paused),true);
  assert.equal(await page.locator('#post-audio').getAttribute('src'),null);
  await delay(1600);
  const chunksDuring=await records();assert.equal(chunksDuring.length,1);assert.equal(chunksDuring[0].complete,false);
  await page.locator('#mic-stop').click();await waitRecords(1);
  await page.waitForFunction(()=>fixturePlayer.getCurrentTime()<=.05);
  assert.ok(await page.locator('#finish-song').isEnabled());
  const voice=(await records())[0],voiceAudio=await spectrum(voice.id);
  assert.ok(voiceAudio.voice>.05,JSON.stringify(voiceAudio));assert.ok(voiceAudio.backing<.01,JSON.stringify(voiceAudio));assert.equal(backingRequests,0);
  await page.locator('#finish-song').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  assert.equal((await records()).length,1,'manual scoring after stopping must not duplicate recording');
  assert.equal(voice.appliedDelayMs,150,await page.locator('#recording-status').textContent());assert.equal(voice.post.offsetMs,150);assert.equal(voice.mime,'audio/wav');assert.ok(voice.rawMime.startsWith('audio/webm'));
  await page.locator('#recording-mode').selectOption('mix');
  await page.locator('#recording-manual').check();
  await page.locator('#recording-voice-level').fill('60');await page.locator('#recording-backing-level').fill('80');
  assert.match(await page.locator('#recording-balance-help').textContent(),/±3 dB/);

  await start();assert.ok(await page.locator('#recording-manual').isDisabled());await delay(1000);
  await page.evaluate(()=>fixturePlayer.pauseVideo());await delay(900);
  const pauseSeconds=(await records())[0].seconds;
  const balanceStatus=await page.locator('#recording-balance-status').textContent();assert.match(balanceStatus,/人聲修正.*配樂／和音修正/);
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
  // Four-stem versions mix only accompaniment + harmony, using the same gain bus.
  vocalMode='lead';await page.locator('#vocal-mode').selectOption('lead');await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  const beforeStems=stemRequests.length;
  await start();await delay(1000);await page.evaluate(()=>fixturePlayer.pauseVideo());await delay(200);
  await page.evaluate(()=>fixturePlayer.seekTo(1));await delay(60);await page.evaluate(()=>fixturePlayer.playVideo());await delay(800);
  await page.locator('#finish-song').click();await waitRecords(3);
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('已結算'));
  const harmonyRecord=(await records())[0],harmonyAudio=await spectrum(harmonyRecord.id);
  assert.deepEqual(harmonyRecord.stems,['accompaniment','backing']);
  assert.deepEqual(stemRequests.slice(beforeStems),['accompaniment','backing']);
  assert.ok(harmonyAudio.voice>.03&&harmonyAudio.backing>.03&&harmonyAudio.harmony>.03,JSON.stringify(harmonyAudio));
  assert.ok(Math.abs(harmonyAudio.backing/harmonyAudio.harmony-1)<.1,JSON.stringify(harmonyAudio));
  const harmonyAfterSeek=await spectrum(harmonyRecord.id,1.2);
  assert.ok(harmonyAfterSeek.backing>.03&&harmonyAfterSeek.harmony>.03,JSON.stringify(harmonyAfterSeek));
  const rawVoice=await spectrum(harmonyRecord.id,.35,'voice');assert.ok(rawVoice.voice>.03&&rawVoice.backing<.01&&rawVoice.harmony<.01,JSON.stringify(rawVoice));
  assert.ok(harmonyRecord.rawBytes>1000&&harmonyRecord.post.samples.length>5);
  assert.equal(harmonyRecord.post.segments.length,2);
  await page.locator('#post-recording').selectOption(harmonyRecord.id);await page.locator('#post-delay').fill('100');
  await page.locator('#post-rescore').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('重評完成'));
  const rescored=(await records()).find(r=>r.id===harmonyRecord.id);
  assert.equal(rescored.postResult.delayMs,100);assert.equal(rescored.postResult.source,'decoded-voice-v1');assert.ok(rescored.post.audioAnalysis.samples.length>20);
  assert.ok(rescored.post.audioAnalysis.samples.some(s=>s.hz>435&&s.hz<445));
  await page.locator('#post-delay').fill('175');await page.locator('#post-rescore').click();await page.waitForFunction(()=>document.querySelector('#post-score').textContent.includes('校正 175 ms'));
  assert.match(await page.locator('#post-score').textContent(),/同音檔 0 ms 進拍/);
  const original175=(await records()).find(r=>r.id===harmonyRecord.id).postResult;
  // Selecting another pitch method alone must not change an old recording's reference.
  await page.locator('#pitch-method').selectOption('rmvpe');
  await page.locator('#post-reference-source').selectOption('current');
  assert.match(await page.locator('#post-reference-info').textContent(),/目前已載入：YIN/);
  fixturePitch='rmvpe';fixtureHz=523.25;
  await page.locator('#prepare-song').click();
  await page.waitForFunction(()=>document.querySelector('#prepare-status').textContent.includes('RMVPE 音高'));
  assert.match(await page.locator('#post-reference-info').textContent(),/目前已載入：RMVPE/);
  await page.locator('#post-rescore').click();
  await page.waitForFunction(()=>document.querySelector('#post-score').textContent.includes('改用已載入基準 RMVPE'));
  const updated=(await records()).find(r=>r.id===harmonyRecord.id);
  assert.equal(updated.postResult.referenceSource,'current');assert.equal(updated.postResult.reference.pitchMethod,'rmvpe');
  assert.equal(updated.postResult.pitch,0);assert.equal(updated.postResult.baseline.pitch,0);
  assert.deepEqual(updated.post.reference,harmonyRecord.post.reference,'old snapshot and remix stem identity must survive');
  assert.deepEqual(updated.post.audioAnalysis,rescored.post.audioAnalysis,'reuse the same voice analysis');
  await page.locator('#post-reference-source').selectOption('original');await page.locator('#post-rescore').click();
  await page.waitForFunction(()=>document.querySelector('#post-score').textContent.includes('錄音當時基準 YIN'));
  assert.equal((await records()).find(r=>r.id===harmonyRecord.id).postResult.pitch,original175.pitch);
  // Re-score one saved voice in all profiles without mutating the original take or audio.
  assert.equal(await page.locator('#post-difficulty').inputValue(),harmonyRecord.post.scoring.difficulty);
  const difficultyScores={};
  for(const [difficulty,label] of [['strict','嚴格'],['standard','標準'],['relaxed','寬鬆']]){
    await page.locator('#post-difficulty').selectOption(difficulty);
    await page.locator('#post-rescore').click();
    await page.waitForFunction(()=>!document.querySelector('#post-rescore').disabled);
    const row=(await records()).find(r=>r.id===harmonyRecord.id),r=row.postResult;
    const scoring={...row.post.scoring,difficulty};
    const expected=rescoreRecording({...row.post,scoring,reference:r.reference},175);
    assert.equal(r.scoring.difficulty,difficulty);assert.equal(r.score,expected.score);assert.equal(r.rhythm,expected.rhythm);
    assert.deepEqual(r.baseline,rescoreRecording({...row.post,scoring,reference:r.reference},0));
    assert.deepEqual(row.post.scoring,harmonyRecord.post.scoring);assert.equal(row.bytes,harmonyRecord.bytes);assert.equal(row.appliedDelayMs,150);
    assert.match(await page.locator('#post-score').textContent(),new RegExp(label));difficultyScores[difficulty]=r.score;
  }
  assert.ok(difficultyScores.strict<=difficultyScores.standard&&difficultyScores.standard<=difficultyScores.relaxed);
  await page.locator('#post-recording').selectOption(voice.id);
  await page.locator('#post-recording').selectOption(harmonyRecord.id);
  assert.equal(await page.locator('#post-difficulty').inputValue(),harmonyRecord.post.scoring.difficulty);
  assert.match(await page.locator('#post-score').textContent(),/寬鬆/,'saved result must retain its actual difficulty');
  const diagnosticDownload=page.waitForEvent('download');await page.locator('#post-diagnostic').click();
  const diagnostic=await diagnosticDownload,stream=await diagnostic.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const report=JSON.parse(Buffer.concat(chunks).toString());assert.equal(report.format,'karaoke-recording-diagnostic');assert.equal(report.recording.id,harmonyRecord.id);
  assert.ok(Buffer.from(report.audio.voice.base64,'base64').length>1000);assert.ok(Buffer.from(report.audio.mix.base64,'base64').length>1000);
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('診斷檔已下載'));
  await page.locator('#post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('已另存校正後錄音'));
  const remixed=(await records()).find(r=>r.parentId===harmonyRecord.id);assert.ok(remixed&&remixed.mime==='audio/wav');
  const remixedAudio=await spectrum(remixed.id);assert.ok(remixedAudio.voice>.02&&remixedAudio.backing>.02&&remixedAudio.harmony>.02,JSON.stringify(remixedAudio));
  assert.ok(await page.locator('#post-audio').isVisible());assert.ok(await page.locator('#post-rescore').isDisabled());assert.ok(await page.locator('#post-difficulty').isDisabled());
  const mp3download=page.waitForEvent('download');await page.locator('#post-mp3').click();assert.ok((await mp3download).suggestedFilename().endsWith('+175ms.mp3'));
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('MP3 已轉換'));
  await page.evaluate(id=>recordStore.delete(id),remixed.id);
  await page.locator('#post-recording').selectOption(harmonyRecord.id);
  assert.equal(await page.locator('#post-softening').inputValue(),'off');
  const sourceBeforeSoftening=(await records()).find(r=>r.id===harmonyRecord.id);
  await page.locator('#post-delay').fill('175');await page.locator('#post-softening').selectOption('light');
  await page.locator('#post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('歌聲柔化：輕度'));
  const softened=(await records()).find(r=>r.parentId===harmonyRecord.id&&r.vocalSoftening?.strength==='light');assert.ok(softened);
  assert.ok(await page.locator('#post-softening').isDisabled());
  assert.match(await page.locator('#post-recording').locator('option:checked').textContent(),/柔化輕度/);
  assert.deepEqual((await records()).find(r=>r.id===harmonyRecord.id),sourceBeforeSoftening,'softening must preserve source and its scoring data');
  const softDownload=page.waitForEvent('download');await page.locator('#post-mp3').click();assert.ok((await softDownload).suggestedFilename().endsWith('_柔化輕度+175ms.mp3'));
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('MP3 已轉換'));
  await page.evaluate(id=>recordStore.delete(id),softened.id);

  await page.locator('#post-recording').selectOption(harmonyRecord.id);
  assert.equal(await page.locator('#post-tuning').inputValue(),'off');
  await page.locator('#post-delay').fill('175');await page.locator('#post-softening').selectOption('light');await page.locator('#post-tuning').selectOption('strong');
  await page.locator('#post-remix').click();await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('電子修音：強烈'));
  const tuned=(await records()).find(r=>r.parentId===harmonyRecord.id&&r.vocalTuning?.strength==='strong');assert.ok(tuned);
  assert.equal(tuned.vocalSoftening.strength,'light');assert.equal(tuned.appliedDelayMs,175);
  assert.ok(await page.locator('#post-tuning').isDisabled());
  assert.match(await page.locator('#post-recording').locator('option:checked').textContent(),/柔化輕度_修音強烈/);
  assert.deepEqual((await records()).find(r=>r.id===harmonyRecord.id),sourceBeforeSoftening,'tuning must preserve original recording and scores');
  const tunedAudio=await spectrum(tuned.id);assert.ok(tunedAudio.voice>.02&&tunedAudio.backing>.02&&tunedAudio.harmony>.02,JSON.stringify(tunedAudio));
  const tuneDownload=page.waitForEvent('download');await page.locator('#post-mp3').click();assert.ok((await tuneDownload).suggestedFilename().endsWith('_柔化輕度_修音強烈+175ms.mp3'));
  await page.waitForFunction(()=>document.querySelector('#post-status').textContent.includes('MP3 已轉換'));
  await page.evaluate(id=>recordStore.delete(id),tuned.id);

  await page.evaluate(id=>recordStore.delete(id),harmonyRecord.id);
  assert.equal(await page.evaluate(async row=>(await recordStore.blob(row,'voice')).size,harmonyRecord),0);
  // A missing harmony file must fail before recording instead of silently omitting it.
  missingHarmony=true;const beforeMissing=await page.evaluate(()=>recorderCreated);
  await page.locator('#sing-start').click();await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('無法取得錄音所需'));
  assert.equal(await page.evaluate(()=>recorderCreated),beforeMissing);assert.equal((await records()).length,2);
  missingHarmony=false;
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
  assert.ok((await downloaded).suggestedFilename().endsWith('+150ms.wav'));
  // Reload preserves all recordings; delete only removes the selected recording.
  await page.locator('#recording-mode').selectOption('off');
  await page.reload();assert.equal(await page.locator('#recording-mode').inputValue(),'off');assert.ok(await page.locator('#recording-manual').isChecked());assert.equal(await page.locator('#recording-voice-level').inputValue(),'60');assert.equal(await page.locator('#recording-backing-level').inputValue(),'80');await page.locator('#recordings-panel summary').click();await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===16);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#recording-list').getByRole('button',{name:'刪除',exact:true}).first().click();await page.waitForFunction(()=>document.querySelectorAll('#recording-list li button').length===12);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#recording-delete-all').click();await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('已刪除 3 筆'));
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const peak=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {createRecordingMix}=await import(new URL('recording-mix.mjs',script));
    const ctx=new OfflineAudioContext(1,48000,48000),mic=ctx.createConstantSource(),backing=ctx.createConstantSource();mic.offset.value=1;backing.offset.value=1;
    const mix=createRecordingMix(ctx,mic,ctx.destination,{mode:'mix',settings:{manual:true,voice:100,backing:100},voiced:()=>true});
    backing.connect(mix.input);mic.start();backing.start();const out=await ctx.startRendering();
    return out.getChannelData(0).reduce((peak,x)=>Math.max(peak,Math.abs(x)),0);
  });assert.ok(peak<=.981&&peak>.5,peak);
  const shifts=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {remixRecording}=await import(new URL('recording-process.mjs',script));
    const context=new AudioContext(),rate=context.sampleRate,raw=context.createBuffer(1,rate,rate),samples=raw.getChannelData(0);
    for(let i=Math.floor(.4*rate);i<Math.floor(.5*rate);i++)samples[i]=.2*Math.sin(2*Math.PI*440*i/rate);
    const meta={seconds:1,mode:'voice',balance:{manual:true,voice:100,backing:0},post:{samples:[],segments:[{offset:0,songTime:0,duration:1}]}};
    const result=[];
    for(const delay of [0,100,-100,150]){const audio=await remixRecording(raw,[],meta,delay);result.push({delay,onset:audio.getChannelData(0).findIndex(x=>Math.abs(x)>.01)/rate,duration:audio.duration});}
    await context.close();return result;
  });
  assert.ok(Math.abs(shifts[0].onset-shifts[1].onset-.1)<.002,JSON.stringify(shifts));
  assert.ok(Math.abs(shifts[2].onset-shifts[0].onset-.1)<.002,JSON.stringify(shifts));
  assert.ok(shifts[2].duration>=1.1);assert.ok(Math.abs(shifts[0].onset-shifts[3].onset-.15)<.002,JSON.stringify(shifts));
  const softeningSpectrum=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {remixRecording}=await import(new URL('recording-process.mjs',script));
    const c=new AudioContext({sampleRate:48000}),rate=c.sampleRate,raw=c.createBuffer(1,rate*2,rate),back=c.createBuffer(1,rate*2,rate);
    for(let i=0;i<raw.length;i++){raw.getChannelData(0)[i]=.08*Math.sin(2*Math.PI*300*i/rate)+.08*Math.sin(2*Math.PI*6000*i/rate);back.getChannelData(0)[i]=.04*Math.sin(2*Math.PI*9000*i/rate);}
    const original=raw.getChannelData(0).slice();
    const meta={seconds:2,mode:'mix',balance:{manual:true,voice:100,backing:100},post:{segments:[{offset:0,songTime:0,duration:2}],samples:[]}};
    const power=(buffer,hz)=>{const a=buffer.getChannelData(0);let re=0,im=0;for(let i=rate;i<rate*2;i++){re+=a[i]*Math.cos(2*Math.PI*hz*i/rate);im+=a[i]*Math.sin(2*Math.PI*hz*i/rate);}return 2*Math.hypot(re,im)/rate;};
    const values=[];let off;
    for(const softening of ['off','light','medium','strong']){const rendered=await remixRecording(raw,[back],meta,0,{softening});if(softening==='off')off=rendered;values.push({softening,low:power(rendered,300),high:power(rendered,6000),backing:power(rendered,9000),duration:rendered.duration});}
    const implicit=await remixRecording(raw,[back],meta,0);
    const unchanged=original.every((v,i)=>v===raw.getChannelData(0)[i]);const offIdentical=implicit.getChannelData(0).every((v,i)=>v===off.getChannelData(0)[i]);await c.close();return{values,unchanged,offIdentical};
  });
  assert.ok(softeningSpectrum.unchanged&&softeningSpectrum.offIdentical);
  const softValues=softeningSpectrum.values;
  for(let i=1;i<softValues.length;i++){assert.ok(softValues[i].high<softValues[i-1].high*.95,JSON.stringify(softValues));assert.ok(Math.abs(softValues[i].low/softValues[0].low-1)<.03);assert.ok(Math.abs(softValues[i].backing/softValues[0].backing-1)<.01);assert.equal(softValues[i].duration,softValues[0].duration);}
  console.log('SOFTENING',JSON.stringify(softeningSpectrum));
  const tuningSpectrum=await page.evaluate(async()=>{
    const script=document.querySelector('script[src*="app."]').src;
    const {remixRecording}=await import(new URL('recording-process.mjs',script));
    const c=new AudioContext({sampleRate:48000}),rate=c.sampleRate,raw=c.createBuffer(1,rate*2,rate),back=c.createBuffer(1,rate*2,rate);
    for(let i=0;i<raw.length;i++){raw.getChannelData(0)[i]=.1*Math.sin(2*Math.PI*450*i/rate);back.getChannelData(0)[i]=.04*Math.sin(2*Math.PI*1800*i/rate);}
    const original=raw.getChannelData(0).slice(),meta={seconds:2,mode:'mix',balance:{manual:true,voice:100,backing:100},post:{segments:[{offset:0,songTime:0,duration:2}],samples:[]}};
    const amplitude=(buffer,hz)=>{let re=0,im=0;const a=buffer.getChannelData(0);for(let i=rate;i<rate*1.8;i++){re+=a[i]*Math.cos(2*Math.PI*hz*i/rate);im+=a[i]*Math.sin(2*Math.PI*hz*i/rate);}return Math.hypot(re,im)/(rate*.4);};
    const values=[];
    for(const tuning of ['off','strong']){
      const out=await remixRecording(raw,[back],meta,150,{tuning,softening:'light'});
      values.push({tuning,old:amplitude(out,450),target:amplitude(out,440),backing:amplitude(out,1800),duration:out.duration});
    }
    const unchanged=original.every((x,i)=>x===raw.getChannelData(0)[i]);await c.close();return {values,unchanged};
  });
  assert.ok(tuningSpectrum.unchanged);
  assert.ok(tuningSpectrum.values[1].target>tuningSpectrum.values[0].target*5,JSON.stringify(tuningSpectrum));
  assert.ok(tuningSpectrum.values[1].old<tuningSpectrum.values[0].old*.25,JSON.stringify(tuningSpectrum));
  assert.ok(Math.abs(tuningSpectrum.values[1].backing/tuningSpectrum.values[0].backing-1)<.03,JSON.stringify(tuningSpectrum));
  assert.equal(tuningSpectrum.values[0].duration,tuningSpectrum.values[1].duration);
  console.log('TUNING',JSON.stringify(tuningSpectrum));
  await page.setViewportSize({width:1280,height:900});await page.locator('#recording-post').screenshot({path:'test-results/recording-post.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({shifts,voiceAudio,mixedAudio,harmonyAudio,harmonyAfterSeek,harmonyRequests,balanceStatus,peak,manualAutoRatio:true,defaultAuto:true,incrementalSave:true,pauseResume:true,seekBeyondBacking:true,quotaRecovery:true,emptyRecordingAvoided:true,stopRewind:true,automaticFinish:true,restartSeparate:true,off:true,selectiveAndAllScoreDeletion:true,persistence:true,download:true,deleteOne:true,errors}));
} finally {await browser?.close();server.kill();await rm(fixture,{force:true});}
