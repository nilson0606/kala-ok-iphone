import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from rmvpe_pitch import extract_grid, ensure_model
from reference_worker import rebuild

class RmvpeTests(unittest.TestCase):
    def test_chunking_retains_time_grid_and_drops_context(self):
        audio=np.arange(16000*19+333,dtype=np.float32)
        calls=[]
        def infer(segment):
            calls.append(len(segment))
            # Pitch encodes original time, exposing a shift or duplicated chunk.
            start=int(segment[0])
            return 100+(start+np.arange(len(segment)//160+1)*160)/16000
        progress=[]
        frames=extract_grid(audio,infer,progress.append)
        self.assertEqual(len(frames),191)
        self.assertLessEqual(max(calls),16000*10)
        self.assertAlmostEqual(frames[80],108,places=2)
        self.assertAlmostEqual(frames[160],116,places=2)
        self.assertEqual(progress[-1],100)

    def test_silence_invalid_pitch_and_incomplete_predictions(self):
        audio=np.zeros(16000,dtype=np.float32)
        for invalid in [0,np.nan,1200,40]:
            self.assertTrue(all(f is None for f in extract_grid(audio,lambda x:np.full(len(x)//160+1,invalid))))
        with self.assertRaises(ValueError):extract_grid(audio,lambda x:np.ones(3))
        self.assertEqual(len(extract_grid(np.zeros(10),lambda x:np.full(41,220))),1)

    def test_model_download_checks_hash_and_does_not_reuse_partial_file(self):
        with tempfile.TemporaryDirectory(prefix='karaoke-rmvpe-') as folder:
            target=Path(folder)/'rmvpe.pt';target.write_bytes(b'partial')
            with patch('rmvpe_pitch.download_model_file',side_effect=lambda url,path:Path(path).write_bytes(b'bad')) as download:
                with self.assertRaises(ValueError):ensure_model(folder)
                download.assert_called_once();self.assertFalse(target.exists())

    def test_saved_stems_build_another_method_without_mutating_source(self):
        with tempfile.TemporaryDirectory(prefix='karaoke-rmvpe-') as folder:
            root=Path(folder);source=root/'source';source.mkdir();job=root/'job';job.mkdir()
            metadata={'videoId':'M7lc1UVf-VE','title':'Fixture','duration':8,'vocalMode':'lead','separationModel':'bs-roformer','separationMethod':'residual'}
            (source/'reference.json').write_text(json.dumps(metadata))
            for name in ['vocals','accompaniment','lead','backing']:(source/(name+'.mp3')).write_bytes(name.encode())
            before={p.name:p.read_bytes() for p in source.iterdir()}
            def build(vocals,accompaniment,video,title,output,**kwargs):
                self.assertEqual(vocals.name,'lead.mp3');self.assertEqual(kwargs['pitch_method'],'rmvpe')
                output.write_text(json.dumps({'pitchMethod':'rmvpe'}))
            with patch('reference_worker.validate_audio',return_value={'duration':8}),patch('reference_worker.build_reference',side_effect=build),patch('reference_worker.emit'):
                rebuild(source,job,'rmvpe',True)
            self.assertEqual(before,{p.name:p.read_bytes() for p in source.iterdir()})
            self.assertEqual((job/'lead.mp3').read_bytes(),b'lead')
            result=json.loads((job/'reference.json').read_text());self.assertEqual(result['pitchMethod'],'rmvpe');self.assertEqual(result['separationModel'],'bs-roformer');self.assertEqual(result['separationMethod'],'residual')

if __name__=='__main__':unittest.main()
