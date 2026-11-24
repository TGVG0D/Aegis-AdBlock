import {
  IS_GECKO,
  REQUEST_TYPE_MAP,
  SITE_BLOCK_LIST_ID,
  SITE_BLOCK_LIST_NAME,
  TARGET,
} from '../engine/constants.js';
import { emitBackgroundEvent } from './events.js';
import {
  ensureRuntimeReady,
  getRuntime,
  getSiteBlockMatch,
  getWhitelistEntry,
  isPaused,
} from './engineRuntime.js';
import { recordRequest } from './historyService.js';
import { recordBlockedPageContext } from './siteBlockService.js';
import {
  getTabState,
  recordTabRequest,
  resetTab,
  touchTab,
  updateBadge,
} from './tabService.js';
import { getApi } from '../utils/browser.js';
import { hostnameFromUrl } from '../utils/urls.js';

const OBSERVED_LIMIT = 2500;
const OBSERVED_MAX_AGE = 30000;
const observed = new Map();
let listenersReady = false;

function normalizeType(type) {
  return REQUEST_TYPE_MAP[type] || 'other';
}

function isSupportedUrl(url) {
  return typeof url === 'string' && /^(https?|wss?):\/\//i.test(url);
}

function tabPageHostname(tabId) {
  const state = getTabState(tabId);
  return state?.hostname || '';
}

function resolveInitiator(details, tabHostname) {
  const candidate = details.originUrl || details.documentUrl || details.initiator || '';
  if (candidate) return candidate;
  const state = getTabState(details.tabId);
  return state?.pageUrl || (tabHostname ? `https://${tabHostname}/` : '');
}

function rememberObserved(details, matched) {
  if (observed.size > OBSERVED_LIMIT) {
    const cutoff = Date.now() - OBSERVED_MAX_AGE;
    for (const [key, value] of observed) {
      if (value.at < cutoff) observed.delete(key);
      if (observed.size <= OBSERVED_LIMIT * 0.75) break;
    }
  }
  observed.set(details.requestId, {
    at: Date.now(),
    tabId: details.tabId,
    type: normalizeType(details.type),
    initiator: details.originUrl || details.documentUrl || details.initiator || '',
    hostname: hostnameFromUrl(details.url),
    url: details.url,
    matched: Boolean(matched),
  });
}

function wasObserved(requestId) {
  const value = observed.get(requestId);
  if (!value) return false;
  observed.delete(requestId);
  return value;
}

function applyTabUpdate(tabId, { blocked, filter, type, hostname }) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const runtime = getRuntime();
  recordTabRequest(tabId, {
    blocked,
    category: filter?.category || 'other',
    type,
    hostname,
    rule: filter?.raw || '',
  });
  if (blocked) updateBadge(tabId, { settings: runtime.settings });
}

/**
 * Core decision function shared by both targets.
 * Returns a webRequest BlockingResponse for Firefox and observational data for Chromium.
 */
function decide(details) {
  const runtime = getRuntime();
  const url = details.url || '';
  if (!isSupportedUrl(url)) return { blocked: false, skip: true };

  const type = normalizeType(details.type);
  if (details.type === 'main_frame' && Number.isInteger(details.tabId) && details.tabId >= 0) {
    resetTab(details.tabId, url);
  } else if (Number.isInteger(details.tabId) && details.tabId >= 0) {
    const state = getTabState(details.tabId);
    if (state && !state.hostname) touchTab(details.tabId, { hostname: tabPageHostname(details.tabId) });
  }

  if (!runtime.ready || !runtime.engine) return { blocked: false, skip: true };

  const tabHostname = tabPageHostname(details.tabId);
  const initiator = resolveInitiator(details, tabHostname);
  const requestHostname = hostnameFromUrl(url);
  const siteHostname = hostnameFromUrl(initiator) || tabHostname || requestHostname;

  // Global disable/pause suspends every kind of blocking, including the list
  // managed by the user. The list still takes precedence over site whitelists.
  if (!runtime.settings?.enabled || isPaused()) {
    applyTabUpdate(details.tabId, { blocked: false, filter: null, type, hostname: requestHostname });
    recordRequest({
      url,
      type,
      initiator,
      tabId: details.tabId,
      hostname: requestHostname,
      tabHostname: siteHostname,
      blocked: false,
    }).catch(() => {});
    return { blocked: false, skip: false, disabled: true };
  }

  if (details.type === 'main_frame') {
    const siteBlock = getSiteBlockMatch(url, 'document');
    if (siteBlock.matched && siteBlock.entry) {
      const entry = siteBlock.entry;
      const filter = {
        raw: siteBlock.rule,
        listId: SITE_BLOCK_LIST_ID,
        listName: SITE_BLOCK_LIST_NAME,
        category: 'other',
        siteBlock: true,
        entryId: entry.id,
        action: entry.action,
        redirectUrl: entry.redirectUrl,
      };
      applyTabUpdate(details.tabId, {
        blocked: true,
        filter,
        type: 'document',
        hostname: requestHostname,
      });
      recordRequest({
        url,
        type: 'document',
        initiator: url,
        tabId: details.tabId,
        hostname: requestHostname,
        tabHostname: siteHostname,
        blocked: true,
        filter,
      }).catch((error) => console.warn('[Aegis] falha ao registrar bloqueio da lista', error));
      recordBlockedPageContext(details.tabId, {
        url,
        hostname: requestHostname,
        domain: entry.domain,
        entryId: entry.id,
        action: entry.action,
        rule: siteBlock.rule,
        redirectUrl: entry.redirectUrl,
      });
      emitBackgroundEvent('request:blocked', {
        tabId: details.tabId,
        site: siteHostname,
        url,
        type: 'document',
        category: 'other',
        siteBlock: true,
      });
      return {
        blocked: true,
        siteBlock: entry,
        filter,
        whitelisted: false,
        skip: false,
      };
    }
  }

  const whitelisted =
    Boolean(getWhitelistEntry(siteHostname)) || Boolean(getWhitelistEntry(requestHostname));

  if (whitelisted) {
    applyTabUpdate(details.tabId, { blocked: false, filter: null, type, hostname: requestHostname });
    recordRequest({
      url,
      type,
      initiator,
      tabId: details.tabId,
      hostname: requestHostname,
      tabHostname: siteHostname,
      blocked: false,
    }).catch(() => {});
    return { blocked: false, whitelisted, skip: false };
  }

  let result;
  try {
    result = runtime.engine.match({
      url,
      type,
      initiator: siteHostname,
      hostname: requestHostname,
      tabId: details.tabId,
    });
  } catch (error) {
    console.warn('[Aegis] falha ao avaliar requisição', error);
    return { blocked: false, error: true, skip: true };
  }

  const blocked = Boolean(result.blocked);
  applyTabUpdate(details.tabId, { blocked, filter: result.filter, type, hostname: requestHostname });
  recordRequest({
    url,
    type,
    initiator,
    tabId: details.tabId,
    hostname: requestHostname,
    tabHostname: siteHostname,
    blocked,
    filter: result.filter,
  }).catch((error) => console.warn('[Aegis] falha ao registrar requisição', error));

  if (blocked) {
    emitBackgroundEvent('request:blocked', {
      tabId: details.tabId,
      site: siteHostname,
      url,
      type,
      category: result.filter?.category || 'other',
    });
  }
  return { blocked, filter: result.filter, whitelisted: false, skip: false };
}

function blockedPageUrl(entry, originalUrl = '') {
  const api = getApi();
  const base = api?.runtime?.getURL
    ? api.runtime.getURL('blocked/blocked.html')
    : '/blocked/blocked.html';
  const params = new URLSearchParams();
  if (entry?.id) params.set('entry', entry.id);
  if (originalUrl) params.set('url', String(originalUrl).slice(0, 1800));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function handleBeforeRequest(details) {
  // Ensure the runtime wakes up after the service worker was suspended.
  ensureRuntimeReady().catch((error) => console.warn('[Aegis] runtime indisponível', error));
  const decision = decide(details);
  if (TARGET === 'chromium') {
    rememberObserved(details, decision.blocked);
    // Chromium never blocks here: declarativeNetRequest does it. This listener
    // only observes traffic for statistics/history when the event is delivered.
    return undefined;
  }
  if (decision.siteBlock) {
    if (decision.siteBlock.action === 'redirect' && decision.siteBlock.redirectUrl) {
      return { redirectUrl: decision.siteBlock.redirectUrl };
    }
    return { redirectUrl: blockedPageUrl(decision.siteBlock, details.url) };
  }
  if (decision.blocked) return { cancel: true };
  return undefined;
}

function handleErrorOccurred(details) {
  if (TARGET !== 'chromium') return;
  if (!/BLOCKED_BY_CLIENT|BLOCKED_BY_EXTENSION|BLOCKED_BY_RESPONSE/i.test(details.error || '')) return;
  const already = wasObserved(details.requestId);
  if (already) return;
  const runtime = getRuntime();
  if (!runtime.ready || !runtime.engine) return;
  if (!runtime.settings?.enabled || isPaused()) return;
  if (!isSupportedUrl(details.url)) return;

  const type = normalizeType(details.type);
  const requestHostname = hostnameFromUrl(details.url);
  const tabHostname = tabPageHostname(details.tabId);
  const initiator =
    details.originUrl || details.documentUrl || details.initiator || (tabHostname ? `https://${tabHostname}/` : '');
  const result = runtime.engine.match({
    url: details.url,
    type,
    initiator: hostnameFromUrl(initiator),
    hostname: requestHostname,
    tabId: details.tabId,
  });
  // Only trust the fallback when our own engine agrees the request should be blocked;
  // this avoids counting blocks performed by other extensions.
  if (!result.blocked) return;
  applyTabUpdate(details.tabId, { blocked: true, filter: result.filter, type, hostname: requestHostname });
  recordRequest({
    url: details.url,
    type,
    initiator,
    tabId: details.tabId,
    hostname: requestHostname,
    tabHostname,
    blocked: true,
    filter: result.filter,
    fallback: true,
  }).catch(() => {});
}

export function installRequestListeners() {
  if (listenersReady) return;
  const api = getApi();
  if (!api?.webRequest?.onBeforeRequest) {
    console.warn('[Aegis] webRequest indisponível; bloqueio nativo desativado.');
    return;
  }
  const extraInfo = IS_GECKO ? ['blocking'] : [];
  try {
    api.webRequest.onBeforeRequest.addListener(
      handleBeforeRequest,
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      extraInfo,
    );
  } catch (error) {
    console.warn('[Aegis] não foi possível instalar o listener de bloqueio', error);
  }
  if (api.webRequest.onErrorOccurred && TARGET === 'chromium') {
    api.webRequest.onErrorOccurred.addListener(handleErrorOccurred, {
      urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
    });
  }
  if (api.webRequest.onBeforeRedirect) {
    api.webRequest.onBeforeRedirect.addListener((details) => {
      const value = observed.get(details.requestId);
      if (value) value.at = Date.now();
    }, { urls: ['http://*/*', 'https://*/*'] });
  }
  listenersReady = true;
}

export function uninstallRequestListeners() {
  const api = getApi();
  if (!api?.webRequest || !listenersReady) return;
  try {
    api.webRequest.onBeforeRequest.removeListener(handleBeforeRequest);
    api.webRequest.onErrorOccurred?.removeListener(handleErrorOccurred);
  } catch {
    // ignore
  }
  listenersReady = false;
}

export function handleNavigation(tabId, url) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  if (!url || !/^https?:/i.test(url)) {
    resetTab(tabId, '');
    return;
  }
  resetTab(tabId, url);
}

export function getObservationStats() {
  return { observed: observed.size };
}

export { decide };
