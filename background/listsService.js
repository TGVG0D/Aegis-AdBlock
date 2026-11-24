import { LIMITS, RECOMMENDED_LISTS } from '../engine/constants.js';
import { parseList } from '../engine/parser.js';
import {
  fetchListText,
  hashText,
  listIsDue,
  sanitizeListText,
  summarizeParsed,
} from '../filters/listUtils.js';
import {
  addListHistory,
  deleteEngineCacheForList,
  deleteListData,
  getListBody,
  putListBody,
} from '../storage/db.js';
import { getSettings } from '../storage/settings.js';
import { getLists, normalizeListMetadata, setLists } from '../storage/state.js';
import { emitBackgroundEvent } from './events.js';
import { ensureRuntimeReady, getRuntime, rebuild } from './engineRuntime.js';
import { validateListUrl } from '../utils/urls.js';

const MAX_LISTS = 50;
const MAX_NAME = 120;
let updateChain = Promise.resolve();

function makeId(prefix = 'list') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanName(value, fallback = '') {
  return String(value || fallback).trim().slice(0, MAX_NAME);
}

function listById(lists, id) {
  return lists.find((list) => list.id === id) || null;
}

async function saveMetadata(lists) {
  return setLists(lists.map((list) => normalizeListMetadata(list)).filter(Boolean));
}

export async function getListsWithBodies(includeBody = false) {
  const lists = await getLists();
  const result = [];
  for (const list of lists) {
    const body = await getListBody(list.id).catch(() => null);
    result.push({
      ...list,
      hasBody: Boolean(body?.text),
      bodySize: body?.size || 0,
      preview: includeBody ? String(body?.text || '').slice(0, 2000) : undefined,
    });
  }
  return result;
}

export async function addUrlList({
  name,
  url,
  category = 'other',
  format = 'auto',
  enabled = true,
  refresh = true,
} = {}) {
  return serializeUpdate(async () => {
    const lists = await getLists();
    if (lists.length >= MAX_LISTS) throw new Error(`Limite de ${MAX_LISTS} listas atingido.`);
    const validated = validateListUrl(url);
    if (!validated.valid) throw new Error(validated.error);
    const normalizedUrl = validated.url;
    if (lists.some((list) => list.url === normalizedUrl)) {
      throw new Error('Esta URL já está cadastrada em outra lista.');
    }

    const id = makeId('list');
    const metadata = normalizeListMetadata({
      id,
      name: cleanName(name, validated.hostname),
      url: normalizedUrl,
      sourceType: 'url',
      category,
      enabled,
      status: 'pending',
      format,
      createdAt: Date.now(),
    });
    if (!metadata) throw new Error('Dados da lista inválidos.');

    if (!refresh) {
      await saveMetadata([...lists, metadata]);
      await rebuild('list-added');
      notifyLists();
      return metadata;
    }

    const result = await fetchAndParse(metadata);
    if (result.notModified || !result.parsed) {
      throw new Error('O servidor respondeu 304 para uma lista nova; envie a lista completa.');
    }
    // Persist the body before registering the list: the engine rebuild below
    // reads list content from IndexedDB, not from this in-memory response.
    await putListBody(metadata.id, {
      text: result.fetched.text,
      size: result.fetched.size,
      hash: hashText(result.fetched.text),
      etag: result.fetched.etag,
      lastModified: result.fetched.lastModified,
      updatedAt: Date.now(),
    });
    const finalMeta = makeUpdatedMetadata(metadata, result.fetched, result.parsed);
    await saveMetadata([...lists, finalMeta]);
    await addListHistory({
      listId: finalMeta.id,
      at: Date.now(),
      status: 'ok',
      ruleCount: finalMeta.ruleCount,
      source: 'manual',
      etag: finalMeta.etag,
      lastModified: finalMeta.lastModified,
    });
    await rebuild('list-added');
    notifyLists();
    return finalMeta;
  });
}

export async function addRawList({
  name,
  text,
  category = 'other',
  format = 'auto',
  sourceType = 'file',
  enabled = true,
} = {}) {
  return serializeUpdate(async () => {
    const lists = await getLists();
    if (lists.length >= MAX_LISTS) throw new Error(`Limite de ${MAX_LISTS} listas atingido.`);
    const sanitized = sanitizeListText(text);
    if (!sanitized.ok) throw new Error(sanitized.error);
    const id = makeId('list');
    const provisional = normalizeListMetadata({
      id,
      name: cleanName(name, 'Lista local'),
      url: '',
      sourceType: sourceType === 'bundled' ? 'bundled' : 'file',
      category,
      enabled,
      status: 'pending',
      format,
      createdAt: Date.now(),
    });
    if (!provisional) throw new Error('Dados da lista inválidos.');
    const parsed = parseList(sanitized.text, {
      listId: id,
      listName: provisional.name,
      category,
      format,
      source: provisional.sourceType,
    });
    if (!parsed.ok || parsed.stats.network + parsed.stats.cosmetic === 0) {
      throw new Error(parsed.error || 'A lista não contém regras válidas.');
    }
    const summary = summarizeParsed(parsed);
    const hash = hashText(sanitized.text);
    await putListBody(id, {
      text: sanitized.text,
      size: sanitized.size,
      hash,
      updatedAt: Date.now(),
    });
    const metadata = normalizeListMetadata({
      ...provisional,
      status: 'ok',
      lastUpdated: Date.now(),
      lastChecked: Date.now(),
      ruleCount: summary.ruleCount,
      networkCount: summary.networkCount,
      cosmeticCount: summary.cosmeticCount,
      invalidCount: summary.invalidCount,
      unsupportedCount: summary.unsupportedCount,
      format: summary.format,
      size: sanitized.size,
      hash,
      updateCount: 1,
    });
    await saveMetadata([...lists, metadata]);
    await addListHistory({
      listId: id,
      at: Date.now(),
      status: 'ok',
      ruleCount: metadata.ruleCount,
      source: 'manual',
    });
    await rebuild('list-added');
    notifyLists();
    return metadata;
  });
}

export async function installRecommended(recommendedId, { enabled = true } = {}) {
  const recommended = RECOMMENDED_LISTS.find((item) => item.id === recommendedId);
  if (!recommended) throw new Error('Lista recomendada desconhecida.');
  return addUrlList({
    name: recommended.name,
    url: recommended.url,
    category: recommended.category,
    format: recommended.format,
    enabled,
  });
}

function makeUpdatedMetadata(previous, fetched, parsed) {
  const now = Date.now();
  const summary = parsed ? summarizeParsed(parsed) : null;
  return normalizeListMetadata({
    ...previous,
    status: 'ok',
    error: '',
    lastErrorAt: 0,
    lastChecked: now,
    lastUpdated: now,
    etag: fetched.etag || '',
    lastModified: fetched.lastModified || '',
    size: fetched.size || 0,
    hash: parsed ? hashText(fetched.text) : previous.hash,
    ruleCount: summary ? summary.ruleCount : previous.ruleCount,
    networkCount: summary ? summary.networkCount : previous.networkCount,
    cosmeticCount: summary ? summary.cosmeticCount : previous.cosmeticCount,
    invalidCount: summary ? summary.invalidCount : previous.invalidCount,
    unsupportedCount: summary ? summary.unsupportedCount : previous.unsupportedCount,
    format: summary ? summary.format : previous.format,
    updateCount: (previous.updateCount || 0) + 1,
  });
}

async function fetchAndParse(metadata) {
  const previousBody = await getListBody(metadata.id).catch(() => null);
  const fetched = await fetchListText(metadata.url, {
    etag: metadata.etag || previousBody?.etag || '',
    lastModified: metadata.lastModified || previousBody?.lastModified || '',
  });
  if (fetched.notModified) {
    return { notModified: true, fetched, previousBody };
  }
  const sanitized = sanitizeListText(fetched.text);
  if (!sanitized.ok) throw new Error(sanitized.error);
  const parsed = parseList(sanitized.text, {
    listId: metadata.id,
    listName: metadata.name,
    category: metadata.category,
    format: metadata.format,
    source: 'list',
  });
  if (!parsed.ok) throw new Error(parsed.error || 'Falha ao analisar a lista.');
  if (parsed.stats.network + parsed.stats.cosmetic === 0) {
    throw new Error('A lista baixada não contém regras válidas; a versão anterior foi mantida.');
  }
  return {
    notModified: false,
    fetched: { ...fetched, text: sanitized.text, size: sanitized.size },
    parsed,
    previousBody,
  };
}

export async function updateList(id, { source = 'manual' } = {}) {
  return serializeUpdate(async () => {
    const lists = await getLists();
    const previous = listById(lists, id);
    if (!previous) throw new Error('Lista não encontrada.');
    if (previous.sourceType !== 'url' || !previous.url) {
      throw new Error('Somente listas por URL podem ser atualizadas.');
    }
    let updated;
    let history;
    try {
      const result = await fetchAndParse(previous);
      if (result.notModified) {
        updated = normalizeListMetadata({
          ...previous,
          status: 'ok',
          error: '',
          lastChecked: Date.now(),
          lastErrorAt: 0,
          etag: result.fetched.etag || previous.etag,
          lastModified: result.fetched.lastModified || previous.lastModified,
          updateCount: (previous.updateCount || 0) + 1,
        });
        history = {
          status: 'not-modified',
          ruleCount: previous.ruleCount,
          added: 0,
          removed: 0,
          source,
        };
      } else {
        if (result.parsed) {
          await putListBody(previous.id, {
            text: result.fetched.text,
            size: result.fetched.size,
            hash: hashText(result.fetched.text),
            etag: result.fetched.etag,
            lastModified: result.fetched.lastModified,
            updatedAt: Date.now(),
          });
          await deleteEngineCacheForList(previous.id).catch(() => {});
        }
        updated = makeUpdatedMetadata(previous, result.fetched, result.parsed);
        const added = Math.max(0, updated.ruleCount - previous.ruleCount);
        const removed = Math.max(0, previous.ruleCount - updated.ruleCount);
        history = {
          status: 'ok',
          ruleCount: updated.ruleCount,
          added,
          removed,
          source,
          etag: updated.etag,
          lastModified: updated.lastModified,
        };
      }
    } catch (error) {
      updated = normalizeListMetadata({
        ...previous,
        status: 'error',
        error: String(error.message || error).slice(0, 500),
        lastChecked: Date.now(),
        lastErrorAt: Date.now(),
      });
      history = {
        status: 'error',
        ruleCount: previous.ruleCount,
        added: 0,
        removed: 0,
        source,
        error: String(error.message || error).slice(0, 500),
      };
    }

    const nextLists = lists.map((list) => (list.id === id ? updated : list));
    await saveMetadata(nextLists);
    await addListHistory({ listId: id, at: Date.now(), ...history }).catch(() => {});
    if (history.status === 'ok') {
      await rebuild('list-updated');
    }
    notifyLists();
    return { list: updated, history };
  });
}

function serializeUpdate(fn) {
  updateChain = updateChain.catch(() => {}).then(fn);
  return updateChain;
}

export async function updateLists({ dueOnly = false, source = 'manual', ids = null } = {}) {
  return serializeUpdate(async () => {
    const lists = await getLists();
    const settings = await getSettings();
    const selected = lists.filter((list) => {
      if (ids?.length && !ids.includes(list.id)) return false;
      if (list.sourceType !== 'url' || !list.url) return false;
      return dueOnly ? listIsDue(list, settings) : true;
    });
    const results = [];
    let index = 0;
    const workers = new Array(Math.min(2, Math.max(1, selected.length))).fill(null).map(async () => {
      while (index < selected.length) {
        const list = selected[index];
        index += 1;
        try {
          const result = await runSingleUpdate(list, source);
          results.push(result);
        } catch (error) {
          results.push({ id: list.id, name: list.name, status: 'error', error: error.message });
        }
      }
    });
    await Promise.all(workers);
    if (results.some((result) => result.status === 'ok' || result.status === 'not-modified')) {
      await rebuild('lists-updated');
    }
    notifyLists();
    return {
      checked: selected.length,
      updated: results.filter((result) => result.status === 'ok').length,
      notModified: results.filter((result) => result.status === 'not-modified').length,
      failed: results.filter((result) => result.status === 'error').length,
      results,
    };
  });
}

async function runSingleUpdate(previous, source) {
  let updated;
  let history;
  try {
    const result = await fetchAndParse(previous);
    if (result.notModified) {
      updated = normalizeListMetadata({
        ...previous,
        status: 'ok',
        error: '',
        lastChecked: Date.now(),
        lastErrorAt: 0,
        etag: result.fetched.etag || previous.etag,
        lastModified: result.fetched.lastModified || previous.lastModified,
        updateCount: (previous.updateCount || 0) + 1,
      });
      history = { status: 'not-modified', ruleCount: previous.ruleCount, added: 0, removed: 0, source };
    } else {
      if (result.parsed) {
        await putListBody(previous.id, {
          text: result.fetched.text,
          size: result.fetched.size,
          hash: hashText(result.fetched.text),
          etag: result.fetched.etag,
          lastModified: result.fetched.lastModified,
          updatedAt: Date.now(),
        });
        await deleteEngineCacheForList(previous.id).catch(() => {});
      }
      updated = makeUpdatedMetadata(previous, result.fetched, result.parsed);
      history = {
        status: 'ok',
        ruleCount: updated.ruleCount,
        added: Math.max(0, updated.ruleCount - previous.ruleCount),
        removed: Math.max(0, previous.ruleCount - updated.ruleCount),
        source,
        etag: updated.etag,
        lastModified: updated.lastModified,
      };
    }
  } catch (error) {
    updated = normalizeListMetadata({
      ...previous,
      status: 'error',
      error: String(error.message || error).slice(0, 500),
      lastChecked: Date.now(),
      lastErrorAt: Date.now(),
    });
    history = {
      status: 'error',
      ruleCount: previous.ruleCount,
      added: 0,
      removed: 0,
      source,
      error: String(error.message || error).slice(0, 500),
    };
  }
  const lists = await getLists();
  await saveMetadata(lists.map((list) => (list.id === previous.id ? updated : list)));
  await addListHistory({ listId: previous.id, at: Date.now(), ...history }).catch(() => {});
  return {
    id: previous.id,
    name: previous.name,
    status: history.status,
    error: history.error || '',
    ruleCount: updated.ruleCount,
    added: history.added || 0,
    removed: history.removed || 0,
  };
}

export async function setListEnabled(id, enabled) {
  const lists = await getLists();
  const target = listById(lists, id);
  if (!target) throw new Error('Lista não encontrada.');
  target.enabled = Boolean(enabled);
  await saveMetadata(lists);
  await rebuild('list-toggle');
  notifyLists();
  return target;
}

export async function editList(id, patch = {}) {
  const lists = await getLists();
  const target = listById(lists, id);
  if (!target) throw new Error('Lista não encontrada.');
  if (patch.name !== undefined) target.name = cleanName(patch.name, target.name);
  if (patch.category !== undefined) {
    target.category = ['ads', 'tracking', 'malware', 'annoyance', 'other', 'mixed'].includes(patch.category)
      ? patch.category
      : target.category;
  }
  if (patch.format !== undefined) {
    target.format = ['auto', 'easylist', 'hosts', 'domains'].includes(patch.format) ? patch.format : target.format;
  }
  await saveMetadata(lists);
  await deleteEngineCacheForList(id).catch(() => {});
  await rebuild('list-edit');
  notifyLists();
  return target;
}

export async function removeList(id) {
  return serializeUpdate(async () => {
    const lists = await getLists();
    const target = listById(lists, id);
    if (!target) throw new Error('Lista não encontrada.');
    if (target.sourceType === 'bundled') {
      throw new Error('A lista essencial incluída não pode ser removida; desative-a se necessário.');
    }
    await saveMetadata(lists.filter((list) => list.id !== id));
    await deleteListData(id).catch(() => {});
    await rebuild('list-removed');
    notifyLists();
    return { id };
  });
}

export async function getListContent(id) {
  const lists = await getLists();
  const target = listById(lists, id);
  if (!target) throw new Error('Lista não encontrada.');
  const body = await getListBody(id);
  return {
    list: target,
    text: body?.text || '',
    etag: body?.etag || '',
    lastModified: body?.lastModified || '',
  };
}

export async function runDueUpdates() {
  return updateLists({ dueOnly: true, source: 'auto' });
}

export async function getUpdatableCount() {
  const lists = await getLists();
  return lists.filter((list) => list.sourceType === 'url' && list.url).length;
}

export function getRecommended() {
  return RECOMMENDED_LISTS.map((item) => ({ ...item }));
}

function notifyLists() {
  emitBackgroundEvent('lists:changed', {});
}

export async function ready() {
  await ensureRuntimeReady();
  return getRuntime();
}

export { MAX_LISTS, LIMITS };
