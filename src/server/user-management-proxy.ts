import { fetchWithTimeout } from './bff-boundary';

const CSRF_HEADER = 'x-csrf-token';
const PROFILE_REVISION = /^"?[0-9]+"?$/;

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

  const ifMatch = browserHeaders['if-match'];
  if (typeof ifMatch === 'string' && PROFILE_REVISION.test(ifMatch)) {
    headers['If-Match'] = ifMatch;
  }

  return headers;
}

export function upstreamSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & {getSetCookie?: () => string[]}).getSetCookie;
  if (getSetCookie) return getSetCookie.call(headers).filter(Boolean);

  const singleValue = headers.get('set-cookie');
  return singleValue ? [singleValue] : [];
}

export interface UserManagementProxyResult {
  body: string;
  cacheControl: string;
  contentType: string;
  setCookies: string[];
  status: number;
}

export async function callUserManagement(
  origin: string,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  browserHeaders: BrowserHeaders,
  body: unknown,
  timeoutMs: number,
  fetchImplementation: typeof fetch = fetch,
): Promise<UserManagementProxyResult> {
  const hasBody = method !== 'GET';
  const response = await fetchWithTimeout(`${origin}${path}`, {
    method,
    headers: userManagementHeaders(browserHeaders, hasBody),
    body: hasBody ? JSON.stringify(body ?? {}) : undefined,
  }, timeoutMs, fetchImplementation);

  return {
    body: await response.text(),
    cacheControl: response.headers.get('cache-control') || 'no-store',
    contentType: response.headers.get('content-type') || 'application/json',
    setCookies: upstreamSetCookies(response.headers),
    status: response.status,
  };
}
