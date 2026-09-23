"""Two-pass accompaniment separation followed by sample-aligned M - I2.

Intermediate stems are float WAV, without per-stem normalization or MP3 encoding.
Both passes use the selected separator. Never silently pad/trim a mismatched stem.
"""
from pathlib import Path
import numpy as np
import soundfile as sf


def matching_audio(*paths):
    infos = [sf.info(str(path)) for path in paths]
    first = infos[0]
    if not first.frames or any((i.samplerate, i.channels, i.frames) !=
                               (first.samplerate, first.channels, first.frames) for i in infos[1:]):
        raise ValueError('反向相減音軌未對齊：取樣率、聲道或樣本長度不一致，已停止，未保存新結果。')
    return first


def subtract_audio(mix, accompaniment, output):
    info = matching_audio(mix, accompaniment)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    # Blockwise subtraction keeps memory bounded for full songs.
    with sf.SoundFile(str(mix)) as original, sf.SoundFile(str(accompaniment)) as backing, \
            sf.SoundFile(str(output), 'w', samplerate=info.samplerate,
                         channels=info.channels, subtype='FLOAT') as result:
        while True:
            m = original.read(65536, dtype='float32', always_2d=True)
            if not len(m):
                break
            i = backing.read(len(m), dtype='float32', always_2d=True)
            v = m - i
            if not np.isfinite(m).all() or not np.isfinite(i).all() or not np.isfinite(v).all():
                raise ValueError('反向相減音軌包含無效數值，已停止，未保存新結果。')
            result.write(v)


def prepare_residual(audio, job, mode, model, *, separate, run, emit):
    workspace = job / 'residual-work'
    workspace.mkdir(parents=True)
    mix = workspace / 'mix.wav'
    emit('residual_preparing')
    run(['ffmpeg', '-v', 'error', '-nostdin', '-i', audio, '-map', '0:a:0',
         '-vn', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_f32le', mix])
    model_dir = 'htdemucs' if model == 'demucs' else model
    first = job / 'first-pass'
    device = separate(mix, first, mode, model, preserve_gain=True)
    i1 = first / 'stems' / model_dir / 'mix' / 'no_vocals.wav'
    matching_audio(mix, i1)
    second = job / 'second-pass'
    device = separate(i1, second, mode, model, preserve_gain=True, stage='accompaniment_separating')
    i2 = second / 'stems' / model_dir / 'no_vocals' / 'no_vocals.wav'
    emit('subtracting')
    vocals = workspace / 'vocals.wav'
    subtract_audio(mix, i2, vocals)
    return {'vocals': vocals, 'accompaniment': i2}, device
