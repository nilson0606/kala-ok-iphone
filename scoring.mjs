// Experimental single-melody scoring. Raw audio never enters this module.
export function validateReference(value) {
  if (!value || value.version !== 1 || typeof value.videoId !== 'string' || !/^[\w-]{11}$/.test(value.videoId)) throw new Error('歌曲基準缺少有效影片 ID。');
  if (typeof value.title !== 'string' || value.title.length > 300) throw new Error('歌曲名稱無效。');
  if (!Number.isFinite(value.step) || value.step < .02 || value.step > .2) throw new Error('基準時間間隔必須介於 20–200 ms。');
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > 90000) throw new Error('基準長度無效。');
  let voiced = 0;
  for (const hz of value.frames) {
    if (hz === null) continue;
    if (!Number.isFinite(hz) || hz < 65 || hz > 1000) throw new Error('基準音高超出 65–1000 Hz。');
    voiced++;
  }
  if (voiced * value.step < 3) throw new Error('至少需要 3 秒可辨識的參考旋律。');
  return { version: 1, videoId: value.videoId, title: value.title, step: value.step, frames: [...value.frames] };
}

export function pitchDifference(actual, expected, allowOctave = false) {
  const cents = 1200 * Math.log2(actual / expected);
  return allowOctave ? cents - Math.round(cents / 1200) * 1200 : cents;
}

export function pitchCredit(actual, expected, allowOctave = false) {
  if (!Number.isFinite(actual) || actual < 65 || actual > 1000) return 0;
  const cents = Math.abs(pitchDifference(actual, expected, allowOctave));
  // Full credit inside 25 cents; linearly falls to zero at 200 cents.
  return Math.max(0, Math.min(1, 1 - (cents - 25) / 175));
}

function onsets(frames, step) {
  const notes = []; let last = null, silence = 2;
  for (let i = 0; i < frames.length - 1; i++) {
    const hz = frames[i], next = frames[i + 1];
    if (hz == null) { silence++; continue; }
    const midi = 69 + 12 * Math.log2(hz / 440);
    if (next != null && Math.abs(12 * Math.log2(next / hz)) < .75 && (last === null || silence >= 2 || Math.abs(midi - last) >= .75)) {
      notes.push({ time: i * step, hz }); last = midi;
    }
    silence = 0;
  }
  return notes;
}
function rhythmCredit(reference, actual, step, allowOctave) {
  const expected = onsets(reference, step), sung = onsets(actual, step), used = new Set();
  if (!expected.length) return 0;
  let total = 0;
  for (const note of expected) {
    let chosen = -1, error = .351;
    for (let i = 0; i < sung.length; i++) {
      const delta = Math.abs(note.time - sung[i].time);
      if (!used.has(i) && delta < error && Math.abs(pitchDifference(note.hz, sung[i].hz, allowOctave)) <= 100) { chosen = i; error = delta; }
    }
    if (chosen >= 0) { used.add(chosen); total += Math.max(0, Math.min(1, 1 - (error - .08) / .27)); }
  }
  return total / expected.length;
}

export class ScoringTake {
  constructor(reference, { allowOctave = false } = {}) {
    this.allowOctave = allowOctave;
    this.reference = validateReference(reference);
    this.observations = new Map();
  }
  sample(time, hz) {
    if (!Number.isFinite(time) || time < 0) return;
    const index = Math.floor(time / this.reference.step);
    if (index >= this.reference.frames.length) return;
    // One observation per time cell: faster sampling or replaying cannot add points.
    this.observations.set(index, Number.isFinite(hz) && hz >= 65 && hz <= 1000 ? hz : null);
  }
  result(includeRhythm = true) {
    let expected = 0, voiced = 0, points = 0;
    for (let i = 0; i < this.reference.frames.length; i++) {
      const target = this.reference.frames[i];
      if (target === null) continue;
      expected++;
      const actual = this.observations.get(i);
      if (actual !== null && actual !== undefined) { voiced++; points += pitchCredit(actual, target, this.allowOctave); }
    }
    if (!expected) return { score: null, pitch: 0, rhythm: 0, coverage: 0, referenceSeconds: 0, sampledSeconds: 0 };
    const actual = this.reference.frames.map((_, i) => this.observations.get(i) ?? null);
    const rhythm = includeRhythm ? rhythmCredit(this.reference.frames, actual, this.reference.step, this.allowOctave) : 0;
    // Missing notes always stay in the denominator, including an unfinished song.
    return {
      score: Math.round(100 * (.6 * points / expected + .25 * rhythm + .15 * voiced / expected)),
      rhythm: Math.round(100 * rhythm),
      pitch: Math.round(100 * points / expected),
      coverage: Math.round(100 * voiced / expected),
      referenceSeconds: Math.round(expected * this.reference.step * 10) / 10,
      sampledSeconds: Math.round([...this.observations.keys()].filter(i => this.reference.frames[i] !== null).length * this.reference.step * 10) / 10,
    };
  }
  clear() { this.observations.clear(); this.reference.frames = []; }
}

export function savedResult(title, score) {
  if (typeof title !== 'string' || !title.trim() || title.length > 300 || !Number.isFinite(score) || score < 0 || score > 100) throw new Error('演唱紀錄無效。');
  return { title: title.trim(), score: Math.round(score) };
}
