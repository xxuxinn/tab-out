# AGENTS.md -- Tab Out: Setup & Onboarding Guide for Coding Agents

You're installing **Tab Out** for the user. Your job is not just to set it up -- it's to get them excited about using it.

---

## Step 0 -- Introduce the product

Before doing anything technical, tell the user what they're about to get:

> **Tab Out** replaces your new tab page with a clean dashboard of everything you have open, grouped by domain.
>
> Here's what makes it great:
> - **See all your open tabs at a glance** grouped by domain on a grid
> - **Homepages group** pulls Gmail, X, LinkedIn, YouTube, GitHub homepages into one card for easy cleanup
> - **By topic view** regroups the grid by what the pages are about: your Chrome tab groups first, then your own keyword rules, then similar titles clustered automatically, all on-device
> - **Grouped by meaning, in any language** a small multilingual model runs inside the browser, so an English and a Chinese tab about the same thing share a card
> - **Close tabs with style** satisfying swoosh sound + confetti burst
> - **Duplicate detection** flags when you have the same page open twice
> - **Click any tab title to jump to it** even across different Chrome windows
> - **Save for later** bookmark individual tabs to a checklist before closing them
> - **100% local** no server, no accounts, no data sent anywhere
>
> It's just a Chrome extension. Setup takes about 1 minute.

---

## Step 1 -- Clone the repo

```bash
git clone https://github.com/zarazhangrui/tab-out.git
cd tab-out
```

---

## Step 2 -- Install the topic model (one time, about 145 MB)

Run this from the repo root. It downloads the in-browser model and its library into `extension/models/` and `extension/vendor/` (gitignored) and verifies checksums. It is safe to run again: a second run downloads nothing.

```bash
bash scripts/setup-model.sh
```

If the download fails (for example, no network), carry on. Tab Out still works, and its topic view groups by shared words until the script has run. Tell the user they can run it later and then reload the extension.

---

## Step 3 -- Install the Chrome extension

This is the one step that requires manual action from the user. Make it as easy as possible.

**First**, print the full path to the `extension/` folder:
```bash
echo "Extension folder: $(cd extension && pwd)"
```

**Then**, copy the `extension/` folder path to their clipboard:
- macOS: `cd extension && pwd | pbcopy && echo "Path copied to clipboard"`
- Linux: `cd extension && pwd | xclip -selection clipboard 2>/dev/null || echo "Path: $(pwd)"`
- Windows: `cd extension && echo %CD% | clip`

**Then**, open the extensions page:
```bash
open "chrome://extensions"
```

**Then**, walk the user through it step by step:

> I've copied the extension folder path to your clipboard. Now:
>
> 1. You should see Chrome's extensions page. In the **top-right corner**, toggle on **Developer mode** (it's a switch).
> 2. Once Developer mode is on, you'll see a button called **"Load unpacked"** appear in the top-left. Click it.
> 3. A file picker will open. **Press Cmd+Shift+G** (Mac) or **Ctrl+L** (Windows/Linux) to open the "Go to folder" bar, then **paste** the path I copied (Cmd+V / Ctrl+V) and press Enter.
> 4. Click **"Select"** or **"Open"** and the extension will install.
>
> You should see "Tab Out" appear in your extensions list.

**Also**, open the file browser directly to the extension folder as a fallback:
- macOS: `open extension/`
- Linux: `xdg-open extension/`
- Windows: `explorer extension\\`

---

## Step 4 -- Show them around

Once the extension is loaded:

> You're all set! Open a **new tab** and you'll see Tab Out.
>
> Here's how it works:
> 1. **Your open tabs are grouped by domain** in a grid layout.
> 2. **Homepages** (Gmail inbox, X home, YouTube, etc.) are in their own group at the top.
> 3. **Click any tab title** to jump directly to that tab.
> 4. **Click the X** next to any tab to close just that one (with swoosh + confetti).
> 5. **Click "Close all N tabs"** on a group to close the whole thing.
> 6. **Duplicate tabs** are flagged with an amber "(2x)" badge. Click "Close duplicates" to keep one copy.
> 7. **Save a tab for later** by clicking the bookmark icon before closing it. Saved tabs appear in the sidebar.
> 8. **Click "By topic"** in the section header to regroup by what the tabs are about. Your Chrome tab groups show first, then any rules from your personal config, then tabs with similar meaning clustered together. The header says "semantic" when the on-device model did the grouping. Tab Out remembers which view you chose.
>
> That's it! No server to run, no config files required. (Optional: copy `extension/config.local.example.js` to `extension/config.local.js` for personal homepages, custom groups and topic rules.)

---

## Key Facts

- Tab Out is a pure Chrome extension. No server, no Node.js, no npm.
- Saved tabs are stored in `chrome.storage.local` (persists across sessions).
- 100% local. No tab title or URL is sent to any external service. Topic grouping runs on tab titles and URL paths inside the extension page; the `tabGroups` permission is used only to read the names of Chrome tab groups. (Two requests that carry no title do leave the page: Google Fonts, and Google's favicon service, which receives each tab's domain.)
- Semantic topics: `scripts/setup-model.sh` installs `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (int8, 118 MB) and transformers.js 4.3.0, pinned by SHA-256 in `scripts/model-files.sha256`. The model runs in a Web Worker (`extension/embed-worker.js`) with remote model loading switched off, and caches title vectors in IndexedDB. The manifest adds only `'wasm-unsafe-eval'` to the page's content security policy; no new permissions.
- Personal config is optional: `extension/config.local.example.js` documents `LOCAL_LANDING_PAGE_PATTERNS`, `LOCAL_CUSTOM_GROUPS` and `LOCAL_TOPIC_RULES`; the real `config.local.js` is gitignored.
- To update: `cd tab-out && git pull && bash scripts/setup-model.sh`, then reload the extension in `chrome://extensions`.
