import {CommonModule} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {debounceTime, distinctUntilChanged, firstValueFrom, Subject, switchMap} from 'rxjs';
import type {GatewayResponse, ProfilePreferencesUpdate, UserProfile} from '../../api';
import {
  AuthenticationService,
  ProfileService,
  WorkPreferencesWorkplaceArrangementsEnum,
} from '../../api';
import {normaliseProfile} from '../../models/user-profile.model';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  idleLocationLookup,
  LocationService,
  type CanonicalLocation,
  type LocationLookupState,
  type LocationOption,
} from '../../services/location.service';
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
  private readonly profileApi = inject(ProfileService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly locationService = inject(LocationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly initialMode = input<'create' | 'signin'>('create');
  readonly onboarded = output<{
    profile: UserProfile;
    id?: string;
    name: string;
    email: string;
  }>();

  readonly mode = signal<'create' | 'signin'>('create');
  readonly errorMessage = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly validationAttempted = signal(false);

  readonly formName = signal('');
  readonly formEmail = signal('');
  readonly formPassword = signal('');
  readonly loginEmail = signal('');
  readonly loginPassword = signal('');
  readonly setupStep = signal<1 | 2 | 3 | null>(null);
  readonly setupTargetRoles = signal('');
  readonly setupPostcode = signal('');
  readonly setupCanonicalLocation = signal<CanonicalLocation | null>(null);
  readonly setupLocationSuggestions = signal<LocationOption[]>([]);
  readonly setupLocationLookup = signal<LocationLookupState>(idleLocationLookup);
  readonly showSetupLocationDropdown = signal(false);
  readonly setupWorkplaceArrangements = signal<string[]>([]);
  readonly setupAccount = signal<{
    profile: UserProfile;
    id?: string;
    name: string;
    email: string;
  } | null>(null);
  readonly setupProgress = computed(() => `${this.setupStep() ?? 1} of 3`);
  private readonly setupLocationQueries = new Subject<string>();

  readonly workplaceOptions = [
    ['ONSITE', 'On-site'],
    ['HYBRID', 'Hybrid'],
    ['REMOTE', 'Remote'],
  ] as const;

  constructor() {
    this.setupLocationQueries.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(query => this.locationService.lookup(query)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(state => {
      this.setupLocationLookup.set(state);
      this.setupLocationSuggestions.set(state.locations);
      this.showSetupLocationDropdown.set(state.status === 'results');
    });
  }

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
        this.beginSetup(response);
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

  goToSetupStep(step: 1 | 2 | 3): void {
    if (this.isLoading()) return;
    this.errorMessage.set(null);
    this.setupStep.set(step);
  }

  previousSetupStep(): void {
    const step = this.setupStep();
    if (step && step > 1) this.goToSetupStep((step - 1) as 1 | 2 | 3);
  }

  continueSetup(): void {
    const step = this.setupStep();
    this.errorMessage.set(null);
    if (step === 1) {
      if (!this.tags(this.setupTargetRoles()).length) {
        this.showError('Add at least one target role before continuing, or set this up later.');
        return;
      }
      this.setupStep.set(2);
    } else if (step === 2) {
      if (!this.setupCanonicalLocation()) {
        this.showError('Choose a location from the suggestions before continuing, or set this up later.');
        return;
      }
      this.setupStep.set(3);
    } else if (step === 3) {
      if (!this.setupWorkplaceArrangements().length) {
        this.showError('Choose at least one workplace arrangement before continuing.');
        return;
      }
      void this.finishSetup();
    }
  }

  toggleWorkplace(value: string): void {
    this.setupWorkplaceArrangements.update(current =>
      current.includes(value)
        ? current.filter(candidate => candidate !== value)
        : [...current, value]);
  }

  isWorkplaceSelected(value: string): boolean {
    return this.setupWorkplaceArrangements().includes(value);
  }

  onSetupLocationInput(query: string): void {
    this.setupPostcode.set(query);
    this.setupCanonicalLocation.set(null);
    this.setupLocationQueries.next(query.trim());
  }

  selectSetupLocation(location: LocationOption): void {
    if (!location.sessionId || !location.suggestionId) {
      this.setupLocationLookup.set({
        status: 'invalid',
        locations: [],
        message: 'Choose a more precise UK location before continuing.',
      });
      return;
    }
    this.setupLocationLookup.set({status: 'loading', locations: [], message: 'Confirming location…'});
    this.showSetupLocationDropdown.set(false);
    this.locationService.resolve(location.sessionId, location.suggestionId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: response => {
        if (response.resolutionStatus !== 'RESOLVED' || !response.location) {
          this.setupLocationLookup.set({
            status: 'invalid',
            locations: [],
            message: 'Choose a more precise UK location before continuing.',
          });
          return;
        }
        this.setupCanonicalLocation.set(response.location);
        this.setupPostcode.set(response.location.postcode ?? response.location.displayName ?? '');
        this.setupLocationSuggestions.set([]);
        this.setupLocationLookup.set({status: 'idle', locations: [], message: 'Location confirmed.'});
      },
      error: () => this.setupLocationLookup.set({
        status: 'unavailable',
        locations: [],
        message: 'Location confirmation is temporarily unavailable. Try again.',
      }),
    });
  }

  skipSetup(): void {
    if (this.isLoading()) return;
    const account = this.setupAccount();
    if (!account) return;
    this.onboarded.emit(account);
  }

  async finishSetup(): Promise<void> {
    if (this.isLoading()) return;
    const account = this.setupAccount();
    if (!account) return;
    const workplaceArrangements = this.setupWorkplaceArrangements() as unknown as
      Set<WorkPreferencesWorkplaceArrangementsEnum>;
    const location = this.setupCanonicalLocation();
    const update: ProfilePreferencesUpdate = {
      aspirations: {targetRoles: this.tags(this.setupTargetRoles())},
      workPreferences: {
        ...(location ? {location: this.profileLocation(location)} : {}),
        workplaceArrangements,
      },
    };
    const ifMatch = account.profile.revision == null
      ? undefined
      : `"${account.profile.revision}"`;

    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const response = await firstValueFrom(this.profileApi.updatePreferences(
        update, ifMatch, 'body', false, {transferCache: false},
      ));
      if (!response.success || !response.user?.profile) {
        throw new Error(response.message || 'Profile setup could not be saved.');
      }
      this.browserSession.invalidateCsrf();
      this.emitProfileFromResponse(response);
    } catch (error: unknown) {
      this.browserSession.handleAuthenticatedError(error);
      this.showError(this.httpErrorMessage(error, 'Your setup could not be saved. Please try again.'));
    } finally {
      this.isLoading.set(false);
    }
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
    this.onboarded.emit({
      profile,
      id: response.user.id,
      name: response.user.name || '',
      email: response.user.email || '',
    });
  }

  private beginSetup(response: GatewayResponse): void {
    if (!response.user) return;
    const profile = normaliseProfile(response.user.profile);
    this.setupAccount.set({
      profile,
      id: response.user.id,
      name: response.user.name || '',
      email: response.user.email || '',
    });
    this.setupStep.set(1);
  }

  private tags(value: string): string[] {
    return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
  }

  private profileLocation(location: CanonicalLocation) {
    const provenance = (field: string) => location.fieldProvenance?.find(value =>
      value.field.toUpperCase() === field.toUpperCase())?.source;
    return {
      locationId: location.locationId,
      displayName: location.displayName,
      countryCode: location.countryCode ?? 'GB',
      postcode: location.postcode?.toUpperCase(),
      region: location.region,
      adminDistrict: location.locality,
      latitude: location.latitude,
      longitude: location.longitude,
      locationType: location.locationType,
      precision: location.precision,
      confidence: location.confidence,
      googlePlaceId: location.providerReferences?.find(value =>
        value.provider === 'GOOGLE_PLACES')?.externalId,
      postcodesIoPlaceId: location.providerReferences?.find(value =>
        value.provider === 'POSTCODES_IO')?.externalId,
      displayNameSource: provenance('displayName'),
      postcodeSource: provenance('postcode'),
      coordinatesSource: provenance('coordinates'),
    };
  }
}
