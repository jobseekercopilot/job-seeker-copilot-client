import {
  PaymentAuthenticationError,
  PaymentProxyConfigurationError,
  callTrustedPaymentGateway,
  paymentProxyFailure,
} from './payment-proxy';

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
    body: {pricingPlanId: 'starter'},
    fetchImplementation,
    method: 'POST' as const,
    path: '/api/v1/payment/checkout',
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
    expect(paymentUrl).toBe('https://payment.example.test/api/v1/payment/checkout');
    expect(paymentInit.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Payment-Owner': 'session-owner-123',
      'X-Service-Token': SERVICE_TOKEN,
    });
    expect(paymentInit.headers['Authorization']).toBeUndefined();
    expect(paymentInit.headers['X-User-Id']).toBeUndefined();
    expect(paymentInit.body).toBe('{"pricingPlanId":"starter"}');
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
