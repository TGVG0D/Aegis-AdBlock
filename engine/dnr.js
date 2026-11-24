import {
  DNR_PRIORITIES,
  DNR_TYPE_MAP,
  LIMITS,
  RESOURCE_TYPES,
} from './constants.js';
import { normalizeHostname } from '../utils/urls.js';

const ALL_DNR_TYPES = [...new Set(Object.values(DNR_TYPE_MAP))];

function isDnrRegexCompatible(source) {
  if (!source || source.length > LIMITS.maxRegexLength) return false;
  if (/\\[1-9]/.test(source)) return false;
  if (/\(\?[=!<]/.test(source)) return false;
  if (/\(\?P</.test(source)) return false;
  return true;
}

function dnrTypesForFilter(filter) {
  const mapped = new Set();
  for (const type of filter.types) {
    const value = DNR_TYPE_MAP[type];
    if (value) mapped.add(value);
  }
  if (mapped.size === 0) return null;
  if (mapped.size === ALL_DNR_TYPES.length) return undefined;
  return [...mapped];
}

function validDomainList(domains) {
  const result = [];
  for (const domain of domains || []) {
    const normalized = normalizeHostname(domain);
    if (normalized) result.push(normalized);
  }
  return [...new Set(result)];
}

/**
 * Compile parsed network filters into declarativeNetRequest rules.
 * Pure function, testable in Node.
 */
export function compileDnrRules(filters, options = {}) {
  const {
    whitelist = [],
    disabledCategories = [],
    maxRules = LIMITS.dnrDynamicRules,
    maxRegexRules = LIMITS.dnrRegexRules,
    now = Date.now(),
  } = options;

  const disabled = new Set(disabledCategories || []);
  const rules = [];
  const stats = {
    filters: filters.length,
    compiled: 0,
    skipped: 0,
    skippedReasons: {},
    regexRules: 0,
    deduplicated: 0,
    truncated: 0,
    whitelistRules: 0,
    totalRules: 0,
  };
  const seen = new Set();
  let regexCount = 0;

  const skip = (reason) => {
    stats.skipped += 1;
    stats.skippedReasons[reason] = (stats.skippedReasons[reason] || 0) + 1;
  };

  for (let index = 0; index < filters.length; index += 1) {
    const filter = filters[index];
    if (!filter.exception && disabled.has(filter.category)) {
      skip('category-disabled');
      continue;
    }

    const condition = {};
    if (filter.isRegex) {
      if (regexCount >= maxRegexRules) {
        skip('regex-limit');
        continue;
      }
      if (!isDnrRegexCompatible(filter.regexSource)) {
        skip('regex-unsupported');
        continue;
      }
      condition.regexFilter = filter.regexSource;
      regexCount += 1;
      stats.regexRules += 1;
    } else {
      const pattern = String(filter.pattern || '');
      if (!pattern || pattern === '*' || pattern === '|' || pattern === '||') {
        skip('empty-pattern');
        continue;
      }
      if (pattern.length > LIMITS.dnrUrlFilterLength) {
        skip('pattern-too-long');
        continue;
      }
      condition.urlFilter = pattern;
    }

    if (filter.matchCase) condition.isUrlFilterCaseSensitive = true;

    const includeDomains = validDomainList(filter.includeDomains);
    const excludeDomains = validDomainList(filter.excludeDomains);
    if (filter.includeDomains.length && includeDomains.length === 0) {
      skip('invalid-domain-option');
      continue;
    }
    if (includeDomains.length) condition.initiatorDomains = includeDomains;
    if (excludeDomains.length) condition.excludedInitiatorDomains = excludeDomains;

    const resourceTypes = dnrTypesForFilter(filter);
    if (resourceTypes === null) {
      skip('no-dnr-resource-type');
      continue;
    }
    if (resourceTypes) condition.resourceTypes = resourceTypes;

    if (filter.thirdParty === true) condition.domainType = 'thirdParty';
    else if (filter.thirdParty === false) condition.domainType = 'firstParty';

    const priority = filter.exception
      ? filter.important
        ? DNR_PRIORITIES.importantException
        : DNR_PRIORITIES.exception
      : filter.important
        ? DNR_PRIORITIES.importantBlock
        : DNR_PRIORITIES.block;

    // `@@||site^$document` disables filtering for the whole page in ABP syntax.
    // DNR's allow action would only allow the document request itself, so compile
    // this specific case as allowAllRequests for equivalent behavior.
    const documentException =
      filter.exception &&
      filter.types.length === 1 &&
      filter.types[0] === 'document' &&
      filter.thirdParty === null &&
      !includeDomains.length &&
      !excludeDomains.length;

    const action = {
      type: documentException ? 'allowAllRequests' : filter.exception ? 'allow' : 'block',
    };
    const key = JSON.stringify([priority, action, condition]);
    if (seen.has(key)) {
      stats.deduplicated += 1;
      continue;
    }
    seen.add(key);

    rules.push({
      _index: index,
      priority,
      action,
      condition,
    });
  }

  // Whitelist rules are always kept, even when the compiled filter budget is full.
  const whitelistDomains = new Set();
  for (const entry of whitelist) {
    if (!entry || entry.expiresAt && entry.expiresAt <= now) continue;
    const domain = normalizeHostname(entry.domain);
    if (!domain) continue;
    whitelistDomains.add(domain);
  }
  for (const domain of whitelistDomains) {
    rules.push({
      priority: DNR_PRIORITIES.whitelistDocument,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
      _whitelist: true,
    });
    stats.whitelistRules += 1;
    rules.push({
      priority: DNR_PRIORITIES.whitelist,
      action: { type: 'allow' },
      condition: { initiatorDomains: [domain] },
      _whitelist: true,
    });
    stats.whitelistRules += 1;
    rules.push({
      priority: DNR_PRIORITIES.whitelist,
      action: { type: 'allow' },
      condition: { requestDomains: [domain] },
      _whitelist: true,
    });
    stats.whitelistRules += 1;
  }

  const budget = Math.max(0, maxRules);
  let selected = rules;
  if (rules.length > budget) {
    const whitelistRules = rules.filter((rule) => rule._whitelist);
    const filterRules = rules
      .filter((rule) => !rule._whitelist)
      .sort((a, b) => b.priority - a.priority || a._index - b._index);
    const available = Math.max(0, budget - whitelistRules.length);
    selected = [...whitelistRules, ...filterRules.slice(0, available)];
    stats.truncated = rules.length - selected.length;
  }

  // Stable order: higher priority first, then discovery order.
  selected = selected.sort((a, b) => {
    if (a._whitelist !== b._whitelist) return a._whitelist ? -1 : 1;
    return b.priority - a.priority || (a._index || 0) - (b._index || 0);
  });

  const dnrRules = selected.map((rule, index) => {
    const result = {
      id: index + 1,
      priority: rule.priority,
      action: rule.action,
      condition: rule.condition,
    };
    return result;
  });

  stats.compiled = selected.filter((rule) => !rule._whitelist).length;
  stats.totalRules = dnrRules.length;
  return { rules: dnrRules, stats };
}

export function dnrConditionSummary(condition) {
  const parts = [];
  if (condition.urlFilter) parts.push(`url:${condition.urlFilter}`);
  if (condition.regexFilter) parts.push(`regex:${condition.regexFilter}`);
  if (condition.initiatorDomains?.length) parts.push(`from:${condition.initiatorDomains.join('|')}`);
  if (condition.requestDomains?.length) parts.push(`to:${condition.requestDomains.join('|')}`);
  return parts.join(' ');
}

export { ALL_DNR_TYPES, isDnrRegexCompatible, dnrTypesForFilter };
