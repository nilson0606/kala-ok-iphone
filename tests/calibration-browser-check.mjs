// Synthetic loopback through a real Web Audio DelayNode; no physical microphone measurement.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const server = spawn(process.execPath, ['server.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.stderr.once('data', x => reject(new Error(x.toString()))); });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      createMediaStreamSource() { this.testMicrophone = this.createGain(); return this.testMicrophone; }
      createOscillator() {
        const oscillator = super.createOscillator();
        if (this.testMicrophone) {
          const delay = this.createDelay(); delay.delayTime.value = .2;
          oscillator.connect(delay); delay.connect(this.testMicrophone);
        }
        return oscillator;
      }
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:4173/');
  await page.locator('#calibration-panel summary').click();
  await page.locator('#cal-start').click();
  assert.match(await page.locator('#cal-status').innerText(), /先開啟麥克風/);
  await page.locator('#mic-start').click();
  await page.waitForFunction(() => document.querySelector('#mic-badge').textContent.includes('收音中'));
  await page.locator('#cal-mode').selectOption('loopback');
  await page.locator('#cal-start').click();
  await page.waitForFunction(() => !document.querySelector('#cal-start').disabled, null, { timeout: 12000 });
  const result = await page.locator('#cal-status').innerText();
  console.log('Synthetic 200 ms loopback:', result);
  assert.match(result, /辨識 5\/5 音/);
  const ms = Number(result.match(/補償 ([+-]?\d+) ms/)[1]);
  assert.ok(ms >= 150 && ms <= 300, `unexpected calibration: ${ms}`);
  assert.equal(await page.locator('#offset').inputValue(), '0', 'measurement must not apply itself');
  await page.locator('#cal-apply').click();
  assert.equal(Number(await page.locator('#offset').inputValue()), ms);
  await page.locator('#cal-start').click(); await page.locator('#cal-stop').click();
  assert.ok(await page.locator('#cal-apply').isDisabled());
  assert.equal(Number(await page.locator('#offset').inputValue()), ms);
  await page.locator('#mic-stop').click();
  assert.deepEqual(errors, []);
  console.log('Five-note UI, explicit apply, cancellation passed.');
} finally { await browser?.close(); server.kill(); }
