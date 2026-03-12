const DATA = {};
const dataLoading = {};

let currentInterval = 'monthly';
let currentTopN = 5;
let currentSort = 'score';
let allExpanded = true;
let tagQuery = '';
let tagFilterFn = null;

const INTERVAL_MAP = { '1w': 'weekly', '1m': 'monthly', '1y': 'yearly', '10y': '10y', 'all': 'all' };
const INTERVAL_REVERSE = { 'weekly': '1w', 'monthly': '1m', 'yearly': '1y', '10y': '10y', 'all': 'all' };
const VALID_TOPN = [1, 3, 5, 10];
const VALID_SORTS = ['score', 'comments', 'date'];

const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

function initTheme() {
    const saved = localStorage.getItem('lob_theme');
    if (saved) {
        document.documentElement.dataset.theme = saved;
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.dataset.theme === 'dark';
    html.dataset.theme = isDark ? 'light' : 'dark';
    localStorage.setItem('lob_theme', html.dataset.theme);
}

initTheme();

function loadData(key) {
    if (DATA[key]) return Promise.resolve(DATA[key]);
    if (dataLoading[key]) return dataLoading[key];

    dataLoading[key] = fetch('data/' + key + '.json')
        .then(function(resp) {
            if (!resp.ok) throw new Error('Failed to load ' + key + ' data');
            return resp.json();
        })
        .then(function(records) {
            DATA[key] = records;
            delete dataLoading[key];
            return records;
        })
        .catch(function(err) {
            delete dataLoading[key];
            throw err;
        });

    return dataLoading[key];
}

function updateURL(hash) {
    const params = new URLSearchParams();
    params.set('interval', INTERVAL_REVERSE[currentInterval] || '1m');
    params.set('top', String(currentTopN));
    if (currentSort !== 'score') params.set('displaysort', currentSort);
    if (hash === undefined) hash = window.location.hash;
    history.replaceState(null, '', '?' + params.toString() + hash);
}

async function setInterval_(interval) {
    currentInterval = interval;
    document.querySelectorAll('[data-interval]').forEach(b => {
        b.classList.toggle('active', b.dataset.interval === interval);
    });
    await render();
    updateURL();
}

async function setTopN(n) {
    currentTopN = n;
    document.querySelectorAll('[data-topn]').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.topn) === n);
    });
    await render();
    updateURL();
}

async function setSort(key) {
    if (VALID_SORTS.includes(key)) {
        currentSort = key;
        await render();
        updateURL();
    }
}

function sortItems(items) {
    const sorted = items.slice();
    if (currentSort === 'comments') {
        sorted.sort((a, b) => (parseInt(b.comments_count) || 0) - (parseInt(a.comments_count) || 0));
    } else if (currentSort === 'date') {
        sorted.sort((a, b) => (b.date_posted || '').localeCompare(a.date_posted || ''));
    } else {
        sorted.sort((a, b) => (parseInt(b.score) || 0) - (parseInt(a.score) || 0));
    }
    return sorted;
}

function toggleExpandCollapse() {
    allExpanded = !allExpanded;
    document.querySelectorAll('details').forEach(d => d.open = allExpanded);
    updateFabIcon();
}

function updateFabIcon() {
    document.getElementById('fab-expand').style.display = allExpanded ? 'none' : 'block';
    document.getElementById('fab-collapse').style.display = allExpanded ? 'block' : 'none';
}

function extractDomain(url) {
    if (!url) return '';
    try {
        let d = url.replace(/^https?:\/\//, '').split('/')[0];
        return d.replace(/^www\./, '');
    } catch(e) {
        return '';
    }
}

function isoWeekToDateRange(isoYear, isoWeek) {
    const jan4 = new Date(isoYear, 0, 4);
    const dow = jan4.getDay() || 7;
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - dow + 1 + (isoWeek - 1) * 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: mon, end: sun };
}

function formatShortDate(d) {
    return MONTH_NAMES[d.getMonth() + 1] + ' ' + d.getDate();
}

function groupByPeriod(records, interval) {
    const groups = {};
    for (const r of records) {
        let key;
        const year = parseInt(r.year);
        if (interval === 'weekly') {
            const week = parseInt(r.week);
            key = year + '-W' + String(week).padStart(2, '0');
        } else if (interval === 'monthly') {
            const month = parseInt(r.month);
            key = year + '-' + String(month).padStart(2, '0');
        } else if (interval === '10y') {
            key = String(Math.floor(year / 10) * 10) + 's';
        } else if (interval === 'all') {
            key = 'all-time';
        } else {
            key = String(year);
        }
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    }
    const sortByScore = (interval === '10y' || interval === 'all');
    for (const key in groups) {
        if (sortByScore) {
            groups[key].sort((a, b) => parseInt(b.score) - parseInt(a.score));
        } else {
            groups[key].sort((a, b) => parseInt(a.rank) - parseInt(b.rank));
        }
    }
    return groups;
}

function periodYear(key, interval) {
    if (interval === 'weekly') return parseInt(key.split('-W')[0]);
    if (interval === 'monthly') return parseInt(key.split('-')[0]);
    if (interval === '10y') return parseInt(key);
    if (interval === 'all') return 0;
    return parseInt(key);
}

function periodSortKey(key, interval) {
    if (interval === 'weekly') {
        const parts = key.split('-W');
        return parseInt(parts[0]) * 100 + parseInt(parts[1]);
    }
    if (interval === 'monthly') {
        const parts = key.split('-');
        return parseInt(parts[0]) * 100 + parseInt(parts[1]);
    }
    if (interval === '10y') return parseInt(key);
    if (interval === 'all') return 0;
    return parseInt(key);
}

function formatPeriodLabel(key, interval) {
    if (interval === 'yearly') return key;
    if (interval === '10y') return key;
    if (interval === 'all') return 'All Time';
    if (interval === 'monthly') {
        const parts = key.split('-');
        return MONTH_FULL[parseInt(parts[1])] + ' ' + parts[0];
    }
    if (interval === 'weekly') {
        const parts = key.split('-W');
        const year = parseInt(parts[0]);
        const week = parseInt(parts[1]);
        const range = isoWeekToDateRange(year, week);
        return parts[0] + ' W' + parts[1] + ' (' + formatShortDate(range.start) + ' \u2013 ' + formatShortDate(range.end) + ')';
    }
    return key;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openAllLinks(sectionId, linkType) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const selector = 'a[data-link="' + linkType + '"]';
    const links = section.querySelectorAll(selector);
    const visited = JSON.parse(localStorage.getItem('lob_visited') || '{}');
    let changed = false;
    links.forEach(a => {
        window.open(a.href, '_blank');
        if (linkType === 'ext') {
            a.classList.add('visited');
            visited[a.href] = true;
            changed = true;
        }
    });
    if (changed) localStorage.setItem('lob_visited', JSON.stringify(visited));
}

function copyPermalink(id, event) {
    event.stopPropagation();
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    params.set('interval', INTERVAL_REVERSE[currentInterval] || '1m');
    params.set('top', String(currentTopN));
    if (currentSort !== 'score') params.set('displaysort', currentSort);
    const url = base + '?' + params.toString() + '#' + id;
    navigator.clipboard.writeText(url).then(() => {
        const tt = document.getElementById('tooltip');
        tt.textContent = 'Link copied!';
        tt.style.left = event.pageX + 'px';
        tt.style.top = (event.pageY - 30) + 'px';
        tt.classList.add('show');
        setTimeout(() => tt.classList.remove('show'), 1500);
    });
    updateURL('#' + id);
}

function sortArrow(key) {
    return currentSort === key ? ' \u25BC' : '';
}

function formatDateTime(d) {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return date + ', ' + h12 + ':' + m + ' ' + ampm + ' [' + tz + ']';
}

let dataMetadata = null;

async function updateLastUpdated() {
    const el = document.getElementById('last-updated');
    if (!el) return;
    if (!dataMetadata) {
        try {
            const resp = await fetch('data/metadata.json');
            if (resp.ok) dataMetadata = await resp.json();
        } catch (e) {}
    }
    let sourceKey = currentInterval;
    if (sourceKey === '10y' || sourceKey === 'all') sourceKey = 'yearly';
    const fetched = dataMetadata && dataMetadata.fetched && dataMetadata.fetched[sourceKey];
    if (fetched) {
        el.textContent = 'Updated on ' + formatDateTime(new Date(fetched));
    } else {
        el.textContent = '';
    }
}

function isLobstersUrl(url) {
    if (!url) return false;
    return url.indexOf('lobste.rs') !== -1;
}

function renderTags(tags) {
    if (!tags) return '';
    const tagList = tags.split(', ');
    let html = ' ';
    for (const tag of tagList) {
        if (!tag.trim()) continue;
        html += '<a class="tag-pill" href="https://lobste.rs/t/' + encodeURIComponent(tag.trim()) + '" target="_blank">' + escapeHtml(tag.trim()) + '</a>';
    }
    return html;
}

/* Tag Filter — Boolean expression parser */
function tokenizeTagExpr(query) {
    const tokens = [];
    let i = 0;
    while (i < query.length) {
        if (query[i] === ' ' || query[i] === '\t') { i++; continue; }
        if (query[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
        if (query[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
        if (query[i] === '!') { tokens.push({ type: 'NOT' }); i++; continue; }
        // Read a word
        let word = '';
        while (i < query.length && query[i] !== ' ' && query[i] !== '\t' && query[i] !== '(' && query[i] !== ')') {
            word += query[i]; i++;
        }
        if (word.toLowerCase() === 'and') tokens.push({ type: 'AND' });
        else if (word.toLowerCase() === 'or') tokens.push({ type: 'OR' });
        else tokens.push({ type: 'TAG', value: word.toLowerCase() });
    }
    return tokens;
}

function parseTagExpr(query) {
    query = query.trim();
    if (!query) return null;
    const tokens = tokenizeTagExpr(query);
    if (tokens.length === 0) return null;
    let pos = 0;

    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function consume() { return tokens[pos++]; }

    // expr = term (OR term)*
    function parseExpr() {
        let left = parseTerm();
        while (peek() && peek().type === 'OR') {
            consume();
            const right = parseTerm();
            left = orNode(left, right);
        }
        return left;
    }

    // term = factor (AND? factor)*  — implicit AND for adjacent factors
    function parseTerm() {
        let left = parseFactor();
        while (peek() && peek().type !== 'OR' && peek().type !== 'RPAREN') {
            if (peek().type === 'AND') consume();
            const right = parseFactor();
            left = andNode(left, right);
        }
        return left;
    }

    // factor = NOT? atom
    function parseFactor() {
        if (peek() && peek().type === 'NOT') {
            consume();
            const node = parseAtom();
            return notNode(node);
        }
        return parseAtom();
    }

    // atom = TAG | '(' expr ')'
    function parseAtom() {
        const t = peek();
        if (!t) return tagNode('');
        if (t.type === 'LPAREN') {
            consume();
            const node = parseExpr();
            if (!peek() || peek().type !== 'RPAREN') throw new Error('Missing closing )');
            consume();
            return node;
        }
        if (t.type === 'TAG') {
            consume();
            return tagNode(t.value);
        }
        // Unexpected token, skip
        consume();
        return tagNode('');
    }

    function tagNode(name) { return function(tags) { return tags.includes(name); }; }
    function andNode(a, b) { return function(tags) { return a(tags) && b(tags); }; }
    function orNode(a, b) { return function(tags) { return a(tags) || b(tags); }; }
    function notNode(a) { return function(tags) { return !a(tags); }; }

    return parseExpr();
}

function getAllTags(records) {
    const tagCounts = {};
    for (const r of records) {
        if (!r.tags) continue;
        for (const t of r.tags.split(', ')) {
            const tag = t.trim();
            if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
    }
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
}

function renderTagFilters(records) {
    const container = document.getElementById('tag-filters');
    if (!container) return;
    const tags = getAllTags(records);
    if (tags.length === 0) { container.style.display = 'none'; return; }

    // Only rebuild the full HTML if not yet rendered (preserve input focus)
    if (!container.querySelector('.tag-search-input')) {
        let html = '<div class="tag-search-bar">';
        html += '<label>Tags:</label>';
        html += '<input type="text" class="tag-search-input" id="tag-search-input" placeholder="e.g. (rust or linux) and !web" value="' + escapeHtml(tagQuery) + '">';
        html += '<button class="tag-go-btn" id="tag-go-btn" onclick="applyTagQuery()">Go</button>';
        html += '<button class="tag-filter-btn clear-tags" id="tag-clear-btn" onclick="clearTagQuery()" style="' + (tagQuery ? '' : 'display:none') + '">clear</button>';
        html += '<span class="tag-error" id="tag-error"></span>';
        html += '</div>';
        html += '<div class="tag-suggestions" id="tag-suggestions">';
        for (const [tag, count] of tags) {
            html += '<button class="tag-filter-btn" onclick="appendTag(\'' + escapeHtml(tag).replace(/'/g, "\\'") + '\')">' + escapeHtml(tag) + ' <span class="tag-count">' + count + '</span></button>';
        }
        html += '</div>';
        container.innerHTML = html;
        container.style.display = 'block';

        document.getElementById('tag-search-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') applyTagQuery();
        });
    }
}

function applyTagQuery() {
    const input = document.getElementById('tag-search-input');
    if (!input) return;
    var errEl = document.getElementById('tag-error');
    if (errEl) errEl.textContent = '';
    tagQuery = input.value;
    try {
        tagFilterFn = parseTagExpr(tagQuery);
    } catch (e) {
        tagFilterFn = null;
        if (errEl) errEl.textContent = 'Syntax error: ' + e.message;
        return;
    }
    document.getElementById('tag-clear-btn').style.display = tagQuery ? '' : 'none';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function appendTag(tag) {
    const input = document.getElementById('tag-search-input');
    if (!input) return;
    const val = input.value.trim();
    input.value = val ? val + ' or ' + tag : tag;
    input.focus();
}

function clearTagQuery() {
    tagQuery = '';
    tagFilterFn = null;
    const input = document.getElementById('tag-search-input');
    if (input) input.value = '';
    document.getElementById('tag-clear-btn').style.display = 'none';
    render();
}

function filterByTags(items) {
    if (!tagFilterFn) return items;
    return items.filter(r => {
        if (!r.tags) return false;
        const tags = r.tags.split(', ').map(t => t.trim().toLowerCase());
        return tagFilterFn(tags);
    });
}

function renderTable(items, sectionId) {
    const byScore = items.slice().sort((a, b) => (parseInt(b.score) || 0) - (parseInt(a.score) || 0));
    const topN = byScore.slice(0, currentTopN);
    const filtered = filterByTags(topN);
    if (tagFilterFn && filtered.length === 0) return '';
    const topItems = sortItems(filtered);
    let html = '<div class="mobile-actions">';
    html += '<button onclick="openAllLinks(\'' + sectionId + '\', \'lob\')">open all lobsters</button>';
    html += '<button onclick="openAllLinks(\'' + sectionId + '\', \'ext\')">open all links</button>';
    html += '<button onclick="openAllLinks(\'' + sectionId + '\', \'arc\')">open all archives</button>';
    html += '</div>';
    html += '<table>';
    html += '<thead><tr>';
    html += '<th class="col-score sortable' + (currentSort === 'score' ? ' sort-active' : '') + '" onclick="setSort(\'score\')">points' + sortArrow('score') + '</th>';
    html += '<th class="col-comments sortable' + (currentSort === 'comments' ? ' sort-active' : '') + '" onclick="setSort(\'comments\')"><span class="th-label">cmts' + sortArrow('comments') + '</span> <span class="open-all" onclick="event.stopPropagation();openAllLinks(\'' + sectionId + '\', \'lob\')">open all</span></th>';
    html += '<th><span class="open-all" onclick="openAllLinks(\'' + sectionId + '\', \'ext\')">open all</span></th>';
    html += '<th class="col-archived"><span class="open-all" onclick="openAllLinks(\'' + sectionId + '\', \'arc\')">open all</span></th>';
    html += '<th class="col-user"></th>';
    html += '<th class="col-date sortable' + (currentSort === 'date' ? ' sort-active' : '') + '" onclick="setSort(\'date\')">date' + sortArrow('date') + '</th>';
    html += '</tr></thead><tbody>';

    for (const item of topItems) {
        const score = parseInt(item.score) || 0;
        const comments = parseInt(item.comments_count) || 0;
        const lobUrl = item.comments_url || '';
        const domain = extractDomain(item.url);
        const articleUrl = item.url || lobUrl;
        const title = escapeHtml(item.title);
        const archivedUrl = (item.url && !isLobstersUrl(item.url)) ? 'https://web.archive.org/web/0/' + item.url : '';
        const user = item.username || '';
        const userUrl = user ? 'https://lobste.rs/~' + encodeURIComponent(user) : '';
        const postDate = item.date_posted ? item.date_posted.split(' ')[0] : '';

        html += '<tr class="post-row">';
        html += '<td class="col-score">' + score.toLocaleString() + '</td>';
        html += '<td class="col-comments"><a href="' + escapeHtml(lobUrl) + '" data-link="lob" target="_blank">' + comments.toLocaleString() + '</a></td>';
        html += '<td class="col-title"><a href="' + escapeHtml(articleUrl) + '" data-link="ext" target="_blank">' + title + '</a>';
        if (domain && !isLobstersUrl(item.url)) html += ' <span class="domain">(' + escapeHtml(domain) + ')</span>';
        html += renderTags(item.tags);
        html += '</td>';
        html += '<td class="col-archived">' + (archivedUrl ? '<a href="' + escapeHtml(archivedUrl) + '" data-link="arc" target="_blank">[archived]</a>' : '') + '</td>';
        html += '<td class="col-user">' + (user ? '<a href="' + userUrl + '" target="_blank">' + escapeHtml(user) + '</a>' : '') + '</td>';
        html += '<td class="col-date">' + postDate + '</td>';
        html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
}

async function render() {
    let sourceKey = currentInterval;
    if (sourceKey === '10y' || sourceKey === 'all') sourceKey = 'yearly';

    const loadingEl = document.getElementById('loading');

    if (!DATA[sourceKey]) {
        document.getElementById('content').innerHTML = '';
        loadingEl.style.display = 'block';
    }

    let records;
    try {
        records = await loadData(sourceKey);
    } catch (e) {
        loadingEl.style.display = 'none';
        document.getElementById('content').innerHTML = '<p style="text-align:center;color:var(--text-faint);padding:40px;">Failed to load data. Check that data files exist.</p>';
        return;
    }

    loadingEl.style.display = 'none';

    if (!records || records.length === 0) {
        document.getElementById('content').innerHTML = '<p style="text-align:center;color:var(--text-faint);padding:40px;">No data available for this interval.</p>';
        return;
    }

    const groups = groupByPeriod(records, currentInterval);
    const periodKeys = Object.keys(groups).sort((a, b) => periodSortKey(b, currentInterval) - periodSortKey(a, currentInterval));

    const byYear = {};
    for (const key of periodKeys) {
        const year = periodYear(key, currentInterval);
        if (!byYear[year]) byYear[year] = [];
        byYear[year].push(key);
    }

    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

    let html = '';
    if (currentInterval === 'all') {
        const key = periodKeys[0];
        const sectionId = 'p-all-time';
        const tableHtml = renderTable(groups[key], sectionId);
        if (tableHtml) {
            html += '<div class="year-section">';
            html += '<details open id="' + sectionId + '">';
            html += '<summary><span class="year-label">All Time</span></summary>';
            html += tableHtml;
            html += '</details></div>';
        }
    } else if (currentInterval === '10y') {
        for (const year of years) {
            const key = byYear[year][0];
            const yearId = 'y-' + year;
            const label = formatPeriodLabel(key, currentInterval);
            const tableHtml = renderTable(groups[key], yearId);
            if (tableHtml) {
                html += '<div class="year-section">';
                html += '<details open id="' + yearId + '">';
                html += '<summary><span class="year-label">' + label + '</span> <span class="permalink" onclick="copyPermalink(\'' + yearId + '\', event)">&#128279;</span></summary>';
                html += tableHtml;
                html += '</details></div>';
            }
        }
    } else {
        for (const year of years) {
            const yearId = 'y-' + year;
            let yearHtml = '';

            for (const key of byYear[year]) {
                const periodId = 'p-' + key;
                const label = formatPeriodLabel(key, currentInterval);
                const tableHtml = renderTable(groups[key], periodId);
                if (tableHtml) {
                    yearHtml += '<div class="period-section">';
                    yearHtml += '<details open id="' + periodId + '">';
                    yearHtml += '<summary>' + label + ' <span class="permalink" onclick="copyPermalink(\'' + periodId + '\', event)">&#128279;</span></summary>';
                    yearHtml += tableHtml;
                    yearHtml += '</details></div>';
                }
            }

            if (yearHtml) {
                html += '<div class="year-section">';
                html += '<details open id="' + yearId + '">';
                html += '<summary><span class="year-label">' + year + '</span> <span class="permalink" onclick="copyPermalink(\'' + yearId + '\', event)">&#128279;</span></summary>';
                html += yearHtml;
                html += '</details></div>';
            }
        }
    }

    document.getElementById('content').innerHTML = html;
    allExpanded = true;
    updateFabIcon();
    restoreVisitedLinks();
    renderTagFilters(records);
    renderTimeline(years, byYear);
    updateLastUpdated();

    // Prefetch yearly data (small) after first render
    if (sourceKey === 'monthly' && !DATA['yearly']) {
        loadData('yearly');
    }
}

let timelineObserver = null;

function renderTimeline(years, byYear) {
    const tl = document.getElementById('timeline');
    if (!tl) return;
    tl.className = (currentInterval === 'yearly' || currentInterval === '10y') ? 'tl-yearly' : '';
    let html = '';
    const ids = [];

    if (currentInterval === 'all') {
        tl.innerHTML = '';
        tl.style.display = 'none';
        return;
    }
    tl.style.display = '';

    if (currentInterval === '10y') {
        for (const year of years) {
            const id = 'y-' + year;
            ids.push(id);
            html += '<div class="tl-item tl-year-start" data-id="' + id + '" onclick="scrollToId(\'' + id + '\')">';
            html += '<span class="tl-year-text">' + year + 's</span>';
            html += '<span class="tl-tick"></span>';
            html += '</div>';
        }
    } else if (currentInterval === 'yearly') {
        for (const year of years) {
            const id = 'y-' + year;
            ids.push(id);
            html += '<div class="tl-item tl-year-start" data-id="' + id + '" onclick="scrollToId(\'' + id + '\')">';
            html += '<span class="tl-year-text">' + year + '</span>';
            html += '<span class="tl-tick"></span>';
            html += '</div>';
        }
    } else if (currentInterval === 'monthly') {
        for (const year of years) {
            const periods = byYear[year];
            for (let i = 0; i < periods.length; i++) {
                const key = periods[i];
                const id = 'p-' + key;
                ids.push(id);
                const parts = key.split('-');
                const isFirst = (i === 0);
                const label = MONTH_NAMES[parseInt(parts[1])] + ' ' + parts[0];
                html += '<div class="tl-item' + (isFirst ? ' tl-year-start' : '') + '" data-id="' + id + '" data-label="' + label + '" onclick="scrollToId(\'' + id + '\')">';
                if (isFirst) html += '<span class="tl-year-text">' + year + '</span>';
                html += '<span class="tl-tick"></span>';
                html += '</div>';
            }
        }
    } else {
        // Weekly: use month/year scale (group weeks by month)
        for (const year of years) {
            const periods = byYear[year];
            let lastMonth = null;
            for (let i = 0; i < periods.length; i++) {
                const key = periods[i];
                const parts = key.split('-W');
                const wk = parseInt(parts[1]);
                const yr = parseInt(parts[0]);
                const range = isoWeekToDateRange(yr, wk);
                const month = range.start.getMonth();
                if (lastMonth === month) continue;
                lastMonth = month;
                const id = 'p-' + key;
                ids.push(id);
                const isFirst = (i === 0);
                const label = MONTH_NAMES[month + 1] + ' ' + yr;
                html += '<div class="tl-item' + (isFirst ? ' tl-year-start' : '') + '" data-id="' + id + '" data-label="' + label + '" onclick="scrollToId(\'' + id + '\')">';
                if (isFirst) html += '<span class="tl-year-text">' + year + '</span>';
                html += '<span class="tl-tick"></span>';
                html += '</div>';
            }
        }
    }

    tl.innerHTML = html;
    setupScrollTracking(ids);
    setupTimelineTooltip();
}

function scrollToId(id) {
    const el = document.getElementById(id);
    if (!el) return;
    let node = el;
    while (node) {
        if (node.tagName === 'DETAILS') node.open = true;
        node = node.parentElement;
    }
    el.querySelectorAll('details').forEach(d => d.open = true);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateURL('#' + id);
}

function setupScrollTracking(ids) {
    if (timelineObserver) timelineObserver.disconnect();

    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (els.length === 0) return;

    timelineObserver = new IntersectionObserver((entries) => {
        let topVisible = null;
        let topY = Infinity;
        for (const entry of entries) {
            if (entry.isIntersecting) {
                const rect = entry.boundingClientRect;
                if (rect.top < topY) {
                    topY = rect.top;
                    topVisible = entry.target.id;
                }
            }
        }
        if (topVisible) {
            document.querySelectorAll('.tl-item').forEach(el => {
                el.classList.toggle('active', el.dataset.id === topVisible);
            });
            const activeEl = document.querySelector('.tl-item.active');
            if (activeEl) {
                const timeline = document.getElementById('timeline');
                const items = Array.from(timeline.querySelectorAll('.tl-item'));
                const idx = items.indexOf(activeEl);
                const target = items[Math.min(idx + 3, items.length - 1)];
                target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

    els.forEach(el => timelineObserver.observe(el));
}

function setupTimelineTooltip() {
    const tooltip = document.getElementById('tl-tooltip');
    if (!tooltip) return;

    document.querySelectorAll('.tl-item[data-label]').forEach(item => {
        item.addEventListener('mouseenter', function() {
            const label = this.dataset.label;
            if (!label) return;
            const rect = this.getBoundingClientRect();
            tooltip.textContent = label;
            tooltip.style.top = (rect.top + rect.height / 2) + 'px';
            tooltip.style.right = (window.innerWidth - rect.left + 8) + 'px';
            tooltip.classList.add('visible');
        });
        item.addEventListener('mouseleave', function() {
            tooltip.classList.remove('visible');
        });
    });
}

function restoreVisitedLinks() {
    const visited = JSON.parse(localStorage.getItem('lob_visited') || '{}');
    document.querySelectorAll('a[data-link="ext"]').forEach(a => {
        if (visited[a.href]) a.classList.add('visited');
    });
}
document.addEventListener('mousedown', function(e) {
    if (e.button === 2) return;
    const a = e.target.closest('a[data-link="ext"]');
    if (!a) return;
    const visited = JSON.parse(localStorage.getItem('lob_visited') || '{}');
    a.classList.add('visited');
    visited[a.href] = true;
    localStorage.setItem('lob_visited', JSON.stringify(visited));
});

function applyURLParams() {
    const params = new URLSearchParams(window.location.search);
    const intervalParam = params.get('interval');
    const topParam = params.get('top');
    const sortParam = params.get('displaysort');

    if (intervalParam && INTERVAL_MAP[intervalParam]) {
        currentInterval = INTERVAL_MAP[intervalParam];
        document.querySelectorAll('[data-interval]').forEach(b => {
            b.classList.toggle('active', b.dataset.interval === currentInterval);
        });
    }

    if (topParam) {
        const n = parseInt(topParam);
        if (VALID_TOPN.includes(n)) {
            currentTopN = n;
            document.querySelectorAll('[data-topn]').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.topn) === n);
            });
        }
    }

    if (sortParam && VALID_SORTS.includes(sortParam)) {
        currentSort = sortParam;
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    applyURLParams();
    await render();
    if (window.location.hash) {
        setTimeout(() => {
            const el = document.getElementById(window.location.hash.slice(1));
            if (el) {
                let node = el;
                while (node) {
                    if (node.tagName === 'DETAILS') node.open = true;
                    node = node.parentElement;
                }
                el.scrollIntoView({ behavior: 'smooth' });
            }
        }, 50);
    }
});

window.addEventListener('popstate', async function() {
    const oldInterval = currentInterval;
    const oldTopN = currentTopN;
    const oldSort = currentSort;
    applyURLParams();
    if (currentInterval !== oldInterval || currentTopN !== oldTopN || currentSort !== oldSort) {
        await render();
    }
    if (window.location.hash) {
        const el = document.getElementById(window.location.hash.slice(1));
        if (el) {
            let node = el;
            while (node) {
                if (node.tagName === 'DETAILS') node.open = true;
                node = node.parentElement;
            }
            el.scrollIntoView({ behavior: 'smooth' });
        }
    }
});
