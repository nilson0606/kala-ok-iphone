"""Exercise reference routing and retained stems without downloading or running models."""
import itertools
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import audio_pipeline as pipeline

class VocalModePipelineTests(unittest.TestCase):
    def test_reference_uses_selected_voice_and_only_preview_files_survive(self):
        for model, mode, method, strategy in itertools.product(['demucs', 'bs-roformer', 'mel-roformer'], ['all', 'lead'], ['yin','rmvpe'], ['single','residual']):
            with self.subTest(model=model, mode=mode), tempfile.TemporaryDirectory(prefix='karaoke-pipeline-') as temporary:
                root=Path(temporary)
                job=root/'.runtime'/'jobs'/('a'*32)
                def run(args, **kwargs):
                    if 'yt_dlp' in args:
                        (job/'audio.mp3').write_bytes(b'input')
                        (job/'audio.info.json').write_text(json.dumps({'title':'Fixture'}))
                    else:
                        Path(args[-1]).write_bytes(b'preview')
                def demucs(*args):
                    self.assertEqual(args[3],model)
                    directory=job/'stems'/('htdemucs' if model=='demucs' else model)/'audio'
                    directory.mkdir(parents=True)
                    for name in ['vocals','no_vocals']:(directory/(name+'.wav')).write_bytes(b'stem')
                    return {'device':'cpu'}
                def residual(*args, **kwargs):
                    directory=job/'residual-work';directory.mkdir()
                    for name in ['vocals','no_vocals']:(directory/(name+'.wav')).write_bytes(b'residual')
                    return {'vocals':directory/'vocals.wav','accompaniment':directory/'no_vocals.wav'}, {'device':'cpu'}
                def lead(*args):
                    self.assertEqual(args[0].parent.name,'residual-work' if strategy=='residual' else 'audio')
                    directory=job/'lead-stems'; directory.mkdir()
                    for name in ['lead','backing']:(directory/(name+'.wav')).write_bytes(b'stem')
                    return {'device':'cpu'}
                def reference(vocals, accompaniment, video, title, output, **kwargs):
                    self.assertEqual(kwargs['pitch_method'],method)
                    self.assertEqual(vocals.name, 'lead.wav' if mode=='lead' else 'vocals.wav')
                    self.assertEqual(accompaniment.name,'no_vocals.wav')
                    self.assertEqual(accompaniment.parent.name,'residual-work' if strategy=='residual' else 'audio')
                    value={'version':1,'videoId':video,'title':title,'step':.1,'frames':[440]*80,'duration':8,'pitchMethod':method}
                    output.write_text(json.dumps(value))
                    return value
                argv=['audio_pipeline','--url','https://youtu.be/M7lc1UVf-VE','--seconds','15','--separate','--reference','--preview','--separation-model',model,'--vocal-mode',mode,'--pitch-method',method,'--separation-method',strategy,'--job-id','a'*32]
                with patch.object(pipeline,'ROOT',root), patch.object(sys,'argv',argv), patch.object(pipeline.shutil,'which',return_value='fixture'), patch.object(pipeline,'run',side_effect=run), patch.object(pipeline,'separate_audio',side_effect=demucs), patch.object(pipeline,'separate_lead',side_effect=lead) as lead_call, patch.object(pipeline,'validate_audio',return_value={'duration':8,'decoded':True}), patch.object(pipeline,'emit'), patch('reference_audio.build_reference',side_effect=reference), patch('residual_separation.prepare_residual',side_effect=residual):
                    self.assertEqual(pipeline.main(),0)
                self.assertEqual(json.loads((job/'reference.json').read_text())['separationMethod'],strategy)
                self.assertEqual(lead_call.call_count,1 if mode=='lead' else 0)
                self.assertEqual(json.loads((job/'reference.json').read_text())['separationModel'],model)
                self.assertEqual(json.loads((job/'reference.json').read_text())['vocalMode'],mode)
                expected={'reference.json','report.json','vocals.mp3','accompaniment.mp3'}
                if mode=='lead':expected.update(['lead.mp3','backing.mp3'])
                self.assertEqual({p.name for p in job.iterdir()},expected)

    def test_failed_second_pass_cleans_only_the_transient_job(self):
        with tempfile.TemporaryDirectory(prefix='karaoke-pipeline-') as temporary:
            root=Path(temporary); source=root/'source.wav';source.write_bytes(b'keep original')
            library=root/'saved-library';library.mkdir();(library/'old-song').write_bytes(b'keep saved song')
            job=root/'.runtime/jobs'/('b'*32)
            def fail(*args,**kwargs):
                (job/'partial.wav').write_bytes(b'incomplete')
                raise ValueError('second pass failed')
            argv=['pipeline','--input',str(source),'--separate','--separation-method','residual','--job-id','b'*32]
            with patch.object(pipeline,'ROOT',root),patch.object(sys,'argv',argv),patch.object(pipeline.shutil,'which',return_value='fixture'),patch.object(pipeline,'validate_audio',return_value={'duration':8}),patch('residual_separation.prepare_residual',side_effect=fail),patch.object(pipeline,'emit'):
                self.assertEqual(pipeline.main(),1)
            self.assertFalse(job.exists())
            self.assertEqual(source.read_bytes(),b'keep original')
            self.assertEqual((library/'old-song').read_bytes(),b'keep saved song')

if __name__=='__main__':unittest.main()
