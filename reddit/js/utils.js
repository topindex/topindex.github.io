/**
 * Shared utilities for Reddit Top Light
 */

export function formatNumber(n) {
  if (n == null) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

export function formatDate(unixSec) {
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthYear(unixSec) {
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatWeekRange(startUnix, endUnix) {
  const s = new Date(startUnix * 1000);
  const e = new Date(endUnix * 1000);
  const sStr = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const eStr = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${sStr} - ${eStr}`;
}

export function formatDayHeader(unixSec) {
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatYearHeader(unixSec) {
  return new Date(unixSec * 1000).getFullYear().toString();
}

export function archiveUrl(originalUrl) {
  return 'https://web.archive.org/web/0/' + originalUrl;
}

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function updateUrlParams(params) {
  const url = new URL(window.location);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  history.replaceState(null, '', url);
}

export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function decodeHtmlEntities(str) {
  if (!str) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

/**
 * Generate time boundaries for a given interval.
 * @param {string} interval - '1d', '1w', '1m', '1y'
 * @param {number} count - max number of boundaries
 * @param {Date} referenceDate - end reference point (default: now)
 * @param {Date|null} fromDate - if set, exclude boundaries ending before this date
 * @param {Date|null} toDate - if set, use as reference point instead of referenceDate
 */
export function calculateTimeBoundaries(interval, count, referenceDate = new Date(), fromDate = null, toDate = null) {
  const boundaries = [];
  const ref = new Date(toDate || referenceDate);
  const fromTs = fromDate ? Math.floor(fromDate.getTime() / 1000) : null;

  for (let i = 0; i < count; i++) {
    let start, end, label;

    switch (interval) {
      case '1d': {
        const d = new Date(ref);
        d.setDate(d.getDate() - i);
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        label = formatDayHeader(start.getTime() / 1000);
        break;
      }
      case '1w': {
        const d = new Date(ref);
        const dayOfWeek = d.getDay();
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        d.setDate(d.getDate() - mondayOffset - (i * 7));
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        const sunday = new Date(start);
        sunday.setDate(sunday.getDate() + 6);
        end = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59);
        label = formatWeekRange(start.getTime() / 1000, end.getTime() / 1000);
        break;
      }
      case '1m': {
        const year = ref.getFullYear();
        const month = ref.getMonth() - i;
        start = new Date(year, month, 1, 0, 0, 0);
        end = new Date(year, month + 1, 0, 23, 59, 59);
        label = formatMonthYear(start.getTime() / 1000);
        break;
      }
      case '1y': {
        const year = ref.getFullYear() - i;
        start = new Date(year, 0, 1, 0, 0, 0);
        end = new Date(year, 11, 31, 23, 59, 59);
        label = formatYearHeader(start.getTime() / 1000);
        break;
      }
    }

    const endTs = Math.floor(end.getTime() / 1000);

    // Stop if this boundary ends before the from date
    if (fromTs && endTs < fromTs) break;

    boundaries.push({
      start: Math.floor(start.getTime() / 1000),
      end: endTs,
      label
    });
  }

  return boundaries;
}

const FALLBACK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23ccc"/><text x="20" y="26" text-anchor="middle" fill="white" font-size="14" font-family="sans-serif">r/</text></svg>';
export const FALLBACK_ICON = `data:image/svg+xml,${encodeURIComponent(FALLBACK_ICON_SVG)}`;
