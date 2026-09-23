import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import soundfile as sf
from residual_separation import subtract_audio, prepare_residual
from audio_pipeline import separate_audio


class ResidualTests(unittest.TestCase):
    def test_subtraction_recovers_signal_without_clipping_or_normalization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            t = np.arange(140003, dtype=np.float64) / 44100
            voice = np.column_stack([1.1*np.sin(2*np.pi*440*t), .2*np.sin(2*np.pi*330*t)]).astype('float32')
            backing = np.column_stack([.3*np.sin(2*np.pi*180*t), .5*np.cos(2*np.pi*120*t)]).astype('float32')
            sf.write(root/'mix.wav', voice+backing, 44100, subtype='FLOAT')
            sf.write(root/'backing.wav', backing, 44100, subtype='FLOAT')
            subtract_audio(root/'mix.wav', root/'backing.wav', root/'voice.wav')
            actual, rate = sf.read(root/'voice.wav', dtype='float32')
            np.testing.assert_allclose(actual, voice, atol=2e-7)
            self.assertGreater(np.abs(actual).max(), 1)
            self.assertEqual(rate, 44100)

    def test_mismatch_and_nonfinite_audio_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sf.write(root/'mix.wav', np.ones((20, 2)), 44100, subtype='FLOAT')
            for frames, channels, rate in [(19,2,44100),(20,1,44100),(20,2,48000)]:
                sf.write(root/'bad.wav',np.zeros((frames,channels)),rate,subtype='FLOAT')
                with self.assertRaisesRegex(ValueError,'未對齊'):
                    subtract_audio(root/'mix.wav',root/'bad.wav',root/'out.wav')
            sf.write(root/'bad.wav',np.full((20,2),np.nan),44100,subtype='FLOAT')
            with self.assertRaisesRegex(ValueError,'無效數值'):
                subtract_audio(root/'mix.wav',root/'bad.wav',root/'out.wav')

    def test_second_pass_receives_first_accompaniment_and_subtracts_i2_not_i1(self):
        for model in ['demucs','bs-roformer']:
            with self.subTest(model=model), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); calls=[]; stages=[]
                mix=np.full((400,2),.75,dtype='float32')
                def run(command): sf.write(command[-1],mix,44100,subtype='FLOAT')
                def separate(audio,job,mode,selected,**kwargs):
                    calls.append((audio,kwargs)); self.assertEqual(selected,model)
                    self.assertTrue(kwargs['preserve_gain'])
                    if len(calls)==2:
                        self.assertEqual(audio.name,'no_vocals.wav')
                        np.testing.assert_allclose(sf.read(audio)[0],.5)
                        self.assertEqual(kwargs['stage'],'accompaniment_separating')
                    dest=job/'stems'/('htdemucs' if model=='demucs' else model)/audio.stem
                    dest.mkdir(parents=True)
                    sf.write(dest/'no_vocals.wav',np.full_like(mix,.5 if len(calls)==1 else .25),44100,subtype='FLOAT')
                    return {'device':'cpu'}
                stems,_=prepare_residual(root/'source.mp3',root,'cpu',model,separate=separate,run=run,emit=lambda stage:stages.append(stage))
                self.assertEqual(len(calls),2)
                np.testing.assert_allclose(sf.read(stems['vocals'])[0],.5)
                self.assertEqual(stages,['residual_preparing','subtracting'])

    def test_preserve_gain_and_second_pass_stage_survive_gpu_fallback(self):
        for model in ['demucs','bs-roformer']:
            with patch('audio_pipeline.choose_device',return_value={'device':'cuda'}), patch('audio_pipeline.run_separation',side_effect=[RuntimeError('CUDA out of memory'),None]) as run, patch('audio_pipeline.emit') as emit:
                separate_audio(Path('input.wav'),Path('job'),model=model,preserve_gain=True,stage='accompaniment_separating')
                self.assertEqual(run.call_count,2)
                for call in run.call_args_list:
                    self.assertEqual(call.kwargs['stage'],'accompaniment_separating')
                    if model=='bs-roformer': self.assertIn('--preserve-gain',call.args[0])
                    else: self.assertTrue(any(str(v).endswith('demucs_lossless.py') for v in call.args[0]))
                self.assertEqual([c.args[0] for c in emit.call_args_list],['accompaniment_separating']*2)

if __name__ == '__main__': unittest.main()
