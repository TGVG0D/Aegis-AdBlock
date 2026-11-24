import { setBadgeBackgroundColor, setBadgeText, setBadgeTextColor } from '../utils/browser.js';
import { hostnameFromUrl } from '../utils/urls.js';

const MAX_RULES_PER_TAB = 25;
const MAX_HOSTS_PER_TAB = 25;

const tabs = new Map();

function emptyTab(tabId) {
  return {
    tabId,
    pageUrl: '',
    hostname: '',
    startedAt: Date.now(),
    requests: 0,
    blocked: 0,
    categories: {},
    types: {},
    blockedHosts: {},
    rules: {},
    cosmetic: 0,
    lastBlockAt: 0,
    whitelisted: false,
  };
}

export function getTabState(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  let state = tabs.get(tabId);
  if (!state) {
    state = emptyTab(tabId);
    tabs.set(tabId, state);
  }
  return state;
}

export function touchTab(tabId, patch = {}) {
  const state = getTabState(tabId);
  if (!state) return null;
  if (patch.pageUrl !== undefined) state.pageUrl = String(patch.pageUrl || '');
  if (patch.hostname !== undefined) state.hostname = String(patch.hostname || '').toLowerCase();
  return state;
}

export function resetTab(tabId, url = '') {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  const state = emptyTab(tabId);
  state.pageUrl = String(url || '');
  state.hostname = hostnameFromUrl(url);
  tabs.set(tabId, state);
  updateBadge(tabId, { count: 0 });
  return state;
}

export function removeTab(tabId) {
  tabs.delete(tabId);
}

export function recordTabRequest(tabId, { blocked, category = 'other', type = 'other', hostname = '', rule = '' } = {}) {
  const state = getTabState(tabId);
  if (!state) return;
  state.requests += 1;
  if (!blocked) return;
  state.blocked += 1;
  state.lastBlockAt = Date.now();
  state.categories[category] = (state.categories[category] || 0) + 1;
  state.types[type] = (state.types[type] || 0) + 1;
  if (hostname) {
    state.blockedHosts[hostname] = (state.blockedHosts[hostname] || 0) + 1;
    trimObject(state.blockedHosts, MAX_HOSTS_PER_TAB);
  }
  if (rule) {
    state.rules[rule] = (state.rules[rule] || 0) + 1;
    trimObject(state.rules, MAX_RULES_PER_TAB);
  }
  updateBadge(tabId, state);
}

function trimObject(object, max) {
  const keys = Object.keys(object);
  if (keys.length <= max) return;
  keys
    .sort((a, b) => object[b] - object[a])
    .slice(max)
    .forEach((key) => {
      delete object[key];
    });
}

function topEntries(object, max = 10) {
  return Object.entries(object || {})
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max);
}

export function setTabCosmeticCount(tabId, count) {
  const state = getTabState(tabId);
  if (!state) return;
  state.cosmetic = Math.max(0, Number(count) || 0);
}

export function getTabSnapshot(tabId) {
  const state = getTabState(tabId);
  if (!state) {
    return {
      tabId: -1,
      hostname: '',
      pageUrl: '',
      blocked: 0,
      requests: 0,
      categories: {},
      types: {},
      topHosts: [],
      topRules: [],
      cosmetic: 0,
      startedAt: 0,
      lastBlockAt: 0,
    };
  }
  return {
    tabId,
    hostname: state.hostname,
    pageUrl: state.pageUrl,
    blocked: state.blocked,
    requests: state.requests,
    categories: { ...state.categories },
    types: { ...state.types },
    topHosts: topEntries(state.blockedHosts, 8),
    topRules: topEntries(state.rules, 8),
    cosmetic: state.cosmetic,
    startedAt: state.startedAt,
    lastBlockAt: state.lastBlockAt,
    whitelisted: state.whitelisted,
  };
}

export function setTabWhitelisted(tabId, value) {
  const state = getTabState(tabId);
  if (!state) return;
  state.whitelisted = Boolean(value);
}

export function formatBadgeCount(count) {
  const value = Math.max(0, Number(count) || 0);
  if (value === 0) return '';
  if (value > 9999) return '9k+';
  if (value > 999) return `${Math.floor(value / 1000)}k`;
  return String(value);
}

export async function updateBadge(tabId, patch = {}) {
  const state = getTabState(tabId);
  if (!state) return;
  if (patch.count !== undefined) state.blocked = Math.max(0, Number(patch.count) || 0);
  const { showBadge = true, badgeShowCount = true, enabled = true } = patch.settings || {};
  const count = state.blocked;
  let text = '';
  if (!enabled) text = 'off';
  else if (showBadge) text = badgeShowCount ? formatBadgeCount(count) : count > 0 ? '•' : '';
  try {
    await setBadgeText({ tabId, text });
    if (text && text !== 'off') {
      const color = count >= 50 ? '#dc2626' : count >= 10 ? '#d97706' : '#0891b2';
      await setBadgeBackgroundColor({ tabId, color });
      await setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
    } else if (text === 'off') {
      await setBadgeBackgroundColor({ tabId, color: '#475569' });
    }
  } catch {
    // Badge failures must never break request handling.
  }
}

export async function refreshAllBadges(settings) {
  await Promise.allSettled(
    [...tabs.keys()].map((tabId) => updateBadge(tabId, { settings })),
  );
}

export function listTabs() {
  return [...tabs.values()].map((state) => getTabSnapshot(state.tabId));
}

export { topEntries };
