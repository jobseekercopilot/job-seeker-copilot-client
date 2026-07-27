import {HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject, Injectable, signal} from '@angular/core';
import {
  catchError,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import {ProfileService, UserManagementControllerService} from '../api';
import type {GatewayResponse, User, UserProfile} from '../api';

export type BrowserSessionStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';

interface CsrfHeader {
  name: 'X-CSRF-Token';
  value: string;
}

@Injectable({providedIn: 'root'})
export class BrowserSessionState {
  private readonly csrf = signal<CsrfHeader | null>(null);
  private readonly sessionStatus = signal<BrowserSessionStatus>('checking');
  private readonly currentUser = signal<User | null>(null);
  readonly status = this.sessionStatus.asReadonly();
  readonly user = this.currentUser.asReadonly();

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

  beginCheck(): void {
    this.currentUser.set(null);
    this.sessionStatus.set('checking');
  }

  acceptUser(user: User): void {
    this.currentUser.set(user);
    this.sessionStatus.set('authenticated');
  }

  updateProfile(profile: UserProfile): void {
    const user = this.currentUser();
    if (user) this.currentUser.set({...user, profile});
  }

  markAnonymous(): void {
    this.clearCsrf();
    this.currentUser.set(null);
    this.sessionStatus.set('anonymous');
  }

  markUnavailable(): void {
    this.clearCsrf();
    this.currentUser.set(null);
    this.sessionStatus.set('unavailable');
  }
}

@Injectable({providedIn: 'root'})
export class BrowserSessionService {
  private readonly api = inject(UserManagementControllerService);
  private readonly profileApi = inject(ProfileService);
  private readonly state = inject(BrowserSessionState);
  readonly status = this.state.status;
  readonly user = this.state.user;
  private csrfRequest?: Observable<void>;
  private refreshRequest?: Observable<GatewayResponse>;
  private restoreRequest?: Observable<BrowserSessionStatus>;

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

  acceptAuthenticatedUser(user: User): void {
    this.state.acceptUser(user);
  }

  updateCurrentProfile(profile: UserProfile): void {
    this.state.updateProfile(profile);
  }

  restore(): Observable<BrowserSessionStatus> {
    if (this.restoreRequest) return this.restoreRequest;
    this.state.beginCheck();

    const request = this.readProfile().pipe(
      catchError(error => {
        if (!this.isUnauthorized(error)) return of(this.resolveFailure(error));
        return this.refreshSession().pipe(
          switchMap(() => this.readProfile()),
          catchError(refreshOrRetryError => of(this.resolveFailure(refreshOrRetryError))),
        );
      }),
      finalize(() => {
        if (this.restoreRequest === request) this.restoreRequest = undefined;
      }),
      shareReplay({bufferSize: 1, refCount: false}),
    );
    this.restoreRequest = request;
    return request;
  }

  handleAuthenticatedError(error: unknown): void {
    if (this.isUnauthorized(error)) this.state.markAnonymous();
  }

  private readProfile(): Observable<BrowserSessionStatus> {
    return this.profileApi.getProfile('body', false, {transferCache: false}).pipe(
      map(response => {
        if (!response.success || !response.user) {
          this.state.markUnavailable();
          return 'unavailable';
        }
        this.state.acceptUser(response.user);
        return 'authenticated';
      }),
    );
  }

  private refreshSession(): Observable<GatewayResponse> {
    if (this.refreshRequest) return this.refreshRequest;

    const request = this.ensureCsrf().pipe(
      switchMap(() => this.api.refresh('body', false, {transferCache: false})),
      map(response => {
        if (!response.success) {
          throw new HttpErrorResponse({status: 401, statusText: 'Session refresh rejected'});
        }
        return response;
      }),
      finalize(() => {
        this.invalidateCsrf();
        if (this.refreshRequest === request) this.refreshRequest = undefined;
      }),
      shareReplay({bufferSize: 1, refCount: false}),
    );
    this.refreshRequest = request;
    return request;
  }

  private resolveFailure(error: unknown): BrowserSessionStatus {
    if (this.isUnauthorized(error)) {
      this.state.markAnonymous();
      return 'anonymous';
    }
    this.state.markUnavailable();
    return 'unavailable';
  }

  private isUnauthorized(error: unknown): boolean {
    if (error instanceof HttpErrorResponse) return error.status === 401;
    return typeof error === 'object' && error !== null && 'status' in error
      && Number((error as {status?: unknown}).status) === 401;
  }

  logout(): Observable<GatewayResponse> {
    return this.ensureCsrf().pipe(
      switchMap(() => this.api.logout('body', false, {transferCache: false})),
      tap(response => {
        if (response.success) this.state.markAnonymous();
      }),
      catchError(error => {
        this.handleAuthenticatedError(error);
        return throwError(() => error);
      }),
      finalize(() => this.invalidateCsrf()),
    );
  }
}

export const browserSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const methodRequiresCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
  const path = request.url.split(/[?#]/, 1)[0];
  const isSessionBoundWrite = path.startsWith('/api/auth/') || path.startsWith('/api/jobs/');
  if (!methodRequiresCsrf || !isSessionBoundWrite) return next(request);

  const csrf = inject(BrowserSessionState).currentCsrf();
  if (!csrf) return next(request);

  return next(request.clone({
    setHeaders: {[csrf.name]: csrf.value},
    withCredentials: true,
  }));
};
