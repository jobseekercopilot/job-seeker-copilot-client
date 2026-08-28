export function normalisePublicFeedbackApiUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value !== value.trim()) return undefined;
  if (hasAsciiControl(value) || value.includes('?') || value.includes('#')) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    return undefined;
  }
  return url.toString();
}

function hasAsciiControl(value: string): boolean {
  return [...value].some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

export function publicFeedbackConnectOrigin(value: unknown): string | undefined {
  const url = normalisePublicFeedbackApiUrl(value);
  return url ? new URL(url).origin : undefined;
}

export function normalisePublicAppReleaseId(value: unknown): string | undefined {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
    ? value
    : undefined;
}

export function publicFeedbackPagePath(
  location: Pick<Location, 'pathname'>,
): string {
  const pathname = typeof location.pathname === 'string' ? location.pathname : '';
  const safePath = pathname.startsWith('/')
    && !hasAsciiControl(pathname)
    && !pathname.includes('?')
    && !pathname.includes('#')
    && !pathname.includes('//')
    && !pathname.includes('\\')
    ? pathname
    : '/';
  return [...safePath].slice(0, 256).join('');
}
