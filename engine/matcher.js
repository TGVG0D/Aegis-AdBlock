import { ALL_RESOURCE_TYPES, LIMITS } from './constants.js';
import { cosmeticApplies, extractToken } from './parser.js';
import {
  domainMatches,
  hostnameFromUrl,
  hostnameSuffixes,
  isThirdParty,
} from '../utils/urls.js';

const DEFAULT_TYPES = new Set(ALL_RESOURCE_TYPES);

/**
 * Token-indexed filter engine.
 * - Network rules are indexed by a literal token to avoid scanning large lists.
 * - Cosmetic rules are indexed by their domain restrictions.
 */
export class FilterEngine {
  constructor({ network = [], cosmetic = [], disabledCategories = [], genericCosmetic = true, maxGenericCosmetic } = {}) {
    this.network = network;
    this.cosmetic = cosmetic;
    this.disabledCategories = new Set(disabledCategories || []);
    this.genericCosmetic = genericCosmetic !== false;
    this.maxGenericCosmetic = maxGenericCosmetic || LIMITS.maxGenericCosmetic;
    this.regexes = new Array(network.length);
    this.invalidRegex = 0;
    this.tokenIndex = new Map();
    this.fallbackIndex = [];
    this.candidateBuffer = [];
    this.candidateSet = new Set();

    this.buildNetworkIndex();
    this.buildCosmeticIndex();
  }

  buildNetworkIndex() {
    for (let index = 0; index < this.network.length; index += 1) {
      const filter = this.network[index];
      try {
        this.regexes[index] = filter.isRegex
          ? new RegExp(filter.regexSource, filter.matchCase ? '' : 'i')
          : new RegExp(filter.regexSource || '', filter.matchCase ? '' : 'i');
      } catch {
        this.regexes[index] = null;
        this.invalidRegex += 1;
        continue;
      }
      const token = filter.isRegex ? '' : filter.token || extractToken(filter.pattern);
      if (token && token.length >= 4) {
        let bucket = this.tokenIndex.get(token);
        if (!bucket) {
          bucket = [];
          this.tokenIndex.set(token, bucket);
        }
        bucket.push(index);
      } else {
        this.fallbackIndex.push(index);
      }
    }
  }

  buildCosmeticIndex() {
    this.cosmeticGeneric = [];
    this.cosmeticByDomain = new Map();
    this.cosmeticCounts = { generic: 0, specific: 0, byCategory: {} };
    for (const filter of this.cosmetic) {
      this.cosmeticCounts.byCategory[filter.category] =
        (this.cosmeticCounts.byCategory[filter.category] || 0) + 1;
      if (filter.generic) {
        this.cosmeticCounts.generic += 1;
        this.cosmeticGeneric.push(filter);
      } else {
        this.cosmeticCounts.specific += 1;
        for (const domain of filter.includeDomains) {
          let bucket = this.cosmeticByDomain.get(domain);
          if (!bucket) {
            bucket = [];
            this.cosmeticByDomain.set(domain, bucket);
          }
          bucket.push(filter);
        }
      }
    }
  }

  isCategoryDisabled(category) {
    return this.disabledCategories.has(category);
  }

  /** Returns matching filter indexes for a URL using the token index. */
  candidateIndexes(url, hostname) {
    const buffer = this.candidateBuffer;
    const seen = this.candidateSet;
    buffer.length = 0;
    seen.clear();
    for (const index of this.fallbackIndex) {
      buffer.push(index);
      seen.add(index);
    }
    const text = `${hostname || ''} ${url || ''}`.toLowerCase();
    const tokens = text.split(/[^a-z0-9]+/);
    for (const token of tokens) {
      if (token.length < 3) continue;
      const bucket = this.tokenIndex.get(token);
      if (!bucket) continue;
      for (const index of bucket) {
        if (!seen.has(index)) {
          seen.add(index);
          buffer.push(index);
        }
      }
    }
    return buffer;
  }

  /**
   * Match a request.
   * request: { url, type, initiator, hostname, tabId }
   */
  match(request = {}) {
    const url = String(request.url || '');
    if (!url) return { blocked: false, reason: 'missing-url' };
    const requestHostname = request.hostname || hostnameFromUrl(url);
    const initiatorHostname =
      request.initiator || (request.type === 'document' ? requestHostname : '') || '';
    const type = request.type || 'other';
    let thirdPartyCache;
    const thirdParty = () => {
      if (thirdPartyCache === undefined) {
        thirdPartyCache = isThirdParty(requestHostname, initiatorHostname);
      }
      return thirdPartyCache;
    };

    const candidates = this.candidateIndexes(url, requestHostname);
    let block = null;
    let allow = null;
    let importantBlock = null;
    let importantAllow = null;

    for (const index of candidates) {
      const filter = this.network[index];
      if (!filter) continue;
      const regex = this.regexes[index];
      if (!regex) continue;

      if (!filter.types.includes(type)) continue;
      if (!filter.exception && this.isCategoryDisabled(filter.category)) continue;

      if (filter.excludeDomains.length || filter.includeDomains.length) {
        const domainHost = initiatorHostname || requestHostname;
        if (
          filter.excludeDomains.length &&
          filter.excludeDomains.some((domain) => domainMatches(domainHost, domain))
        ) {
          continue;
        }
        if (
          filter.includeDomains.length &&
          !filter.includeDomains.some((domain) => domainMatches(domainHost, domain))
        ) {
          continue;
        }
      }

      if (filter.thirdParty !== null && filter.thirdParty !== thirdParty()) continue;
      if (!regex.test(url)) continue;

      if (filter.exception) {
        if (filter.important) importantAllow = filter;
        else allow = filter;
      } else if (filter.important) {
        importantBlock = filter;
      } else if (!block) {
        block = filter;
      }
    }

    if (importantAllow) {
      return { blocked: false, exceptionFilter: importantAllow, filter: importantAllow, reason: 'important-exception' };
    }
    if (importantBlock) {
      return { blocked: true, filter: importantBlock, reason: 'important' };
    }
    if (allow) {
      return { blocked: false, exceptionFilter: allow, filter: allow, reason: 'exception' };
    }
    if (block) {
      return { blocked: true, filter: block, reason: 'block' };
    }
    return { blocked: false, reason: 'no-match' };
  }

  /**
   * Return hide selectors and exceptions applicable to a hostname.
   * The content script only ever receives selectors, never list text.
   */
  getCosmeticRules(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return { hide: [], exceptions: [], applied: 0, generic: 0, specific: 0 };

    const collected = [];
    const seen = new Set();
    const push = (filter) => {
      if (!filter || seen.has(filter.id)) return;
      seen.add(filter.id);
      collected.push(filter);
    };

    if (this.genericCosmetic) {
      let genericHides = 0;
      for (const filter of this.cosmeticGeneric) {
        if (!filter.exception) {
          if (genericHides >= this.maxGenericCosmetic) continue;
          genericHides += 1;
        }
        if (!cosmeticApplies(filter, host)) continue;
        push(filter);
      }
    }

    for (const suffix of hostnameSuffixes(host)) {
      const bucket = this.cosmeticByDomain.get(suffix);
      if (!bucket) continue;
      for (const filter of bucket) {
        if (!cosmeticApplies(filter, host)) continue;
        push(filter);
      }
    }

    const exceptions = new Set();
    const hides = [];
    const hideSeen = new Set();
    let generic = 0;
    let specific = 0;
    for (const filter of collected) {
      if (this.isCategoryDisabled(filter.category)) continue;
      if (filter.exception) {
        exceptions.add(filter.selector);
        continue;
      }
      if (hideSeen.has(filter.selector)) continue;
      hideSeen.add(filter.selector);
      hides.push(filter.selector);
      if (filter.generic) generic += 1;
      else specific += 1;
    }

    const finalHides = exceptions.size ? hides.filter((selector) => !exceptions.has(selector)) : hides;
    return {
      hide: finalHides,
      exceptions: [...exceptions],
      applied: finalHides.length,
      generic,
      specific,
      totalCandidates: collected.length,
    };
  }

  /** Test an individual URL against the engine (used by dashboard rule tester). */
  test({ url, initiator, type = 'script' }) {
    const result = this.match({
      url,
      initiator,
      hostname: hostnameFromUrl(url),
      type,
    });
    return {
      blocked: result.blocked,
      reason: result.reason,
      rule: result.filter
        ? {
            raw: result.filter.raw,
            listName: result.filter.listName,
            listId: result.filter.listId,
            category: result.filter.category,
            exception: Boolean(result.filter.exception),
            important: Boolean(result.filter.important),
            types: result.filter.types,
          }
        : null,
    };
  }

  getStats() {
    return {
      networkRules: this.network.length,
      cosmeticRules: this.cosmetic.length,
      indexedTokens: this.tokenIndex.size,
      fallbackRules: this.fallbackIndex.length,
      invalidRegex: this.invalidRegex,
      cosmeticGeneric: this.cosmeticCounts?.generic || 0,
      cosmeticSpecific: this.cosmeticCounts?.specific || 0,
      cosmeticsByCategory: this.cosmeticCounts?.byCategory || {},
      disabledCategories: [...this.disabledCategories],
    };
  }

  getNetworkFilters() {
    return this.network;
  }

  getCosmeticFilters() {
    return this.cosmetic;
  }
}

export function createEmptyEngine(options = {}) {
  return new FilterEngine(options);
}

export { DEFAULT_TYPES };
