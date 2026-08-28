import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isIP } from 'node:net';
import {
  normalisePublicFeedbackApiUrl,
  normalisePublicAppReleaseId,
  publicFeedbackConnectOrigin,
} from '../shared/feedback-configuration';

export interface BffConfig {
  userManagementGatewayOrigin: string;
  jobFinderGatewayOrigin: string;
  paymentGatewayOrigin: string;
  paymentGatewayServiceToken: string | undefined;
  reportingGatewayOrigin: string;
  publicFeedbackApiUrl: string | undefined;
  publicAppReleaseId: string | undefined;
  sessionAccessCookieName: string;
  sessionCsrfCookieName: string;
  allowedHosts: string[];
  host: string;
  port: number;
  jsonBodyLimitBytes: number;
  downstreamTimeoutMs: number;
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
  trustedProxyHops: number;
  passwordResetRateLimitWindowMs: number;
  passwordResetRateLimitMaximum: number;
}

type RuntimeEnvironment = Record<string, string | undefined>;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i;

function positiveInteger(
  environment: RuntimeEnvironment,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return value;
}

function nonNegativeInteger(
  environment: RuntimeEnvironment,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be between 0 and ${maximum}`);
  }
  return value;
}

function validHost(value: string): boolean {
  return value === '::' || isIP(value) !== 0 || HOSTNAME.test(value);
}

function parseHost(environment: RuntimeEnvironment): string {
  const host = environment['HOST'] || '0.0.0.0';
  if (!validHost(host)) throw new Error('HOST must be an IP address or hostname');
  return host;
}

function parseAllowedHosts(environment: RuntimeEnvironment): string[] {
  const hosts = (environment['NG_ALLOWED_HOSTS'] || 'localhost,127.0.0.1,job-seeker-copilot-client')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);

  if (!hosts.length || hosts.some(host => host === '*' || !validHost(host))) {
    throw new Error('NG_ALLOWED_HOSTS must contain explicit IP addresses or hostnames');
  }
  return [...new Set(hosts)];
}

function parseOrigin(
  environment: RuntimeEnvironment,
  name: string,
  fallback: string,
): string {
  const raw = environment[name] || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || raw.includes('?')
    || raw.includes('#')
  ) {
    throw new Error(
      `${name} must be an HTTP(S) origin without credentials, path, query or fragment`,
    );
  }
  return url.origin;
}

function parsePublicFeedbackApiUrl(
  environment: RuntimeEnvironment,
): string | undefined {
  const raw = environment['PUBLIC_FEEDBACK_API_URL'];
  if (raw === undefined || raw === '') return undefined;
  const url = normalisePublicFeedbackApiUrl(raw);
  if (!url) {
    throw new Error(
      'PUBLIC_FEEDBACK_API_URL must be an exact HTTPS URL without credentials, query or fragment',
    );
  }
  return url;
}

function parsePublicAppReleaseId(
  environment: RuntimeEnvironment,
  publicFeedbackApiUrl: string | undefined,
): string | undefined {
  if (!publicFeedbackApiUrl) return undefined;
  const releaseId = normalisePublicAppReleaseId(
    environment['PUBLIC_APP_RELEASE_ID'],
  );
  if (!releaseId) {
    throw new Error(
      'PUBLIC_APP_RELEASE_ID must identify the enabled feedback build with 1 to 64 safe characters',
    );
  }
  return releaseId;
}

function sessionCookieNames(environment: RuntimeEnvironment): {
  access: string;
  csrf: string;
} {
  const profile = environment['BFF_SESSION_COOKIE_PROFILE'] || 'local';
  if (!['local', 'production'].includes(profile)) {
    throw new Error(
      'BFF_SESSION_COOKIE_PROFILE must be local or production',
    );
  }
  return profile === 'production'
    ? {access: '__Host-jsc-access', csrf: '__Host-jsc-csrf'}
    : {access: 'jsc-access-local', csrf: 'jsc-csrf-local'};
}

export function loadBffConfig(environment: RuntimeEnvironment = process.env): BffConfig {
  const cookies = sessionCookieNames(environment);
  const publicFeedbackApiUrl = parsePublicFeedbackApiUrl(environment);
  const config: BffConfig = {
    userManagementGatewayOrigin: parseOrigin(
      environment,
      'USER_MANAGEMENT_GATEWAY_URL',
      'http://localhost:8083',
    ),
    jobFinderGatewayOrigin: parseOrigin(
      environment,
      'JOB_FINDER_GATEWAY_URL',
      'http://localhost:8080',
    ),
    paymentGatewayOrigin: parseOrigin(
      environment,
      'PAYMENT_GATEWAY_URL',
      'http://localhost:8098',
    ),
    paymentGatewayServiceToken:
      environment['BFF_TO_PAYMENT_GATEWAY_TOKEN'],
    reportingGatewayOrigin: parseOrigin(
      environment,
      "REPORTING_GATEWAY_URL",
      "http://localhost:8095",
    ),
    publicFeedbackApiUrl,
    publicAppReleaseId: parsePublicAppReleaseId(environment, publicFeedbackApiUrl),
    sessionAccessCookieName: cookies.access,
    sessionCsrfCookieName: cookies.csrf,
    allowedHosts: parseAllowedHosts(environment),
    host: parseHost(environment),
    port: positiveInteger(environment, 'PORT', 3000, 65_535),
    jsonBodyLimitBytes: positiveInteger(environment, 'BFF_JSON_BODY_LIMIT_BYTES', 65_536, 1_048_576),
    downstreamTimeoutMs: positiveInteger(environment, 'BFF_DOWNSTREAM_TIMEOUT_MS', 5_000, 60_000),
    requestTimeoutMs: positiveInteger(environment, 'BFF_REQUEST_TIMEOUT_MS', 15_000, 120_000),
    headersTimeoutMs: positiveInteger(environment, 'BFF_HEADERS_TIMEOUT_MS', 10_000, 120_000),
    keepAliveTimeoutMs: positiveInteger(environment, 'BFF_KEEP_ALIVE_TIMEOUT_MS', 5_000, 60_000),
    trustedProxyHops: nonNegativeInteger(environment, 'BFF_TRUSTED_PROXY_HOPS', 0, 3),
    passwordResetRateLimitWindowMs: positiveInteger(environment, 'BFF_PASSWORD_RESET_RATE_WINDOW_MS', 900_000, 3_600_000),
    passwordResetRateLimitMaximum: positiveInteger(environment, 'BFF_PASSWORD_RESET_RATE_MAXIMUM', 5, 100),
  };

  if (config.headersTimeoutMs > config.requestTimeoutMs) {
    throw new Error('BFF_HEADERS_TIMEOUT_MS must not exceed BFF_REQUEST_TIMEOUT_MS');
  }
  return config;
}

export function securityHeaders(publicFeedbackApiUrl?: string): RequestHandler {
  const feedbackOrigin = publicFeedbackConnectOrigin(publicFeedbackApiUrl);
  if (publicFeedbackApiUrl && !feedbackOrigin) {
    throw new Error('Feedback CSP origin must come from a validated HTTPS URL');
  }
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self'",
    `connect-src 'self'${feedbackOrigin ? ` ${feedbackOrigin}` : ''}`,
  ].join('; ');

  return (_request, response, next) => {
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  };
}

export function passwordResetIpRateLimiter(
  windowMs: number,
  maximum: number,
  now: () => number = Date.now,
): RequestHandler {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1
      || !Number.isSafeInteger(maximum) || maximum < 1) {
    throw new Error('Password-reset rate-limit settings must be positive integers');
  }
  const attempts = new Map<string, number[]>();
  const maximumTrackedSources = 10_000;

  return (request, response, next) => {
    const source = request.ip;
    if (!source) {
      response.status(429).json({
        statusCode: 429,
        success: false,
        message: 'Too many password-reset requests. Try again later.',
      });
      return;
    }
    const cutoff = now() - windowMs;
    const recent = (attempts.get(source) ?? []).filter(timestamp => timestamp > cutoff);
    if (recent.length >= maximum) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((recent[0] + windowMs - now()) / 1000))));
      response.status(429).json({
        statusCode: 429,
        success: false,
        message: 'Too many password-reset requests. Try again later.',
      });
      return;
    }
    recent.push(now());
    attempts.set(source, recent);
    if (attempts.size > maximumTrackedSources) {
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
    next();
  };
}

interface BodyParserError extends Error {
  status?: number;
  type?: string;
}

export const jsonBodyErrorHandler: ErrorRequestHandler = (error: BodyParserError, _request, response, next) => {
  if (error.type === 'entity.too.large' || error.status === 413) {
    response.status(413).json({ error: 'REQUEST_TOO_LARGE', message: 'Request body exceeds the allowed size' });
    return;
  }
  if (error.type === 'entity.parse.failed' || error.status === 400) {
    response.status(400).json({ error: 'INVALID_JSON', message: 'Request body must contain valid JSON' });
    return;
  }
  next(error);
};

export class DownstreamTimeoutError extends Error {
  constructor() {
    super('Downstream request timed out');
    this.name = 'DownstreamTimeoutError';
  }
}

export async function fetchAndConsumeWithTimeout<Result>(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  consumeResponse: (response: Response) => Promise<Result>,
  fetchImplementation: typeof fetch,
): Promise<Result> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectCallerCancellation: ((reason?: unknown) => void) | undefined;
  const callerCancellation = callerSignal
    ? new Promise<never>((_resolve, reject) => {
      rejectCallerCancellation = reject;
    })
    : undefined;
  const relayCallerAbort = (): void => {
    const reason = callerSignal?.reason
      ?? new DOMException('Caller cancelled downstream request', 'AbortError');
    controller.abort(reason);
    rejectCallerCancellation?.(reason);
  };
  if (callerSignal?.aborted) {
    relayCallerAbort();
  } else {
    callerSignal?.addEventListener('abort', relayCallerAbort, {once: true});
  }
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new DownstreamTimeoutError());
    }, timeoutMs);
  });
  try {
    const downstream = (async () => {
      const response = await fetchImplementation(
        input,
        {...init, signal: controller.signal},
      );
      return consumeResponse(response);
    })().catch((error: unknown) => {
      if (didTimeout) throw new DownstreamTimeoutError();
      throw error;
    });
    return await Promise.race([
      downstream,
      deadline,
      ...(callerCancellation ? [callerCancellation] : []),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', relayCallerAbort);
  }
}

export interface TextResponse {
  body: string;
  response: Response;
}

export async function fetchTextWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: typeof fetch = fetch,
): Promise<TextResponse> {
  return fetchAndConsumeWithTimeout(
    input,
    init,
    timeoutMs,
    async response => ({
      body: await response.text(),
      response,
    }),
    fetchImplementation,
  );
}

export function downstreamFailureCategory(error: unknown): 'timeout' | 'unavailable' {
  return error instanceof DownstreamTimeoutError ? 'timeout' : 'unavailable';
}

export function downstreamFailureResponse(error: unknown): {
  category: 'timeout' | 'unavailable';
  message: string;
  statusCode: 503 | 504;
} {
  const category = downstreamFailureCategory(error);
  return category === 'timeout'
    ? {category, statusCode: 504, message: 'User management service timed out'}
    : {category, statusCode: 503, message: 'User management service is currently unavailable'};
}
