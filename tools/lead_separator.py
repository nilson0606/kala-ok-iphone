"""Local RoFormer worker: karaoke lead/backing or BS-RoFormer vocals/instrumental."""
import argparse
import logging
import sys
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8')
from pathlib import Path
from model_download import download_model_file
from roformer_audio import decoded_wav
try:
    from audio_separator.separator import Separator
except ImportError as error:
    raise SystemExit('RoFormer 分離套件尚未就緒。請停止本機工具，重新執行 setup-local.ps1，再啟動。') from error

class LocalSeparator(Separator):
    def download_file_if_not_exists(self, url, output_path):
        download_model_file(url, output_path)


MODELS = {
    'karaoke': ('mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt', {'Vocals': 'lead', 'Instrumental': 'backing'}),
    'bs-roformer': ('model_bs_roformer_ep_317_sdr_12.9755.ckpt', {'Vocals': 'vocals', 'Instrumental': 'no_vocals'}),
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--model', choices=MODELS, default='karaoke')
    args = parser.parse_args()
    model, stems = MODELS[args.model]
    args.output.mkdir(parents=True, exist_ok=True)
    separator = LocalSeparator(model_file_dir=str(args.models), output_dir=str(args.output),
                          output_format='WAV', use_soundfile=True, log_level=logging.WARNING,
                          mdxc_params={'batch_size': 1, 'segment_size': 256,
                                       'override_model_segment_size': True, 'overlap': 4, 'pitch_shift': 0})
    # Decode compressed sources before model loading so the writer cannot inherit
    # MP3's MPEG_LAYER_III subtype for a WAV output after expensive inference.
    with decoded_wav(args.input, args.output) as model_input:
        separator.load_model(model_filename=model)
        # Karaoke receives vocals; BS-RoFormer receives the original mix.
        separator.separate(str(model_input), stems)
    if not all((args.output / (stem + '.wav')).is_file() for stem in stems.values()):
        raise RuntimeError('RoFormer model did not produce both expected stems')

if __name__ == '__main__':
    main()
