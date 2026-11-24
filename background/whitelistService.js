import { DEFAULT_WHITELIST_NOTE, TEMP_DURATIONS } from '../engine/constants.js';
import {
  getWhitelist,
  normalizeWhitelistEntry,
  setWhitelist,
} from '../storage/state.js';
import { applyWhitelist, getWhitelistEntry } from './engineRuntime.js';
import { emitBackgroundEvent } from './events.js';
import { normalizeHostname } from '../utils/urls.js';

function makeId() {
  return `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getDurationMs(durationId) {
  return TEMP_DURATIONS.find((item) => item.id === durationId)?.ms || 0;
}

function cleanExisting(entries) {
  const now = Date.now();
  return entries.filter((entry) => !entry.expiresAt || entry.expiresAt > now);
}

export async function getWhitelistDetailed() {
  const entries = await getWhitelist();
  const now = Date.now();
  return entries
    .map((entry) => ({
      ...entry,
      active: !entry.expiresAt || entry.expiresAt > now,
      remainingMs: entry.expiresAt ? Math.max(0, entry.expiresAt - now) : 0,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
}

export async function addWhitelistEntry({
  domain,
  mode = 'permanent',
  durationId = '1h',
  expiresAt = 0,
  note = '',
  source = 'dashboard',
} = {}) {
  const host = normalizeHostname(domain);
  if (!host) throw new Error('Domínio inválido.');
  const entries = await getWhitelist();
  const now = Date.now();
  const temporary = mode === 'temporary';
  const ttl = temporary ? Number(expiresAt) > now ? Number(expiresAt) - now : getDurationMs(durationId) : 0;
  if (temporary && ttl <= 0) throw new Error('Duração temporária inválida.');
  const existing = entries.find((entry) => entry.domain === host);
  if (existing) {
    if (!existing.expiresAt || existing.expiresAt > now) {
      throw new Error('Este domínio já está na lista de permissões.');
    }
    const next = entries.filter((entry) => entry.id !== existing.id);
    next.push(
      normalizeWhitelistEntry({
        id: existing.id,
        domain: host,
        mode: temporary ? 'temporary' : 'permanent',
        expiresAt: temporary ? now + ttl : 0,
        note: note || existing.note || DEFAULT_WHITELIST_NOTE,
        createdAt: now,
        source,
      }),
    );
    await setWhitelist(next);
    await applyWhitelist(next);
    emitBackgroundEvent('whitelist:changed', { action: 'add', domain: host });
    return next.find((entry) => entry.domain === host);
  }
  const entry = normalizeWhitelistEntry({
    id: makeId(),
    domain: host,
    mode: temporary ? 'temporary' : 'permanent',
    expiresAt: temporary ? now + ttl : 0,
    note: note || DEFAULT_WHITELIST_NOTE,
    createdAt: now,
    source,
  });
  const next = [...entries, entry];
  await setWhitelist(next);
  await applyWhitelist(next);
  emitBackgroundEvent('whitelist:changed', { action: 'add', domain: host });
  return entry;
}

export async function removeWhitelistEntry({ id = '', domain = '' } = {}) {
  const entries = await getWhitelist();
  const normalized = normalizeHostname(domain);
  const next = entries.filter((entry) => entry.id !== id && entry.domain !== normalized);
  if (next.length === entries.length) throw new Error('Permissão não encontrada.');
  await setWhitelist(next);
  await applyWhitelist(next);
  emitBackgroundEvent('whitelist:changed', { action: 'remove', id, domain: normalized });
  return { removed: true };
}

export async function clearWhitelist() {
  await setWhitelist([]);
  await applyWhitelist([]);
  emitBackgroundEvent('whitelist:changed', { action: 'clear' });
  return { cleared: true };
}

export async function cleanupExpiredWhitelist() {
  const entries = await getWhitelist();
  const next = cleanExisting(entries);
  if (next.length === entries.length) return { removed: 0 };
  await setWhitelist(next);
  await applyWhitelist(next);
  emitBackgroundEvent('whitelist:changed', { action: 'expired', removed: entries.length - next.length });
  return { removed: entries.length - next.length };
}

export async function isHostWhitelisted(hostname) {
  const entry = getWhitelistEntry(hostname);
  return { allowed: Boolean(entry), entry: entry || null };
}

export { TEMP_DURATIONS };
