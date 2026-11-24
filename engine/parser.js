import {
  ALL_RESOURCE_TYPES,
  CATEGORIES,
  COSMETIC_SEPARATORS,
  DANGEROUS_COSMETIC_SELECTORS,
  LIMITS,
  RESOURCE_TYPES,
  UNSUPPORTED_OPTIONS,
  USER_CATEGORIES,
} from './constants.js';
import {
  domainMatches,
  hostnameFromUrl,
  isLocalOrPrivateHost,
  normalizeDomainList,
  normalizeHostname,
} from '../utils/urls.js';

const TYPE_ALIASES = Object.freeze({
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  'object-subrequest': 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'subdocument',
  frame: 'subdocument',
  document: 'document',
  doc: 'document',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  ping: 'ping',
  other: 'other',
  csp_report: 'csp_report',
});

const TYPE_OPTIONS = new Set(Object.keys(TYPE_ALIASES));
const IGNORED_OPTIONS = new Set(['collapse', '~collapse']);

const HOSTS_PREFIX =
  /^\s*(?:0\.0\.0\.0|127\.0\.0\.1|::1|::|0:0:0:0:0:0:0:1|255\.255\.255\.255)\s+([^\s#]+)(?:\s+([^\s#]+))?/i;
const GENERIC_HOSTS_LINE = /^\s*(?:\d{1,3}\.){3}\d{1,3}\s+(?![#\s])/;
const HOSTS_LEADING_IP = /^\s*(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\s+/;

const RESERVED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
]);

const BARE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;

const CATEGORY_LINE_PATTERNS = [
  /^!\s*@?category(?:\s*[:=]|\s+)\s*([a-z]+)\s*$/i,
  /^!\s*\[category\s*=\s*([a-z]+)\]\s*$/i,
  /^!#\s*category(?:\s*[:=]|\s+)\s*([a-z]+)\s*$/i,
];

function safeCategory(value, fallback = 'other') {
  if (value && USER_CATEGORIES.includes(value)) return value;
  if (value === 'mixed' || value === 'other') return 'other';
  return fallback;
}

function categoryFromComment(line) {
  for (const pattern of CATEGORY_LINE_PATTERNS) {
    const match = line.match(pattern);
    if (match) return safeCategory(match[1].toLowerCase(), null);
  }
  return null;
}

export function detectListFormat(lines) {
  let sample = 0;
  let hosts = 0;
  let domains = 0;
  let easylist = 0;
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith('!') || raw.startsWith('[')) continue;
    if (/^#\s/.test(raw) || raw === '#') continue;
    sample += 1;
    if (HOSTS_PREFIX.test(raw)) {
      hosts += 1;
    } else if (BARE_DOMAIN.test(raw)) {
      domains += 1;
    } else if (
      raw.startsWith('||') ||
      raw.startsWith('@@') ||
      raw.startsWith('|') ||
      raw.startsWith('/') ||
      raw.includes('##') ||
      raw.includes('#@#') ||
      raw.includes('$')
    ) {
      easylist += 1;
    }
    if (sample >= 500) break;
  }
  if (sample === 0) return 'easylist';
  if (hosts >= Math.max(2, sample * 0.2) && hosts >= domains) return 'hosts';
  if (domains >= sample * 0.7 && easylist <= sample * 0.05) return 'domains';
  return 'easylist';
}

function splitOptions(line) {
  let index = line.lastIndexOf('$');
  while (index > 0) {
    const suffix = line.slice(index + 1);
    if (suffix && /^[\w~=,.*|\-]+$/.test(suffix)) {
      return { pattern: line.slice(0, index), options: suffix };
    }
    index = line.lastIndexOf('$', index - 1);
  }
  return { pattern: line, options: null };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert an Adblock Plus pattern into a JavaScript regular expression source. */
export function patternToRegexSource(pattern, { matchCase = false } = {}) {
  let value = pattern;
  let prefix = '';
  let suffix = '';

  if (value.startsWith('||')) {
    prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]*\\.)?';
    value = value.slice(2);
  } else if (value.startsWith('|')) {
    prefix = '^';
    value = value.slice(1);
  }

  if (value.endsWith('|')) {
    suffix = '$';
    value = value.slice(0, -1);
  }

  let body = '';
  for (const char of value) {
    if (char === '*') {
      body += '.*';
    } else if (char === '^') {
      body += '(?:[^a-z0-9_\\-.%]|$)';
    } else {
      body += escapeRegex(char);
    }
  }

  return `${prefix}${body}${suffix}${matchCase ? '' : ''}`;
}

export function compilePattern(pattern, { matchCase = false } = {}) {
  const source = patternToRegexSource(pattern, { matchCase });
  return new RegExp(source, matchCase ? '' : 'i');
}

export function extractToken(pattern) {
  if (!pattern || pattern.startsWith('/')) return '';
  const matches = pattern.toLowerCase().match(/[a-z0-9]{4,}/g);
  if (!matches) return '';
  matches.sort((a, b) => b.length - a.length);
  return matches[0] || '';
}

/**
 * Conservative regex safety check. List regex filters are data, never code,
 * but we still reject constructs that can cause catastrophic backtracking.
 */
export function isSafeRegex(source) {
  if (!source || source.length > LIMITS.maxRegexLength) return false;
  if (/\\[1-9]/.test(source)) return false;
  if (/\(\?[=!<]/.test(source)) return false;
  if (/\(\?(?:[a-z]+:)?.*\)[+*{]/.test(source)) return false;
  if (/(?:\.\*|\.\+){2,}/.test(source)) return false;
  // Nested quantifiers such as (a+)+ or (a*)+ are classic catastrophic
  // backtracking shapes. Reject them even though RegExp construction succeeds.
  if (/\([^)]*(?:[+*]|\{\d+,?\d*\})[^)]*\)[+*{]/.test(source)) return false;
  return true;
}

export function isSafeCosmeticSelector(selector) {
  if (typeof selector !== 'string') return false;
  const value = selector.trim();
  if (!value || value.length > LIMITS.maxSelectorLength) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/[{}<]/.test(value)) return false;
  if (/^\s*\+js\s*\(/i.test(value)) return false;
  if (/(?:url|expression|binding|javascript)\s*\(/i.test(value)) return false;
  if (/@import/i.test(value)) return false;
  if (
    /:(?:has-text|contains|xpath|style|remove|upward|watch-attr|matches-attr|matches-css|if|if-not|min-text-length|others|remove-attr|remove-class|-abp-)/i.test(
      value,
    )
  ) {
    return false;
  }
  let round = 0;
  let square = 0;
  for (const char of value) {
    if (char === '(') round += 1;
    if (char === ')') round -= 1;
    if (char === '[') square += 1;
    if (char === ']') square -= 1;
    if (round < 0 || square < 0) return false;
  }
  return round === 0 && square === 0;
}

/** Split a selector list on top-level commas (ignoring commas in :is(), [] and quotes). */
export function splitTopLevelSelectors(selector) {
  const parts = [];
  let current = '';
  let round = 0;
  let square = 0;
  let quote = '';
  let escaped = false;
  for (const char of String(selector || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === '(') round += 1;
    else if (char === ')') round -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    if (char === ',' && round === 0 && square === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isBroadSelectorPart(selector) {
  const value = selector.trim().toLowerCase();
  if (!value) return true;
  if (DANGEROUS_COSMETIC_SELECTORS.includes(value)) return true;
  // A bare tag selector (div, span, ...) would hide the whole page.
  if (/^[a-z][a-z0-9-]*$/.test(value) && !['custom-element'].includes(value)) return true;
  // Structural selectors without a class, id, attribute or pseudo.
  if (!/[.#:\[\]]/.test(value)) return true;
  // Root-level pseudo classes and universal selectors are usually broad:
  // ":not(.ad)" hides almost everything, and "*[data-ad]" is unpredictable.
  if (/^:/.test(value) || /^\*/.test(value)) return true;
  // A tag followed only by a bare presence attribute or :not() is broad, e.g.
  // "div[class]" or "div:not(.ad)".
  if (/^[a-z][a-z0-9-]*\[(?:class|id|style)\](?:$|[\s>+~,])/.test(value)) return true;
  if (/^[a-z][a-z0-9-]*(?:\[(?:class|id|style)\])?:not\(/.test(value)) return true;
  return false;
}

export function isBroadCosmeticSelector(selector) {
  const parts = splitTopLevelSelectors(selector);
  if (!parts.length) return true;
  return parts.some(isBroadSelectorPart);
}

function parseTypesAndOptions(options, filter) {
  if (!options) return { ok: true };
  const parts = options.split(',').map((part) => part.trim()).filter(Boolean);
  const positiveTypes = new Set();
  const excludedTypes = new Set();
  let sawPositiveType = false;
  const includeDomains = [];
  const excludeDomains = [];
  let thirdParty = null;
  let matchCase = false;
  let important = false;
  let badfilter = false;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!lower) continue;
    if (IGNORED_OPTIONS.has(lower)) continue;

    if (lower.startsWith('domain=')) {
      const rawDomains = part.slice(part.indexOf('=') + 1);
      if (!rawDomains) return { ok: false, reason: 'Opção domain= vazia.', unsupported: true };
      for (const rawDomain of rawDomains.split('|')) {
        const negated = rawDomain.startsWith('~');
        const value = negated ? rawDomain.slice(1) : rawDomain;
        const normalized = normalizeHostname(value);
        if (!normalized) {
          return { ok: false, reason: `Domínio inválido em domain=: ${value}`, unsupported: true };
        }
        (negated ? excludeDomains : includeDomains).push(normalized);
      }
      continue;
    }

    if (lower === 'third-party' || lower === '3p') {
      thirdParty = true;
      continue;
    }
    if (lower === '~third-party' || lower === '~3p') {
      thirdParty = false;
      continue;
    }
    if (lower === 'first-party' || lower === '1p') {
      thirdParty = false;
      continue;
    }
    if (lower === '~first-party' || lower === '~1p') {
      thirdParty = true;
      continue;
    }
    if (lower === 'match-case') {
      matchCase = true;
      continue;
    }
    if (lower === 'important') {
      important = true;
      continue;
    }
    if (lower === 'badfilter') {
      badfilter = true;
      continue;
    }

    const negated = lower.startsWith('~');
    const token = negated ? lower.slice(1) : lower;
    if (UNSUPPORTED_OPTIONS.includes(token)) {
      return {
        ok: false,
        reason: `Opção não suportada: ${token} (ignorada por segurança/compatibilidade)`,
        unsupported: true,
      };
    }
    if (TYPE_OPTIONS.has(token)) {
      const type = TYPE_ALIASES[token];
      if (!type) {
        return { ok: false, reason: `Tipo não suportado: ${token}`, unsupported: true };
      }
      if (negated) {
        excludedTypes.add(type);
      } else {
        positiveTypes.add(type);
        sawPositiveType = true;
      }
      continue;
    }
    if (token === 'popup' || token === 'webrtc') {
      return { ok: false, reason: `Tipo não suportado: ${token}`, unsupported: true };
    }
    return { ok: false, reason: `Opção desconhecida: ${part}`, unsupported: true };
  }

  const allowed = RESOURCE_TYPES;
  if (sawPositiveType) {
    filter.types = allowed.filter((type) => positiveTypes.has(type));
  } else {
    filter.types = allowed.filter((type) => !excludedTypes.has(type));
  }
  if (filter.types.length === 0) {
    return { ok: false, reason: 'Nenhum tipo de recurso restante.', unsupported: true };
  }
  filter.includeDomains = [...new Set(includeDomains)];
  filter.excludeDomains = [...new Set(excludeDomains)];
  filter.thirdParty = thirdParty;
  filter.matchCase = matchCase;
  filter.important = important;
  filter.badfilter = badfilter;
  return { ok: true };
}

function normalizePatternForHost(domain) {
  const host = normalizeHostname(domain);
  if (!host) return null;
  return `||${host}^`;
}

/**
 * Parse one network filter. context: { category, listId, listName, line, raw }
 */
export function parseNetworkFilter(input, context = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, kind: 'invalid', reason: 'Linha vazia.' };

  let patternPart = raw;
  let exception = false;
  if (patternPart.startsWith('@@')) {
    exception = true;
    patternPart = patternPart.slice(2);
  }

  const split = splitOptions(patternPart);
  let pattern = split.pattern.trim();
  if (!pattern) {
    return { ok: false, kind: 'invalid', reason: 'Filtro sem padrão antes das opções.' };
  }

  const filter = {
    kind: 'network',
    id: `${context.listId || 'custom'}:${context.line || 0}:${raw}`,
    raw,
    pattern,
    exception,
    regexSource: '',
    isRegex: false,
    token: '',
    types: [...ALL_RESOURCE_TYPES],
    includeDomains: [],
    excludeDomains: [],
    thirdParty: null,
    matchCase: false,
    important: false,
    badfilter: false,
    category: safeCategory(context.category, 'other'),
    listId: context.listId || 'custom',
    listName: context.listName || 'Regras personalizadas',
    line: context.line || 0,
    source: context.source || 'list',
  };

  if (pattern.length > LIMITS.maxRuleLength + 2) {
    return { ok: false, kind: 'unsupported', reason: 'Filtro maior que o limite permitido.', filter };
  }

  const optionsResult = parseTypesAndOptions(split.options, filter);
  if (!optionsResult.ok) {
    return {
      ok: false,
      kind: optionsResult.unsupported ? 'unsupported' : 'invalid',
      reason: optionsResult.reason,
      filter,
    };
  }

  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length >= 2) {
    const source = pattern.slice(1, -1);
    if (!isSafeRegex(source)) {
      return {
        ok: false,
        kind: 'unsupported',
        reason: 'Expressão regular rejeitada por segurança ou tamanho.',
        filter,
      };
    }
    try {
      new RegExp(source, filter.matchCase ? '' : 'i');
    } catch {
      return { ok: false, kind: 'invalid', reason: 'Expressão regular inválida.', filter };
    }
    filter.isRegex = true;
    filter.regexSource = source;
  } else {
    if (/[\u0000-\u001f\u007f]/.test(pattern)) {
      return { ok: false, kind: 'invalid', reason: 'Caracteres de controle no filtro.', filter };
    }
    try {
      compilePattern(pattern, { matchCase: filter.matchCase });
    } catch {
      return { ok: false, kind: 'invalid', reason: 'Padrão inválido.', filter };
    }
    filter.regexSource = patternToRegexSource(pattern, { matchCase: filter.matchCase });
    filter.token = extractToken(pattern);
  }

  return { ok: true, kind: 'network', filter };
}

function splitCosmetic(line) {
  for (const separator of COSMETIC_SEPARATORS) {
    const index = line.indexOf(separator);
    if (index !== -1) {
      return {
        separator,
        domains: line.slice(0, index),
        selector: line.slice(index + separator.length),
      };
    }
  }
  return null;
}

/** Parse one cosmetic filter (##, #@#, #?# etc.). */
export function parseCosmeticFilter(input, context = {}) {
  const raw = String(input ?? '').trim();
  const split = splitCosmetic(raw);
  if (!split) return { ok: false, kind: 'invalid', reason: 'Separador cosmético não encontrado.' };

  const { separator, domains, selector } = split;
  if (separator === '#$#' || separator === '#@$#' || separator === '#%#' || separator === '#@%#') {
    return {
      ok: false,
      kind: 'unsupported',
      reason:
        separator.includes('%')
          ? 'Scriptlets de lista são bloqueados por segurança.'
          : 'Injeção de CSS arbitrário (url()/exfiltração) não é suportada.',
    };
  }

  const selected = selector.trim();
  if (!selected) return { ok: false, kind: 'invalid', reason: 'Seletor cosmético vazio.' };
  if (!isSafeCosmeticSelector(selected)) {
    return { ok: false, kind: 'unsupported', reason: 'Seletor cosmético inválido ou não suportado.' };
  }
  if (isBroadCosmeticSelector(selected)) {
    return {
      ok: false,
      kind: 'unsupported',
      reason: 'Seletor excessivamente genérico (proteção contra ocultar a página inteira).',
    };
  }

  let includeDomains = [];
  let excludeDomains = [];
  if (domains.trim()) {
    for (const part of domains.split(',')) {
      const value = part.trim();
      if (!value) continue;
      const negated = value.startsWith('~');
      const normalized = normalizeHostname(negated ? value.slice(1) : value);
      if (!normalized) {
        return { ok: false, kind: 'invalid', reason: `Domínio cosmético inválido: ${value}` };
      }
      (negated ? excludeDomains : includeDomains).push(normalized);
    }
    includeDomains = [...new Set(includeDomains)];
    excludeDomains = [...new Set(excludeDomains)];
  }

  return {
    ok: true,
    kind: 'cosmetic',
    filter: {
      kind: 'cosmetic',
      id: `${context.listId || 'custom'}:${context.line || 0}:${raw}`,
      raw,
      selector: selected,
      exception: separator.includes('@'),
      extended: separator.includes('?'),
      includeDomains,
      excludeDomains,
      generic: includeDomains.length === 0,
      category: safeCategory(context.category, 'other'),
      listId: context.listId || 'custom',
      listName: context.listName || 'Regras personalizadas',
      line: context.line || 0,
      source: context.source || 'list',
    },
  };
}

/** Parse a single user-supplied rule, converting a bare domain to ||domain^. */
export function parseUserRule(input, context = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, kind: 'invalid', reason: 'Informe uma regra.' };
  if (raw.length > LIMITS.maxCustomRuleLength) {
    return { ok: false, kind: 'invalid', reason: 'Regra maior que o limite permitido.' };
  }
  if (raw.startsWith('!') || raw.startsWith('[')) {
    return { ok: false, kind: 'invalid', reason: 'Comentários não são regras.' };
  }
  if (splitCosmetic(raw)) {
    return parseCosmeticFilter(raw, context);
  }
  if (BARE_DOMAIN.test(raw)) {
    const pattern = normalizePatternForHost(raw);
    if (!pattern) return { ok: false, kind: 'invalid', reason: 'Domínio inválido.' };
    return parseNetworkFilter(pattern, context);
  }
  return parseNetworkFilter(raw, context);
}

function badfilterKey(raw) {
  return raw
    .replace(/\$badfilter(?:,|$)/i, (match) => (match.endsWith(',') ? '$' : ''))
    .replace(/,badfilter(?=,|$)/i, '')
    .replace(/\$+/g, '$')
    .replace(/\$+$/, '')
    .trim();
}

function networkKey(filter) {
  return [
    filter.exception ? 'allow' : 'block',
    filter.pattern,
    filter.types.join(','),
    filter.includeDomains.join(','),
    filter.excludeDomains.join(','),
    filter.thirdParty,
    filter.matchCase,
    filter.important,
  ].join('|');
}

function cosmeticKey(filter) {
  return [
    filter.exception ? 'allow' : 'hide',
    filter.selector,
    filter.includeDomains.join(','),
    filter.excludeDomains.join(','),
    filter.extended,
  ].join('|');
}

function unpackHostsLine(line) {
  let domains = null;
  const knownPrefix = line.match(HOSTS_PREFIX);
  if (knownPrefix) {
    domains = [knownPrefix[1], knownPrefix[2]].filter(Boolean);
    for (const token of line.slice(knownPrefix[0].length).trim().split(/\s+/)) {
      if (!token || token.startsWith('#')) break;
      domains.push(token);
    }
  } else if (GENERIC_HOSTS_LINE.test(line)) {
    // Also accept hosts files that use a non-zero sinkhole address.
    domains = line.replace(HOSTS_LEADING_IP, '').split(/\s+/);
  }
  if (!domains) return null;
  return domains
    .map((domain) => domain.replace(/^#+/, '').replace(/[.,;]+$/, ''))
    .map(normalizeHostname)
    .filter(
      (domain) =>
        Boolean(domain) &&
        !RESERVED_HOSTNAMES.has(domain) &&
        !isLocalOrPrivateHost(domain),
    );
}

/**
 * Parse an entire list into network and cosmetic rules.
 * options: { listId, listName, category, format: 'auto'|'easylist'|'hosts'|'domains', source }
 */
export function parseList(text, options = {}) {
  const listId = options.listId || 'list';
  const listName = options.listName || 'Lista';
  const source = options.source || 'list';
  const rawText = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (rawText.length > LIMITS.maxListBytes * 2) {
    return {
      ok: false,
      error: 'Lista muito grande para processar com segurança.',
      network: [],
      cosmetic: [],
      invalid: [],
      unsupported: [],
      stats: emptyStats(),
    };
  }
  const lines = rawText.split('\n');
  const format =
    options.format && options.format !== 'auto' ? options.format : detectListFormat(lines);

  const network = [];
  const cosmetic = [];
  const invalid = [];
  const unsupported = [];
  const badfilters = new Set();
  let currentCategory = safeCategory(options.category, 'other');
  let comments = 0;
  let totalLines = 0;
  let hostsRules = 0;
  let domainRules = 0;
  let invalidCount = 0;
  let unsupportedCount = 0;

  const pushInvalid = (line, reason, kind = 'invalid') => {
    if (kind === 'unsupported') unsupportedCount += 1;
    else invalidCount += 1;
    const bucket = kind === 'unsupported' ? unsupported : invalid;
    if (bucket.length < LIMITS.maxInvalidSamples) {
      bucket.push({ line, reason, raw: lines[line - 1]?.slice(0, 300) || '' });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) continue;
    totalLines += 1;

    if (line.startsWith('!') || line.startsWith('[')) {
      const category = categoryFromComment(line);
      if (category) currentCategory = category;
      comments += 1;
      continue;
    }
    if (line.startsWith('#') && !splitCosmetic(line)) {
      comments += 1;
      continue;
    }
    if (/^#+\s/.test(line)) {
      comments += 1;
      continue;
    }

    const hosts = unpackHostsLine(line);
    if (hosts) {
      // A recognized hosts line is fully consumed even when every listed
      // hostname is reserved/local, so it never falls through to becoming a
      // bogus literal network pattern.
      if (hosts.length) {
        hostsRules += 1;
        for (let hostIndex = 0; hostIndex < hosts.length; hostIndex += 1) {
          const pattern = normalizePatternForHost(hosts[hostIndex]);
          if (!pattern) continue;
          const parsed = parseNetworkFilter(pattern, {
            listId,
            listName,
            category: currentCategory,
            source,
            line: lineNumber + hostIndex / 100,
          });
          if (parsed.ok) {
            parsed.filter.line = lineNumber;
            parsed.filter.raw = line;
            parsed.filter.id = `${listId}:${lineNumber}:${hostIndex}:${parsed.filter.pattern}`;
            parsed.filter.source = source;
            network.push(parsed.filter);
          } else {
            pushInvalid(lineNumber, parsed.reason, parsed.kind);
          }
        }
      }
      continue;
    }

    if ((format === 'domains' || format === 'hosts') && BARE_DOMAIN.test(line)) {
      domainRules += 1;
      const parsed = parseNetworkFilter(normalizePatternForHost(line), {
        listId,
        listName,
        category: currentCategory,
        source,
        line: lineNumber,
      });
      if (parsed.ok) {
        parsed.filter.raw = line;
        parsed.filter.source = source;
        network.push(parsed.filter);
      } else {
        pushInvalid(lineNumber, parsed.reason, parsed.kind);
      }
      continue;
    }

    const parsed = splitCosmetic(line)
      ? parseCosmeticFilter(line, {
          listId,
          listName,
          category: currentCategory,
          source,
          line: lineNumber,
        })
      : parseNetworkFilter(line, {
          listId,
          listName,
          category: currentCategory,
          source,
          line: lineNumber,
        });

    if (!parsed.ok) {
      pushInvalid(lineNumber, parsed.reason, parsed.kind);
      continue;
    }
    if (parsed.kind === 'network') {
      if (parsed.filter.badfilter) {
        badfilters.add(badfilterKey(parsed.filter.raw));
        continue;
      }
      parsed.filter.source = source;
      network.push(parsed.filter);
    } else if (parsed.kind === 'cosmetic') {
      cosmetic.push(parsed.filter);
    }
  }

  const seenNetwork = new Set();
  const seenCosmetic = new Set();
  let duplicates = 0;
  let badfiltered = 0;
  const finalNetwork = [];
  for (const filter of network) {
    if (badfilters.has(badfilterKey(filter.raw))) {
      badfiltered += 1;
      continue;
    }
    const key = networkKey(filter);
    if (seenNetwork.has(key)) {
      duplicates += 1;
      continue;
    }
    seenNetwork.add(key);
    finalNetwork.push(filter);
  }
  const finalCosmetic = [];
  for (const filter of cosmetic) {
    const key = cosmeticKey(filter);
    if (seenCosmetic.has(key)) {
      duplicates += 1;
      continue;
    }
    seenCosmetic.add(key);
    finalCosmetic.push(filter);
  }

  return {
    ok: true,
    format,
    network: finalNetwork,
    cosmetic: finalCosmetic,
    invalid,
    unsupported,
    stats: {
      totalLines,
      network: finalNetwork.length,
      cosmetic: finalCosmetic.length,
      genericCosmetic: finalCosmetic.filter((filter) => filter.generic).length,
      specificCosmetic: finalCosmetic.filter((filter) => !filter.generic).length,
      comments,
      invalid: invalidCount,
      unsupported: unsupportedCount,
      duplicates,
      badfiltered,
      hostsRules,
      domainRules,
      format,
    },
  };
}

export function emptyStats() {
  return {
    totalLines: 0,
    network: 0,
    cosmetic: 0,
    genericCosmetic: 0,
    specificCosmetic: 0,
    comments: 0,
    invalid: 0,
    unsupported: 0,
    duplicates: 0,
    badfiltered: 0,
    hostsRules: 0,
    domainRules: 0,
    format: 'easylist',
  };
}

/** Returns true when a cosmetic filter applies to a hostname. */
export function cosmeticApplies(filter, hostname) {
  if (!filter) return false;
  if (filter.excludeDomains?.some((domain) => domainMatches(hostname, domain))) return false;
  if (!filter.includeDomains?.length) return true;
  return filter.includeDomains.some((domain) => domainMatches(hostname, domain));
}

export function describeCategory(category) {
  return CATEGORIES[category] || CATEGORIES.other;
}

export function ruleHostname(raw) {
  const text = String(raw || '');
  if (text.startsWith('||')) return normalizeHostname(text.slice(2).split(/[\^/*|$]/)[0]);
  return hostnameFromUrl(text);
}

export { TYPE_ALIASES };
