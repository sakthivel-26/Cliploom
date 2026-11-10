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
    const count = Math.max(Math.ceil(words.length / 7), Math.ceil((stop - start) / 4));
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
    let segments = groupWords(result.chunks || [], duration);
    if (!segments.length && String(result.text || '').trim()) segments = [{ start: 0, end: Math.round(duration * 100) / 100, text: String(result.text).trim() }];
    postMessage({ type: 'done', segments });
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || 'Automatic transcription failed.' });
  }
};
