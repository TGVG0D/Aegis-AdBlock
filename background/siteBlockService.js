/**
 * User block list service: persistence, CRUD, temporary bypasses and the
 * context needed by the blocked page to identify the responsible rule.
 */

import {
  LIMITS,
  SITE_BLOCK_BYPASS_MS,
  SITE_BLOCK_LIST_NAME,
  STORAGE_KEYS,
} from '../engine/constants.js';
import {
  matchSiteBlock,
  normalizeBypasses,
  siteBlockRule,
  validateSiteBlock,
} from '../engine/siteBlock.js';
import {
  getSiteBlocks,
  normalizeSiteBlockEntry,
  setSiteBlocks,
} from '../storage/state.js';
import {
  applySiteBlockBypasses,
  applySiteBlocks,
  getSiteBlockBypasses as getRuntimeBypasses,
} from './engineRuntime.js';
import { emitBackgroundEvent } from './events.js';
import { getApi, queryTabs, sessionGet, sessionSet } from '../utils/browser.js';
import { domainMatches, hostnameFromUrl, normalizeHostname } from '../utils/urls.js';

const CONTEXT_LIMIT = 30;
const contextMap = new Map();
let contextsLoaded = false;
let contextWrite = Promise.resolve();
let listenersInstalled = false;

function makeId() {
  return `sb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readStoredBypasses() {
  try {
    const result = await sessionGet(STORAGE_KEYS.siteBlockBypasses);
    const value = result?.[STORAGE_KEYS.siteBlockBypasses];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function writeBypasses(bypasses) {
  const normalized = normalizeBypasses(bypasses);
  await sessionSet({ [STORAGE_KEYS.siteBlockBypasses]: normalized });
  await applySiteBlockBypasses(normalized);
  return normalized;
}

export async function getSiteBlockBypasses() {
  const stored = await readStoredBypasses();
  return normalizeBypasses(stored.length ? stored : getRuntimeBypasses());
}

function decorateEntry(entry, bypasses = []) {
  const now = Date.now();
  const bypass = bypasses.find(
    (item) => item.expiresAt > now && domainMatches(entry.domain, item.domain),
  );
  return {
    ...entry,
    rule: siteBlockRule(entry.domain),
    bypass: bypass ? { ...bypass, remainingMs: Math.max(0, bypass.expiresAt - now) } : null,
  };
}

export async function getSiteBlocksDetailed() {
  const [entries, bypasses] = await Promise.all([getSiteBlocks(), getSiteBlockBypasses()]);
  return entries
    .map((entry) => decorateEntry(entry, bypasses))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return b.updatedAt - a.updatedAt || a.domain.localeCompare(b.domain);
    });
}

function assertNoDuplicate(entries, domain, ignoreId = '') {
  const duplicate = entries.find((entry) => entry.domain === domain && entry.id !== ignoreId);
  if (duplicate) throw new Error(`O site ${domain} já está na lista de bloqueio.`);
}

export async function addSiteBlockEntry(input = {}) {
  const entries = await getSiteBlocks();
  if (entries.length >= LIMITS.maxSiteBlocks) {
    throw new Error(`A lista de bloqueio atingiu o limite de ${LIMITS.maxSiteBlocks} sites.`);
  }
  const result = validateSiteBlock(input, { entries });
  if (!result.ok) throw new Error(result.error);
  assertNoDuplicate(entries, result.entry.domain);
  const now = Date.now();
  const entry = normalizeSiteBlockEntry({
    id: makeId(),
    ...result.entry,
    createdAt: now,
    updatedAt: now,
  });
  const next = [...entries, entry];
  await setSiteBlocks(next);
  await applySiteBlocks(next);
  emitBackgroundEvent('siteblock:changed', { action: 'add', domain: entry.domain });
  return decorateEntry(entry, await getSiteBlockBypasses());
}

export async function updateSiteBlockEntry(id, patch = {}) {
  const entries = await getSiteBlocks();
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) throw new Error('Site não encontrado na lista de bloqueio.');
  const result = validateSiteBlock(
    {
      domain: patch.domain !== undefined ? patch.domain : existing.domain,
      action: patch.action !== undefined ? patch.action : existing.action,
      redirectUrl: patch.redirectUrl !== undefined ? patch.redirectUrl : existing.redirectUrl,
      enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
      note: patch.note !== undefined ? patch.note : existing.note,
    },
    { entries, ignoreId: id },
  );
  if (!result.ok) throw new Error(result.error);
  assertNoDuplicate(entries, result.entry.domain, id);
  const nextEntry = normalizeSiteBlockEntry({
    ...existing,
    ...result.entry,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  });
  const next = entries.map((entry) => (entry.id === id ? nextEntry : entry));
  await setSiteBlocks(next);
  await applySiteBlocks(next);
  emitBackgroundEvent('siteblock:changed', { action: 'update', domain: nextEntry.domain });
  return decorateEntry(nextEntry, await getSiteBlockBypasses());
}

export async function setSiteBlockEnabled(id, enabled) {
  return updateSiteBlockEntry(id, { enabled: Boolean(enabled) });
}

export async function removeSiteBlockEntry(id) {
  const entries = await getSiteBlocks();
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new Error('Site não encontrado na lista de bloqueio.');
  const next = entries.filter((item) => item.id !== id);
  await setSiteBlocks(next);
  await applySiteBlocks(next);
  const bypasses = await getSiteBlockBypasses();
  const remaining = bypasses.filter((item) => item.domain !== entry.domain);
  if (remaining.length !== bypasses.length) await writeBypasses(remaining);
  emitBackgroundEvent('siteblock:changed', { action: 'remove', domain: entry.domain });
  return { removed: true, domain: entry.domain };
}

export async function clearSiteBlocks() {
  const entries = await getSiteBlocks();
  await setSiteBlocks([]);
  await applySiteBlocks([]);
  await writeBypasses([]);
  emitBackgroundEvent('siteblock:changed', { action: 'clear', removed: entries.length });
  return { cleared: true, removed: entries.length };
}

export async function previewSiteBlock(input = {}) {
  const entries = await getSiteBlocks();
  const result = validateSiteBlock(input, { entries });
  if (!result.ok) throw new Error(result.error);
  return { entry: result.entry, rule: siteBlockRule(result.entry.domain) };
}

export async function testSiteBlock({ url = '', domain = '' } = {}) {
  let target = String(url || '').trim();
  if (!target && domain) target = `https://${normalizeHostname(domain) || domain}/`;
  if (!target) throw new Error('Informe uma URL ou domínio para testar.');
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error('URL inválida.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Use uma URL HTTP ou HTTPS.');
  }
  const entries = await getSiteBlocks();
  const result = matchSiteBlock(entries, parsed.toString(), 'document');
  const bypasses = await getSiteBlockBypasses();
  const bypass = result.matched
    ? bypasses.find((item) => domainMatches(result.hostname, item.domain)) || null
    : null;
  return {
    matched: Boolean(result.matched),
    hostname: result.hostname,
    rule: result.matched ? result.rule : '',
    entry: result.matched ? result.entry : null,
    redirectUrl: result.matched && result.entry.action === 'redirect' ? result.entry.redirectUrl : '',
    bypassed: Boolean(bypass),
    bypass: bypass ? { ...bypass, remainingMs: Math.max(0, bypass.expiresAt - Date.now()) } : null,
  };
}

export async function addSiteBlockBypass(domain, durationMs = SITE_BLOCK_BYPASS_MS) {
  const host = normalizeHostname(domain);
  if (!host) throw new Error('Domínio inválido para liberação temporária.');
  const ttl = Math.max(1000, Math.min(Number(durationMs) || SITE_BLOCK_BYPASS_MS, 24 * 60 * 60 * 1000));
  const expiresAt = Date.now() + ttl;
  const current = await getSiteBlockBypasses();
  const next = [...current.filter((item) => item.domain !== host), { domain: host, expiresAt }];
  const saved = await writeBypasses(next);
  emitBackgroundEvent('siteblock:bypass', { action: 'add', domain: host, expiresAt });
  return saved.find((item) => item.domain === host) || { domain: host, expiresAt };
}

export async function clearSiteBlockBypass(domain = '') {
  const host = normalizeHostname(domain);
  const current = await getSiteBlockBypasses();
  const next = host ? current.filter((item) => item.domain !== host) : [];
  if (next.length === current.length && host) throw new Error('Liberação temporária não encontrada.');
  const saved = await writeBypasses(next);
  emitBackgroundEvent('siteblock:bypass', { action: 'clear', domain: host });
  return saved;
}

export async function cleanupSiteBlockBypasses() {
  const stored = await readStoredBypasses();
  const normalized = normalizeBypasses(stored);
  if (normalized.length === stored.length && normalized.every((item, index) => item.domain === stored[index]?.domain && item.expiresAt === stored[index]?.expiresAt)) {
    return { removed: 0 };
  }
  await writeBypasses(normalized);
  if (stored.length > normalized.length) {
    emitBackgroundEvent('siteblock:bypass', { action: 'expired', removed: stored.length - normalized.length });
  }
  return { removed: Math.max(0, stored.length - normalized.length) };
}

async function ensureContextsLoaded() {
  if (contextsLoaded) return;
  contextsLoaded = true;
  try {
    const result = await sessionGet(STORAGE_KEYS.siteBlockContexts);
    const stored = result?.[STORAGE_KEYS.siteBlockContexts];
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        const tabId = Number(key);
        if (!Number.isInteger(tabId) || tabId < 0 || !value || typeof value !== 'object') continue;
        if (!contextMap.has(tabId)) contextMap.set(tabId, value);
      }
    }
  } catch {
    // Context persistence is best effort; the query string is a fallback.
  }
}

function persistContexts() {
  contextWrite = contextWrite
    .catch(() => {})
    .then(async () => {
      const payload = Object.fromEntries([...contextMap.entries()].slice(-CONTEXT_LIMIT));
      await sessionSet({ [STORAGE_KEYS.siteBlockContexts]: payload });
    });
  return contextWrite;
}

function trimContexts() {
  while (contextMap.size > CONTEXT_LIMIT) {
    const oldest = contextMap.keys().next().value;
    contextMap.delete(oldest);
  }
}

/**
 * Record the blocked-page context before the network layer applies a
 * declarativeNetRequest redirect. Without this, Chromium cannot know the
 * original URL because extensionPath redirects carry no query string.
 */
async function captureNavigation(tabId, url) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  try {
    const entries = await getSiteBlocks();
    const match = matchSiteBlock(entries, url, 'document');
    if (!match.matched) {
      clearBlockedPageContext(tabId);
      return;
    }
    const bypasses = await getSiteBlockBypasses();
    if (bypasses.some((item) => domainMatches(match.hostname, item.domain))) return;
    recordBlockedPageContext(tabId, {
      url,
      hostname: match.hostname,
      domain: match.entry.domain,
      entryId: match.entry.id,
      action: match.entry.action,
      rule: match.rule,
      redirectUrl: match.entry.redirectUrl,
    });
  } catch {
    // Context capture is best effort; the Firefox query string is a fallback.
  }
}

export function recordBlockedPageContext(tabId, context = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  const value = {
    tabId,
    url: String(context.url || '').slice(0, 2048),
    hostname: String(context.hostname || '').toLowerCase(),
    domain: String(context.domain || '').toLowerCase(),
    entryId: String(context.entryId || ''),
    action: context.action === 'redirect' ? 'redirect' : 'block',
    rule: String(context.rule || '').slice(0, 500),
    redirectUrl: String(context.redirectUrl || '').slice(0, 2048),
    blockedAt: Number(context.blockedAt) || Date.now(),
  };
  contextMap.delete(tabId);
  contextMap.set(tabId, value);
  trimContexts();
  persistContexts().catch(() => {});
  return value;
}

export function clearBlockedPageContext(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  if (!contextMap.delete(tabId)) return;
  persistContexts().catch(() => {});
}

export async function resolveBlockedPageTabId(preferred, sender) {
  const explicit = Number(preferred);
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  const senderTab = Number(sender?.tab?.id);
  if (Number.isInteger(senderTab) && senderTab >= 0) return senderTab;
  try {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    const active = (tabs || []).find((tab) => Number.isInteger(tab.id) && tab.id >= 0);
    if (active) return active.id;
  } catch {
    // tabs permission may be unavailable in a given context.
  }
  return -1;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chromium reaches the blocked page through an extensionPath redirect, so the
 * context request can arrive while onBeforeNavigate is still being persisted.
 * Wait a short moment for it instead of rendering the fallback screen.
 */
async function waitForContext(tabId, timeoutMs = 900) {
  const deadline = Date.now() + timeoutMs;
  let value = contextMap.get(tabId) || null;
  while (!value && Date.now() < deadline) {
    await delay(70);
    value = contextMap.get(tabId) || null;
  }
  return value;
}

export async function getBlockedPageInfo({ tabId, sender, entryId = '', url = '' } = {}) {
  await ensureContextsLoaded();
  const resolvedTabId = await resolveBlockedPageTabId(tabId, sender);
  let context = resolvedTabId >= 0 ? contextMap.get(resolvedTabId) || null : null;
  if (!context && resolvedTabId >= 0 && !entryId && !url) {
    context = await waitForContext(resolvedTabId);
  }
  const entries = await getSiteBlocks();
  const contextUrl = context?.url || String(url || '');
  const hostname = context?.hostname || hostnameFromUrl(contextUrl);
  const requestedId = String(entryId || context?.entryId || '');
  let entry = requestedId ? entries.find((item) => item.id === requestedId) : null;
  if (!entry && contextUrl) entry = matchSiteBlock(entries, contextUrl, 'document').entry || null;
  if (!entry && context?.domain) {
    entry = entries.find((item) => item.domain === context.domain) || null;
  }
  const domain = entry?.domain || context?.domain || hostname;
  const rule = entry ? siteBlockRule(entry.domain) : context?.rule || '';
  const bypasses = await getSiteBlockBypasses();
  const bypass = domain
    ? bypasses.find((item) => domainMatches(domain, item.domain)) || null
    : null;
  return {
    found: Boolean(context || entry || contextUrl),
    tabId: resolvedTabId,
    url: contextUrl,
    hostname,
    domain,
    entryId: entry?.id || context?.entryId || '',
    entry: entry
      ? {
          id: entry.id,
          domain: entry.domain,
          action: entry.action,
          redirectUrl: entry.redirectUrl,
          enabled: entry.enabled,
          note: entry.note,
        }
      : null,
    rule,
    listName: SITE_BLOCK_LIST_NAME,
    blockedAt: context?.blockedAt || 0,
    active: entry ? entry.enabled : false,
    bypass: bypass ? { ...bypass, remainingMs: Math.max(0, bypass.expiresAt - Date.now()) } : null,
  };
}

export async function proceedBlockedPage({ tabId, sender, entryId = '', url = '' } = {}) {
  const info = await getBlockedPageInfo({ tabId, sender, entryId, url });
  if (!info.found || !info.domain) {
    throw new Error('Não foi possível identificar a página bloqueada. Abra o site novamente.');
  }
  const bypass = await addSiteBlockBypass(info.domain);
  return { url: info.url, domain: info.domain, until: bypass.expiresAt };
}

export async function unblockBlockedPage({ tabId, sender, entryId = '', url = '' } = {}) {
  const info = await getBlockedPageInfo({ tabId, sender, entryId, url });
  if (!info.found) {
    throw new Error('Não foi possível identificar a página bloqueada. Abra o site novamente.');
  }
  if (info.entry) {
    await setSiteBlockEnabled(info.entry.id, false);
    const bypasses = await getSiteBlockBypasses();
    if (bypasses.some((item) => item.domain === info.entry.domain)) {
      await clearSiteBlockBypass(info.entry.domain).catch(() => {});
    }
  }
  emitBackgroundEvent('siteblock:changed', {
    action: 'unblock-page',
    domain: info.domain,
    entryId: info.entryId,
  });
  return { url: info.url, domain: info.domain, disabled: Boolean(info.entry), entryId: info.entryId };
}

export function initializeSiteBlockService() {
  installSiteBlockListeners();
  return ensureContextsLoaded().then(() => cleanupSiteBlockBypasses());
}

export function installSiteBlockListeners() {
  if (listenersInstalled) return;
  const api = getApi();
  if (!api) return;
  try {
    api.webNavigation?.onBeforeNavigate?.addListener((details) => {
      if (details?.frameId !== 0) return;
      const url = String(details.url || '');
      if (!/^https?:/i.test(url)) return;
      if (url.includes('/blocked/blocked.html')) return;
      captureNavigation(details.tabId, url);
    });
  } catch {
    // webNavigation may be unavailable in older builds.
  }
  try {
    api.webNavigation?.onCommitted?.addListener((details) => {
      if (details?.frameId !== 0) return;
      const url = String(details.url || '');
      if (url.includes('/blocked/blocked.html')) return;
      if (/^https?:/i.test(url) || url === 'about:blank') clearBlockedPageContext(details.tabId);
    });
  } catch {
    // webNavigation may be unavailable in older builds.
  }
  try {
    api.tabs?.onRemoved?.addListener((tabId) => clearBlockedPageContext(tabId));
  } catch {
    // ignore
  }
  listenersInstalled = true;
}

export { CONTEXT_LIMIT };
