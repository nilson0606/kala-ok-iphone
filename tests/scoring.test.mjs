import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoringTake, validateReference, savedResult } from '../scoring.mjs';
const reference = () => ({ version: 1, videoId: 'M7lc1UVf-VE', title: 'Test', step: .1, frames: Array(100).fill(440) });
test('complete accurate take scores 100; no singing scores zero', () => {
  const take = new ScoringTake(reference());
  assert.equal(take.result().score, 0);
  for (let i = 0; i < 100; i++) take.sample(i * .1 + .01, 440);
  assert.deepEqual(take.result(), { score: 100, pitch: 100, coverage: 100, referenceSeconds: 10, sampledSeconds: 10 });
});
test('one correct note and repeated frames cannot inflate score', () => {
  const take = new ScoringTake(reference());
  for (let i = 0; i < 1000; i++) take.sample(.01, 440);
  assert.equal(take.result().score, 1);
  take.sample(-1, 440); take.sample(999, 440); take.sample(NaN, 440);
  assert.equal(take.result().score, 1);
});
test('octave errors lose pitch points, silence and rests are distinct', () => {
  const ref = reference(); ref.frames[0] = null;
  const take = new ScoringTake(ref);
  for (let i = 0; i < 100; i++) take.sample(i * .1 + .01, 880);
  assert.equal(take.result().pitch, 0); assert.equal(take.result().coverage, 100);
  assert.equal(take.result().score, 30);
  for (let i = 0; i < 100; i++) take.sample(i * .1 + .01, null);
  assert.equal(take.result().score, 0);
});
test('reject corrupted or empty reference, keep only title and score in history', () => {
  assert.throws(() => validateReference({ ...reference(), frames: Array(100).fill(null) }));
  assert.throws(() => validateReference({ ...reference(), frames: [Infinity] }));
  assert.throws(() => validateReference({ ...reference(), step: -1 }));
  assert.deepEqual(savedResult('Song', 87.2), { title: 'Song', score: 87 });
});
