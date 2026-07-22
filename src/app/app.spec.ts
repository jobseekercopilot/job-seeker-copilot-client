import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {NEVER, of, throwError} from 'rxjs';
import {BetaApp} from './beta-app';
import type {GatewayResponse, User, UserProfile} from './api';
import {BrowserSessionService} from './services/browser-session.service';
import type {BrowserSessionStatus} from './services/browser-session.service';
import {LEGACY_SESSION_STORAGE_KEYS} from './services/browser-storage';

interface BetaAppTestAccess {
  sessionStatus(): BrowserSessionStatus;
  name(): string;
  profile(): UserProfile | null;
  message(): string | null;
  handleOnboarded(user: {profile: UserProfile; name: string; email: string}): void;
  handleProfileSaved(event: {profile: UserProfile; apiResult?: GatewayResponse; apiError?: unknown}): void;
  retrySession(): Promise<void>;
  logout(): Promise<void>;
}

describe('BetaApp', () => {
  const status = signal<BrowserSessionStatus>('checking');
  const user = signal<User | null>(null);
  const restore = vi.fn();
  const logout = vi.fn();
  const acceptAuthenticatedUser = vi.fn((authenticatedUser: User) => {
    user.set(authenticatedUser);
    status.set('authenticated');
  });
  const updateCurrentProfile = vi.fn((profile: UserProfile) => {
    const current = user();
    if (current) user.set({...current, profile});
  });
  const handleAuthenticatedError = vi.fn((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'status' in error
      && Number((error as {status?: unknown}).status) === 401) {
      user.set(null);
      status.set('anonymous');
    }
  });

  beforeEach(async () => {
    status.set('checking');
    user.set(null);
    restore.mockReset();
    restore.mockImplementation(() => {
      status.set('anonymous');
      return of<BrowserSessionStatus>('anonymous');
    });
    logout.mockReset();
    logout.mockImplementation(() => {
      status.set('anonymous');
      user.set(null);
      return of({statusCode: 200, success: true, message: 'Logged out'});
    });
    acceptAuthenticatedUser.mockClear();
    updateCurrentProfile.mockClear();
    handleAuthenticatedError.mockClear();
    await TestBed.configureTestingModule({
      imports: [BetaApp],
      providers: [{provide: BrowserSessionService, useValue: {
        status,
        user,
        restore,
        logout,
        acceptAuthenticatedUser,
        updateCurrentProfile,
        handleAuthenticatedError,
      }}],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(BetaApp);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('removes legacy token, identity, and profile data from browser storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    for (const key of LEGACY_SESSION_STORAGE_KEYS) {
      localStorage.setItem(key, 'sensitive');
      sessionStorage.setItem(key, 'sensitive');
    }

    const app = TestBed.createComponent(BetaApp).componentInstance;
    app.ngOnInit();
    expect(restore).toHaveBeenCalledOnce();

    for (const key of LEGACY_SESSION_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
    vi.unstubAllGlobals();
  });

  it('clears in-memory PII only after the gateway confirms logout', async () => {
    const access = TestBed.createComponent(BetaApp).componentInstance as unknown as BetaAppTestAccess;
    access.handleOnboarded({profile: {skills: ['TypeScript']}, name: 'Beta User', email: 'beta@example.test'});

    await access.logout();

    expect(logout).toHaveBeenCalledOnce();
    expect(access.sessionStatus()).toBe('anonymous');
    expect(access.name()).toBe('');
    expect(access.profile()).toBeNull();
    expect(access.message()).toBe('Signed out.');
  });

  it('retains the current view and reports logout failure explicitly', async () => {
    logout.mockReturnValue(throwError(() => new Error('dependency unavailable')));
    const access = TestBed.createComponent(BetaApp).componentInstance as unknown as BetaAppTestAccess;
    access.handleOnboarded({profile: {skills: ['TypeScript']}, name: 'Beta User', email: 'beta@example.test'});

    await access.logout();

    expect(access.sessionStatus()).toBe('authenticated');
    expect(access.name()).toBe('Beta User');
    expect(access.message()).toBe('The session could not be ended. Please try again.');
  });

  it('does not render claimant PII while checking and offers retry when unavailable', () => {
    restore.mockReturnValue(NEVER);
    const fixture = TestBed.createComponent(BetaApp);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Checking your session');
    expect(fixture.nativeElement.querySelector('app-claimant-profile')).toBeNull();

    status.set('unavailable');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Session service unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('Beta User');
    expect(fixture.nativeElement.querySelector('button')?.textContent).toContain('Try again');
  });

  it('clears central PII when an authenticated operation returns a final 401', () => {
    const access = TestBed.createComponent(BetaApp).componentInstance as unknown as BetaAppTestAccess;
    access.handleOnboarded({profile: {skills: ['TypeScript']}, name: 'Beta User', email: 'beta@example.test'});

    access.handleProfileSaved({profile: {skills: ['changed']}, apiError: {status: 401}});

    expect(handleAuthenticatedError).toHaveBeenCalledOnce();
    expect(access.sessionStatus()).toBe('anonymous');
    expect(access.name()).toBe('');
    expect(access.profile()).toBeNull();
    expect(access.message()).toBe('Your session has expired. Please sign in again.');
  });
});
