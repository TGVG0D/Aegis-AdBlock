import {
  DNR_PRIORITIES,
  LIMITS,
  PARSER_CACHE_VERSION,
  STORAGE_KEYS,
  TARGET,
} from '../engine/constants.js';
import { compileDnrRules } from '../engine/dnr.js';
import { FilterEngine } from '../engine/matcher.js';
import { parseList, parseUserRule } from '../engine/parser.js';
import {
  compileSiteBlockDnrRules,
  hasActiveBypass,
  matchSiteBlock,
  normalizeBypasses,
} from '../engine/siteBlock.js';
import {
  getCustomRules,
  getLists,
  getMeta,
  getSiteBlocks,
  getWhitelist,
  setMeta,
} from '../storage/state.js';
import { getSettings } from '../storage/settings.js';
import { getEngineCache, getListBody, putEngineCache } from '../storage/db.js';
import { hashText } from '../filters/listUtils.js';
import { getApi, sessionGet } from '../utils/browser.js';
import { domainMatches, hostnameFromUrl } from '../utils/urls.js';

const runtime = {
  ready: false,
  settings: null,
  lists: [],
  customRules: [],
  whitelist: [],
  siteBlocks: [],
  siteBlockBypasses: [],
  engine: null,
  buildInfo: null,
  dnr: { supported: TARGET === 'chromium', applied: 0, error: '' },
  pausedUntil: 0,
  initializedAt: 0,
};

let initPromise = null;
let rebuildChain = Promise.resolve();
let dnrChain = Promise.resolve();
let lastBuildSummary = null;

export function getRuntime() {
  return runtime;
}

export function isRuntimeReady() {
  return runtime.ready && Boolean(runtime.engine);
}

export function ensureRuntimeReady() {
  if (runtime.ready) return Promise.resolve(runtime);
  if (!initPromise) {
    initPromise = initializeRuntime().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

async function readSessionBypasses() {
  try {
    const result = await sessionGet(STORAGE_KEYS.siteBlockBypasses);
    return normalizeBypasses(result?.[STORAGE_KEYS.siteBlockBypasses]);
  } catch {
    return [];
  }
}

async function initializeRuntime() {
  const [settings, lists, customRules, whitelist, siteBlocks, siteBlockBypasses, meta] = await Promise.all([
    getSettings(),
    getLists(),
    getCustomRules(),
    getWhitelist(),
    getSiteBlocks(),
    readSessionBypasses(),
    getMeta(),
  ]);
  runtime.settings = settings;
  runtime.lists = lists;
  runtime.customRules = customRules;
  runtime.whitelist = whitelist;
  runtime.siteBlocks = siteBlocks;
  runtime.siteBlockBypasses = siteBlockBypasses;
  runtime.pausedUntil = Number(meta.pausedUntil) > Date.now() ? Number(meta.pausedUntil) : 0;
  runtime.initializedAt = Date.now();
  await rebuild('startup');
  runtime.ready = true;
  return runtime;
}

/** Reload persisted state and rebuild the engine, serialized to avoid races. */
export function refreshRuntimeState() {
  return ensureRuntimeReady().then(async () => {
    const meta = await getMeta();
    runtime.pausedUntil = Number(meta.pausedUntil) > Date.now() ? Number(meta.pausedUntil) : 0;
    return rebuild('refresh');
  });
}

export function rebuild(reason = 'manual') {
  rebuildChain = rebuildChain
    .catch(() => {})
    .then(() => doRebuild(reason));
  return rebuildChain;
}

async function doRebuild(reason) {
  const started = performance.now();
  const [settings, lists, customRules, whitelist, siteBlocks] = await Promise.all([
    getSettings(),
    getLists(),
    getCustomRules(),
    getWhitelist(),
    getSiteBlocks(),
  ]);
  runtime.settings = settings;
  runtime.lists = lists;
  runtime.customRules = customRules;
  runtime.whitelist = whitelist;
  runtime.siteBlocks = siteBlocks;

  const network = [];
  const cosmetic = [];
  const byCategory = {};
  let invalidRules = 0;
  let unsupportedRules = 0;
  let loadedLists = 0;
  let skippedLists = 0;
  let cacheHits = 0;

  for (const list of lists) {
    if (!list.enabled) continue;
    const body = await getListBody(list.id);
    if (!body?.text) {
      skippedLists += 1;
      continue;
    }
    const hash = body.hash || list.hash || hashText(body.text);
    const cacheKey = `parsed:v${PARSER_CACHE_VERSION}:${list.id}:${hash}:${list.category}:${list.format}`;
    let cached = null;
    try {
      cached = await getEngineCache(cacheKey);
    } catch {
      cached = null;
    }
    if (cached && Array.isArray(cached.network) && Array.isArray(cached.cosmetic)) {
      cacheHits += 1;
      for (const rule of cached.network) network.push(rule);
      for (const rule of cached.cosmetic) cosmetic.push(rule);
      invalidRules += cached.stats?.invalid || 0;
      unsupportedRules += cached.stats?.unsupported || 0;
      loadedLists += 1;
      accumulateCategories(byCategory, cached.network, cached.cosmetic);
      continue;
    }

    const parsed = parseList(body.text, {
      listId: list.id,
      listName: list.name,
      category: list.category,
      format: list.format,
      source: list.sourceType,
    });
    if (!parsed.ok) {
      skippedLists += 1;
      continue;
    }
    try {
      await putEngineCache(cacheKey, list.id, {
        network: parsed.network,
        cosmetic: parsed.cosmetic,
        invalid: parsed.invalid,
        unsupported: parsed.unsupported,
        stats: parsed.stats,
        format: parsed.format,
        hash,
      });
    } catch (error) {
      console.warn('[Aegis] não foi possível gravar o cache da lista', list.id, error);
    }
    for (const rule of parsed.network) network.push(rule);
    for (const rule of parsed.cosmetic) cosmetic.push(rule);
    invalidRules += parsed.stats.invalid;
    unsupportedRules += parsed.stats.unsupported;
    loadedLists += 1;
    accumulateCategories(byCategory, parsed.network, parsed.cosmetic);
  }

  const customNetwork = [];
  const customCosmetic = [];
  let customInvalid = 0;
  for (let index = 0; index < customRules.length; index += 1) {
    const rule = customRules[index];
    if (!rule.enabled) continue;
    const parsed = parseUserRule(rule.rule, {
      listId: 'custom',
      listName: 'Regras personalizadas',
      category: rule.category,
      line: index + 1,
      source: 'custom',
    });
    if (!parsed.ok) {
      customInvalid += 1;
      continue;
    }
    parsed.filter.id = `custom:${rule.id}`;
    parsed.filter.customRuleId = rule.id;
    parsed.filter.source = 'custom';
    if (parsed.kind === 'network') customNetwork.push(parsed.filter);
    else customCosmetic.push(parsed.filter);
  }
  for (const rule of customNetwork) network.push(rule);
  for (const rule of customCosmetic) cosmetic.push(rule);
  invalidRules += customInvalid;
  accumulateCategories(byCategory, customNetwork, customCosmetic);

  // A parser already removes repeated lines inside one source. This second pass
  // removes semantically identical filters imported from different lists while
  // keeping the first source as the rule shown in diagnostics/history. Category
  // is deliberately part of the key: deduplicating across categories could
  // change behavior when the user disables only one category.
  const deduplicatedNetwork = deduplicateFilters(network);
  const deduplicatedCosmetic = deduplicateFilters(cosmetic);
  const duplicateNetworkRules = deduplicatedNetwork.duplicates;
  const duplicateCosmeticRules = deduplicatedCosmetic.duplicates;
  const duplicateRules = duplicateNetworkRules + duplicateCosmeticRules;
  for (const category of Object.keys(byCategory)) delete byCategory[category];
  accumulateCategories(byCategory, deduplicatedNetwork.filters, deduplicatedCosmetic.filters);

  const disabledCategories = Object.entries(settings.categories)
    .filter(([, enabled]) => !enabled)
    .map(([category]) => category);

  const engine = new FilterEngine({
    network: deduplicatedNetwork.filters,
    cosmetic: deduplicatedCosmetic.filters,
    disabledCategories,
    genericCosmetic: settings.genericCosmetic,
    maxGenericCosmetic: LIMITS.maxGenericCosmetic,
  });
  runtime.engine = engine;

  const elapsed = Math.round(performance.now() - started);
  const engineStats = engine.getStats();
  runtime.buildInfo = {
    reason,
    builtAt: Date.now(),
    buildMs: elapsed,
    listsLoaded: loadedLists,
    listsSkipped: skippedLists,
    cacheHits,
    networkRules: engineStats.networkRules,
    cosmeticRules: engineStats.cosmeticRules,
    totalRules: engineStats.networkRules + engineStats.cosmeticRules,
    invalidRules,
    unsupportedRules,
    duplicateRules,
    duplicateNetworkRules,
    duplicateCosmeticRules,
    customRules: customNetwork.length + customCosmetic.length,
    customInvalid,
    byCategory,
    engine: engineStats,
    disabledCategories,
  };

  const dnr = await syncDnrRules();
  runtime.buildInfo.dnr = dnr;
  lastBuildSummary = {
    builtAt: runtime.buildInfo.builtAt,
    buildMs: elapsed,
    networkRules: engineStats.networkRules,
    cosmeticRules: engineStats.cosmeticRules,
    totalRules: engineStats.networkRules + engineStats.cosmeticRules,
    listsLoaded: loadedLists,
    invalidRules,
    unsupportedRules,
    duplicateRules,
    dnr: { supported: dnr.supported, applied: dnr.applied, failed: dnr.failed, error: dnr.error || '' },
  };
  try {
    await setMeta({ lastBuild: lastBuildSummary, schemaVersion: settings.schemaVersion });
  } catch (error) {
    console.warn('[Aegis] falha ao salvar metadados do build', error);
  }
  return runtime;
}

function accumulateCategories(byCategory, network, cosmetic) {
  for (const filter of network) {
    byCategory[filter.category] = byCategory[filter.category] || { network: 0, cosmetic: 0 };
    byCategory[filter.category].network += 1;
  }
  for (const filter of cosmetic) {
    byCategory[filter.category] = byCategory[filter.category] || { network: 0, cosmetic: 0 };
    byCategory[filter.category].cosmetic += 1;
  }
}

/**
 * Remove exact parsed-rule duplicates while retaining the first source's
 * metadata. List/category provenance is part of the key so a category toggle
 * can never change behavior merely because another list contains the same raw
 * text under a different category.
 */
export function deduplicateFilters(filters = []) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const filter of filters || []) {
    if (!filter) continue;
    const key = `${filter.kind || ''}\u0000${filter.category || ''}\u0000${String(filter.raw || '').trim()}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(filter);
  }
  return { filters: unique, duplicates };
}

export function applySettings(settings) {
  runtime.settings = settings;
  return syncDnrRules().then((dnr) => {
    runtime.dnr = dnr;
    return dnr;
  });
}

export function applyWhitelist(whitelist) {
  runtime.whitelist = whitelist;
  return syncDnrRules().then((dnr) => {
    runtime.dnr = dnr;
    return dnr;
  });
}

export function applySiteBlocks(siteBlocks) {
  runtime.siteBlocks = Array.isArray(siteBlocks) ? siteBlocks : [];
  return syncDnrRules().then((dnr) => {
    runtime.dnr = dnr;
    return dnr;
  });
}

export function applySiteBlockBypasses(bypasses) {
  runtime.siteBlockBypasses = normalizeBypasses(bypasses);
  return syncDnrRules().then((dnr) => {
    runtime.dnr = dnr;
    return dnr;
  });
}

export function getSiteBlockEntries() {
  return runtime.siteBlocks;
}

export function getSiteBlockBypasses() {
  return normalizeBypasses(runtime.siteBlockBypasses);
}

/**
 * Main-frame decision for the user block list. A temporary bypass allows the
 * navigation without touching ad/tracker filtering.
 */
export function getSiteBlockMatch(url, type = 'document') {
  const hostname = hostnameFromUrl(url);
  if (type !== 'document' || !hostname) return { matched: false, hostname };
  if (hasActiveBypass(runtime.siteBlockBypasses, hostname)) {
    return { matched: false, bypassed: true, hostname };
  }
  return matchSiteBlock(runtime.siteBlocks, url, type);
}

export function isPaused(now = Date.now()) {
  if (!runtime.pausedUntil) return false;
  if (runtime.pausedUntil <= now) return false;
  return true;
}

export function getPauseInfo(now = Date.now()) {
  if (!runtime.pausedUntil || runtime.pausedUntil <= now) {
    return { paused: false, until: 0, remainingMs: 0 };
  }
  return { paused: true, until: runtime.pausedUntil, remainingMs: runtime.pausedUntil - now };
}

export async function setPauseUntil(until) {
  const value = Number(until) > Date.now() ? Number(until) : 0;
  runtime.pausedUntil = value;
  await setMeta({ pausedUntil: value });
  const dnr = await syncDnrRules();
  runtime.dnr = dnr;
  return getPauseInfo();
}

export function isWhitelisted(hostname) {
  return Boolean(getWhitelistEntry(hostname));
}

export function getWhitelistEntry(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return null;
  const now = Date.now();
  for (const entry of runtime.whitelist || []) {
    if (entry.expiresAt && entry.expiresAt <= now) continue;
    if (domainMatches(host, entry.domain)) return entry;
  }
  return null;
}

export function getCosmeticFor(hostname) {
  if (!runtime.engine) {
    return { hide: [], exceptions: [], applied: 0, generic: 0, specific: 0 };
  }
  return runtime.engine.getCosmeticRules(hostname);
}

export function getBuildInfo() {
  return runtime.buildInfo;
}

export function getEngineSummary() {
  return {
    ready: runtime.ready,
    settings: runtime.settings,
    lists: runtime.lists.map((list) => ({
      id: list.id,
      name: list.name,
      enabled: list.enabled,
      status: list.status,
      ruleCount: list.ruleCount,
      category: list.category,
      sourceType: list.sourceType,
    })),
    whitelist: runtime.whitelist,
    siteBlocks: runtime.siteBlocks,
    siteBlockBypasses: normalizeBypasses(runtime.siteBlockBypasses),
    build: runtime.buildInfo,
    dnr: runtime.dnr,
    pause: getPauseInfo(),
  };
}

function chunk(array, size) {
  const result = [];
  for (let index = 0; index < array.length; index += size) {
    result.push(array.slice(index, index + size));
  }
  return result;
}

async function syncDnrRules() {
  if (TARGET !== 'chromium') {
    runtime.dnr = {
      supported: false,
      applied: 0,
      failed: 0,
      total: 0,
      error: '',
      updatedAt: Date.now(),
      backend: 'webRequest-blocking',
    };
    return runtime.dnr;
  }
  const api = getApi();
  const dnrApi = api?.declarativeNetRequest;
  if (!dnrApi?.updateDynamicRules) {
    runtime.dnr = {
      supported: false,
      applied: 0,
      failed: 0,
      total: 0,
      error: 'declarativeNetRequest indisponível.',
      updatedAt: Date.now(),
      backend: 'none',
    };
    return runtime.dnr;
  }

  dnrChain = dnrChain.catch(() => {}).then(async () => {
    const settings = runtime.settings;
    const engine = runtime.engine;
    if (!engine) return runtime.dnr;

    if (!settings?.enabled || isPaused()) {
      await removeAllDynamicRules(dnrApi);
      runtime.dnr = {
        supported: true,
        applied: 0,
        failed: 0,
        total: 0,
        skipped: 0,
        error: '',
        updatedAt: Date.now(),
        backend: 'declarativeNetRequest',
        disabledReason: !settings?.enabled ? 'global-disabled' : 'temporary-pause',
      };
      return runtime.dnr;
    }

    const now = Date.now();
    const siteBlockCompiled = compileSiteBlockDnrRules(runtime.siteBlocks, {
      bypasses: runtime.siteBlockBypasses,
      now,
    });
    const compiled = compileDnrRules(engine.getNetworkFilters(), {
      whitelist: runtime.whitelist,
      disabledCategories: Object.entries(settings.categories)
        .filter(([, enabled]) => !enabled)
        .map(([category]) => category),
      maxRules: Math.max(0, LIMITS.dnrDynamicRules - siteBlockCompiled.rules.length),
      maxRegexRules: LIMITS.dnrRegexRules,
      now,
    });
    const merged = [...siteBlockCompiled.rules, ...compiled.rules].map((rule, index) => ({
      id: index + 1,
      priority: rule.priority,
      action: rule.action,
      condition: rule.condition,
    }));

    const appliedResult = await replaceDynamicRules(dnrApi, merged);
    runtime.dnr = {
      supported: true,
      applied: appliedResult.applied,
      failed: appliedResult.failed,
      total: merged.length,
      skipped: compiled.stats.skipped,
      truncated: compiled.stats.truncated,
      regexRules: compiled.stats.regexRules,
      whitelistRules: compiled.stats.whitelistRules,
      siteBlockRules: siteBlockCompiled.stats.compiled,
      siteBlockBypassRules: siteBlockCompiled.stats.bypassRules,
      error: appliedResult.error || '',
      updatedAt: Date.now(),
      backend: 'declarativeNetRequest',
    };
    if (appliedResult.failed > 0) {
      console.warn('[Aegis] algumas regras DNR foram rejeitadas', appliedResult.failed);
    }
    return runtime.dnr;
  });
  return dnrChain;
}

async function removeAllDynamicRules(dnrApi) {
  try {
    const existing = await callDnr(dnrApi, 'getDynamicRules', []);
    const ids = (existing || []).map((rule) => rule.id);
    if (ids.length) {
      await callDnr(dnrApi, 'updateDynamicRules', [{ removeRuleIds: ids }]);
    }
  } catch (error) {
    console.warn('[Aegis] falha ao limpar regras DNR', error);
  }
}

function callDnr(dnrApi, method, args) {
  const fn = dnrApi[method];
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) reject(new Error(error.message || String(error)));
      else resolve(value);
    };
    try {
      const result = fn.apply(dnrApi, [...args, done]);
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          },
          (error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          },
        );
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

async function replaceDynamicRules(dnrApi, rules) {
  let applied = 0;
  let failed = 0;
  let error = '';
  try {
    const existing = await callDnr(dnrApi, 'getDynamicRules', []);
    const removeRuleIds = (existing || []).map((rule) => rule.id);
    if (removeRuleIds.length) {
      await callDnr(dnrApi, 'updateDynamicRules', [{ removeRuleIds }]);
    }
  } catch (exception) {
    return { applied: 0, failed: rules.length, error: `Falha ao limpar regras antigas: ${exception.message}` };
  }

  const chunks = chunk(rules, 2500);
  for (const group of chunks) {
    const result = await addRuleChunk(dnrApi, group);
    applied += result.applied;
    failed += result.failed;
    if (result.error) error = result.error;
    if (result.quota) break;
  }
  return { applied, failed, error };
}

async function addRuleChunk(dnrApi, rules) {
  try {
    await callDnr(dnrApi, 'updateDynamicRules', [{ addRules: rules }]);
    return { applied: rules.length, failed: 0, quota: false, error: '' };
  } catch (exception) {
    const message = exception?.message || String(exception);
    if (/quota|max_number|limit/i.test(message)) {
      return { applied: 0, failed: rules.length, quota: true, error: message };
    }
    if (rules.length === 1) {
      return { applied: 0, failed: 1, quota: false, error: message };
    }
    const middle = Math.floor(rules.length / 2);
    const left = await addRuleChunk(dnrApi, rules.slice(0, middle));
    const right = await addRuleChunk(dnrApi, rules.slice(middle));
    return {
      applied: left.applied + right.applied,
      failed: left.failed + right.failed,
      quota: left.quota || right.quota,
      error: left.error || right.error,
    };
  }
}

export function testRuleWithEngine({ url, initiator, type = 'script' }) {
  if (!runtime.engine) return { blocked: false, reason: 'engine-not-ready', rule: null };
  if (!hostnameFromUrl(url)) {
    return { blocked: false, reason: 'invalid-url', rule: null };
  }
  return runtime.engine.test({ url, initiator, type });
}

export { DNR_PRIORITIES };
