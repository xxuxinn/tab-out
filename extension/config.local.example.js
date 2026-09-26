/* ================================================================
   Tab Out — Personal config (example)

   Copy this file to config.local.js in the same folder. That file is
   gitignored, so your own sites and rules never reach GitHub. Every
   array is optional; if config.local.js is missing, Tab Out uses its
   built-in defaults. Reload the extension in chrome://extensions
   after editing.
   ================================================================ */

// Extra "homepage" URLs to pull into the Homepages card.
// Match by exact hostname or by suffix (hostnameEndsWith), then optionally
// narrow by path: pathExact (list), pathPrefix (string), or test(pathname, url).
// With no path option, only the root path "/" counts.
const LOCAL_LANDING_PAGE_PATTERNS = [
  // { hostname: 'app.slack.com',            pathExact: ['/'] },
  // { hostnameEndsWith: '.atlassian.net',   pathPrefix: '/jira/your-work' },
];

// Custom cards for the domain view: merge subdomains or split one site by path.
// groupKey must be a lowercase slug (a-z, 0-9, -); groupLabel is what the card shows.
const LOCAL_CUSTOM_GROUPS = [
  // { hostnameEndsWith: '.atlassian.net', groupKey: 'jira',      groupLabel: 'Jira' },
  // { hostname: 'github.com', pathPrefix: '/my-org/', groupKey: 'work-code', groupLabel: 'Work code' },
];

// Topic rules for the "By topic" view. First matching rule wins; rules run
// after Chrome's own tab groups and before automatic clustering.
// Required: topicKey (lowercase slug), topicLabel, and keywords[] and/or pattern.
//   keywords: whole words, matched against the cleaned title and URL path words
//   pattern:  a regular expression tested against "cleaned title + URL"
// Optional narrowing: hostname, hostnameEndsWith, pathPrefix.
const LOCAL_TOPIC_RULES = [
  // { topicKey: 'ml-papers',  topicLabel: 'ML papers',  keywords: ['transformer', 'attention', 'diffusion'], hostnameEndsWith: 'arxiv.org' },
  // { topicKey: 'house-move', topicLabel: 'House move', pattern: /\b(mortgage|conveyanc\w+|rightmove|zoopla)\b/i },
  // { topicKey: 'teaching',   topicLabel: 'Teaching',   keywords: ['syllabus', 'lecture', 'assignment', 'rubric'] },
];
