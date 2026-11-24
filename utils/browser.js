/**
 * Small WebExtensions compatibility layer.
 * Works with both `chrome.*` (callback/promise) and `browser.*` (promise).
 */
export function getApi() {
  if (typeof globalThis === 'undefined') return null;
  if (globalThis.browser?.runtime?.id) return globalThis.browser;
  if (globalThis.chrome?.runtime?.id) return globalThis.chrome;
  return globalThis.browser || globalThis.chrome || null;
}

export function isFirefox() {
  const api = getApi();
  try {
    return Boolean(api?.runtime?.getBrowserInfo);
  } catch {
    return false;
  }
}

export function isExtensionContext() {
  return Boolean(getApi()?.runtime?.id);
}

function lastError(api) {
  try {
    return api?.runtime?.lastError || null;
  } catch {
    return null;
  }
}

/** Invoke a callback-style API and also support promise-returning APIs. */
export function callApi(fn, thisArg, ...args) {
  const api = getApi();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      const error = lastError(api);
      if (error) reject(new Error(error.message || String(error)));
      else resolve(value);
    };
    try {
      const result = fn.apply(thisArg, [...args, done]);
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
      } else if (fn.length <= args.length) {
        // Some promise-only implementations ignore the callback argument.
        if (result !== undefined) done(result);
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

export function sendMessage(message) {
  const api = getApi();
  if (!api?.runtime?.sendMessage) return Promise.reject(new Error('runtime.sendMessage indisponível'));
  return callApi(api.runtime.sendMessage, api.runtime, message);
}

export function sendTabMessage(tabId, message) {
  const api = getApi();
  if (!api?.tabs?.sendMessage) return Promise.reject(new Error('tabs.sendMessage indisponível'));
  return callApi(api.tabs.sendMessage, api.tabs, tabId, message);
}

export function queryTabs(queryInfo) {
  const api = getApi();
  if (!api?.tabs?.query) return Promise.resolve([]);
  return callApi(api.tabs.query, api.tabs, queryInfo);
}

export function createTab(properties) {
  const api = getApi();
  if (!api?.tabs?.create) return Promise.reject(new Error('tabs.create indisponível'));
  return callApi(api.tabs.create, api.tabs, properties);
}

export function updateTab(tabId, properties) {
  const api = getApi();
  if (!api?.tabs?.update) return Promise.resolve(null);
  return callApi(api.tabs.update, api.tabs, tabId, properties);
}

export function openOptionsPage() {
  const api = getApi();
  if (!api?.runtime?.openOptionsPage) {
    return createTab({ url: api.runtime.getURL('dashboard/dashboard.html') });
  }
  return callApi(api.runtime.openOptionsPage, api.runtime);
}

export function getUrl(path) {
  const api = getApi();
  return api?.runtime?.getURL ? api.runtime.getURL(path) : path;
}

export function storageGet(keys) {
  const api = getApi();
  if (!api?.storage?.local) return Promise.resolve({});
  return callApi(api.storage.local.get, api.storage.local, keys);
}

export function storageSet(items) {
  const api = getApi();
  if (!api?.storage?.local) return Promise.resolve();
  return callApi(api.storage.local.set, api.storage.local, items);
}

export function storageRemove(keys) {
  const api = getApi();
  if (!api?.storage?.local) return Promise.resolve();
  return callApi(api.storage.local.remove, api.storage.local, keys);
}

export function storageClear() {
  const api = getApi();
  if (!api?.storage?.local) return Promise.resolve();
  return callApi(api.storage.local.clear, api.storage.local);
}

export function sessionArea() {
  const api = getApi();
  return api?.storage?.session || api?.storage?.local || null;
}

export function sessionGet(keys) {
  const area = sessionArea();
  if (!area) return Promise.resolve({});
  return callApi(area.get, area, keys);
}

export function sessionSet(items) {
  const area = sessionArea();
  if (!area) return Promise.resolve();
  return callApi(area.set, area, items);
}

export function sessionRemove(keys) {
  const area = sessionArea();
  if (!area) return Promise.resolve();
  return callApi(area.remove, area, keys);
}

export function onRuntimeMessage(handler) {
  const api = getApi();
  if (!api?.runtime?.onMessage) return () => {};
  const listener = (message, sender, sendResponse) => {
    let result;
    try {
      result = handler(message, sender);
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
      return false;
    }
    if (result && typeof result.then === 'function') {
      result.then(
        (value) => {
          try {
            sendResponse(value);
          } catch {
            // Channel may already be closed.
          }
        },
        (error) => {
          try {
            sendResponse({ ok: false, error: error?.message || String(error) });
          } catch {
            // Channel may already be closed.
          }
        },
      );
      return true;
    }
    sendResponse(result);
    return false;
  };
  api.runtime.onMessage.addListener(listener);
  return () => api.runtime.onMessage.removeListener(listener);
}

export function onStorageChanged(handler) {
  const api = getApi();
  if (!api?.storage?.onChanged) return () => {};
  api.storage.onChanged.addListener(handler);
  return () => api.storage.onChanged.removeListener(handler);
}

export function onAlarm(handler) {
  const api = getApi();
  if (!api?.alarms?.onAlarm) return () => {};
  api.alarms.onAlarm.addListener(handler);
  return () => api.alarms.onAlarm.removeListener(handler);
}

export function createAlarm(name, info) {
  const api = getApi();
  if (!api?.alarms?.create) return Promise.resolve();
  return callApi(api.alarms.create, api.alarms, name, info);
}

export function getAlarm(name) {
  const api = getApi();
  if (!api?.alarms?.get) return Promise.resolve(null);
  return callApi(api.alarms.get, api.alarms, name);
}

export function getActionApi() {
  const api = getApi();
  return api?.action || api?.browserAction || null;
}

export function setBadgeText(details) {
  const action = getActionApi();
  if (!action?.setBadgeText) return Promise.resolve();
  return callApi(action.setBadgeText, action, details);
}

export function setBadgeBackgroundColor(details) {
  const action = getActionApi();
  if (!action?.setBadgeBackgroundColor) return Promise.resolve();
  return callApi(action.setBadgeBackgroundColor, action, details);
}

export function setBadgeTextColor(details) {
  const action = getActionApi();
  if (!action?.setBadgeTextColor) return Promise.resolve();
  return callApi(action.setBadgeTextColor, action, details);
}

export function getPlatformInfo() {
  const api = getApi();
  if (!api?.runtime?.getPlatformInfo) return Promise.resolve({ os: 'unknown', arch: 'unknown' });
  return callApi(api.runtime.getPlatformInfo, api.runtime);
}

export function getManifest() {
  const api = getApi();
  return api?.runtime?.getManifest?.() || {};
}

export function getBrowserInfo() {
  const api = getApi();
  if (!api?.runtime?.getBrowserInfo) return Promise.resolve(null);
  return callApi(api.runtime.getBrowserInfo, api.runtime);
}

export function reloadExtension() {
  const api = getApi();
  if (!api?.runtime?.reload) return Promise.resolve();
  return callApi(api.runtime.reload, api.runtime);
}
