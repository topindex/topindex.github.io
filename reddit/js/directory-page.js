/**
 * Directory page controller
 */
import { fetchAllSubredditsCached } from './api.js';
import { formatNumber, FALLBACK_ICON } from './utils.js';

const SKELETON_COUNT = 10;

function createSkeletonRows(container) {
  for (let i = 0; i < SKELETON_COUNT; i++) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    row.innerHTML = `
      <div class="skeleton skeleton-icon"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-badge"></div>
    `;
    container.appendChild(row);
  }
}

function renderSubredditRow(sub, index) {
  const a = document.createElement('a');
  a.className = 'subreddit-row';
  a.href = `subreddit.html?name=${encodeURIComponent(sub.name)}`;
  a.dataset.name = sub.name.toLowerCase();

  const rankSpan = document.createElement('span');
  rankSpan.className = 'subreddit-rank';
  rankSpan.textContent = index;

  const img = document.createElement('img');
  img.className = 'subreddit-icon';
  img.src = sub.icon_url || FALLBACK_ICON;
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = function() { this.src = FALLBACK_ICON; this.onerror = null; };

  const nameSpan = document.createElement('span');
  nameSpan.className = 'subreddit-name';
  nameSpan.textContent = `r/${sub.name}`;

  const subsSpan = document.createElement('span');
  subsSpan.className = 'subreddit-subscribers';
  subsSpan.textContent = formatNumber(sub.subscribers);

  a.append(rankSpan, img, nameSpan, subsSpan);

  return a;
}

function renderError(container, message, retryFn) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error-state';
  div.innerHTML = `<p>${message}</p>`;
  const btn = document.createElement('button');
  btn.className = 'retry-btn';
  btn.textContent = 'Retry';
  btn.addEventListener('click', retryFn);
  div.appendChild(btn);
  container.appendChild(div);
}

async function loadColumn(listEl, type) {
  listEl.innerHTML = '';
  createSkeletonRows(listEl);

  try {
    const subs = await fetchAllSubredditsCached(type);
    listEl.innerHTML = '';
    subs.forEach((sub, i) => {
      listEl.appendChild(renderSubredditRow(sub, i + 1));
    });
  } catch (err) {
    renderError(listEl, 'Failed to load subreddits.', () => loadColumn(listEl, type));
  }
}

function setupDirectorySearch() {
  const input = document.querySelector('.directory-search input');
  if (!input) return;

  input.addEventListener('input', () => {
    const query = input.value.trim().replace(/^r\//, '').toLowerCase();
    const rows = document.querySelectorAll('.subreddit-row');

    if (!query) {
      rows.forEach(row => { row.style.display = ''; });
      return;
    }

    let firstMatch = null;
    rows.forEach(row => {
      const name = row.dataset.name || '';
      const matches = name.includes(query);
      row.style.display = matches ? '' : 'none';
      if (matches && !firstMatch) firstMatch = row;
    });

    if (firstMatch) {
      firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

// --- Favorites ---

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem('favoriteSubreddits') || '[]');
  } catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem('favoriteSubreddits', JSON.stringify(favs));
}

function renderFavorites() {
  const section = document.getElementById('favorites-section');
  const list = document.getElementById('favorites-list');
  if (!section || !list) return;

  const favs = getFavorites();
  if (favs.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = '';

  favs.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'favorite-chip';

    const link = document.createElement('a');
    link.href = `subreddit.html?name=${encodeURIComponent(name)}`;
    link.textContent = `r/${name}`;
    link.style.color = 'inherit';
    link.style.textDecoration = 'none';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-fav';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = `Remove r/${name} from favorites`;
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const updated = getFavorites().filter(f => f.toLowerCase() !== name.toLowerCase());
      saveFavorites(updated);
      renderFavorites();
    });

    chip.append(link, removeBtn);
    list.appendChild(chip);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const listLargest = document.getElementById('list-largest');

  renderFavorites();
  loadColumn(listLargest, 'largest');
  setupDirectorySearch();
});
