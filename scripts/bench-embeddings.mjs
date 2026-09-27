/* ================================================================
   Tab Out — embedding model benchmark (dev only)

   Compares candidate in-browser embedding models on a fixture of
   tab titles with known topics (English + Chinese, cross-language
   pairs, synonym pairs with no shared word, unrelated tabs). For
   each model it scans the clustering threshold and reports the
   best pairwise F1, so SEMANTIC_THRESHOLD in extension/topics.js
   comes from data, not a guess. The word-overlap classifier that
   runs without a model is scored the same way as the baseline.

   Setup (nothing is installed into the repo):
     npm install --no-save --package-lock=false --prefix /tmp/tabout-dev @huggingface/transformers@4.3.0
     NODE_PATH=/tmp/tabout-dev/node_modules node scripts/bench-embeddings.mjs

   Models download once into scripts/.bench-cache/ (gitignored).
   ================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// require() honours NODE_PATH; a bare ESM import would not
const { pipeline, env } = createRequire(import.meta.url)('@huggingface/transformers');

const HERE = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(HERE, '.bench-cache');

const MODELS = Object.freeze([
  { id: 'Xenova/multilingual-e5-small',                prefix: 'query: ' },
  { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', prefix: '' },
]);

const THRESHOLDS = Array.from({ length: 86 }, (_, i) => +(0.10 + i * 0.01).toFixed(2));

// [topic, title, url]; topic null = unrelated singleton. Shared with tests/semantic.e2e.cjs
const FIXTURE = Object.freeze(
  JSON.parse(fs.readFileSync(path.join(HERE, '..', 'tests', 'fixtures', 'topic-titles.json'), 'utf8')).rows
);

/* ---------- scoring ---------- */

function truePairs(fixture) {
  const pairs = new Set();
  fixture.forEach(([a], i) => fixture.forEach(([b], j) => {
    if (i < j && a !== null && a === b) pairs.add(`${i}-${j}`);
  }));
  return pairs;
}

function predictedPairs(clusters) {
  const pairs = new Set();
  for (const c of clusters) {
    const s = [...c].sort((x, y) => x - y);
    s.forEach((i, a) => s.slice(a + 1).forEach(j => pairs.add(`${i}-${j}`)));
  }
  return pairs;
}

function pairwiseF1(clusters, truth) {
  const pred = predictedPairs(clusters);
  const hit  = [...pred].filter(p => truth.has(p)).length;
  const precision = pred.size ? hit / pred.size : 0;
  const recall    = truth.size ? hit / truth.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  // F0.5 weights precision twice as much as recall: a wrong group on the
  // dashboard is worse than a tab left in its domain card
  const f05 = precision + recall ? (1.25 * precision * recall) / (0.25 * precision + recall) : 0;
  return { precision, recall, f1, f05 };
}

/* ---------- average-link clustering on a similarity matrix ---------- */

function clusterBySimilarity(sim, threshold) {
  let clusters = sim.map((_, i) => [i]);
  for (;;) {
    let best = { i: -1, j: -1, score: -1 };
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let total = 0;
        for (const a of clusters[i]) for (const b of clusters[j]) total += sim[a][b];
        const score = total / (clusters[i].length * clusters[j].length);
        if (score > best.score) best = { i, j, score };
      }
    }
    if (best.i === -1 || best.score < threshold) return clusters.filter(c => c.length >= 2);
    const merged = [...clusters[best.i], ...clusters[best.j]];
    clusters = [...clusters.filter((_, k) => k !== best.i && k !== best.j), merged];
  }
}

const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);

function simStats(sim, fixture) {
  const same = [], diff = [];
  fixture.forEach(([a], i) => fixture.forEach(([b], j) => {
    if (i >= j) return;
    (a !== null && a === b ? same : diff).push(sim[i][j]);
  }));
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  return { sameMean: mean(same), diffMean: mean(diff), gap: mean(same) - mean(diff) };
}

/* ---------- baseline: the shipped word-overlap classifier ---------- */

function loadTopics() {
  const sandbox = { console, URL };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['topics-stopwords.js', 'topics.js']) {
    const file = path.join(HERE, '..', 'extension', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: f });
  }
  return sandbox.TabOutTopics;
}

function baseline(truth) {
  const T = loadTopics();
  const tabs = FIXTURE.map(([, title, url], i) => ({ id: i, url, title, text: title, groupId: -1 }));
  const { groups } = T.classify(tabs, { now: 0 });
  return pairwiseF1(groups.map(g => g.tabs.map(t => t.id)), truth);
}

/* ---------- main ---------- */

const fmt = n => n.toFixed(3);
const truth = truePairs(FIXTURE);

const base = baseline(truth);
console.log(`word-overlap baseline  F1 ${fmt(base.f1)}  (P ${fmt(base.precision)}, R ${fmt(base.recall)})\n`);

for (const model of MODELS) {
  const t0 = Date.now();
  const extract = await pipeline('feature-extraction', model.id, { dtype: 'q8' });
  const loadMs = Date.now() - t0;

  const t1 = Date.now();
  const out = await extract(FIXTURE.map(([, title]) => model.prefix + title), { pooling: 'mean', normalize: true });
  const embedMs = Date.now() - t1;
  const vecs = out.tolist();
  const sim = vecs.map(a => vecs.map(b => dot(a, b)));

  const scored = THRESHOLDS.map(t => ({ t, ...pairwiseF1(clusterBySimilarity(sim, t), truth) }));
  const best   = scored.reduce((a, b) => (b.f1 > a.f1 ? b : a));
  const near   = scored.filter(s => s.f1 >= best.f1 - 0.05).map(s => s.t);
  const bestP  = scored.reduce((a, b) => (b.f05 > a.f05 ? b : a));
  const stats  = simStats(sim, FIXTURE);

  console.log(model.id);
  console.log(`  load ${loadMs} ms, embed ${FIXTURE.length} titles ${embedMs} ms (${(embedMs / FIXTURE.length).toFixed(1)} ms each, Node CPU)`);
  console.log(`  cosine: same-topic mean ${fmt(stats.sameMean)}, different-topic mean ${fmt(stats.diffMean)}, gap ${fmt(stats.gap)}`);
  console.log(`  best threshold ${best.t}: F1 ${fmt(best.f1)} (P ${fmt(best.precision)}, R ${fmt(best.recall)})`);
  console.log(`  thresholds within 0.05 F1 of best: ${near[0]} – ${near[near.length - 1]}`);
  console.log(`  best precision-weighted (F0.5) threshold ${bestP.t}: F0.5 ${fmt(bestP.f05)} (P ${fmt(bestP.precision)}, R ${fmt(bestP.recall)})`);
  const show = process.env.BENCH_SHOW ? Number(process.env.BENCH_SHOW) : bestP.t;
  console.log(`  clusters at ${show}:`);
  for (const c of clusterBySimilarity(sim, show)) {
    console.log(`    - ${c.map(i => `[${FIXTURE[i][0] ?? '-'}] ${FIXTURE[i][1]}`).join(' | ')}`);
  }
  console.log('');
}
