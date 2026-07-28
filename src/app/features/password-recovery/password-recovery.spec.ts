import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {BrowserSessionService} from '../../services/browser-session.service';
import {PasswordRecoveryComponent} from './password-recovery';

describe('PasswordRecoveryComponent', () => {
  const csrf = {
    ensureCsrf: vi.fn(() => of(undefined)),
    invalidateCsrf: vi.fn(),
  };
  let http: HttpTestingController;

  beforeEach(async () => {
    csrf.ensureCsrf.mockClear();
    csrf.invalidateCsrf.mockClear();
    history.replaceState({}, '', '/');

    await TestBed.configureTestingModule({
      imports: [PasswordRecoveryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {provide: BrowserSessionService, useValue: csrf},
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    history.replaceState({}, '', '/');
  });

  it('moves a valid reset token into memory and immediately removes it from the URL', () => {
    const rawToken = 'A'.repeat(43);
    history.replaceState({}, '', `/reset-password#token=${rawToken}`);
    const fixture = TestBed.createComponent(PasswordRecoveryComponent);
    fixture.componentRef.setInput('mode', 'reset');
    fixture.detectChanges();

    expect(fixture.componentInstance.token()).toBe(rawToken);
    expect(location.pathname).toBe('/reset-password');
    expect(location.search).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain(rawToken);
  });

  it('shows the approved generic response after a reset request', async () => {
    const fixture = TestBed.createComponent(PasswordRecoveryComponent);
    fixture.componentRef.setInput('mode', 'forgot');
    fixture.detectChanges();
    fixture.componentInstance.email.set('person@example.test');

    const submission = fixture.componentInstance.submitForgot();
    await Promise.resolve();
    const request = http.expectOne('/api/auth/password-reset/request');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({email: 'person@example.test'});
    request.flush({
      statusCode: 202,
      success: true,
      message: 'If an account exists for that email, a password-reset link has been sent.',
    });
    await submission;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'If an account exists for that email, a password-reset link has been sent.',
    );
  });

  it('posts the in-memory token once and clears it after success', async () => {
    const rawToken = 'B'.repeat(43);
    history.replaceState({}, '', `/reset-password#token=${rawToken}`);
    const fixture = TestBed.createComponent(PasswordRecoveryComponent);
    fixture.componentRef.setInput('mode', 'reset');
    fixture.detectChanges();
    fixture.componentInstance.newPassword.set('A secure replacement passphrase 2026!');

    const submission = fixture.componentInstance.submitReset();
    await Promise.resolve();
    const request = http.expectOne('/api/auth/password-reset/complete');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      token: rawToken,
      newPassword: 'A secure replacement passphrase 2026!',
    });
    request.flush({
      statusCode: 200,
      success: true,
      message: 'Your password has been changed. Sign in with your new password.',
    });
    await submission;
    fixture.detectChanges();

    expect(fixture.componentInstance.token()).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain(rawToken);
    expect(fixture.nativeElement.textContent).toContain('Sign in with your new password');
  });
});
