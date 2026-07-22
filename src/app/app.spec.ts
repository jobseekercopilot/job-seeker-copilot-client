import {TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import {BetaApp} from './beta-app';
import type {UserProfile} from './api';
import {BrowserSessionService} from './services/browser-session.service';
import {LEGACY_SESSION_STORAGE_KEYS} from './services/browser-storage';

interface BetaAppTestAccess {
  authenticated(): boolean;
  name(): string;
  profile(): UserProfile | null;
  message(): string | null;
  handleOnboarded(user: {profile: UserProfile; name: string; email: string}): void;
  logout(): Promise<void>;
}

describe('BetaApp', () => {
  const logout = vi.fn(() => of({statusCode: 200, success: true, message: 'Logged out'}));

  beforeEach(async () => {
    logout.mockReset();
    logout.mockReturnValue(of({statusCode: 200, success: true, message: 'Logged out'}));
    await TestBed.configureTestingModule({
      imports: [BetaApp],
      providers: [{provide: BrowserSessionService, useValue: {logout}}],
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
    expect(access.authenticated()).toBe(false);
    expect(access.name()).toBe('');
    expect(access.profile()).toBeNull();
    expect(access.message()).toBe('Signed out.');
  });

  it('retains the current view and reports logout failure explicitly', async () => {
    logout.mockReturnValue(throwError(() => new Error('dependency unavailable')));
    const access = TestBed.createComponent(BetaApp).componentInstance as unknown as BetaAppTestAccess;
    access.handleOnboarded({profile: {skills: ['TypeScript']}, name: 'Beta User', email: 'beta@example.test'});

    await access.logout();

    expect(access.authenticated()).toBe(true);
    expect(access.name()).toBe('Beta User');
    expect(access.message()).toBe('The session could not be ended. Please try again.');
  });
});
