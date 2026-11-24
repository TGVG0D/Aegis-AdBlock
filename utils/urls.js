import { getDomain } from 'tldts';

/** Lowercase, strip a leading wildcard and normalize IDN/IPv6 hostnames. */
export function normalizeHostname(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim().toLowerCase();
  if (!value) return '';

  if (value.startsWith('*.')) value = value.slice(2);
  if (value.startsWith('.')) value = value.slice(1);

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return stripBrackets(url.hostname.toLowerCase());
    } catch {
      return '';
    }
  }

  // A pasted URL without a scheme, e.g. "example.com/path".
  if (value.includes('/') || value.includes('?') || value.includes('#')) {
    try {
      return stripBrackets(new URL(`http://${value}`).hostname.toLowerCase());
    } catch {
      return '';
    }
  }

  // IPv6 literal
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.includes(':')) {
    if (isIPv6(value)) return value;
    return '';
  }

  if (value.endsWith('.')) value = value.slice(0, -1);

  if (!/^[\p{L}\p{N}.-]+$/u.test(value)) {
    try {
      value = new URL(`http://${value}`).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  if (isIPv4(value)) return value;
  if (!isValidAsciiHostname(value)) return '';
  return value;
}

function stripBrackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function isValidAsciiHostname(host) {
  if (!host || host.length > 253) return false;
  if (host.endsWith('.')) host = host.slice(0, -1);
  const labels = host.split('.');
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

export function isIPv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function isIPv6(value) {
  if (!value || !value.includes(':')) return false;
  // URL parser is a reliable IPv6 validator in browsers and Node.
  try {
    const url = new URL(`http://[${value}]/`);
    return url.hostname !== '';
  } catch {
    return false;
  }
}

export function isIpAddress(host) {
  return isIPv4(host) || isIPv6(host);
}

export function isLocalOrPrivateHost(host) {
  if (!host) return true;
  const value = stripBrackets(host.toLowerCase());
  if (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.lan') ||
    value.endsWith('.internal')
  ) {
    return true;
  }
  if (isIPv4(value)) {
    const [a, b] = value.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIPv6(value)) {
    const lower = value.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.')
    );
  }
  return false;
}

/** True when hostname is the domain itself or one of its subdomains. */
export function domainMatches(hostname, domain) {
  if (!hostname || !domain) return false;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function getRegistrableDomain(hostname) {
  if (!hostname) return '';
  if (isIpAddress(hostname)) return hostname;
  try {
    return getDomain(hostname, { allowPrivateDomains: true, detectIp: true }) || hostname;
  } catch {
    return hostname;
  }
}

export function isThirdParty(requestHostname, initiatorHostname) {
  if (!requestHostname || !initiatorHostname) return false;
  const a = getRegistrableDomain(requestHostname);
  const b = getRegistrableDomain(initiatorHostname);
  if (!a || !b) return false;
  return a !== b;
}

export function hostnameFromUrl(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const url = new URL(raw);
    return stripBrackets(url.hostname.toLowerCase());
  } catch {
    return '';
  }
}

export function originFromUrl(raw) {
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

/**
 * Store only what is needed: origin + pathname, never query parameters,
 * fragments or credentials. Optionally reduce to origin only.
 */
export function sanitizeRequestUrl(raw, { storePath = true, maxLength = 500 } = {}) {
  if (typeof raw !== 'string') return { url: '', hostname: '' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: '', hostname: '' };
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    return { url: '', hostname: '' };
  }
  const hostname = stripBrackets(parsed.hostname.toLowerCase());
  let value = storePath ? `${parsed.origin}${parsed.pathname}` : parsed.origin;
  if (value.length > maxLength) value = `${value.slice(0, maxLength)}…`;
  return { url: value, hostname };
}

export function normalizeDomainList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,|\s]+/)
    .map((domain) => normalizeHostname(domain))
    .filter(Boolean);
}

/** Returns all label suffixes, used for cosmetic domain indexing. */
export function hostnameSuffixes(hostname) {
  if (!hostname) return [];
  if (isIpAddress(hostname)) return [hostname];
  const labels = hostname.split('.').filter(Boolean);
  const result = [];
  for (let index = 0; index < labels.length; index += 1) {
    result.push(labels.slice(index).join('.'));
  }
  return result;
}

export function validateListUrl(raw, { allowPrivate = false } = {}) {
  if (typeof raw !== 'string') return { valid: false, error: 'URL inválida.' };
  const value = raw.trim();
  if (!value) return { valid: false, error: 'Informe uma URL.' };
  if (value.length > 2048) return { valid: false, error: 'URL muito longa (máximo 2048 caracteres).' };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, error: 'URL malformada.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, error: 'Apenas URLs HTTP ou HTTPS são permitidas.' };
  }
  if (url.username || url.password) {
    return { valid: false, error: 'URLs com credenciais não são permitidas.' };
  }
  const host = stripBrackets(url.hostname.toLowerCase());
  if (!host || !isValidAsciiHostname(host)) {
    return { valid: false, error: 'Host da URL inválido.' };
  }
  if (!allowPrivate && isLocalOrPrivateHost(host)) {
    return { valid: false, error: 'Endereços locais ou privados não são permitidos.' };
  }
  if (url.pathname === '/' && !url.search) {
    return { valid: false, error: 'A URL deve apontar para um arquivo de lista.' };
  }
  return { valid: true, url: url.toString(), hostname: host, error: null };
}

/** Best-effort check for a filter domain option (no scheme, no port). */
export function normalizeFilterDomain(value) {
  if (!value || value === '*') return '';
  return normalizeHostname(value);
}
