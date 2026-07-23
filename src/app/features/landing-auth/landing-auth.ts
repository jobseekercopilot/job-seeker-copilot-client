import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import {
  idleLocationLookup,
  LocationService,
  type LocationLookupState,
  type UKLocation,
} from '../../services/location.service';
import {firstValueFrom, Subject, switchMap} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  output,
  signal,
  inject
} from '@angular/core';
import { TagInputComponent } from '../../shared/tag-input/tag-input';
import { QualificationFormComponent } from '../../shared/qualification-form/qualification-form';
import { RoleFormComponent } from '../../shared/role-form/role-form';
import type {
  GatewayResponse,
  UserProfile,
  Qualification,
  Role
} from '../../api';
import { AspirationsTargetWeeklyHoursEnum, AuthenticationService } from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  normaliseProfile,
  serialiseProfile,
  emptyUserProfile
} from '../../models/user-profile.model';

type TargetWeeklyHours = AspirationsTargetWeeklyHoursEnum;

@Component({
  selector: 'app-landing-auth',
  imports: [CommonModule, MatIconModule, FormsModule, TagInputComponent, QualificationFormComponent, RoleFormComponent],
  host: {
    'data-demo-focus': 'app-landing-auth',
    'data-demo-focus-id': 'registration-form'
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing-auth.html',
  styleUrl: './landing-auth.css'
})
export class LandingAuthComponent {
  private userManagementApi = inject(AuthenticationService);
  private browserSession = inject(BrowserSessionService);
  private locationService = inject(LocationService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  locationSuggestions = signal<UKLocation[]>([]);
  showLocationDropdown = signal<boolean>(false);
  locationLookup = signal<LocationLookupState>(idleLocationLookup);
  private locationQueries = new Subject<string>();

  onboarded = output<{
    profile: UserProfile;
    name: string;
    email: string;
  }>();

  mode = signal<'create' | 'signin'>('create');
  currentStep = signal<number>(1);
  errorMessage = signal<string | null>(null);
  isLoading = signal<boolean>(false);
  validationAttempted = signal<boolean>(false);

  // Auth Field Signals
  formName = signal('');
  formEmail = signal('');
  formPassword = signal('');

  // Structured Form State (aligned with claimant-profile)
  localSkills = signal<string[]>([]);
  localQualifications = signal<Qualification[]>([]);
  localRoles = signal<Role[]>([]);
  localTargetRoles = signal<string[]>([]);
  localTargetWeeklyHours = signal<TargetWeeklyHours>(AspirationsTargetWeeklyHoursEnum.FullTime);
  localPostcode = signal('');
  localRegion = signal('');
  localAdminDistrict = signal('');
  localLatitude = signal<number | undefined>(undefined);
  localLongitude = signal<number | undefined>(undefined);
  localCommuteRange = signal<number>(10);

  commuteDistanceOptions = [5, 10, 15, 25, 50];

  targetHoursOptions = [
    { value: 'FULL_TIME', label: 'Full-Time (35-40 hours)' },
    { value: 'PART_TIME_16_30', label: 'Part-Time (16-30 hours)' },
    { value: 'PART_TIME_UNDER_16', label: 'Part-Time (Under 16 hours)' },
    { value: 'FLEXIBLE', label: 'Flexible / Any Hours' }
  ] as const;

  // Sign In Field Signals
  loginEmail = signal('');
  loginPassword = signal('');

  constructor() {
    this.locationQueries.pipe(
      switchMap(query => this.locationService.lookup(query)),
      takeUntilDestroyed(),
    ).subscribe(state => {
      this.locationLookup.set(state);
      this.locationSuggestions.set(state.locations);
      this.showLocationDropdown.set(state.status === 'results');
    });
  }

  onLocationInputChange(query: string) {
    this.localPostcode.set(query);
    this.clearDerivedLocation();
    this.locationQueries.next((query || '').trim());
  }

  private clearDerivedLocation(): void {
    this.localRegion.set('');
    this.localAdminDistrict.set('');
    this.localLatitude.set(undefined);
    this.localLongitude.set(undefined);
  }

  private safeSplitName(name: unknown): string {
    const nameStr = typeof name === 'string' ? name : '';
    return nameStr.split(',')[0].trim();
  }

  selectLocation(loc: UKLocation) {
    const postcode = loc.postcode ?? '';
    this.localPostcode.set(postcode);
    this.localRegion.set(loc.region ?? '');
    this.localAdminDistrict.set(this.safeSplitName(loc.name));
    this.localLatitude.set(loc.latitude);
    this.localLongitude.set(loc.longitude);

    this.locationSuggestions.set([]);
    this.showLocationDropdown.set(false);
    this.locationLookup.set(idleLocationLookup);
    this.locationQueries.next('');
  }

  hideLocationDropdownWithDelay() {
    setTimeout(() => {
      this.showLocationDropdown.set(false);
    }, 250);
  }

  setMode(newMode: 'create' | 'signin') {
    this.mode.set(newMode);
    this.errorMessage.set(null);
    this.validationAttempted.set(false);
    if (newMode === 'create') {
      this.currentStep.set(1);
      this.resetForm();
    }
  }

  onModeTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const newMode = event.key === 'ArrowRight' || event.key === 'End' ? 'signin' : 'create';
    this.setMode(newMode);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(
      newMode === 'create' ? '#tab-btn-create' : '#tab-btn-signin'
    )?.focus());
  }

  private resetForm() {
    this.formName.set('');
    this.formEmail.set('');
    this.formPassword.set('');
    const empty = emptyUserProfile();
    this.localSkills.set(empty.skills || []);
    this.localQualifications.set(empty.qualifications || []);
    this.localRoles.set(empty.roles || []);
    this.localTargetRoles.set(empty.aspirations?.targetRoles || []);
    this.localTargetWeeklyHours.set(empty.aspirations?.targetWeeklyHours || AspirationsTargetWeeklyHoursEnum.FullTime);
    this.localPostcode.set(empty.workPreferences?.location?.postcode || '');
    this.localRegion.set(empty.workPreferences?.location?.region || '');
    this.localAdminDistrict.set(empty.workPreferences?.location?.adminDistrict || '');
    this.localLatitude.set(empty.workPreferences?.location?.latitude);
    this.localLongitude.set(empty.workPreferences?.location?.longitude);
    this.localCommuteRange.set(empty.workPreferences?.commuteRange || 10);
  }

  isStepValid(): boolean {
    if (this.mode() !== 'create') return true;

    const step = this.currentStep();
    if (step === 1) {
      return this.formName().trim().length >= 2 && this.formEmail().includes('@') && this.formPassword().trim().length >= 6;
    }
    if (step === 2) {
      return this.localSkills().length > 0;
    }
    if (step === 3) {
      return this.localTargetRoles().length > 0 && this.localPostcode().trim().length >= 4;
    }
    return true;
  }

  nextStep() {
    if (this.isStepValid() && this.currentStep() < 3) {
      this.errorMessage.set(null);
      this.validationAttempted.set(false);
      this.currentStep.update(s => s + 1);
      this.focusCurrentStep();
      return;
    }
    this.validationAttempted.set(true);
    this.showError(this.validationMessage());
  }

  submitRegistrationStep(): void {
    if (this.currentStep() < 3) {
      this.nextStep();
      return;
    }
    void this.completeRegistration();
  }

  prevStep() {
    if (this.currentStep() > 1) {
      this.errorMessage.set(null);
      this.validationAttempted.set(false);
      this.currentStep.update(s => s - 1);
      this.focusCurrentStep();
    }
  }

  async completeRegistration() {
    if (this.isLoading()) return;
    if (!this.isStepValid()) {
      this.validationAttempted.set(true);
      this.showError(this.validationMessage());
      return;
    }
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const structuredProfile: UserProfile = serialiseProfile({
      skills: this.localSkills(),
      qualifications: this.localQualifications(),
      roles: this.localRoles(),
      aspirations: {
        targetRoles: this.localTargetRoles(),
        targetWeeklyHours: this.localTargetWeeklyHours()
      },
      workPreferences: {
        location: {
          postcode: this.localPostcode().trim().toUpperCase(),
          region: this.localRegion().trim(),
          adminDistrict: this.localAdminDistrict().trim(),
          latitude: this.localLatitude(),
          longitude: this.localLongitude()
        },
        commuteRange: this.localCommuteRange()
      }
    });

    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const res = await firstValueFrom(this.userManagementApi.register({
        name: this.formName().trim(),
        email: this.formEmail().trim().toLowerCase(),
        password: this.formPassword().trim(),
        profile: structuredProfile
      }));

      if (res.success && res.user) {
        this.browserSession.invalidateCsrf();
        this.emitProfileFromResponse(res);
      } else {
        this.showError(res.message || 'Registration failed at gateway level.');
      }
    } catch (error: unknown) {
      this.showError(this.httpErrorMessage(error, 'Unable to contact the registration service.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  async submitLogin() {
    if (this.isLoading()) return;
    const email = this.loginEmail().trim();
    const password = this.loginPassword().trim();

    if (!email || !password) {
      this.validationAttempted.set(true);
      this.showError('Enter both your email address and password.');
      return;
    }

    this.validationAttempted.set(false);
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const res = await firstValueFrom(this.userManagementApi.login({
        email: email.toLowerCase(),
        password
      }));

      if (res.success && res.user) {
        this.browserSession.invalidateCsrf();
        this.emitProfileFromResponse(res);
      } else {
        this.showError(res.message || 'Verification failed.');
      }
    } catch (error: unknown) {
      this.showError(this.httpErrorMessage(error, 'Unable to contact the authentication service.'));
    } finally {
      this.isLoading.set(false);
    }
  }

  isRegistrationFieldInvalid(field: 'name' | 'email' | 'password' | 'postcode'): boolean {
    if (!this.validationAttempted()) return false;
    if (field === 'name') return this.formName().trim().length < 2;
    if (field === 'email') return !this.formEmail().includes('@');
    if (field === 'password') return this.formPassword().trim().length < 6;
    return this.localPostcode().trim().length < 4;
  }

  isLoginFieldInvalid(field: 'email' | 'password'): boolean {
    if (!this.validationAttempted()) return false;
    return field === 'email' ? !this.loginEmail().trim() : !this.loginPassword().trim();
  }

  private validationMessage(): string {
    const step = this.currentStep();
    if (step === 1) return 'Check your name, email address and password before continuing.';
    if (step === 2) return 'Add at least one core skill before continuing.';
    return 'Add at least one target role and a valid home location before creating your profile.';
  }

  private showError(message: string): void {
    this.errorMessage.set(message);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#auth-error-alert')?.focus());
  }

  private focusCurrentStep(): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`#step-${this.currentStep()} h3`)?.focus());
  }

  private httpErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null || !('error' in error)) return fallback;
    const body = (error as { error?: unknown }).error;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }

  private emitProfileFromResponse(res: GatewayResponse): void {
    if (!res.user) return;
    const profile = normaliseProfile(res.user.profile);
    this.browserSession.acceptAuthenticatedUser({...res.user, profile});

    this.onboarded.emit({
      profile,
      name: res.user.name || '',
      email: res.user.email || ''
    });
  }

}
