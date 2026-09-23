"""Run Demucs with float WAV output and no independent stem gain changes.

Used only by the residual workflow; the normal Demucs CLI remains unchanged.
"""
from pathlib import Path
import soundfile as sf
import demucs.separate as separate


def save_float(wav, path, samplerate, **kwargs):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), wav.detach().cpu().T.numpy(), samplerate, subtype='FLOAT')


if __name__ == '__main__':
    separate.save_audio = save_float
    separate.main()
