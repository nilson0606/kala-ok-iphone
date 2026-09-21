import test from 'node:test';
import assert from 'node:assert/strict';
import { FiveNoteMeasurement, FIVE_NOTES } from '../calibration.mjs';

function measure(delays, octave = 0) {
  const m = new FiveNoteMeasurement(2);
  for (let i = 0; i < 5; i++) {
    if (delays[i] === null) continue;
    const t = 2 + i * 1.2 + delays[i];
    m.sample(t, FIVE_NOTES[i] * 2 ** octave); m.sample(t + .065, FIVE_NOTES[i] * 2 ** octave);
  }
  return m.result();
}
test('five notes estimate a known delay and accept a lower octave', () => {
  for (const octave of [0, -1]) {
    const result = measure([.21, .22, .20, .21, .23], octave);
    assert.equal(result.ok, true); assert.equal(result.ms, 210); assert.equal(result.count, 5);
  }
});
test('missing or inconsistent notes do not yield an applicable compensation', () => {
  assert.equal(measure([.2, null, null, .2, .2]).ok, false);
  assert.equal(measure([.1, .2, .6, .2, .15]).ok, false);
  const m = new FiveNoteMeasurement(1);
  for (let t = 0; t < 8; t += .065) m.sample(t, null);
  assert.equal(m.result().ok, false);
});
