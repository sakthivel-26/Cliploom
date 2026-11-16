const $ = selector => document.querySelector(selector);
const video = $('#video');
const overlay = $('#caption-overlay');
const colors = ['#ffffff', '#ffda58', '#a3e8c9', '#ffa187', '#d9c6f0', '#a0d6f2'];
const MAX_MEDIA_SECONDS = 300;
let mediaFile = null;
let mediaUrl = null;
let captions = [];
let duration = 0;
let db = null;
let saveTimer = null;
let activeExport = null;
let activeAsr = null;
let installEvent = null;
let exportedFile = null;
let exportedUrl = null;
let mediaLoadState = null;

function message(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(message.timer);
  message.timer = setTimeout(() => $('#toast').hidden = true, 5500);
}
function mediaLoadProgress(percent, status, state = 'loading') {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $('#media-load').hidden = false;
  $('#media-load').dataset.state = state;
  $('#media-load-bar').value = value;
  $('#media-load-percent').textContent = `${value}%`;
  $('#media-load-status').textContent = status;
}
function finishMediaLoad() {
  if (!mediaLoadState?.metadata || !mediaLoadState?.stored) return;
  mediaLoadProgress(100, 'Ready — you can generate subtitles now.', 'ready');
  $('#media-load-cancel').hidden = true;
  $('#generate').disabled = false;
}
function timecode(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds / 60000) % 60;
  const secs = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}
function displayTime(seconds) { return timecode(Math.max(0, Number(seconds) || 0)).replace(',', '.'); }
function parseTime(value) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return NaN;
  return (Number(match[1] || 0) * 3600) + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000;
}
function parseSrt(source) {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const result = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const times = lines[index].match(/^\s*(\S+)\s*-->\s*(\S+)/);
    if (!times) continue;
    const start = parseTime(times[1]);
    const end = parseTime(times[2]);
    const text = lines.slice(index + 1).join('\n').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) result.push({ start, end, text });
  }
  return result.sort((a, b) => a.start - b.start);
}
function cleanCaptions() {
  const result = captions.map(c => ({ start: Number(c.start), end: Number(c.end), text: String(c.text || '').trim() })).filter(c => c.text);
  for (const c of result) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || (duration && c.end > duration + .1)) {
      throw Error('Check the caption times. Each line needs a valid start and end within the video.');
    }
  }
  return result.sort((a, b) => a.start - b.start);
}
function drawRows() {
  const target = $('#rows');
  target.replaceChildren();
  if (!captions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Start with a line or import an SRT file.';
    target.append(empty);
    return;
  }
  captions.forEach((caption, index) => {
    const row = document.createElement('div');
    row.className = 'row';
    const top = document.createElement('div');
    top.className = 'row-top';
    for (const key of ['start', 'end']) {
      const label = document.createElement('label');
      label.textContent = key === 'start' ? 'START (SEC)' : 'END (SEC)';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.step = '0.1'; input.inputMode = 'decimal'; input.value = String(caption[key]);
      const readable = document.createElement('span'); readable.className = 'row-time'; readable.textContent = displayTime(caption[key]);
      input.addEventListener('input', () => { caption[key] = Number(input.value); readable.textContent = displayTime(caption[key]); scheduleSave(); drawOverlay(); });
      label.append(input, readable); top.append(label);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.title = 'Delete line'; remove.setAttribute('aria-label', `Delete caption ${index + 1}`); remove.textContent = '×';
    remove.onclick = () => { captions.splice(index, 1); drawRows(); scheduleSave(); drawOverlay(); };
    top.append(remove);
    const text = document.createElement('textarea');
    text.maxLength = 500; text.placeholder = 'Type your subtitle here…'; text.setAttribute('aria-label', `Caption ${index + 1}`); text.value = caption.text;
    text.addEventListener('input', () => { caption.text = text.value; scheduleSave(); drawOverlay(); });
    const seek = document.createElement('button');
    seek.className = 'text-button'; seek.style.fontSize = '12px'; seek.textContent = '▶ Preview from here';
    seek.onclick = () => { if (mediaFile) { video.currentTime = Math.max(0, Number(caption.start) || 0); video.play().catch(() => {}); } };
    row.append(top, text, seek); target.append(row);
  });
}
function drawOverlay() {
  const line = captions.find(c => video.currentTime >= Number(c.start) && video.currentTime < Number(c.end));
  overlay.textContent = line?.text || '';
  overlay.style.display = line?.text ? 'block' : 'none';
  overlay.style.color = $('#colour').value === 'custom' ? $('#custom-colour').value : (colors.includes($('#colour').value) ? $('#colour').value : colors[1]);
  const rect = videoContentRect();
  overlay.style.fontSize = `${Number($('#size').value) * rect.width / 720}px`;
  const box = overlay.getBoundingClientRect();
  const x = Math.max(box.width / 2, Math.min(rect.width - box.width / 2, rect.width * Number($('#position-x').value) / 100));
  const y = Math.max(box.height / 2, Math.min(rect.height - box.height / 2, rect.height * Number($('#position-y').value) / 100));
  overlay.style.left = `${rect.left + x}px`; overlay.style.top = `${rect.top + y}px`;
  overlay.style.maxWidth = `${rect.width * .86}px`;
  const outline = Number($('#size').value) * rect.width / 720 / 18;
  overlay.style.textShadow = $('#shadow').checked ? `0 ${outline}px ${outline}px #000,${outline}px 0 ${outline}px #000,-${outline}px 0 ${outline}px #000,0 -${outline}px ${outline}px #000` : 'none';
  $('#size-value').textContent = `${$('#size').value} px`;
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function selectAudioChannel(buffer, mode = 'auto') {
  const channels = Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  if (channels.length === 1) return channels[0].slice();
  if (mode === 'left') return channels[0].slice();
  if (mode === 'right') return channels[1].slice();
  const mixed = new Float32Array(buffer.length);
  const energies = channels.map(()=>0); let mixEnergy = 0;
  for (let i=0;i<buffer.length;i++) {
    for (let c=0;c<channels.length;c++) { mixed[i]+=channels[c][i]/channels.length; energies[c]+=channels[c][i]**2; }
    mixEnergy+=mixed[i]**2;
  }
  const loudest = energies.indexOf(Math.max(...energies));
  // Opposite-phase stereo can erase speech when averaged. Keep a source channel instead.
  if (mode === 'auto' && mixEnergy < energies[loudest]*.1) return channels[loudest].slice();
  return mixed;
}
async function decodeVideoAudio(file) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Audio || !Offline) throw Error('This browser cannot prepare audio for transcription.');
  const context = new Audio();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!decoded.length) throw Error('No audio was found in this file.');
    const samples = selectAudioChannel(decoded, $('#audio-channel').value);
    const offline = new Offline(1,Math.ceil(decoded.length*16000/decoded.sampleRate),16000);
    const mono = offline.createBuffer(1,samples.length,decoded.sampleRate);
    mono.copyToChannel(samples,0);
    const source = offline.createBufferSource(); source.buffer=mono; source.connect(offline.destination); source.start();
    const rendered=await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally { await context.close(); }
}
function asrStatus(text, percent) {
  $('#asr-status').textContent = text;
  if (Number.isFinite(percent)) $('#asr-bar').value = Math.max(0, Math.min(100, percent));
}
function asrResult(text, failed = false) {
  $('#asr-result').textContent = text;
  $('#asr-result').hidden = !text;
  $('#asr-result').dataset.error = String(failed);
}
function finishAsr() {
  $('#generate').disabled = false;
  $('#asr-progress').hidden = true;
  activeAsr = null;
  document.body.classList.remove('transcribing');
}
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cliploom-online', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('project');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function readProject() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('project');
    const store = transaction.objectStore('project');
    const meta = store.get('current-meta');
    const file = store.get('current-file');
    const legacy = store.get('current');
    transaction.oncomplete = () => resolve(meta.result ? { ...meta.result, file: file.result !== undefined ? file.result : legacy.result?.file } : legacy.result);
    transaction.onerror = () => reject(transaction.error);
  });
}
function writeProject(project) {
  return new Promise((resolve, reject) => {
    if (!db) { resolve(); return; }
    const transaction = db.transaction('project', 'readwrite');
    transaction.objectStore('project').put(project, 'current-meta');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function writeFile(file, signal) {
  return new Promise((resolve, reject) => {
    if (!db) { resolve(); return; }
    if (signal?.aborted) { reject(new DOMException('Video preparation cancelled.', 'AbortError')); return; }
    const transaction = db.transaction('project', 'readwrite');
    transaction.objectStore('project').put(file, 'current-file');
    const abort = () => { try { transaction.abort(); } catch {} };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    transaction.oncomplete = () => { cleanup(); resolve(); };
    transaction.onerror = () => { cleanup(); reject(transaction.error); };
    transaction.onabort = () => { cleanup(); reject(transaction.error || new DOMException('Video preparation cancelled.', 'AbortError')); };
  });
}
function scheduleSave() {
  invalidateExport();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await writeProject({ captions, color: $('#colour').value, customColor: $('#custom-colour').value, size: $('#size').value, positionX: $('#position-x').value, positionY: $('#position-y').value, shadow: $('#shadow').checked, cropRatio: $('#crop-ratio').value, cropX: $('#crop-x').value, cropY: $('#crop-y').value, speechModel: $('#speech-model').value, speechLanguage: $('#speech-language').value, audioChannel: $('#audio-channel').value }); }
    catch { message('Browser storage is full. Download your captions before leaving.'); }
  }, 500);
}
async function loadVideo(file, persist = true) {
  if (activeExport) { message("Cancel the export before replacing the media."); return; }
  if (!file || (!file.type.startsWith('video/') && !file.type.startsWith('audio/') && !/\.(mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(file.name || ''))) { message('Choose a video supported by this browser.'); return; }
  if (file.size > 200 * 1024 * 1024) { message('Choose a video under 200 MB for browser editing.'); return; }
  if (activeAsr) $('#asr-cancel').click();
  mediaLoadState?.controller.abort();
  const loadState = { metadata: false, stored: !persist, controller: new AbortController() };
  mediaLoadState = loadState;
  $('#generate').disabled = true;
  $('#media-load-cancel').hidden = false;
  mediaLoadProgress(10, 'Opening the selected file…');
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaFile = file;
  duration = 0;
  if (persist) { captions = []; drawRows(); }
  mediaUrl = URL.createObjectURL(file);
  video.src = mediaUrl;
  $('#drop').hidden = true;
  $('#player-wrap').hidden = false;
  $('#video-details').hidden = false;
  $('#filename').textContent = file.name || 'Your video';
  video.load();
  scheduleSave();
  if (persist) {
    mediaLoadProgress(70, 'Saving a local draft in this browser…');
    try { await writeFile(file, loadState.controller.signal); }
    catch (error) {
      if (error?.name !== 'AbortError') message('Video could not be saved in browser storage. Keep this tab open and download your work.');
    }
    finally {
      if (mediaLoadState === loadState) {
        loadState.stored = true;
        mediaLoadProgress(loadState.metadata ? 95 : 85, loadState.metadata ? 'Finishing the local preview…' : 'Waiting for the video preview…');
        finishMediaLoad();
      }
    }
  }
  finishMediaLoad();
}
$('#media-load-cancel').onclick = () => {
  const state = mediaLoadState;
  if (!state) return;
  state.controller.abort();
  mediaLoadState = null;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = null; mediaFile = null; duration = 0; captions = [];
  video.pause(); video.removeAttribute('src'); video.load();
  $('#file').value = '';
  $('#drop').hidden = false;
  $('#player-wrap').hidden = true;
  $('#video-details').hidden = true;
  $('#media-load').hidden = true;
  $('#filename').textContent = '';
  $('#duration').textContent = '';
  $('#generate').disabled = true;
  drawRows(); drawOverlay();
  writeFile(null).catch(() => {});
  message('Video preparation cancelled. Nothing was uploaded.');
};
$('#file').onchange = event => { const file = event.target.files[0]; if (file) loadVideo(file); };
$('#replace').onclick = () => $('#file').click();
['dragover', 'dragenter'].forEach(type => $('#drop').addEventListener(type, event => { event.preventDefault(); $('#drop').classList.add('drag'); }));
['dragleave', 'drop'].forEach(type => $('#drop').addEventListener(type, event => { event.preventDefault(); $('#drop').classList.remove('drag'); }));
$('#drop').addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file) loadVideo(file); });
video.onloadedmetadata = () => {
  duration = video.duration;
  $('#duration').textContent = Number.isFinite(duration) ? `${duration.toFixed(1)} seconds` : '';
  if (mediaLoadState) {
    mediaLoadState.metadata = Number.isFinite(duration) && duration > 0;
    mediaLoadProgress(mediaLoadState.stored ? 95 : 75, mediaLoadState.stored ? 'Finishing the local preview…' : 'Preview ready. Saving your local draft…');
    finishMediaLoad();
  }
  updateCrop(); drawOverlay();
};
video.ontimeupdate = drawOverlay;
video.addEventListener('seeked', drawOverlay);
video.onerror = () => {
  if (!mediaFile) return;
  mediaLoadProgress(0, 'This browser could not open the selected video.', 'error');
  $('#generate').disabled = true;
  message('This browser cannot play the selected video. Try an MP4 with H.264 video.');
};
$('#generate').onclick = async () => {
  if (!mediaFile) { message('Choose a video before generating subtitles.'); return; }
  if (!Number.isFinite(duration) || duration <= 0) { message('Wait for the video to load.'); return; }
  if (duration > MAX_MEDIA_SECONDS) { message('Automatic subtitles currently support videos up to 5 minutes in the browser.'); return; }
  if (captions.some(c => c.text.trim()) && !confirm('Replace the current captions with automatically generated ones?')) return;
  if (activeAsr || activeExport) return;
  const state = { cancelled: false, worker: null, model: $('#speech-model').value, language: $('#speech-language').value, mode: $('#content-type').value };
  activeAsr = state;
  document.body.classList.add('transcribing');
  $('#asr-retry').hidden = true;
  $('#generate').disabled = true;
  $('#asr-progress').hidden = false;
  asrResult('');
  asrStatus('Extracting speech audio from your video…', 0);
  try {
    const audio = await decodeVideoAudio(mediaFile);
    if (state.cancelled) return;
    asrStatus('Loading the speech model. First use needs a download…', 0);
    const worker = new Worker('asr-worker.js', { type: 'module' });
    state.worker = worker;
    const result = await new Promise((resolve, reject) => {
      state.reject = reject;
      worker.onmessage = event => {
        const data = event.data || {};
        if (data.type === 'done') resolve(data.segments);
        else if (data.type === 'error') reject(Error(data.message));
        else if (data.type === 'progress') {
          if (data.stage === 'download') asrStatus(`Downloading speech model ${data.percent}%…`, Math.min(70, data.percent * .7));
          else if (data.stage === 'transcribing') asrStatus('Transcribing speech and aligning captions. This can take several minutes…', 75);
          else if (data.stage === 'loading') asrStatus('Loading multilingual speech model…', 0);
        }
      };
      worker.onerror = event => reject(Error(event.message ? `The browser stopped transcription: ${event.message}. Try Base or a shorter clip.` : 'The browser stopped the model. Try Whisper Base, close other tabs, or use a shorter clip.'));
      worker.onmessageerror = () => reject(Error('The browser could not read the model result. Retry with Base or reload the page.'));
      worker.postMessage({ audio, model: state.model, mode: state.mode, language: state.language }, [audio.buffer]);
    });
    if (state.cancelled) return;
    if (!result.length) throw Error('No speech was detected. Try a clearer recording or add captions manually.');
    captions = result;
    video.pause();
    video.currentTime = 0;
    drawRows(); drawOverlay(); scheduleSave();
    asrResult(`Generated ${captions.length} subtitle lines with Whisper ${state.model} (${state.language}). Review words and timing before exporting.`);
    message(`Generated ${captions.length} subtitle lines. Review and correct them before exporting.`);
  } catch (error) {
    if (!state.cancelled) { $('#asr-retry').hidden = state.model !== 'small'; asrResult(error.message || 'Automatic subtitles failed.', true); message(error.message || 'Automatic subtitles failed.'); }
  } finally {
    state.worker?.terminate();
    if (activeAsr === state) finishAsr();
  }
};
$('#asr-cancel').onclick = () => {
  if (!activeAsr) return;
  activeAsr.cancelled = true;
  activeAsr.worker?.terminate();
  activeAsr.reject?.(Error('Transcription cancelled.'));
  finishAsr();
  asrResult('Automatic transcription cancelled.');
  message('Automatic transcription cancelled.');
};
$('#add').onclick = () => { const start = mediaFile ? Math.floor(video.currentTime * 10) / 10 : (captions.at(-1)?.end || 0); captions.push({ start, end: Math.min(duration || Infinity, start + 3), text: '' }); drawRows(); scheduleSave(); };
$('#at-playhead').onclick = () => { if (!mediaFile) { message('Choose a video first.'); return; } $('#add').click(); };
$('#clear').onclick = () => { if (captions.length && !confirm('Clear all caption lines?')) return; captions = []; drawRows(); drawOverlay(); scheduleSave(); };
$('#srt-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { message('Choose an SRT file under 2 MB.'); return; }
  const parsed = parseSrt(await file.text());
  if (!parsed.length) { message('No valid caption lines were found in this SRT.'); return; }
  captions = parsed; drawRows(); drawOverlay(); scheduleSave(); message(`Imported ${parsed.length} caption lines.`);
  event.target.value = '';
};
for (const selector of ['#colour', '#size', '#shadow', '#position-x', '#position-y']) $(selector).addEventListener('input', () => { drawOverlay(); scheduleSave(); });
$('#custom-colour').addEventListener('input', () => { $('#colour').value = 'custom'; drawOverlay(); scheduleSave(); });
$('#apply-timing').onclick = () => {
  const shift = Number($('#timing-offset').value);
  if (!Number.isFinite(shift) || shift < -30 || shift > 30) { message('Enter a timing shift between -30 and 30 seconds.'); return; }
  if (!captions.length || !shift) return;
  if (!Number.isFinite(duration) || duration <= 0) { message('Load a video before shifting caption times.'); return; }
  if (captions.some(c => Number(c.start) + shift < 0 || Number(c.end) + shift > duration)) { message('This shift would move a caption outside the video. Use a smaller value.'); return; }
  captions = captions.map(c => ({ ...c, start: Math.round((Number(c.start) + shift) * 100) / 100, end: Math.round((Number(c.end) + shift) * 100) / 100 }));
  $('#timing-offset').value = '0';
  drawRows(); drawOverlay(); scheduleSave(); message('Subtitle timing shifted.');
};
$('#srt').onclick = () => {
  try {
    const lines = cleanCaptions();
    if (!lines.length) throw Error('Add a caption line before downloading SRT.');
    const body = lines.map((line, index) => `${index + 1}\n${timecode(line.start)} --> ${timecode(line.end)}\n${line.text}\n`).join('\n');
    download(new Blob(['\uFEFF', body], { type: 'text/plain;charset=utf-8' }), 'cliploom-subtitles.srt');
  } catch (error) { message(error.message); }
};
function invalidateExport() {
  if (exportedFile) message('Your edits changed. Create the captioned video again to include them.');
  exportedFile = null;
  if (exportedUrl) URL.revokeObjectURL(exportedUrl);
  exportedUrl = null;
  $('#result-video').removeAttribute('src');
  $('#result-video').load();
  $('#export-result').hidden = true;
}
function seekToStart() {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
    const timer = setTimeout(() => { video.removeEventListener('seeked', done); reject(Error('Could not seek to the start. Try reloading the media.')); }, 10000);
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = 0;
    if (!video.seeking && video.readyState >= 2) done();
  });
}
function drawCanvasFrame(canvas, context, lines, time = video.currentTime, style = getStyle()) {
  return CliploomMedia.draw(canvas, context, video, time, lines, style);
}
async function createCaptionedVideo() {
  if (activeExport || activeAsr) { message('Wait for the current operation to finish.'); return; }
  if (!mediaFile || !Number.isFinite(duration) || duration <= 0) { message('Load a video or audio file first.'); return; }
  if (duration > MAX_MEDIA_SECONDS) { message('Video export supports up to 5 minutes. Download SRT for longer media.'); return; }
  let lines;
  try { lines = cleanCaptions(); if (!lines.length) throw Error('Generate or import subtitles before creating the video.'); }
  catch (error) { message(error.message); return; }
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { message('This browser cannot render video. Try Chrome or download SRT.'); return; }
  const mimeType = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { message('No supported recording format. Download SRT or try another browser.'); return; }
  invalidateExport();
  const style = getStyle(), dimensions = outputDimensions();
  const canvas = $('#export-canvas'); Object.assign(canvas, dimensions);
  const context = canvas.getContext('2d');
  if (!context) { message('Canvas rendering is unavailable.'); return; }
  const state = { cancelled: false, cancel: () => {} };
  activeExport = state;
  const controls = [...document.querySelectorAll('main input, main select, main textarea, main button')].filter(el => el.id !== 'cancel');
  const disabled = controls.map(el => el.disabled);
  controls.forEach(el => el.disabled = true);
  document.body.classList.add('exporting');
  video.controls = false;
  $('#progress-wrap').hidden = false; canvas.hidden = false;
  $('#progress').value = 0; $('#progress-label').textContent = 'Preparing captioned video…';
  let stream, recorder, frameId, videoFrameId, watchdog, hiddenHandler, endedHandler;
  let captionFrames = 0;
  const oldRate = video.playbackRate;
  try {
    await document.fonts.ready;
    if (document.hidden) throw Error('Keep this tab visible while creating the video.');
    video.pause(); video.playbackRate = 1;
    await seekToStart();
    if (!video.audioContextSource) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('Audio recording is unavailable in this browser.');
      video.audioContext = new Audio();
      video.audioContextSource = video.audioContext.createMediaElementSource(video);
      video.audioDestination = video.audioContext.createMediaStreamDestination();
      video.audioContextSource.connect(video.audioDestination);
      video.audioContextSource.connect(video.audioContext.destination);
    }
    await video.audioContext.resume();
    if (state.cancelled) return;
    drawCanvasFrame(canvas, context, lines, 0, style);
    stream = canvas.captureStream(30);
    // Clone audio tracks: stopping an export must not silence future exports.
    video.audioDestination.stream.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || Error('Video encoding failed.'));
    });
    state.cancel = (reason) => {
      state.cancelled = true;
      if (reason) message(reason);
      if (recorder.state !== 'inactive') recorder.stop();
    };
    hiddenHandler = () => { if (document.hidden) state.cancel('Export stopped because the tab was hidden. Keep it visible to render every subtitle.'); };
    document.addEventListener('visibilitychange', hiddenHandler);
    endedHandler = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    video.addEventListener('ended', endedHandler, { once: true });
    const render = (time) => {
      if (recorder.state === 'inactive') return;
      try {
        if (video.readyState >= 2 && drawCanvasFrame(canvas, context, lines, time, style)) captionFrames++;
        $('#progress').value = Math.min(100, time / duration * 100);
        $('#progress-label').textContent = `Rendering subtitles ${Math.round(time / duration * 100)}% — keep this tab visible`;
      } catch (error) { state.cancel(`Rendering failed: ${error.message}`); }
    };
    // Decoded video timestamps drive captions. Audio-only files use the media clock.
    if (video.requestVideoFrameCallback && video.videoWidth) {
      const next = (_, metadata) => { render(metadata.mediaTime); if (recorder.state !== 'inactive') videoFrameId = video.requestVideoFrameCallback(next); };
      videoFrameId = video.requestVideoFrameCallback(next);
    } else {
      const next = () => { render(video.currentTime); if (recorder.state !== 'inactive') frameId = requestAnimationFrame(next); };
      frameId = requestAnimationFrame(next);
    }
    recorder.start(500);
    watchdog = setTimeout(() => state.cancel('Export timed out. Try a shorter clip and keep this tab visible.'), (duration + 30) * 1000);
    await video.play();
    await stopped;
    if (state.cancelled) return;
    if (!captionFrames || !chunks.length) throw Error('No subtitle frames were recorded. Please retry; the original video has not been substituted.');
    const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    exportedFile = new File(chunks, `cliploom-captioned.${extension}`, { type: mimeType.split(';')[0] });
    exportedUrl = URL.createObjectURL(exportedFile);
    $('#result-video').src = exportedUrl;
    $('#result-details').textContent = `${dimensions.width} × ${dimensions.height} · ${extension.toUpperCase()} · ${(exportedFile.size / 1048576).toFixed(1)} MB · Subtitles burned into the video`;
    $('#export-result').hidden = false;
    message('Captioned video ready. Preview it below, then download or share.');
  } catch (error) {
    if (recorder?.state !== 'inactive') { try { recorder?.stop(); } catch {} }
    message(`Could not create captioned video: ${error.message}`);
  } finally {
    clearTimeout(watchdog); cancelAnimationFrame(frameId);
    if (videoFrameId != null) video.cancelVideoFrameCallback?.(videoFrameId);
    if (hiddenHandler) document.removeEventListener('visibilitychange', hiddenHandler);
    if (endedHandler) video.removeEventListener('ended', endedHandler);
    stream?.getTracks().forEach(track => track.stop());
    video.pause(); video.playbackRate = oldRate; video.controls = true;
    controls.forEach((el, index) => el.disabled = disabled[index]);
    activeExport = null; canvas.hidden = true; $('#progress-wrap').hidden = true;
    document.body.classList.remove('exporting');
  }
}
$('#export').onclick = () => { void createCaptionedVideo(); };
$('#cancel').onclick = () => { if (activeExport) { activeExport.cancelled = true; activeExport.cancel('Export cancelled.'); } };
$('#download-video').onclick = () => { if (exportedFile) download(exportedFile, exportedFile.name); };
$('#share-video').onclick = async () => {
  if (!exportedFile) { message('Create the captioned video first.'); return; }
  const data = { files: [exportedFile], title: 'My captioned video' };
  if (!navigator.canShare?.({ files: data.files }) || !navigator.share) { message('File sharing is unavailable here. Download the captioned video and upload it in your social app.'); return; }
  try { await navigator.share(data); }
  catch (error) { message(error.name === 'AbortError' ? 'Sharing cancelled.' : 'Sharing could not open. Download the video and share it from your social app.'); }
};
$('#extract-audio').onclick = async () => {
  if (!mediaFile || !duration || duration > MAX_MEDIA_SECONDS) { message('Choose media up to 5 minutes long to extract audio.'); return; }
  $('#extract-audio').disabled = true;
  let context;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    context = new Audio();
    const buffer = await context.decodeAudioData(await mediaFile.arrayBuffer());
    const channels = buffer.numberOfChannels, size = buffer.length * channels * 2;
    const bytes = new ArrayBuffer(44 + size), view = new DataView(bytes);
    const write = (offset, text) => { for (let i=0; i<text.length; i++) view.setUint8(offset+i,text.charCodeAt(i)); };
    write(0,'RIFF'); view.setUint32(4,36+size,true); write(8,'WAVE'); write(12,'fmt '); view.setUint32(16,16,true);
    view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,buffer.sampleRate,true);
    view.setUint32(28,buffer.sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true);
    write(36,'data'); view.setUint32(40,size,true);
    const samples = Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
    for (let i=0,offset=44;i<buffer.length;i++) for (let ch=0;ch<channels;ch++,offset+=2) {
      const value=Math.max(-1,Math.min(1,samples[ch][i])); view.setInt16(offset,value*(value<0?32768:32767),true);
    }
    download(new Blob([bytes],{type:'audio/wav'}),'cliploom-audio.wav');
  } catch (error) { message(`Could not extract audio: ${error.message}`); }
  finally { context?.close(); $('#extract-audio').disabled = false; }
};

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('#install').hidden = false; });
$('#install').onclick = async () => { if (installEvent) { await installEvent.prompt(); installEvent = null; $('#install').hidden = true; } };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  try {
    db = await openDb();
    const saved = await readProject();
    if (saved) {
      if (['tiny','base','small'].includes(saved.speechModel)) $('#speech-model').value = saved.speechModel;
      $('#speech-language').value = 'english';
      if (['auto','mix','left','right'].includes(saved.audioChannel)) $('#audio-channel').value = saved.audioChannel;
      captions = Array.isArray(saved.captions) ? saved.captions : [];
      $('#colour').value = colors.includes(saved.color) || saved.color === 'custom' ? saved.color : colors[1];
      if (/^#[0-9a-f]{6}$/i.test(saved.customColor || '')) $('#custom-colour').value = saved.customColor;
      $('#crop-ratio').value = ['original','vertical','horizontal','square'].includes(saved.cropRatio) ? saved.cropRatio : 'original';
      $('#crop-x').value = saved.cropX ?? 50; $('#crop-y').value = saved.cropY ?? 50;
      $('#size').value = saved.size || 18;
      $('#position-x').value = saved.positionX ?? 50; $('#position-y').value = saved.positionY ?? 83; $('#shadow').checked = saved.shadow !== false;
      drawRows(); drawOverlay();
      if (saved.file instanceof Blob) await loadVideo(saved.file, false);
    }
  } catch { message('Browser storage is unavailable. Download your work before leaving.'); }
})();
drawRows();

// Coordinates refer to the visible video, excluding fullscreen letterboxing.
function videoContentRect() {
 const box = $('#video-frame').getBoundingClientRect();
 return {left:0, top:0, width:box.width, height:box.height};
}
const stage = $('.video-stage');
$('#fullscreen').onclick = async () => {
 if (document.fullscreenElement) { await document.exitFullscreen(); return; }
 if (stage.classList.contains('expanded')) { stage.classList.remove('expanded'); updateFullscreen(); return; }
 try { if (!stage.requestFullscreen) throw Error(); await stage.requestFullscreen(); }
 catch { stage.classList.add('expanded'); updateFullscreen(); }
};
function updateFullscreen() {
 updateCrop();
 $('#fullscreen').textContent = document.fullscreenElement || stage.classList.contains('expanded') ? 'Exit full screen' : 'Full screen';
 drawOverlay();
}
document.addEventListener('fullscreenchange', updateFullscreen);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { stage.classList.remove('expanded'); updateFullscreen(); } });
new ResizeObserver(() => { updateCrop(); drawOverlay(); }).observe($('#player-wrap'));
window.addEventListener('resize', updateFullscreen);
$('#reset-position').onclick = () => { $('#position-x').value = 50; $('#position-y').value = 83; drawOverlay(); scheduleSave(); };
let dragging = null;
overlay.addEventListener('pointerdown', event => { dragging = event.pointerId; overlay.setPointerCapture(event.pointerId); event.preventDefault(); });
overlay.addEventListener('pointermove', event => {
 if (activeExport) return;
 if (dragging !== event.pointerId) return;
 const box = $('#video-frame').getBoundingClientRect(), rect = videoContentRect();
 $('#position-x').value = Math.max(0, Math.min(100, (event.clientX-box.left-rect.left)/rect.width*100));
 $('#position-y').value = Math.max(0, Math.min(100, (event.clientY-box.top-rect.top)/rect.height*100));
 drawOverlay(); scheduleSave();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) overlay.addEventListener(type, () => dragging = null);
let overlayFrame = 0;
function syncFrame() { drawOverlay(); if (!video.paused && !video.ended) overlayFrame = requestAnimationFrame(syncFrame); }
video.addEventListener('play', () => { cancelAnimationFrame(overlayFrame); syncFrame(); });
video.addEventListener('pause', () => { cancelAnimationFrame(overlayFrame); drawOverlay(); });

function getStyle() {
 return {size:Number($('#size').value),color:$('#colour').value === 'custom' ? $('#custom-colour').value : $('#colour').value,
 shadow:$('#shadow').checked,x:Number($('#position-x').value),y:Number($('#position-y').value),cropX:Number($('#crop-x').value),cropY:Number($('#crop-y').value)};
}
function outputDimensions() { return CliploomMedia.dimensions($('#crop-ratio').value, video.videoWidth, video.videoHeight); }
function updateCrop() {
 const dim = outputDimensions(), aspect = dim.width/dim.height;
 const expanded = document.fullscreenElement || $('.video-stage').classList.contains('expanded');
 const maxW = expanded ? window.innerWidth : $('#player-wrap').clientWidth;
 const maxH = window.innerHeight * (expanded ? 1 : .60);
 const width = Math.min(maxW, maxH*aspect);
 $('#video-frame').style.width = `${width}px`;
 $('#video-frame').style.height = `${width/aspect}px`;
 video.style.objectPosition = `${$('#crop-x').value}% ${$('#crop-y').value}%`;
 drawOverlay();
}
for (const id of ['#crop-ratio','#crop-x','#crop-y']) $(id).addEventListener('input', () => { updateCrop(); scheduleSave(); });
$('#content-type').onchange = () => { $('#song-hint').hidden = $('#content-type').value !== 'song'; };

for (const id of ['#speech-model','#speech-language','#audio-channel']) $(id).addEventListener('change',scheduleSave);

$('#asr-retry').onclick = () => { $('#speech-model').value = 'base'; $('#generate').click(); };
