"""Optional lead/backing separation of a Demucs vocal stem. Runs locally."""
import argparse
import logging
from pathlib import Path
try:
    from audio_separator.separator import Separator
except ImportError as error:
    raise SystemExit('主唱／和音分離套件尚未就緒。請停止本機工具，重新執行 setup-local.ps1，再啟動。') from error

MODEL = 'mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    separator = Separator(model_file_dir=str(args.models), output_dir=str(args.output),
                          output_format='WAV', use_soundfile=True, log_level=logging.WARNING,
                          mdxc_params={'batch_size': 1, 'segment_size': 256,
                                       'override_model_segment_size': True, 'overlap': 4, 'pitch_shift': 0})
    separator.load_model(model_filename=MODEL)
    # For this fixed karaoke model, Vocals is lead; the residual of the input vocal
    # stem is backing vocals, not the full song's instrumental accompaniment.
    separator.separate(str(args.input), {'Vocals': 'lead', 'Instrumental': 'backing'})
    if not all((args.output / (stem + '.wav')).is_file() for stem in ['lead', 'backing']):
        raise RuntimeError('Lead/backing model did not produce both expected stems')

if __name__ == '__main__':
    main()
