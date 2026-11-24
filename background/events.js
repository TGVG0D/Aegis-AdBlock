const listeners = new Set();

export function onBackgroundEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitBackgroundEvent(scope, payload = {}) {
  const event = { scope, ...payload };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[Aegis] background event listener failed', error);
    }
  }
  // Do not broadcast per-request events; they are high volume. UI pages can
  // subscribe to low-frequency state changes without polling the background.
  if (scope.startsWith('request:') || scope.startsWith('cosmetic:')) return;
  try {
    const api = globalThis.browser || globalThis.chrome;
    const result = api?.runtime?.sendMessage?.({ type: 'event', event });
    if (result?.catch) result.catch(() => {});
  } catch {
    // No receiver is normal (no dashboard/popup open).
  }
}

export function clearBackgroundEvents() {
  listeners.clear();
}
