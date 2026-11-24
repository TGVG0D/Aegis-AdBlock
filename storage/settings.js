import { AUTO_UPDATE_HOURS, HISTORY_LIMITS, HISTORY_RETENTION_DAYS, SCHEMA_VERSION } from '../engine/constants.js';
import { storageGet, storageSet } from '../utils/browser.js';

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  cosmeticEnabled: true,
  genericCosmetic: true,
  showBadge: true,
  badgeShowCount: true,
  categories: {
    ads: true,
    tracking: true,
    malware: true,
    annoyance: true,
    other: true,
  },
  autoUpdate: true,
  updateIntervalHours: 24,
  antiBlock: false,
  history: {
    enabled: true,
    retentionDays: 30,
    maxEntries: 20000,
    detail: 'path',
    autoCleanup: true,
  },
  statsRetentionDays: 90,
});

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function normalizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const source = input && typeof input === 'object' ? input : {};
  const categories = source.categories && typeof source.categories === 'object' ? source.categories : {};
  const history = source.history && typeof source.history === 'object' ? source.history : {};

  // Build an explicit allowlist. Unknown keys from imported files or future
  // versions are discarded instead of silently becoming persisted settings.
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: bool(source.enabled, base.enabled),
    cosmeticEnabled: bool(source.cosmeticEnabled, base.cosmeticEnabled),
    genericCosmetic: bool(source.genericCosmetic, base.genericCosmetic),
    showBadge: bool(source.showBadge, base.showBadge),
    badgeShowCount: bool(source.badgeShowCount, base.badgeShowCount),
    categories: Object.fromEntries(
      Object.keys(base.categories).map((category) => [
        category,
        bool(categories[category], base.categories[category]),
      ]),
    ),
    autoUpdate: bool(source.autoUpdate, base.autoUpdate),
    updateIntervalHours: oneOf(
      Number(source.updateIntervalHours),
      [...AUTO_UPDATE_HOURS, 0],
      base.updateIntervalHours,
    ),
    history: {
      enabled: bool(history.enabled, base.history.enabled),
      retentionDays: oneOf(
        Number(history.retentionDays),
        HISTORY_RETENTION_DAYS,
        base.history.retentionDays,
      ),
      maxEntries: oneOf(
        Number(history.maxEntries),
        HISTORY_LIMITS,
        base.history.maxEntries,
      ),
      detail: oneOf(history.detail, ['path', 'host'], base.history.detail),
      autoCleanup: bool(history.autoCleanup, base.history.autoCleanup),
    },
    antiBlock: bool(source.antiBlock, base.antiBlock),
    statsRetentionDays: Math.max(
      30,
      Math.min(365, Number(source.statsRetentionDays) || base.statsRetentionDays),
    ),
  };
}

export async function getSettings() {
  const stored = await storageGet('settings');
  return normalizeSettings(stored?.settings || {});
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await storageSet({ settings: normalized });
  return normalized;
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch, categories: { ...current.categories, ...(patch?.categories || {}) }, history: { ...current.history, ...(patch?.history || {}) } }, current);
  await storageSet({ settings: next });
  return next;
}

export function settingsForExport(settings) {
  return {
    kind: 'aegis-adblock-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettings(settings),
  };
}

export function validateImportedSettings(value) {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Arquivo de configurações inválido.' };
  }
  if (value.kind && value.kind !== 'aegis-adblock-settings') {
    return { ok: false, error: 'Este arquivo não é uma configuração do Aegis AdBlock.' };
  }
  if (!value.settings || typeof value.settings !== 'object') {
    return { ok: false, error: 'O arquivo não contém o bloco "settings".' };
  }
  if (value.settings.schemaVersion && Number(value.settings.schemaVersion) > SCHEMA_VERSION) {
    return { ok: false, error: 'Configuração criada por uma versão mais nova da extensão.' };
  }
  return { ok: true, settings: normalizeSettings(value.settings) };
}
