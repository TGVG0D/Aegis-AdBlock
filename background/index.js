import { TARGET } from '../engine/constants.js';
import { getApi, onRuntimeMessage, queryTabs } from '../utils/browser.js';
import { initializeStorage } from './bootstrap.js';
import { ensureRuntimeReady, getRuntime } from './engineRuntime.js';
import { startScheduler } from './scheduler.js';
import { installRequestListeners } from './requestService.js';
import { handleMessage } from './messages.js';
import { cleanupExpiredWhitelist } from './whitelistService.js';
import { initializeSiteBlockService, installSiteBlockListeners } from './siteBlockService.js';
import { removeTab, resetTab, updateBadge } from './tabService.js';
import { runDueUpdates } from './listsService.js';
import { flushAll, setHistorySettings } from './historyService.js';
import { getSettings } from '../storage/settings.js';
import { getWhitelist } from '../storage/state.js';
import { emitBackgroundEvent } from './events.js';

const api = getApi();
let bootPromise = null;

// Register the block-list navigation observer synchronously so a suspended MV3
// worker wakes up and can remember the URL that DNR is about to redirect.
installSiteBlockListeners();

async function boot({ reason = 'load' } = {}) {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const creation = await initializeStorage();
      const runtime = await ensureRuntimeReady();
      const settings = await getSettings();
      runtime.settings = settings;
      setHistorySettings(settings);
      await cleanupExpiredWhitelist().catch(() => {});
      await initializeSiteBlockService().catch((error) =>
        console.warn('[Aegis] falha ao iniciar a lista de bloqueio', error),
      );
      await getWhitelist();
      installRequestListeners();
      await startScheduler();
      await primeOpenTabs(settings);
      if (settings.autoUpdate) {
        setTimeout(() => {
          runDueUpdates().catch((error) => console.warn('[Aegis] atualização inicial falhou', error));
        }, 15000);
      }
      emitBackgroundEvent('background:ready', {
        target: TARGET,
        created: creation.created,
        reason,
        buildMs: runtime.buildInfo?.buildMs || 0,
      });
      return { ready: true, target: TARGET };
    } catch (error) {
      bootPromise = null;
      console.error('[Aegis] falha na inicialização', error);
      throw error;
    }
  })();
  return bootPromise;
}

async function primeOpenTabs(settings) {
  try {
    const tabs = await queryTabs({});
    await Promise.allSettled(
      (tabs || [])
        .filter((tab) => Number.isInteger(tab.id) && /^https?:/i.test(tab.url || ''))
        .map((tab) => {
          resetTab(tab.id, tab.url);
          return updateBadge(tab.id, { settings });
        }),
    );
  } catch {
    // tabs permission may not be available in a given context
  }
}

// Register listeners synchronously so a suspended service worker wakes for messages.
onRuntimeMessage(async (message, sender) => {
  await boot({ reason: 'message' });
  return handleMessage(message, sender);
});

function listenRuntime(name, handler) {
  try {
    api?.runtime?.[name]?.addListener?.(handler);
  } catch {
    // ignore unsupported lifecycle events
  }
}

listenRuntime('onInstalled', (details) => {
  boot({ reason: `installed:${details?.reason || 'unknown'}` }).catch(() => {});
});
listenRuntime('onStartup', () => {
  boot({ reason: 'startup' }).catch(() => {});
});

try {
  api?.tabs?.onRemoved?.addListener((tabId) => removeTab(tabId));
  api?.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (changeInfo?.url) {
      resetTab(tabId, changeInfo.url);
      getSettings()
        .then((settings) => updateBadge(tabId, { settings }))
        .catch(() => {});
    } else if (changeInfo?.status === 'complete' && tab?.url) {
      const runtime = getRuntime();
      updateBadge(tabId, { settings: runtime.settings }).catch(() => {});
    }
  });
  api?.tabs?.onActivated?.addListener(({ tabId }) => {
    const runtime = getRuntime();
    updateBadge(tabId, { settings: runtime.settings }).catch(() => {});
  });
} catch {
  // ignore
}

listenRuntime('onSuspend', () => {
  flushAll().catch(() => {});
});
if (api?.runtime?.onSuspendCanceled) {
  listenRuntime('onSuspendCanceled', () => {
    boot({ reason: 'resume' }).catch(() => {});
  });
}

// Kick off initialization immediately; listeners above already accept traffic.
boot({ reason: 'load' }).catch(() => {});
