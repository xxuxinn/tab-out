/* ================================================================
   Tab Out — semantic topic view, end-to-end in a real browser

   Loads extension/ unpacked into a throwaway Chromium profile, opens
   the 37 fixture tabs from tests/fixtures/topic-titles.json (served
   locally by Playwright, so no real site is contacted), switches to
   "By topic", and checks that:
     1. the grid repaints to "semantic" by itself once titles are embedded
     2. titles with no shared word group together, across English and
        Chinese (Fed <-> 美联储, Kyoto <-> 京都, pancakes <-> 松饼)
     3. unrelated tabs do not join a topic
     4. a second new-tab page is "semantic" straight away (IndexedDB cache)
     5. no request leaves the machine except two that predate the model
        and carry no title: the Google Fonts stylesheet and Google's
        favicon service (domain only). Both are blocked and listed.
     6. without the model files (setup-model.sh not run yet), the topic
        view still works and says "words only"

   Needs: bash scripts/setup-model.sh (model files), and playwright-core:
     npm install --no-save --package-lock=false --prefix /tmp/pw playwright-core@1.58.0
     NODE_PATH=/tmp/pw/node_modules node tests/semantic.e2e.cjs
   Browser: TABOUT_BROWSER (default: Brave, then Google Chrome for Testing
   / Chromium, which still accept --load-extension).
   ================================================================ */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT    = path.join(__dirname, '..');
const EXT     = path.join(ROOT, 'extension');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'topic-titles.json'), 'utf8')).rows;
const BROWSER = process.env.TABOUT_BROWSER || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const SEMANTIC_TIMEOUT_MS = 120000;

// Pairs that share no word and must land on the same card
const MUST_GROUP = [
  ['Fed holds interest rates steady', '美联储维持利率不变'],
  ['Kyoto 3-day itinerary', '京都红叶最佳观赏地点'],
  ['Classic buttermilk pancakes', '松饼的做法 家常简单版'],
  ['Agent memory: how LLM agents remember across sessions', '长期记忆：让大模型智能体记住上下文'],
];
// Not listed: "Grading rubric for case write-ups" <-> "课堂参与评分标准" scores 0.388,
// just under SEMANTIC_THRESHOLD 0.40, so leaving it apart is correct.
// Titles that must not share a card with each other
const MUST_SEPARATE = [
  ['MemGPT: Towards LLMs as Operating Systems', 'Mac Studio M4 Ultra review'],
  ['Invoice #4821 – Acme Ltd', 'Sign in – Google Accounts'],
];

const urlOf = title => FIXTURE.find(r => r[1] === title)[2];
const noHash = url => url.split('#')[0];   // requests never carry the #fragment
const fixtureFor = url => FIXTURE.find(r => noHash(r[2]) === noHash(url));
// Existing Tab Out requests, unrelated to the model: fonts, and favicons by domain
const KNOWN_EXTERNAL = /^https:\/\/(fonts\.(googleapis|gstatic)\.com\/|www\.google\.com\/s2\/favicons\?)/;
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function readCards(page) {
  return page.$$eval('#openTabsMissions .mission-card', cards => cards.map(c => ({
    label: (c.querySelector('.mission-name') || {}).textContent || '',
    urls:  [...c.querySelectorAll('.page-chip[data-tab-url]')].map(ch => ch.dataset.tabUrl),
  })));
}

async function badgeText(page) {
  return page.$eval('#openTabsSectionCount', el => {
    const b = el.querySelector('.similarity-badge');
    return b ? b.textContent.trim() : '';
  }).catch(() => '');
}

async function launch(extDir, profile) {
  return chromium.launchPersistentContext(profile, {
    executablePath: BROWSER,
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

async function serveFixtures(context, offMachine, knownExternal) {
  await context.route('**/*', route => {
    const url = route.request().url();
    const row = fixtureFor(url);
    if (row) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<title>${escapeHtml(row[1])}</title><p>fixture</p>` });
    }
    if (/^https?:/.test(url)) {
      (KNOWN_EXTERNAL.test(url) ? knownExternal : offMachine).push(url);
      return route.abort();
    }
    return route.continue();
  });
}

async function openFixtureTabs(context, rows) {
  for (const [, , url] of rows) {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
  }
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  return new URL(sw.url()).host;
}

// 6. A copy of extension/ without models/ and vendor/, as on a Mac before setup-model.sh
async function checkWithoutModel(check) {
  const tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'tabout-nomodel-'));
  const extCopy = path.join(tmp, 'extension');
  const profile = path.join(tmp, 'profile');
  const skip    = new Set(['models', 'vendor']);
  fs.cpSync(EXT, extCopy, { recursive: true, filter: src => !skip.has(path.relative(EXT, src).split(path.sep)[0]) });
  const context = await launch(extCopy, profile);
  try {
    await serveFixtures(context, [], []);
    const extId = await openFixtureTabs(context, FIXTURE.slice(0, 16));
    const page  = await context.newPage();
    await page.goto(`chrome-extension://${extId}/index.html`);
    await page.click('[data-action="set-group-view"][data-view="topic"]');
    await page.waitForSelector('#openTabsSectionCount .similarity-badge', { timeout: 10000 });
    const badge = await badgeText(page);
    const cards = await readCards(page);
    check('without model files: topic view renders, "words only"', badge === 'words only' && cards.length > 0,
      `"${badge}", ${cards.length} cards`);
  } finally {
    await context.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tabout-e2e-'));
  const offMachine = [];
  const knownExternal = [];
  const failures = [];
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(name);
  };

  const context = await launch(EXT, profile);

  try {
    // Serve every fixture URL locally; block and record anything else off-machine
    await serveFixtures(context, offMachine, knownExternal);

    const extId = await openFixtureTabs(context, FIXTURE);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/index.html`);
    await page.click('[data-action="set-group-view"][data-view="topic"]');

    // 1. First visit: "refining…", then it repaints to "semantic" on its own
    const t0 = Date.now();
    await page.waitForFunction(() => {
      const b = document.querySelector('#openTabsSectionCount .similarity-badge');
      return b && b.textContent.trim() === 'semantic';
    }, null, { timeout: SEMANTIC_TIMEOUT_MS });
    check('grid repaints to "semantic" after embedding', true, `${Date.now() - t0} ms incl. model load`);

    const cards = await readCards(page);
    const cardOf = title => cards.find(c => c.urls.includes(urlOf(title)));

    // 2 + 3. Grouping
    for (const [a, b] of MUST_GROUP) {
      const ca = cardOf(a);
      check(`same card: "${a}" + "${b}"`, !!ca && ca === cardOf(b), ca ? `card "${ca.label}"` : 'not found');
    }
    for (const [a, b] of MUST_SEPARATE) {
      const ca = cardOf(a);
      check(`different cards: "${a}" / "${b}"`, !ca || ca !== cardOf(b));
    }

    // 4. Second page: semantic at once, from the cache
    const page2 = await context.newPage();
    const t1 = Date.now();
    await page2.goto(`chrome-extension://${extId}/index.html`);
    await page2.waitForSelector('#openTabsSectionCount .similarity-badge', { timeout: 10000 });
    const second = await badgeText(page2);
    check('second new-tab page is "semantic" at once (cached)', second === 'semantic', `"${second}" after ${Date.now() - t1} ms`);

    // 5. Privacy
    check('no unexpected request left the machine', offMachine.length === 0, offMachine.slice(0, 3).join(', '));
    const favicons = new Set(knownExternal.filter(u => u.includes('/s2/favicons')).map(u => new URL(u).searchParams.get('domain')));
    console.log(`  note  blocked ${knownExternal.length} existing font/favicon requests (favicons for ${favicons.size} domains; no titles)`);

    console.log('\nTopic cards:');
    for (const c of cards) {
      const titles = c.urls.map(u => (FIXTURE.find(r => r[2] === u) || [, u])[1]);
      console.log(`  ${c.label}: ${titles.join(' | ')}`);
    }
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }

  await checkWithoutModel(check);

  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
