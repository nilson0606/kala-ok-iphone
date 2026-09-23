"""Build another pitch-method reference from saved stems; never rerun separation."""
import argparse
import json
from pathlib import Path
import shutil
from audio_pipeline import ROOT, emit, validate_audio
from reference_audio import build_reference


def rebuild(source, job, pitch_method, preview):
    value = json.loads((source / 'reference.json').read_text(encoding='utf-8'))
    names = ['vocals','accompaniment'] + (['lead','backing'] if value.get('vocalMode') == 'lead' else [])
    for name in names:
        info = validate_audio(source / (name + '.mp3'))
        if abs(info['duration'] - value['duration']) > .15:
            raise ValueError('保存音軌長度與歌曲基準不一致，請重新分離。')
    emit('reference', message='重用本機分離音軌，建立 ' + pitch_method.upper() + ' 音高基準…')
    build_reference(source / ('lead.mp3' if value.get('vocalMode') == 'lead' else 'vocals.mp3'),
                    source / 'accompaniment.mp3', value['videoId'], value['title'], job / 'reference.json',
                    pitch_method=pitch_method, progress=lambda n: emit('reference', progress=n, message='RMVPE 音高擷取'))
    result = json.loads((job / 'reference.json').read_text(encoding='utf-8'))
    result.update(vocalMode=value.get('vocalMode','all'), separationModel=value.get('separationModel','demucs'), separationMethod=value.get('separationMethod','single'))
    (job / 'reference.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    if preview:
        for name in names:
            shutil.copyfile(source / (name + '.mp3'), job / (name + '.mp3'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--pitch-method', choices=['yin','rmvpe'], required=True)
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    import re
    if not re.fullmatch(r'[a-f0-9]{32}', args.job_id):
        parser.error('Invalid job ID')
    job = ROOT / '.runtime/jobs' / args.job_id
    job.mkdir(parents=True)
    try:
        rebuild(args.source.resolve(strict=True), job, args.pitch_method, args.preview)
        emit('complete')
    except Exception as error:
        if job.resolve().parent == (ROOT / '.runtime/jobs').resolve():
            shutil.rmtree(job)
        emit('failed', message=str(error))
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
