import {
  PaymentAuthenticationError,
  PaymentProxyConfigurationError,
  callTrustedPaymentGateway,
  paymentProxyFailure,
  registerPaymentRoutes,
} from './payment-proxy';
import express from 'express';
import type {Server} from 'node:http';

const SERVICE_TOKEN = 'bff-payment-gateway-test-token-000000000001';

function profileResponse(status = 200, body = JSON.stringify({
  success: true,
  user: {id: 'session-owner-123'},
})): Response {
  return new Response(body, {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function options(fetchImplementation: typeof fetch, serviceToken: string | undefined) {
  return {
    browserHeaders: {
      authorization: 'Bearer attacker-selected',
      'x-user-id': 'victim-456',
      cookie: '__Host-jsc-access=opaque-session',
    },
    body: {
      billingCountry: 'GB',
      cancellationRightLossAcknowledged: true,
      immediateSupplyRequested: true,
      pricingPlanId: 'starter',
    },
    fetchImplementation,
    idempotencyKey: 'checkout-attempt-00000001',
    method: 'POST' as const,
    path: '/api/v2/payments/checkout',
    paymentGatewayOrigin: 'https://payment.example.test',
    serviceToken,
    timeoutMs: 100,
    userManagementOrigin: 'https://users.example.test',
  };
}

describe('trusted payment BFF proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives the owner only from the HttpOnly session profile', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(new Response('{"sessionId":"cs_test_123"}', {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }));

    const result = await callTrustedPaymentGateway(options(fetchMock as typeof fetch, SERVICE_TOKEN));

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [profileUrl, profileInit] = fetchMock.mock.calls[0];
    expect(profileUrl).toBe('https://users.example.test/api/auth/profile');
    expect(profileInit.headers).toEqual({
      Accept: 'application/json',
      Cookie: '__Host-jsc-access=opaque-session',
    });
    expect(profileInit.headers['Authorization']).toBeUndefined();
    expect(profileInit.headers['X-User-Id']).toBeUndefined();

    const [paymentUrl, paymentInit] = fetchMock.mock.calls[1];
    expect(paymentUrl).toBe('https://payment.example.test/api/v2/payments/checkout');
    expect(paymentInit.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'checkout-attempt-00000001',
      'X-Payment-Owner': 'session-owner-123',
      'X-Service-Token': SERVICE_TOKEN,
    });
    expect(paymentInit.headers['Authorization']).toBeUndefined();
    expect(paymentInit.headers['X-User-Id']).toBeUndefined();
    expect(JSON.parse(paymentInit.body)).toEqual({
      billingCountry: 'GB',
      cancellationRightLossAcknowledged: true,
      immediateSupplyRequested: true,
      pricingPlanId: 'starter',
    });
  });

  it('maps a stalled Payment response body to the existing timeout contract', async () => {
    let capturedSignal: AbortSignal | undefined;
    const paymentResponse = new Response(null, {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
    const paymentText = vi.spyOn(paymentResponse, 'text').mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(profileResponse())
      .mockImplementationOnce(async (_input, init) => {
        capturedSignal = init?.signal ?? undefined;
        return paymentResponse;
      });
    const requestOptions = options(fetchMock as typeof fetch, SERVICE_TOKEN);
    requestOptions.timeoutMs = 5;

    const error = await callTrustedPaymentGateway(requestOptions).then(
      () => undefined,
      failure => failure,
    );

    expect(paymentProxyFailure(error)).toEqual({
      status: 504,
      body: {
        error: 'SERVICE_TIMEOUT',
        code: 'SERVICE_TIMEOUT',
        message: 'Payment dependency timed out',
      },
    });
    expect(paymentText).toHaveBeenCalledOnce();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it.each([
    ['missing', ''],
    ['invalid', 'invalid-session'],
    ['expired', 'expired-session'],
    ['forged', 'forged-session'],
  ])('fails closed for a %s browser session without calling Payment Gateway', async (_label, cookie) => {
    const fetchMock = vi.fn().mockResolvedValue(profileResponse(401, '{"success":false}'));
    const requestOptions = options(fetchMock as typeof fetch, SERVICE_TOKEN);
    requestOptions.browserHeaders.cookie = cookie;

    await expect(callTrustedPaymentGateway(requestOptions))
      .rejects.toBeInstanceOf(PaymentAuthenticationError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(paymentProxyFailure(new PaymentAuthenticationError())).toEqual({
      status: 401,
      body: {
        error: 'AUTHENTICATION_REQUIRED',
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Valid browser session required',
      },
    });
  });

  it('rejects malformed profile success without calling Payment Gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(profileResponse(200, JSON.stringify({
      success: true,
      user: {id: 'owner-123,victim-456'},
    })));

    await expect(callTrustedPaymentGateway(options(fetchMock as typeof fetch, SERVICE_TOKEN)))
      .rejects.toBeInstanceOf(PaymentAuthenticationError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([undefined, '', 'short'])(
    'fails closed before any downstream call when the BFF service token is %s',
    async serviceToken => {
      const fetchMock = vi.fn();
      await expect(callTrustedPaymentGateway(options(fetchMock as typeof fetch, serviceToken)))
        .rejects.toBeInstanceOf(PaymentProxyConfigurationError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('payment BFF routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
    vi.restoreAllMocks();
  });

  async function start(fetchImplementation: typeof fetch): Promise<string> {
    const app = express();
    app.use(express.json());
    registerPaymentRoutes(app, {
      accessCookieName: 'jsc-access-local',
      csrfCookieName: 'jsc-csrf-local',
      paymentGatewayOrigin: 'https://payment.example.test',
      serviceToken: SERVICE_TOKEN,
      timeoutMs: 100,
      userManagementOrigin: 'https://users.example.test',
    }, fetchImplementation);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not bind');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it('serves wallet through the session-derived owner boundary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(new Response(
        '{"userId":"session-owner-123","balanceTokens":120000}',
        {status: 200, headers: {'Content-Type': 'application/json'}},
      ));
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v1/payment/wallet`, {
      headers: {Cookie: 'jsc-access-local=session-cookie'},
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      userId: 'session-owner-123',
      balanceTokens: 120000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a payment mutation without matching CSRF before downstream calls', async () => {
    const fetchMock = vi.fn();
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v2/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'jsc-access-local=aaa.bbb.ccc; jsc-csrf-local=csrf-token-123',
        'Idempotency-Key': 'checkout-attempt-00000001',
      },
      body: JSON.stringify({
        pricingPlanId: 'starter',
        billingCountry: 'GB',
        immediateSupplyRequested: true,
        cancellationRightLossAcknowledged: true,
      }),
    });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards one validated payment mutation without browser identity selectors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(new Response('{"sessionId":"fixture-session"}', {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }));
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v2/payments/checkout`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer attacker-selected',
        'Content-Type': 'application/json',
        Cookie: 'jsc-access-local=aaa.bbb.ccc; jsc-csrf-local=csrf-token-123',
        'Idempotency-Key': 'checkout-attempt-00000001',
        'X-CSRF-Token': 'csrf-token-123',
        'X-User-Id': 'victim-456',
      },
      body: JSON.stringify({
        pricingPlanId: 'starter',
        billingCountry: 'GB',
        immediateSupplyRequested: true,
        cancellationRightLossAcknowledged: true,
      }),
    });

    expect(response.status).toBe(200);
    const paymentInit = fetchMock.mock.calls[1][1];
    expect(paymentInit.headers['X-Payment-Owner']).toBe('session-owner-123');
    expect(paymentInit.headers['Idempotency-Key']).toBe('checkout-attempt-00000001');
    expect(paymentInit.headers['Authorization']).toBeUndefined();
    expect(paymentInit.headers['X-User-Id']).toBeUndefined();
    expect(JSON.parse(paymentInit.body)).toEqual({
      pricingPlanId: 'starter',
      billingCountry: 'GB',
      immediateSupplyRequested: true,
      cancellationRightLossAcknowledged: true,
    });
  });

  it('does not expose the legacy browser-controlled checkout mutation', async () => {
    const fetchMock = vi.fn();
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v1/payment/checkout`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{"pricingPlanId":"starter"}',
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects v2 checkout without a bounded idempotency key or GB-only body', async () => {
    const fetchMock = vi.fn();
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v2/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'jsc-access-local=aaa.bbb.ccc; jsc-csrf-local=csrf-token-123',
        'X-CSRF-Token': 'csrf-token-123',
      },
      body: JSON.stringify({
        pricingPlanId: 'starter',
        billingCountry: 'US',
        immediateSupplyRequested: true,
        cancellationRightLossAcknowledged: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects checkout unless both consumer acknowledgements are explicitly true', async () => {
    const fetchMock = vi.fn();
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v2/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'jsc-access-local=aaa.bbb.ccc; jsc-csrf-local=csrf-token-123',
        'Idempotency-Key': 'checkout-attempt-00000001',
        'X-CSRF-Token': 'csrf-token-123',
      },
      body: JSON.stringify({
        pricingPlanId: 'starter',
        billingCountry: 'GB',
        immediateSupplyRequested: true,
        cancellationRightLossAcknowledged: false,
      }),
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only a canonical owner-scoped order status path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(new Response('{"status":"CHECKOUT_OPEN"}', {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }));
    const origin = await start(fetchMock as typeof fetch);
    const orderId = 'c89d9cbb-9dfe-4f7b-9cbf-82ec67cfe9ef';

    const response = await fetch(`${origin}/api/v2/payments/orders/${orderId}/status`, {
      headers: {Cookie: 'jsc-access-local=session-cookie'},
    });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://payment.example.test/api/v2/payments/orders/${orderId}/status`,
    );
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
  });

  it('rejects malformed order status identifiers without a downstream call', async () => {
    const fetchMock = vi.fn();
    const origin = await start(fetchMock as typeof fetch);

    const response = await fetch(`${origin}/api/v2/payments/orders/not-an-order/status`);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
