export function youtubeId(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      id = u.pathname === '/watch' ? u.searchParams.get('v') : /^(?:\/shorts\/|\/embed\/)([^/]+)/.exec(u.pathname)?.[1];
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

export function noteOf(hz) {
  if (!(hz > 0) || !Number.isFinite(hz)) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const rounded = Math.round(midi);
  const name = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((rounded % 12) + 12) % 12];
  return { midi, name: name + (Math.floor(rounded / 12) - 1), cents: Math.round((midi - rounded) * 100) };
}

// YIN-style cumulative normalized difference. Single melodic source only.
export function detectPitch(input, sampleRate) {
  if (!input.length || !(sampleRate > 0)) return { hz: null, rms: 0, confidence: 0 };
  const stride = Math.max(1, Math.floor(sampleRate / 16000));
  const n = Math.min(2048, Math.floor(input.length / stride));
  const data = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { data[i] = input[i * stride]; mean += data[i]; }
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) { data[i] -= mean; energy += data[i] * data[i]; }
  const rms = Math.sqrt(energy / n);
  const rate = sampleRate / stride;
  const maxLag = Math.min(Math.ceil(rate / 65), Math.floor(n / 2));
  const minLag = Math.max(2, Math.floor(rate / 1000));
  if (rms < 0.006 || maxLag <= minLag) return { hz: null, rms, confidence: 0 };
  const diff = new Float32Array(maxLag + 1);
  const window = n - maxLag;
  let cumulative = 0;
  diff[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    let d = 0;
    for (let j = 0; j < window; j++) { const v = data[j] - data[j + tau]; d += v * v; }
    cumulative += d;
    diff[tau] = cumulative ? d * tau / cumulative : 1;
  }
  let tau = minLag;
  for (; tau < maxLag; tau++) {
    if (diff[tau] < 0.15) {
      while (tau + 1 <= maxLag && diff[tau + 1] < diff[tau]) tau++;
      break;
    }
  }
  if (tau >= maxLag) return { hz: null, rms, confidence: 0 };
  const denominator = 2 * (2 * diff[tau] - diff[tau - 1] - diff[tau + 1]);
  const refined = tau + (denominator ? (diff[tau + 1] - diff[tau - 1]) / denominator : 0);
  const hz = rate / refined;
  return { hz: hz >= 65 && hz <= 1000 ? hz : null, rms, confidence: Math.max(0, 1 - diff[tau]) };
}

// Read a JSON object without evaluating any code received from another site.
export function playerResponse(html) {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function alignedTime(playerSeconds, compensationMs) {
  return Math.max(0, playerSeconds - compensationMs / 1000);
}
