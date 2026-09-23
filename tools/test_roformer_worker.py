import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import soundfile as sf
import numpy as np


class RoformerWorkerTests(unittest.TestCase):
    def test_catalog_stem_labels_publish_expected_preview_sources(self):
        # Avoid loading inference engines in this wiring regression test.
        spec=importlib.util.spec_from_file_location('worker_fixture',Path(__file__).with_name('lead_separator.py'))
        worker=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{'audio_separator.separator':SimpleNamespace(Separator=object)}):
            spec.loader.exec_module(worker)
        cases=[('mel-roformer',['vocals','other']),('mel-roformer',['Vocals','Instrumental']),('bs-roformer',['Vocals','Instrumental']),('karaoke',['Vocals','Instrumental'])]
        for model,labels in cases:
            with self.subTest(model=model,labels=labels), tempfile.TemporaryDirectory() as folder:
                root=Path(folder);source=root/'mix.wav';out=root/'output'
                sf.write(source,np.zeros((100,2),dtype='float32'),44100,subtype='FLOAT')
                separator=MagicMock()
                def separate(audio,names):
                    mapping={key.lower():value for key,value in names.items()}
                    for label in labels:
                        (out/(mapping.get(label.lower(),label)+'.wav')).write_bytes(b'fixture stem')
                separator.separate.side_effect=separate
                with patch.object(worker,'LocalSeparator',return_value=separator), patch.object(sys,'argv',['worker','--input',str(source),'--output',str(out),'--models',str(root/'models'),'--model',model]):
                    worker.main()
                expected={'lead.wav','backing.wav'} if model=='karaoke' else {'vocals.wav','no_vocals.wav'}
                self.assertEqual({p.name for p in out.iterdir()},expected)

if __name__=='__main__':unittest.main()
