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
});
