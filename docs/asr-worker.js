import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
const MODELS = {
  tiny: 'onnx-community/whisper-tiny_timestamped',
  base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
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
 const segments = []; let group = null;
 for (const chunk of chunks) {
  const [start, end] = chunk.timestamp || []; const text = String(chunk.text || '').trim();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + .1 || !text) continue;
  if (!group || group.count >= 5 || end-group.start > 3 || start-group.end > .45 || /[.!?]$/.test(group.text)) {
   group = {start, end: Math.min(duration,end), text, count:1}; segments.push(group);
  } else { group.text += /^[,.;!?]/.test(text) ? text : ` ${text}`; group.end = Math.min(duration,end); group.count++; }
 }
 return segments.map(({start,end,text}) => ({start: Math.round(start*1000)/1000,end: Math.round(end*1000)/1000,text}));
}

function explainAsrError(error) {
 const message = String(error?.message || error || 'Automatic transcription failed.');
 if (/memory|allocat|out of bounds|wasm.*(fail|abort)/i.test(message)) return 'The model ran out of browser memory. Try Whisper Base, close other tabs, or use a shorter clip. Your previous captions are kept.';
 if (/fetch|network|download|load.*(model|file)|http/i.test(message)) return 'The model download could not finish. Check your connection and retry. Your video is still on this device.';
 return message;
}

self.onmessage = async event => {
  const { audio, model, language, mode } = event.data || {};
  try {
    if (!(audio instanceof Float32Array) || !MODELS[model] || language !== 'english') throw Error('Invalid transcription request.');
    if (currentModel !== model) {
      postMessage({ type: 'progress', stage: 'loading' });
      transcriber = await pipeline('automatic-speech-recognition', MODELS[model], { device: 'wasm', dtype: 'q8', progress_callback: progress });
      currentModel = model;
    }
    postMessage({ type: 'progress', stage: 'transcribing' });
    const options = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', do_sample: false };
    if (language !== 'auto') options.language = language;
    const result = await transcriber(audio, options);
    const duration = audio.length / 16000;
    const segments = groupWords(result.chunks || [], duration);
    if (!segments.length) throw Error('No reliable speech timing was found. Try Better accuracy or a clearer audio track.');
    const repeated = new Map();
    for (const segment of segments) {
      const phrase = segment.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      repeated.set(phrase, (repeated.get(phrase) || 0) + 1);
    }
    if (mode !== 'song' && segments.length >= 8 && Math.max(...repeated.values()) >= Math.ceil(segments.length / 3)) throw Error('The speech model repeated the same words too often. Try Better accuracy or a clearer audio track.');
    postMessage({ type: 'done', segments });
  } catch (error) {
    postMessage({ type: 'error', message: explainAsrError(error) });
  }
};
