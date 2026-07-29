import express from 'express';
import type {Server} from 'node:http';
import {registerUserManagementEvidenceRoutes} from './user-management-evidence-routes';

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

describe('user-management Evidence Library routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server?.close(error => error ? reject(error) : resolve()));
    }
    server = undefined;
  });

  async function startApp(fetchImplementation: typeof fetch): Promise<string> {
    const app = express();
    app.use(express.json());
    registerUserManagementEvidenceRoutes(app, {
      origin: 'https://gateway.example.test',
      timeoutMs: 100,
    }, fetchImplementation);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it('forwards the evidence list query through the session boundary', async () => {
    const upstream = vi.fn<FetchLike>(async () => new Response('[]', {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    }));
    const origin = await startApp(upstream as typeof fetch);

    const response = await fetch(`${origin}/api/auth/evidence?includeArchived=false`, {
      headers: {Cookie: 'jsc-access-local=opaque'},
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      'https://gateway.example.test/api/auth/evidence?includeArchived=false',
    );
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      Cookie: 'jsc-access-local=opaque',
    });
  });

  it('forwards revision-aware evidence actions without browser-selected identity', async () => {
    const upstream = vi.fn<FetchLike>(async () => new Response('{"state":"CONFIRMED"}', {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    }));
    const origin = await startApp(upstream as typeof fetch);
    const entryId = '3b0f6a57-389d-4e20-a007-199afca04b20';

    const response = await fetch(`${origin}/api/auth/evidence/${entryId}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer browser-controlled',
        Cookie: 'jsc-access-local=opaque; jsc-csrf-local=csrf-value',
        'Content-Type': 'application/json',
        'If-Match': '"2"',
        'X-CSRF-Token': 'csrf-value',
        'X-User-Id': 'another-user',
      },
      body: '{}',
    });

    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(
      `https://gateway.example.test/api/auth/evidence/${entryId}/confirm`,
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: 'jsc-access-local=opaque; jsc-csrf-local=csrf-value',
      'If-Match': '"2"',
      'X-CSRF-Token': 'csrf-value',
    });
  });
});
