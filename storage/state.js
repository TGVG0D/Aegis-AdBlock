import {
  SCHEMA_VERSION,
  SITE_BLOCK_ACTIONS,
  STORAGE_KEYS,
  USER_CATEGORIES,
} from '../engine/constants.js';
import { normalizeHostname } from '../utils/urls.js';
import { storageGet, storageSet } from '../utils/browser.js';

export function createDefaultStats() {
  return {
    totalRequests: 0,
    totalBlocked: 0,
    byCategory: { ads: 0, tracking: 0, malware: 0, annoyance: 0, other: 0 },
    byType: {},
    byDay: {},
    bySite: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function normalizeStats(stats) {
  const base = createDefaultStats();
  if (!stats || typeof stats !== 'object') return base;
  return {
    ...base,
    ...stats,
    byCategory: { ...base.byCategory, ...(stats.byCategory || {}) },
    byType: { ...(stats.byType || {}) },
    byDay: { ...(stats.byDay || {}) },
    bySite: { ...(stats.bySite || {}) },
  };
}

export function normalizeListMetadata(list) {
  if (!list || typeof list !== 'object' || !list.id) return null;
  return {
    id: String(list.id),
    name: String(list.name || 'Lista sem nome').slice(0, 120),
    url: typeof list.url === 'string' ? list.url : '',
    sourceType: ['url', 'file', 'bundled'].includes(list.sourceType) ? list.sourceType : 'url',
    category: USER_CATEGORIES.includes(list.category) || list.category === 'mixed' ? list.category : 'other',
    enabled: list.enabled !== false,
    createdAt: Number(list.createdAt) || Date.now(),
    lastUpdated: Number(list.lastUpdated) || 0,
    lastChecked: Number(list.lastChecked) || 0,
    lastErrorAt: Number(list.lastErrorAt) || 0,
    status: ['ok', 'error', 'pending', 'never'].includes(list.status) ? list.status : 'never',
    error: list.error ? String(list.error).slice(0, 500) : '',
    ruleCount: Math.max(0, Number(list.ruleCount) || 0),
    networkCount: Math.max(0, Number(list.networkCount) || 0),
    cosmeticCount: Math.max(0, Number(list.cosmeticCount) || 0),
    invalidCount: Math.max(0, Number(list.invalidCount) || 0),
    unsupportedCount: Math.max(0, Number(list.unsupportedCount) || 0),
    format: ['auto', 'easylist', 'hosts', 'domains'].includes(list.format) ? list.format : 'auto',
    size: Math.max(0, Number(list.size) || 0),
    hash: typeof list.hash === 'string' ? list.hash : '',
    etag: typeof list.etag === 'string' ? list.etag : '',
    lastModified: typeof list.lastModified === 'string' ? list.lastModified : '',
    updateCount: Math.max(0, Number(list.updateCount) || 0),
  };
}

export function normalizeCustomRule(rule) {
  if (!rule || typeof rule !== 'object' || !rule.rule) return null;
  return {
    id: String(rule.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    rule: String(rule.rule).slice(0, 2000),
    enabled: rule.enabled !== false,
    category: USER_CATEGORIES.includes(rule.category) ? rule.category : 'other',
    note: String(rule.note || '').slice(0, 300),
    createdAt: Number(rule.createdAt) || Date.now(),
    updatedAt: Number(rule.updatedAt) || Date.now(),
  };
}

export function normalizeWhitelistEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const domain = normalizeHostname(entry.domain);
  if (!domain) return null;
  const mode = entry.mode === 'temporary' ? 'temporary' : 'permanent';
  const expiresAt = mode === 'temporary' ? Number(entry.expiresAt) || 0 : 0;
  // A temporary permission without a valid future expiry must never be
  // upgraded to a permanent one by accident.
  if (mode === 'temporary' && expiresAt <= 0) return null;
  return {
    id: String(entry.id || `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    domain,
    mode,
    expiresAt,
    note: String(entry.note || '').slice(0, 300),
    createdAt: Number(entry.createdAt) || Date.now(),
    source: entry.source === 'popup' ? 'popup' : 'dashboard',
  };
}

export function normalizeSiteBlockEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const domain = normalizeHostname(entry.domain);
  if (!domain) return null;
  const action = SITE_BLOCK_ACTIONS.includes(entry.action) ? entry.action : 'block';
  const redirectUrl = action === 'redirect' ? String(entry.redirectUrl || '').slice(0, 2048) : '';
  return {
    id: String(entry.id || `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    domain,
    action,
    redirectUrl,
    enabled: entry.enabled !== false,
    note: String(entry.note || '').slice(0, 300),
    createdAt: Number(entry.createdAt) || Date.now(),
    updatedAt: Number(entry.updatedAt) || Date.now(),
  };
}

async function readKey(key, fallback) {
  const result = await storageGet(key);
  return result?.[key] ?? fallback;
}

async function writeKey(key, value) {
  await storageSet({ [key]: value });
}

export async function getLists() {
  const value = await readKey(STORAGE_KEYS.lists, []);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeListMetadata).filter(Boolean);
}

export async function setLists(lists) {
  const normalized = (Array.isArray(lists) ? lists : []).map(normalizeListMetadata).filter(Boolean);
  await writeKey(STORAGE_KEYS.lists, normalized);
  return normalized;
}

export async function getCustomRules() {
  const value = await readKey(STORAGE_KEYS.customRules, []);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCustomRule).filter(Boolean);
}

export async function setCustomRules(rules) {
  const normalized = (Array.isArray(rules) ? rules : []).map(normalizeCustomRule).filter(Boolean);
  await writeKey(STORAGE_KEYS.customRules, normalized);
  return normalized;
}

export async function getWhitelist() {
  const value = await readKey(STORAGE_KEYS.whitelist, []);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeWhitelistEntry).filter(Boolean);
}

export async function setWhitelist(entries) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeWhitelistEntry).filter(Boolean);
  await writeKey(STORAGE_KEYS.whitelist, normalized);
  return normalized;
}

export async function getSiteBlocks() {
  const value = await readKey(STORAGE_KEYS.siteBlocks, []);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSiteBlockEntry).filter(Boolean);
}

export async function setSiteBlocks(entries) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeSiteBlockEntry).filter(Boolean);
  await writeKey(STORAGE_KEYS.siteBlocks, normalized);
  return normalized;
}

export async function getStats() {
  const value = await readKey(STORAGE_KEYS.stats, null);
  return normalizeStats(value);
}

export async function setStats(stats) {
  const normalized = normalizeStats(stats);
  normalized.updatedAt = Date.now();
  await writeKey(STORAGE_KEYS.stats, normalized);
  return normalized;
}

export async function getMeta() {
  const value = await readKey(STORAGE_KEYS.meta, null);
  return value && typeof value === 'object' ? value : {};
}

export async function setMeta(patch) {
  const current = await getMeta();
  const next = { ...current, ...(patch || {}), updatedAt: Date.now() };
  await writeKey(STORAGE_KEYS.meta, next);
  return next;
}

/**
 * Schema migrations. Each step is idempotent and only advances forward.
 * Version 1 is the initial schema; future versions append a step.
 */
const MIGRATIONS = [
  {
    version: 1,
    migrate(meta) {
      return { ...meta, schemaVersion: 1, initialized: meta.initialized ?? false };
    },
  },
];

export async function migrateIfNeeded() {
  const meta = await getMeta();
  let current = meta.schemaVersion || 0;
  if (current >= SCHEMA_VERSION) return { migrated: false, meta };
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      const migrated = migration.migrate(meta, current);
      await setMeta(migrated);
      current = migration.version;
    }
  }
  return { migrated: true, meta: await getMeta() };
}

export async function getStateSnapshot() {
  const [lists, customRules, whitelist, siteBlocks, stats, meta] = await Promise.all([
    getLists(),
    getCustomRules(),
    getWhitelist(),
    getSiteBlocks(),
    getStats(),
    getMeta(),
  ]);
  return { lists, customRules, whitelist, siteBlocks, stats, meta };
}

export function activeWhitelistEntries(entries, now = Date.now()) {
  return (entries || []).filter((entry) => !entry.expiresAt || entry.expiresAt > now);
}
