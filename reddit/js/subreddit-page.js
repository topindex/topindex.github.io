/**
 * Subreddit detail page controller (SFW)
 * Handles time intervals, top-N selection, post loading, and infinite scroll
 */
import { fetchPosts, probeLatestPost, fetchSubredditCreatedDate, checkSubredditNsfw, fetchSubredditAbout } from './api.js';
import {
  formatNumber, formatDate, escapeHtml, decodeHtmlEntities, archiveUrl,
  getParam, updateUrlParams, calculateTimeBoundaries
} from './utils.js';

const state = {
  subreddit: '',
  interval: '1m',
  topN: 5,
  dateFrom: null,  // YYYY-MM-DD string or null
  dateTo: null,    // YYYY-MM-DD string or null
  loadedPeriods: 0,
  isLoading: false,
  allBoundaries: [],
  cachedPosts: new Map()
};

let loadGeneration = 0;

const VALID_INTERVALS = ['1d', '1w', '1m', '1y', '10y', 'all'];
const VALID_TOPS = [1, 3, 5, 10];
const INITIAL_PERIODS = 5;
const SCROLL_LOAD_COUNT = 3;
const MAX_BOUNDARIES_BY_INTERVAL = { '1d': 730, '1w': 260, '1m': 240, '1y': 50, '10y': 5, 'all': 1 };
function getMaxBoundaries() {
  return MAX_BOUNDARIES_BY_INTERVAL[state.interval] || 200;
}

function init() {
  state.subreddit = getParam('name') || '';

  const urlInterval = getParam('interval');
  if (urlInterval && VALID_INTERVALS.includes(urlInterval)) {
    state.interval = urlInterval;
  }
  const urlTop = getParam('top');
  if (urlTop && VALID_TOPS.includes(parseInt(urlTop, 10))) {
    state.topN = parseInt(urlTop, 10);
  }

  const urlFrom = getParam('from');
  if (urlFrom && /^\d{4}-\d{2}-\d{2}$/.test(urlFrom)) {
    state.dateFrom = urlFrom;
  }
  const urlTo = getParam('to');
  if (urlTo && /^\d{4}-\d{2}-\d{2}$/.test(urlTo)) {
    state.dateTo = urlTo;
  }

  const input = document.getElementById('subreddit-input');
  const form = document.getElementById('subreddit-search-form');
  input.value = state.subreddit;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const newSub = input.value.trim().replace(/^r\//, '');
    if (!newSub) return;
    state.subreddit = newSub;
    document.title = `r/${state.subreddit} | topindex | top reddit posts`;
    updateUrlParams({ name: state.subreddit, interval: state.interval, top: state.topN });
    resetAndReload();
  });

  setupControlButtons();
  setupDateSlider();
  setupLoadMoreButton();
  setupInfiniteScroll();
  setupFavoriteButton();

  if (state.subreddit) {
    document.title = `r/${state.subreddit} | topindex | top reddit posts`;
    loadInitialData();
  } else {
    input.focus();
  }
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

function isFavorite(subreddit) {
  return getFavorites().some(f => f.toLowerCase() === subreddit.toLowerCase());
}

function toggleFavorite(subreddit) {
  const favs = getFavorites();
  const idx = favs.findIndex(f => f.toLowerCase() === subreddit.toLowerCase());
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(subreddit);
  }
  saveFavorites(favs);
}

function setupFavoriteButton() {
  const btn = document.getElementById('favorite-btn');
  if (!btn) return;

  function updateBtn() {
    if (!state.subreddit) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    const fav = isFavorite(state.subreddit);
    btn.classList.toggle('is-favorite', fav);
    btn.title = fav ? 'Remove from favorites' : 'Add to favorites';
  }

  btn.addEventListener('click', () => {
    if (!state.subreddit) return;
    toggleFavorite(state.subreddit);
    updateBtn();
  });

  updateBtn();

  // Re-check when subreddit changes (form submit)
  const origResetAndReload = resetAndReload;
  const form = document.getElementById('subreddit-search-form');
  form.addEventListener('submit', () => {
    // Defer to after state.subreddit is updated
    setTimeout(updateBtn, 0);
  });
}

function setupControlButtons() {
  document.querySelectorAll('.interval-btn').forEach(btn => {
    if (btn.dataset.interval === state.interval) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', () => {
      if (btn.dataset.interval === state.interval) return;
      document.querySelector('.interval-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      state.interval = btn.dataset.interval;
      updateUrlParams({ interval: state.interval, top: state.topN });
      resetAndReload();
    });
  });

  document.querySelectorAll('.top-btn').forEach(btn => {
    if (parseInt(btn.dataset.top, 10) === state.topN) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', () => {
      const newTop = parseInt(btn.dataset.top, 10);
      if (newTop === state.topN) return;
      document.querySelector('.top-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      state.topN = newTop;
      updateUrlParams({ interval: state.interval, top: state.topN });
      rerenderFromCache();
    });
  });
}

// --- Date range slider helpers ---
const SLIDER_EPOCH_YEAR = 2005;
const SLIDER_EPOCH_MONTH = 0; // January

const slider = {
  el: null,
  minIdx: 0,
  maxIdx: 0
};

function getTotalMonths() {
  const now = new Date();
  return (now.getFullYear() - SLIDER_EPOCH_YEAR) * 12 + (now.getMonth() - SLIDER_EPOCH_MONTH);
}

function monthIndexToYM(idx) {
  const totalMonths = SLIDER_EPOCH_MONTH + idx;
  const year = SLIDER_EPOCH_YEAR + Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  return { year, month };
}

function monthIndexToFromDate(idx) {
  const { year, month } = monthIndexToYM(idx);
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

function monthIndexToToDate(idx) {
  const { year, month } = monthIndexToYM(idx);
  const lastDay = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function dateToMonthIndex(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return (y - SLIDER_EPOCH_YEAR) * 12 + (m - 1) - SLIDER_EPOCH_MONTH;
}

function timestampToMonthIndex(ts) {
  const d = new Date(ts * 1000);
  return (d.getFullYear() - SLIDER_EPOCH_YEAR) * 12 + (d.getMonth() - SLIDER_EPOCH_MONTH);
}

function formatSliderMonth(idx) {
  const { year, month } = monthIndexToYM(idx);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month]} ${year}`;
}

function updateSliderLabel(fromIdx, toIdx) {
  const clearBtn = document.getElementById('date-range-clear');
  const isFullRange = fromIdx <= slider.minIdx && toIdx >= slider.maxIdx;
  clearBtn.classList.toggle('hidden', isFullRange);
}

function setupDateSlider() {
  slider.el = document.getElementById('date-range-slider');
  const clearBtn = document.getElementById('date-range-clear');
  slider.minIdx = 0;
  slider.maxIdx = getTotalMonths();

  let initFrom = slider.minIdx;
  let initTo = slider.maxIdx;
  if (state.dateFrom) initFrom = Math.max(slider.minIdx, dateToMonthIndex(state.dateFrom));
  if (state.dateTo) initTo = Math.min(slider.maxIdx, dateToMonthIndex(state.dateTo));

  noUiSlider.create(slider.el, {
    start: [initFrom, initTo],
    connect: true,
    behaviour: 'drag',
    step: 1,
    orientation: 'vertical',
    direction: 'rtl',
    range: { min: slider.minIdx, max: slider.maxIdx },
    tooltips: [
      { to: v => formatSliderMonth(Math.round(v)) },
      { to: v => formatSliderMonth(Math.round(v)) }
    ]
  });

  updateSliderLabel(initFrom, initTo);

  slider.el.noUiSlider.on('update', (values) => {
    updateSliderLabel(Math.round(values[0]), Math.round(values[1]));
  });

  slider.el.noUiSlider.on('change', (values) => {
    applySliderRange(Math.round(values[0]), Math.round(values[1]));
  });

  clearBtn.addEventListener('click', () => {
    slider.el.noUiSlider.set([slider.minIdx, slider.maxIdx]);
    applySliderRange(slider.minIdx, slider.maxIdx);
  });
}

async function updateSliderMin() {
  const createdTs = await fetchSubredditCreatedDate(state.subreddit);
  if (!createdTs) return;

  const newMin = Math.max(0, timestampToMonthIndex(createdTs));
  if (newMin === slider.minIdx) return;

  const currentValues = slider.el.noUiSlider.get().map(Number);
  const wasAtMin = Math.round(currentValues[0]) <= slider.minIdx;

  slider.minIdx = newMin;
  slider.el.noUiSlider.updateOptions({
    range: { min: slider.minIdx, max: slider.maxIdx }
  });

  if (wasAtMin) {
    slider.el.noUiSlider.set([slider.minIdx, null]);
  }

  const vals = slider.el.noUiSlider.get().map(v => Math.round(Number(v)));
  updateSliderLabel(vals[0], vals[1]);
}

function applySliderRange(fromIdx, toIdx) {
  state.dateFrom = fromIdx <= slider.minIdx ? null : monthIndexToFromDate(fromIdx);
  state.dateTo = toIdx >= slider.maxIdx ? null : monthIndexToToDate(toIdx);
  updateUrlParams({ from: state.dateFrom, to: state.dateTo });
  resetAndReload();
}

function setupLoadMoreButton() {
  const btn = document.getElementById('load-more-btn');
  btn.addEventListener('click', () => {
    if (!state.isLoading) {
      loadNextPeriods(SCROLL_LOAD_COUNT);
    }
  });
}

function resetAndReload() {
  loadGeneration++;
  state.loadedPeriods = 0;
  state.isLoading = false;
  state.allBoundaries = [];
  state.cachedPosts.clear();
  document.getElementById('posts-container').innerHTML = '';
  document.getElementById('subreddit-info').textContent = '';
  loadInitialData();
}

function renderSubredditInfo(about) {
  const infoEl = document.getElementById('subreddit-info');
  if (!infoEl || !about) return;

  const parts = [];
  if (about.subscribers != null) {
    parts.push(`${formatNumber(about.subscribers)} subscribers`);
  }
  if (about.accounts_active != null) {
    parts.push(`${formatNumber(about.accounts_active)} online`);
  }
  if (about.created_utc) {
    const created = new Date(about.created_utc * 1000);
    const month = created.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    parts.push(`created ${month}`);
  }

  infoEl.textContent = parts.join(' \u00b7 ');
}

async function loadInitialData() {
  const gen = loadGeneration;

  // Check if subreddit is NSFW — block if so
  const isNsfw = await checkSubredditNsfw(state.subreddit);
  if (gen !== loadGeneration) return;

  if (isNsfw) {
    document.querySelector('.controls').style.display = 'none';
    document.querySelector('.load-more-container').style.display = 'none';
    const sliderPanel = document.querySelector('.date-slider-panel');
    if (sliderPanel) sliderPanel.style.display = 'none';
    const container = document.getElementById('posts-container');
    container.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'nsfw-blocked';
    msg.innerHTML = '<p>NSFW subreddits are not available on this site.</p>';
    container.appendChild(msg);
    return;
  }

  // Fetch subreddit about info and creation date in parallel
  const [about, pullpushCreatedTs] = await Promise.all([
    fetchSubredditAbout(state.subreddit),
    fetchSubredditCreatedDate(state.subreddit)
  ]);
  if (gen !== loadGeneration) return;

  renderSubredditInfo(about);

  // Use PullPush creation date, fall back to about_cache created_utc
  const createdTs = pullpushCreatedTs || (about && about.created_utc) || null;
  updateSliderMin();

  const sliderFrom = state.dateFrom ? new Date(state.dateFrom + 'T00:00:00') : null;
  const createdFrom = createdTs ? new Date(createdTs * 1000) : null;
  // Use the later of slider fromDate and subreddit creation date
  let fromDate = sliderFrom;
  if (createdFrom && (!fromDate || createdFrom > fromDate)) {
    fromDate = createdFrom;
  }
  const toDate = state.dateTo ? new Date(state.dateTo + 'T23:59:59') : null;

  state.allBoundaries = calculateTimeBoundaries(
    state.interval, getMaxBoundaries(), new Date(), fromDate, toDate
  );
  state.loadedPeriods = 0;

  // If toDate is set, boundaries already start from it — load directly
  if (toDate) {
    await loadNextPeriods(INITIAL_PERIODS);
    return;
  }

  // No toDate: boundaries start from now, probe to skip empty periods
  state.isLoading = true;
  updateLoadMoreButton();

  const latestTs = await probeLatestPost(state.subreddit);
  if (gen !== loadGeneration) return;

  if (latestTs) {
    let startIdx = 0;
    for (let i = 0; i < state.allBoundaries.length; i++) {
      if (latestTs >= state.allBoundaries[i].start && latestTs < state.allBoundaries[i].end) {
        startIdx = i;
        break;
      }
      if (latestTs >= state.allBoundaries[i].end) {
        startIdx = i;
      }
    }
    state.loadedPeriods = startIdx;
  }

  state.isLoading = false;
  await loadNextPeriods(INITIAL_PERIODS);
  if (gen !== loadGeneration) return;

  // If all loaded periods were empty (e.g. PullPush data lag), do a single wide-range
  // query to find where scored data actually exists, then skip there
  if (
    document.querySelectorAll('.time-group').length === 0 &&
    state.loadedPeriods < state.allBoundaries.length
  ) {
    const wideEnd = state.allBoundaries[state.loadedPeriods - 1].end;
    const wideStart = wideEnd - (5 * 365 * 24 * 3600); // search full 5 years back
    try {
      const widePosts = await fetchPosts(state.subreddit, wideStart, wideEnd, 1);
      if (gen !== loadGeneration) return;
      if (widePosts.length > 0) {
        const postTs = widePosts[0].created_utc;
        for (let i = state.loadedPeriods; i < state.allBoundaries.length; i++) {
          if (postTs >= state.allBoundaries[i].start && postTs < state.allBoundaries[i].end) {
            state.loadedPeriods = i;
            break;
          }
        }
        await loadNextPeriods(INITIAL_PERIODS);
      }
    } catch (e) {
      // Wide probe failed, user can still click Load More
    }
  }
}

async function loadNextPeriods(count) {
  if (state.isLoading) return;
  if (state.loadedPeriods >= state.allBoundaries.length) {
    updateLoadMoreButton();
    return;
  }

  const gen = loadGeneration;
  state.isLoading = true;
  updateLoadMoreButton();

  const startIdx = state.loadedPeriods;
  const endIdx = Math.min(startIdx + count, state.allBoundaries.length);
  const boundaries = state.allBoundaries.slice(startIdx, endIdx);

  for (const boundary of boundaries) {
    if (gen !== loadGeneration) return; // Abort if interval/settings changed
    try {
      const posts = await fetchPosts(
        state.subreddit,
        boundary.start,
        boundary.end,
        10 // always fetch max
      );
      if (gen !== loadGeneration) return;
      const cacheKey = `${boundary.start}-${boundary.end}`;
      state.cachedPosts.set(cacheKey, posts);
      renderTimePeriod(boundary, posts.slice(0, state.topN));
    } catch (err) {
      if (gen !== loadGeneration) return;
      renderErrorPeriod(boundary, err);
    }
    state.loadedPeriods++;
  }

  state.isLoading = false;
  updateLoadMoreButton();
}

function updateLoadMoreButton() {
  const btn = document.getElementById('load-more-btn');
  const endMsg = document.getElementById('end-of-data-msg');
  const allDone = state.allBoundaries.length > 0 && state.loadedPeriods >= state.allBoundaries.length;

  if (allDone) {
    btn.style.display = 'none';
    if (endMsg) endMsg.style.display = '';
  } else if (state.isLoading) {
    btn.style.display = '';
    btn.textContent = 'Loading...';
    btn.disabled = true;
    if (endMsg) endMsg.style.display = 'none';
  } else {
    btn.style.display = '';
    btn.textContent = 'Load more';
    btn.disabled = false;
    if (endMsg) endMsg.style.display = 'none';
  }
}

function rerenderFromCache() {
  const container = document.getElementById('posts-container');
  container.innerHTML = '';

  const boundaries = state.allBoundaries.slice(0, state.loadedPeriods);
  for (const boundary of boundaries) {
    const cacheKey = `${boundary.start}-${boundary.end}`;
    const posts = state.cachedPosts.get(cacheKey) || [];
    renderTimePeriod(boundary, posts.slice(0, state.topN));
  }
}

function renderTimePeriod(boundary, posts) {
  const container = document.getElementById('posts-container');
  const section = document.createElement('section');
  section.className = 'time-group';

  const header = document.createElement('h3');
  header.className = 'time-group-header';
  header.textContent = boundary.label;
  section.appendChild(header);

  if (posts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-period';
    empty.textContent = 'No posts found';
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }

  const table = document.createElement('table');
  table.className = 'posts-table';

  const colgroup = document.createElement('colgroup');
  ['62px', '58px', '62px', 'auto', '72px', '120px', '95px'].forEach(w => {
    const col = document.createElement('col');
    col.style.width = w;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  // Collect URLs for "open all" links
  const redditUrls = [];
  const titleUrls = [];
  const archiveUrls = [];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.className = 'open-all-row';

  function makeOpenAllTh(urls, label, targetSelector) {
    const th = document.createElement('th');
    th.className = 'open-all-th';
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'open-all-link';
    link.textContent = 'open all';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'open-all-label';
    labelSpan.textContent = ' ' + label;
    link.appendChild(labelSpan);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      urls.forEach(url => window.open(url, '_blank', 'noopener'));
      // Mark corresponding links as opened
      const parentTable = th.closest('table');
      if (parentTable) {
        parentTable.querySelectorAll(targetSelector).forEach(el => el.classList.add('opened'));
      }
      link.classList.add('opened');
    });
    th.appendChild(link);
    return th;
  }

  const emptyTh = () => document.createElement('th');
  const thReddit = makeOpenAllTh(redditUrls, 'reddit links', '.post-reddit-link a, .post-comments a');
  const thTitle = makeOpenAllTh(titleUrls, 'title links', '.post-title a');
  const thArchive = makeOpenAllTh(archiveUrls, 'archives', '.post-archive a');

  headerRow.append(emptyTh(), emptyTh(), thReddit, thTitle, thArchive, emptyTh(), emptyTh());
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  posts.forEach(post => {
    const tr = document.createElement('tr');
    tr.className = 'post-row';

    const redditUrl = `https://old.reddit.com${post.permalink}`;
    const rawPostUrl = post.url || redditUrl;
    const postUrl = rawPostUrl.replace(/https?:\/\/(www\.)?reddit\.com/, 'https://old.reddit.com');

    redditUrls.push(redditUrl);
    titleUrls.push(postUrl);
    archiveUrls.push(archiveUrl(postUrl));

    const tdScore = document.createElement('td');
    tdScore.className = 'post-score';
    tdScore.textContent = formatNumber(post.score);

    const tdComments = document.createElement('td');
    tdComments.className = 'post-comments';
    const commentsLink = document.createElement('a');
    commentsLink.href = redditUrl;
    commentsLink.target = '_blank';
    commentsLink.rel = 'noopener';
    commentsLink.textContent = formatNumber(post.num_comments);
    tdComments.appendChild(commentsLink);

    const tdReddit = document.createElement('td');
    tdReddit.className = 'post-reddit-link';
    const redditLink = document.createElement('a');
    redditLink.href = redditUrl;
    redditLink.target = '_blank';
    redditLink.rel = 'noopener';
    redditLink.textContent = '[reddit]';
    tdReddit.appendChild(redditLink);

    const tdTitle = document.createElement('td');
    tdTitle.className = 'post-title';
    const titleLink = document.createElement('a');
    titleLink.href = postUrl;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener';
    titleLink.textContent = decodeHtmlEntities(post.title);
    const domainSpan = document.createElement('span');
    domainSpan.className = 'post-domain';
    domainSpan.textContent = ` (${post.domain})`;
    tdTitle.append(titleLink, domainSpan);

    const tdArchive = document.createElement('td');
    tdArchive.className = 'post-archive';
    const archiveLink = document.createElement('a');
    archiveLink.href = archiveUrl(postUrl);
    archiveLink.target = '_blank';
    archiveLink.rel = 'noopener';
    archiveLink.textContent = '[archived]';
    tdArchive.appendChild(archiveLink);

    const tdAuthor = document.createElement('td');
    tdAuthor.className = 'post-author';
    tdAuthor.textContent = post.author;

    const tdDate = document.createElement('td');
    tdDate.className = 'post-date';
    tdDate.textContent = formatDate(post.created_utc);

    tr.append(tdScore, tdComments, tdReddit, tdTitle, tdArchive, tdAuthor, tdDate);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  section.appendChild(table);

  container.appendChild(section);
}

function renderErrorPeriod(boundary, err) {
  const container = document.getElementById('posts-container');
  const section = document.createElement('section');
  section.className = 'time-group';

  const header = document.createElement('h3');
  header.className = 'time-group-header';
  header.textContent = boundary.label;
  section.appendChild(header);

  const errDiv = document.createElement('div');
  errDiv.className = 'error-state';
  errDiv.style.padding = '8px 0';
  errDiv.innerHTML = `<p style="margin:0;font-size:13px;">Failed to load posts. ${escapeHtml(err.message)}</p>`;
  section.appendChild(errDiv);

  container.appendChild(section);
}

function setupInfiniteScroll() {
  const sentinel = document.getElementById('load-more-sentinel');
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !state.isLoading) {
        loadNextPeriods(SCROLL_LOAD_COUNT);
      }
    },
    { rootMargin: '600px', threshold: 0 }
  );
  observer.observe(sentinel);
}

document.addEventListener('DOMContentLoaded', init);
