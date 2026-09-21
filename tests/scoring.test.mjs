import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoringTake, validateReference, savedResult } from '../scoring.mjs';
const reference = () => ({ version: 1, videoId: 'M7lc1UVf-VE', title: 'Test', step: .1, frames: Array(100).fill(440) });
test('complete accurate take scores 100; no singing scores zero', () => {
  const take = new ScoringTake(reference());
  assert.equal(take.result().score, 0);
  for (let i = 0; i < 100; i++) take.sample(i * .1 + .01, 440);
  assert.deepEqual(take.result(), { score: 100, pitch: 100, rhythm: 100, coverage: 100, referenceSeconds: 10, sampledSeconds: 10 });
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
  assert.equal(take.result().score, 15);
  for (let i = 0; i < 100; i++) take.sample(i * .1 + .01, null);
  assert.equal(take.result().score, 0);
});
test('reject corrupted or empty reference, keep only title and score in history', () => {
  assert.throws(() => validateReference({ ...reference(), frames: Array(100).fill(null) }));
  assert.throws(() => validateReference({ ...reference(), frames: [Infinity] }));
  assert.throws(() => validateReference({ ...reference(), step: -1 }));
  assert.deepEqual(savedResult('Song', 87.2), { title: 'Song', score: 87 });
});


test('optional octave tolerance accepts both octaves but rejects another scale note', () => {
  for (const hz of [220, 440, 880]) {
    const take = new ScoringTake(reference(), { allowOctave: true });
    for (let i = 0; i < 100; i++) take.sample(i * .1 + .01, hz);
    assert.equal(take.result().score, 100);
  }
  const wrong = new ScoringTake(reference(), { allowOctave: true });
  for (let i = 0; i < 100; i++) wrong.sample(i * .1 + .01, 261.6256);
  assert.equal(wrong.result().pitch, 0);
});

test('late melody loses rhythm credit; measured compensation restores it', () => {
  const ref = reference(); ref.frames = Array.from({ length: 100 }, (_, i) => i % 20 < 5 ? null : [440, 523.251, 659.255, 493.883, 587.33][Math.floor(i / 20)]);
  const correct = new ScoringTake(ref), late = new ScoringTake(ref), compensated = new ScoringTake(ref);
  for (let i = 0; i < 100; i++) {
    correct.sample(i * .1 + .01, ref.frames[i]);
    late.sample(i * .1 + .31, ref.frames[i]);
    compensated.sample((i * .1 + .31) - .3, ref.frames[i]);
  }
  assert.equal(correct.result().score, 100);
  assert.ok(late.result().rhythm < 50);
  assert.ok(late.result().score < correct.result().score);
  assert.equal(compensated.result().score, 100);
});


test('performed range excludes the unplayed tail while full-song mode still counts it', () => {
  const full = new ScoringTake(reference()), performed = new ScoringTake(reference(), { rangeMode: 'performed' });
  performed.begin(0);
  for (let i = 0; i < 50; i++) { full.sample(i * .1 + .01, 440); performed.sample(i * .1 + .01, 440); }
  performed.advance(5);
  assert.equal(performed.result().score, 100);
  assert.equal(performed.result().referenceSeconds, 5);
  assert.equal(full.result().coverage, 50);
  assert.ok(full.result().score < performed.result().score);
});

test('performed range counts silence and skipped notes inside its playback boundaries', () => {
  const take = new ScoringTake(reference(), { rangeMode: 'performed' });
  take.begin(2);
  for (let i = 20; i < 40; i++) take.sample(i * .1 + .01, 440);
  take.advance(6); // Missing two seconds still count even though no pitch was detected.
  assert.equal(take.result().referenceSeconds, 4);
  assert.equal(take.result().coverage, 50);
  assert.equal(take.result().pitch, 50);
  take.advance(3); // Rewinding must not erase the already reached end.
  assert.equal(take.result().referenceSeconds, 4);
});

test('an intro-only take has no score; clearing a take does not erase the reusable reference', () => {
  const ref = reference(); ref.frames.fill(null, 0, 20);
  const take = new ScoringTake(ref, { rangeMode: 'performed' });
  take.begin(0); take.advance(1);
  assert.equal(take.result().score, null);
  take.clear();
  assert.equal(ref.frames.length, 100);
  const next = new ScoringTake(ref, { rangeMode: 'performed' });
  next.begin(2);
  for (let i = 20; i < 40; i++) next.sample(i * .1 + .01, 440);
  assert.equal(next.result().score, 100);
});
