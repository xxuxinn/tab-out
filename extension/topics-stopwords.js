/* ================================================================
   Tab Out — Topic Stopwords

   Word lists used by topics.js to decide which words carry topic
   meaning. Three lists:
     TOPIC_STOPWORDS            everyday English function words
     TOPIC_PATH_STOPWORDS       URL path segments that name page
                                types, not topics ("watch", "blob")
     TOPIC_GENERIC_TITLE_TOKENS title words that appear on any site
                                ("sign", "login", "untitled")

   TOPIC_STOPWORDS is vendored from tiny-tfidf (src/Stopwords.js),
   MIT License, Copyright (c) 2019 Kerry Rodden.
   https://github.com/kerryrodden/tiny-tfidf
   That list is in turn based on NLTK's English stopwords.
   ================================================================ */

'use strict';

const TOPIC_STOPWORDS = new Set([
  'i', 'a', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'an', 'the',
  'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with',
  'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'can', 'will', 'just', 'don', 'could', 'should', 'would', 'now', 'll',
  're', 've', 'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn', 'mustn', 'needn',
  'shouldn', 'wasn', 'weren', 'won', 'wouldn',
  // Tab Out additions: words common in page titles that say nothing about the topic
  'via', 'using', 'with', 'without', 'new', 'best', 'top', 'free', 'guide', 'introduction',
  'official', 'site', 'website', 'online', 'part', 'vs', 'versus',
]);

const TOPIC_PATH_STOPWORDS = new Set([
  'index', 'html', 'htm', 'php', 'aspx', 'jsp', 'en', 'www', 'watch', 'status', 'comments',
  'pull', 'issues', 'blob', 'tree', 'wiki', 'search', 'view', 'item', 'items', 'post', 'posts',
  'article', 'articles', 'page', 'pages', 'docs', 'doc', 'document', 'edit', 'amp', 'abs', 'pdf',
  'main', 'master', 'src', 'user', 'users', 'profile', 'home', 'mail', 'inbox', 'thread',
  'video', 'videos', 'playlist', 'channel', 'shorts', 'results', 'query', 'tag', 'tags',
]);

const TOPIC_GENERIC_TITLE_TOKENS = new Set([
  'sign', 'signin', 'login', 'log', 'logout', 'home', 'homepage', 'untitled', 'new', 'tab',
  'page', 'loading', 'error', '404', 'welcome', 'dashboard', 'account', 'accounts', 'settings',
  'notifications', 'inbox', 'feed', 'timeline', 'explore', 'trending', 'search', 'results',
]);
