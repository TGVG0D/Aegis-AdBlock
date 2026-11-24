import { APP_NAME, TARGET, VERSION } from '../engine/constants.js';
import {
  getBrowserInfo,
  getManifest,
  queryTabs,
  sendTabMessage,
  storageClear,
} from '../utils/browser.js';
import { toCsv } from '../utils/csv.js';
import { formatDateTime } from '../utils/dates.js';
import { normalizeHostname } from '../utils/urls.js';
import {
  clearAllDb,
  clearHistory,
  countHistory,
  deleteHistoryIds,
  getDbCounts,
  getHistoryForExport,
  getHistorySummary,
  getListHistory,
  queryHistory,
  resetDbHandle,
  storageEstimate,
} from '../storage/db.js';
import {
  getMeta,
  getSiteBlocks,
  getStats,
  getWhitelist,
} from '../storage/state.js';
import {
  getSettings,
  saveSettings,
  settingsForExport,
  updateSettings,
  validateImportedSettings,
} from '../storage/settings.js';
import { initializeStorage } from './bootstrap.js';
import {
  ensureRuntimeReady,
  getBuildInfo,
  getEngineSummary,
  getPauseInfo,
  getRuntime,
  isPaused,
  refreshRuntimeState,
  setPauseUntil,
} from './engineRuntime.js';
import { emitBackgroundEvent } from './events.js';
import {
  enforceHistoryLimitsFromSettings,
  flushAll,
  getStatsSnapshot,
  getStatsView,
  resetHistoryRuntime,
  resetStats,
  setHistorySettings,
} from './historyService.js';
import {
  addRawList,
  addUrlList,
  editList,
  getListContent,
  getListsWithBodies,
  getRecommended,
  installRecommended,
  removeList,
  setListEnabled,
  updateList,
  updateLists,
} from './listsService.js';
import {
  addCustomRule,
  getCustomRulesDetailed,
  previewCustomRule,
  removeAllCustomRules,
  removeCustomRule,
  setCustomRuleEnabled,
  testRule,
  updateCustomRule,
} from './rulesService.js';
import {
  addSiteBlockEntry,
  clearSiteBlockBypass,
  clearSiteBlocks,
  getBlockedPageInfo,
  getSiteBlockBypasses,
  getSiteBlocksDetailed,
  previewSiteBlock,
  proceedBlockedPage,
  removeSiteBlockEntry,
  setSiteBlockEnabled,
  testSiteBlock,
  unblockBlockedPage,
  updateSiteBlockEntry,
} from './siteBlockService.js';
import { schedulePauseEnd, scheduleUpdateAlarm } from './scheduler.js';
import {
  getTabSnapshot,
  refreshAllBadges,
  setTabCosmeticCount,
} from './tabService.js';
import {
  addWhitelistEntry,
  cleanupExpiredWhitelist,
  clearWhitelist,
  getWhitelistDetailed,
  isHostWhitelisted,
  removeWhitelistEntry,
} from './whitelistService.js';

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  return { ok: false, error: error?.message || String(error) };
}

function requireTabId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : -1;
}

function historyFilters(input = {}) {
  return {
    page: Math.max(1, Number(input.page) || 1),
    pageSize: Math.max(1, Number(input.pageSize) || 25),
    search: String(input.search || '').slice(0, 200),
    site: normalizeHostname(input.site || ''),
    category: String(input.category || '').slice(0, 30),
    type: String(input.type || '').slice(0, 30),
    listId: String(input.listId || '').slice(0, 100),
    from: Number(input.from) || 0,
    to: Number(input.to) || 0,
  };
}

async function statusFor(tabId) {
  await ensureRuntimeReady();
  const runtime = getRuntime();
  const settings = runtime.settings || (await getSettings());
  const snapshot = getTabSnapshot(tabId);
  const siteHost = snapshot.hostname || '';
  const whitelist = siteHost
    ? await isHostWhitelisted(siteHost)
    : { allowed: false, entry: null };
  const stats = await getStatsView({ days: 7 });
  const lists = runtime.lists || [];
  return {
    app: {
      name: APP_NAME,
      version: VERSION,
      target: TARGET,
    },
    settings,
    pause: getPauseInfo(),
    paused: isPaused(),
    site: { ...snapshot, whitelisted: whitelist.allowed },
    whitelist: whitelist.entry,
    stats: {
      totalBlocked: stats.totalBlocked,
      totalRequests: stats.totalRequests,
      todayBlocked: stats.todayBlocked,
      todayRequests: stats.todayRequests,
      blockRate: stats.blockRate,
    },
    engine: {
      ready: runtime.ready,
      build: runtime.buildInfo,
      dnr: runtime.dnr,
      lists: {
        total: lists.length,
        enabled: lists.filter((list) => list.enabled).length,
        withErrors: lists.filter((list) => list.status === 'error').length,
      },
    },
  };
}

async function applySettingsAndRefresh(patch) {
  const settings = await updateSettings(patch);
  setHistorySettings(settings);
  await refreshRuntimeState();
  const runtime = getRuntime();
  runtime.settings = settings;
  await scheduleUpdateAlarm(settings);
  await refreshAllBadges(settings);
  await refreshContentScripts();
  emitBackgroundEvent('settings:changed', { settings });
  return settings;
}

async function refreshContentScripts() {
  try {
    // Sem a permissão "tabs" o Firefox omite tab.url; nesse caso tentamos todas
    // as abas com id válido e deixamos o allSettled engolir as páginas onde o
    // content script não existe (about:, moz-extension: etc.).
    const tabs = await queryTabs({});
    await Promise.allSettled(
      (tabs || [])
        .filter((tab) => Number.isInteger(tab?.id) && tab.id >= 0)
        .filter((tab) => !tab.url || /^https?:/i.test(tab.url))
        .map((tab) => sendTabMessage(tab.id, { type: 'cosmetic.refresh' })),
    );
  } catch {
    // tabs permission may be unavailable
  }
}

async function exportHistoryCsv(filters) {
  const rows = await getHistoryForExport(filters);
  const csv = toCsv(
    ['Data/Hora', 'Site', 'URL', 'Tipo', 'Categoria', 'Regra', 'Lista', 'Ocorrências'],
    rows.map((row) => [
      formatDateTime(row.ts),
      row.site,
      row.url,
      row.type,
      row.category,
      row.rule,
      row.listName || row.listId,
      row.count || 1,
    ]),
  );
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return { csv, rows: rows.length, filename: `aegis-historico-${stamp}.csv` };
}

async function systemInfo() {
  await ensureRuntimeReady();
  const runtime = getRuntime();
  const [
    settings,
    meta,
    dbCounts,
    estimate,
    historySummary,
    whitelist,
    siteBlocks,
    siteBlockBypasses,
    browserInfo,
    manifest,
  ] = await Promise.all([
    getSettings(),
    getMeta(),
    getDbCounts().catch(() => null),
    storageEstimate().catch(() => null),
    getHistorySummary().catch(() => null),
    getWhitelist(),
    getSiteBlocks(),
    getSiteBlockBypasses(),
    getBrowserInfo().catch(() => null),
    Promise.resolve(getManifest()),
  ]);
  const lists = runtime.lists || [];
  return {
    app: { name: APP_NAME, version: VERSION, manifestVersion: manifest.manifest_version },
    target: TARGET,
    browser: browserInfo,
    build: getBuildInfo(),
    dnr: runtime.dnr,
    engine: getEngineSummary(),
    settings,
    pause: getPauseInfo(),
    meta,
    lists: {
      total: lists.length,
      enabled: lists.filter((list) => list.enabled).length,
      errors: lists.filter((list) => list.status === 'error').length,
      totalRules: lists.reduce((sum, list) => sum + (list.ruleCount || 0), 0),
    },
    whitelist: whitelist.length,
    siteBlocks: {
      total: siteBlocks.length,
      enabled: siteBlocks.filter((entry) => entry.enabled).length,
      redirects: siteBlocks.filter((entry) => entry.enabled && entry.action === 'redirect').length,
      bypasses: siteBlockBypasses.length,
    },
    dbCounts,
    storage: estimate,
    history: historySummary,
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
  };
}

async function exportConfig({ includeLists = false } = {}) {
  await ensureRuntimeReady();
  const [settings, lists, customRules, whitelist, siteBlocks, stats, meta] = await Promise.all([
    getSettings(),
    getListsWithBodies(false),
    getCustomRulesDetailed(),
    getWhitelistDetailed(),
    getSiteBlocks(),
    getStats(),
    getMeta(),
  ]);
  const payload = {
    kind: 'aegis-adblock-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    lists: lists.map(({ preview, ...list }) => list),
    customRules: customRules.map((rule) => ({
      id: rule.id,
      rule: rule.rule,
      enabled: rule.enabled,
      category: rule.category,
      note: rule.note,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    })),
    whitelist,
    siteBlocks,
    stats,
    meta,
  };
  if (includeLists) {
    const bodies = [];
    for (const list of lists) {
      const content = await getListContent(list.id).catch(() => null);
      if (content?.text) bodies.push({ id: list.id, name: list.name, text: content.text });
    }
    payload.listBodies = bodies;
  }
  return payload;
}

async function resetEverything() {
  await flushAll().catch(() => {});
  await clearAllDb().catch(() => {});
  resetDbHandle();
  resetHistoryRuntime();
  await storageClear();
  await initializeStorage();
  await refreshRuntimeState();
  const settings = await getSettings();
  setHistorySettings(settings);
  await scheduleUpdateAlarm(settings);
  await refreshAllBadges(settings);
  await refreshContentScripts();
  emitBackgroundEvent('system:reset', {});
  return { reset: true };
}

const handlers = {
  'status.get': async (message) => statusFor(requireTabId(message.tabId)),
  'status.ping': async () => ({ ready: getRuntime().ready, paused: isPaused() }),
  'protection.toggle': async (message) => {
    const settings = await applySettingsAndRefresh({ enabled: Boolean(message.enabled) });
    return { settings, pause: getPauseInfo() };
  },
  'protection.pause': async (message) => {
    const minutes = Math.max(0, Number(message.minutes) || 0);
    const until =
      message.until !== undefined
        ? Number(message.until)
        : minutes
          ? Date.now() + minutes * 60000
          : 0;
    const pause = await setPauseUntil(until);
    await schedulePauseEnd(pause.until);
    await refreshContentScripts();
    await refreshAllBadges(getRuntime().settings);
    emitBackgroundEvent('protection:pause', pause);
    return pause;
  },
  'settings.get': async () => getSettings(),
  'settings.update': async (message) => applySettingsAndRefresh(message.patch || {}),
  'settings.export': async () => settingsForExport(await getSettings()),
  'settings.import': async (message) => {
    const validation = validateImportedSettings(message.value);
    if (!validation.ok) throw new Error(validation.error);
    await saveSettings(validation.settings);
    return applySettingsAndRefresh(validation.settings);
  },
  'settings.reset': async () => {
    const defaults = await saveSettings({});
    return applySettingsAndRefresh(defaults);
  },
  'lists.get': async () => ({
    lists: await getListsWithBodies(false),
    recommended: getRecommended(),
  }),
  'lists.addUrl': async (message) =>
    addUrlList({
      name: message.name,
      url: message.url,
      category: message.category,
      format: message.format,
      enabled: message.enabled,
      refresh: message.refresh !== false,
    }),
  'lists.addRaw': async (message) =>
    addRawList({
      name: message.name,
      text: message.text,
      category: message.category,
      format: message.format,
      sourceType: message.sourceType,
      enabled: message.enabled,
    }),
  'lists.installRecommended': async (message) => installRecommended(message.id),
  'lists.update': async (message) => updateList(message.id, { source: 'manual' }),
  'lists.updateAll': async (message) =>
    updateLists({ dueOnly: Boolean(message.dueOnly), source: 'manual' }),
  'lists.toggle': async (message) => setListEnabled(message.id, message.enabled),
  'lists.edit': async (message) => editList(message.id, message.patch || {}),
  'lists.delete': async (message) => removeList(message.id),
  'lists.history': async (message) =>
    getListHistory(message.id, Math.min(40, Number(message.limit) || 20)),
  'lists.content': async (message) => getListContent(message.id),
  'lists.recommended': async () => getRecommended(),
  'rules.get': async () => getCustomRulesDetailed(),
  'rules.add': async (message) => addCustomRule(message),
  'rules.update': async (message) => updateCustomRule(message.id, message.patch || {}),
  'rules.toggle': async (message) => setCustomRuleEnabled(message.id, message.enabled),
  'rules.delete': async (message) => removeCustomRule(message.id),
  'rules.clear': async () => removeAllCustomRules(),
  'rules.preview': async (message) => previewCustomRule(message),
  'rules.test': async (message) =>
    testRule({ url: message.url, initiator: message.initiator, type: message.type }),
  'whitelist.get': async () => getWhitelistDetailed(),
  'whitelist.add': async (message) => addWhitelistEntry(message),
  'whitelist.remove': async (message) => removeWhitelistEntry(message),
  'whitelist.clear': async () => clearWhitelist(),
  'whitelist.cleanup': async () => cleanupExpiredWhitelist(),
  'whitelist.check': async (message) => isHostWhitelisted(normalizeHostname(message.domain)),
  'blocklist.get': async () => getSiteBlocksDetailed(),
  'blocklist.add': async (message) => addSiteBlockEntry(message),
  'blocklist.update': async (message) => updateSiteBlockEntry(message.id, message.patch || {}),
  'blocklist.toggle': async (message) => setSiteBlockEnabled(message.id, message.enabled),
  'blocklist.delete': async (message) => removeSiteBlockEntry(message.id),
  'blocklist.clear': async () => clearSiteBlocks(),
  'blocklist.preview': async (message) => previewSiteBlock(message),
  'blocklist.test': async (message) => testSiteBlock(message),
  'blocklist.bypasses': async () => getSiteBlockBypasses(),
  'blocklist.clearBypass': async (message) => clearSiteBlockBypass(message.domain),
  'blockpage.context': async (message, sender) =>
    getBlockedPageInfo({
      tabId: message.tabId,
      sender,
      entryId: message.entryId,
      url: message.url,
    }),
  'blockpage.proceed': async (message, sender) =>
    proceedBlockedPage({
      tabId: message.tabId,
      sender,
      entryId: message.entryId,
      url: message.url,
    }),
  'blockpage.unblock': async (message, sender) =>
    unblockBlockedPage({
      tabId: message.tabId,
      sender,
      entryId: message.entryId,
      url: message.url,
    }),
  'history.query': async (message) => queryHistory(historyFilters(message.filters || message)),
  'history.summary': async () => ({
    ...(await getHistorySummary()),
    settings: (await getSettings()).history,
    pending: 0,
  }),
  'history.export': async (message) => exportHistoryCsv(historyFilters(message.filters || message)),
  'history.clear': async () => {
    await clearHistory();
    emitBackgroundEvent('history:changed', { cleared: true });
    return { cleared: true };
  },
  'history.delete': async (message) => {
    const ids = Array.isArray(message.ids)
      ? message.ids.map(Number).filter(Number.isFinite).slice(0, 1000)
      : [];
    await deleteHistoryIds(ids);
    emitBackgroundEvent('history:changed', { deleted: ids.length });
    return { deleted: ids.length };
  },
  'history.enforce': async () => enforceHistoryLimitsFromSettings(),
  'history.count': async () => ({ count: await countHistory({}) }),
  'stats.get': async (message) => getStatsView({ days: Number(message.days) || 30 }),
  'stats.snapshot': async () => getStatsSnapshot(),
  'stats.reset': async () => resetStats(),
  'cosmetic.getForHost': async (message) => {
    const runtime = getRuntime();
    const settings = runtime.settings || (await getSettings());
    const host = normalizeHostname(message.hostname || '');
    if (!host) return { enabled: false, hide: [], applied: 0, total: 0 };
    const whitelisted = await isHostWhitelisted(host);
    const enabled =
      settings.enabled &&
      settings.cosmeticEnabled &&
      !isPaused() &&
      !whitelisted.allowed &&
      runtime.ready;
    if (!enabled) {
      return { enabled: false, hide: [], exceptions: [], applied: 0, total: 0, reason: 'disabled' };
    }
    const result = runtime.engine.getCosmeticRules(host);
    return {
      enabled: true,
      hide: result.hide,
      exceptions: result.exceptions.slice(0, 500),
      applied: result.applied,
      total: result.applied,
      generic: result.generic,
      specific: result.specific,
      antiBlock: Boolean(settings.antiBlock),
    };
  },
  'cosmetic.report': async (message, sender) => {
    const tabId = sender?.tab?.id;
    if (Number.isInteger(tabId)) setTabCosmeticCount(tabId, message.applied);
    return { ok: true };
  },
  'cosmetic.test': async (message) => {
    await ensureRuntimeReady();
    const host = normalizeHostname(message.hostname || '');
    if (!host) throw new Error('Informe um domínio válido.');
    const settings = await getSettings();
    const result = getRuntime().engine.getCosmeticRules(host);
    return {
      hostname: host,
      enabled: settings.cosmeticEnabled && settings.enabled && !isPaused(),
      applied: result.applied,
      generic: result.generic,
      specific: result.specific,
      exceptions: result.exceptions.slice(0, 100),
      hide: result.hide.slice(0, 200),
      truncated: result.hide.length > 200,
      antiBlock: Boolean(settings.antiBlock),
    };
  },
  'cosmetic.refresh': async (message) => {
    if (message.tabId !== undefined) {
      const tabId = requireTabId(message.tabId);
      if (tabId >= 0) {
        await sendTabMessage(tabId, { type: 'cosmetic.refresh' }).catch(() => {});
      }
      return { refreshed: 1 };
    }
    await refreshContentScripts();
    return { refreshed: true };
  },
  'antiBlock.ping': async () => ({ enabled: Boolean((await getSettings()).antiBlock) }),
  'system.info': async () => systemInfo(),
  'system.exportConfig': async (message) =>
    exportConfig({ includeLists: Boolean(message.includeLists) }),
  'system.reset': async () => resetEverything(),
  'system.refreshBadges': async () => {
    const settings = await getSettings();
    await refreshAllBadges(settings);
    return { refreshed: true };
  },
  'system.reschedule': async () => {
    const settings = await getSettings();
    return scheduleUpdateAlarm(settings);
  },
};

const REFRESH_AFTER = [
  'lists.addUrl',
  'lists.addRaw',
  'lists.installRecommended',
  'lists.update',
  'lists.updateAll',
  'lists.toggle',
  'lists.delete',
  'rules.add',
  'rules.update',
  'rules.toggle',
  'rules.delete',
  'rules.clear',
  'whitelist.add',
  'whitelist.remove',
  'whitelist.clear',
  'whitelist.cleanup',
  'blocklist.add',
  'blocklist.update',
  'blocklist.toggle',
  'blocklist.delete',
  'blocklist.clear',
];

for (const type of REFRESH_AFTER) {
  const original = handlers[type];
  if (!original) continue;
  handlers[type] = async (...args) => {
    const result = await original(...args);
    await refreshContentScripts();
    await refreshAllBadges(getRuntime().settings);
    return result;
  };
}

export async function handleMessage(message, sender = {}) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    return fail(new Error('Mensagem inválida.'));
  }
  const handler = handlers[message.type];
  if (!handler) return fail(new Error(`Ação desconhecida: ${message.type}`));
  try {
    if (!message.type.startsWith('settings.') || message.type === 'settings.update') {
      await ensureRuntimeReady();
    }
    return ok(await handler(message, sender));
  } catch (error) {
    console.warn('[Aegis] mensagem falhou', message.type, error);
    return fail(error);
  }
}
