"""Keep compressed input codecs out of the RoFormer WAV export path."""
from contextlib import contextmanager
from pathlib import Path
import os
import subprocess
import tempfile
import soundfile as sf


@contextmanager
def decoded_wav(source, workspace):
    source = Path(source).resolve(strict=True)
    try:
        info = sf.info(source)
    except (RuntimeError, OSError):
        info = None
    # audio-separator 0.47 carries input_subtype into its WAV writer. MP3's
    # MPEG_LAYER_III subtype fails there after inference, so only pass PCM/float WAV.
    if info and info.format in ('WAV', 'WAVEX') and info.subtype in ('PCM_16', 'PCM_24', 'PCM_32', 'FLOAT', 'DOUBLE'):
        yield source
        return
    workspace = Path(workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.decoded-input-', dir=workspace) as directory:
        wav = Path(directory) / 'input.wav'
        result = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(source),
                                 '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', str(wav)],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('模型輸入解碼失敗：' + result.stderr[-1000:])
        info = sf.info(wav)
        if info.format not in ('WAV', 'WAVEX') or info.subtype != 'FLOAT' or not info.frames:
            raise RuntimeError('模型輸入未產生有效的 PCM WAV')
        yield wav
