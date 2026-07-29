import {CommonModule} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {firstValueFrom} from 'rxjs';
import type {GatewayResponse, UserProfile} from '../../api';
import {AuthenticationService} from '../../api';
import {normaliseProfile} from '../../models/user-profile.model';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  accountEmailError,
  loginPasswordError,
  registrationNameError,
  registrationPasswordError,
} from './credential-policy';

@Component({
  selector: 'app-landing-auth',
  imports: [CommonModule, MatIconModule, FormsModule],
  host: {
    'data-demo-focus': 'app-landing-auth',
    'data-demo-focus-id': 'registration-form',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing-auth.html',
  styleUrl: './landing-auth.css',
})
export class LandingAuthComponent implements OnInit {
  private readonly authenticationApi = inject(AuthenticationService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly initialMode = input<'create' | 'signin'>('create');
  readonly onboarded = output<{profile: UserProfile; name: string; email: string}>();

  readonly mode = signal<'create' | 'signin'>('create');
  readonly errorMessage = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly validationAttempted = signal(false);

  readonly formName = signal('');
  readonly formEmail = signal('');
  readonly formPassword = signal('');
  readonly loginEmail = signal('');
  readonly loginPassword = signal('');

  ngOnInit(): void {
    if (this.initialMode() === 'signin') this.mode.set('signin');
  }

  setMode(mode: 'create' | 'signin'): void {
    this.mode.set(mode);
    this.errorMessage.set(null);
    this.validationAttempted.set(false);
  }

  onModeTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const mode = event.key === 'ArrowRight' || event.key === 'End' ? 'signin' : 'create';
    this.setMode(mode);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(
      mode === 'create' ? '#tab-btn-create' : '#tab-btn-signin',
    )?.focus());
  }

  async completeRegistration(): Promise<void> {
    if (this.isLoading()) return;
    if (this.registrationFieldError('name')
      || this.registrationFieldError('email')
      || this.registrationFieldError('password')) {
      this.validationAttempted.set(true);
      this.showError('Check your name, email address and password before creating your account.');
      return;
    }

    this.isLoading.set(true);
    this.validationAttempted.set(false);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const response = await firstValueFrom(this.authenticationApi.register({
        name: this.formName().trim(),
        email: this.formEmail().trim().toLowerCase(),
        password: this.formPassword(),
      }));
      if (response.success && response.user) {
        this.browserSession.invalidateCsrf();
        this.emitProfileFromResponse(response);
      } else {
        this.showError(response.message || 'Registration could not be completed.');
      }
    } catch (error: unknown) {
      this.showError(this.httpErrorMessage(error, 'Unable to contact the registration service.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  async submitLogin(): Promise<void> {
    if (this.isLoading()) return;
    const email = this.loginEmail().trim();
    const password = this.loginPassword();
    if (accountEmailError(email) || loginPasswordError(password)) {
      this.validationAttempted.set(true);
      this.showError('Check your email address and password.');
      return;
    }

    this.isLoading.set(true);
    this.validationAttempted.set(false);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const response = await firstValueFrom(this.authenticationApi.login({
        email: email.toLowerCase(),
        password,
      }));
      if (response.success && response.user) {
        this.browserSession.invalidateCsrf();
        this.emitProfileFromResponse(response);
      } else {
        this.showError(response.message || 'Verification failed.');
      }
    } catch (error: unknown) {
      this.showError(this.httpErrorMessage(error, 'Unable to contact the authentication service.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  isRegistrationFieldInvalid(field: 'name' | 'email' | 'password'): boolean {
    return this.validationAttempted() && this.registrationFieldError(field) !== null;
  }

  registrationFieldError(field: 'name' | 'email' | 'password'): string | null {
    if (field === 'name') return registrationNameError(this.formName());
    if (field === 'email') return accountEmailError(this.formEmail());
    return registrationPasswordError(this.formPassword());
  }

  isLoginFieldInvalid(field: 'email' | 'password'): boolean {
    return this.validationAttempted() && this.loginFieldError(field) !== null;
  }

  loginFieldError(field: 'email' | 'password'): string | null {
    return field === 'email'
      ? accountEmailError(this.loginEmail())
      : loginPasswordError(this.loginPassword());
  }

  private showError(message: string): void {
    this.errorMessage.set(message);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#auth-error-alert')?.focus());
  }

  private httpErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null || !('error' in error)) return fallback;
    const body = (error as {error?: unknown}).error;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as {message?: unknown}).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }

  private emitProfileFromResponse(response: GatewayResponse): void {
    if (!response.user) return;
    const profile = normaliseProfile(response.user.profile);
    this.browserSession.acceptAuthenticatedUser({...response.user, profile});
    this.onboarded.emit({
      profile,
      name: response.user.name || '',
      email: response.user.email || '',
    });
  }
}
