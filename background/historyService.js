import { LIMITS } from '../engine/constants.js';
import { addHistoryEvents, enforceHistoryLimits } from '../storage/db.js';
import { getSettings } from '../storage/settings.js';
import { createDefaultStats, getStats, setStats } from '../storage/state.js';
import { emitBackgroundEvent } from './events.js';
import { dayKey, dayKeyToDate, formatDate, recentDayKeys } from '../utils/dates.js';
import { hostnameFromUrl, sanitizeRequestUrl } from '../utils/urls.js';

const FLUSH_DELAY_MS = 1200;
const MAX_PENDING_EVENTS = 4000;
const MAX_SITES = 2000;
const MAX_DAYS = 400;

let statsCache = null;
let statsLoading = null;
let statsTimer = null;
let historyTimer = null;
let flushing = null;
let pendingEvents = new Map();
let lastPersistError = 0;
let cachedSettings = null;

export function setHistorySettings(settings) {
  cachedSettings = settings || null;
}

function currentSettings() {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  return getSettings()
    .then((settings) => {
      cachedSettings = settings;
      return settings;
    })
    .catch(() => null);
}

function schedule(fn, delay) {
  // setTimeout is allowed in service workers and keeps the bundle simple.
  return setTimeout(fn, delay);
}

function ensureDay(stats, key) {
  const current = stats.byDay[key];
  if (!current || typeof current !== 'object') {
    stats.byDay[key] = { requests: 0, blocked: 0 };
  } else {
    current.requests = Number(current.requests) || 0;
    current.blocked = Number(current.blocked) || 0;
  }
  return stats.byDay[key];
}

function ensureSite(stats, site) {
  if (!site) return null;
  const current = stats.bySite[site];
  if (!current || typeof current !== 'object') {
    stats.bySite[site] = { requests: 0, blocked: 0 };
  } else {
    current.requests = Number(current.requests) || 0;
    current.blocked = Number(current.blocked) || 0;
  }
  return stats.bySite[site];
}

function trimSites(stats) {
  const entries = Object.entries(stats.bySite);
  if (entries.length <= MAX_SITES) return;
  entries
    .sort((a, b) => (Number(b[1]?.blocked) || 0) - (Number(a[1]?.blocked) || 0))
    .slice(MAX_SITES)
    .forEach(([site]) => {
      delete stats.bySite[site];
    });
}

function trimDays(stats, retentionDays) {
  const cutoff = dayKey(Date.now() - Math.max(30, retentionDays) * 24 * 60 * 60 * 1000);
  const keys = Object.keys(stats.byDay);
  if (keys.length <= MAX_DAYS) {
    for (const key of keys) {
      if (key < cutoff) delete stats.byDay[key];
    }
    return;
  }
  keys.sort();
  for (const key of keys.slice(0, keys.length - MAX_DAYS)) delete stats.byDay[key];
}

export async function ensureStatsLoaded() {
  if (statsCache) return statsCache;
  if (!statsLoading) {
    statsLoading = getStats()
      .then((stats) => {
        statsCache = stats || createDefaultStats();
        return statsCache;
      })
      .finally(() => {
        statsLoading = null;
      });
  }
  return statsLoading;
}

function scheduleStatsFlush() {
  if (statsTimer) return;
  statsTimer = schedule(() => {
    statsTimer = null;
    flushStats().catch((error) => console.warn('[Aegis] falha ao salvar estatísticas', error));
  }, FLUSH_DELAY_MS);
}

export async function flushStats() {
  if (!statsCache) return;
  const settings = await currentSettings();
  trimSites(statsCache);
  trimDays(statsCache, settings?.statsRetentionDays || 90);
  statsCache.updatedAt = Date.now();
  try {
    await setStats(statsCache);
    lastPersistError = 0;
  } catch (error) {
    lastPersistError = Date.now();
    throw error;
  }
}

function siteForEvent({ initiator, tabHostname, requestHostname, type }) {
  const initiatorHost = hostnameFromUrl(initiator || '');
  if (initiatorHost) return initiatorHost;
  if (tabHostname) return tabHostname;
  if (type === 'document') return requestHostname || '';
  return '';
}

/**
 * Record one observed request and, when blocked, queue a history row.
 * Aggregates bursts with identical url/rule to keep IndexedDB writes small.
 */
export async function recordRequest(details) {
  const stats = await ensureStatsLoaded();
  const settings = await currentSettings();
  const now = Date.now();
  const requestHost = details.hostname || hostnameFromUrl(details.url || '');
  const site = siteForEvent({ ...details, requestHostname: requestHost });
  const type = String(details.type || 'other');
  const today = ensureDay(stats, dayKey(now));
  stats.totalRequests = (stats.totalRequests || 0) + 1;
  today.requests += 1;
  const siteStats = ensureSite(stats, site);
  if (siteStats) siteStats.requests += 1;

  if (details.blocked) {
    stats.totalBlocked = (stats.totalBlocked || 0) + 1;
    const category = details.filter?.category || 'other';
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    today.blocked += 1;
    if (siteStats) siteStats.blocked += 1;
    stats.updatedAt = now;

    if (settings?.history?.enabled !== false) {
      const storePath = settings?.history?.detail !== 'host';
      const sanitized = sanitizeRequestUrl(details.url, { storePath, maxLength: 500 });
      if (sanitized.url) {
        const filter = details.filter || {};
        const key = [
          site,
          sanitized.url,
          type,
          filter.raw || '',
          filter.listId || '',
          category,
        ].join('\u0001');
        const pending = pendingEvents.get(key);
        if (pending) {
          pending.count += 1;
        } else if (pendingEvents.size < MAX_PENDING_EVENTS) {
          pendingEvents.set(key, {
            ts: now,
            site,
            url: sanitized.url,
            type,
            category,
            rule: String(filter.raw || details.rule || ''),
            listId: String(filter.listId || ''),
            listName: String(filter.listName || ''),
            count: 1,
          });
        }
        scheduleHistoryFlush();
      }
    }
  }

  stats.updatedAt = now;
  scheduleStatsFlush();
  return { site, totalBlocked: stats.totalBlocked };
}

function scheduleHistoryFlush() {
  if (historyTimer) return;
  historyTimer = schedule(() => {
    historyTimer = null;
    flushHistory().catch((error) => console.warn('[Aegis] falha ao salvar histórico', error));
  }, FLUSH_DELAY_MS);
}

export async function flushHistory() {
  if (!pendingEvents.size) return 0;
  if (flushing) {
    await flushing.catch(() => {});
    return flushHistory();
  }
  const batch = [...pendingEvents.values()];
  pendingEvents = new Map();
  flushing = addHistoryEvents(batch)
    .then((written) => {
      emitBackgroundEvent('history:changed', { added: written });
      enforceHistoryLimitsFromSettings().catch(() => {});
      return written;
    })
    .catch((error) => {
      // Put events back (bounded) so a transient IndexedDB failure does not lose data.
      let reinserted = 0;
      for (const event of batch) {
        if (pendingEvents.size >= MAX_PENDING_EVENTS) break;
        const key = `${event.site}\u0001${event.url}\u0001${event.ts}\u0001${reinserted}`;
        pendingEvents.set(key, event);
        reinserted += 1;
      }
      throw error;
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

export async function enforceHistoryLimitsFromSettings() {
  const settings = await currentSettings();
  if (!settings?.history?.autoCleanup) return { removed: 0 };
  return enforceHistoryLimits({
    retentionDays: settings.history.retentionDays,
    maxEntries: settings.history.maxEntries,
  });
}

export async function getStatsSnapshot() {
  await ensureStatsLoaded();
  await flushStats().catch(() => {});
  return buildStatsView(statsCache);
}

export async function getStatsView({ days = 30 } = {}) {
  const stats = await ensureStatsLoaded();
  const count = Math.max(1, Math.min(365, Number(days) || 30));
  return buildStatsView(stats, count);
}

export function buildStatsView(stats, days = 30) {
  const series = recentDayKeys(Math.max(1, Math.min(365, days))).map((key) => {
    const value = stats.byDay?.[key];
    const entry = value && typeof value === 'object' ? value : { requests: 0, blocked: 0 };
    return {
      date: key,
      label: formatDate(dayKeyToDate(key).getTime()),
      requests: Number(entry.requests) || 0,
      blocked: Number(entry.blocked) || 0,
    };
  });

  const topSites = Object.entries(stats.bySite || {})
    .map(([site, value]) => ({
      site,
      requests: Number(value?.requests) || 0,
      blocked: Number(value?.blocked) || 0,
    }))
    .filter((entry) => entry.site && (entry.blocked > 0 || entry.requests > 0))
    .sort((a, b) => b.blocked - a.blocked || b.requests - a.requests || a.site.localeCompare(b.site))
    .slice(0, 100);

  const totalRequests = Number(stats.totalRequests) || 0;
  const totalBlocked = Number(stats.totalBlocked) || 0;
  const today = stats.byDay?.[dayKey()] || { requests: 0, blocked: 0 };
  const categories = Object.entries(stats.byCategory || {}).map(([category, count]) => ({
    category,
    count: Number(count) || 0,
  }));
  const types = Object.entries(stats.byType || {})
    .map(([type, count]) => ({ type, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRequests,
    totalBlocked,
    blockRate: totalRequests ? (totalBlocked / totalRequests) * 100 : 0,
    todayRequests: Number(today.requests) || 0,
    todayBlocked: Number(today.blocked) || 0,
    createdAt: stats.createdAt || 0,
    updatedAt: stats.updatedAt || 0,
    categories,
    types,
    series,
    topSites,
    persistentError: lastPersistError,
  };
}

export async function resetStats() {
  statsCache = createDefaultStats();
  statsTimer && clearTimeout(statsTimer);
  statsTimer = null;
  await setStats(statsCache);
  emitBackgroundEvent('stats:changed', { reset: true });
  return buildStatsView(statsCache);
}

export async function clearPendingHistory() {
  pendingEvents.clear();
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = null;
}

/** Discard in-memory state so a full extension reset cannot resurrect old data. */
export function resetHistoryRuntime() {
  pendingEvents.clear();
  statsCache = null;
  statsLoading = null;
  cachedSettings = null;
  if (statsTimer) clearTimeout(statsTimer);
  if (historyTimer) clearTimeout(historyTimer);
  statsTimer = null;
  historyTimer = null;
}

export function getLiveStatsAddress() {
  return statsCache;
}

export async function flushAll() {
  await Promise.allSettled([flushStats(), flushHistory()]);
}

export { LIMITS, buildStatsView as buildStats };
