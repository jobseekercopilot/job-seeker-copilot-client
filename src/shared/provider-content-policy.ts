const MAX_EXTERNAL_URL_LENGTH = 2_048;
const MAX_JSON_DEPTH = 32;
const MAX_PROVIDER_TEXT_DECODE_PASSES = 3;
const PROVIDER_LINK_FIELDS = new Set([
  'applyUrl',
  'listingUrl',
  'sourceUrl',
  'url',
]);

export function approvedExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_EXTERNAL_URL_LENGTH
    || value !== value.trim()
    || Array.from(value).some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || !parsed.hostname
      || parsed.username
      || parsed.password) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Converts provider-owned advert HTML into readable inert text. The result is
 * rendered through Angular interpolation/textarea values, never as HTML.
 */
export function providerPlainText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';

  let text = value.replace(/\r\n?/g, '\n');
  for (let pass = 0; pass < MAX_PROVIDER_TEXT_DECODE_PASSES; pass++) {
    const previous = text;
    text = text
      .replace(/<\s*(script|style|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '\n• ')
      .replace(/<\s*\/\s*(?:p|div|ul|ol|section|article|header|footer|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp|pound|euro);/gi,
        (_entity, code: string) => decodeHtmlEntity(code));
    if (text === previous) break;
  }

  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitiseProviderLinksJson(body: string): string | null {
  try {
    return JSON.stringify(sanitiseValue(JSON.parse(body), 0));
  } catch {
    return null;
  }
}

export function logMalformedProviderResult(missingFieldCount: number): void {
  console.warn('[JobResults] Skipping malformed job', {
    missingFieldCount: Math.max(0, Math.min(100, Math.trunc(missingFieldCount))),
  });
}

function sanitiseValue(value: unknown, depth: number): unknown {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error('Provider response exceeds the supported JSON depth');
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitiseValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      PROVIDER_LINK_FIELDS.has(key)
        ? approvedExternalUrl(child)
        : sanitiseValue(child, depth + 1),
    ]),
  );
}

function decodeHtmlEntity(code: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    pound: '£',
    euro: '€',
  };
  const normalised = code.toLowerCase();
  if (normalised in named) return named[normalised];
  const numeric = normalised.startsWith('#x')
    ? Number.parseInt(normalised.slice(2), 16)
    : Number.parseInt(normalised.slice(1), 10);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
    ? String.fromCodePoint(numeric)
    : ' ';
}
