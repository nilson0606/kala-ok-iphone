"""Local-only YouTube audio acquisition, validation and optional stem separation.

Run with .runtime/venv/Scripts/python.exe. Outputs stay under .runtime/jobs
and are temporary working files, never included in the Pages deployment.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import threading
from urllib.parse import urlparse, parse_qs
import uuid

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]


def normalize_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Only HTTP(S) YouTube video URLs are supported.')
    if parsed.hostname == 'youtu.be':
        video_id = parsed.path.strip('/').split('/')[0]
    elif parsed.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com'):
        video_id = parse_qs(parsed.query).get('v', [''])[0] if parsed.path == '/watch' else ''
        if parsed.path.startswith(('/shorts/', '/embed/')):
            video_id = parsed.path.split('/')[2]
    else:
        raise ValueError('Only YouTube video URLs are supported.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise ValueError('Invalid YouTube video ID.')
    return f'https://www.youtube.com/watch?v={video_id}'


def emit(stage: str, **details):
    print(json.dumps({'stage': stage, **details}, ensure_ascii=False), flush=True)


def run(args, timeout=300, env=None):
    result = subprocess.run([str(arg) for arg in args], capture_output=True,
                            text=True, encoding='utf-8', errors='replace',
                            timeout=timeout, env=env,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        # Keep transient signed media URLs and environment details out of logs.
        error = re.sub(r'https?://\S+', '[remote URL]', result.stderr[-2500:])
        raise RuntimeError(error.strip() or f'{args[0]} exited with {result.returncode}')
    return result.stdout


def separation_progress(line, stage="separating"):
    # Demucs reports completed inference chunks in seconds. Ignore model-download bars.
    if 'seconds' not in line and not ('it/s' in line or 's/it' in line):
        return None
    match = re.search(r'(\d{1,3})%\|', line)
    return min(100, int(match.group(1))) if match else None


def run_separation(args, timeout=1800, env=None, stage="separating"):
    tail = []
    last = [-1]
    child = subprocess.Popen([str(arg) for arg in args], stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, encoding='utf-8',
                             errors='replace', env=env,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    def read_progress():
        for line in child.stdout:
            tail.append(line)
            if len(tail) > 20:
                tail.pop(0)
            percent = separation_progress(line, stage)
            if percent is not None and percent > last[0]:
                last[0] = percent
                emit(stage, progress=percent)
    reader = threading.Thread(target=read_progress, daemon=True)
    reader.start()
    try:
        child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
        raise
    finally:
        reader.join()
        child.stdout.close()
    if child.returncode:
        error = re.sub(r'https?://\S+', '[remote URL]', ''.join(tail)[-2500:])
        raise RuntimeError(error.strip() or f'Demucs exited with {child.returncode}')


def choose_device(mode='auto'):
    if mode == 'cpu':
        return {'device': 'cpu', 'deviceName': 'CPU'}
    try:
        import torch
        if torch.cuda.is_available():
            return {'device': 'cuda', 'deviceName': torch.cuda.get_device_name(0)}
    except Exception:
        # Driver initialization can fail even when a CUDA-enabled wheel is installed.
        pass
    return {'device': 'cpu', 'deviceName': 'CPU'}


def separate_audio(audio, job, mode='auto', model='demucs', *, preserve_gain=False, stage='separating'):
    if model not in ('demucs', 'bs-roformer', 'mel-roformer'):
        raise ValueError('Invalid separation model')
    selected = choose_device(mode)
    env = {**os.environ, 'TORCH_HOME': str(ROOT / '.runtime' / 'models'), 'OMP_NUM_THREADS': '4'}
    def attempt(device):
        if model in ('bs-roformer', 'mel-roformer'):
            worker_env = dict(env)
            if device == 'cpu':
                # This branch already selected CPU (explicitly or after GPU failure).
                # With an empty mask this Windows runtime reports available=True but
                # device_count=0. The explicit no-device sentinel avoids that mismatch.
                worker_env['CUDA_VISIBLE_DEVICES'] = '-1'
            run_separation([sys.executable, ROOT / 'tools' / 'lead_separator.py',
                            '--model', model, '--input', audio,
                            '--output', job / 'stems' / model / audio.stem,
                            '--models', ROOT / '.runtime' / 'models' / model] + (['--preserve-gain'] if preserve_gain else []), env=worker_env, stage=stage)
            return
        command = [sys.executable, ROOT / 'tools' / 'demucs_lossless.py'] if preserve_gain else [sys.executable, '-m', 'demucs.separate']
        run_separation(command + ['--two-stems', 'vocals',
                        '-n', 'htdemucs', '-d', device, '--shifts', '0', '--float32',
                        '-o', job / 'stems', audio], timeout=1800, env=env, stage=stage)
    emit(stage, model=model, progress=0, **selected)
    try:
        attempt(selected['device'])
    except RuntimeError as error:
        gpu_error = any(term in str(error).lower() for term in (
            'cuda', 'cudnn', 'cublas', 'out of memory', 'nvidia', 'no kernel image'))
        if selected['device'] != 'cuda' or not gpu_error:
            raise
        # The failed child has exited, releasing its GPU allocations. Retry once in a
        # new CPU process; successful outputs replace any partially written stems.
        selected = {'device': 'cpu', 'deviceName': 'CPU', 'fallback': True}
        emit(stage, model=model, progress=0, **selected)
        attempt('cpu')
    return selected



def separate_lead(vocals, job, mode='auto'):
    selected = choose_device(mode)
    def attempt(device):
        env = {**os.environ, 'OMP_NUM_THREADS': '4'}
        if device == 'cpu':
            env['CUDA_VISIBLE_DEVICES'] = ''
        run_separation([sys.executable, ROOT / 'tools' / 'lead_separator.py',
                        '--input', vocals, '--output', job / 'lead-stems',
                        '--models', ROOT / '.runtime' / 'models' / 'lead'],
                       env=env, stage='lead_separating')
    emit('lead_separating', progress=0, **selected)
    try:
        attempt(selected['device'])
    except RuntimeError as error:
        if selected['device'] != 'cuda' or not any(word in str(error).lower() for word in ('cuda', 'cudnn', 'cublas', 'out of memory', 'no kernel image')):
            raise
        selected = {'device':'cpu', 'deviceName':'CPU', 'fallback':True}
        emit('lead_separating', progress=0, **selected)
        attempt('cpu')
    return selected


def validate_audio(path: Path):
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError('Audio file is missing or empty.')
    data = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                           '-show_entries', 'format=duration,size:stream=codec_name,sample_rate,channels',
                           '-of', 'json', path]))
    streams = data.get('streams', [])
    if not streams:
        raise ValueError('File has no audio stream.')
    stream = streams[0]
    duration = float(data['format']['duration'])
    rate, channels = int(stream['sample_rate']), int(stream['channels'])
    if duration <= 0 or not 8000 <= rate <= 192000 or not 1 <= channels <= 8:
        raise ValueError('Unsupported or invalid audio parameters.')
    run(['ffmpeg', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'])
    return {'codec': stream['codec_name'], 'sampleRate': rate, 'channels': channels,
            'duration': duration, 'bytes': path.stat().st_size, 'decoded': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--url', help='YouTube video URL')
    source.add_argument('--input', type=Path, help='Existing local audio; original is not modified')
    parser.add_argument('--seconds', type=int, default=15, help='YouTube clip length, 1–120 seconds; 0 for full track (max 15 minutes)')
    parser.add_argument('--separate', action='store_true', help='Separate vocals and accompaniment locally')
    parser.add_argument('--reference', action='store_true', help='Build a temporary melody/beat reference')
    parser.add_argument('--preview', action='store_true', help='Keep compressed stems for optional local listening')
    parser.add_argument('--separation-model', choices=['demucs', 'bs-roformer', 'mel-roformer'], default='demucs')
    parser.add_argument('--separation-method', choices=['single', 'residual'], default='single')
    parser.add_argument('--pitch-method', choices=['yin', 'rmvpe'], default='yin')
    parser.add_argument('--vocal-mode', choices=['all', 'lead'], default='all')
    parser.add_argument('--device', choices=['auto', 'cpu'], default='auto', help='Prefer CUDA when available, or force CPU')
    parser.add_argument('--job-id', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 0 <= args.seconds <= 120:
        parser.error('--seconds must be between 0 and 120')
    for command in ['ffmpeg', 'ffprobe']:
        if not shutil.which(command):
            parser.error(f'{command} is required on PATH')
    if args.reference and (not args.url or not args.separate):
        parser.error('--reference requires --url and --separate')
    if args.separation_method == 'residual' and not args.separate:
        parser.error('--separation-method residual requires --separate')
    if args.vocal_mode == 'lead' and not args.separate:
        parser.error('--vocal-mode lead requires --separate')
    if args.preview and not args.reference:
        parser.error('--preview requires --reference')
    if args.job_id and not re.fullmatch(r'[a-f0-9]{32}', args.job_id):
        parser.error('Invalid job ID')
    job = ROOT / '.runtime' / 'jobs' / (args.job_id or uuid.uuid4().hex)
    job.mkdir(parents=True)
    started = time.monotonic()
    try:
        if args.url:
            url = normalize_url(args.url)
            emit('download', job=job.name, seconds=args.seconds)
            command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist',
                       '--no-cache-dir', '--js-runtimes', 'node', '--socket-timeout', '15',
                       '--retries', '1', '--no-progress', '--quiet', '-f', 'bestaudio',
                       '--max-filesize', '100M', '--extract-audio', '--audio-format', 'mp3',
                       '--audio-quality', '5', '--write-info-json', '-o', job / 'audio.%(ext)s']
            if args.seconds:
                command += ['--match-filter', '!is_live & !is_upcoming', '--download-sections', f'*0-{args.seconds}']
            else:
                command += ['--match-filter', 'duration <= 900 & !is_live & !is_upcoming']
            from download_network import download
            download(command + [url], run=run, emit=emit)
            audio = job / 'audio.mp3'
            info = json.loads((job / 'audio.info.json').read_text(encoding='utf-8'))
            title = str(info.get('title') or url)[0:300]
            video_id = parse_qs(urlparse(url).query)['v'][0]
        else:
            source = args.input.resolve(strict=True)
            audio = job / ('audio' + source.suffix.lower())
            shutil.copy2(source, audio)
        original = validate_audio(audio)
        emit('validated', **original)
        report = {'source': {'path': str(audio), **original}, 'stems': {}, 'temporary': True}
        if args.separate:
            if args.separation_method == 'residual':
                from residual_separation import prepare_residual
                stems, report['separation'] = prepare_residual(audio, job, args.device, args.separation_model,
                                                             separate=separate_audio, run=run, emit=emit)
            else:
                report['separation'] = separate_audio(audio, job, args.device, args.separation_model)
                stem_dir = job / 'stems' / ('htdemucs' if args.separation_model == 'demucs' else args.separation_model) / audio.stem
                stems = {'vocals': stem_dir / 'vocals.wav', 'accompaniment': stem_dir / 'no_vocals.wav'}
            report['separationMethod'] = args.separation_method
            for name, file in stems.items():
                result = validate_audio(file)
                if abs(result['duration'] - original['duration']) > .15:
                    raise ValueError(f'{name} duration does not match source')
                report['stems'][name] = {'path': str(file), **result}
                emit('stem_validated', stem=name, **result)
            if args.vocal_mode == 'lead':
                report['leadSeparation'] = separate_lead(stems['vocals'], job, args.device)
                for name in ['lead', 'backing']:
                    file = job / 'lead-stems' / (name + '.wav')
                    result = validate_audio(file)
                    if abs(result['duration'] - original['duration']) > .15:
                        raise ValueError(f'{name} duration does not match source')
                    stems[name] = file
                    report['stems'][name] = {'path': str(file), **result}
                    emit('stem_validated', stem=name, **result)
        if args.reference:
            emit('reference')
            from reference_audio import build_reference
            report['reference'] = build_reference(stems['lead'] if args.vocal_mode == 'lead' else stems['vocals'], stems['accompaniment'], video_id, title, job / 'reference.json', pitch_method=args.pitch_method, device=args.device, progress=lambda value: emit('reference', progress=value, message='RMVPE 音高擷取'))
            value = json.loads((job / 'reference.json').read_text(encoding='utf-8'))
            value['vocalMode'] = args.vocal_mode
            value['separationModel'] = args.separation_model
            value['separationMethod'] = args.separation_method
            (job / 'reference.json').write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
            if args.preview:
                for name, file in stems.items():
                    run(['ffmpeg', '-v', 'error', '-i', file, '-codec:a', 'libmp3lame', '-b:a', '128k', job / (name + '.mp3')])
            # Retain only opted-in compressed stems; discard source and large WAVs.
            for generated in list(job.iterdir()):
                if generated.name not in (['reference.json'] + [name + '.mp3' for name in stems] if args.preview else ['reference.json']):
                    if generated.is_dir():
                        if generated.resolve().parent != job.resolve():
                            raise ValueError('Unexpected temporary directory')
                        shutil.rmtree(generated)
                    else:
                        generated.unlink()
            report['source'] = {k:v for k,v in report['source'].items() if k != 'path'}
            report['stems'] = {}
            report['audioCleared'] = not args.preview
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        (job / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        emit('complete', report=str(job / 'report.json'), elapsedSeconds=report['elapsedSeconds'])
    except Exception as error:
        # Generated files only. Never remove caller-supplied input or anything outside jobs/.
        allowed = (ROOT / '.runtime' / 'jobs').resolve()
        if job.resolve().parent == allowed:
            shutil.rmtree(job)
        emit('failed', message=str(error))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
