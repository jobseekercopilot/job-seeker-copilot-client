import {callUserManagement, upstreamSetCookies, userManagementHeaders} from './user-management-proxy';

describe('user management proxy boundary', () => {
  it('forwards cookies and CSRF but strips browser-selected identity', () => {
    const headers = userManagementHeaders({
      authorization: 'Bearer attacker-selected',
      'x-user-id': 'another-user',
      cookie: 'jsc-access-local=opaque; jsc-csrf-local=csrf-value',
      'x-csrf-token': 'csrf-value',
    }, true);

    expect(headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: 'jsc-access-local=opaque; jsc-csrf-local=csrf-value',
      'X-CSRF-Token': 'csrf-value',
    });
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-User-Id']).toBeUndefined();
  });

  it('does not invent a cookie, CSRF value, or request body header', () => {
    expect(userManagementHeaders({authorization: 'Bearer forged'}, false)).toEqual({
      Accept: 'application/json',
    });
  });

  it('preserves each Set-Cookie header independently', () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'jsc-access-local=access; Path=/; HttpOnly; SameSite=Lax');
    headers.append('Set-Cookie', 'jsc-refresh-local=refresh; Path=/; HttpOnly; SameSite=Lax');

    expect(upstreamSetCookies(headers)).toEqual([
      'jsc-access-local=access; Path=/; HttpOnly; SameSite=Lax',
      'jsc-refresh-local=refresh; Path=/; HttpOnly; SameSite=Lax',
    ]);
  });

  it('preserves the upstream response contract and strips forged identity headers', async () => {
    const responseHeaders = new Headers({
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/problem+json',
    });
    responseHeaders.append('Set-Cookie', 'jsc-access-local=opaque; Path=/; HttpOnly');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response('{"success":true}', {
        status: 201,
        headers: responseHeaders,
      });
    });
    const fetchImplementation = fetchMock as typeof fetch;

    const result = await callUserManagement(
      'https://gateway.example.test',
      '/api/auth/login',
      'POST',
      {
        authorization: 'Bearer forged',
        'x-user-id': 'another-user',
        cookie: 'jsc-csrf-local=csrf',
        'x-csrf-token': 'csrf',
      },
      {email: 'claimant@example.test'},
      100,
      fetchImplementation,
    );

    expect(result).toEqual({
      body: '{"success":true}',
      cacheControl: 'private, no-store',
      contentType: 'application/problem+json',
      setCookies: ['jsc-access-local=opaque; Path=/; HttpOnly'],
      status: 201,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: 'jsc-csrf-local=csrf',
      'X-CSRF-Token': 'csrf',
    });
  });
});
