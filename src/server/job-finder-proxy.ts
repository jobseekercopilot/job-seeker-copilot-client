import type {Express, Request, Response} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {
  downstreamFailureCategory,
  fetchTextWithTimeout,
} from './bff-boundary';
import {sanitiseProviderLinksJson} from '../shared/provider-content-policy';

const ACCESS_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CSRF_TOKEN = /^[A-Za-z0-9._~+/=-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_JOB_ID = /^[A-Za-z0-9._~:+@=-]{1,512}$/;
const JOB_PROVIDERS = new Set(['ADZUNA', 'JSEARCH', 'REED']);
const SAVED_JOB_OUTCOMES = new Set([
  'CREATED',
  'REPLAYED',
  'UPDATED',
  'REACTIVATED',
]);

type BrowserHeaders = Record<string, string | string[] | undefined>;
type JobFinderMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';

export interface JobFinderProxyConfig {
  accessCookieName: string;
  csrfCookieName: string;
  origin: string;
  timeoutMs: number;
}

export interface JobFinderProxyResult {
  body: string;
  contentType: string;
  savedJobOutcome?: string;
  status: number;
}

interface CredentialFailure {
  error: 'REQUEST_FORBIDDEN' | 'SESSION_REQUIRED';
  message: string;
  status: 401 | 403;
}

interface CredentialSuccess {
  headers: Record<string, string>;
}

function cookieValue(
  cookieHeader: string | string[] | undefined,
  name: string,
  pattern: RegExp,
  maximumLength: number,
): string | undefined {
  if (typeof cookieHeader !== 'string') return undefined;

  const values: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      if (trimmed === name) values.push('');
      continue;
    }
    if (trimmed.slice(0, separator) !== name) continue;
    values.push(trimmed.slice(separator + 1));
  }

  if (values.length !== 1) return undefined;
  const [value] = values;
  return value
    && value.length <= maximumLength
    && pattern.test(value)
    ? value
    : undefined;
}

function equalTokens(left: string, right: string): boolean {
  const maximum = Math.max(Buffer.byteLength(left), Buffer.byteLength(right));
  const leftBuffer = Buffer.alloc(maximum);
  const rightBuffer = Buffer.alloc(maximum);
  leftBuffer.write(left);
  rightBuffer.write(right);
  return timingSafeEqual(leftBuffer, rightBuffer)
    && Buffer.byteLength(left) === Buffer.byteLength(right);
}

export function jobFinderCredentials(
  browserHeaders: BrowserHeaders,
  config: JobFinderProxyConfig,
  requiresCsrf: boolean,
  includeJsonBody: boolean,
): CredentialFailure | CredentialSuccess {
  const accessToken = cookieValue(
    browserHeaders['cookie'],
    config.accessCookieName,
    ACCESS_TOKEN,
    8_192,
  );
  if (!accessToken) {
    return {
      error: 'SESSION_REQUIRED',
      message: 'An authenticated browser session is required',
      status: 401,
    };
  }

  if (requiresCsrf) {
    const csrfCookie = cookieValue(
      browserHeaders['cookie'],
      config.csrfCookieName,
      CSRF_TOKEN,
      256,
    );
    const csrfHeader = browserHeaders['x-csrf-token'];
    if (
      !csrfCookie
      || typeof csrfHeader !== 'string'
      || !csrfHeader
      || csrfHeader.length > 256
      || !CSRF_TOKEN.test(csrfHeader)
      || !equalTokens(csrfCookie, csrfHeader)
    ) {
      return {
        error: 'REQUEST_FORBIDDEN',
        message: 'A valid CSRF token is required',
        status: 403,
      };
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  if (includeJsonBody) headers['Content-Type'] = 'application/json';
  return {headers};
}

export async function callJobFinder(
  config: JobFinderProxyConfig,
  path: string,
  method: JobFinderMethod,
  browserHeaders: BrowserHeaders,
  body: unknown,
  requiresCsrf: boolean,
  fetchImplementation: typeof fetch = fetch,
): Promise<CredentialFailure | JobFinderProxyResult> {
  const includeJsonBody = ['PATCH', 'POST'].includes(method) && body !== undefined;
  const credentials = jobFinderCredentials(
    browserHeaders,
    config,
    requiresCsrf,
    includeJsonBody,
  );
  if ('status' in credentials) return credentials;

  const {body: responseBody, response} = await fetchTextWithTimeout(
    `${config.origin}${path}`,
    {
      method,
      headers: credentials.headers,
      body: includeJsonBody ? JSON.stringify(body) : undefined,
    },
    config.timeoutMs,
    fetchImplementation,
  );
  const accessToken = credentials.headers['Authorization'].slice('Bearer '.length);
  if (responseBody.includes(accessToken)) {
    return {
      body: JSON.stringify({
        error: 'INVALID_DOWNSTREAM_RESPONSE',
        message: 'Job Finder returned an invalid response',
      }),
      contentType: 'application/json',
      status: 502,
    };
  }
  const savedJobOutcome = response.headers.get('x-saved-job-outcome');
  const upstreamContentType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  const contentType = upstreamContentType === 'application/json'
    || upstreamContentType === 'application/problem+json'
    ? upstreamContentType
    : 'application/json';
  const sanitisedBody = responseBody && contentType === 'application/json'
    ? sanitiseProviderLinksJson(responseBody)
    : responseBody;
  if (sanitisedBody === null) {
    return {
      body: JSON.stringify({
        error: 'INVALID_DOWNSTREAM_RESPONSE',
        message: 'Job Finder returned an invalid response',
      }),
      contentType: 'application/json',
      status: 502,
    };
  }
  return {
    body: sanitisedBody,
    contentType,
    savedJobOutcome: savedJobOutcome
      && SAVED_JOB_OUTCOMES.has(savedJobOutcome)
      ? savedJobOutcome
      : undefined,
    status: response.status,
  };
}

function sendFailure(
  response: Response,
  status: number,
  error: string,
  message: string,
): void {
  response
    .status(status)
    .setHeader('Cache-Control', 'private, no-store')
    .json({error, message});
}

function pagePath(request: Request): string | undefined {
  const pageValue = request.query['page'];
  const sizeValue = request.query['size'];
  if (
    Object.keys(request.query).some(key => !['page', 'size'].includes(key))
    || Array.isArray(pageValue)
    || Array.isArray(sizeValue)
    || (pageValue !== undefined && typeof pageValue !== 'string')
    || (sizeValue !== undefined && typeof sizeValue !== 'string')
  ) {
    return undefined;
  }

  const page = pageValue ?? '0';
  const size = sizeValue ?? '20';
  if (
    !/^(0|[1-9]\d{0,9})$/.test(page)
    || Number(page) > 2_147_483_647
    || !/^[1-9]\d{0,2}$/.test(size)
    || Number(size) > 100
  ) {
    return undefined;
  }
  return `/api/jobs/saved?page=${page}&size=${size}`;
}

function validSavedJobId(value: string): boolean {
  return UUID.test(value);
}

function providerDetailsPath(
  providerValue: string,
  externalJobId: string,
): string | undefined {
  const provider = providerValue.trim().toUpperCase();
  if (!JOB_PROVIDERS.has(provider) || !PROVIDER_JOB_ID.test(externalJobId)) {
    return undefined;
  }
  return `/api/jobs/provider/${provider}/${encodeURIComponent(externalJobId)}`;
}

export function registerJobFinderRoutes(
  app: Express,
  config: JobFinderProxyConfig,
  fetchImplementation: typeof fetch = fetch,
): void {
  const proxy = async (
    request: Request,
    response: Response,
    path: string,
    method: JobFinderMethod,
    requiresCsrf: boolean,
  ): Promise<void> => {
    try {
      const result = await callJobFinder(
        config,
        path,
        method,
        request.headers,
        request.body,
        requiresCsrf,
        fetchImplementation,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      if ('error' in result) {
        response.status(result.status).json({
          error: result.error,
          message: result.message,
        });
        return;
      }
      if (result.savedJobOutcome) {
        response.setHeader('X-Saved-Job-Outcome', result.savedJobOutcome);
      }
      response.status(result.status).type(result.contentType).send(result.body);
    } catch (error: unknown) {
      const category = downstreamFailureCategory(error);
      const status = category === 'timeout' ? 504 : 503;
      console.error('BFF downstream request failed', {
        category,
        service: 'job-finder',
      });
      sendFailure(
        response,
        status,
        category === 'timeout' ? 'DOWNSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        category === 'timeout'
          ? 'Job Finder service timed out'
          : 'Job Finder service is currently unavailable',
      );
    }
  };

  app.post('/api/jobs/search', async (request, response) => {
    await proxy(request, response, '/api/jobs/search', 'POST', true);
  });
  app.get('/api/jobs/provider/:provider/:externalJobId', async (request, response) => {
    const path = providerDetailsPath(
      request.params['provider'],
      request.params['externalJobId'],
    );
    if (!path) {
      sendFailure(
        response,
        400,
        'INVALID_PROVIDER_JOB_REFERENCE',
        'The provider job reference is invalid',
      );
      return;
    }
    await proxy(request, response, path, 'GET', false);
  });
  app.post('/api/jobs/saved', async (request, response) => {
    await proxy(request, response, '/api/jobs/saved', 'POST', true);
  });
  app.get('/api/jobs/saved', async (request, response) => {
    const path = pagePath(request);
    if (!path) {
      sendFailure(
        response,
        400,
        'INVALID_PAGE_REQUEST',
        'Saved-job page parameters are invalid',
      );
      return;
    }
    await proxy(request, response, path, 'GET', false);
  });
  app.get('/api/jobs/saved/:savedJobId', async (request, response) => {
    if (!validSavedJobId(request.params['savedJobId'])) {
      sendFailure(
        response,
        400,
        'INVALID_SAVED_JOB_ID',
        'The saved job identifier is invalid',
      );
      return;
    }
    await proxy(
      request,
      response,
      `/api/jobs/saved/${request.params['savedJobId'].toLowerCase()}`,
      'GET',
      false,
    );
  });
  app.delete('/api/jobs/saved/:savedJobId', async (request, response) => {
    if (!validSavedJobId(request.params['savedJobId'])) {
      sendFailure(
        response,
        400,
        'INVALID_SAVED_JOB_ID',
        'The saved job identifier is invalid',
      );
      return;
    }
    await proxy(
      request,
      response,
      `/api/jobs/saved/${request.params['savedJobId'].toLowerCase()}`,
      'DELETE',
      true,
    );
  });
  app.post('/api/jobs/applications', async (request, response) => {
    await proxy(
      request,
      response,
      '/api/jobs/applications',
      'POST',
      true,
    );
  });
  app.get('/api/jobs/applications', async (request, response) => {
    await proxy(
      request,
      response,
      '/api/jobs/applications',
      'GET',
      false,
    );
  });
  app.patch('/api/jobs/applications/:applicationId/status', async (request, response) => {
    if (!validSavedJobId(request.params['applicationId'])) {
      sendFailure(
        response,
        400,
        'INVALID_APPLICATION_ID',
        'The application identifier is invalid',
      );
      return;
    }
    await proxy(
      request,
      response,
      `/api/jobs/applications/${request.params['applicationId'].toLowerCase()}/status`,
      'PATCH',
      true,
    );
  });
}
