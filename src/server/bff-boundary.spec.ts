import express from 'express';
import type { Server } from 'node:http';
import {
  DownstreamTimeoutError,
  downstreamFailureCategory,
  downstreamFailureResponse,
  fetchAndConsumeWithTimeout,
  fetchTextWithTimeout,
  jsonBodyErrorHandler,
  loadBffConfig,
  securityHeaders,
} from './bff-boundary';

describe('BFF runtime configuration', () => {
  it('loads safe bounded defaults', () => {
    expect(loadBffConfig({})).toEqual({
      userManagementGatewayOrigin: 'http://localhost:8083',
      jobFinderGatewayOrigin: 'http://localhost:8080',
      paymentGatewayOrigin: 'http://localhost:8098',
      paymentGatewayServiceToken: undefined,
      reportingGatewayOrigin: 'http://localhost:8095',
      publicFeedbackApiUrl: undefined,
      publicAppReleaseId: undefined,
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
      trustedProxyHops: 0,
      passwordResetRateLimitWindowMs: 900_000,
      passwordResetRateLimitMaximum: 5,
    });
  });

  it('normalises an explicit origin and de-duplicates allowed hosts', () => {
    const config = loadBffConfig({
      USER_MANAGEMENT_GATEWAY_URL: 'https://gateway.example.test:8443',
      JOB_FINDER_GATEWAY_URL: 'https://jobs.example.test:9443',
      PAYMENT_GATEWAY_URL: 'https://payments.example.test:9666',
      BFF_TO_PAYMENT_GATEWAY_TOKEN: 'payment-service-token',
      REPORTING_GATEWAY_URL: 'https://reports.example.test:9555',
      PUBLIC_FEEDBACK_API_URL: 'https://feedback.example.test/public/feedback',
      PUBLIC_APP_RELEASE_ID: 'client.2026-08-28.1',
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
    expect(config.paymentGatewayOrigin).toBe('https://payments.example.test:9666');
    expect(config.paymentGatewayServiceToken).toBe('payment-service-token');
    expect(config.reportingGatewayOrigin).toBe('https://reports.example.test:9555');
    expect(config.publicFeedbackApiUrl).toBe('https://feedback.example.test/public/feedback');
    expect(config.publicAppReleaseId).toBe('client.2026-08-28.1');
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
    [{PAYMENT_GATEWAY_URL: 'https://payments.test/api'}, 'PAYMENT_GATEWAY_URL'],
    [{REPORTING_GATEWAY_URL: 'https://reports.test/api'}, 'REPORTING_GATEWAY_URL'],
    [{PUBLIC_FEEDBACK_API_URL: 'http://feedback.test/feedback'}, 'PUBLIC_FEEDBACK_API_URL'],
    [{PUBLIC_FEEDBACK_API_URL: 'https://feedback.test/feedback?token=private'}, 'PUBLIC_FEEDBACK_API_URL'],
    [{PUBLIC_FEEDBACK_API_URL: 'https://user:secret@feedback.test/feedback'}, 'PUBLIC_FEEDBACK_API_URL'],
    [{PUBLIC_FEEDBACK_API_URL: 'https://feedback.test/feedback'}, 'PUBLIC_APP_RELEASE_ID'],
    [{
      PUBLIC_FEEDBACK_API_URL: 'https://feedback.test/feedback',
      PUBLIC_APP_RELEASE_ID: 'release id with spaces',
    }, 'PUBLIC_APP_RELEASE_ID'],
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

  async function startApp(publicFeedbackApiUrl?: string): Promise<string> {
    const app = express();
    app.disable('x-powered-by');
    app.use(securityHeaders(publicFeedbackApiUrl));
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
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).not.toContain('feedback.example.test');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toContain('payment=()');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('adds only the configured feedback origin to connect-src', async () => {
    const origin = await startApp('https://feedback.example.test/public/feedback');
    const response = await fetch(`${origin}/echo`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{"ok":true}',
    });

    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("connect-src 'self' https://feedback.example.test");
    expect(policy).not.toContain('/public/feedback');
  });

  it('rejects an unvalidated feedback URL before constructing a response header', () => {
    expect(() => securityHeaders('https://feedback.test/feedback?secret=value'))
      .toThrow('Feedback CSP origin');
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

    await expect(fetchTextWithTimeout('https://internal.example.test/private', {}, 5, hangingFetch))
      .rejects.toBeInstanceOf(DownstreamTimeoutError);
    expect(capturedSignal?.aborted).toBe(true);
    expect(downstreamFailureCategory(new DownstreamTimeoutError())).toBe('timeout');
  });

  it('enforces the deadline when the transport ignores abort', async () => {
    let capturedSignal: AbortSignal | undefined;
    const abortIgnoringFetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      },
    ) as typeof fetch;

    await expect(
      fetchTextWithTimeout(
        'https://stale-downstream.example.test/private',
        {},
        5,
        abortIgnoringFetch,
      ),
    ).rejects.toBeInstanceOf(DownstreamTimeoutError);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('keeps the same deadline active while consuming response text', async () => {
    let capturedSignal: AbortSignal | undefined;
    const response = new Response(null, {
      headers: {'Content-Type': 'application/json'},
      status: 200,
    });
    const text = vi.spyOn(response, 'text').mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const immediateHeadersFetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return response;
      },
    ) as typeof fetch;

    await expect(
      fetchTextWithTimeout(
        'https://stale-body.example.test/private',
        {},
        5,
        immediateHeadersFetch,
      ),
    ).rejects.toBeInstanceOf(DownstreamTimeoutError);
    expect(text).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('uses one total deadline across both headers and body consumption', async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const response = new Response(null, {status: 200});
      const text = vi.spyOn(response, 'text').mockImplementation(
        () => new Promise<string>(resolve => {
          setTimeout(() => resolve('finished too late'), 30);
        }),
      );
      const stagedFetch = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) => {
          capturedSignal = init?.signal ?? undefined;
          return new Promise<Response>(resolve => {
            setTimeout(() => resolve(response), 30);
          });
        },
      ) as typeof fetch;

      const pending = fetchTextWithTimeout(
        'https://slow-total.example.test/private',
        {},
        50,
        stagedFetch,
      );
      const timeoutAssertion = expect(pending).rejects
        .toBeInstanceOf(DownstreamTimeoutError);

      await vi.advanceTimersByTimeAsync(30);
      expect(text).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(20);
      await timeoutAssertion;
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the same deadline active while consuming a binary response', async () => {
    let capturedSignal: AbortSignal | undefined;
    const response = new Response(null, {
      headers: {'Content-Type': 'application/pdf'},
      status: 200,
    });
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer').mockImplementation(
      () => new Promise<ArrayBuffer>(() => undefined),
    );
    const immediateHeadersFetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return response;
      },
    ) as typeof fetch;

    await expect(
      fetchAndConsumeWithTimeout(
        'https://stale-binary-body.example.test/private',
        {},
        5,
        downstream => downstream.arrayBuffer(),
        immediateHeadersFetch,
      ),
    ).rejects.toBeInstanceOf(DownstreamTimeoutError);
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('clears the deadline after successful body consumption', async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const immediateFetch = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          capturedSignal = init?.signal ?? undefined;
          return new Response('complete', {status: 200});
        },
      ) as typeof fetch;

      await expect(fetchTextWithTimeout(
        'https://healthy-downstream.example.test',
        {},
        50,
        immediateFetch,
      )).resolves.toMatchObject({body: 'complete'});

      await vi.advanceTimersByTimeAsync(100);
      expect(capturedSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('relays caller cancellation even when the transport ignores abort', async () => {
    const caller = new AbortController();
    const cancelledFetch = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as typeof fetch;

    const pending = fetchTextWithTimeout(
      'https://cancelled-downstream.example.test/private',
      {signal: caller.signal},
      50,
      cancelledFetch,
    );
    caller.abort(new DOMException('Caller cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
  });

  it('classifies non-timeout failures without exposing their message', async () => {
    const failedFetch = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND secret.internal.test');
    }) as typeof fetch;

    await expect(fetchTextWithTimeout('https://internal.example.test', {}, 50, failedFetch))
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
