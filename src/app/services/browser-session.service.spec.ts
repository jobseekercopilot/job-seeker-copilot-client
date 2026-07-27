import {HttpClient, provideHttpClient, withInterceptors} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {BASE_PATH, Configuration} from '../api';
import {
  BrowserSessionService,
  BrowserSessionState,
  browserSessionInterceptor,
} from './browser-session.service';

class JsonConfiguration extends Configuration {
  override selectHeaderAccept(accepts: string[]): string | undefined {
    const selected = super.selectHeaderAccept(accepts);
    return selected === '*/*' ? 'application/json' : selected;
  }
}

describe('browser session security', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([browserSessionInterceptor])),
        provideHttpClientTesting(),
        {provide: BASE_PATH, useValue: ''},
        {provide: Configuration, useValue: new JsonConfiguration({basePath: '', withCredentials: true})},
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('rejects a missing or attacker-selected CSRF header name', () => {
    const state = TestBed.inject(BrowserSessionState);
    expect(() => state.acceptBootstrap({token: 'long-enough-but-header-is-missing'})).toThrow();
    expect(() => state.acceptBootstrap({
      headerName: 'Authorization',
      token: 'long-enough-attacker-selected-value',
    })).toThrow();
  });

  it('keeps the CSRF value in memory and sends it on session writes', () => {
    const service = TestBed.inject(BrowserSessionService);
    const http = TestBed.inject(HttpTestingController);

    service.logout().subscribe(response => expect(response.success).toBe(true));

    const bootstrap = http.expectOne('/api/auth/csrf');
    expect(bootstrap.request.method).toBe('GET');
    expect(bootstrap.request.headers.has('X-CSRF-Token')).toBe(false);
    bootstrap.flush({headerName: 'X-CSRF-Token', token: '0123456789-secure-csrf-value'});

    const logout = http.expectOne('/api/auth/logout');
    expect(logout.request.method).toBe('POST');
    expect(logout.request.withCredentials).toBe(true);
    expect(logout.request.headers.get('X-CSRF-Token')).toBe('0123456789-secure-csrf-value');
    logout.flush({statusCode: 200, success: true, message: 'Logged out'});
    expect(TestBed.inject(BrowserSessionState).currentCsrf()).toBeNull();
  });

  it('does not attach CSRF material to an unrelated request', () => {
    const state = TestBed.inject(BrowserSessionState);
    state.acceptBootstrap({headerName: 'X-CSRF-Token', token: '0123456789-secure-csrf-value'});
    const httpClient = TestBed.inject(HttpClient);
    httpClient.post('/api/locations', {}).subscribe();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/locations');
    expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
    request.flush({success: true});
  });

  it('sends the in-memory CSRF value on a session-bound job search', () => {
    const state = TestBed.inject(BrowserSessionState);
    state.acceptBootstrap({headerName: 'X-CSRF-Token', token: '0123456789-secure-csrf-value'});
    const httpClient = TestBed.inject(HttpClient);
    httpClient.post('/api/jobs/search', {aspirations: {desiredRoles: ['developer']}}).subscribe();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/jobs/search');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('0123456789-secure-csrf-value');
    request.flush({jobs: [], totalResults: 0});
  });

  it('restores a valid cookie session from the subject-bound profile', () => {
    const service = TestBed.inject(BrowserSessionService);
    let result: string | undefined;
    service.restore().subscribe(status => result = status);

    const profile = TestBed.inject(HttpTestingController).expectOne('/api/auth/profile');
    expect(profile.request.method).toBe('GET');
    expect(profile.request.withCredentials).toBe(true);
    profile.flush({
      statusCode: 200,
      success: true,
      user: {id: 'account-id', name: 'Beta User', email: 'beta@example.test', profile: {skills: ['TypeScript']}},
    });

    expect(result).toBe('authenticated');
    expect(service.status()).toBe('authenticated');
    expect(service.user()).toEqual(expect.objectContaining({email: 'beta@example.test'}));
  });

  it('coordinates concurrent startup callers through one refresh and one safe read retry', () => {
    const service = TestBed.inject(BrowserSessionService);
    const http = TestBed.inject(HttpTestingController);
    const results: string[] = [];
    const first = service.restore();
    const second = service.restore();
    expect(second).toBe(first);
    first.subscribe(status => results.push(status));
    second.subscribe(status => results.push(status));

    http.expectOne('/api/auth/profile').flush({}, {status: 401, statusText: 'Unauthorized'});
    http.expectOne('/api/auth/csrf').flush({
      headerName: 'X-CSRF-Token',
      token: '0123456789-secure-csrf-value',
    });
    const refresh = http.expectOne('/api/auth/refresh');
    expect(refresh.request.headers.get('X-CSRF-Token')).toBe('0123456789-secure-csrf-value');
    refresh.flush({statusCode: 200, success: true, message: 'Session rotated'});
    http.expectOne('/api/auth/profile').flush({
      statusCode: 200,
      success: true,
      user: {id: 'account-id', email: 'beta@example.test', profile: {skills: ['TypeScript']}},
    });

    expect(results).toEqual(['authenticated', 'authenticated']);
    expect(service.status()).toBe('authenticated');
  });

  it('becomes anonymous when refresh is rejected and does not retry again', () => {
    const service = TestBed.inject(BrowserSessionService);
    const http = TestBed.inject(HttpTestingController);
    let result: string | undefined;
    service.restore().subscribe(status => result = status);

    http.expectOne('/api/auth/profile').flush({}, {status: 401, statusText: 'Unauthorized'});
    http.expectOne('/api/auth/csrf').flush({
      headerName: 'X-CSRF-Token',
      token: '0123456789-secure-csrf-value',
    });
    http.expectOne('/api/auth/refresh').flush({}, {status: 401, statusText: 'Unauthorized'});

    expect(result).toBe('anonymous');
    expect(service.status()).toBe('anonymous');
    expect(service.user()).toBeNull();
    http.expectNone('/api/auth/profile');
  });

  it('retries the safe read only once after a successful refresh', () => {
    const service = TestBed.inject(BrowserSessionService);
    const http = TestBed.inject(HttpTestingController);
    let result: string | undefined;
    service.restore().subscribe(status => result = status);

    http.expectOne('/api/auth/profile').flush({}, {status: 401, statusText: 'Unauthorized'});
    http.expectOne('/api/auth/csrf').flush({
      headerName: 'X-CSRF-Token',
      token: '0123456789-secure-csrf-value',
    });
    http.expectOne('/api/auth/refresh').flush({statusCode: 200, success: true});
    http.expectOne('/api/auth/profile').flush({}, {status: 401, statusText: 'Still unauthorized'});

    expect(result).toBe('anonymous');
    expect(service.status()).toBe('anonymous');
    http.expectNone('/api/auth/csrf');
    http.expectNone('/api/auth/refresh');
  });

  it('shows an unavailable outcome without PII and permits a later retry', () => {
    const service = TestBed.inject(BrowserSessionService);
    const http = TestBed.inject(HttpTestingController);
    service.acceptAuthenticatedUser({email: 'stale@example.test', profile: {skills: ['stale']}});

    let firstResult: string | undefined;
    service.restore().subscribe(status => firstResult = status);
    http.expectOne('/api/auth/profile').flush({}, {status: 503, statusText: 'Unavailable'});
    expect(firstResult).toBe('unavailable');
    expect(service.user()).toBeNull();

    let retryResult: string | undefined;
    service.restore().subscribe(status => retryResult = status);
    http.expectOne('/api/auth/profile').flush({
      statusCode: 200,
      success: true,
      user: {email: 'restored@example.test', profile: {}},
    });
    expect(retryResult).toBe('authenticated');
    expect(service.user()?.email).toBe('restored@example.test');
  });

  it('never automatically replays a state-changing request', () => {
    const state = TestBed.inject(BrowserSessionState);
    state.acceptBootstrap({headerName: 'X-CSRF-Token', token: '0123456789-secure-csrf-value'});
    TestBed.inject(HttpClient).put('/api/auth/profile', {skills: ['TypeScript']}).subscribe({error: () => undefined});
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/auth/profile').flush({}, {status: 401, statusText: 'Expired'});
    http.expectNone('/api/auth/refresh');
  });
});
