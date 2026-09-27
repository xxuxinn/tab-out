/* ================================================================
   Tab Out — Title embeddings (page side)

   Gives topics.js a meaning vector for each cleaned tab title, so
   the "By topic" view can group tabs about the same thing even when
   they share no word, in English or Chinese.

   - The model runs in embed-worker.js, inside the browser. No tab
     title or URL leaves the machine.
   - Vectors are cached in IndexedDB, keyed by model + title, so each
     title is embedded once. The cache keeps the most recently used
     MAX_ENTRIES titles.
   - If scripts/setup-model.sh has not been run, status() says
     'missing' and the topic view keeps using word overlap.

   Public API (window.TabOutEmbeddings):
     status()        -> Promise<'ready' | 'missing'>
     lookup(texts)   -> Promise<{ vectors: Map<text, Float32Array>, missing: string[] }>
     embed(texts)    -> Promise<Map<text, Float32Array>>   computes and caches missing ones
     EMBEDDING_CONFIG
   ================================================================ */

'use strict';

const EMBEDDING_CONFIG = Object.freeze({
  MODEL_ID:     'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  REQUIRED_FILES: Object.freeze([
    'vendor/transformers.min.js',
    'vendor/ort-wasm-simd-threaded.asyncify.wasm',
    'models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/onnx/model_quantized.onnx',
  ]),
  DB_NAME:      'tabout-embeddings',
  DB_STORE:     'vectors',
  DB_VERSION:   1,
  MAX_ENTRIES:  5000,       // ~1.5 KB each -> at most ~8 MB
  BATCH_SIZE:   32,         // titles per worker call
  TIMEOUT_MS:   120000,     // first call also loads the 118 MB model
});


/* ----------------------------------------------------------------
   INSTALL CHECK — are the setup-model.sh files inside the extension?
   ---------------------------------------------------------------- */

let statusPromise = null;

async function fileExists(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path), { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;   // a missing extension file rejects instead of returning 404
  }
}

function embeddingStatus() {
  if (!statusPromise) {
    statusPromise = Promise.all(EMBEDDING_CONFIG.REQUIRED_FILES.map(fileExists))
      .then(found => (found.every(Boolean) ? 'ready' : 'missing'));
  }
  return statusPromise;
}


/* ----------------------------------------------------------------
   INDEXEDDB CACHE — { key: model + '\n' + title, vector, ts }
   ---------------------------------------------------------------- */

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(EMBEDDING_CONFIG.DB_NAME, EMBEDDING_CONFIG.DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(EMBEDDING_CONFIG.DB_STORE, { keyPath: 'key' });
        store.createIndex('ts', 'ts');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    }).catch(err => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

function cacheKey(text) {
  return `${EMBEDDING_CONFIG.MODEL_ID}\n${text}`;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}

async function readCached(texts) {
  const db    = await openDb();
  const tx    = db.transaction(EMBEDDING_CONFIG.DB_STORE, 'readonly');
  const store = tx.objectStore(EMBEDDING_CONFIG.DB_STORE);
  const rows  = await Promise.all(texts.map(text => new Promise(resolve => {
    const req = store.get(cacheKey(text));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => resolve(null);
  })));
  await txDone(tx);
  return rows;
}

async function writeCached(entries, now) {
  if (entries.length === 0) return;
  const db    = await openDb();
  const tx    = db.transaction(EMBEDDING_CONFIG.DB_STORE, 'readwrite');
  const store = tx.objectStore(EMBEDDING_CONFIG.DB_STORE);
  for (const [text, vector] of entries) store.put({ key: cacheKey(text), vector, ts: now });
  await txDone(tx);
}

// Refresh "last used" so titles still open are never pruned
async function touchCached(rows, now) {
  const stale = rows.filter(r => r && now - r.ts > 24 * 60 * 60 * 1000);
  if (stale.length === 0) return;
  const db    = await openDb();
  const tx    = db.transaction(EMBEDDING_CONFIG.DB_STORE, 'readwrite');
  const store = tx.objectStore(EMBEDDING_CONFIG.DB_STORE);
  for (const r of stale) store.put({ ...r, ts: now });
  await txDone(tx);
}

async function pruneCache() {
  const db    = await openDb();
  const tx    = db.transaction(EMBEDDING_CONFIG.DB_STORE, 'readwrite');
  const store = tx.objectStore(EMBEDDING_CONFIG.DB_STORE);
  const count = await new Promise(resolve => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(0);
  });
  let extra = count - EMBEDDING_CONFIG.MAX_ENTRIES;
  if (extra > 0) {
    store.index('ts').openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor || extra <= 0) return;
      cursor.delete();
      extra -= 1;
      cursor.continue();
    };
  }
  await txDone(tx);
}


/* ----------------------------------------------------------------
   WORKER — one per page, created on first use
   ---------------------------------------------------------------- */

let worker = null;
let nextRequestId = 1;
const pendingRequests = new Map();

function failAll(message) {
  for (const { reject, timer } of pendingRequests.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pendingRequests.clear();
  worker = null;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(chrome.runtime.getURL('embed-worker.js'), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pendingRequests.get(data && data.id);
      if (!entry) return;
      pendingRequests.delete(data.id);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.vectors);
    };
    worker.onerror = e => {
      if (worker) worker.terminate();
      failAll(`embedding worker failed: ${e.message || 'unknown error'}`);
    };
  }
  return worker;
}

function runWorker(texts) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('embedding timed out'));
    }, EMBEDDING_CONFIG.TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    getWorker().postMessage({ id, modelId: EMBEDDING_CONFIG.MODEL_ID, texts });
  });
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}


/* ----------------------------------------------------------------
   PUBLIC API
   ---------------------------------------------------------------- */

/** lookup(texts) -> { vectors: Map, missing: string[] }   cache only, never runs the model */
async function lookupEmbeddings(texts) {
  const unique = [...new Set(texts)];
  const rows   = await readCached(unique);
  const vectors = new Map(unique.flatMap((t, i) => (rows[i] ? [[t, rows[i].vector]] : [])));
  touchCached(rows, Date.now()).catch(err => console.warn('[tab-out] embedding cache touch failed:', err));
  return { vectors, missing: unique.filter(t => !vectors.has(t)) };
}

/** embed(texts) -> Map<text, Float32Array>   runs the model for titles not yet cached */
async function embedTexts(texts) {
  const { vectors, missing } = await lookupEmbeddings(texts);
  if (missing.length === 0) return vectors;

  const computed = [];
  for (const batch of chunk(missing, EMBEDDING_CONFIG.BATCH_SIZE)) {
    const out = await runWorker(batch);
    batch.forEach((text, i) => computed.push([text, out[i]]));
  }
  await writeCached(computed, Date.now());
  pruneCache().catch(err => console.warn('[tab-out] embedding cache prune failed:', err));
  return new Map([...vectors, ...computed]);
}

window.TabOutEmbeddings = Object.freeze({
  status: embeddingStatus,
  lookup: lookupEmbeddings,
  embed:  embedTexts,
  EMBEDDING_CONFIG,
});
