"""Local RMVPE pitch inference with bounded memory and verified shared weights."""
import gc
import hashlib
import math
from pathlib import Path
import numpy as np
from model_download import download_model_file

MODEL_URL = 'https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt'
MODEL_SHA256 = '6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193'
MODEL_BYTES = 181184272


def ensure_model(directory):
    target = Path(directory) / 'rmvpe.pt'
    def valid():
        if not target.is_file() or target.stat().st_size != MODEL_BYTES:
            return False
        with target.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest() == MODEL_SHA256
    if valid():
        return target
    target.unlink(missing_ok=True)
    download_model_file(MODEL_URL, target)
    if not valid():
        target.unlink(missing_ok=True)
        raise ValueError('RMVPE 模型完整性驗證失敗，請重試下載。')
    return target


def extract_grid(audio, infer, progress=lambda value: None):
    """Sample centered 10-ms predictions onto the existing 100-ms reference grid.

    Eight-second cores have one-second context on both sides. Context is discarded,
    preserving original song timestamps without concatenation drift.
    """
    audio = np.asarray(audio, dtype=np.float32)
    frames = []
    for core in range(0, len(audio), 128000):
        end = min(len(audio), core + 128000)
        left, right = max(0, core - 16000), min(len(audio), end + 16000)
        segment = audio[left:right]
        if len(segment) < 6400:
            segment = np.pad(segment, (0, 6400 - len(segment)))
        f0 = np.asarray(infer(segment), dtype=float)
        if f0.ndim != 1 or len(f0) < math.ceil((end-left)/160):
            raise ValueError('RMVPE 回傳的音高長度不完整。')
        for sample in range(core, end, 1600):
            center = (sample - left) // 160
            candidates = f0[max(0, center-4):center+5]
            valid = candidates[np.isfinite(candidates) & (candidates >= 65) & (candidates <= 1000)]
            frames.append(round(float(np.median(valid)), 2) if len(valid) > len(candidates)/2 else None)
        progress(round(end / len(audio) * 100))
    return frames


def rmvpe_frames(audio, models, device='auto', progress=lambda value: None):
    import torch
    from vendor.rmvpe.inference import RMVPE
    torch.set_num_threads(4)
    checkpoint = ensure_model(models)
    selected = 'cuda' if device != 'cpu' and torch.cuda.is_available() else 'cpu'
    model = None
    def run(target):
        nonlocal model
        model = RMVPE(str(checkpoint), is_half=False, device=target)
        with torch.inference_mode():
            return extract_grid(audio, model.infer_from_audio, progress)
    try:
        return run(selected)
    except RuntimeError as error:
        if selected != 'cuda' or not any(term in str(error).lower() for term in ('cuda','cudnn','cublas','out of memory','no kernel image')):
            raise
        model = None
        gc.collect()
        torch.cuda.empty_cache()
        progress(0)
        return run('cpu')
    finally:
        model = None
        gc.collect()
        if selected == 'cuda':
            torch.cuda.empty_cache()
