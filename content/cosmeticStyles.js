/**
 * Build the stylesheet injected by the cosmetic content script.
 *
 * Normal mode hides matching elements with `display: none`.
 * Anti-block mode keeps matching elements in the layout at a tiny offscreen
 * size instead. This defeats the common bait-element check (a page creates an
 * element with an ad-like class and flags blockers when it has zero size), while
 * still keeping the element invisible to the user.
 */

const MAX_CHUNK = 400;

const HIDE_DECLARATION = 'display: none !important;';

const STEALTH_DECLARATION = [
  'display: block !important',
  'position: absolute !important',
  'left: 0 !important',
  'top: 0 !important',
  'right: auto !important',
  'bottom: auto !important',
  'width: 2px !important',
  'height: 2px !important',
  'min-width: 0 !important',
  'min-height: 0 !important',
  'max-width: 2px !important',
  'max-height: 2px !important',
  'margin: 0 !important',
  'padding: 0 !important',
  'border: 0 !important',
  'overflow: hidden !important',
  'background: transparent !important',
  'box-shadow: none !important',
  'transform: none !important',
  'opacity: 1 !important',
  'visibility: visible !important',
  'pointer-events: none !important',
  'z-index: -1 !important',
].join('; ');

/** Selectors that hide the document root must never use the stealth layout. */
export function selectorTargetsRoot(selector) {
  const text = String(selector || '').trim();
  if (!text) return false;
  const parts = text.split(/\s*[>+~]\s*|\s+/);
  const subject = parts[parts.length - 1] || '';
  return /^(?:html|body|:root)(?=$|[.#:[(])/.test(subject);
}

function ruleFor(selectors, declaration) {
  const chunks = [];
  for (let index = 0; index < selectors.length; index += MAX_CHUNK) {
    const group = selectors.slice(index, index + MAX_CHUNK);
    chunks.push(`:is(${group.join(',\n')}) { ${declaration} }`);
  }
  return chunks;
}

/**
 * @param {string[]} selectors Selectors already validated against the document.
 * @param {{ antiBlock?: boolean }} options
 */
export function buildCosmeticCss(selectors, { antiBlock = false } = {}) {
  const cleaned = [];
  for (const value of Array.isArray(selectors) ? selectors : []) {
    if (typeof value !== 'string') continue;
    const selector = value.trim();
    if (selector) cleaned.push(selector);
  }

  const hidden = [];
  const stealth = [];
  for (const selector of cleaned) {
    if (antiBlock && !selectorTargetsRoot(selector)) stealth.push(selector);
    else hidden.push(selector);
  }

  return {
    css: [...ruleFor(hidden, HIDE_DECLARATION), ...ruleFor(stealth, STEALTH_DECLARATION)].join('\n'),
    valid: cleaned.length,
    hidden: hidden.length,
    stealth: stealth.length,
  };
}

export { MAX_CHUNK };
