"""Local-only PCM capture. No audio files are written."""
import argparse,json,sys,warnings
import numpy as np
import soundcard as sc
warnings.simplefilter('ignore', sc.SoundcardRuntimeWarning)
p=argparse.ArgumentParser()
p.add_argument('--list',action='store_true')
p.add_argument('--device',default='')
a=p.parse_args()
if a.list:
    print(json.dumps({'devices':[{'deviceId':m.id,'label':m.name,'kind':'audioinput'} for m in sc.all_microphones()]}))
else:
    devices=sc.all_microphones()
    mic=next((m for m in devices if m.id==a.device),None) if a.device else sc.default_microphone()
    if mic is None: raise RuntimeError('Selected microphone is no longer available')
    with mic.recorder(samplerate=48000,channels=2,blocksize=960) as source:
        out=sys.stdout.buffer
        out.write((json.dumps({'label':mic.name,'sampleRate':48000,'channels':1})+'\n').encode())
        out.flush()
        while True:
            frames=source.record(numframes=960)
            mono=np.mean(frames,axis=1).astype('<f4')
            out.write(mono.tobytes());out.flush()
