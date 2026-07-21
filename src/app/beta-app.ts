import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import type {GatewayResponse, UserProfile} from './api';
import {ClaimantProfileComponent} from './features/claimant-profile/claimant-profile';
import {LandingAuthComponent} from './features/landing-auth/landing-auth';
import {normaliseProfile} from './models/user-profile.model';

interface OnboardedUser {
  profile: UserProfile;
  name: string;
  email: string;
  token?: string;
}

@Component({
  selector: 'app-root',
  imports: [ClaimantProfileComponent, LandingAuthComponent],
  templateUrl: './beta-app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BetaApp {
  protected readonly authenticated = signal(false);
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly profile = signal<UserProfile | null>(null);
  protected authToken = '';
  protected readonly message = signal<string | null>(null);

  protected handleOnboarded(user: OnboardedUser): void {
    this.name.set(user.name);
    this.email.set(user.email);
    this.profile.set(normaliseProfile(user.profile));
    this.authToken = user.token ?? '';
    this.authenticated.set(true);
    this.message.set(null);
  }

  protected handleProfileSaved(event: {
    profile: UserProfile;
    apiResult?: GatewayResponse;
    apiError?: unknown;
  }): void {
    if (event.apiResult?.success) {
      this.profile.set(normaliseProfile(event.profile));
      this.message.set('Profile updated.');
      return;
    }
    this.message.set('The profile could not be updated. Please try again.');
  }

  protected logout(): void {
    this.authenticated.set(false);
    this.name.set('');
    this.email.set('');
    this.profile.set(null);
    this.authToken = '';
    this.message.set(null);
  }
}
