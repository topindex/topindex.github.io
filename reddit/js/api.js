/**
 * API client for Reddit Top Light (SFW).
 */
import { fetchHybridTopPosts } from '../../shared/hybrid-top-posts.js';

const defaultApiBase =
  location.protocol === 'file:'
    ? 'http://localhost:8000'
    : ['localhost', '127.0.0.1', '::1'].includes(location.hostname) && location.port && location.port !== '8000'
      ? 'http://localhost:8000'
      : '';
const allowStoredApiBase =
  location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

export const API_BASE =
  window.REDDIT_TOP_API_BASE ||
  (allowStoredApiBase ? localStorage.getItem('redditTopApiBase') : '') ||
  defaultApiBase;

const memCache = new Map();
const inflight = new Map();

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function authHeaders(password, headers = {}) {
  if (password) headers.Authorization = `Bearer ${password}`;
  return headers;
}

async function fetchJson(path, maxRetries = 3) {
  const url = apiUrl(path);
  if (memCache.has(url)) return memCache.get(url);
  if (inflight.has(url)) return inflight.get(url);

  const promise = (async () => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        memCache.set(url, json);
        return json;
      } catch (err) {
        if (attempt === maxRetries - 1) throw err;
        await sleep(750 * Math.pow(2, attempt));
      }
    }
  })().finally(() => inflight.delete(url));

  inflight.set(url, promise);
  return promise;
}

export async function createSubreddit(subreddit, password = null) {
  const response = await fetch(apiUrl('/api/subreddits'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: authHeaders(password, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: subreddit }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.detail || `HTTP ${response.status}`;
    throw new Error(message);
  }
  memCache.clear();
  return json;
}

export async function loginSubredditAdmin(username, password) {
  const response = await fetch(apiUrl('/api/subreddits/login'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.detail || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

export async function fetchSubredditAdminSession() {
  const response = await fetch(apiUrl('/api/subreddits/session'), {
    credentials: 'same-origin',
  });
  return response.ok;
}

export async function fetchSubredditStatus(passwordOrNsfw = null, maybeNsfw = null) {
  const hasPassword = maybeNsfw !== null;
  const password = hasPassword ? passwordOrNsfw : null;
  const nsfw = hasPassword ? maybeNsfw : (passwordOrNsfw || 'all');
  const qs = new URLSearchParams({ nsfw });
  const response = await fetch(apiUrl(`/api/subreddits/status?${qs.toString()}`), {
    credentials: 'same-origin',
    headers: authHeaders(password),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.detail || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

export async function startSubredditPostsFetch(subreddit, password = null) {
  return updateSubredditPostsFetch(subreddit, password, 'start');
}

export async function stopSubredditPostsFetch(subreddit, password = null) {
  return updateSubredditPostsFetch(subreddit, password, 'stop');
}

export async function deleteSubreddit(subreddit, password = null) {
  const response = await fetch(apiUrl(`/api/subreddits/${encodeURIComponent(subreddit)}`), {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: authHeaders(password),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.detail || `HTTP ${response.status}`;
    throw new Error(message);
  }
  memCache.clear();
  return json;
}

async function updateSubredditPostsFetch(subreddit, password, action) {
  const response = await fetch(apiUrl(`/api/subreddits/${encodeURIComponent(subreddit)}/posts/${action}`), {
    method: 'POST',
    credentials: 'same-origin',
    headers: authHeaders(password),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.detail || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

export async function fetchAllSubredditsCached(type = 'largest') {
  const qs = new URLSearchParams({ nsfw: 'false', sort: 'subscribers' });
  if (type === 'weekly') qs.set('sort', 'subscribers');
  return fetchJson(`/api/subreddits?${qs.toString()}`);
}

export async function fetchSubredditAbout(subreddit) {
  try {
    return await fetchJson(`/api/subreddits/${encodeURIComponent(subreddit)}`);
  } catch (err) {
    if (String(err.message || '').includes('404')) return null;
    throw err;
  }
}

export async function checkSubredditNsfw(subreddit) {
  const about = await fetchSubredditAbout(subreddit);
  if (!about) return true;
  return about.is_nsfw === 1 || about.is_nsfw === true;
}

export async function fetchTopGroups(subreddit, period, { from = null, to = null, sort = 'n-score' } = {}) {
  const qs = new URLSearchParams({ period });
  if (sort) qs.set('sort', sort);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  return fetchJson(`/api/subreddits/${encodeURIComponent(subreddit)}/top?${qs.toString()}`);
}

export async function fetchTopPostsForWindow(subreddit, period, window, options = {}) {
  return fetchHybridTopPosts(subreddit, period, window, fetchTopGroups, options);
}
