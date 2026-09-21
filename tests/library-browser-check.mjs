// Requires the optional local-pipeline-check sample to have been prepared once.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { LocalLibrary, cacheKey } from '../local-library.mjs';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const library = new LocalLibrary(path.resolve('.runtime/library'));
const fixture = { version: 1, videoId: 'TESTCACHE01', title: '自動測試刪除項目', step: .1, frames: Array(100).fill(440), duration: 10, rangeSeconds: 15 };
const fixtureId = cacheKey(fixture.videoId, 15);
await library.save(fixtureId, fixture, '', false);
const server = spawn(process.execPath, ['server.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.stderr.once('data', x => reject(new Error(x.toString()))); });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:4173/');
  await page.locator('#library-panel summary').click();
  await page.locator('#library-refresh').click();
  const sample = page.locator('#library-list li').filter({ hasText: 'Twinkle Twinkle Little Star' });
  await page.locator('#offset').fill('270');
  await sample.getByRole('button', { name: '載入', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#prepare-status').textContent.includes('直接載入本機基準'));
  assert.equal(await page.locator('#offset').inputValue(), '270', 'song loading must keep calibration');
  await page.locator('#preview-panel summary').click();
  for (const stem of ['vocals', 'accompaniment']) {
    await page.locator('#preview-' + stem).click();
    await page.waitForFunction(() => {
      const audio = document.querySelector('#stem-audio'); return audio.duration > 29 && audio.currentTime > .1 && !audio.paused;
    });
    console.log('Decoded and played local preview:', stem);
  }
  await page.screenshot({ path: 'test-results/library-preview.png', fullPage: true });
  await page.locator('#cancel-song').click();
  assert.equal(await page.locator('#stem-audio').getAttribute('src'), null);
  const row = page.locator('#library-list li').filter({ hasText: fixture.title });
  await row.getByRole('button', { name: '刪除', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#library-list').textContent.includes('自動測試刪除項目'));
  assert.equal(await library.get(fixtureId), null);
  assert.ok(await library.get('yCjJyiqpAuU_30_v1'));
  assert.deepEqual(errors, []);
  console.log('Cached library loading, both audio previews, unloading and targeted deletion passed.');
} finally { await browser?.close(); server.kill(); await library.delete(fixtureId); }
