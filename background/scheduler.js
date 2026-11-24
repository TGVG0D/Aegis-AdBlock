import { createAlarm, getAlarm, onAlarm } from '../utils/browser.js';
import { getSettings } from '../storage/settings.js';
import { flushAll, enforceHistoryLimitsFromSettings } from './historyService.js';
import { runDueUpdates } from './listsService.js';
import { getRuntime, setPauseUntil } from './engineRuntime.js';
import { cleanupExpiredWhitelist } from './whitelistService.js';
import { emitBackgroundEvent } from './events.js';
import { cleanupSiteBlockBypasses } from './siteBlockService.js';

const UPDATE_ALARM = 'aegis-lists-update';
const CLEANUP_ALARM = 'aegis-cleanup';
const PAUSE_ALARM = 'aegis-pause-end';

let started = false;
let unsubscribe = null;

export async function scheduleUpdateAlarm(settings = null) {
  const current = settings || getRuntime().settings || (await getSettings());
  const hours = Number(current?.updateIntervalHours) || 0;
  if (!current?.autoUpdate || hours <= 0) {
    try {
      await getAlarm(UPDATE_ALARM);
      // chrome.alarms.clear has no wrapper; use the API directly with fallbacks.
      const api = globalThis.browser || globalThis.chrome;
      await api?.alarms?.clear?.(UPDATE_ALARM);
    } catch {
      // ignore
    }
    return { scheduled: false };
  }
  try {
    await createAlarm(UPDATE_ALARM, {
      delayInMinutes: Math.min(60, hours * 60),
      periodInMinutes: hours * 60,
    });
    return { scheduled: true, hours };
  } catch (error) {
    console.warn('[Aegis] não foi possível agendar atualizações', error);
    return { scheduled: false, error: error.message };
  }
}

export async function schedulePauseEnd(pausedUntil = 0) {
  const api = globalThis.browser || globalThis.chrome;
  try {
    await api?.alarms?.clear?.(PAUSE_ALARM);
    if (Number(pausedUntil) > Date.now()) {
      await createAlarm(PAUSE_ALARM, { when: Number(pausedUntil) });
    }
  } catch {
    // ignore
  }
}

export async function scheduleCleanupAlarm() {
  try {
    await createAlarm(CLEANUP_ALARM, { delayInMinutes: 5, periodInMinutes: 24 * 60 });
  } catch {
    // ignore
  }
}

async function handleAlarm(alarm) {
  if (!alarm?.name) return;
  if (alarm.name === UPDATE_ALARM) {
    try {
      const result = await runDueUpdates();
      emitBackgroundEvent('lists:auto-update', result);
    } catch (error) {
      console.warn('[Aegis] atualização automática falhou', error);
      emitBackgroundEvent('lists:auto-update-error', { error: error.message });
    }
    return;
  }
  if (alarm.name === CLEANUP_ALARM) {
    try {
      await cleanupExpiredWhitelist();
      await cleanupSiteBlockBypasses();
      await enforceHistoryLimitsFromSettings();
      await flushAll();
      emitBackgroundEvent('maintenance:cleanup', { at: Date.now() });
    } catch (error) {
      console.warn('[Aegis] limpeza periódica falhou', error);
    }
    return;
  }
  if (alarm.name === PAUSE_ALARM) {
    const info = await setPauseUntil(0);
    emitBackgroundEvent('protection:resumed', info);
  }
}

export async function startScheduler() {
  if (!started) {
    unsubscribe = onAlarm(handleAlarm);
    started = true;
  }
  const settings = await getSettings();
  await scheduleUpdateAlarm(settings);
  await scheduleCleanupAlarm();
  const runtime = getRuntime();
  if (runtime.pausedUntil && runtime.pausedUntil > Date.now()) {
    await schedulePauseEnd(runtime.pausedUntil);
  }
  return { started: true };
}

export function stopScheduler() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  started = false;
}

export { UPDATE_ALARM, CLEANUP_ALARM, PAUSE_ALARM };
