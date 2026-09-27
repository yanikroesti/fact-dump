// Easel — background removal with RMBG-1.4 via transformers.js (WebGPU, WASM fallback).
// Same model and pre/post-processing as artifacts/bg-remover.html. Loaded on demand.
import { AutoModel, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

env.allowLocalModels = false;
const MODEL_ID = 'briaai/RMBG-1.4';
const SIZE = 1024;
const MAX_SIDE = 4096;

let modelPromise = null;
let device = 'wasm';

async function pickDevice() {
  try {
    if (!navigator.gpu) return { device: 'wasm', dtype: 'q8' };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { device: 'wasm', dtype: 'q8' };
    return { device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'fp16' : 'fp32' };
  } catch { return { device: 'wasm', dtype: 'q8' }; }
}

function loadModel(status) {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const pick = await pickDevice();
    const files = {};
    const onProgress = p => {
      if (p.status !== 'progress' || !p.file?.endsWith('.onnx')) return;
      files[p.file] = p;
      let loaded = 0, total = 0;
      for (const f of Object.values(files)) { loaded += f.loaded || 0; total += f.total || 0; }
      if (total) status('Downloading model…', `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB · first time only`, loaded / total * 100);
    };
    const load = opts => AutoModel.from_pretrained(MODEL_ID, { config: { model_type: 'custom' }, progress_callback: onProgress, ...opts });
    try {
      const m = await load(pick);
      device = pick.device;
      return m;
    } catch (e) {
      if (pick.device === 'wasm') throw e;
      console.warn('WebGPU failed, falling back to WASM', e);
      const m = await load({ device: 'wasm', dtype: 'q8' });
      device = 'wasm';
      return m;
    }
  })();
  modelPromise.catch(() => { modelPromise = null; });
  return modelPromise;
}

function sourceToImageData(src) {
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  const s = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * s), h = Math.round(h0 * s);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
function imageDataToCanvas(img) {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
function toTensor(img) {
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageDataToCanvas(img), 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    data[i] = px[i * 4] / 255 - 0.5;
    data[i + n] = px[i * 4 + 1] / 255 - 0.5;
    data[i + 2 * n] = px[i * 4 + 2] / 255 - 0.5;
  }
  return new Tensor('float32', data, [1, 3, SIZE, SIZE]);
}
function toMask(pred, w, h) {
  let lo = Infinity, hi = -Infinity;
  for (const v of pred) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo || 1;
  const small = new ImageData(SIZE, SIZE);
  for (let i = 0; i < pred.length; i++) {
    const a = Math.round((pred[i] - lo) / range * 255);
    small.data[i * 4] = small.data[i * 4 + 1] = small.data[i * 4 + 2] = a;
    small.data[i * 4 + 3] = 255;
  }
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageDataToCanvas(small), 0, 0, w, h);
  const big = ctx.getImageData(0, 0, w, h).data;
  const m = new Uint8ClampedArray(w * h);
  for (let i = 0; i < m.length; i++) m[i] = big[i * 4];
  return m;
}

// source: HTMLImageElement | HTMLCanvasElement. Returns an HTMLCanvasElement with transparency.
export async function removeBackground(source, status = () => {}) {
  status('Reading image…', '');
  const src = sourceToImageData(source);
  status(modelPromise ? 'Preparing model…' : 'Downloading model…', modelPromise ? '' : 'about 44 MB, first time only, then cached');
  const model = await loadModel(status);
  status(device === 'webgpu' ? 'Removing background (GPU)…' : 'Removing background…', 'usually a few seconds');
  await new Promise(r => setTimeout(r, 30));
  const { output } = await model({ input: toTensor(src) });
  const mask = toMask(output.data, src.width, src.height);
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  for (let i = 0; i < mask.length; i++) out.data[i * 4 + 3] = mask[i];
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').putImageData(out, 0, 0);
  return c;
}
