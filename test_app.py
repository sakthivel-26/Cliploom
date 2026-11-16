import io
import json
import math
import time
from types import SimpleNamespace

import av
import pytest
from fastapi.testclient import TestClient

import app
import core


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'DATA', tmp_path)
    monkeypatch.setattr(core, 'DB', tmp_path / 'projects.sqlite3')
    with TestClient(app.app) as c:
        yield c
    # All submitted work finishes before the temporary directory changes.
    core.POOL.submit(lambda: None).result(timeout=120)


def settle(pid):
    for _ in range(600):
        p = core.get_project(pid)
        if p['status'] not in ('queued','processing','rendering'):
            return p
        time.sleep(.1)
    raise AssertionError('Job timed out')


def test_demo_edit_export_and_download(client):
    p = client.post('/api/demo', headers={'X-Cliploom':'1'}).json()
    p = settle(p['id'])
    assert p['status'] == 'ready', p
    assert p['demo'] and len(p['segments']) == 4
    segments = p['segments']
    segments[0]['text'] = 'Hello from Cliploom'
    r = client.put(f'/api/projects/{p["id"]}/captions', json={'segments':segments}, headers={'X-Cliploom':'1'})
    assert r.status_code == 200
    r = client.post(f'/api/projects/{p["id"]}/render', headers={'X-Cliploom':'1'}, json={'start':1,'end':5,'title':'Test export','framing':'fit','captions':True,'style':'bold'})
    assert r.status_code == 200, r.text
    done = settle(p['id'])
    assert done['status'] == 'ready', done
    export = done['exports'][0]
    with av.open(str(core.folder(p['id']) / export['file'])) as media:
        assert (media.streams.video[0].width, media.streams.video[0].height) == (720,1280)
        assert abs(media.duration/av.time_base-4) < .3
        assert next(media.decode(video=0))
    result = client.get(f'/media/{p["id"]}/{export["file"]}?download=true')
    assert result.status_code == 200 and len(result.content)>1000
    assert 'attachment' in result.headers['content-disposition']
    srt = client.get(f'/media/{p["id"]}/{export["captions"]}').text
    assert '00:00:00,000 --> 00:00:02,000' in srt
    assert 'Hello from Cliploom' in srt
    assert client.get(f'/media/{p["id"]}/{p["source"]}').status_code==404


def test_upload_silent_video_and_reject_invalid_input(client, tmp_path):
    source = tmp_path/'silent.mp4'
    core.ffmpeg(['-f','lavfi','-i','color=c=red:s=320x180:r=24','-t','2','-c:v','libx264',str(source)])
    r = client.post('/api/projects',headers={'X-Cliploom':'1'},files={'file':('silent.mp4',source.read_bytes(),'video/mp4')})
    assert r.status_code==200,r.text
    p=settle(r.json()['id'])
    assert p['status']=='ready' and p['segments']==[]
    assert client.post('/api/projects',headers={'X-Cliploom':'1'},files={'file':('bad.mp4',b'not a video')}).status_code==400
    assert client.post('/api/projects',headers={'X-Cliploom':'1'},files={'file':('empty.mp4',b'')}).status_code==400


def test_request_boundaries(client):
    assert client.get('/').status_code==200
    assert client.post('/api/demo').status_code==403
    assert client.post('/api/demo',headers={'X-Cliploom':'1','Origin':'https://evil.example'}).status_code==403
    assert client.get('/api/projects',headers={'Host':'evil.example'}).status_code==403
    assert client.get('/static/app.py').status_code==404
    assert client.get('/api/projects/unknown').status_code==400


def test_caption_boundaries_and_relative_timing():
    with pytest.raises(ValueError):
        core.validate_segments([{'start':0,'end':2,'text':'a'},{'start':1,'end':3,'text':'b'}],10)
    with pytest.raises(ValueError):
        core.validate_segments([{'start':float('nan'),'end':2,'text':'a'}],10)
    with pytest.raises(ValueError):
        core.validate_clip(0,91,100)
    with pytest.raises(ValueError):
        core.validate_clip(-1,5,10)
    out=core.make_srt([{'start':0,'end':3,'text':'hello'},{'start':3,'end':6,'text':'world'}],2,5)
    assert '00:00:00,000 --> 00:00:01,000' in out
    assert '00:00:01,000 --> 00:00:03,000' in out


def test_job_claim_prevents_duplicate_and_restart_recovers(client):
    source=core.DATA/'tiny.mp4'
    core.ffmpeg(['-f','lavfi','-i','color=c=blue:s=32x32:r=24','-t','1','-c:v','libx264',str(source)])
    p=core.create_project('one',source)
    core.claim(p['id'],'rendering','busy')
    with pytest.raises(ValueError):
        core.claim(p['id'],'processing','duplicate')
    core.init_store()
    assert core.get_project(p['id'])['status']=='error'


def test_english_upload_preserves_custom_words_and_rejects_old_options(client, tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'process', lambda pid: None)
    source = tmp_path/'spoken.mp4'
    core.ffmpeg(['-f','lavfi','-i','color=c=red:s=320x180:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','2','-c:v','libx264','-c:a','aac',str(source)])
    upload = {'file':('spoken.mp4',source.read_bytes(),'video/mp4')}
    r = client.post('/api/projects', headers={'X-Cliploom':'1'},
                    data={'language':'en','quality':'distil-large-v3','vocabulary':'Cliploom, FastAPI'}, files=upload)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p['language']=='en' and p['quality']=='distil-large-v3'
    assert p['vocabulary']=='Cliploom, FastAPI'
    assert core.get_project(p['id'])['vocabulary']==p['vocabulary']
    for language in ('auto', 'ta', 'mixed'):
        rejected = client.post('/api/projects', headers={'X-Cliploom':'1'},
                               data={'language':language,'quality':'small.en'}, files=upload)
        assert rejected.status_code == 400
    rejected = client.post('/api/projects', headers={'X-Cliploom':'1'},
                           data={'language':'en','quality':'small'}, files=upload)
    assert rejected.status_code == 400


def test_status_lists_english_models(client):
    data = client.get('/api/status').json()
    assert data['models'] == ['small.en', 'medium.en', 'distil-large-v3', 'large-v3']


def test_audio_preprocessing_creates_16khz_mono_wav(tmp_path):
    source = tmp_path / 'speech-source.mp4'
    cleaned = tmp_path / 'cleaned.wav'
    core.ffmpeg(['-f','lavfi','-i','color=c=black:s=160x90:r=24',
                 '-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
                 '-t','2','-c:v','libx264','-c:a','aac',str(source)])
    core.prepare_audio(source, cleaned)
    with av.open(str(cleaned)) as media:
        stream = media.streams.audio[0]
        assert stream.codec_context.sample_rate == 16000
        assert stream.codec_context.channels == 1


def test_caption_groups_are_readable_and_keep_word_confidence():
    text = 'Accurate English captions should break naturally at punctuation and quiet pauses.'
    words = [SimpleNamespace(start=i * .45, end=i * .45 + .35, word=' ' + word,
                             probability=.35 if word == 'naturally' else .9)
             for i, word in enumerate(text.split())]
    segments = core.caption_segments_from_words(words, 10)
    assert segments
    for segment in segments:
        assert 1 <= segment['end'] - segment['start'] <= 6
        assert len(segment['text'].splitlines()) <= 2
        assert all(len(line) <= 42 for line in segment['text'].splitlines())
    uncertain = [word for segment in segments for word in segment['words'] if word['probability'] < .5]
    assert len(uncertain) == 1
    assert uncertain[0]['word'] == 'naturally'
