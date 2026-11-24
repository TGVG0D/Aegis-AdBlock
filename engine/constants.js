/**
 * Aegis AdBlock - shared constants.
 * Pure module: safe to import from background, content scripts, UI and Node tests.
 */

export const APP_NAME = 'Aegis AdBlock';
export const APP_ID = 'aegis-adblock';
export const VERSION = '1.0.1';
export const SCHEMA_VERSION = 1;
/** Bump whenever parsed-filter shape or grammar changes, to invalidate caches. */
export const PARSER_CACHE_VERSION = 1;

export const TARGET = typeof __TARGET__ !== 'undefined' ? __TARGET__ : 'unknown';

/** True for Firefox desktop and Firefox for Android (Gecko-based). */
export const IS_GECKO = TARGET === 'firefox' || TARGET === 'firefox-android';

export const CATEGORIES = Object.freeze({
  ads: {
    id: 'ads',
    label: 'Anúncios',
    short: 'Ads',
    color: '#22d3ee',
    description: 'Banners, vídeos, pop-ups e scripts publicitários.',
  },
  tracking: {
    id: 'tracking',
    label: 'Rastreadores',
    short: 'Trackers',
    color: '#a78bfa',
    description: 'Analytics, pixels, beacons e perfis de navegação.',
  },
  malware: {
    id: 'malware',
    label: 'Malware e golpes',
    short: 'Malware',
    color: '#fb7185',
    description: 'Domínios maliciosos, phishing e distribuição de malware.',
  },
  annoyance: {
    id: 'annoyance',
    label: 'Incômodos',
    short: 'Annoyances',
    color: '#fbbf24',
    description: 'Avisos de cookies, overlays, newsletters e widgets intrusivos.',
  },
  other: {
    id: 'other',
    label: 'Outros',
    short: 'Outros',
    color: '#94a3b8',
    description: 'Regras que não se encaixam nas demais categorias.',
  },
  mixed: {
    id: 'mixed',
    label: 'Mista',
    short: 'Mista',
    color: '#38bdf8',
    description: 'Lista com regras de várias categorias.',
  },
});

export const USER_CATEGORIES = Object.freeze(['ads', 'tracking', 'malware', 'annoyance', 'other']);

export const CATEGORY_ORDER = Object.freeze(['ads', 'tracking', 'malware', 'annoyance', 'other']);

/** Resource types understood by the parser and native matcher. */
export const RESOURCE_TYPES = Object.freeze([
  'document',
  'subdocument',
  'script',
  'image',
  'stylesheet',
  'object',
  'xmlhttprequest',
  'font',
  'media',
  'websocket',
  'ping',
  'other',
  'csp_report',
]);

export const ALL_RESOURCE_TYPES = Object.freeze([...RESOURCE_TYPES]);

/** webRequest / DNR type -> parser type. */
export const REQUEST_TYPE_MAP = Object.freeze({
  main_frame: 'document',
  sub_frame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  ping: 'ping',
  csp_report: 'csp_report',
  media: 'media',
  websocket: 'websocket',
  webbundle: 'other',
  other: 'other',
});

/** parser type -> declarativeNetRequest resource type. */
export const DNR_TYPE_MAP = Object.freeze({
  document: 'main_frame',
  subdocument: 'sub_frame',
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  ping: 'ping',
  csp_report: 'csp_report',
  other: 'other',
});

export const TYPE_LABELS = Object.freeze({
  document: 'Documento',
  subdocument: 'Subdocumento',
  script: 'Script',
  image: 'Imagem',
  stylesheet: 'CSS',
  object: 'Objeto',
  xmlhttprequest: 'XHR/Fetch',
  font: 'Fonte',
  media: 'Mídia',
  websocket: 'WebSocket',
  ping: 'Ping',
  other: 'Outro',
  csp_report: 'CSP',
});

export const DNR_PRIORITIES = Object.freeze({
  block: 1,
  exception: 100,
  importantBlock: 1000,
  importantException: 2000,
  whitelist: 3000,
  whitelistDocument: 4000,
  siteBlock: 6000,
  siteBlockBypass: 7000,
});

/** User block list: per-site action and the temporary "proceed anyway" window. */
export const SITE_BLOCK_ACTIONS = Object.freeze(['block', 'redirect']);
export const SITE_BLOCK_LIST_ID = 'site-block';
export const SITE_BLOCK_LIST_NAME = 'Lista de bloqueio';
export const SITE_BLOCK_BYPASS_MS = 5 * 60 * 1000;

export const LIMITS = Object.freeze({
  maxListBytes: 50 * 1024 * 1024,
  maxListRules: 600000,
  maxRuleLength: 2000,
  maxRegexLength: 512,
  maxSelectorLength: 1000,
  maxGenericCosmetic: 25000,
  maxCosmeticPerPage: 30000,
  maxHistoryPageSize: 100,
  maxCustomRuleLength: 2000,
  maxUrlLength: 8192,
  dnrDynamicRules: 30000,
  dnrRegexRules: 1000,
  dnrUrlFilterLength: 2000,
  maxSiteBlocks: 500,
  maxExportRows: 100000,
  fetchTimeoutMs: 45000,
  updateHistoryPerList: 40,
  maxInvalidSamples: 25,
});

export const AUTO_UPDATE_HOURS = Object.freeze([6, 12, 24, 168]);

export const TEMP_DURATIONS = Object.freeze([
  { id: '1h', label: '1 hora', ms: 60 * 60 * 1000 },
  { id: '24h', label: '24 horas', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 dias', ms: 7 * 24 * 60 * 60 * 1000 },
]);

export const RECOMMENDED_LISTS = Object.freeze([
  {
    id: 'easylist',
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
    category: 'ads',
    description: 'Lista principal de anúncios mantida pela comunidade EasyList.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    category: 'tracking',
    description: 'Rastreadores, analytics, pixels e beacons.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'easylist-portuguese',
    name: 'EasyList Portuguese',
    url: 'https://easylist-downloads.adblockplus.org/easylistportuguese+easylist.txt',
    category: 'ads',
    description: 'Complemento em português para anúncios e elementos locais; inclui a base EasyList.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'fanboy-annoyance',
    name: 'Fanboy’s Annoyance List',
    url: 'https://easylist.to/easylist/fanboy-annoyance.txt',
    category: 'annoyance',
    description: 'Banners de cookies, pop-ups, newsletters e outros elementos incômodos.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'adguard-base',
    name: 'AdGuard Base Filter',
    url: 'https://filters.adtidy.org/extension/chromium/filters/2.txt',
    category: 'ads',
    description: 'Filtro geral de anúncios mantido pelo projeto AdGuard.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'adguard-tracking',
    name: 'AdGuard Tracking Protection',
    url: 'https://filters.adtidy.org/extension/chromium/filters/3.txt',
    category: 'tracking',
    description: 'Rastreadores, analytics, pixels e mecanismos de perfilização.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'stevenblack',
    name: 'StevenBlack Hosts',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    category: 'mixed',
    description: 'Lista agregada no formato hosts, com anúncios e rastreadores.',
    license: 'MIT (compilação; listas de terceiros)',
    format: 'hosts',
  },
  {
    id: 'hagezi-pro',
    name: 'HaGeZi Pro',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt',
    category: 'mixed',
    description: 'Proteção ampliada contra anúncios, rastreadores, telemetria e ameaças.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'hagezi-tif',
    name: 'HaGeZi Threat Intelligence Feeds',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.medium.txt',
    category: 'malware',
    description: 'Domínios associados a malware, phishing, golpes e infraestrutura maliciosa.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'ublock-privacy',
    name: 'uBlock Origin Privacy',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
    category: 'tracking',
    description: 'Filtro de privacidade do projeto uBlock Origin, distribuído via GitHub RAW.',
    license: 'GPLv3',
    format: 'easylist',
  },
  {
    id: 'urlhaus',
    name: 'URLhaus (domínios)',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt',
    category: 'malware',
    description: 'Espelho do URLhaus (abuse.ch) com domínios usados na distribuição de malware.',
    license: 'CC0 / MIT',
    format: 'domains',
  },
]);

export const STORAGE_KEYS = Object.freeze({
  settings: 'settings',
  lists: 'lists',
  customRules: 'customRules',
  whitelist: 'whitelist',
  siteBlocks: 'siteBlocks',
  siteBlockBypasses: 'siteBlockBypasses',
  siteBlockContexts: 'siteBlockContexts',
  stats: 'stats',
  meta: 'meta',
});

export const DB_NAME = 'aegis-adblock';
export const DB_VERSION = 1;
export const DB_STORES = Object.freeze({
  listBodies: 'listBodies',
  listHistory: 'listHistory',
  history: 'history',
  engineCache: 'engineCache',
});

export const HISTORY_DETAIL_MODES = Object.freeze([
  { id: 'path', label: 'Host + caminho (sem parâmetros)' },
  { id: 'host', label: 'Somente host' },
]);

export const HISTORY_RETENTION_DAYS = Object.freeze([1, 7, 30, 90, 180]);
export const HISTORY_LIMITS = Object.freeze([1000, 5000, 20000, 50000]);

export const DEFAULT_WHITELIST_NOTE = 'Permitido pelo usuário';

export const DANGEROUS_COSMETIC_SELECTORS = Object.freeze([
  '*',
  'html',
  'body',
  'div',
  'span',
  'a',
  'p',
  'img',
  'iframe',
  'ul',
  'ol',
  'li',
  'header',
  'footer',
  'main',
  'section',
  'article',
  'aside',
  'nav',
  'table',
  'tr',
  'td',
  'th',
  'input',
  'button',
  'form',
  '[class]',
  '[id]',
  '[style]',
]);

export const COSMETIC_SEPARATORS = Object.freeze([
  '#@?#',
  '#@$#',
  '#@%#',
  '#?#',
  '#$#',
  '#%#',
  '#@#',
  '##',
]);

export const UNSUPPORTED_OPTIONS = Object.freeze([
  'redirect',
  'redirect-rule',
  'csp',
  'removeparam',
  'header',
  'urltransform',
  'replace',
  'permissions',
  'method',
  'to',
  'from',
  'denyallow',
  'rewrite',
  'empty',
  'mp4',
  'inline-script',
  'inline-font',
  'webrtc',
  'popup',
  'elemhide',
  'generichide',
  'genericblock',
  'specifichide',
  'ghide',
  'ehide',
  'shide',
]);
