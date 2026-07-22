const CSRF_HEADER = 'x-csrf-token';

type BrowserHeaders = Record<string, string | string[] | undefined>;

export function userManagementHeaders(
  browserHeaders: BrowserHeaders,
  includeJsonBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (includeJsonBody) headers['Content-Type'] = 'application/json';

  const cookie = browserHeaders['cookie'];
  if (typeof cookie === 'string' && cookie.trim()) headers['Cookie'] = cookie;

  const csrf = browserHeaders[CSRF_HEADER];
  if (typeof csrf === 'string' && csrf.trim()) headers['X-CSRF-Token'] = csrf;

  return headers;
}

export function upstreamSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & {getSetCookie?: () => string[]}).getSetCookie;
  if (getSetCookie) return getSetCookie.call(headers).filter(Boolean);

  const singleValue = headers.get('set-cookie');
  return singleValue ? [singleValue] : [];
}
