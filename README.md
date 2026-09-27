# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group, or by topic with one click. Close tabs with a satisfying swoosh + confetti.

No server. No account. No external API calls. Just a Chrome extension.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/zarazhangrui/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **By topic view** toggles the grid from domains to topics: your Chrome tab groups first, then your own keyword rules, then automatic clustering of similar titles, all on-device
- **Grouped by meaning, in any language** a small multilingual model runs inside the browser, so "Fed holds rates steady" and "美联储维持利率不变" land on the same card even with no shared word (optional one-time install, see below)
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **100% local** your data never leaves your machine
- **Pure Chrome extension** no server, no Node.js, no npm; one optional script downloads the topic model

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/zarazhangrui/tab-out.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Install the topic model (optional, one time per computer)**

```bash
bash scripts/setup-model.sh
```

This downloads about 145 MB into `extension/models/` and `extension/vendor/` (both gitignored) and checks every file against `scripts/model-files.sha256`. Running it again downloads nothing. Then reload Tab Out in `chrome://extensions`. Without this step, the topic view still works, using shared words only.

**4. Open a new tab**

You'll see Tab Out.

---

## How it works

```
You open a new tab
  -> Tab Out shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Toggle "By domain" / "By topic" in the section header
     (topic view: Chrome tab groups, then your rules, then similar titles)
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
```

Everything runs inside the Chrome extension. No external server, no API calls, and no tab title or URL is sent anywhere; the topic model runs in the browser. Two requests do leave the page and carry no title: the Google Fonts stylesheet, and Google's favicon service, which receives each tab's domain name to draw its icon. Saved tabs, the chosen view and the topic label cache are stored in `chrome.storage.local`; title vectors are cached in IndexedDB.

### How topic grouping works

**Technical:** The topic view uses only what Chrome already provides for every tab: the cleaned tab title plus the words in the URL path. No content scripts, no host permissions. Each tab is assigned in this order:

1. **Chrome tab group** -- if you put the tab in a native tab group, that group becomes a card (needs the `tabGroups` permission, read-only).
2. **Your rules** -- `LOCAL_TOPIC_RULES` in `config.local.js` (see below), matched on keywords or a pattern.
3. **Automatic clustering** -- tabs that are similar enough are merged with average-link clustering. Clusters need at least 2 tabs. "Similar" is measured one of two ways:
   - **By meaning (when the model is installed).** `embed-worker.js` runs [`Xenova/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) (int8 ONNX, 118 MB, 50+ languages) through [transformers.js](https://github.com/huggingface/transformers.js) 4.3.0 on WebAssembly, in a Web Worker. Each cleaned title becomes a 384-number vector; tabs merge when their average cosine similarity is at least 0.40. The model reads each title once; its vector is cached in IndexedDB (model + title as the key, the 5,000 most recently used kept). On a new-tab page with new titles, the grid first shows word-based groups with a "refining…" note, then repaints by itself (about 1.5 s the first time, including loading the model; about 70 ms afterwards). The header says **semantic** when meaning was used.
   - **By shared words (otherwise).** Titles are split into words, weighted (title words count 1, path words 0.5), and tabs whose word overlap scores at least 0.25 are merged. The header says **words only**.

   Either way, a card is named by the words most of its tabs share (top 3). When the tabs share no word, as with an English and a Chinese title, the card takes the first words of its most central title.
4. **Everything else** stays in its normal domain card, shown after the topic cards.

Labels are cached per URL for 7 days so cards keep their names between new-tab pages. "Close all" on a topic card closes only that card's tabs, by tab id.

Why this model and 0.40: `scripts/bench-embeddings.mjs` scores both 118 MB multilingual candidates on 37 labelled titles (`tests/fixtures/topic-titles.json`). `paraphrase-multilingual-MiniLM-L12-v2` separated topics about 7x better than `multilingual-e5-small` (cosine gap 0.279 vs 0.041). At 0.40 every card it formed was correct (precision 1.0, recall 0.33, against 0.10 for word overlap); at 0.36 unrelated tabs start to merge.

**In plain terms:** Chrome already tells the extension the title of every open tab. Tab Out groups tabs in three steps. Groups you made in Chrome come first. Then come groups from keywords you wrote in your config. Last, Tab Out finds groups by itself.

For that last step, a small AI model that lives inside the extension reads each title and turns it into a "meaning fingerprint". Tabs with close fingerprints go on one card, even when they share no word or use different languages. For example, an English news tab about the Fed and a Chinese one about 美联储 end up together. The model never sends anything anywhere; it runs on your computer, like a calculator. It reads each title only once and remembers the result, so later new-tab pages are instant. If the model is not installed, Tab Out groups tabs that share words instead. Anything it is not sure about stays in the usual domain card.

---

## Personal config

Copy `extension/config.local.example.js` to `extension/config.local.js` (gitignored, never pushed) and reload the extension. Every array is optional.

| Array | What it does | Example |
|-------|--------------|---------|
| `LOCAL_LANDING_PAGE_PATTERNS` | Extra homepages for the Homepages card | `{ hostname: 'app.slack.com', pathExact: ['/'] }` |
| `LOCAL_CUSTOM_GROUPS` | Merge subdomains or split a site by path in the domain view | `{ hostnameEndsWith: '.atlassian.net', groupKey: 'jira', groupLabel: 'Jira' }` |
| `LOCAL_TOPIC_RULES` | Named topics for the topic view; first match wins | `{ topicKey: 'ml-papers', topicLabel: 'ML papers', keywords: ['transformer', 'attention'] }` |

Rule fields: `hostname` or `hostnameEndsWith` (optional narrowing), `pathPrefix` (optional), `keywords` (whole words, matched against the cleaned title and URL path) and/or `pattern` (a regular expression tested against title + URL). Keys must be lowercase slugs (`a-z`, `0-9`, `-`).

To check the classifier after editing rules or thresholds, open devtools on the new-tab page and run `tabOutSelfTest()`, or run `node extension/topics-selftest.js` from the repo root.

Developer checks for the topic model (need Node; nothing is saved to the repo):

```bash
# Compare models and thresholds on the 37 labelled titles
npm install --no-save --package-lock=false --prefix /tmp/tabout-dev @huggingface/transformers@4.3.0
NODE_PATH=/tmp/tabout-dev/node_modules node scripts/bench-embeddings.mjs

# Load the extension in a throwaway browser profile and check grouping, caching and privacy
npm install --no-save --package-lock=false --prefix /tmp/tabout-dev playwright-core@1.58.0
NODE_PATH=/tmp/tabout-dev/node_modules node tests/semantic.e2e.cjs   # TABOUT_BROWSER=<path> to pick a browser
```

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Topic grouping | Average-link clustering in plain JS (`extension/topics.js`); word overlap + cosine, stopword list from [tiny-tfidf](https://github.com/kerryrodden/tiny-tfidf) (MIT) |
| Topic model | [transformers.js](https://github.com/huggingface/transformers.js) 4.3.0 (Apache-2.0) + onnxruntime-web WASM, in a Web Worker; model [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) (Apache-2.0), installed by `scripts/setup-model.sh` |
| Title vector cache | IndexedDB |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui)
