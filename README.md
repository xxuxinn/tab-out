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
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **100% local** your data never leaves your machine
- **Pure Chrome extension** no server, no Node.js, no npm, no setup beyond loading the extension

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

**3. Open a new tab**

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

Everything runs inside the Chrome extension. No external server, no API calls, no data sent anywhere. Saved tabs, the chosen view and the topic label cache are stored in `chrome.storage.local`.

### How topic grouping works

**Technical:** The topic view uses only what Chrome already provides for every tab: the cleaned tab title plus the words in the URL path. No content scripts, no extra host permissions. Each tab is assigned in this order:

1. **Chrome tab group** -- if you put the tab in a native tab group, that group becomes a card (needs the `tabGroups` permission, read-only).
2. **Your rules** -- `LOCAL_TOPIC_RULES` in `config.local.js` (see below), matched on keywords or a pattern.
3. **Automatic clustering** -- titles are split into words, weighted (title words count 1, path words 0.5), and tabs whose word overlap scores at least 0.25 are merged into a cluster labelled by its top 3 shared words. Clusters need at least 2 tabs.
4. **Everything else** stays in its normal domain card, shown after the topic cards.

Labels are cached per URL for 7 days so cards keep their names between new-tab pages. "Close all" on a topic card closes only that card's tabs, by tab id.

**In plain terms:** Chrome already tells the extension the title of every open tab. Tab Out cleans those titles and groups tabs whose titles share words. Groups you made in Chrome come first, then groups from keywords you wrote in your config, then groups Tab Out finds by itself. Anything it is not sure about stays in the usual domain card.

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

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Topic grouping | Word overlap + cosine similarity + average-link clustering in plain JS (`extension/topics.js`); stopword list from [tiny-tfidf](https://github.com/kerryrodden/tiny-tfidf) (MIT) |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui)
