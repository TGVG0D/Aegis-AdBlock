/**
 * Pure helpers for the user-controlled block list.
 *
 * Each entry targets a hostname and every one of its subdomains. On a match the
 * browser either shows the Aegis blocked page or is redirected to a destination
 * explicitly chosen by the user. Validation is intentionally strict: entries
 * are always document-only and can never be turned into broad network rules.
 */

import { getDomain } from 'tldts';
import {
  DNR_PRIORITIES,
  SITE_BLOCK_ACTIONS,
  SITE_BLOCK_LIST_ID,
  SITE_BLOCK_LIST_NAME,
} from './constants.js';
import { parseUserRule } from './parser.js';
import {
  domainMatches,
  hostnameFromUrl,
  isIpAddress,
  normalizeHostname,
} from '../utils/urls.js';

export const BLOCKED_PAGE_PATH = '/blocked/blocked.html';
export const BLOCKED_PAGE_FILE = 'blocked/blocked.html';

/** The rule text shown to users and stored in history. */
export function siteBlockRule(domain) {
  const host = normalizeHostname(domain);
  return host ? `||${host}^$document` : '';
}

function labelCount(domain) {
  return String(domain || '').split('.').filter(Boolean).length;
}

/**
 * More specific domains win over broader ones. The offset stays well below the
 * bypass priority so a temporary bypass always takes precedence.
 */
export function siteBlockDnrPriority(domain, base = DNR_PRIORITIES.siteBlock) {
  return base + Math.min(100, labelCount(domain));
}

/** Validate a redirect destination chosen by the user. */
export function validateRedirectTarget(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: 'Informe a URL de destino do redirecionamento.' };
  if (value.length > 2048) return { ok: false, error: 'A URL de destino excede 2048 caracteres.' };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'URL de destino malformada.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, error: 'O destino do redirecionamento deve usar HTTP ou HTTPS.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URLs de destino com credenciais não são permitidas.' };
  }
  const hostname = hostnameFromUrl(url.toString());
  if (!hostname) return { ok: false, error: 'Host do destino inválido.' };
  return { ok: true, url: url.toString(), hostname };
}

/**
 * A redirect must never land on another host covered by the block list,
 * otherwise the browser would enter a redirect loop.
 */
export function findRedirectConflict(entries, redirectUrl, ignoreId = '') {
  const hostname = hostnameFromUrl(redirectUrl);
  if (!hostname) return null;
  for (const entry of entries || []) {
    if (!entry || entry.enabled === false || entry.id === ignoreId) continue;
    if (domainMatches(hostname, entry.domain)) return entry;
  }
  return null;
}

/** A single-label domain (or public suffix) would block an entire namespace. */
function isDangerouslyBroadDomain(domain) {
  if (isIpAddress(domain)) return false;
  try {
    return !getDomain(domain, { allowPrivateDomains: true, detectIp: true });
  } catch {
    return true;
  }
}

/**
 * Validate and normalize user input for one block-list entry.
 * Returns `{ ok: true, entry }` or `{ ok: false, error }`.
 */
export function validateSiteBlock(input = {}, { entries = [], ignoreId = '' } = {}) {
  const domain = normalizeHostname(input.domain);
  if (!domain) return { ok: false, error: 'Informe um site ou domínio válido (ex.: exemplo.com).' };
  if (isDangerouslyBroadDomain(domain)) {
    return {
      ok: false,
      error: 'Use um domínio completo, como exemplo.com. Domínios isolados e sufixos públicos são amplos demais.',
    };
  }

  const action = SITE_BLOCK_ACTIONS.includes(input.action) ? input.action : 'block';
  let redirectUrl = '';
  if (action === 'redirect') {
    const target = validateRedirectTarget(input.redirectUrl);
    if (!target.ok) return { ok: false, error: target.error };
    if (domainMatches(target.hostname, domain)) {
      return {
        ok: false,
        error: 'O destino do redirecionamento não pode ser o próprio site bloqueado nem um subdomínio dele.',
      };
    }
    const conflict = findRedirectConflict(entries, target.url, ignoreId);
    if (conflict) {
      return {
        ok: false,
        error: `O destino ${target.hostname} já é coberto pela regra ${conflict.domain} e criaria um redirecionamento em loop.`,
      };
    }
    redirectUrl = target.url;
  }

  return {
    ok: true,
    entry: {
      domain,
      action,
      redirectUrl,
      enabled: input.enabled !== false,
      note: String(input.note || '').slice(0, 300),
    },
  };
}

/** Build the parsed document-only filter used by the native engine and DNR. */
export function buildSiteBlockFilter(entry, index = 0) {
  if (!entry || !entry.domain) return null;
  const raw = siteBlockRule(entry.domain);
  if (!raw) return null;
  const parsed = parseUserRule(raw, {
    listId: SITE_BLOCK_LIST_ID,
    listName: SITE_BLOCK_LIST_NAME,
    category: 'other',
    line: index + 1,
    source: 'siteblock',
  });
  if (!parsed.ok || parsed.kind !== 'network') return null;
  const filter = parsed.filter;
  if (filter.exception || filter.types.length !== 1 || filter.types[0] !== 'document') return null;
  filter.id = `siteblock:${entry.id || index}`;
  filter.siteBlockId = entry.id || '';
  filter.source = 'siteblock';
  return filter;
}

/**
 * Find the block-list entry responsible for a document request.
 * The most specific domain wins when entries overlap.
 */
export function matchSiteBlock(entries, url, type = 'document') {
  if (type !== 'document') return { matched: false, hostname: '' };
  const hostname = hostnameFromUrl(url);
  if (!hostname) return { matched: false, hostname: '' };
  const matches = [];
  for (const entry of entries || []) {
    if (!entry || entry.enabled === false) continue;
    if (!domainMatches(hostname, entry.domain)) continue;
    matches.push(entry);
  }
  if (!matches.length) return { matched: false, hostname };
  matches.sort((a, b) => labelCount(b.domain) - labelCount(a.domain) || a.domain.length - b.domain.length);
  const entry = matches[0];
  return { matched: true, hostname, entry, rule: siteBlockRule(entry.domain) };
}

/** Keep only unexpired bypasses and merge duplicate domains (furthest expiry wins). */
export function normalizeBypasses(bypasses, now = Date.now()) {
  const merged = new Map();
  for (const item of Array.isArray(bypasses) ? bypasses : []) {
    if (!item || typeof item !== 'object') continue;
    const domain = normalizeHostname(item.domain);
    const expiresAt = Number(item.expiresAt) || 0;
    if (!domain || expiresAt <= now) continue;
    const current = merged.get(domain);
    if (!current || expiresAt > current.expiresAt) merged.set(domain, { domain, expiresAt });
  }
  return [...merged.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

export function hasActiveBypass(bypasses, hostname, now = Date.now()) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return (bypasses || []).some(
    (item) => item && Number(item.expiresAt) > now && domainMatches(host, item.domain),
  );
}

/**
 * Compile block-list entries plus active bypasses into declarativeNetRequest
 * rules. IDs are assigned by the caller so they can be merged with ad rules.
 * @returns {{ rules: object[], stats: object }}
 */
export function compileSiteBlockDnrRules(entries, options = {}) {
  const {
    bypasses = [],
    now = Date.now(),
    blockPagePath = BLOCKED_PAGE_PATH,
  } = options;

  const rules = [];
  const stats = {
    entries: Array.isArray(entries) ? entries.length : 0,
    compiled: 0,
    skipped: 0,
    bypassRules: 0,
    totalRules: 0,
  };
  const seen = new Set();
  const push = (rule) => {
    const key = JSON.stringify([rule.priority, rule.action, rule.condition]);
    if (seen.has(key)) return false;
    seen.add(key);
    rules.push(rule);
    return true;
  };

  const safePath = /^\/[A-Za-z0-9/._-]+$/.test(String(blockPagePath || ''))
    ? blockPagePath
    : BLOCKED_PAGE_PATH;

  for (const entry of entries || []) {
    if (!entry || entry.enabled === false) continue;
    const filter = buildSiteBlockFilter(entry);
    if (!filter) {
      stats.skipped += 1;
      continue;
    }
    const condition = {
      urlFilter: filter.pattern,
      resourceTypes: ['main_frame'],
    };
    let action;
    if (entry.action === 'redirect') {
      const target = validateRedirectTarget(entry.redirectUrl);
      action = target.ok
        ? { type: 'redirect', redirect: { url: target.url } }
        : { type: 'redirect', redirect: { extensionPath: safePath } };
    } else {
      action = { type: 'redirect', redirect: { extensionPath: safePath } };
    }
    if (push({ priority: siteBlockDnrPriority(entry.domain), action, condition, _siteBlock: true })) {
      stats.compiled += 1;
    }
  }

  const activeBypasses = normalizeBypasses(bypasses, now);
  for (const bypass of activeBypasses) {
    const condition = {
      urlFilter: `||${bypass.domain}^`,
      resourceTypes: ['main_frame'],
    };
    if (
      push({
        priority: siteBlockDnrPriority(bypass.domain, DNR_PRIORITIES.siteBlockBypass),
        action: { type: 'allow' },
        condition,
        _siteBlockBypass: true,
      })
    ) {
      stats.bypassRules += 1;
    }
  }

  stats.totalRules = rules.length;
  return { rules, stats };
}

export { labelCount, isDangerouslyBroadDomain };
