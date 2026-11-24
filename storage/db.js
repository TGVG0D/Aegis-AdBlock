import { DB_NAME, DB_STORES, DB_VERSION, LIMITS } from '../engine/constants.js';

let dbPromise = null;

function idb() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB não está disponível neste contexto.');
  }
  return indexedDB;
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = idb().open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORES.listBodies)) {
        db.createObjectStore(DB_STORES.listBodies, { keyPath: 'listId' });
      }
      if (!db.objectStoreNames.contains(DB_STORES.listHistory)) {
        const store = db.createObjectStore(DB_STORES.listHistory, { keyPath: 'id', autoIncrement: true });
        store.createIndex('listId', 'listId', { unique: false });
        store.createIndex('at', 'at', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORES.history)) {
        const store = db.createObjectStore(DB_STORES.history, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts', { unique: false });
        store.createIndex('site', 'site', { unique: false });
        store.createIndex('listId', 'listId', { unique: false });
        store.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains(DB_STORES.engineCache)) {
        const store = db.createObjectStore(DB_STORES.engineCache, { keyPath: 'key' });
        store.createIndex('listId', 'listId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba da extensão.'));
  });
  return dbPromise;
}

export function resetDbHandle() {
  dbPromise = null;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Erro no IndexedDB.'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transação IndexedDB falhou.'));
    tx.onabort = () => reject(tx.error || new Error('Transação IndexedDB abortada.'));
  });
}

export async function putListBody(listId, body) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.listBodies, 'readwrite');
  tx.objectStore(DB_STORES.listBodies).put({
    listId,
    text: String(body.text ?? ''),
    etag: String(body.etag || ''),
    lastModified: String(body.lastModified || ''),
    hash: String(body.hash || ''),
    size: Number(body.size) || String(body.text ?? '').length,
    updatedAt: Number(body.updatedAt) || Date.now(),
  });
  await txDone(tx);
}

export async function getListBody(listId) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.listBodies, 'readonly');
  return requestToPromise(tx.objectStore(DB_STORES.listBodies).get(listId));
}

export async function deleteListBody(listId) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.listBodies, 'readwrite');
  tx.objectStore(DB_STORES.listBodies).delete(listId);
  await txDone(tx);
}

export async function addListHistory(entry) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.listHistory, 'readwrite');
  tx.objectStore(DB_STORES.listHistory).add({
    listId: entry.listId,
    at: Number(entry.at) || Date.now(),
    status: entry.status || 'ok',
    ruleCount: Number(entry.ruleCount) || 0,
    added: Number(entry.added) || 0,
    removed: Number(entry.removed) || 0,
    error: entry.error ? String(entry.error).slice(0, 500) : '',
    etag: entry.etag || '',
    lastModified: entry.lastModified || '',
    source: entry.source || 'manual',
  });
  await txDone(tx);
  await trimListHistory(entry.listId, LIMITS.updateHistoryPerList);
}

export async function trimListHistory(listId, max = LIMITS.updateHistoryPerList) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.listHistory, 'readwrite');
  const store = tx.objectStore(DB_STORES.listHistory);
  const index = store.index('listId');
  let seen = 0;
  const request = index.openCursor(IDBKeyRange.only(listId), 'prev');
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    seen += 1;
    if (seen > max) cursor.delete();
    cursor.continue();
  };
  await txDone(tx);
}

export async function getListHistory(listId, limit = 50) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORES.listHistory, 'readonly');
    const index = tx.objectStore(DB_STORES.listHistory).index('listId');
    const items = [];
    const request = index.openCursor(IDBKeyRange.only(listId), 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || items.length >= limit) {
        resolve(items);
        return;
      }
      items.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteListData(listId) {
  const db = await openDb();
  const tx = db.transaction([DB_STORES.listBodies, DB_STORES.listHistory, DB_STORES.engineCache], 'readwrite');
  tx.objectStore(DB_STORES.listBodies).delete(listId);
  const historyIndex = tx.objectStore(DB_STORES.listHistory).index('listId');
  const historyCursor = historyIndex.openCursor(IDBKeyRange.only(listId));
  historyCursor.onsuccess = () => {
    const cursor = historyCursor.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  const cacheIndex = tx.objectStore(DB_STORES.engineCache).index('listId');
  const cacheCursor = cacheIndex.openCursor(IDBKeyRange.only(listId));
  cacheCursor.onsuccess = () => {
    const cursor = cacheCursor.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await txDone(tx);
}

export async function addHistoryEvents(events) {
  if (!events?.length) return 0;
  const db = await openDb();
  const tx = db.transaction(DB_STORES.history, 'readwrite');
  const store = tx.objectStore(DB_STORES.history);
  for (const event of events) {
    store.add({
      ts: Number(event.ts) || Date.now(),
      site: String(event.site || '').slice(0, 253),
      url: String(event.url || '').slice(0, 500),
      type: String(event.type || 'other').slice(0, 30),
      category: String(event.category || 'other').slice(0, 30),
      rule: String(event.rule || '').slice(0, 800),
      listId: String(event.listId || '').slice(0, 100),
      listName: String(event.listName || '').slice(0, 120),
      count: Math.max(1, Number(event.count) || 1),
    });
  }
  await txDone(tx);
  return events.length;
}

function buildHistoryRange(filters) {
  const from = Number(filters.from) || 0;
  const to = Number(filters.to) || 0;
  if (from && to) return IDBKeyRange.bound(from, to);
  if (from) return IDBKeyRange.lowerBound(from);
  if (to) return IDBKeyRange.upperBound(to);
  return null;
}

function matchesHistoryFilters(event, filters) {
  if (!event) return false;
  if (filters.site && event.site !== filters.site) return false;
  if (filters.listId && event.listId !== filters.listId) return false;
  if (filters.category && event.category !== filters.category) return false;
  if (filters.type && event.type !== filters.type) return false;
  if (filters.search) {
    const needle = String(filters.search).toLowerCase();
    const haystack = `${event.url} ${event.site} ${event.rule} ${event.listName}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export async function queryHistory(filters = {}) {
  const db = await openDb();
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(LIMITS.maxHistoryPageSize, Math.max(1, Number(filters.pageSize) || 25));
  const range = buildHistoryRange(filters);
  const skip = (page - 1) * pageSize;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORES.history, 'readonly');
    const index = tx.objectStore(DB_STORES.history).index('ts');
    const items = [];
    let total = 0;
    const request = index.openCursor(range, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({
          items,
          total,
          page,
          pageSize,
          pages: Math.max(1, Math.ceil(total / pageSize)),
        });
        return;
      }
      if (matchesHistoryFilters(cursor.value, filters)) {
        if (total >= skip && items.length < pageSize) items.push(cursor.value);
        total += 1;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('Falha ao consultar histórico.'));
  });
}

export async function countHistory(filters = {}) {
  const db = await openDb();
  const range = buildHistoryRange(filters);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORES.history, 'readonly');
    const index = tx.objectStore(DB_STORES.history).index('ts');
    let total = 0;
    const request = index.openCursor(range, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(total);
        return;
      }
      if (matchesHistoryFilters(cursor.value, filters)) total += 1;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getHistoryForExport(filters = {}, max = LIMITS.maxExportRows) {
  const db = await openDb();
  const range = buildHistoryRange(filters);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORES.history, 'readonly');
    const index = tx.objectStore(DB_STORES.history).index('ts');
    const items = [];
    const request = index.openCursor(range, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || items.length >= max) {
        resolve(items);
        return;
      }
      if (matchesHistoryFilters(cursor.value, filters)) items.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearHistory() {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.history, 'readwrite');
  tx.objectStore(DB_STORES.history).clear();
  await txDone(tx);
}

export async function deleteHistoryIds(ids) {
  if (!ids?.length) return;
  const db = await openDb();
  const tx = db.transaction(DB_STORES.history, 'readwrite');
  const store = tx.objectStore(DB_STORES.history);
  for (const id of ids) store.delete(id);
  await txDone(tx);
}

/**
 * Retention is enforced by age and by maximum number of events.
 * Only URL metadata (never query strings) is stored by the background.
 */
async function countHistoryStore(db) {
  const tx = db.transaction(DB_STORES.history, 'readonly');
  return requestToPromise(tx.objectStore(DB_STORES.history).count());
}

async function deleteHistoryOlderThan(db, cutoff) {
  if (!cutoff) return 0;
  let removed = 0;
  const tx = db.transaction(DB_STORES.history, 'readwrite');
  const index = tx.objectStore(DB_STORES.history).index('ts');
  const request = index.openCursor(IDBKeyRange.upperBound(cutoff, true));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.delete();
    removed += 1;
    cursor.continue();
  };
  await txDone(tx);
  return removed;
}

async function deleteOldestHistory(db, count) {
  if (count <= 0) return 0;
  let removed = 0;
  const tx = db.transaction(DB_STORES.history, 'readwrite');
  const index = tx.objectStore(DB_STORES.history).index('ts');
  const request = index.openCursor(null, 'next');
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor || removed >= count) return;
    cursor.delete();
    removed += 1;
    cursor.continue();
  };
  await txDone(tx);
  return removed;
}

/**
 * Retention is enforced by age and by maximum number of events.
 * Only URL metadata (never query strings) is stored by the background.
 */
export async function enforceHistoryLimits({ retentionDays = 30, maxEntries = 20000 } = {}) {
  const db = await openDb();
  const retentionCutoff = retentionDays > 0 ? Date.now() - retentionDays * 24 * 60 * 60 * 1000 : 0;
  let removed = 0;
  removed += await deleteHistoryOlderThan(db, retentionCutoff);
  const count = await countHistoryStore(db);
  const excess = Math.max(0, count - Math.max(0, maxEntries));
  removed += await deleteOldestHistory(db, excess);
  return { removed };
}

export async function getHistorySummary() {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.history, 'readonly');
  const store = tx.objectStore(DB_STORES.history);
  const index = store.index('ts');
  const countRequest = store.count();
  const oldestRequest = index.openCursor(null, 'next');
  const newestRequest = index.openCursor(null, 'prev');
  const [count, oldestCursor, newestCursor] = await Promise.all([
    requestToPromise(countRequest),
    requestToPromise(oldestRequest),
    requestToPromise(newestRequest),
  ]);
  return {
    count,
    oldest: oldestCursor?.value?.ts || 0,
    newest: newestCursor?.value?.ts || 0,
  };
}

export async function putEngineCache(key, listId, payload) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.engineCache, 'readwrite');
  tx.objectStore(DB_STORES.engineCache).put({
    key,
    listId,
    updatedAt: Date.now(),
    ...payload,
  });
  await txDone(tx);
}

export async function getEngineCache(key) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.engineCache, 'readonly');
  return requestToPromise(tx.objectStore(DB_STORES.engineCache).get(key));
}

export async function deleteEngineCacheForList(listId) {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.engineCache, 'readwrite');
  const index = tx.objectStore(DB_STORES.engineCache).index('listId');
  const request = index.openCursor(IDBKeyRange.only(listId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await txDone(tx);
}

export async function clearEngineCache() {
  const db = await openDb();
  const tx = db.transaction(DB_STORES.engineCache, 'readwrite');
  tx.objectStore(DB_STORES.engineCache).clear();
  await txDone(tx);
}

export async function getDbCounts() {
  const db = await openDb();
  const tx = db.transaction(
    [DB_STORES.listBodies, DB_STORES.listHistory, DB_STORES.history, DB_STORES.engineCache],
    'readonly',
  );
  const [listBodies, listHistory, history, engineCache] = await Promise.all([
    requestToPromise(tx.objectStore(DB_STORES.listBodies).count()),
    requestToPromise(tx.objectStore(DB_STORES.listHistory).count()),
    requestToPromise(tx.objectStore(DB_STORES.history).count()),
    requestToPromise(tx.objectStore(DB_STORES.engineCache).count()),
  ]);
  return { listBodies, listHistory, history, engineCache };
}

export async function clearAllDb() {
  const db = await openDb();
  const tx = db.transaction(
    [DB_STORES.listBodies, DB_STORES.listHistory, DB_STORES.history, DB_STORES.engineCache],
    'readwrite',
  );
  tx.objectStore(DB_STORES.listBodies).clear();
  tx.objectStore(DB_STORES.listHistory).clear();
  tx.objectStore(DB_STORES.history).clear();
  tx.objectStore(DB_STORES.engineCache).clear();
  await txDone(tx);
}

export async function storageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0 };
  }
  try {
    return await navigator.storage.estimate();
  } catch {
    return { usage: 0, quota: 0 };
  }
}
