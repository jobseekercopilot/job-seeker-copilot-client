import {DownstreamTimeoutError, fetchTextWithTimeout} from './bff-boundary';
import {callUserManagement} from './user-management-proxy';

type BrowserHeaders = Record<string, string | string[] | undefined>;

const MINIMUM_SERVICE_TOKEN_BYTES = 32;
const MAXIMUM_OWNER_LENGTH = 128;

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
  method: 'GET' | 'POST';
  path: string;
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

  return {
    body,
    contentType: response.headers.get('content-type') || 'application/json',
    status: response.status,
  };
}

export function paymentProxyFailure(error: unknown): {
  body: {error: string; message: string};
  status: 401 | 503 | 504;
} {
  if (error instanceof PaymentAuthenticationError) {
    return {
      status: 401,
      body: {
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Valid browser session required',
      },
    };
  }
  if (error instanceof DownstreamTimeoutError) {
    return {
      status: 504,
      body: {
        error: 'SERVICE_TIMEOUT',
        message: 'Payment dependency timed out',
      },
    };
  }
  return {
    status: 503,
    body: {
      error: 'SERVICE_UNAVAILABLE',
      message: 'Payment service is currently unavailable',
    },
  };
}
