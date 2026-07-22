import {isPlatformBrowser} from '@angular/common';
import {ChangeDetectionStrategy, Component, inject, OnInit, PLATFORM_ID, signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import type {GatewayResponse, UserProfile} from './api';
import {ClaimantProfileComponent} from './features/claimant-profile/claimant-profile';
import {LandingAuthComponent} from './features/landing-auth/landing-auth';
import {normaliseProfile} from './models/user-profile.model';
import {BrowserSessionService} from './services/browser-session.service';
import {removeLegacySessionData} from './services/browser-storage';

interface OnboardedUser {
  profile: UserProfile;
  name: string;
  email: string;
}

@Component({
  selector: 'app-root',
  imports: [ClaimantProfileComponent, LandingAuthComponent],
  templateUrl: './beta-app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BetaApp implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly browserSession = inject(BrowserSessionService);
  protected readonly authenticated = signal(false);
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly message = signal<string | null>(null);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      removeLegacySessionData(localStorage, sessionStorage);
    } catch {
      console.warn('Unable to remove legacy browser session data.');
    }
  }

  protected handleOnboarded(user: OnboardedUser): void {
    this.name.set(user.name);
    this.email.set(user.email);
    this.profile.set(normaliseProfile(user.profile));
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

  protected async logout(): Promise<void> {
    this.message.set(null);
    try {
      const response = await firstValueFrom(this.browserSession.logout());
      if (!response.success) {
        this.message.set('The session could not be ended. Please try again.');
        return;
      }
    } catch {
      this.message.set('The session could not be ended. Please try again.');
      return;
    }

    this.authenticated.set(false);
    this.name.set('');
    this.email.set('');
    this.profile.set(null);
    this.message.set('Signed out.');
  }
}
