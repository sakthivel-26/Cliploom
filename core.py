"""Local Cliploom project store and media pipeline."""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import av
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('CLIPLOOM_DATA', str(ROOT / 'data'))).resolve()
DATA.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('HF_HOME', str(DATA / 'hf-cache'))
os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
DB = DATA / 'projects.sqlite3'
POOL = ThreadPoolExecutor(max_workers=1)
MODEL_LOCK = threading.Lock()
MODELS = {}


def connect():
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    return db


def init_store():
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
    # Interrupted work is visible and retryable; never pretend it completed.
    for p in list_projects():
        if p['status'] in ('queued', 'processing', 'rendering'):
            update(p['id'], status='error', message='Processing was interrupted. Retry this project.', error='App restarted during processing.')


def folder(pid):
    if not re.fullmatch(r'[a-f0-9]{32}', pid):
        raise ValueError('Invalid project ID.')
    path = DATA / pid
    path.mkdir(exist_ok=True)
    return path


def get_project(pid):
    with connect() as db:
        row = db.execute('SELECT body FROM projects WHERE id=?', (pid,)).fetchone()
    if row is None:
        raise ValueError('Project not found.')
    return json.loads(row['body'])


def list_projects():
    with connect() as db:
        return [json.loads(r['body']) for r in db.execute('SELECT body FROM projects ORDER BY rowid DESC')]


def update(pid, **changes):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT body FROM projects WHERE id=?', (pid,)).fetchone()
        if row is None:
            raise ValueError('Project not found.')
        body = json.loads(row['body'])
        body.update(changes)
        db.execute('UPDATE projects SET body=? WHERE id=?', (json.dumps(body, ensure_ascii=False), pid))
    return body


def claim(pid, status, message):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT body FROM projects WHERE id=?', (pid,)).fetchone()
        if row is None:
            raise ValueError('Project not found.')
        p = json.loads(row['body'])
        if p['status'] in ('queued', 'processing', 'rendering'):
            raise ValueError('This project is already processing.')
        p.update(status=status, message=message, error=None)
        db.execute('UPDATE projects SET body=? WHERE id=?', (json.dumps(p), pid))
    return p


def create_project(name, source, language='auto', quality='base', demo=False, vocabulary=''):
    pid = uuid.uuid4().hex
    dest = folder(pid) / ('source' + source.suffix.lower())
    source.replace(dest)
    try:
        with av.open(str(dest)) as media:
            videos = media.streams.video
            if not videos:
                raise ValueError('Please upload a video file.')
            stream = videos[0]
            duration = float(media.duration / av.time_base) if media.duration else float((stream.duration or 0) * stream.time_base)
            if not math.isfinite(duration) or not 0.2 <= duration <= 600:
                raise ValueError('Use a video between 1 second and 10 minutes.')
            if stream.width * stream.height > 3840 * 2160:
                raise ValueError('Maximum video resolution is 4K.')
            has_audio = bool(media.streams.audio)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    p = dict(id=pid, name=name[:160], source=dest.name, duration=round(duration, 3), language=language, vocabulary=vocabulary[:1000],
             quality=quality, demo=demo, has_audio=has_audio, status='uploaded', progress=0,
             message='Ready to process', segments=[], clips=[], exports=[], error=None)
    with connect() as db:
        db.execute('INSERT INTO projects VALUES (?,?)', (pid, json.dumps(p)))
    return p


def ffmpeg(args, cwd=None, timeout=900):
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', *args]
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    result = subprocess.run(command, cwd=cwd, capture_output=True, timeout=timeout, creationflags=creationflags)
    if result.returncode:
        raise RuntimeError('Video processing failed: ' + result.stderr.decode('utf8', 'replace')[-1000:])


def validate_segments(segments, duration):
    if len(segments) > 2000:
        raise ValueError('Too many caption segments.')
    clean = []
    previous = 0
    for s in segments:
        start, end = float(s['start']), float(s['end'])
        text = str(s['text']).strip()
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration + .05 and start >= previous):
            raise ValueError('Caption times must be ordered and within the video.')
        if len(text) > 500:
            raise ValueError('Each caption must be under 500 characters.')
        if text:
            clean.append(dict(start=round(start, 3), end=round(min(end, duration), 3), text=text))
        previous = end
    return clean


def suggestions(segments, duration, length=30):
    """Deterministic transcript windows, not engagement predictions."""
    if not segments:
        return [dict(id=uuid.uuid4().hex[:10], start=0, end=min(duration, length), title='Your first clip')]
    candidates = []
    cursor = 0.0
    for s in segments:
        if s['start'] < cursor:
            continue
        start = s['start']
        group = [x for x in segments if x['start'] >= start and x['end'] <= min(duration, start + length)]
        end = group[-1]['end'] if group else min(duration, start + length)
        if end - start < 3 and duration > 3:
            continue
        candidates.append(dict(id=uuid.uuid4().hex[:10], start=start, end=end,
                               title=s['text'][:85].strip() or 'Suggested clip'))
        cursor = end
        if len(candidates) >= 3:
            break
    return candidates or [dict(id=uuid.uuid4().hex[:10], start=0, end=min(duration, length), title='Your first clip')]


def process(pid):
    try:
        p = get_project(pid)
        d = folder(pid)
        update(pid, status='processing', progress=5, message='Preparing video preview…')
        ffmpeg(['-i', str(d / p['source']), '-vf', 'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-movflags', '+faststart', str(d / 'preview.mp4')])
        ffmpeg(['-i', str(d / 'preview.mp4'), '-frames:v', '1', str(d / 'thumb.jpg')])
        if p['demo']:
            segments = demo_segments()
            detected = 'en'
        elif p['has_audio']:
            update(pid, progress=20, message='Loading local speech model. The first run may download model files…')
            from faster_whisper import WhisperModel
            with MODEL_LOCK:
                if p['quality'] not in MODELS:
                    MODELS[p['quality']] = WhisperModel(p['quality'], device='cpu', compute_type='int8',
                                                       cpu_threads=4, download_root=str(DATA / 'models'))
                model = MODELS[p['quality']]
            update(pid, progress=30, message='Creating captions on this computer…')
            mixed = p['language'] == 'mixed'
            prompt = ('This speech may switch between Tamil and English. Preserve Tamil words in Tamil script and English words in English script. ' if mixed else '') + p.get('vocabulary', '')
            generated, info = model.transcribe(str(d / p['source']), language=None if p['language'] in ('auto', 'mixed') else p['language'],
                                               vad_filter=True, beam_size=5, word_timestamps=True,
                                               initial_prompt=prompt or None, hotwords=p.get('vocabulary') or None,
                                               condition_on_previous_text=False)
            segments = []
            for segment in generated:
                # Short caption groups keep vertical video readable.
                words = segment.words or []
                if words:
                    for offset in range(0, len(words), 7):
                        group = words[offset:offset + 7]
                        a, b = max(0, group[0].start), min(p['duration'], group[-1].end)
                        if b > a:
                            segments.append(dict(start=a, end=b, text=''.join(w.word for w in group).strip()))
                elif segment.end > segment.start:
                    segments.append(dict(start=max(0, segment.start), end=min(p['duration'], segment.end), text=segment.text.strip()))
                update(pid, progress=min(90, int(30 + 60 * segment.end / p['duration'])), message='Transcribing speech…')
            # Word alignments can overlap at model boundaries; trim before editing.
            normalized = []
            for s in segments:
                s['start'] = max(s['start'], normalized[-1]['end'] if normalized else 0)
                if s['end'] > s['start'] and s['text']:
                    normalized.append(s)
            segments = validate_segments(normalized, p['duration'])
            detected = info.language
        else:
            segments, detected = [], p['language']
        update(pid, status='ready', progress=100, segments=segments, detected_language=detected,
               clips=suggestions(segments, p['duration']), message='Ready to edit' if segments else 'No speech found. You can still trim and export.', error=None)
    except Exception as exc:
        update(pid, status='error', message='Processing stopped. You can retry.', error=str(exc)[:1200])


def start_processing(pid):
    claim(pid, 'queued', 'Waiting for the local processor…')
    POOL.submit(process, pid)


def srt_time(seconds):
    ms = max(0, round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'


def make_srt(segments, start, end):
    rows = []
    for s in segments:
        a, b = max(start, s['start']), min(end, s['end'])
        if b <= a:
            continue
        # Plain text only: avoid subtitle markup controlling formatting.
        text = re.sub(r'[<>\\{}]', '', s['text']).replace('\r', ' ').replace('\n', ' ')
        rows.append(f'{len(rows)+1}\n{srt_time(a-start)} --> {srt_time(b-start)}\n{text}\n')
    return '\n'.join(rows)


def validate_clip(start, end, duration):
    if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration + .01):
        raise ValueError('Choose a valid range within this video.')
    if end - start > 90:
        raise ValueError('Keep each clip at 90 seconds or less.')


def render(pid, spec):
    p = get_project(pid)
    d = folder(pid)
    eid = uuid.uuid4().hex
    try:
        update(pid, message='Rendering your vertical clip…', progress=10)
        subtitle = d / (eid + '.srt')
        subtitle.write_text(make_srt(p['segments'], spec['start'], spec['end']), encoding='utf-8')
        if spec['framing'] == 'crop':
            vf = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280'
        else:
            vf = 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x121216'
        if spec['captions'] and subtitle.stat().st_size:
            colors = {'clean': '&H00FFFFFF', 'bold': '&H0058D9FF', 'mint': '&H00C9E8A3', 'coral': '&H0087A1FF', 'lavender': '&H00F0C6D9', 'sky': '&H00F2D6A0'}
            primary = colors[spec['style']]
            vf += f",subtitles={subtitle.name}:force_style='FontName=Nirmala UI,FontSize=20,PrimaryColour={primary},OutlineColour=&H00101010,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=40'"
        ffmpeg(['-ss', str(spec['start']), '-i', p['source'], '-t', str(spec['end'] - spec['start']),
                '-vf', vf, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', eid + '.mp4'], cwd=d)
        exports = get_project(pid)['exports']
        exports.append(dict(id=eid, title=spec['title'], start=spec['start'], end=spec['end'], file=eid + '.mp4', captions=eid + '.srt'))
        update(pid, exports=exports, status='ready', progress=100, message='Your clip is ready to download.', error=None)
    except Exception as exc:
        update(pid, status='error', message='Export failed. Your edits are saved.', error=str(exc)[:1200])


def start_render(pid, spec):
    p = get_project(pid)
    validate_clip(spec['start'], spec['end'], p['duration'])
    if spec['framing'] not in ('fit', 'crop') or spec['style'] not in ('clean', 'bold', 'mint', 'coral', 'lavender', 'sky'):
        raise ValueError('Invalid export setting.')
    claim(pid, 'rendering', 'Waiting to render…')
    POOL.submit(render, pid, spec)


def demo_segments():
    return [dict(start=0, end=3, text='A little idea. A new beginning.'),
            dict(start=3, end=6, text='Make room for your next story.'),
            dict(start=6, end=9, text='Shape it. Caption it. Share it.'),
            dict(start=9, end=12, text='Made with Cliploom.')]


def create_demo():
    temp = DATA / ('demo-' + uuid.uuid4().hex + '.mp4')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100',
            '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(temp)])
    p = create_project('A little idea · demo', temp, demo=True)
    start_processing(p['id'])
    return p
