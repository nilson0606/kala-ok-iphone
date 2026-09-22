"""Exercise reference routing and retained stems without downloading or running models."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import audio_pipeline as pipeline

class VocalModePipelineTests(unittest.TestCase):
    def test_reference_uses_selected_voice_and_only_preview_files_survive(self):
        for mode in ['all', 'lead']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix='karaoke-pipeline-') as temporary:
                root=Path(temporary)
                job=root/'.runtime'/'jobs'/('a'*32)
                def run(args, **kwargs):
                    if 'yt_dlp' in args:
                        (job/'audio.mp3').write_bytes(b'input')
                        (job/'audio.info.json').write_text(json.dumps({'title':'Fixture'}))
                    else:
                        Path(args[-1]).write_bytes(b'preview')
                def demucs(*args):
                    directory=job/'stems'/'htdemucs'/'audio'
                    directory.mkdir(parents=True)
                    for name in ['vocals','no_vocals']:(directory/(name+'.wav')).write_bytes(b'stem')
                    return {'device':'cpu'}
                def lead(*args):
                    directory=job/'lead-stems'; directory.mkdir()
                    for name in ['lead','backing']:(directory/(name+'.wav')).write_bytes(b'stem')
                    return {'device':'cpu'}
                def reference(vocals, accompaniment, video, title, output):
                    self.assertEqual(vocals.name, 'lead.wav' if mode=='lead' else 'vocals.wav')
                    self.assertEqual(accompaniment.name,'no_vocals.wav')
                    value={'version':1,'videoId':video,'title':title,'step':.1,'frames':[440]*80,'duration':8}
                    output.write_text(json.dumps(value))
                    return value
                argv=['audio_pipeline','--url','https://youtu.be/M7lc1UVf-VE','--seconds','15','--separate','--reference','--preview','--vocal-mode',mode,'--job-id','a'*32]
                with patch.object(pipeline,'ROOT',root), patch.object(sys,'argv',argv), patch.object(pipeline.shutil,'which',return_value='fixture'), patch.object(pipeline,'run',side_effect=run), patch.object(pipeline,'separate_audio',side_effect=demucs), patch.object(pipeline,'separate_lead',side_effect=lead) as lead_call, patch.object(pipeline,'validate_audio',return_value={'duration':8,'decoded':True}), patch.object(pipeline,'emit'), patch('reference_audio.build_reference',side_effect=reference):
                    self.assertEqual(pipeline.main(),0)
                self.assertEqual(lead_call.call_count,1 if mode=='lead' else 0)
                self.assertEqual(json.loads((job/'reference.json').read_text())['vocalMode'],mode)
                expected={'reference.json','report.json','vocals.mp3','accompaniment.mp3'}
                if mode=='lead':expected.update(['lead.mp3','backing.mp3'])
                self.assertEqual({p.name for p in job.iterdir()},expected)

if __name__=='__main__':unittest.main()
