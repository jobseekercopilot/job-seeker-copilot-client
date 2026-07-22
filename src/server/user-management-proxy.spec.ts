import {upstreamSetCookies, userManagementHeaders} from './user-management-proxy';

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
});
