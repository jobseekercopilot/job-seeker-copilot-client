const MAX_EXTERNAL_URL_LENGTH = 2_048;
const MAX_JSON_DEPTH = 32;
const PROVIDER_LINK_FIELDS = new Set([
  'applyUrl',
  'attributionSourceUrl',
  'licenceUrl',
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
