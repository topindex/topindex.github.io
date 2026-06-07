/**
 * Subreddit add and status page controller.
 */
import {
  createSubreddit,
  deleteSubreddit,
  fetchSubredditAdminSession,
  fetchSubredditStatus,
  loginSubredditAdmin,
  startSubredditPostsFetch,
  stopSubredditPostsFetch,
} from './api.js?v=admin-remove';

const NAME_RE = /^[a-z0-9_]{2,30}$/;

const loginPanel = document.getElementById('admin-login-panel');
const adminShell = document.getElementById('admin-shell');
const loginForm = document.getElementById('admin-login-form');
const usernameInput = document.getElementById('admin-username-input');
const passwordInput = document.getElementById('admin-password-input');
const loginBtn = document.getElementById('admin-login-btn');
const loginMessageEl = document.getElementById('admin-login-message');
const form = document.getElementById('add-subreddits-form');
const textarea = document.getElementById('subreddit-list-input');
const submitBtn = document.getElementById('submit-subreddits-btn');
const summaryEl = document.getElementById('add-summary');
const resultsEl = document.getElementById('add-results');
const statusSearchInput = document.getElementById('status-search-input');
const statusRefreshBtn = document.getElementById('status-refresh-btn');
const statusMessageEl = document.getElementById('status-message');
const statusTableBody = document.getElementById('status-table-body');
const statusSortButtons = Array.from(document.querySelectorAll('.status-sort'));

let activeNsfw = 'all';
let statusRows = [];
let statusSort = { key: 'posts_updated', direction: 'desc' };

function setLoginMessage(message, type = '') {
  loginMessageEl.textContent = message;
  loginMessageEl.className = type ? `login-message ${type}` : 'login-message';
}

function showLogin() {
  loginPanel.hidden = false;
  adminShell.hidden = true;
  passwordInput.focus();
}

async function showAdmin({ loadRows = true } = {}) {
  loginPanel.hidden = true;
  adminShell.hidden = false;
  if (loadRows) await loadStatusRows();
}

async function submitLogin(event) {
  event.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    setLoginMessage('Enter username and password.', 'error');
    return;
  }

  loginBtn.disabled = true;
  setLoginMessage('Checking credentials...');
  try {
    await loginSubredditAdmin(username, password);
    passwordInput.value = '';
    setLoginMessage('');
    await showAdmin();
  } catch (err) {
    setLoginMessage(err.message || 'Login failed.', 'error');
    passwordInput.select();
  } finally {
    loginBtn.disabled = false;
  }
}

async function initAdminPage() {
  try {
    if (await fetchSubredditAdminSession()) {
      await showAdmin();
      return;
    }
  } catch (_) {
    // Fall through to the login form.
  }
  showLogin();
}

function normalizeSubreddit(value) {
  return value.trim().replace(/^\/?r\//i, '').toLowerCase();
}

function parseSubreddits(value) {
  const seen = new Set();
  const names = [];
  value
    .split(/[,\n]/)
    .map(normalizeSubreddit)
    .filter(Boolean)
    .forEach(name => {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    });
  return names;
}

function setSummary(message, type = '') {
  summaryEl.textContent = message;
  summaryEl.className = type ? `add-summary ${type}` : 'add-summary';
}

function setStatusMessage(message, type = '') {
  statusMessageEl.textContent = message;
  statusMessageEl.className = type ? `status-message ${type}` : 'status-message';
}

function formatNumber(value) {
  if (value == null) return 'Unknown';
  return Number(value).toLocaleString();
}

function formatDateTime(value) {
  if (!value) return 'Not fetched';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(value) {
  return value || 'Not fetched';
}

function timestamp(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.getTime();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`).getTime();
  return 0;
}

function statusLabel(row) {
  if (row.posts_fetch_running) {
    const source = row.posts_fetch_source === 'arctic-shift' ? 'arctic-shift' : 'pushpull';
    return `fetching (${source})`;
  }
  return row.posts_status || row.history_status || row.meta_status || 'not fetched';
}

function statusTitle(row) {
  if (row.posts_fetch_running) {
    return row.posts_fetch_started_at ? `Started ${formatDateTime(row.posts_fetch_started_at)}` : 'Ingest is running';
  }
  return row.posts_error || row.meta_error || '';
}

function findStatusRow(name) {
  return statusRows.find(row => row.name === name);
}

function isHistoricalFetchActive(row) {
  return row.posts_fetch_running && row.posts_fetch_source !== 'arctic-shift';
}

function postThroughDay(row) {
  if (isHistoricalFetchActive(row)) return row.latest_post_day || row.posts_historical_cursor_day || row.posts_cursor_day || '';
  return row.latest_post_day || row.posts_cursor_day || '';
}

function postThroughSource(row) {
  if (row.latest_post_day) return '';
  if (isHistoricalFetchActive(row) && row.posts_historical_cursor_day) return ' (pushpull cursor)';
  if (row.posts_cursor_day) return ' (cursor)';
  return '';
}

function sortValue(row, key) {
  switch (key) {
    case 'subreddit':
      return `${row.name || ''} ${row.display_name || ''}`.toLowerCase();
    case 'type':
      return row.is_nsfw ? 'nsfw' : 'sfw';
    case 'subscribers':
      return Number(row.subscribers || 0);
    case 'meta_updated':
      return timestamp(row.meta_updated_at || row.subreddit_updated_at);
    case 'history_updated':
      return timestamp(row.history_updated_at);
    case 'history_through':
      return timestamp(row.history_cursor_day);
    case 'posts_through':
      return timestamp(postThroughDay(row));
    case 'posts_updated':
      return timestamp(row.posts_updated_at || row.posts_historical_updated_at || row.latest_post_seen_at);
    case 'status':
      return statusLabel(row).toLowerCase();
    case 'fetch_posts':
      return row.posts_fetch_running ? 'running' : 'start';
    default:
      return '';
  }
}

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows(rows) {
  const direction = statusSort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const primary = compareValues(sortValue(left, statusSort.key), sortValue(right, statusSort.key));
    if (primary !== 0) return primary * direction;
    return compareValues(left.name || '', right.name || '');
  });
}

function updateSortHeaders() {
  statusSortButtons.forEach(button => {
    const active = button.dataset.sort === statusSort.key;
    button.setAttribute('aria-sort', active ? (statusSort.direction === 'desc' ? 'descending' : 'ascending') : 'none');
  });
}

function appendCell(tr, ...children) {
  const td = document.createElement('td');
  children.forEach(child => td.append(child));
  tr.appendChild(td);
  return td;
}

async function updatePostsFetch(name, action, button) {
  button.disabled = true;
  setStatusMessage(`${action === 'start' ? 'Starting' : 'Stopping'} r/${name} post fetch...`);
  try {
    if (action === 'start') {
      await startSubredditPostsFetch(name);
      const row = findStatusRow(name);
      if (row) {
        row.posts_fetch_running = true;
        row.posts_fetch_started_at = new Date().toISOString();
      }
    } else {
      await stopSubredditPostsFetch(name);
      const row = findStatusRow(name);
      if (row) {
        row.posts_fetch_running = false;
        row.posts_status = 'stopped';
        row.posts_error = 'Stopped by user';
      }
    }
    renderStatusRows();
    await loadStatusRows();
  } catch (err) {
    setStatusMessage(err.message || `Failed to ${action} post fetch.`, 'error');
    button.disabled = false;
  }
}

async function removeSubreddit(row, button) {
  if (row.posts_fetch_running) {
    setStatusMessage(`Stop r/${row.name} before removing it.`, 'error');
    return;
  }
  const ok = window.confirm(
    `Remove r/${row.name}? This deletes its metadata, subcount history, ingest state, and stored top posts.`
  );
  if (!ok) return;

  button.disabled = true;
  setStatusMessage(`Removing r/${row.name}...`);
  try {
    await deleteSubreddit(row.name);
    statusRows = statusRows.filter(item => item.name !== row.name);
    renderStatusRows();
    setStatusMessage(`Removed r/${row.name}.`);
  } catch (err) {
    setStatusMessage(err.message || `Failed to remove r/${row.name}.`, 'error');
    button.disabled = false;
  }
}

function renderResult(result) {
  const row = document.createElement('div');
  row.className = `add-result ${result.status}`;

  const name = document.createElement('a');
  name.className = 'add-result-name';
  name.textContent = `r/${result.name}`;
  name.href = `subreddit.html?name=${encodeURIComponent(result.name)}`;

  const status = document.createElement('span');
  status.className = 'add-result-status';
  status.textContent = result.label;

  const detail = document.createElement('span');
  detail.className = 'add-result-detail';
  detail.textContent = result.detail || '';

  row.append(name, status, detail);
  resultsEl.appendChild(row);
}

function updateProgress(done, total, ok, failed) {
  setSummary(`Processed ${done}/${total}. Added ${ok}. Failed ${failed}.`);
}

function renderStatusRows() {
  const query = statusSearchInput.value.trim().toLowerCase();
  const runningRow = statusRows.find(row => row.posts_fetch_running);
  const runningName = runningRow ? runningRow.name : '';
  const filtered = statusRows.filter(row => {
    if (!query) return true;
    return `${row.name || ''} ${row.display_name || ''}`.toLowerCase().includes(query);
  });
  const sorted = sortRows(filtered);

  statusTableBody.innerHTML = '';
  sorted.forEach(row => {
    const tr = document.createElement('tr');
    const status = statusLabel(row);
    const postThrough = postThroughDay(row) || null;

    const nameLink = document.createElement('a');
    nameLink.href = `subreddit.html?name=${encodeURIComponent(row.name)}`;
    nameLink.textContent = `r/${row.name}`;
    const displayName = document.createElement('div');
    displayName.className = 'status-muted';
    displayName.textContent = row.display_name || '';
    appendCell(tr, nameLink, displayName);
    appendCell(tr, document.createTextNode(row.is_nsfw ? 'NSFW' : 'SFW'));
    appendCell(tr, document.createTextNode(formatNumber(row.subscribers)));
    appendCell(tr, document.createTextNode(formatDateTime(row.meta_updated_at || row.subreddit_updated_at)));
    appendCell(tr, document.createTextNode(formatDateTime(row.history_updated_at)));
    appendCell(tr, document.createTextNode(formatDay(row.history_cursor_day)));

    const postThroughText = document.createTextNode(formatDay(postThrough));
    const postThroughSuffix = postThroughSource(row);
    if (row.latest_post_day) {
      appendCell(tr, postThroughText);
    } else {
      const cursor = document.createElement('span');
      cursor.className = 'status-muted';
      cursor.textContent = postThroughSuffix;
      appendCell(tr, postThroughText, cursor);
    }

    appendCell(tr, document.createTextNode(formatDateTime(row.posts_updated_at || row.posts_historical_updated_at || row.latest_post_seen_at)));

    const pill = document.createElement('span');
    pill.className = `status-pill ${String(status).replace(/[^a-z0-9_]/gi, '_')}`;
    pill.textContent = status;
    const detail = document.createElement('div');
    detail.className = 'status-muted';
    detail.textContent = statusTitle(row);
    const statusCell = appendCell(tr, pill, detail);
    statusCell.className = 'status-cell';

    const actions = document.createElement('div');
    actions.className = 'status-actions';
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = `status-action ${row.posts_fetch_running ? 'stop' : 'start'}`;
    actionButton.textContent = row.posts_fetch_running ? 'Stop' : 'Start';
    actionButton.disabled = Boolean(runningName && !row.posts_fetch_running);
    actionButton.title = row.posts_fetch_running
      ? `Stop metadata, history, and post fetch for r/${row.name}`
      : runningName
        ? `Wait for r/${runningName} to finish or stop before starting another ingest`
        : `Update metadata and subscriber history, then start or resume post fetch for r/${row.name}`;
    actionButton.addEventListener('click', () => {
      updatePostsFetch(row.name, row.posts_fetch_running ? 'stop' : 'start', actionButton);
    });
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'status-action remove icon-only';
    removeButton.setAttribute('aria-label', `Remove r/${row.name}`);
    removeButton.innerHTML = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
    removeButton.disabled = Boolean(row.posts_fetch_running);
    removeButton.title = row.posts_fetch_running
      ? `Stop r/${row.name} ingest before removing it`
      : `Remove r/${row.name} and all stored data`;
    removeButton.addEventListener('click', () => {
      removeSubreddit(row, removeButton);
    });
    actions.appendChild(actionButton);
    actions.appendChild(removeButton);
    appendCell(tr, actions);
    statusTableBody.appendChild(tr);
  });

  const total = statusRows.length;
  const shown = filtered.length;
  setStatusMessage(total ? `Showing ${shown} of ${total} subreddits.` : 'No subreddits found.');
  updateSortHeaders();
}

async function loadStatusRows() {
  statusRefreshBtn.disabled = true;
  statusRefreshBtn.classList.add('loading');
  setStatusMessage('Loading subreddit status...');
  try {
    statusRows = await fetchSubredditStatus(activeNsfw);
    renderStatusRows();
    return true;
  } catch (err) {
    statusRows = [];
    statusTableBody.innerHTML = '';
    setStatusMessage(err.message || 'Failed to load subreddit status.', 'error');
    return false;
  } finally {
    statusRefreshBtn.disabled = false;
    statusRefreshBtn.classList.remove('loading');
  }
}

async function submitSubreddits(event) {
  event.preventDefault();
  const names = parseSubreddits(textarea.value);

  resultsEl.innerHTML = '';
  if (names.length === 0) {
    setSummary('Enter at least one subreddit.', 'error');
    textarea.focus();
    return;
  }

  submitBtn.disabled = true;
  textarea.disabled = true;

  let ok = 0;
  let failed = 0;
  updateProgress(0, names.length, ok, failed);

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!NAME_RE.test(name)) {
      failed++;
      renderResult({ name, status: 'failed', label: 'Invalid', detail: 'Use 2-30 letters, numbers, or underscores.' });
      updateProgress(i + 1, names.length, ok, failed);
      continue;
    }

    try {
      const response = await createSubreddit(name);
      const sub = response.subreddit || {};
      ok++;
      renderResult({
        name: sub.name || name,
        status: 'added',
        label: 'Added',
        detail: sub.display_name ? `${sub.display_name} saved` : 'Saved',
      });
    } catch (err) {
      failed++;
      renderResult({
        name,
        status: 'failed',
        label: 'Failed',
        detail: err.message || 'Request failed',
      });
    }
    updateProgress(i + 1, names.length, ok, failed);
  }

  setSummary(`Finished. Added ${ok}. Failed ${failed}.`, failed ? 'warning' : 'success');
  submitBtn.disabled = false;
  textarea.disabled = false;
  if (ok > 0) await loadStatusRows();
}

loginForm.addEventListener('submit', submitLogin);
form.addEventListener('submit', submitSubreddits);
statusRefreshBtn.addEventListener('click', loadStatusRows);
statusSearchInput.addEventListener('input', renderStatusRows);
statusSortButtons.forEach(button => {
  button.addEventListener('click', () => {
    const key = button.dataset.sort;
    if (!key) return;
    if (statusSort.key === key) {
      statusSort.direction = statusSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      statusSort = { key, direction: 'asc' };
    }
    renderStatusRows();
  });
});
initAdminPage();
