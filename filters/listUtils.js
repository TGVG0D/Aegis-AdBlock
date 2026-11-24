import { LIMITS } from '../engine/constants.js';
import { validateListUrl } from '../utils/urls.js';

/** Fast, deterministic hash for cache keys (not a cryptographic hash). */
export function hashText(text) {
  const value = String(text ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}-${value.length.toString(16)}`;
}

export function sanitizeListText(text) {
  const value = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > LIMITS.maxListBytes) {
    return { ok: false, error: `Lista maior que o limite de ${LIMITS.maxListBytes / 1024 / 1024} MB.` };
  }
  return { ok: true, text: value, size: bytes.length };
}

export function listIsDue(list, settings, now = Date.now()) {
  if (!settings?.autoUpdate || !settings?.updateIntervalHours) return false;
  if (list.sourceType !== 'url' || !list.url) return false;
  const interval = settings.updateIntervalHours * 60 * 60 * 1000;
  if (!list.lastChecked) return true;
  return now - list.lastChecked >= interval;
}

export function summarizeParsed(parsed) {
  return {
    ruleCount: parsed.stats.network + parsed.stats.cosmetic,
    networkCount: parsed.stats.network,
    cosmeticCount: parsed.stats.cosmetic,
    invalidCount: parsed.stats.invalid,
    unsupportedCount: parsed.stats.unsupported,
    format: parsed.format,
    genericCosmetic: parsed.stats.genericCosmetic,
    specificCosmetic: parsed.stats.specificCosmetic,
    duplicates: parsed.stats.duplicates,
    badfiltered: parsed.stats.badfiltered,
  };
}

/**
 * Fetch a list with conditional headers and hard size/time limits.
 * Returns 304 information without touching the previous valid content.
 */
export async function fetchListText(url, options = {}) {
  const validated = validateListUrl(url);
  if (!validated.valid) throw new Error(validated.error);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || LIMITS.fetchTimeoutMs);
  const headers = {
    Accept: 'text/plain, text/*;q=0.9, */*;q=0.5',
    'Accept-Encoding': 'identity',
  };
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  try {
    const response = await fetch(validated.url, {
      method: 'GET',
      headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (response.status === 304) {
      return {
        notModified: true,
        etag: response.headers.get('etag') || options.etag || '',
        lastModified: response.headers.get('last-modified') || options.lastModified || '',
        finalUrl: response.url || validated.url,
        status: 304,
      };
    }
    if (!response.ok) {
      throw new Error(`Servidor respondeu HTTP ${response.status}.`);
    }

    const finalCheck = validateListUrl(response.url || validated.url);
    if (!finalCheck.valid) {
      throw new Error(`Redirecionamento inválido: ${finalCheck.error}`);
    }

    const contentLength = Number(response.headers.get('content-length')) || 0;
    if (contentLength > LIMITS.maxListBytes) {
      throw new Error(`Lista maior que o limite de ${LIMITS.maxListBytes / 1024 / 1024} MB.`);
    }

    let text = '';
    let size = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const chunks = [];
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) {
          size += chunk.value.byteLength;
          if (size > LIMITS.maxListBytes) {
            await reader.cancel();
            throw new Error(`Lista maior que o limite de ${LIMITS.maxListBytes / 1024 / 1024} MB.`);
          }
          chunks.push(decoder.decode(chunk.value, { stream: !done }));
        }
      }
      text = chunks.join('');
      text += decoder.decode();
    } else {
      text = await response.text();
      size = new TextEncoder().encode(text).length;
      if (size > LIMITS.maxListBytes) {
        throw new Error(`Lista maior que o limite de ${LIMITS.maxListBytes / 1024 / 1024} MB.`);
      }
    }

    return {
      notModified: false,
      text: text.replace(/^\uFEFF/, ''),
      size,
      etag: response.headers.get('etag') || '',
      lastModified: response.headers.get('last-modified') || '',
      finalUrl: response.url || validated.url,
      contentType: response.headers.get('content-type') || '',
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatListSource(list) {
  if (list.sourceType === 'bundled') return 'Incluída na extensão';
  if (list.sourceType === 'file') return 'Arquivo local';
  return list.url || 'URL não informada';
}
