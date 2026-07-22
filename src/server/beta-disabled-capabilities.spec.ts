import express from 'express';
import type { Server } from 'node:http';
import {BETA_DISABLED_API_PREFIXES, rejectBetaDisabledCapability} from './beta-disabled-capabilities';

describe('beta-disabled payment boundary', () => {
  let server: Server | undefined;
  let reachedRetainedHandler = 0;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  });

  async function startApp(): Promise<string> {
    const app = express();
    app.use(BETA_DISABLED_API_PREFIXES, rejectBetaDisabledCapability);
    app.use('/api/v1/payment', (_request, response) => {
      reachedRetainedHandler += 1;
      response.status(200).json({unsafe: true});
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    return `http://127.0.0.1:${address.port}`;
  }

  it.each([
    ['GET', '/api/v1/payment'],
    ['GET', '/api/v1/payment/wallet'],
    ['GET', '/api/v1/payment/transactions?limit=20'],
    ['GET', '/api/v1/payment/pricing'],
    ['POST', '/api/v1/payment/demo-purchase'],
    ['POST', '/api/v1/payment/checkout'],
    ['GET', '/api/v1/payment/unknown/child'],
    ['POST', '/api/v1/payment/unknown/child'],
  ])('rejects %s %s before a retained handler can run', async (method, path) => {
    reachedRetainedHandler = 0;
    const origin = await startApp();
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer browser-controlled',
        'X-User-Id': 'another-user',
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? '{"payment":"must-not-leave-the-bff"}' : undefined,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'FEATURE_NOT_AVAILABLE',
      message: 'This capability is not available in the User Management beta',
    });
    expect(reachedRetainedHandler).toBe(0);
  });

  it('keeps the complete fail-closed prefix allowlist explicit', () => {
    expect(BETA_DISABLED_API_PREFIXES).toEqual([
      '/api/jobs',
      '/api/v1/applications',
      '/api/v1/document-generation',
      '/api/v1/documents',
      '/api/v1/reports',
      '/api/v1/payment',
    ]);
  });
});
