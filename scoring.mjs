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

export function pitchCredit(actual, expected) {
  if (!Number.isFinite(actual) || actual < 65 || actual > 1000) return 0;
  const cents = Math.abs(1200 * Math.log2(actual / expected));
  // Full credit inside 25 cents; linearly falls to zero at 200 cents.
  return Math.max(0, Math.min(1, 1 - (cents - 25) / 175));
}

export class ScoringTake {
  constructor(reference) {
    this.reference = validateReference(reference);
    this.observations = new Map();
  }
  sample(time, hz) {
    if (!Number.isFinite(time) || time < 0) return;
    const index = Math.floor(time / this.reference.step);
    if (index >= this.reference.frames.length || this.reference.frames[index] === null) return;
    // One observation per time cell: faster sampling or replaying cannot add points.
    this.observations.set(index, Number.isFinite(hz) && hz >= 65 && hz <= 1000 ? hz : null);
  }
  result() {
    let expected = 0, voiced = 0, points = 0;
    for (let i = 0; i < this.reference.frames.length; i++) {
      const target = this.reference.frames[i];
      if (target === null) continue;
      expected++;
      const actual = this.observations.get(i);
      if (actual !== null && actual !== undefined) { voiced++; points += pitchCredit(actual, target); }
    }
    // Missing notes always stay in the denominator, including an unfinished song.
    return {
      score: Math.round(100 * (.7 * points + .3 * voiced) / expected),
      pitch: Math.round(100 * points / expected),
      coverage: Math.round(100 * voiced / expected),
      referenceSeconds: Math.round(expected * this.reference.step * 10) / 10,
      sampledSeconds: Math.round(this.observations.size * this.reference.step * 10) / 10,
    };
  }
  clear() { this.observations.clear(); this.reference.frames = []; }
}

export function savedResult(title, score) {
  if (typeof title !== 'string' || !title.trim() || title.length > 300 || !Number.isFinite(score) || score < 0 || score > 100) throw new Error('演唱紀錄無效。');
  return { title: title.trim(), score: Math.round(score) };
}
