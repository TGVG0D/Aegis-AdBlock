import { parseList } from '../engine/parser.js';
import { hashText, sanitizeListText, summarizeParsed } from '../filters/listUtils.js';
import {
  getCustomRules,
  getLists,
  getMeta,
  getSiteBlocks,
  getWhitelist,
  migrateIfNeeded,
  setCustomRules,
  setLists,
  setMeta,
  setSiteBlocks,
  setWhitelist,
} from '../storage/state.js';
import { getSettings, saveSettings } from '../storage/settings.js';
import { getListBody, putListBody } from '../storage/db.js';
import { getUrl } from '../utils/browser.js';

const STARTER_ID = 'aegis-starter';

const FALLBACK_STARTER = `
[Adblock Plus 2.0]
! Title: Aegis Proteção Essencial (fallback)
! @category ads
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||amazon-adsystem.com^
||adnxs.com^
||criteo.com^
||criteo.net^
||taboola.com^
||outbrain.com^
! @category tracking
||google-analytics.com^
||googletagmanager.com^
||scorecardresearch.com^
||hotjar.com^
||mixpanel.com^
||segment.io^
||amplitude.com^
! @category ads
##.ad-banner
##.advertisement
##.adsbygoogle
##[id^="div-gpt-ad"]
`;

async function readBundledStarter() {
  try {
    const response = await fetch(getUrl('assets/lists/starter.txt'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    console.warn('[Aegis] lista inicial empacotada indisponível, usando fallback', error);
    return FALLBACK_STARTER;
  }
}

function buildStarterMetadata(parsed, size, hash, existing = null) {
  const summary = summarizeParsed(parsed);
  const now = Date.now();
  return {
    id: STARTER_ID,
    name: 'Aegis Proteção Essencial',
    url: '',
    sourceType: 'bundled',
    category: 'mixed',
    enabled: existing?.enabled ?? true,
    createdAt: existing?.createdAt || now,
    lastUpdated: now,
    lastChecked: now,
    lastErrorAt: 0,
    status: 'ok',
    error: '',
    ruleCount: summary.ruleCount,
    networkCount: summary.networkCount,
    cosmeticCount: summary.cosmeticCount,
    invalidCount: summary.invalidCount,
    unsupportedCount: summary.unsupportedCount,
    format: summary.format,
    size,
    hash,
    etag: '',
    lastModified: '',
    updateCount: (existing?.updateCount || 0) + 1,
  };
}

async function seedStarter(lists) {
  const text = await readBundledStarter();
  const sanitized = sanitizeListText(text);
  if (!sanitized.ok) throw new Error(sanitized.error);
  const parsed = parseList(sanitized.text, {
    listId: STARTER_ID,
    listName: 'Aegis Proteção Essencial',
    category: 'mixed',
    format: 'easylist',
    source: 'bundled',
  });
  if (!parsed.ok || parsed.stats.network + parsed.stats.cosmetic === 0) {
    throw new Error('A lista inicial não pôde ser analisada.');
  }
  const hash = hashText(sanitized.text);
  const existing = lists.find((list) => list.id === STARTER_ID) || null;
  const metadata = buildStarterMetadata(parsed, sanitized.size, hash, existing);
  await putListBody(STARTER_ID, {
    text: sanitized.text,
    size: sanitized.size,
    hash,
    updatedAt: metadata.lastUpdated,
  });
  return { metadata, parsed };
}

/**
 * Idempotent initialization. Existing configuration is never overwritten.
 * The starter list is bundled and works completely offline.
 */
export async function initializeStorage() {
  const migration = await migrateIfNeeded();
  const meta = await getMeta();
  let settings = await getSettings();
  if (!settings) settings = await saveSettings(settings);

  const [lists, customRules, whitelist, siteBlocks] = await Promise.all([
    getLists(),
    getCustomRules(),
    getWhitelist(),
    getSiteBlocks(),
  ]);

  if (!meta.initialized) {
    await saveSettings(settings);
    await setCustomRules(customRules);
    await setWhitelist(whitelist);
    await setSiteBlocks(siteBlocks);
    try {
      const starter = await seedStarter(lists);
      await setLists([starter.metadata]);
    } catch (error) {
      console.error('[Aegis] falha ao instalar a lista inicial', error);
      await setLists(lists);
    }
    await setMeta({
      initialized: true,
      installDate: Date.now(),
      seedVersion: 1,
      schemaVersion: settings.schemaVersion,
      migrated: migration.migrated,
    });
    return { created: true };
  }

  // Repair a deleted/missing body for the bundled list without touching user lists.
  const starter = lists.find((list) => list.id === STARTER_ID);
  if (starter) {
    const body = await getListBody(STARTER_ID);
    if (!body?.text) {
      try {
        const seeded = await seedStarter(lists);
        const nextLists = lists.map((list) => (list.id === STARTER_ID ? seeded.metadata : list));
        await setLists(nextLists);
      } catch (error) {
        console.warn('[Aegis] não foi possível restaurar a lista inicial', error);
      }
    }
  }

  // Ensure all state keys exist after updates/migrations.
  if (!Array.isArray(lists)) await setLists([]);
  if (!Array.isArray(customRules)) await setCustomRules([]);
  if (!Array.isArray(whitelist)) await setWhitelist([]);
  if (!Array.isArray(siteBlocks)) await setSiteBlocks([]);
  await setMeta({ initialized: true, schemaVersion: settings.schemaVersion });
  return { created: false };
}

export { STARTER_ID };
