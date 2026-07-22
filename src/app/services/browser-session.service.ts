import {HttpInterceptorFn} from '@angular/common/http';
import {inject, Injectable, signal} from '@angular/core';
import {finalize, map, Observable, of, shareReplay, switchMap} from 'rxjs';
import {GatewayResponse, UserManagementControllerService} from '../api';

interface CsrfHeader {
  name: 'X-CSRF-Token';
  value: string;
}

@Injectable({providedIn: 'root'})
export class BrowserSessionState {
  private readonly csrf = signal<CsrfHeader | null>(null);

  currentCsrf(): CsrfHeader | null {
    return this.csrf();
  }

  acceptBootstrap(response: Record<string, string>): void {
    const headerName = response['headerName'];
    const token = response['token']?.trim();
    if (headerName !== 'X-CSRF-Token' || !token || token.length < 20) {
      throw new Error('The session service returned an invalid CSRF bootstrap response.');
    }
    this.csrf.set({name: headerName, value: token});
  }

  clearCsrf(): void {
    this.csrf.set(null);
  }
}

@Injectable({providedIn: 'root'})
export class BrowserSessionService {
  private readonly api = inject(UserManagementControllerService);
  private readonly state = inject(BrowserSessionState);
  private csrfRequest?: Observable<void>;

  ensureCsrf(): Observable<void> {
    if (this.state.currentCsrf()) return of(undefined);
    if (this.csrfRequest) return this.csrfRequest;

    const request = this.api.csrf('body', false, {transferCache: false}).pipe(
      map(response => this.state.acceptBootstrap(response)),
      finalize(() => {
        if (this.csrfRequest === request) this.csrfRequest = undefined;
      }),
      shareReplay({bufferSize: 1, refCount: false}),
    );
    this.csrfRequest = request;
    return request;
  }

  invalidateCsrf(): void {
    this.state.clearCsrf();
  }

  logout(): Observable<GatewayResponse> {
    return this.ensureCsrf().pipe(
      switchMap(() => this.api.logout('body', false, {transferCache: false})),
      finalize(() => this.invalidateCsrf()),
    );
  }
}

export const browserSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const methodRequiresCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
  const path = request.url.split(/[?#]/, 1)[0];
  if (!methodRequiresCsrf || !path.startsWith('/api/auth/')) return next(request);

  const csrf = inject(BrowserSessionState).currentCsrf();
  if (!csrf) return next(request);

  return next(request.clone({
    setHeaders: {[csrf.name]: csrf.value},
    withCredentials: true,
  }));
};
