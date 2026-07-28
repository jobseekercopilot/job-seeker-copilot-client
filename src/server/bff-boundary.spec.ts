import express from 'express';
import type { Server } from 'node:http';
import {
  DownstreamTimeoutError,
  downstreamFailureCategory,
  downstreamFailureResponse,
  fetchWithTimeout,
  jsonBodyErrorHandler,
  loadBffConfig,
  securityHeaders,
} from './bff-boundary';

describe('BFF runtime configuration', () => {
  it('loads safe bounded defaults', () => {
    expect(loadBffConfig({})).toEqual({
      userManagementGatewayOrigin: 'http://localhost:8083',
      jobFinderGatewayOrigin: 'http://localhost:8080',
      reportingGatewayOrigin: 'http://localhost:8095',
      sessionAccessCookieName: 'jsc-access-local',
      sessionCsrfCookieName: 'jsc-csrf-local',
      allowedHosts: ['localhost', '127.0.0.1', 'job-seeker-copilot-client'],
      host: '0.0.0.0',
      port: 3000,
      jsonBodyLimitBytes: 65_536,
      downstreamTimeoutMs: 5_000,
      requestTimeoutMs: 15_000,
      headersTimeoutMs: 10_000,
      keepAliveTimeoutMs: 5_000,
    });
  });

  it('normalises an explicit origin and de-duplicates allowed hosts', () => {
    const config = loadBffConfig({
      USER_MANAGEMENT_GATEWAY_URL: 'https://gateway.example.test:8443',
      JOB_FINDER_GATEWAY_URL: 'https://jobs.example.test:9443',
      REPORTING_GATEWAY_URL: 'https://reports.example.test:9555',
      BFF_SESSION_COOKIE_PROFILE: 'production',
      NG_ALLOWED_HOSTS: 'client.example.test, client.example.test,::1',
      HOST: '::',
      PORT: '8443',
      BFF_JSON_BODY_LIMIT_BYTES: '2048',
      BFF_DOWNSTREAM_TIMEOUT_MS: '2000',
      BFF_REQUEST_TIMEOUT_MS: '12000',
      BFF_HEADERS_TIMEOUT_MS: '9000',
      BFF_KEEP_ALIVE_TIMEOUT_MS: '3000',
    });

    expect(config.userManagementGatewayOrigin).toBe('https://gateway.example.test:8443');
    expect(config.jobFinderGatewayOrigin).toBe('https://jobs.example.test:9443');
    expect(config.reportingGatewayOrigin).toBe('https://reports.example.test:9555');
    expect(config.sessionAccessCookieName).toBe('__Host-jsc-access');
    expect(config.sessionCsrfCookieName).toBe('__Host-jsc-csrf');
    expect(config.allowedHosts).toEqual(['client.example.test', '::1']);
    expect(config.port).toBe(8443);
  });

  it.each([
    [{USER_MANAGEMENT_GATEWAY_URL: 'not a URL'}, 'USER_MANAGEMENT_GATEWAY_URL'],
    [{USER_MANAGEMENT_GATEWAY_URL: 'ftp://gateway.test'}, 'USER_MANAGEMENT_GATEWAY_URL'],
    [{USER_MANAGEMENT_GATEWAY_URL: 'https://user:secret@gateway.test'}, 'USER_MANAGEMENT_GATEWAY_URL'],
    [{USER_MANAGEMENT_GATEWAY_URL: 'https://gateway.test/api'}, 'USER_MANAGEMENT_GATEWAY_URL'],
    [{USER_MANAGEMENT_GATEWAY_URL: 'https://gateway.test?debug=true'}, 'USER_MANAGEMENT_GATEWAY_URL'],
    [{USER_MANAGEMENT_GATEWAY_URL: 'https://gateway.test#'}, 'USER_MANAGEMENT_GATEWAY_URL'],
    [{JOB_FINDER_GATEWAY_URL: 'https://jobs.test/api'}, 'JOB_FINDER_GATEWAY_URL'],
    [{JOB_FINDER_GATEWAY_URL: 'https://user:secret@jobs.test'}, 'JOB_FINDER_GATEWAY_URL'],
    [{REPORTING_GATEWAY_URL: 'https://reports.test/api'}, 'REPORTING_GATEWAY_URL'],
    [{BFF_SESSION_COOKIE_PROFILE: 'preview'}, 'BFF_SESSION_COOKIE_PROFILE'],
    [{NG_ALLOWED_HOSTS: '*'}, 'NG_ALLOWED_HOSTS'],
    [{NG_ALLOWED_HOSTS: 'valid.test,bad host'}, 'NG_ALLOWED_HOSTS'],
    [{HOST: 'https://client.test'}, 'HOST'],
    [{PORT: '0'}, 'PORT'],
    [{PORT: '65536'}, 'PORT'],
    [{BFF_JSON_BODY_LIMIT_BYTES: '-1'}, 'BFF_JSON_BODY_LIMIT_BYTES'],
    [{BFF_DOWNSTREAM_TIMEOUT_MS: '60001'}, 'BFF_DOWNSTREAM_TIMEOUT_MS'],
    [{BFF_HEADERS_TIMEOUT_MS: '16000'}, 'BFF_HEADERS_TIMEOUT_MS'],
  ])('rejects invalid runtime configuration without echoing values', (environment, setting) => {
    expect(() => loadBffConfig(environment)).toThrow(setting);
  });
});

describe('BFF HTTP boundary', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  });

  async function startApp(): Promise<string> {
    const app = express();
    app.disable('x-powered-by');
    app.use(securityHeaders);
    app.use(express.json({limit: 32}));
    app.use(jsonBodyErrorHandler);
    app.post('/echo', (request, response) => response.json(request.body));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    return `http://127.0.0.1:${address.port}`;
  }

  it('adds a restrictive baseline header policy to valid API responses', async () => {
    const origin = await startApp();
    const response = await fetch(`${origin}/echo`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{"ok":true}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain("base-uri 'self'");
    expect(response.headers.get('content-security-policy')).toContain('https://fonts.googleapis.com');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toContain('payment=()');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('returns a stable non-leaking response for oversized JSON', async () => {
    const origin = await startApp();
    const response = await fetch(`${origin}/echo`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret: 'sensitive-value-that-must-not-be-echoed'}),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'REQUEST_TOO_LARGE',
      message: 'Request body exceeds the allowed size',
    });
  });

  it('returns a stable non-leaking response for malformed JSON', async () => {
    const origin = await startApp();
    const response = await fetch(`${origin}/echo`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{"password":"not-closed"',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error: 'INVALID_JSON', message: 'Request body must contain valid JSON'});
  });
});

describe('bounded downstream requests', () => {
  it('aborts a hanging request and exposes only a stable timeout category', async () => {
    let capturedSignal: AbortSignal | undefined;
    const hangingFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => reject(new DOMException('internal URL detail', 'AbortError')));
      });
    }) as typeof fetch;

    await expect(fetchWithTimeout('https://internal.example.test/private', {}, 5, hangingFetch))
      .rejects.toBeInstanceOf(DownstreamTimeoutError);
    expect(capturedSignal?.aborted).toBe(true);
    expect(downstreamFailureCategory(new DownstreamTimeoutError())).toBe('timeout');
  });

  it('classifies non-timeout failures without exposing their message', async () => {
    const failedFetch = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND secret.internal.test');
    }) as typeof fetch;

    await expect(fetchWithTimeout('https://internal.example.test', {}, 50, failedFetch))
      .rejects.toThrow('secret.internal.test');
    expect(downstreamFailureCategory(new Error('secret.internal.test'))).toBe('unavailable');
  });

  it('maps failures to stable responses without raw operational detail', () => {
    expect(downstreamFailureResponse(new DownstreamTimeoutError())).toEqual({
      category: 'timeout',
      message: 'User management service timed out',
      statusCode: 504,
    });
    expect(downstreamFailureResponse(new Error('token=secret; host=private.internal'))).toEqual({
      category: 'unavailable',
      message: 'User management service is currently unavailable',
      statusCode: 503,
    });
  });
});
