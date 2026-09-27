/* ================================================================
   Tab Out — Topic Classifier

   Turns a list of open tabs into topic groups using only what
   Chrome already gives us for free: the cleaned tab title and the
   words in the URL path. Nothing is fetched, nothing leaves the
   browser.

   Priority per tab:
     1. native   the tab sits in a Chrome tab group (groupId != -1)
     2. rule     a LOCAL_TOPIC_RULES entry from config.local.js matches
     3. topic    automatic clustering of similar titles
     4. leftover nothing confident; the caller keeps its domain card

   Step 3 measures "similar" in one of two ways:
     semantic  ctx.embeddings holds a meaning vector for every title
               (embeddings.js, a multilingual model running in the
               browser). Titles about the same thing match even with
               no shared word, across English and Chinese.
     words     otherwise: word overlap + cosine, as before.
   Labels always come from shared words; a semantic cluster whose
   members share no word is named after its most central title.

   Public API (window.TabOutTopics):
     classify(tabs, ctx) -> { groups, leftoverTabs, cacheUpdate, semantic }
     tokenize, vectorize, cosine, cluster, labelFor, matchRule, TOPIC_CONFIG

   `classify` is pure: no chrome.*, no DOM, synchronous. Embeddings
   are computed beforehand by the caller and passed in.

   The IDF formula, cosine similarity and stopword list follow
   tiny-tfidf (MIT, Kerry Rodden): https://github.com/kerryrodden/tiny-tfidf
   ================================================================ */

'use strict';

const TOPIC_CONFIG = Object.freeze({
  MIN_TOKEN_LENGTH:     3,
  MAX_TOKEN_LENGTH:     30,
  MIN_DOC_TOKENS:       2,      // fewer distinct tokens -> leftover ("Sign in", bare domains)
  MIN_CLUSTER_SIZE:     2,      // auto clusters only; rule and native groups may hold 1 tab
  SIMILARITY_THRESHOLD: 0.25,   // average-link cosine to merge; titles sharing 2 words score ~0.35, one accidental word ~0.15
  SEMANTIC_THRESHOLD:   0.40,   // same, on embedding cosine. scripts/bench-embeddings.mjs: at 0.40 all 8 clusters correct (precision 1.0); at 0.36 unrelated tabs start to merge
  SEMANTIC_LABEL_SHARE: 0.5,    // semantic clusters: a label word must appear in at least half the members, else use the central title
  MEDOID_LABEL_WORDS:   4,      // central-title label: first N words ...
  MEDOID_LABEL_CHARS:   28,     // ... capped at this many characters (CJK titles have no spaces)
  MAX_LABEL_TERMS:      3,
  MIN_LABEL_TERM_DOCS:  2,      // a label word must appear in at least 2 members
  IDF_POWER:            0,      // 0 = plain word overlap. With 10-150 short titles, rare-word weighting (IDF) hurt: a word shared by half the tabs is the topic, not noise. Raise toward 1 to bring IDF back.
  CJK_NGRAM:            2,      // CJK text has no spaces; 2-char pieces stand in for words
  ID_LIKE_MIN_HEX:      8,      // hex strings this long are ids, not words
  ID_LIKE_MIN_MIXED:    12,     // letter+digit strings this long are ids (YouTube ids, hashes)
  MIN_SINGULARIZE_LENGTH: 5,    // "pancakes" -> "pancake"; shorter words are left alone
  PATH_TOKEN_WEIGHT:    0.5,    // a URL path word counts half a title word (paths carry more noise)
  LABEL_SEPARATOR:      ' · ',
  CACHE_TTL_MS:         7 * 24 * 60 * 60 * 1000,
  CACHE_MAX_ENTRIES:    500,
});

const TOPIC_KEY_PREFIX  = '__topic__';
const NATIVE_KEY_PREFIX = '__native__';
const NATIVE_GROUP_FALLBACK_LABEL = 'Group';
const TOPIC_GROUP_KINDS = Object.freeze({ NATIVE: 'native', RULE: 'rule', TOPIC: 'topic' });
const TOPIC_TAB_GROUP_ID_NONE = -1;

const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WORD    = /[\p{L}\p{N}]+/gu;
const PATH_SPLIT = /[\/\-_.+~,%:]+/;


/* ----------------------------------------------------------------
   SMALL PURE HELPERS
   ---------------------------------------------------------------- */

function partition(items, predicate) {
  return items.reduce(
    ([yes, no], item) => (predicate(item) ? [[...yes, item], no] : [yes, [...no, item]]),
    [[], []]
  );
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return { hostname: u.hostname, pathname: u.pathname };
  } catch {
    return { hostname: '', pathname: '' };
  }
}

// renderDomainCard strips [^a-z0-9] without lowercasing, so keys must be lowercase ASCII
function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'topic';
}

function capitalizeTerm(term) {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function sortByCountDesc(groups) {
  return [...groups].sort((a, b) => b.tabs.length - a.tabs.length);
}


/* ----------------------------------------------------------------
   TOKENISER — cleaned title + URL path words
   ---------------------------------------------------------------- */

function cjkBigrams(run) {
  const n = TOPIC_CONFIG.CJK_NGRAM;
  if (run.length < n) return [run];
  return Array.from({ length: run.length - n + 1 }, (_, i) => run.slice(i, i + n));
}

function looksLikeId(token) {
  if (/^\d+$/.test(token)) return true;
  if (token.length >= TOPIC_CONFIG.ID_LIKE_MIN_HEX && /^[0-9a-f]+$/.test(token)) return true;
  if (token.length >= TOPIC_CONFIG.ID_LIKE_MIN_MIXED && /\d/.test(token) && /[a-z]/.test(token)) return true;
  const letters = (token.match(/\p{L}/gu) || []).length;
  return /\d/.test(token) && letters < 2;
}

// Crude English plural strip: "recipes" -> "recipe", "transformers" -> "transformer".
// Leaves "class", "status", "analysis" alone. Not a stemmer, just enough for titles.
function singularize(token) {
  if (token.length < TOPIC_CONFIG.MIN_SINGULARIZE_LENGTH) return token;
  if (!/[a-z]s$/.test(token) || /(ss|us|is)$/.test(token)) return token;
  return token.slice(0, -1);
}

function keepToken(token, dropSet) {
  return token.length >= TOPIC_CONFIG.MIN_TOKEN_LENGTH
    && token.length <= TOPIC_CONFIG.MAX_TOKEN_LENGTH
    && !TOPIC_STOPWORDS.has(token)
    && !TOPIC_GENERIC_TITLE_TOKENS.has(token)
    && !dropSet.has(token)
    && !looksLikeId(token);
}

function textTokens(text, dropSet) {
  const lower = String(text || '').toLowerCase().normalize('NFKC');
  const cjk   = (lower.match(CJK_RUN) || []).flatMap(cjkBigrams);
  const words = (lower.replace(CJK_RUN, ' ').match(WORD) || [])
    .filter(t => keepToken(t, dropSet))
    .map(singularize);
  return [...words, ...cjk];
}

function pathTokens(url, dropSet) {
  const { pathname } = safeUrl(url);
  if (!pathname) return [];
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep raw path */ }
  return decoded.toLowerCase().split(PATH_SPLIT)
    .filter(t => t && !TOPIC_PATH_STOPWORDS.has(t) && keepToken(t, dropSet))
    .map(singularize);
}

/**
 * tokenizeParts(cleanedTitle, url) -> { title: string[], path: string[] }
 * The tab's own hostname labels ("github", "www") never become topic words.
 */
function tokenizeParts(cleanedTitle, url) {
  const { hostname } = safeUrl(url);
  const dropSet = new Set(hostname.split('.').filter(Boolean));
  return { title: textTokens(cleanedTitle, dropSet), path: pathTokens(url, dropSet) };
}

/** tokenize(cleanedTitle, url) -> string[]   (title words then path words) */
function tokenize(cleanedTitle, url) {
  const parts = tokenizeParts(cleanedTitle, url);
  return [...parts.title, ...parts.path];
}


/* ----------------------------------------------------------------
   TERM VECTORS + COSINE SIMILARITY

   weight = (1 + ln tf) * idf ^ IDF_POWER
   idf is the BM25 form used by tiny-tfidf. Titles are 3-8 words,
   so term frequency is damped (sublinear). IDF_POWER is 0 by
   default: measured on fixtures, any IDF let a title's unique words
   outweigh the two words it shares with its neighbours, and related
   pairs fell below accidental one-word overlaps. Plain overlap keeps
   related pairs >= 0.32 and accidental pairs <= 0.21 at every corpus
   size tried (6 to 14 tabs), so SIMILARITY_THRESHOLD sits at 0.25.
   ---------------------------------------------------------------- */

// Weighted counts: title words count 1, path words count PATH_TOKEN_WEIGHT
function termFrequencies(parts) {
  const counts = new Map();
  for (const t of parts.title) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of parts.path)  counts.set(t, (counts.get(t) || 0) + TOPIC_CONFIG.PATH_TOKEN_WEIGHT);
  return Object.freeze(Object.fromEntries(counts));
}

function documentFrequencies(docs) {
  const counts = new Map();
  for (const d of docs) for (const t of Object.keys(d.termFreq)) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

/** vectorize(docs) -> Vector[]   (sparse {term: weight}, index-aligned with docs) */
function vectorize(docs) {
  const N = docs.length;
  if (N === 0) return [];
  const df = documentFrequencies(docs);
  return docs.map(d => {
    const entries = Object.entries(d.termFreq).map(([t, tf]) => {
      const n   = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      return [t, (1 + Math.log(tf)) * Math.pow(idf, TOPIC_CONFIG.IDF_POWER)];
    });
    return Object.freeze(Object.fromEntries(entries));
  });
}

function vectorNorm(v) {
  return Math.sqrt(Object.values(v).reduce((s, x) => s + x * x, 0));
}

function cosine(a, b) {
  const [small, large] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  const dot = Object.keys(small).reduce((s, t) => s + (large[t] ? small[t] * large[t] : 0), 0);
  const den = vectorNorm(a) * vectorNorm(b);
  return den === 0 ? 0 : dot / den;
}


/* ----------------------------------------------------------------
   CLUSTERING — average-link agglomerative with a threshold
   Deterministic, needs no cluster count. n is 10-150, so an n x n
   similarity matrix is a few milliseconds at most.
   ---------------------------------------------------------------- */

function similarityMatrix(vectors) {
  return vectors.map((v, i) => vectors.map((w, j) => (i === j ? 1 : cosine(v, w))));
}

// Embeddings arrive L2-normalised, so cosine is the plain dot product
function denseDot(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

function denseSimilarityMatrix(embeddings) {
  return embeddings.map((v, i) => embeddings.map((w, j) => (i === j ? 1 : denseDot(v, w))));
}

function averageLink(sim, a, b) {
  const total = a.reduce((s, i) => s + b.reduce((t, j) => t + sim[i][j], 0), 0);
  return total / (a.length * b.length);
}

function bestPair(sim, clusters) {
  let best = { i: -1, j: -1, score: -1 };
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const score = averageLink(sim, clusters[i], clusters[j]);
      if (score > best.score) best = { i, j, score };
    }
  }
  return best;
}

/** cluster(sim, threshold) -> number[][]   (arrays of doc indices) */
function cluster(sim, threshold = TOPIC_CONFIG.SIMILARITY_THRESHOLD) {
  let clusters = sim.map((_, i) => [i]);
  for (;;) {
    const { i, j, score } = bestPair(sim, clusters);
    if (i === -1 || score < threshold) return clusters;
    const merged = [...clusters[i], ...clusters[j]];
    clusters = [...clusters.filter((_, k) => k !== i && k !== j), merged];
  }
}


/* ----------------------------------------------------------------
   LABELLING — top shared terms of a cluster
   ---------------------------------------------------------------- */

function termStats(memberIdx, vectors) {
  const stats = new Map();
  for (const i of memberIdx) {
    for (const [t, w] of Object.entries(vectors[i])) {
      const prev = stats.get(t) || { docs: 0, weight: 0 };
      stats.set(t, { docs: prev.docs + 1, weight: prev.weight + w });
    }
  }
  return stats;
}

// The member with the highest average similarity to the others
function medoidIndex(memberIdx, sim) {
  const avg = i => memberIdx.reduce((s, j) => s + (i === j ? 0 : sim[i][j]), 0);
  return memberIdx.reduce((best, i) => (avg(i) > avg(best) ? i : best), memberIdx[0]);
}

function shortTitle(text) {
  const words = String(text).trim().split(/\s+/).slice(0, TOPIC_CONFIG.MEDOID_LABEL_WORDS).join(' ');
  const max   = TOPIC_CONFIG.MEDOID_LABEL_CHARS;
  const cut   = words.length > max ? `${words.slice(0, max).trim()}…` : words;
  return cut.replace(/[\s:：,，\-–—|·]+$/u, '') || 'Topic';
}

// Semantic clusters: a word shared by only 2 of 6 members would mislabel the card
function minLabelDocs(memberIdx, semantic) {
  return semantic
    ? Math.max(TOPIC_CONFIG.MIN_LABEL_TERM_DOCS, Math.ceil(memberIdx.length * TOPIC_CONFIG.SEMANTIC_LABEL_SHARE))
    : TOPIC_CONFIG.MIN_LABEL_TERM_DOCS;
}

/**
 * labelFor(memberIdx, vectors, opts?) -> { label, key }
 * opts: { semantic?: boolean, sim?: number[][], docs?: Doc[] }  (semantic needs sim + docs)
 */
function labelFor(memberIdx, vectors, opts = {}) {
  const stats  = termStats(memberIdx, vectors);
  const need   = minLabelDocs(memberIdx, opts.semantic);
  const ranked = [...stats.entries()]
    .filter(([, s]) => s.docs >= need)
    .sort(([, a], [, b]) => b.docs - a.docs || b.weight - a.weight)
    .slice(0, TOPIC_CONFIG.MAX_LABEL_TERMS)
    .map(([t]) => t);
  if (!ranked.length && opts.semantic && opts.sim && opts.docs) {
    const label = shortTitle(opts.docs[medoidIndex(memberIdx, opts.sim)].text);
    return { label, key: TOPIC_KEY_PREFIX + slugify(label) };
  }
  const fallback = [...stats.entries()].sort(([, a], [, b]) => b.weight - a.weight)[0];
  const terms    = ranked.length ? ranked : [fallback ? fallback[0] : 'topic'];
  return {
    label: terms.map(capitalizeTerm).join(TOPIC_CONFIG.LABEL_SEPARATOR),
    key:   TOPIC_KEY_PREFIX + slugify(terms.join('-')),
  };
}

// If most members were cached under one label recently, keep that label so cards stay put
function cachedLabelFor(memberDocs, cache, now) {
  const votes = new Map();
  for (const d of memberDocs) {
    const entry = cache[d.tab.url];
    const fresh = entry && entry.title === d.text && (now - entry.ts) <= TOPIC_CONFIG.CACHE_TTL_MS;
    if (fresh) votes.set(entry.key, { label: entry.label, n: (votes.get(entry.key)?.n || 0) + 1 });
  }
  const top = [...votes.entries()].sort(([, a], [, b]) => b.n - a.n)[0];
  return top && top[1].n * 2 > memberDocs.length ? { key: top[0], label: top[1].label } : null;
}

function dedupeKeys(groups) {
  const seen = new Map();
  return groups.map(g => {
    const n = (seen.get(g.domain) || 0) + 1;
    seen.set(g.domain, n);
    return n === 1 ? g : { ...g, domain: `${g.domain}-${n}` };
  });
}


/* ----------------------------------------------------------------
   USER RULES — LOCAL_TOPIC_RULES from config.local.js
   { topicKey, topicLabel, keywords?: string[], pattern?: RegExp,
     hostname?, hostnameEndsWith?, pathPrefix? }   first match wins
   ---------------------------------------------------------------- */

function validateRule(rule, idx) {
  const ok = !!rule
    && typeof rule.topicKey === 'string' && /^[a-z0-9-]+$/.test(rule.topicKey)
    && typeof rule.topicLabel === 'string' && rule.topicLabel.trim() !== ''
    && (Array.isArray(rule.keywords) || rule.pattern instanceof RegExp);
  if (!ok) {
    console.warn(`[tab-out] LOCAL_TOPIC_RULES[${idx}] ignored: needs topicKey (a-z, 0-9, -), topicLabel, and keywords[] or pattern`);
  }
  return ok;
}

function hostMatches(rule, hostname) {
  if (rule.hostname)         return hostname === rule.hostname;
  if (rule.hostnameEndsWith) return hostname.endsWith(rule.hostnameEndsWith);
  return true;
}

/** matchRule(doc, rules) -> rule | null */
function matchRule(doc, rules) {
  const { hostname, pathname } = safeUrl(doc.tab.url);
  const tokenSet = new Set(doc.tokens);
  const haystack = `${doc.text} ${doc.tab.url}`;
  return rules.find(r =>
    hostMatches(r, hostname)
    && (!r.pathPrefix || pathname.startsWith(r.pathPrefix))
    && ((r.keywords || []).some(k => tokenSet.has(String(k).toLowerCase()))
        || (r.pattern instanceof RegExp && r.pattern.test(haystack)))
  ) || null;
}


/* ----------------------------------------------------------------
   GROUP BUILDERS
   ---------------------------------------------------------------- */

function nativeGroupsFrom(docs, nativeGroups) {
  const order = [...new Set(docs.map(d => d.tab.groupId))];
  return sortByCountDesc(order.map((id, i) => {
    const title = String((nativeGroups && nativeGroups[id] && nativeGroups[id].title) || '').trim();
    return Object.freeze({
      domain: NATIVE_KEY_PREFIX + id,
      label:  title || `${NATIVE_GROUP_FALLBACK_LABEL} ${i + 1}`,
      kind:   TOPIC_GROUP_KINDS.NATIVE,
      tabs:   docs.filter(d => d.tab.groupId === id).map(d => d.tab),
    });
  }));
}

function ruleGroupsFrom(ruled) {
  const keys = [...new Set(ruled.map(r => r.rule.topicKey))];
  return sortByCountDesc(keys.map(key => {
    const members = ruled.filter(r => r.rule.topicKey === key);
    return Object.freeze({
      domain: TOPIC_KEY_PREFIX + key,
      label:  members[0].rule.topicLabel,
      kind:   TOPIC_GROUP_KINDS.RULE,
      tabs:   members.map(r => r.doc.tab),
    });
  }));
}

function autoGroupsFrom(clusters, docs, vectors, ctx) {
  const labelOpts = { semantic: ctx.semantic, sim: ctx.sim, docs };
  const groups = clusters.map(memberIdx => {
    const memberDocs = memberIdx.map(i => docs[i]);
    const named = cachedLabelFor(memberDocs, ctx.cache || {}, ctx.now) || labelFor(memberIdx, vectors, labelOpts);
    return Object.freeze({
      domain: named.key,
      label:  named.label,
      kind:   TOPIC_GROUP_KINDS.TOPIC,
      tabs:   memberDocs.map(d => d.tab),
    });
  });
  return dedupeKeys(sortByCountDesc(groups));
}

function buildCacheUpdate(autoGroups, now) {
  const entries = autoGroups.flatMap(g =>
    g.tabs.map(t => [t.url, { title: t.text, key: g.domain, label: g.label, ts: now }])
  );
  return Object.freeze(Object.fromEntries(entries));
}


/* ----------------------------------------------------------------
   classify — the single boundary the UI calls
   ---------------------------------------------------------------- */

// Semantic only when every clusterable title has a vector: a mixed matrix
// would compare embedding cosines against word cosines
function embeddingsFor(docs, embeddings) {
  if (!embeddings || typeof embeddings.get !== 'function' || docs.length === 0) return null;
  const list = docs.map(d => embeddings.get(d.text));
  return list.every(v => v && v.length > 0) ? list : null;
}

/**
 * classify(tabs, ctx) -> { groups, leftoverTabs, cacheUpdate, semantic }
 *
 * tabs: content tabs (landing pages removed), each with `text` = cleaned title
 * ctx:  { rules?, nativeGroups?: {[groupId]: {title}}, cache?, now?,
 *         embeddings?: Map<cleanedTitle, Float32Array> (L2-normalised) }
 * semantic: true when step 3 used the embeddings
 */
function classify(tabs, ctx = {}) {
  const now   = typeof ctx.now === 'number' ? ctx.now : Date.now();
  const rules = (ctx.rules || []).filter(validateRule);

  const docs = (tabs || []).map(tab => {
    const text  = String(tab.text || '');
    const parts = tokenizeParts(text, tab.url);
    return Object.freeze({
      tab, text,
      tokens:   [...parts.title, ...parts.path],
      termFreq: termFrequencies(parts),
    });
  });

  const [nativeDocs, rest1]     = partition(docs, d => d.tab.groupId !== TOPIC_TAB_GROUP_ID_NONE);
  const ruled                   = rest1.map(doc => ({ doc, rule: matchRule(doc, rules) }));
  const [ruleDocs, rest2]       = partition(ruled, r => r.rule !== null);
  const [clusterable, tooShort] = partition(rest2.map(r => r.doc),
                                            d => new Set(d.tokens).size >= TOPIC_CONFIG.MIN_DOC_TOKENS);

  const vectors   = vectorize(clusterable);
  const dense     = embeddingsFor(clusterable, ctx.embeddings);
  const semantic  = dense !== null;
  const sim       = semantic ? denseSimilarityMatrix(dense) : similarityMatrix(vectors);
  const threshold = semantic ? TOPIC_CONFIG.SEMANTIC_THRESHOLD : TOPIC_CONFIG.SIMILARITY_THRESHOLD;
  const clusters  = cluster(sim, threshold).filter(c => c.length >= TOPIC_CONFIG.MIN_CLUSTER_SIZE);
  const autoGroups   = autoGroupsFrom(clusters, clusterable, vectors, { ...ctx, now, semantic, sim });
  const clusteredIdx = new Set(clusters.flat());

  const leftoverTabs = [
    ...clusterable.filter((_, i) => !clusteredIdx.has(i)).map(d => d.tab),
    ...tooShort.map(d => d.tab),
  ];

  return Object.freeze({
    groups: [
      ...nativeGroupsFrom(nativeDocs, ctx.nativeGroups),
      ...ruleGroupsFrom(ruleDocs),
      ...autoGroups,
    ],
    leftoverTabs,
    cacheUpdate: buildCacheUpdate(autoGroups, now),
    semantic,
  });
}

window.TabOutTopics = Object.freeze({
  classify, tokenize, vectorize, cosine, cluster, labelFor, matchRule,
  TOPIC_CONFIG, TOPIC_KEY_PREFIX, NATIVE_KEY_PREFIX, TOPIC_GROUP_KINDS,
});
