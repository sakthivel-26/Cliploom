import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
const MODELS = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
};
let currentModel = null;
let transcriber = null;

function progress(event) {
  if (event.status === 'progress' && Number.isFinite(event.progress)) {
    postMessage({ type: 'progress', stage: 'download', percent: Math.round(event.progress), file: event.file || '' });
  } else if (event.status === 'initiate' || event.status === 'done') {
    postMessage({ type: 'progress', stage: 'model', detail: event.status, file: event.file || '' });
  }
}

function groupWords(chunks, duration) {
  const words = chunks.map(chunk => ({
    start: Number(chunk.timestamp?.[0]),
    end: Number(chunk.timestamp?.[1]),
    text: String(chunk.text || '').trim(),
  })).filter(word => Number.isFinite(word.start) && word.text);
  const segments = [];
  let group = null;
  for (const word of words) {
    const start = Math.max(0, Math.min(duration, word.start));
    const end = Math.max(start + .08, Math.min(duration, Number.isFinite(word.end) ? word.end : start + .5));
    if (!group || group.count >= 7 || end - group.start > 4 || start - group.end > 1) {
      if (group) segments.push(group);
      group = { start, end, text: word.text, count: 1 };
    } else {
      group.end = Math.max(group.end, end);
      group.text += /\s$/.test(group.text) || /^[,.;!?]/.test(word.text) ? word.text : ` ${word.text}`;
      group.count++;
    }
  }
  if (group) segments.push(group);
  const result = [];
  for (const { start, end, text } of segments) {
    const stop = Math.min(duration, end);
    const words = text.trim().split(/\s+/);
    const count = Math.min(Math.max(Math.ceil(words.length / 7), Math.ceil((stop - start) / 4)), Math.max(1, Math.floor((stop - start) / .65)));
    if (count <= 1 || words.length < 2) {
      result.push({ start, end: stop, text });
      continue;
    }
    const size = Math.ceil(words.length / count);
    for (let index = 0; index < words.length; index += size) {
      const position = index / words.length;
      const next = Math.min(1, (index + size) / words.length);
      result.push({ start: start + (stop - start) * position, end: start + (stop - start) * next, text: words.slice(index, index + size).join(' ') });
    }
  }
  return result.map(({ start, end, text }) => ({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text })).filter(segment => segment.end > segment.start);
}

function alignToSpeech(segments, audio) {
  if (!segments.length) return segments;
  const frameSize = 320;
  const levels = [];
  for (let offset = 0; offset < audio.length; offset += frameSize) {
    let power = 0;
    const end = Math.min(audio.length, offset + frameSize);
    for (let i = offset; i < end; i++) power += audio[i] * audio[i];
    levels.push(Math.sqrt(power / (end - offset)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * .95)] || 0;
  const floor = sorted[Math.floor(sorted.length * .20)] || 0;
  if (peak < .012 || peak < floor * 2) return segments;
  const threshold = Math.max(.012, floor * 2.5, peak * .14);
  const voiced = levels.map((level, i) => level > threshold || (levels[i - 1] || 0) > threshold || (levels[i + 1] || 0) > threshold);
  const start = segments[0].start;
  const end = segments.at(-1).end;
  const frames = [];
  for (let i = Math.max(0, Math.floor(start * 50)); i < Math.min(voiced.length, Math.ceil(end * 50)); i++) if (voiced[i]) frames.push(i);
  if (frames.length < 25) return segments;
  const totalWords = segments.reduce((sum, segment) => sum + segment.text.trim().split(/\s+/).length, 0);
  let consumed = 0;
  let previousEnd = start;
  return segments.map(segment => {
    const words = segment.text.trim().split(/\s+/).length;
    const first = Math.min(frames.length - 1, Math.floor(consumed / totalWords * frames.length));
    consumed += words;
    const last = Math.min(frames.length - 1, Math.max(first, Math.ceil(consumed / totalWords * frames.length) - 1));
    const alignedStart = Math.max(previousEnd, Math.round(frames[first] * 2) / 100);
    const alignedEnd = Math.round((frames[last] + 1) * 2) / 100;
    const result = { ...segment, start: Math.max(start, alignedStart), end: Math.min(end, Math.max(alignedStart + .08, alignedEnd)) };
    previousEnd = result.end;
    return result;
  });
}

self.onmessage = async event => {
  const { audio, model, language } = event.data || {};
  try {
    if (!(audio instanceof Float32Array) || !MODELS[model] || !['auto', 'tamil', 'english'].includes(language)) throw Error('Invalid transcription request.');
    if (currentModel !== model) {
      postMessage({ type: 'progress', stage: 'loading' });
      transcriber = await pipeline('automatic-speech-recognition', MODELS[model], { device: 'wasm', progress_callback: progress });
      currentModel = model;
    }
    postMessage({ type: 'progress', stage: 'transcribing' });
    const options = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
    if (language !== 'auto') options.language = language;
    const result = await transcriber(audio, options);
    const duration = audio.length / 16000;
    let segments = (result.chunks || []).filter(chunk => {
      const length = Number(chunk.timestamp?.[1]) - Number(chunk.timestamp?.[0]);
      const words = String(chunk.text || '').trim().split(/\s+/).length;
      return length >= .25 && !(length < 1 && words > 8);
    }).flatMap(chunk => alignToSpeech(groupWords([chunk], duration), audio));
    if (!segments.length && !result.chunks?.length && String(result.text || '').trim()) segments = [{ start: 0, end: Math.round(duration * 100) / 100, text: String(result.text).trim() }];
    if (!segments.length) throw Error('No reliable speech timing was found. Try Better accuracy or a clearer audio track.');
    const repeated = new Map();
    for (const segment of segments) {
      const phrase = segment.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      repeated.set(phrase, (repeated.get(phrase) || 0) + 1);
    }
    if (segments.length >= 8 && Math.max(...repeated.values()) >= Math.ceil(segments.length / 3)) throw Error('The speech model repeated the same words too often. Try Better accuracy or a clearer audio track.');
    postMessage({ type: 'done', segments });
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || 'Automatic transcription failed.' });
  }
};
