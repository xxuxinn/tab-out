/* ================================================================
   Tab Out — Topic Classifier Self-Test

   Tab Out has no test runner, so the checks live here and run in
   two places:
     - devtools console on the new-tab page:  tabOutSelfTest()
     - Node, from the repo root:              node extension/topics-selftest.js

   Returns { passed: string[], failed: string[] }. An empty `failed`
   array is the pass criterion. Re-run after changing TOPIC_CONFIG.
   ================================================================ */

'use strict';

function tabOutSelfTest() {
  const T = (typeof window !== 'undefined' ? window : globalThis).TabOutTopics;
  const passed = [];
  const failed = [];
  const check = (name, ok, detail) => (ok ? passed : failed).push(detail ? `${name}: ${detail}` : name);

  const tab = (id, url, text, groupId = -1) => ({ id, url, title: text, text, groupId, windowId: 1, active: false });

  // Fixture: 3 transformer papers, 3 recipes, 2 too-short, 2 unrelated
  const fixture = [
    tab(1, 'https://arxiv.org/abs/1706.03762',            'Attention Is All You Need: the transformer paper'),
    tab(2, 'https://www.youtube.com/watch?v=abc123DEF45', 'How transformer attention works, explained'),
    tab(3, 'https://jalammar.github.io/illustrated-transformer/', 'The Illustrated Transformer: attention step by step'),
    tab(4, 'https://www.seriouseats.com/classic-pancake-recipe', 'Classic buttermilk pancake recipe'),
    tab(5, 'https://cooking.nytimes.com/recipes/1234',    'Fluffy pancake recipe with buttermilk'),
    tab(6, 'https://www.bbcgoodfood.com/recipes/easy-pancakes', 'Easy pancakes recipe, buttermilk batter'),
    tab(7, 'https://accounts.google.com/signin',          'Sign in'),
    tab(8, 'https://github.com/',                         'github.com'),
    tab(9, 'https://www.bbc.com/weather/2643743',         'London weather forecast for the weekend'),
    tab(10, 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API', 'IndexedDB API reference'),
  ];

  // 1. Tokeniser drops ids, path noise and the host's own name
  const tokens = T.tokenize('Attention Is All You Need', 'https://arxiv.org/abs/1706.03762');
  check('tokenize drops ids and host labels',
    ['1706', '03762', 'abs', 'arxiv', 'org'].every(t => !tokens.includes(t)) && tokens.includes('attention'),
    JSON.stringify(tokens));

  // 2. Clustering: two auto groups of 3, four leftovers
  const base = T.classify(fixture, { now: 1000 });
  const auto = base.groups.filter(g => g.kind === 'topic');
  check('two auto clusters of size 3',
    auto.length === 2 && auto.every(g => g.tabs.length === 3),
    auto.map(g => `${g.label} (${g.tabs.length})`).join(' | '));
  check('labels name the shared subject',
    auto.some(g => /transformer|attention/i.test(g.label)) && auto.some(g => /pancake|recipe|buttermilk/i.test(g.label)),
    auto.map(g => g.label).join(' | '));
  check('short and unrelated tabs are leftovers',
    base.leftoverTabs.length === 4 && [7, 8, 9, 10].every(id => base.leftoverTabs.some(t => t.id === id)),
    base.leftoverTabs.map(t => t.id).join(','));
  check('keys are lowercase ascii slugs',
    base.groups.every(g => /^[a-z0-9_-]+$/.test(g.domain)),
    base.groups.map(g => g.domain).join(' | '));

  // 3. Rules capture before clustering
  const ruled = T.classify(fixture, { now: 1000, rules: [{ topicKey: 'ml', topicLabel: 'ML papers', keywords: ['transformer'] }] });
  const ruleGroups = ruled.groups.filter(g => g.kind === 'rule');
  check('rule captures the 3 transformer tabs',
    ruleGroups.length === 1 && ruleGroups[0].tabs.length === 3 && ruleGroups[0].label === 'ML papers',
    JSON.stringify(ruleGroups.map(g => [g.label, g.tabs.length])));
  check('only one auto cluster remains after the rule',
    ruled.groups.filter(g => g.kind === 'topic').length === 1);

  // 4. Bad rule is skipped, not fatal
  const badRule = T.classify(fixture, { now: 1000, rules: [{ topicKey: 'Bad Key', topicLabel: 'x', keywords: [] }] });
  check('invalid rule is ignored', badRule.groups.filter(g => g.kind === 'rule').length === 0);

  // 5. Native groups come first, unnamed ones get "Group N"
  const withNative = T.classify(
    [tab(11, 'https://example.com/a', 'Anything at all', 7), ...fixture],
    { now: 1000, nativeGroups: { 7: { title: '' } } }
  );
  check('native group first with fallback label',
    withNative.groups[0].kind === 'native' && withNative.groups[0].label === 'Group 1' && withNative.groups[0].domain === '__native__7',
    JSON.stringify([withNative.groups[0].kind, withNative.groups[0].label, withNative.groups[0].domain]));

  // 6. CJK titles cluster by shared bigrams
  const cjk = T.classify([
    tab(20, 'https://zhuanlan.zhihu.com/p/1', '机器学习入门教程'),
    tab(21, 'https://zhuanlan.zhihu.com/p/2', '机器学习实战笔记'),
    tab(22, 'https://zhuanlan.zhihu.com/p/3', '周末旅行攻略分享'),
    tab(23, 'https://zhuanlan.zhihu.com/p/4', '周末旅行照片整理'),
  ], { now: 1000 });
  check('CJK titles form two clusters',
    cjk.groups.filter(g => g.kind === 'topic').length === 2,
    cjk.groups.map(g => `${g.label} (${g.tabs.length})`).join(' | '));

  // 7. Duplicate URLs land together; cache has one entry per URL
  const dupes = T.classify([...fixture, { ...fixture[0], id: 99 }], { now: 1000 });
  const dupeGroup = dupes.groups.find(g => g.tabs.some(t => t.id === 99));
  check('duplicate URL joins the same cluster',
    !!dupeGroup && dupeGroup.tabs.some(t => t.id === 1));
  check('cacheUpdate has one entry per clustered URL',
    Object.keys(dupes.cacheUpdate).length === 6, String(Object.keys(dupes.cacheUpdate).length));

  // 8. A fresh cache entry keeps the old label
  const cache = Object.fromEntries(fixture.slice(0, 3).map(t => [t.url, { title: t.text, key: '__topic__kept', label: 'Kept label', ts: 900 }]));
  const stable = T.classify(fixture, { now: 1000, cache });
  check('cached label is reused for a stable cluster',
    stable.groups.some(g => g.label === 'Kept label' && g.domain === '__topic__kept'));

  // 9. Empty input
  const empty = T.classify([], { now: 1000 });
  check('empty input yields no groups', empty.groups.length === 0 && empty.leftoverTabs.length === 0);

  // 10-13. Semantic path, with hand-made unit vectors standing in for the model.
  // Two "rates" titles share no word (one is Chinese); two "Kyoto" titles share one.
  const unit = (...xs) => { const n = Math.hypot(...xs); return Float32Array.from(xs.map(x => x / n)); };
  const sem = [
    tab(21, 'https://www.reuters.com/markets/fed', 'Fed holds interest rates steady'),
    tab(22, 'https://www.caixin.com/2026/fed.html', '美联储维持利率不变'),
    tab(23, 'https://www.japan-guide.com/kyoto', 'Kyoto 3-day itinerary'),
    tab(24, 'https://www.japan-guide.com/shinkansen', 'Tokyo to Kyoto by Shinkansen'),
    tab(25, 'https://www.theverge.com/mac-studio', 'Mac Studio M4 Ultra review'),
  ];
  const vectors = new Map([
    [sem[0].text, unit(1, 0.1, 0)],
    [sem[1].text, unit(0.95, 0.2, 0)],
    [sem[2].text, unit(0, 1, 0.1)],
    [sem[3].text, unit(0.1, 0.9, 0.2)],
    [sem[4].text, unit(0.2, 0, 1)],
  ]);
  const semOut = T.classify(sem, { now: 1000, embeddings: vectors });
  const ratesGroup = semOut.groups.find(g => g.tabs.some(t => t.id === 22));
  check('semantic: groups titles with no shared word',
    semOut.semantic === true && !!ratesGroup && ratesGroup.tabs.some(t => t.id === 21));
  check('semantic: unrelated title stays a leftover',
    semOut.leftoverTabs.some(t => t.id === 25) && !semOut.groups.some(g => g.tabs.some(t => t.id === 25)));
  check('semantic: no shared word -> label from the central title',
    !!ratesGroup && ratesGroup.label.length > 0 && ratesGroup.label.length <= T.TOPIC_CONFIG.MEDOID_LABEL_CHARS + 1, ratesGroup && ratesGroup.label);
  const kyotoGroup = semOut.groups.find(g => g.tabs.some(t => t.id === 23));
  check('semantic: shared word still names the card', !!kyotoGroup && kyotoGroup.label === 'Kyoto', kyotoGroup && kyotoGroup.label);

  // 14. One missing vector -> the whole step falls back to word overlap
  const partial = new Map([...vectors].slice(0, 4));
  check('semantic: a missing vector falls back to words', T.classify(sem, { now: 1000, embeddings: partial }).semantic === false);

  const report = { passed, failed };
  if (failed.length) console.warn('[tab-out] self-test FAILED', report);
  else console.info(`[tab-out] self-test passed (${passed.length} checks)`);
  return report;
}

// Node entry point: node extension/topics-selftest.js
if (typeof module !== 'undefined' && typeof require === 'function' && require.main === module) {
  const fs   = require('fs');
  const path = require('path');
  const vm   = require('vm');
  const sandbox = { console, URL };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['topics-stopwords.js', 'topics.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
  }
  const result = vm.runInContext(`(${tabOutSelfTest.toString()})()`, sandbox);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed.length === 0 ? 0 : 1);
}
