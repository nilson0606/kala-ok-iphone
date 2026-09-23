import logging
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import soundfile as sf
from roformer_audio import decoded_wav


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
class RoformerInputTests(unittest.TestCase):
    def test_mp3_input_is_float_wav_and_real_exporter_can_save_both_stems(self):
        from audio_separator.separator.common_separator import CommonSeparator
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'source.wav'; mp3=root/'source.mp3'
            t=np.arange(44100)/44100
            wave=np.column_stack([.2*np.sin(2*np.pi*440*t)]*2).astype('float32')
            sf.write(source,wave,44100,subtype='PCM_16')
            subprocess.run(['ffmpeg','-v','error','-i',str(source),str(mp3)],check=True,capture_output=True)
            original=mp3.read_bytes()
            self.assertEqual(sf.info(mp3).subtype,'MPEG_LAYER_III')
            with decoded_wav(mp3,root) as decoded:
                info=sf.info(decoded)
                self.assertEqual(info.subtype,'FLOAT')
                self.assertEqual(info.frames,44100)
                audio,rate=sf.read(decoded,dtype='float32')
                writer=SimpleNamespace(logger=logging.getLogger('export-test'),normalization_threshold=.9,amplification_threshold=0,
                                       output_dir=str(root),input_subtype=info.subtype,input_bit_depth=32,sample_rate=rate)
                for stem in ['vocals','no_vocals']:
                    CommonSeparator.write_audio_soundfile(writer,stem+'.wav',audio)
                    saved=sf.info(root/(stem+'.wav'))
                    self.assertEqual(saved.frames,44100)
                    self.assertEqual(saved.channels,2)
                    self.assertEqual(saved.subtype,'FLOAT')
            self.assertFalse(decoded.exists())
            self.assertEqual(mp3.read_bytes(),original)
            self.assertFalse(list(root.glob('.decoded-input-*')))

    def test_residual_writers_preserve_peaks_and_stereo_gain(self):
        from audio_separator.separator.common_separator import CommonSeparator
        from demucs_lossless import save_float
        import torch
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            audio=np.array([[1.4,.3],[-1.2,-.5],[.6,.2]],dtype='float32')
            writer=SimpleNamespace(logger=logging.getLogger('residual-export'),normalization_threshold=float('inf'),amplification_threshold=0,
                                   output_dir=str(root),input_subtype='FLOAT',input_bit_depth=32,sample_rate=44100)
            CommonSeparator.write_audio_soundfile(writer,'bs.wav',audio.copy())
            save_float(torch.tensor(audio.T),root/'demucs.wav',44100)
            for model in ['bs','demucs']:
                np.testing.assert_array_equal(sf.read(root/(model+'.wav'),dtype='float32')[0],audio)

    def test_existing_pcm_wav_stays_untouched_and_failed_work_cleans_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'source.wav'
            sf.write(source,np.zeros((8000,2)),8000,subtype='PCM_16')
            with decoded_wav(source,root) as decoded:
                self.assertEqual(decoded,source.resolve())
            self.assertTrue(source.exists())
            mp3=root/'source.mp3'
            subprocess.run(['ffmpeg','-v','error','-i',str(source),str(mp3)],check=True,capture_output=True)
            with self.assertRaisesRegex(RuntimeError,'model failed'):
                with decoded_wav(mp3,root):raise RuntimeError('model failed')
            self.assertTrue(mp3.exists())
            self.assertFalse(list(root.glob('.decoded-input-*')))

if __name__=='__main__':unittest.main()
