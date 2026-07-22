import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isIP } from 'node:net';

export interface BffConfig {
  userManagementGatewayOrigin: string;
  allowedHosts: string[];
  host: string;
  port: number;
  jsonBodyLimitBytes: number;
  downstreamTimeoutMs: number;
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
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

function parseOrigin(environment: RuntimeEnvironment): string {
  const raw = environment['USER_MANAGEMENT_GATEWAY_URL'] || 'http://localhost:8083';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('USER_MANAGEMENT_GATEWAY_URL must be a valid HTTP(S) origin');
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
    throw new Error('USER_MANAGEMENT_GATEWAY_URL must be an HTTP(S) origin without credentials, path, query or fragment');
  }
  return url.origin;
}

export function loadBffConfig(environment: RuntimeEnvironment = process.env): BffConfig {
  const config: BffConfig = {
    userManagementGatewayOrigin: parseOrigin(environment),
    allowedHosts: parseAllowedHosts(environment),
    host: parseHost(environment),
    port: positiveInteger(environment, 'PORT', 3000, 65_535),
    jsonBodyLimitBytes: positiveInteger(environment, 'BFF_JSON_BODY_LIMIT_BYTES', 65_536, 1_048_576),
    downstreamTimeoutMs: positiveInteger(environment, 'BFF_DOWNSTREAM_TIMEOUT_MS', 5_000, 60_000),
    requestTimeoutMs: positiveInteger(environment, 'BFF_REQUEST_TIMEOUT_MS', 15_000, 120_000),
    headersTimeoutMs: positiveInteger(environment, 'BFF_HEADERS_TIMEOUT_MS', 10_000, 120_000),
    keepAliveTimeoutMs: positiveInteger(environment, 'BFF_KEEP_ALIVE_TIMEOUT_MS', 5_000, 60_000),
  };

  if (config.headersTimeoutMs > config.requestTimeoutMs) {
    throw new Error('BFF_HEADERS_TIMEOUT_MS must not exceed BFF_REQUEST_TIMEOUT_MS');
  }
  return config;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

export const securityHeaders: RequestHandler = (_request, response, next) => {
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  next();
};

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

export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(input, {...init, signal: controller.signal});
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new DownstreamTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
