import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, detectPitch, noteOf, playerResponse, alignedTime } from '../audio.mjs';
test('YouTube formats and hostile host rejection', () => {
  for (const url of ['https://youtu.be/M7lc1UVf-VE?t=12', 'https://www.youtube.com/watch?v=M7lc1UVf-VE&list=123', 'https://m.youtube.com/shorts/M7lc1UVf-VE']) assert.equal(youtubeId(url), 'M7lc1UVf-VE');
  for (const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'javascript:alert(1)', 'https://example.com/M7lc1UVf-VE', 'https://youtu.be/nope']) assert.equal(youtubeId(url), null);
});
test('pitch accuracy across sample rates, range and harmonics', () => {
  for (const rate of [44100, 48000]) for (const hz of [82.41, 110, 196, 261.63, 440, 783.99]) {
    const signal = Float32Array.from({ length: 4096 }, (_, i) => .18 * Math.sin(2 * Math.PI * hz * i / rate) + .08 * Math.sin(4 * Math.PI * hz * i / rate) + .03);
    const result = detectPitch(signal, rate);
    assert.ok(result.hz, `no pitch: ${hz}`);
    assert.ok(Math.abs(1200 * Math.log2(result.hz / hz)) < 12, `${hz}: got ${result.hz}`);
  }
});
test('silence, DC, quiet input and noise are not notes', () => {
  let seed = 42;
  const noise = Float32Array.from({ length: 4096 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 2 ** 32 - .5) * .4; });
  for (const signal of [new Float32Array(4096), new Float32Array(4096).fill(.2), Float32Array.from({ length: 4096 }, (_, i) => .001 * Math.sin(i)), noise]) assert.equal(detectPitch(signal, 48000).hz, null);
});
test('note naming and compensation sign', () => {
  assert.equal(noteOf(440).name, 'A4'); assert.equal(noteOf(440).cents, 0); assert.equal(noteOf(null), null);
  assert.equal(alignedTime(35.2, 200), 35); assert.equal(alignedTime(.1, 200), 0); assert.equal(alignedTime(1, -200), 1.2);
});
test('external metadata is parsed as JSON, not code', () => {
  assert.deepEqual(playerResponse('var ytInitialPlayerResponse = {"title":"brace }", "nested":{"ok":true}}; throw Error();'), { title: 'brace }', nested: { ok: true } });
  assert.equal(playerResponse('ytInitialPlayerResponse = {invalid}'), null); assert.equal(playerResponse('consent page'), null);
});
