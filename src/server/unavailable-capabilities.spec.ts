import express from 'express';
import type {Server} from 'node:http';
import {
  UNAVAILABLE_API_PREFIXES,
  rejectUnavailableCapability,
} from './unavailable-capabilities';

describe('unavailable capability boundary', () => {
  let server: Server | undefined;
  let reachedUnsafeHandler = 0;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
  });

  async function startApp(): Promise<string> {
    const app = express();
    app.use(UNAVAILABLE_API_PREFIXES, rejectUnavailableCapability);
    app.use(['/api/v1/payment'], (_request, response) => {
      reachedUnsafeHandler += 1;
      response.status(200).json({unsafe: true});
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    return `http://127.0.0.1:${address.port}`;
  }

  it.each([
    ['GET', '/api/v1/payment/wallet'],
    ['GET', '/api/v1/payment/transactions?limit=20'],
    ['GET', '/api/v1/payment/pricing'],
    ['POST', '/api/v1/payment/demo-purchase'],
    ['POST', '/api/v1/payment/checkout'],
  ])('rejects %s %s before an unsafe handler can run', async (method, path) => {
    reachedUnsafeHandler = 0;
    const origin = await startApp();
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer browser-controlled',
        'X-User-Id': 'another-user',
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? '{"unsafe":"must-not-leave-the-bff"}' : undefined,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'FEATURE_NOT_AVAILABLE',
      message: 'This capability is not currently available',
    });
    expect(reachedUnsafeHandler).toBe(0);
  });

  it('keeps the unsafe capability prefix allowlist explicit', () => {
    expect(UNAVAILABLE_API_PREFIXES).toEqual([
      '/api/v1/payment',
    ]);
  });
});
