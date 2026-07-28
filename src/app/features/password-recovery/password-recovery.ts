import {CommonModule, isPlatformBrowser} from '@angular/common';
import {HttpClient} from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {BrowserSessionService} from '../../services/browser-session.service';
import {accountEmailError, registrationPasswordError} from '../landing-auth/credential-policy';

type RecoveryMode = 'forgot' | 'reset';

@Component({
  selector: 'app-password-recovery',
  imports: [CommonModule, FormsModule],
  templateUrl: './password-recovery.html',
  styleUrl: './password-recovery.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordRecoveryComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly mode = input.required<RecoveryMode>();
  readonly email = signal('');
  readonly newPassword = signal('');
  readonly token = signal('');
  readonly busy = signal(false);
  readonly submitted = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    if (this.mode() !== 'reset' || !isPlatformBrowser(this.platformId)) return;
    const rawToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    this.token.set(this.validToken(rawToken) ? rawToken : '');
    history.replaceState(history.state, '', '/reset-password');
  }

  async submitForgot(): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    if (accountEmailError(this.email())) {
      this.errorMessage.set('Enter a valid email address.');
      return;
    }
    this.busy.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      await firstValueFrom(this.http.post(
        '/api/auth/password-reset/request',
        {email: this.email().trim().toLowerCase()},
      ));
      this.browserSession.invalidateCsrf();
      this.successMessage.set(
        'If an account exists for that email, a password-reset link has been sent.',
      );
    } catch {
      this.errorMessage.set('Password reset is temporarily unavailable. Try again later.');
    } finally {
      this.busy.set(false);
    }
  }

  async submitReset(): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    const passwordError = registrationPasswordError(this.newPassword());
    if (!this.token()) {
      this.errorMessage.set('This password-reset link is invalid or has expired.');
      return;
    }
    if (passwordError) {
      this.errorMessage.set(passwordError);
      return;
    }
    this.busy.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      await firstValueFrom(this.http.post(
        '/api/auth/password-reset/complete',
        {token: this.token(), newPassword: this.newPassword()},
      ));
      this.token.set('');
      this.newPassword.set('');
      this.browserSession.invalidateCsrf();
      this.successMessage.set(
        'Your password has been changed. Sign in with your new password.',
      );
    } catch (error: unknown) {
      this.errorMessage.set(this.safeError(
        error,
        'The reset link or new password could not be accepted.',
      ));
    } finally {
      this.busy.set(false);
    }
  }

  private validToken(value: string): boolean {
    return /^[A-Za-z0-9_-]{32,128}$/.test(value);
  }

  private safeError(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null || !('error' in error)) return fallback;
    const body = (error as {error?: unknown}).error;
    if (typeof body !== 'object' || body === null || !('message' in body)) return fallback;
    const message = (body as {message?: unknown}).message;
    return typeof message === 'string' && message.trim() ? message : fallback;
  }
}
