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


def separation_progress(line):
    # Demucs reports completed inference chunks in seconds. Ignore model-download bars.
    if 'seconds' not in line:
        return None
    match = re.search(r'(\d{1,3})%\|', line)
    return min(100, int(match.group(1))) if match else None


def run_separation(args, timeout=1800, env=None):
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
            percent = separation_progress(line)
            if percent is not None and percent > last[0]:
                last[0] = percent
                emit('separating', progress=percent)
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
    parser.add_argument('--separate', action='store_true', help='Separate vocals and accompaniment locally with Demucs')
    parser.add_argument('--reference', action='store_true', help='Build a temporary melody/beat reference')
    parser.add_argument('--preview', action='store_true', help='Keep compressed stems for optional local listening')
    parser.add_argument('--job-id', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 0 <= args.seconds <= 120:
        parser.error('--seconds must be between 0 and 120')
    for command in ['ffmpeg', 'ffprobe']:
        if not shutil.which(command):
            parser.error(f'{command} is required on PATH')
    if args.reference and (not args.url or not args.separate):
        parser.error('--reference requires --url and --separate')
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
            run(command + [url], timeout=600)
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
            emit('separating', model='htdemucs', device='cpu')
            env = {**os.environ, 'TORCH_HOME': str(ROOT / '.runtime' / 'models'), 'OMP_NUM_THREADS': '4'}
            run_separation([sys.executable, '-m', 'demucs.separate', '--two-stems', 'vocals',
                 '-n', 'htdemucs', '-d', 'cpu', '--shifts', '0', '--float32',
                 '-o', job / 'stems', audio], timeout=1800, env=env)
            stem_dir = job / 'stems' / 'htdemucs' / audio.stem
            for name, filename in [('vocals', 'vocals.wav'), ('accompaniment', 'no_vocals.wav')]:
                file = stem_dir / filename
                result = validate_audio(file)
                if abs(result['duration'] - original['duration']) > .15:
                    raise ValueError(f'{name} duration does not match source')
                report['stems'][name] = {'path': str(file), **result}
                emit('stem_validated', stem=name, **result)
        if args.reference:
            emit('reference')
            from reference_audio import build_reference
            report['reference'] = build_reference(stem_dir / 'vocals.wav', stem_dir / 'no_vocals.wav', video_id, title, job / 'reference.json')
            if args.preview:
                for name, filename in [('vocals', 'vocals.wav'), ('accompaniment', 'no_vocals.wav')]:
                    run(['ffmpeg', '-v', 'error', '-i', stem_dir / filename, '-codec:a', 'libmp3lame', '-b:a', '128k', job / (name + '.mp3')])
            # Retain only opted-in compressed stems; discard source and large WAVs.
            for generated in list(job.iterdir()):
                if generated.name not in (['reference.json', 'vocals.mp3', 'accompaniment.mp3'] if args.preview else ['reference.json']):
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
