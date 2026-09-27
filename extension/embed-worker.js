/* ================================================================
   Tab Out — Embedding worker (module Web Worker)

   Runs the multilingual sentence model off the page's main thread,
   so the new-tab page never freezes while titles are embedded.
   Everything loads from the extension's own folder: the library and
   engine from vendor/, the model from models/ (both installed by
   scripts/setup-model.sh). Remote model downloads are switched off,
   so this worker makes no network requests.

   Protocol (from embeddings.js):
     in   { id, modelId, texts: string[] }
     out  { id, vectors: Float32Array[] }   L2-normalised, mean-pooled
      or  { id, error: string }
   ================================================================ */

import { pipeline, env } from './vendor/transformers.min.js';

const BASE = new URL('./', self.location.href).href;

env.allowRemoteModels = false;
env.allowLocalModels  = true;
env.localModelPath    = `${BASE}models/`;
env.useBrowserCache   = false;   // files are already on disk inside the extension
env.backends.onnx.wasm.wasmPaths  = `${BASE}vendor/`;
env.backends.onnx.wasm.numThreads = 1;   // threads need cross-origin isolation; titles are short anyway

let extractorPromise = null;

function extractorFor(modelId) {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', modelId, { dtype: 'q8', device: 'wasm' })
      .catch(err => { extractorPromise = null; throw err; });
  }
  return extractorPromise;
}

function splitRows(tensor, count) {
  const dim = tensor.dims[tensor.dims.length - 1];
  return Array.from({ length: count }, (_, i) => tensor.data.slice(i * dim, (i + 1) * dim));
}

self.onmessage = async ({ data }) => {
  const { id, modelId, texts } = data || {};
  try {
    if (!Array.isArray(texts) || texts.length === 0) {
      self.postMessage({ id, vectors: [] });
      return;
    }
    const extract = await extractorFor(modelId);
    const output  = await extract(texts, { pooling: 'mean', normalize: true });
    const vectors = splitRows(output, texts.length);
    self.postMessage({ id, vectors }, vectors.map(v => v.buffer));
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
