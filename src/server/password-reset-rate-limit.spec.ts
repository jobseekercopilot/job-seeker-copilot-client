import express from 'express';
import type { Server } from 'node:http';
import {loadBffConfig, passwordResetIpRateLimiter} from './bff-boundary';

describe('password-reset browser source-IP limits', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
  });

  it('requires explicit bounded trusted-proxy and reset-limit settings', () => {
    const config = loadBffConfig({
      BFF_TRUSTED_PROXY_HOPS: '1',
      BFF_PASSWORD_RESET_RATE_WINDOW_MS: '60000',
      BFF_PASSWORD_RESET_RATE_MAXIMUM: '4',
    });
    expect(config.trustedProxyHops).toBe(1);
    expect(config.passwordResetRateLimitWindowMs).toBe(60_000);
    expect(config.passwordResetRateLimitMaximum).toBe(4);
    expect(() => loadBffConfig({BFF_TRUSTED_PROXY_HOPS: '4'}))
      .toThrow('BFF_TRUSTED_PROXY_HOPS');
    expect(() => loadBffConfig({BFF_PASSWORD_RESET_RATE_MAXIMUM: '0'}))
      .toThrow('BFF_PASSWORD_RESET_RATE_MAXIMUM');
  });

  it('rate limits independently by trusted source IP', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.post('/reset', passwordResetIpRateLimiter(60_000, 2, () => 10_000), (_request, response) => {
      response.status(202).json({message: 'generic'});
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const origin = `http://127.0.0.1:${address.port}`;
    const request = (source: string) => fetch(`${origin}/reset`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Forwarded-For': source},
      body: '{"email":"person@example.test"}',
    });

    expect((await request('198.51.100.1')).status).toBe(202);
    expect((await request('198.51.100.1')).status).toBe(202);
    const limited = await request('198.51.100.1');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toEqual({
      statusCode: 429,
      success: false,
      message: 'Too many password-reset requests. Try again later.',
    });
    expect((await request('198.51.100.2')).status).toBe(202);
  });
});
