/**
 * API client for Reddit Top Light (SFW)
 * Handles Subranking and PullPush APIs with caching, rate limiting, and retry
 */

const PULLPUSH_BASE = 'https://api.pullpush.io/reddit/search/submission/';

// In-memory cache for post data
const memCache = new Map();
const inflight = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(fetchFn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchFn();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
}

// --- Subreddit About (pre-fetched cache from fetch_subreddits.py) ---

let _aboutCache = null;
let _aboutCachePromise = null;

/**
 * Load the pre-fetched about cache (about_cache.json).
 * Returns a Map of lowercase subreddit name -> about data.
 */
async function loadAboutCache() {
  if (_aboutCache) return _aboutCache;
  if (_aboutCachePromise) return _aboutCachePromise;

  _aboutCachePromise = (async () => {
    try {
      const ts = await getMetaTimestamp();
      const url = `data/about_cache.json${ts ? '?v=' + encodeURIComponent(ts) : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      _aboutCache = await response.json();
    } catch (e) {
      _aboutCache = {};
    }
    _aboutCachePromise = null;
    return _aboutCache;
  })();
  return _aboutCachePromise;
}

/**
 * Get about data for a subreddit from the pre-fetched cache.
 * Returns { subscribers, accounts_active, created_utc, over_18, ... } or null.
 */
export async function fetchSubredditAbout(subreddit) {
  const cache = await loadAboutCache();
  return cache[subreddit.toLowerCase()] || null;
}

// --- SFW overrides (subreddits that should never be blocked) ---

let _sfwOverrides = null;
let _sfwOverridesPromise = null;

async function loadSfwOverrides() {
  if (_sfwOverrides) return _sfwOverrides;
  if (_sfwOverridesPromise) return _sfwOverridesPromise;

  _sfwOverridesPromise = (async () => {
    try {
      const response = await fetch('data/sfw_overrides.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const list = await response.json();
      _sfwOverrides = new Set(list.map(s => s.toLowerCase()));
    } catch (e) {
      _sfwOverrides = new Set();
    }
    _sfwOverridesPromise = null;
    return _sfwOverrides;
  })();
  return _sfwOverridesPromise;
}

/**
 * Check if a subreddit is NSFW.
 * Checks sfw_overrides (always allowed), about cache, Reddit API,
 * PullPush API, then blocks unknown subs for safety.
 */
export async function checkSubredditNsfw(subreddit) {
  // Check SFW overrides first — these are never blocked
  const overrides = await loadSfwOverrides();
  if (overrides.has(subreddit.toLowerCase())) return false;

  // Check about cache — only trust over18=true (block); false may be stale
  const about = await fetchSubredditAbout(subreddit);
  if (about && about.over18 === true) return true;

  // Fallback: check via PullPush (CORS-enabled)
  try {
    const url = `${PULLPUSH_BASE}?subreddit=${encodeURIComponent(subreddit)}&sort_type=score&sort=desc&size=1`;
    const response = await fetchWithRetry(() => fetch(url));
    const json = await response.json();
    if (json.data && json.data.length > 0) {
      return !!json.data[0].over_18;
    }
  } catch (e) {
    // On error, fall through to block
  }

  // If sub is in about cache with over18=false, trust it
  if (about) return false;

  // Unknown subreddit — block for safety
  return true;
}

// --- Subreddit Directory (local JSON, pre-fetched by fetch_subreddits.py) ---

let _metaTimestamp = null;

async function getMetaTimestamp() {
  if (_metaTimestamp) return _metaTimestamp;
  try {
    const response = await fetch('data/meta.json');
    if (response.ok) {
      const meta = await response.json();
      _metaTimestamp = meta.fetched_at || '';
    }
  } catch (e) {
    // Ignore — will use empty string (no cache bust)
  }
  return _metaTimestamp || '';
}

export async function fetchAllSubredditsCached(type) {
  const ts = await getMetaTimestamp();
  const url = `data/${type}.json${ts ? '?v=' + encodeURIComponent(ts) : ''}`;
  const response = await fetchWithRetry(() => fetch(url));
  return response.json();
}

// --- Subreddit earliest post ---

const earliestPostCache = new Map();

/**
 * Find the earliest post timestamp for a subreddit via PullPush.
 * Returns unix timestamp (seconds) or null on failure.
 */
export async function fetchSubredditCreatedDate(subreddit) {
  const key = subreddit.toLowerCase();
  if (earliestPostCache.has(key)) return earliestPostCache.get(key);

  try {
    const url = `${PULLPUSH_BASE}?subreddit=${encodeURIComponent(subreddit)}&sort_type=created_utc&sort=asc&size=1`;
    const response = await fetchWithRetry(() => fetch(url));
    const json = await response.json();
    if (json.data && json.data.length > 0) {
      earliestPostCache.set(key, json.data[0].created_utc);
      return json.data[0].created_utc;
    }
  } catch (e) {
    // Fallback — return null, slider will use default epoch
  }
  earliestPostCache.set(key, null);
  return null;
}

// --- PullPush API ---

/**
 * Find the most recent post timestamp for a subreddit.
 * Uses a wide time range to quickly detect where data starts.
 */
export async function probeLatestPost(subreddit) {
  const now = Math.floor(Date.now() / 1000);
  const fiveYearsAgo = now - (5 * 365 * 24 * 3600);
  const url = `${PULLPUSH_BASE}?subreddit=${encodeURIComponent(subreddit)}&sort_type=created_utc&sort=desc&size=1&after=${fiveYearsAgo}&before=${now}`;

  try {
    const response = await fetchWithRetry(() => fetch(url));
    const json = await response.json();
    if (json.data && json.data.length > 0) {
      return json.data[0].created_utc;
    }
  } catch (e) {
    // Fall through - no data found
  }
  return null;
}

export async function fetchPosts(subreddit, after, before, size = 10) {
  const url = `${PULLPUSH_BASE}?subreddit=${encodeURIComponent(subreddit)}&sort_type=score&sort=desc&size=${size}&after=${after}&before=${before}`;

  // Check in-memory cache
  if (memCache.has(url)) return memCache.get(url);

  // Check inflight dedup
  if (inflight.has(url)) return inflight.get(url);

  const promise = (async () => {
    try {
      const response = await fetchWithRetry(() => fetch(url));
      const json = await response.json();
      if (json.error) throw new Error(`PullPush error: ${json.error}`);
      const data = json.data || [];
      memCache.set(url, data);
      return data;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, promise);
  return promise;
}
