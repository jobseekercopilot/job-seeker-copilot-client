const RELEASE_PLACEHOLDER_PATTERNS = [
  /\b(?:todo|tbd|tbc|placeholder|pending)\b/i,
  /\breplace(?:\s+me)?\b/i,
  /\bnot(?:\s+yet)?\s+configured\b/i,
  /\bexample\s+(?:legal\s+entity|business\s+address|address|trading\s+name)\b/i,
  /\b(?:release[- ]provided|release[- ]configured|supplied\s+at\s+release)\b/i,
  /\byour\s+(?:name|address|business)\b/i,
  /\bcoming\s+soon\b/i,
];

export function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isReviewedIdentityValue(value: string, minimumLength: number): boolean {
  const normalized = value.trim();
  return normalized.length >= minimumLength
    && !RELEASE_PLACEHOLDER_PATTERNS.some(pattern => pattern.test(normalized));
}
