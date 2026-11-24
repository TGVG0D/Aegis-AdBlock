import { sendMessage } from '../utils/browser.js';
import { buildCosmeticCss } from './cosmeticStyles.js';

const STATE_KEY = '__aegisCosmeticState';

if (!globalThis[STATE_KEY]) {
  globalThis[STATE_KEY] = true;
  start();
}

function start() {
  let applied = 0;
  let hostname = '';
  let observer = null;
  let pending = null;
  let styleElement = null;

  function ensureRoot() {
    return document.documentElement || null;
  }

  function injectCss(selectors, antiBlock) {
    const valid = [];
    for (const selector of selectors) {
      try {
        // Validate selectors individually so a single browser-unsupported
        // selector cannot invalidate a whole CSS rule.
        document.querySelector(selector);
        valid.push(selector);
      } catch {
        // skip invalid selector
      }
    }
    return buildCosmeticCss(valid, { antiBlock });
  }

  function apply(payload) {
    applied = Number(payload?.applied) || 0;
    if (!payload?.enabled || payload?.settingsEnabled === false || !Array.isArray(payload?.hide)) {
      removeStyle();
      return;
    }
    const root = ensureRoot();
    if (!root) return;
    const { css, valid } = injectCss(payload.hide, payload.antiBlock === true);
    if (!css) {
      removeStyle();
      return;
    }
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.setAttribute('type', 'text/css');
    }
    // Keep the element in a detached state until it has content, then attach
    // once. A stable, non-obvious element avoids extension-signature scanning.
    if (!styleElement.isConnected) root.appendChild(styleElement);
    if (styleElement.textContent !== css) styleElement.textContent = css;
    applied = valid;
  }

  function removeStyle() {
    if (styleElement?.isConnected) styleElement.remove();
    styleElement = null;
  }

  async function refresh(reason = 'load') {
    try {
      hostname = location.hostname.toLowerCase();
      const response = await sendMessage({ type: 'cosmetic.getForHost', hostname, reason });
      if (!response?.ok) return;
      apply(response.data);
      try {
        await sendMessage({
          type: 'cosmetic.report',
          hostname,
          applied: response.data.applied,
          total: response.data.total || response.data.applied,
        });
      } catch {
        // reporting is best-effort
      }
    } catch {
      // Background may be restarting; DOM is untouched.
    }
  }

  function watchRemoval() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(() => {
      if (styleElement && !styleElement.isConnected) {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          const root = ensureRoot();
          if (root && styleElement && !styleElement.isConnected) root.appendChild(styleElement);
        }, 250);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: false });
  }

  function scheduleRefresh() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => refresh('dom-ready'), { once: true });
    } else {
      refresh('ready');
    }
    watchRemoval();
  }

  try {
    const api = globalThis.browser || globalThis.chrome;
    api?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'cosmetic.refresh') {
        refresh('background').then(() => sendResponse({ ok: true, applied }));
        return true;
      }
      if (message?.type === 'content.ping') {
        sendResponse({ ok: true, applied, hostname, hasStyle: Boolean(styleElement?.isConnected) });
        return false;
      }
      return false;
    });
  } catch {
    // ignore listener installation failures
  }

  scheduleRefresh();
}
