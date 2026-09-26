/* ================================================================
   Tab Out — Tab Grouping

   Pure functions that turn the list of open tabs into the cards the
   dashboard renders. Two views:

     buildDomainGroups(tabs)      the classic view: one card per
                                  hostname, plus Homepages and any
                                  LOCAL_CUSTOM_GROUPS from config.local.js
     buildTopicView(tabs, ctx)    Homepages first, then topic cards
                                  from TabOutTopics.classify (native
                                  Chrome groups, LOCAL_TOPIC_RULES,
                                  automatic clusters), then ordinary
                                  domain cards for whatever is left

   Group shape (what renderDomainCard and the close handlers read):
     { domain: string, label?: string, kind: GROUP_KINDS.*, tabs: Tab[] }

   This file is loaded after config.local.js and before app.js. Its
   functions are only *called* from app.js at render time, so they may
   use app.js helpers such as cleanTitle, which exist by then.
   ================================================================ */

'use strict';

const VIEW_MODES  = Object.freeze({ DOMAIN: 'domain', TOPIC: 'topic' });
const GROUP_KINDS = Object.freeze({
  LANDING: 'landing', CUSTOM: 'custom', DOMAIN: 'domain',
  NATIVE: 'native', RULE: 'rule', TOPIC: 'topic',
});
const LANDING_KEY     = '__landing-pages__';
const LOCAL_FILES_KEY = 'local-files';

// Landing pages (Gmail inbox, X home, etc.) get their own card so they can be
// closed together without touching content tabs on the same domain.
const LANDING_PAGE_PATTERNS = Object.freeze([
  { hostname: 'mail.google.com', test: (p, h) =>
      !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
  { hostname: 'x.com',               pathExact: ['/home'] },
  { hostname: 'www.linkedin.com',    pathExact: ['/'] },
  { hostname: 'github.com',          pathExact: ['/'] },
  { hostname: 'www.youtube.com',     pathExact: ['/'] },
  // Personal patterns from config.local.js (if the file exists)
  ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
]);

// Custom group rules from config.local.js (merge subdomains, split by path)
const CUSTOM_GROUP_RULES = Object.freeze(
  typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : []
);

const LANDING_HOSTNAMES = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
const LANDING_SUFFIXES  = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);


/* ----------------------------------------------------------------
   MATCHERS
   ---------------------------------------------------------------- */

function hostnameMatches(rule, hostname) {
  if (rule.hostname)         return hostname === rule.hostname;
  if (rule.hostnameEndsWith) return hostname.endsWith(rule.hostnameEndsWith);
  return false;
}

function isLandingPage(url) {
  try {
    const parsed = new URL(url);
    return LANDING_PAGE_PATTERNS.some(p => {
      if (!hostnameMatches(p, parsed.hostname)) return false;
      if (p.test)       return p.test(parsed.pathname, url);
      if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
      if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
      return parsed.pathname === '/';
    });
  } catch { return false; }
}

function matchCustomGroup(url) {
  try {
    const parsed = new URL(url);
    return CUSTOM_GROUP_RULES.find(r =>
      hostnameMatches(r, parsed.hostname)
      && (!r.pathPrefix || parsed.pathname.startsWith(r.pathPrefix))
    ) || null;
  } catch { return null; }
}

function isLandingDomain(domain) {
  if (LANDING_HOSTNAMES.has(domain)) return true;
  return LANDING_SUFFIXES.some(s => domain.endsWith(s));
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// Which card a tab belongs to in the domain view: { key, label?, kind } or null
function domainSlotFor(tab) {
  if (isLandingPage(tab.url)) return { key: LANDING_KEY, kind: GROUP_KINDS.LANDING };
  const custom = matchCustomGroup(tab.url);
  if (custom) return { key: custom.groupKey, label: custom.groupLabel, kind: GROUP_KINDS.CUSTOM };
  if (tab.url && tab.url.startsWith('file://')) return { key: LOCAL_FILES_KEY, kind: GROUP_KINDS.DOMAIN };
  const hostname = hostnameOf(tab.url);
  return hostname ? { key: hostname, kind: GROUP_KINDS.DOMAIN } : null;
}


/* ----------------------------------------------------------------
   DOMAIN VIEW
   ---------------------------------------------------------------- */

// Landing pages first, then domains that have landing-page patterns, then by tab count
function compareDomainGroups(a, b) {
  const aIsLanding = a.kind === GROUP_KINDS.LANDING;
  const bIsLanding = b.kind === GROUP_KINDS.LANDING;
  if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
  const aIsPriority = isLandingDomain(a.domain);
  const bIsPriority = isLandingDomain(b.domain);
  if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
  return b.tabs.length - a.tabs.length;
}

/** buildDomainGroups(tabs) -> Group[]   (pure; malformed URLs are skipped) */
function buildDomainGroups(tabs) {
  const slots = new Map();
  for (const tab of tabs) {
    const slot = domainSlotFor(tab);
    if (!slot) continue;
    const prev = slots.get(slot.key) || { domain: slot.key, label: slot.label, kind: slot.kind, tabs: [] };
    slots.set(slot.key, { ...prev, tabs: [...prev.tabs, tab] });
  }
  return [...slots.values()].map(Object.freeze).sort(compareDomainGroups);
}


/* ----------------------------------------------------------------
   TOPIC VIEW
   ---------------------------------------------------------------- */

function cleanedTitleFor(tab) {
  return cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), hostnameOf(tab.url));
}

/**
 * buildTopicView(realTabs, ctx) -> { groups, topicCount, cacheUpdate }
 * ctx is passed straight to TabOutTopics.classify:
 *   { rules, nativeGroups, cache, now }
 */
function buildTopicView(realTabs, ctx) {
  if (typeof TabOutTopics === 'undefined') {
    throw new Error('topics.js did not load');
  }
  const landingTabs = realTabs.filter(t => isLandingPage(t.url));
  const contentTabs = realTabs.filter(t => !isLandingPage(t.url)).map(t => ({ ...t, text: cleanedTitleFor(t) }));

  const { groups: topicGroups, leftoverTabs, cacheUpdate } = TabOutTopics.classify(contentTabs, ctx);

  // Leftovers go through the ordinary domain grouping so custom rules and file:// behave as usual
  const domainPart = buildDomainGroups([...landingTabs, ...leftoverTabs]);
  const landing    = domainPart.filter(g => g.kind === GROUP_KINDS.LANDING);
  const rest       = domainPart.filter(g => g.kind !== GROUP_KINDS.LANDING);

  return Object.freeze({
    groups:     [...landing, ...topicGroups, ...rest],
    topicCount: topicGroups.length,
    cacheUpdate,
  });
}

window.TabOutGrouping = Object.freeze({
  VIEW_MODES, GROUP_KINDS, LANDING_KEY,
  buildDomainGroups, buildTopicView, isLandingPage, hostnameOf,
});
