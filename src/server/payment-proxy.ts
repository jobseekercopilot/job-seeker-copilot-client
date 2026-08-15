import type {Express, Request, Response} from 'express';
import {DownstreamTimeoutError, fetchTextWithTimeout} from './bff-boundary';
import {jobFinderCredentials} from './job-finder-proxy';
import {callUserManagement} from './user-management-proxy';

type BrowserHeaders = Record<string, string | string[] | undefined>;

const MINIMUM_SERVICE_TOKEN_BYTES = 32;
const MAXIMUM_OWNER_LENGTH = 128;
const MAXIMUM_RESPONSE_BYTES = 1_048_576;
const PRICING_PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PaymentAuthenticationError extends Error {
  constructor() {
    super('Valid browser session required');
    this.name = 'PaymentAuthenticationError';
  }
}

export class PaymentProxyConfigurationError extends Error {
  constructor() {
    super('Payment proxy service identity is unavailable');
    this.name = 'PaymentProxyConfigurationError';
  }
}

export interface PaymentProxyResult {
  body: string;
  contentType: string;
  status: number;
}

export interface PaymentProxyOptions {
  browserHeaders: BrowserHeaders;
  body: unknown;
  fetchImplementation?: typeof fetch;
  idempotencyKey?: string;
  method: 'GET' | 'POST';
  path: string;
  paymentGatewayOrigin: string;
  serviceToken: string | undefined;
  timeoutMs: number;
  userManagementOrigin: string;
}

export interface PaymentRouteConfig {
  accessCookieName: string;
  csrfCookieName: string;
  paymentGatewayOrigin: string;
  serviceToken: string | undefined;
  timeoutMs: number;
  userManagementOrigin: string;
}

interface ProfileResponse {
  success?: boolean;
  user?: {
    id?: unknown;
  };
}

function requireServiceToken(token: string | undefined): string {
  if (
    token === undefined
    || token.trim() === ''
    || new TextEncoder().encode(token).byteLength < MINIMUM_SERVICE_TOKEN_BYTES
  ) {
    throw new PaymentProxyConfigurationError();
  }
  return token;
}

function trustedOwner(profileBody: string): string {
  let profile: ProfileResponse;
  try {
    profile = JSON.parse(profileBody) as ProfileResponse;
  } catch {
    throw new PaymentAuthenticationError();
  }

  const owner = profile.user?.id;
  if (
    profile.success !== true
    || typeof owner !== 'string'
    || owner.trim() === ''
    || owner.trim().length > MAXIMUM_OWNER_LENGTH
    || owner.includes(',')
    || [...owner].some(character => /\p{Cc}/u.test(character))
  ) {
    throw new PaymentAuthenticationError();
  }
  return owner.trim();
}

export async function callTrustedPaymentGateway(
  options: PaymentProxyOptions,
): Promise<PaymentProxyResult> {
  const serviceToken = requireServiceToken(options.serviceToken);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const profile = await callUserManagement(
    options.userManagementOrigin,
    '/api/auth/profile',
    'GET',
    options.browserHeaders,
    undefined,
    options.timeoutMs,
    fetchImplementation,
  );

  if (profile.status === 401) throw new PaymentAuthenticationError();
  if (profile.status !== 200) {
    throw new Error('User Management profile dependency failed');
  }
  const owner = trustedOwner(profile.body);

  const hasBody = options.method === 'POST';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Service-Token': serviceToken,
    'X-Payment-Owner': owner,
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const {body, response} = await fetchTextWithTimeout(
    `${options.paymentGatewayOrigin}${options.path}`,
    {
      method: options.method,
      headers,
      body: hasBody ? JSON.stringify(options.body ?? {}) : undefined,
    },
    options.timeoutMs,
    fetchImplementation,
  );

  const contentType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (
    Buffer.byteLength(body) > MAXIMUM_RESPONSE_BYTES
    || (contentType !== 'application/json'
      && contentType !== 'application/problem+json')
    || body.includes(serviceToken)
  ) {
    return {
      body: JSON.stringify({
        error: 'INVALID_DOWNSTREAM_RESPONSE',
        code: 'INVALID_DOWNSTREAM_RESPONSE',
        message: 'Payment returned an invalid response',
      }),
      contentType: 'application/json',
      status: 502,
    };
  }

  return {
    body,
    contentType,
    status: response.status,
  };
}

export function paymentProxyFailure(error: unknown): {
  body: {error: string; code: string; message: string};
  status: 401 | 503 | 504;
} {
  if (error instanceof PaymentAuthenticationError) {
    return {
      status: 401,
      body: {
        error: 'AUTHENTICATION_REQUIRED',
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Valid browser session required',
      },
    };
  }
  if (error instanceof DownstreamTimeoutError) {
    return {
      status: 504,
      body: {
        error: 'SERVICE_TIMEOUT',
        code: 'SERVICE_TIMEOUT',
        message: 'Payment dependency timed out',
      },
    };
  }
  return {
    status: 503,
    body: {
      error: 'SERVICE_UNAVAILABLE',
      code: 'SERVICE_UNAVAILABLE',
      message: 'Payment service is currently unavailable',
    },
  };
}

function failure(
  response: Response,
  status: number,
  error: string,
  message: string,
): void {
  response
    .status(status)
    .setHeader('Cache-Control', 'private, no-store')
    .json({error, code: error, message});
}

function checkoutBody(value: unknown): {
  billingCountry: 'GB';
  cancellationRightLossAcknowledged: true;
  immediateSupplyRequested: true;
  pricingPlanId: string;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pricingPlanId = record['pricingPlanId'];
  return keys.length === 4
    && keys[0] === 'billingCountry'
    && keys[1] === 'cancellationRightLossAcknowledged'
    && keys[2] === 'immediateSupplyRequested'
    && keys[3] === 'pricingPlanId'
    && typeof pricingPlanId === 'string'
    && PRICING_PLAN_ID.test(pricingPlanId)
    && record['billingCountry'] === 'GB'
    && record['cancellationRightLossAcknowledged'] === true
    && record['immediateSupplyRequested'] === true
    ? {
      pricingPlanId,
      billingCountry: 'GB',
      immediateSupplyRequested: true,
      cancellationRightLossAcknowledged: true,
    }
    : undefined;
}

function transactionsPath(request: Request, prefix = '/api/v2/payments'): string | undefined {
  if (Object.keys(request.query).some(key => key !== 'limit')) return undefined;
  const limit = request.query['limit'];
  if (Array.isArray(limit) || (limit !== undefined && typeof limit !== 'string')) {
    return undefined;
  }
  const normalised = limit ?? '20';
  return /^[1-9]\d?$|^100$/.test(normalised)
    ? `${prefix}/transactions?limit=${normalised}`
    : undefined;
}

async function proxyPayment(
  request: Request,
  response: Response,
  config: PaymentRouteConfig,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  fetchImplementation: typeof fetch,
  idempotencyKey?: string,
): Promise<void> {
  if (method === 'POST') {
    const credentials = jobFinderCredentials(
      request.headers,
      {
        accessCookieName: config.accessCookieName,
        csrfCookieName: config.csrfCookieName,
        origin: config.paymentGatewayOrigin,
        timeoutMs: config.timeoutMs,
      },
      true,
      true,
    );
    if ('error' in credentials) {
      failure(response, credentials.status, credentials.error, credentials.message);
      return;
    }
  }

  try {
    const result = await callTrustedPaymentGateway({
      browserHeaders: request.headers,
      body,
      fetchImplementation,
      idempotencyKey,
      method,
      path,
      paymentGatewayOrigin: config.paymentGatewayOrigin,
      serviceToken: config.serviceToken,
      timeoutMs: config.timeoutMs,
      userManagementOrigin: config.userManagementOrigin,
    });
    response.status(result.status);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(result.contentType).send(result.body);
  } catch (error) {
    const mapped = paymentProxyFailure(error);
    failure(response, mapped.status, mapped.body.error, mapped.body.message);
  }
}

export function registerPaymentRoutes(
  app: Express,
  config: PaymentRouteConfig,
  fetchImplementation: typeof fetch = fetch,
): void {
  app.get('/api/v1/payment/wallet', (request, response) => {
    if (Object.keys(request.query).length > 0) {
      failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
      return;
    }
    void proxyPayment(
      request, response, config, 'GET', '/api/v1/payment/wallet',
      undefined, fetchImplementation,
    );
  });
  app.get('/api/v1/payment/pricing', (request, response) => {
    if (Object.keys(request.query).length > 0) {
      failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
      return;
    }
    void proxyPayment(
      request, response, config, 'GET', '/api/v1/payment/pricing',
      undefined, fetchImplementation,
    );
  });
  app.get('/api/v1/payment/transactions', (request, response) => {
    const path = transactionsPath(request, '/api/v1/payment');
    if (!path) {
      failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
      return;
    }
    void proxyPayment(
      request, response, config, 'GET', path, undefined, fetchImplementation,
    );
  });
  for (const suffix of ['catalog', 'wallet', 'checkout-readiness']) {
    const path = `/api/v2/payments/${suffix}`;
    app.get(path, (request, response) => {
      if (Object.keys(request.query).length > 0) {
        failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
        return;
      }
      void proxyPayment(
        request, response, config, 'GET', path, undefined, fetchImplementation,
      );
    });
  }

  app.get('/api/v2/payments/transactions', (request, response) => {
    const path = transactionsPath(request);
    if (!path) {
      failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
      return;
    }
    void proxyPayment(
      request, response, config, 'GET', path, undefined, fetchImplementation,
    );
  });

  app.get('/api/v2/payments/orders/:orderId/status', (request, response) => {
    const orderId = request.params['orderId'];
    if (!ORDER_ID.test(orderId) || Object.keys(request.query).length > 0) {
      failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
      return;
    }
    void proxyPayment(
      request,
      response,
      config,
      'GET',
      `/api/v2/payments/orders/${orderId.toLowerCase()}/status`,
      undefined,
      fetchImplementation,
    );
  });

  app.post('/api/v2/payments/checkout', (request, response) => {
    const body = checkoutBody(request.body);
    const header = request.header('Idempotency-Key')?.trim();
    if (!body
      || !header
      || !IDEMPOTENCY_KEY.test(header)
      || Object.keys(request.query).length > 0) {
      failure(response, 400, 'INVALID_REQUEST', 'Payment request is invalid');
      return;
    }
    void proxyPayment(
      request,
      response,
      config,
      'POST',
      '/api/v2/payments/checkout',
      body,
      fetchImplementation,
      header,
    );
  });
}
