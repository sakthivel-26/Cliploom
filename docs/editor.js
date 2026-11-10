const $ = selector => document.querySelector(selector);
const video = $('#video');
const overlay = $('#caption-overlay');
const colors = ['#ffffff', '#ffda58', '#a3e8c9', '#ffa187', '#d9c6f0', '#a0d6f2'];
let mediaFile = null;
let mediaUrl = null;
let captions = [];
let duration = 0;
let db = null;
let saveTimer = null;
let activeExport = null;
let installEvent = null;

function message(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(message.timer);
  message.timer = setTimeout(() => $('#toast').hidden = true, 5500);
}
function timecode(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds / 60000) % 60;
  const secs = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}
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
      input.addEventListener('input', () => { caption[key] = Number(input.value); scheduleSave(); drawOverlay(); });
      label.append(input); top.append(label);
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
  overlay.style.color = colors.includes($('#colour').value) ? $('#colour').value : colors[1];
  overlay.style.fontSize = `${$('#size').value}px`;
  overlay.style.textShadow = $('#shadow').checked ? '0 2px 2px #000,2px 0 2px #000,-2px 0 2px #000,0 -2px 2px #000' : '0 2px 6px #0008';
  $('#size-value').textContent = $('#size').value;
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
    transaction.oncomplete = () => resolve(meta.result ? { ...meta.result, file: file.result || legacy.result?.file } : legacy.result);
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
function writeFile(file) {
  return new Promise((resolve, reject) => {
    if (!db) { resolve(); return; }
    const transaction = db.transaction('project', 'readwrite');
    transaction.objectStore('project').put(file, 'current-file');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await writeProject({ captions, color: $('#colour').value, size: $('#size').value, shadow: $('#shadow').checked }); }
    catch { message('Browser storage is full. Download your captions before leaving.'); }
  }, 500);
}
async function loadVideo(file, persist = true) {
  if (!file || (!file.type.startsWith('video/') && !/\.(mp4|mov|webm)$/i.test(file.name || ''))) { message('Choose a video supported by this browser.'); return; }
  if (file.size > 200 * 1024 * 1024) { message('Choose a video under 200 MB for browser editing.'); return; }
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaFile = file;
  mediaUrl = URL.createObjectURL(file);
  video.src = mediaUrl;
  $('#drop').hidden = true;
  $('#player-wrap').hidden = false;
  $('#video-details').hidden = false;
  $('#filename').textContent = file.name || 'Your video';
  video.load();
  scheduleSave();
  if (persist) {
    try { await writeFile(file); }
    catch { message('Video could not be saved in browser storage. Keep this tab open and download your work.'); }
  }
}
$('#file').onchange = event => { const file = event.target.files[0]; if (file) loadVideo(file); };
$('#replace').onclick = () => $('#file').click();
['dragover', 'dragenter'].forEach(type => $('#drop').addEventListener(type, event => { event.preventDefault(); $('#drop').classList.add('drag'); }));
['dragleave', 'drop'].forEach(type => $('#drop').addEventListener(type, event => { event.preventDefault(); $('#drop').classList.remove('drag'); }));
$('#drop').addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file) loadVideo(file); });
video.onloadedmetadata = () => { duration = video.duration; $('#duration').textContent = Number.isFinite(duration) ? `${duration.toFixed(1)} seconds` : ''; drawOverlay(); };
video.ontimeupdate = drawOverlay;
video.onerror = () => message('This browser cannot play the selected video. Try an MP4 with H.264 video.');
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
for (const selector of ['#colour', '#size', '#shadow']) $('#'+selector.slice(1)).addEventListener('input', () => { drawOverlay(); scheduleSave(); });
$('#srt').onclick = () => {
  try {
    const lines = cleanCaptions();
    if (!lines.length) throw Error('Add a caption line before downloading SRT.');
    const body = lines.map((line, index) => `${index + 1}\n${timecode(line.start)} --> ${timecode(line.end)}\n${line.text}\n`).join('\n');
    download(new Blob(['\uFEFF', body], { type: 'text/plain;charset=utf-8' }), 'cliploom-subtitles.srt');
  } catch (error) { message(error.message); }
};
function drawCanvasFrame(canvas, context, lines) {
  const w = canvas.width, h = canvas.height;
  context.fillStyle = '#141914'; context.fillRect(0, 0, w, h);
  const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
  const vw = video.videoWidth * scale, vh = video.videoHeight * scale;
  context.drawImage(video, (w - vw) / 2, (h - vh) / 2, vw, vh);
  const line = lines.find(c => video.currentTime >= c.start && video.currentTime < c.end);
  if (!line) return;
  context.font = `800 ${Number($('#size').value) * 1.65}px system-ui, sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = $('#colour').value;
  context.lineWidth = $('#shadow').checked ? 8 : 0;
  context.strokeStyle = '#101010'; context.lineJoin = 'round';
  const maxWidth = w * .86;
  const words = line.text.replace(/\s+/g, ' ').trim().split(' ');
  const rows = []; let row = '';
  for (const word of words) {
    const attempt = row ? `${row} ${word}` : word;
    if (row && context.measureText(attempt).width > maxWidth) { rows.push(row); row = word; } else row = attempt;
  }
  if (row) rows.push(row);
  const lineHeight = Number($('#size').value) * 2.1;
  const startY = h * .83 - (rows.length - 1) * lineHeight / 2;
  rows.slice(0, 5).forEach((text, index) => {
    const y = startY + index * lineHeight;
    if (context.lineWidth) context.strokeText(text, w / 2, y, maxWidth);
    context.fillText(text, w / 2, y, maxWidth);
  });
}
$('#export').onclick = async () => {
  if (!mediaFile) { message('Choose a video before exporting.'); return; }
  if (!Number.isFinite(duration) || duration <= 0) { message('Wait for the video to load.'); return; }
  if (duration > 180) { message('Online video export is limited to 3 minutes. Download SRT for longer videos.'); return; }
  let lines;
  try { lines = cleanCaptions(); if (!lines.length) throw Error('Add captions before exporting.'); } catch (error) { message(error.message); return; }
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') { message('This browser cannot export video here. Download the SRT instead.'); return; }
  const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { message('This browser has no supported video recorder. Download the SRT instead.'); return; }
  const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
  const context = canvas.getContext('2d');
  if (!context) { message('Video canvas is unavailable on this device.'); return; }
  const stream = canvas.captureStream(30);
  let audioContext = null;
  try {
    if (!video.audioContextSource && (window.AudioContext || window.webkitAudioContext)) {
      video.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      video.audioContextSource = video.audioContext.createMediaElementSource(video);
      video.audioDestination = video.audioContext.createMediaStreamDestination();
      video.audioContextSource.connect(video.audioDestination);
      video.audioContextSource.connect(video.audioContext.destination);
    }
    audioContext = video.audioContext;
    await audioContext?.resume();
    video.audioDestination?.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3000000 });
    const chunks = [];
    let frameId;
    const state = { recorder, stream, cancelled: false, stop: () => {} };
    activeExport = state;
    $('#export').disabled = true; $('#progress-wrap').hidden = false;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { state.cancelled = true; message('Video export failed in this browser. Your captions are still available as SRT.'); };
    recorder.onstop = () => {
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach(track => track.stop());
      $('#progress-wrap').hidden = true; $('#export').disabled = false; activeExport = null;
      if (!state.cancelled && chunks.length) {
        const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
        download(new Blob(chunks, { type: mimeType }), `cliploom-captioned.${extension}`);
        message('Captioned video downloaded.');
      }
    };
    state.stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    const frame = () => {
      if (recorder.state === 'inactive') return;
      if (video.readyState >= 2) drawCanvasFrame(canvas, context, lines);
      const percent = Math.min(100, Math.round(video.currentTime / duration * 100));
      $('#progress').value = percent; $('#progress-label').textContent = `Recording ${percent}% — keep this tab open`;
      frameId = requestAnimationFrame(frame);
    };
    video.pause(); video.currentTime = 0;
    await new Promise(resolve => { if (video.readyState >= 2 && video.currentTime === 0) resolve(); else video.onseeked = resolve; });
    drawCanvasFrame(canvas, context, lines);
    recorder.start(1000); frame();
    video.onended = () => state.stop();
    await video.play();
  } catch (error) {
    if (activeExport) { activeExport.cancelled = true; activeExport.stop(); }
    else { stream.getTracks().forEach(track => track.stop()); $('#progress-wrap').hidden = true; $('#export').disabled = false; }
    message(`Video export could not start: ${error.message}`);
  }
};
$('#cancel').onclick = () => { if (activeExport) { activeExport.cancelled = true; activeExport.stop(); video.pause(); message('Video export cancelled.'); } };
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('#install').hidden = false; });
$('#install').onclick = async () => { if (installEvent) { await installEvent.prompt(); installEvent = null; $('#install').hidden = true; } };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  try {
    db = await openDb();
    const saved = await readProject();
    if (saved) {
      captions = Array.isArray(saved.captions) ? saved.captions : [];
      $('#colour').value = colors.includes(saved.color) ? saved.color : colors[1];
      $('#size').value = saved.size || 34; $('#shadow').checked = saved.shadow !== false;
      drawRows(); drawOverlay();
      if (saved.file instanceof Blob) await loadVideo(saved.file, false);
    }
  } catch { message('Browser storage is unavailable. Download your work before leaving.'); }
})();
drawRows();
