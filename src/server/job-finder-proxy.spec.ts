import express from 'express';
import type {Server} from 'node:http';
import {
  UNAVAILABLE_API_PREFIXES,
  rejectUnavailableCapability,
} from './unavailable-capabilities';
import {
  jobFinderCredentials,
  type JobFinderProxyConfig,
  registerJobFinderRoutes,
} from './job-finder-proxy';

const ACCESS_TOKEN = 'a.a.a';
const OTHER_ACCESS_TOKEN = 'b.b.b';
const CSRF_TOKEN = 'csrf-token-123';
const SAVED_JOB_ID = '3b0f6a57-389d-4e20-a007-199afca04b20';

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const LOCAL_CONFIG: JobFinderProxyConfig = {
  accessCookieName: 'jsc-access-local',
  csrfCookieName: 'jsc-csrf-local',
  origin: 'https://job-finder.example.test',
  timeoutMs: 50,
};

describe('Job Finder session credentials', () => {
  it('creates downstream identity only from the UMG-owned access cookie', () => {
    const result = jobFinderCredentials({
      authorization: 'Bearer browser-controlled',
      'x-user-id': 'another-user',
      'x-forwarded-user': 'forged',
      cookie: [
        'unrelated=value',
        `jsc-access-local=${ACCESS_TOKEN}`,
        `jsc-csrf-local=${CSRF_TOKEN}`,
      ].join('; '),
      'x-csrf-token': CSRF_TOKEN,
    }, LOCAL_CONFIG, true, true);

    expect(result).toEqual({
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  });

  it('uses only the fixed production cookie names when configured', () => {
    const production = {
      ...LOCAL_CONFIG,
      accessCookieName: '__Host-jsc-access',
      csrfCookieName: '__Host-jsc-csrf',
    };
    const result = jobFinderCredentials({
      cookie: [
        `jsc-access-local=${OTHER_ACCESS_TOKEN}`,
        `__Host-jsc-access=${ACCESS_TOKEN}`,
        `__Host-jsc-csrf=${CSRF_TOKEN}`,
      ].join('; '),
      'x-csrf-token': CSRF_TOKEN,
    }, production, true, false);

    expect(result).toEqual({
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });
  });

  it.each([
    ['missing', undefined],
    ['blank', 'jsc-access-local='],
    ['missing equals sign', 'jsc-access-local'],
    ['malformed', 'jsc-access-local=not-a-jwt'],
    [
      'duplicate',
      `jsc-access-local=${ACCESS_TOKEN}; jsc-access-local=${OTHER_ACCESS_TOKEN}`,
    ],
  ])('rejects a %s access cookie without disclosing it', (_case, cookie) => {
    const result = jobFinderCredentials(
      {cookie},
      LOCAL_CONFIG,
      false,
      false,
    );

    expect(result).toEqual({
      error: 'SESSION_REQUIRED',
      message: 'An authenticated browser session is required',
      status: 401,
    });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(OTHER_ACCESS_TOKEN);
  });

  it.each([
    ['missing cookie', `jsc-access-local=${ACCESS_TOKEN}`, CSRF_TOKEN],
    [
      'duplicate cookie',
      [
        `jsc-access-local=${ACCESS_TOKEN}`,
        `jsc-csrf-local=${CSRF_TOKEN}`,
        'jsc-csrf-local=other',
      ].join('; '),
      CSRF_TOKEN,
    ],
    [
      'mismatched header',
      `jsc-access-local=${ACCESS_TOKEN}; jsc-csrf-local=${CSRF_TOKEN}`,
      'different',
    ],
  ])('rejects a %s for a state-changing route', (_case, cookie, header) => {
    expect(jobFinderCredentials({
      cookie,
      'x-csrf-token': header,
    }, LOCAL_CONFIG, true, true)).toEqual({
      error: 'REQUEST_FORBIDDEN',
      message: 'A valid CSRF token is required',
      status: 403,
    });
  });
});

describe('Job Finder route allowlist', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
    vi.restoreAllMocks();
  });

  async function startApp(
    fetchImplementation: typeof fetch,
    config: JobFinderProxyConfig = LOCAL_CONFIG,
  ): Promise<string> {
    const app = express();
    app.use(express.json());
    registerJobFinderRoutes(app, config, fetchImplementation);
    app.use(UNAVAILABLE_API_PREFIXES, rejectUnavailableCapability);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  function sessionHeaders(csrf = true): Record<string, string> {
    return {
      Cookie: [
        `jsc-access-local=${ACCESS_TOKEN}`,
        ...(csrf ? [`jsc-csrf-local=${CSRF_TOKEN}`] : []),
      ].join('; '),
      ...(csrf ? {'X-CSRF-Token': CSRF_TOKEN} : {}),
    };
  }

  it('proxies search with only server-derived identity and non-cacheable output', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      new Response('{"searchStatus":"COMPLETE","jobs":[]}', {
        headers: {
          'Cache-Control': 'public, max-age=3600',
          'Content-Type': 'application/json',
          'Set-Cookie': 'must-not-reach-browser=secret',
        },
        status: 200,
      }));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/jobs/search`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        Authorization: 'Bearer browser-controlled',
        'Content-Type': 'application/json',
        'X-Forwarded-User': 'forged',
        'X-User-Id': 'another-user',
      },
      body: '{"selectedProviders":["FIXTURE"]}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({
      searchStatus: 'COMPLETE',
      jobs: [],
    });
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://job-finder.example.test/api/jobs/search');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(init?.body).toBe('{"selectedProviders":["FIXTURE"]}');
  });

  it('preserves approved links and makes unsafe provider links inert', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({
        jobs: [{
          description: '<img src=x onerror=alert(1)>',
          url: 'https://jobs.example.test/1',
          sourceUrl: 'javascript:alert(1)',
          sources: [{
            applyUrl: 'data:text/html,unsafe',
            listingUrl: 'https://publisher.example.test/1',
          }],
        }],
      }), {
        headers: {'Content-Type': 'application/json'},
        status: 200,
      }));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/jobs/search`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jobs: [{
        description: '<img src=x onerror=alert(1)>',
        url: 'https://jobs.example.test/1',
        sourceUrl: null,
        sources: [{
          applyUrl: null,
          listingUrl: 'https://publisher.example.test/1',
        }],
      }],
    });
  });

  it('fails closed for malformed downstream JSON without echoing it', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      new Response('{"privateSearchText":"not-closed"', {
        headers: {'Content-Type': 'application/json'},
        status: 200,
      }));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/jobs/search`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain('privateSearchText');
    expect(JSON.parse(text)).toEqual({
      error: 'INVALID_DOWNSTREAM_RESPONSE',
      message: 'Job Finder returned an invalid response',
    });
  });

  it('preserves a reviewed saved-job outcome but no other upstream headers', async () => {
    const upstream = vi.fn(async () =>
      new Response(`{"savedJobId":"${SAVED_JOB_ID}"}`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Saved-Job-Outcome': 'CREATED',
          'X-Internal-Trace': 'private',
        },
        status: 201,
      })) as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(`${origin}/api/jobs/saved`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{"canonicalJobId":"canonical-1"}',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('x-saved-job-outcome')).toBe('CREATED');
    expect(response.headers.get('x-internal-trace')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('fails closed if an upstream response reflects the access token', async () => {
    const upstream = vi.fn(async () =>
      new Response(`{"debug":"${ACCESS_TOKEN}"}`, {
        headers: {
          'Content-Type': `application/json; token=${ACCESS_TOKEN}`,
        },
        status: 500,
      })) as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(`${origin}/api/jobs/search`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(JSON.parse(text)).toEqual({
      error: 'INVALID_DOWNSTREAM_RESPONSE',
      message: 'Job Finder returned an invalid response',
    });
  });

  it('normalises bounded paging and permits safe GET without CSRF', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      new Response('{"items":[],"page":2,"size":100}', {
        headers: {'Content-Type': 'application/json'},
        status: 200,
      }));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/jobs/saved?page=2&size=100`, {
      headers: sessionHeaders(false),
    });

    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0][0]).toBe(
      'https://job-finder.example.test/api/jobs/saved?page=2&size=100',
    );
  });

  it.each([
    '/api/jobs/saved?page=-1&size=20',
    '/api/jobs/saved?page=0&size=101',
    '/api/jobs/saved?page=0&page=1',
    '/api/jobs/saved?sort=title',
  ])('rejects invalid list query %s before downstream', async (path) => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(`${origin}${path}`, {
      headers: sessionHeaders(false),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'INVALID_PAGE_REQUEST',
      message: 'Saved-job page parameters are invalid',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('proxies one valid saved-job UUID and lowercases its path', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      new Response(`{"savedJobId":"${SAVED_JOB_ID}"}`, {
        headers: {'Content-Type': 'application/json'},
        status: 200,
      }));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/jobs/saved/${SAVED_JOB_ID.toUpperCase()}`,
      {headers: sessionHeaders(false)},
    );

    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0][0]).toBe(
      `https://job-finder.example.test/api/jobs/saved/${SAVED_JOB_ID}`,
    );
  });

  it('rejects malformed saved-job IDs before downstream', async () => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(`${origin}/api/jobs/saved/not-a-uuid`, {
      headers: sessionHeaders(false),
    });

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('requires CSRF before unsaving a valid UUID', async () => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(
      `${origin}/api/jobs/saved/${SAVED_JOB_ID}`,
      {
        method: 'DELETE',
        headers: sessionHeaders(false),
      },
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('unsaves one valid saved job with CSRF and no request body', async () => {
    const upstream = vi.fn<FetchLike>(async () =>
      new Response(null, {status: 204}));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(
      `${origin}/api/jobs/saved/${SAVED_JOB_ID}`,
      {
        method: 'DELETE',
        headers: sessionHeaders(),
      },
    );

    expect(response.status).toBe(204);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://job-finder.example.test/api/jobs/saved/${SAVED_JOB_ID}`,
    );
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('creates, lists and updates an application using only the cookie session', async () => {
    const upstream = vi.fn<FetchLike>(async (input, init) => {
      const path = new URL(input.toString()).pathname;
      if (init?.method === 'GET') {
        return new Response('[]', {
          headers: {'Content-Type': 'application/json'},
          status: 200,
        });
      }
      return new Response(`{"id":"${SAVED_JOB_ID}","status":"APPLIED"}`, {
        headers: {'Content-Type': 'application/json'},
        status: path.endsWith('/status') ? 200 : 201,
      });
    });
    const origin = await startApp(upstream as typeof fetch);
    const browserPayload = {
      jobId: 'canonical-1',
      canonicalJobId: 'canonical-1',
      provider: 'REED',
      externalJobId: 'reed-1',
      jobTitle: 'Platform Engineer',
      companyName: 'Example Ltd',
      location: 'London',
    };

    const created = await fetch(`${origin}/api/jobs/applications`, {
      method: 'POST',
      headers: {...sessionHeaders(), 'Content-Type': 'application/json'},
      body: JSON.stringify(browserPayload),
    });
    const listed = await fetch(`${origin}/api/jobs/applications`, {
      headers: sessionHeaders(false),
    });
    const updated = await fetch(
      `${origin}/api/jobs/applications/${SAVED_JOB_ID.toUpperCase()}/status`,
      {
        method: 'PATCH',
        headers: {...sessionHeaders(), 'Content-Type': 'application/json'},
        body: '{"status":"INTERVIEW"}',
      },
    );

    expect(created.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([
      'https://job-finder.example.test/api/jobs/applications',
      'https://job-finder.example.test/api/jobs/applications',
      `https://job-finder.example.test/api/jobs/applications/${SAVED_JOB_ID}/status`,
    ]);
    for (const [, init] of upstream.mock.calls) {
      expect(init?.headers).not.toHaveProperty('X-User-Id');
      expect(init?.headers).toHaveProperty(
        'Authorization',
        `Bearer ${ACCESS_TOKEN}`,
      );
    }
    expect(upstream.mock.calls[0][1]?.body).toBe(JSON.stringify(browserPayload));
    expect(upstream.mock.calls[2][1]?.body).toBe('{"status":"INTERVIEW"}');
  });

  it('requires CSRF for application creation and status changes', async () => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const origin = await startApp(upstream);

    const create = await fetch(`${origin}/api/jobs/applications`, {
      method: 'POST',
      headers: {...sessionHeaders(false), 'Content-Type': 'application/json'},
      body: '{}',
    });
    const update = await fetch(
      `${origin}/api/jobs/applications/${SAVED_JOB_ID}/status`,
      {
        method: 'PATCH',
        headers: {...sessionHeaders(false), 'Content-Type': 'application/json'},
        body: '{"status":"INTERVIEW"}',
      },
    );

    expect(create.status).toBe(403);
    expect(update.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a missing browser session before any downstream call', async () => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(`${origin}/api/jobs/saved`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'SESSION_REQUIRED',
      message: 'An authenticated browser session is required',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns a stable timeout without leaking the token or upstream URL', async () => {
    let capturedSignal: AbortSignal | undefined;
    const downstreamResponse = new Response(null, {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
    const downstreamText = vi.spyOn(downstreamResponse, 'text').mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const upstream = vi.fn(async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return downstreamResponse;
    }) as typeof fetch;
    const origin = await startApp(upstream, {...LOCAL_CONFIG, timeoutMs: 5});
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await fetch(`${origin}/api/jobs/search`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const text = await response.text();

    expect(response.status).toBe(504);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain('job-finder.example.test');
    expect(JSON.parse(text)).toEqual({
      error: 'DOWNSTREAM_TIMEOUT',
      message: 'Job Finder service timed out',
    });
    expect(downstreamText).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      'BFF downstream request failed',
      {category: 'timeout', service: 'job-finder'},
    );
  });

  it('maps a network failure to a stable unavailable response', async () => {
    const upstream = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND private.example.test');
    }) as typeof fetch;
    const origin = await startApp(upstream);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await fetch(`${origin}/api/jobs/search`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Job Finder service is currently unavailable',
    });
  });

  it.each([
    ['GET', '/api/jobs/applications/user/another-user'],
    ['POST', `/api/jobs/applications/${SAVED_JOB_ID}/withdraw-generated`],
    ['POST', '/api/v1/document-generation/jobs/job-1/generate'],
  ])('does not expose removed browser-identity %s %s routes', async (method, path) => {
    const upstream = vi.fn() as unknown as typeof fetch;
    const origin = await startApp(upstream);

    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...sessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: ['POST', 'PATCH'].includes(method) ? '{}' : undefined,
    });

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
