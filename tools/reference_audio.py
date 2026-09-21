"""Build an experimental melody/beat reference from locally separated stems."""
import json
import math
from pathlib import Path
import subprocess
import numpy as np


def pcm(path, rate=16000):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(rate),
                             '-f', 'f32le', '-'], capture_output=True, timeout=180,
                            creationflags=subprocess.CREATE_NO_WINDOW if __import__('os').name == 'nt' else 0)
    if result.returncode:
        raise ValueError('Could not decode stem for reference analysis.')
    return np.frombuffer(result.stdout, dtype='<f4').copy()


def pitch(frame, rate=16000):
    frame = frame.astype(np.float64)
    frame -= frame.mean()
    if np.sqrt(np.mean(frame * frame)) < .004:
        return None
    max_lag = math.ceil(rate / 65)
    window = len(frame) - max_lag
    # Vectorized YIN difference on an identical window for each candidate lag.
    reference = frame[:window]
    shifted = np.lib.stride_tricks.sliding_window_view(frame, window)[:max_lag + 1]
    diff = np.sum((shifted - reference) ** 2, axis=1)
    cumulative = np.cumsum(diff[1:])
    normalized = np.ones(max_lag + 1)
    normalized[1:] = diff[1:] * np.arange(1, max_lag + 1) / np.maximum(cumulative, 1e-15)
    lag = rate // 1000
    while lag < max_lag - 1:
        if normalized[lag] < .12:
            while lag + 1 < max_lag and normalized[lag + 1] < normalized[lag]:
                lag += 1
            if lag >= max_lag:
                return None
            a, b, c = normalized[lag - 1:lag + 2]
            denominator = 2 * (2 * b - a - c)
            refined = lag + ((c - a) / denominator if denominator else 0)
            hz = rate / refined
            return round(float(hz), 2) if 65 <= hz <= 1000 else None
        lag += 1
    return None


def beat_grid(audio, rate=16000):
    hop, window = 320, 1024
    if len(audio) < rate * 5:
        return None, []
    previous = None
    flux = []
    for start in range(0, len(audio) - window, hop):
        spectrum = np.abs(np.fft.rfft(audio[start:start + window] * np.hanning(window)))
        flux.append(0 if previous is None else float(np.maximum(spectrum - previous, 0).sum()))
        previous = spectrum
    envelope = np.array(flux)
    envelope = np.maximum(envelope - np.median(envelope), 0)
    if not envelope.size or envelope.max() < 1e-5:
        return None, []
    best_lag, best = None, 0
    for lag in range(round(60 / 180 / .02), round(60 / 60 / .02) + 1):
        if lag >= len(envelope):
            continue
        a, b = envelope[:-lag], envelope[lag:]
        similarity = float(np.dot(a, b) / max(1e-10, np.linalg.norm(a) * np.linalg.norm(b)))
        if similarity > best:
            best, best_lag = similarity, lag
    if best_lag is None or best < .15:
        return None, []
    phase = max(range(best_lag), key=lambda n: float(envelope[n::best_lag].mean()))
    beats = [round((n * hop + window / 2) / rate, 3) for n in range(phase, len(envelope), best_lag)]
    return round(60 / (best_lag * .02), 1), beats


def build_reference(vocals, accompaniment, video_id, title, output):
    audio = pcm(vocals)
    step, window = .1, 2048
    pad = np.pad(audio, (window // 2, window // 2))
    frames = [pitch(pad[start:start + window]) for start in range(0, len(audio), 1600)]
    # Reject isolated detections; keep only stable runs of at least 200 ms.
    for i, value in enumerate(frames.copy()):
        if value is None:
            continue
        neighbors = [f for f in frames[max(0, i - 1):i + 2] if f is not None]
        if len(neighbors) < 2:
            frames[i] = None
        elif len(neighbors) == 3:
            frames[i] = round(float(np.median(neighbors)), 2)
    voiced = sum(f is not None for f in frames) * step
    if voiced < 3:
        raise ValueError('辨識到的主旋律不足 3 秒；請換一首有清楚主唱的歌曲。')
    bpm, beats = beat_grid(pcm(accompaniment))
    reference = {'version': 1, 'videoId': video_id, 'title': title[:300], 'step': step, 'frames': frames,
                 'duration': round(len(audio) / 16000, 3), 'bpm': bpm, 'beats': beats,
                 'quality': 'experimental-separated-vocals', 'voicedSeconds': round(voiced, 1)}
    Path(output).write_text(json.dumps(reference, ensure_ascii=False), encoding='utf-8')
    return {'title': reference['title'], 'duration': reference['duration'], 'voicedSeconds': reference['voicedSeconds'], 'bpm': bpm}
