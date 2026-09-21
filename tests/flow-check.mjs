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
      cueVideoById() { this.time = 0; this.state = 5; }
      getCurrentTime() { return this.time + (this.state === 1 ? (performance.now() - this.started) / 1000 : 0); }
      getPlayerState() { return this.state; }
      seekTo(t) { this.lastSeek = t; setTimeout(() => { this.time = t; this.started = performance.now(); }, this.seekDelay || 0); }
      playVideo() { this.lastPlayPosition = this.time; this.started = performance.now(); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { this.time = this.getCurrentTime(); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
      endVideo() { this.time = this.getCurrentTime(); this.state = 0; this.options.events.onStateChange({ data: 0 }); }
      buffer() { this.time = this.getCurrentTime(); this.state = 3; this.options.events.onStateChange({ data: 3 }); }
    }};
  });
  const page = await context.newPage(), errors = [], deleted = [];
  page.on('pageerror', error => errors.push(error.message));
  let serial = 0, createDelay = 0, libraryConfigured = false, releasePicker, pickerPending = false;
  await page.route('http://127.0.0.1:4174/**', async route => {
    const request = route.request(), url = new URL(request.url());
    let value = {};
    if (url.pathname === '/session') value = { token: 'fixture-token', features: ['library', 'library-location'] };
    else if (url.pathname === '/library/location/pick') { pickerPending = true; await new Promise(resolve => { releasePicker = resolve; }); pickerPending = false; value = { configured: libraryConfigured, cancelled: true, suggestedPath: 'C:/test-library' }; }
    else if (url.pathname === '/library/location/cancel') { releasePicker?.(); value = { cancelled: true }; }
    else if (url.pathname === '/library/location') { if (request.method() === 'POST') { assert.equal(request.postDataJSON().path, 'C:/test-library'); libraryConfigured = true; } value = { configured: libraryConfigured, path: libraryConfigured ? 'C:/test-library' : '', suggestedPath: 'C:/test-library' }; }
    else if (url.pathname === '/library') value = { songs: [] };
    else if (request.method() === 'DELETE') { deleted.push(url.pathname); value = { cleared: true }; }
    else if (request.method() === 'POST') { await new Promise(r => setTimeout(r, createDelay)); value = { id: String(++serial).padStart(32, '0') }; }
    else if (url.pathname.endsWith('/reference')) value = { version: 1, videoId: 'M7lc1UVf-VE', title: 'Synthetic octave fixture', step: .1, duration: 4, frames: Array(40).fill(880), beats: [0, .5, 1, 1.5, 2, 2.5, 3, 3.5], bpm: 120 };
    else value = { stage: 'ready', ready: true, message: 'fixture ready' };
    await route.fulfill({ json: value, headers: { 'Access-Control-Allow-Origin': 'http://localhost:4173' } });
  });
  await page.goto('http://localhost:4173/');
  assert.ok(await page.locator('#sing-start').isDisabled());
  await page.evaluate(() => window.dispatchEvent(new Event('local-tools-ready')));
  await page.waitForFunction(() => document.querySelector('#prepare-song').disabled);
  await page.locator('#library-choose').click();
  await page.waitForFunction(() => !document.querySelector('#library-cancel-pick').hidden);
  await page.locator('#library-cancel-pick').click();
  await page.waitForFunction(() => document.querySelector('#library-location-status').textContent.includes('已取消'));
  await page.waitForFunction(() => !document.querySelector('#library-choose').disabled);
  assert.equal(pickerPending, false, 'cancel must release the folder-selection request');
  assert.ok(await page.locator('#cancel-song').isDisabled(), 'folder cancellation must not require an active song');
  assert.ok(await page.locator('#prepare-song').isDisabled());
  await page.locator('#library-path').fill('C:/test-library');
  await page.locator('#library-use-path').click();
  await page.waitForFunction(() => !document.querySelector('#prepare-song').disabled);
  assert.match(await page.locator('#library-location-status').innerText(), /C:\/test-library/);
  await page.locator('#url').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await page.locator('#prepare-song').click();
  await page.waitForFunction(() => document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  assert.ok(await page.locator('#library-choose').isDisabled(), 'active song locks library location');
  assert.ok(await page.locator('#sing-start').isEnabled(), 'start can request microphone permission when reference is ready');
  await page.locator('#mic-start').click();
  await page.waitForFunction(() => document.querySelector('#note').textContent === 'A4');
  // Native player play starts scoring too, not only the page's start button.
  await page.evaluate(() => window.fixturePlayer.playVideo());
  await page.waitForFunction(() => document.querySelector('#live-feedback').textContent.includes('音準吻合'));
  assert.ok(await page.locator('#pitch-mode').isDisabled());
  await page.evaluate(() => window.fixturePlayer.pauseVideo());
  assert.match(await page.locator('#score-status').innerText(), /暫停/);
  const before = await page.locator('#coverage-score').innerText();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#coverage-score').innerText(), before);
  await page.evaluate(() => window.fixturePlayer.playVideo());
  await page.waitForTimeout(250);
  await page.evaluate(() => window.fixturePlayer.buffer());
  assert.match(await page.locator('#score-status').innerText(), /緩衝/);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.fixturePlayer.playVideo());
  await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('分析範圍結尾'), null, { timeout: 10000 });
  assert.ok(await page.locator('#finish-song').isEnabled(), 'reference end keeps settlement available');
  assert.equal(await page.evaluate(() => window.fixturePlayer.getPlayerState()), 1, 'reference ending must not stop the still-playing video');
  await page.evaluate(() => window.fixturePlayer.endVideo());
  await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('已結算'), null, { timeout: 10000 });
  const octaveScore = Number(await page.locator('#total-score').innerText());
  assert.ok(octaveScore >= 90, `allowed octave should score highly: ${octaveScore}`);
  assert.equal(deleted.length, 1); assert.ok(await page.locator('#sing-start').isDisabled());
  assert.ok(await page.locator('#mic-stop').isDisabled());
  let rows = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')));
  assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0]).sort(), ['score', 'title']);
  // Strict original pitch must penalize the same octave difference.
  await page.locator('#prepare-song').click();
  await page.waitForFunction(() => document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  await page.locator('#pitch-mode').selectOption('strict');
  await page.locator('#mic-start').click();
  await page.waitForFunction(() => document.querySelector('#note').textContent === 'A4');
  await page.evaluate(() => { const p = window.fixturePlayer; p.time = 2; p.state = 2; p.seekDelay = 400; });
  await page.locator('#sing-start').click();
  assert.match(await page.locator('#score-status').innerText(), /正在同步/);
  assert.ok(await page.locator('#finish-song').isDisabled());
  await page.waitForFunction(() => window.fixturePlayer.getPlayerState() === 1 && window.fixturePlayer.getCurrentTime() < 1);
  assert.equal(await page.evaluate(() => window.fixturePlayer.lastSeek), 0);
  assert.equal(await page.evaluate(() => window.fixturePlayer.lastPlayPosition), 0);
  await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('分析範圍結尾'), null, { timeout: 10000 });
  assert.ok(await page.locator('#finish-song').isEnabled(), 'reference end keeps settlement available');
  assert.equal(await page.evaluate(() => window.fixturePlayer.getPlayerState()), 1, 'reference ending must not stop the still-playing video');
  await page.evaluate(() => window.fixturePlayer.endVideo());
  await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('已結算'), null, { timeout: 10000 });
  const strictScore = Number(await page.locator('#total-score').innerText());
  assert.ok(strictScore <= 15); assert.equal(deleted.length, 2);
  // Cancel before POST completes: the late-created job must also be removed.
  createDelay = 700;
  const posting = page.waitForRequest(r => r.method() === 'POST');
  await page.locator('#prepare-song').click(); await posting;
  await page.locator('#cancel-song').click();
  await page.waitForTimeout(1000);
  assert.equal(deleted.length, 3); assert.ok(await page.locator('#sing-start').isDisabled());
  rows = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')));
  assert.equal(rows.length, 2, 'cancelled job must not add history');
  // Stopping capture preserves the take and keeps settlement enabled until the user clicks it.
  createDelay = 0;
  await page.locator('#prepare-song').click();
  await page.waitForFunction(() => document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  await page.locator('#pitch-mode').selectOption('octave');
  await page.evaluate(() => window.fixturePlayer.playVideo());
  assert.ok(await page.locator('#finish-song').isDisabled());
  await page.locator('#mic-start').click();
  await page.waitForFunction(() => document.querySelector('#note').textContent === 'A4');
  assert.ok(await page.locator('#finish-song').isEnabled(), 'playing before microphone permission must still start scoring');
  await page.waitForFunction(() => Number(document.querySelector('#coverage-score').textContent) >= 40);
  assert.equal(await page.evaluate(() => window.fixturePlayer.getPlayerState()), 1);
  assert.equal(await page.locator('#mic-stop').innerText(), '停止收音');
  await page.locator('#mic-stop').click();
  await page.waitForFunction(() => document.querySelector('#mic-stop').disabled);
  assert.ok(await page.locator('#finish-song').isEnabled(), 'stopping microphone must not disable settlement');
  assert.equal(await page.evaluate(() => window.fixturePlayer.getPlayerState()), 2);
  await page.waitForFunction(() => window.fixturePlayer.getCurrentTime() <= .05);
  await page.evaluate(() => window.fixturePlayer.options.events.onStateChange({ data: 0 }));
  assert.ok(await page.locator('#finish-song').isEnabled(), 'a late ended event after stopping must not settle the preserved take');
  assert.ok(await page.locator('#sing-start').isEnabled(), 'stop must allow starting over');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')).length), 2, 'stopping must not silently settle');
  await page.locator('#finish-song').click();
  await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('已結算'));
  const partialScore = Number(await page.locator('#total-score').innerText());
  assert.ok(partialScore > 0 && partialScore < 100);
  assert.ok(await page.locator('#mic-stop').isDisabled());
  assert.ok(await page.locator('#finish-song').isDisabled(), 'a settled take cannot be submitted twice');
  rows = await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')));
  assert.equal(rows.length, 3); assert.equal(deleted.length, 4);
  // Trying the microphone without a running take must not manufacture a score.
  await page.locator('#mic-start').click();
  await page.waitForFunction(() => document.querySelector('#note').textContent === 'A4');
  await page.locator('#mic-stop').click();
  await page.waitForFunction(() => document.querySelector('#mic-stop').disabled);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')).length), 3);
  // Restart while already playing must rewind and discard observations before resuming.
  // Stop -> rewind -> start again must acquire the microphone and discard the old take.
  await page.locator('#prepare-song').click();
  await page.waitForFunction(() => document.querySelector('#prepare-status').textContent.startsWith('已就緒'));
  await page.locator('#sing-start').click();
  await page.waitForFunction(() => Number(document.querySelector('#coverage-score').textContent) >= 40);
  assert.equal(await page.evaluate(() => window.fixturePlayer.getPlayerState()), 1);
  await page.locator('#sing-start').click();
  await page.waitForFunction(() => window.fixturePlayer.getPlayerState() === 1 && window.fixturePlayer.getCurrentTime() < .5);
  await page.waitForFunction(() => Number(document.querySelector('#coverage-score').textContent) < 20); // New take, first sample.
  assert.ok(Number(await page.locator('#coverage-score').innerText()) < 20, 'restarting during playback must reset the score');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')).length), 3, 'restart does not settle the discarded take');
  await page.waitForFunction(() => Number(document.querySelector('#coverage-score').textContent) >= 40);
  await page.locator('#mic-stop').click();
  await page.waitForFunction(() => document.querySelector('#mic-stop').disabled && window.fixturePlayer.getCurrentTime() <= .05);
  assert.equal(await page.evaluate(() => window.fixturePlayer.getPlayerState()), 2);
  assert.ok(await page.locator('#sing-start').isEnabled());
  assert.ok(await page.locator('#finish-song').isEnabled());
  await page.locator('#sing-start').click();
  await page.waitForFunction(() => window.fixturePlayer.getPlayerState() === 1 && window.fixturePlayer.getCurrentTime() < .5);
  assert.match(await page.locator('#mic-badge').innerText(), /收音中/);
  await page.waitForTimeout(150);
  await page.locator('#mic-stop').click();
  await page.waitForFunction(() => document.querySelector('#mic-stop').disabled);
  assert.ok(await page.locator('#finish-song').isEnabled());
  await page.locator('#finish-song').click();
  await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('已結算'));
  assert.ok(Number(await page.locator('#coverage-score').innerText()) < 20, 'old observations must not survive restart');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('karaoke.scores.v1')).length), 4);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ firstRunLibrarySetup: 'passed', fullPlaybackSettlement: 'passed', restartWhilePlayingClearsTake: 'passed', pauses: 'passed', buffering: 'passed', cancellation: 'passed', stopThenManualSettlement: 'passed', delayedSeekSync: 'passed', stopRewindsAndRestartEnabled: 'passed', localHistory: 'title+score only', errors }));
} finally { await browser?.close(); server.kill(); await rm(fixture, { force: true }); }
