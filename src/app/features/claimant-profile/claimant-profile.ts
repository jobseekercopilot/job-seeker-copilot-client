import {CommonModule} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  type WritableSignal,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {firstValueFrom, Subject, switchMap} from 'rxjs';
import {
  ProfileService,
  WorkPreferencesEmploymentTypesEnum,
  WorkPreferencesWorkingPatternsEnum,
  WorkPreferencesWorkplaceArrangementsEnum,
} from '../../api';
import type {
  GatewayResponse,
  ProfilePreferencesUpdate,
  UserProfile,
  WorkPreferences,
} from '../../api';
import {normaliseProfile} from '../../models/user-profile.model';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  idleLocationLookup,
  LocationService,
  type LocationLookupState,
  type UKLocation,
} from '../../services/location.service';
import {TagInputComponent} from '../../shared/tag-input/tag-input';

type ProfileSection = 'jobs' | 'skills' | 'location' | 'patterns' | 'availability';

@Component({
  selector: 'app-claimant-profile',
  imports: [CommonModule, MatIconModule, FormsModule, TagInputComponent],
  host: {
    'data-demo-focus': 'app-claimant-profile',
    'data-demo-focus-id': 'claimant-profile',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './claimant-profile.html',
  styleUrl: './claimant-profile.css',
})
export class ClaimantProfileComponent {
  private readonly profileApi = inject(ProfileService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly locationService = inject(LocationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly claimantName = input('');
  readonly claimantEmail = input('');
  readonly profile = input<UserProfile | null>(null);
  readonly skills = input('');
  readonly experience = input('');
  readonly aspirations = input('');
  readonly workPrefs = input('');

  readonly profileSaved = output<{profile: UserProfile; apiResult?: GatewayResponse; apiError?: unknown}>();
  readonly findJobsRequested = output<void>();

  readonly editingSection = signal<ProfileSection | null>(null);
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly localSkills = signal<string[]>([]);
  readonly localTargetRoles = signal<string[]>([]);
  readonly localPostcode = signal('');
  readonly localRegion = signal('');
  readonly localAdminDistrict = signal('');
  readonly localLatitude = signal<number | undefined>(undefined);
  readonly localLongitude = signal<number | undefined>(undefined);
  readonly localCommuteRange = signal<number | undefined>(undefined);
  readonly localEmploymentTypes = signal<string[]>([]);
  readonly localWorkingPatterns = signal<string[]>([]);
  readonly localWorkplaceArrangements = signal<string[]>([]);
  readonly localAvailableFrom = signal('');
  readonly localNoticePeriodDays = signal<number | undefined>(undefined);

  readonly locationSuggestions = signal<UKLocation[]>([]);
  readonly showLocationDropdown = signal(false);
  readonly locationLookup = signal<LocationLookupState>(idleLocationLookup);
  private readonly locationQueries = new Subject<string>();

  readonly searchReady = computed(() => {
    const arrangements = this.localWorkplaceArrangements();
    const needsLocation = arrangements.some(value => value === 'ONSITE' || value === 'HYBRID');
    return this.localTargetRoles().length > 0
      && arrangements.length > 0
      && (!needsLocation || Boolean(this.localPostcode().trim()));
  });
  readonly profileProgress = computed(() => [
    this.localTargetRoles().length > 0,
    this.localSkills().length > 0,
    Boolean(this.localPostcode()),
    this.localWorkingPatterns().length > 0
      || this.localEmploymentTypes().length > 0
      || this.localWorkplaceArrangements().length > 0,
    Boolean(this.localAvailableFrom()) || this.localNoticePeriodDays() != null,
  ].filter(Boolean).length);

  readonly employmentTypeOptions = [
    ['PERMANENT', 'Permanent'],
    ['FIXED_TERM', 'Fixed term'],
    ['TEMPORARY', 'Temporary'],
    ['APPRENTICESHIP', 'Apprenticeship'],
    ['CONTRACT', 'Contract'],
  ] as const;
  readonly workingPatternOptions = [
    ['FULL_TIME', 'Full time'],
    ['PART_TIME', 'Part time'],
    ['FLEXIBLE', 'Flexible'],
    ['DAY', 'Day'],
    ['EVENING', 'Evening'],
    ['NIGHT', 'Night'],
    ['WEEKEND', 'Weekend'],
    ['SHIFT', 'Shift'],
  ] as const;
  readonly workplaceOptions = [
    ['ONSITE', 'On-site'],
    ['HYBRID', 'Hybrid'],
    ['REMOTE', 'Remote'],
  ] as const;
  readonly commuteDistanceOptions = [5, 10, 15, 25, 50];

  constructor() {
    this.locationQueries.pipe(
      switchMap(query => this.locationService.lookup(query)),
      takeUntilDestroyed(),
    ).subscribe(state => {
      this.locationLookup.set(state);
      this.locationSuggestions.set(state.locations);
      this.showLocationDropdown.set(state.status === 'results');
    });

    effect(() => {
      const profile = normaliseProfile(this.profile());
      if (!this.editingSection()) this.populate(profile);
    });
  }

  startEditing(section: ProfileSection): void {
    this.populate(normaliseProfile(this.profile()));
    this.saveError.set(null);
    this.editingSection.set(section);
  }

  cancelEditing(): void {
    if (this.isSaving()) return;
    this.populate(normaliseProfile(this.profile()));
    this.saveError.set(null);
    this.editingSection.set(null);
  }

  async saveSection(): Promise<void> {
    if (this.isSaving()) return;
    const update: ProfilePreferencesUpdate = {
      skills: this.localSkills(),
      aspirations: {
        targetRoles: this.localTargetRoles(),
        ...(this.profile()?.aspirations?.targetWeeklyHours
          ? {targetWeeklyHours: this.profile()!.aspirations!.targetWeeklyHours}
          : {}),
      },
      workPreferences: this.workPreferencesPayload(),
    };
    const ifMatch = this.profile()?.revision == null
      ? undefined
      : `"${this.profile()!.revision}"`;

    this.isSaving.set(true);
    this.saveError.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const response = await firstValueFrom(this.profileApi.updatePreferences(update, ifMatch));
      if (!response.success || !response.user?.profile) {
        throw new Error(response.message || 'Profile update was rejected.');
      }
      const profile = normaliseProfile(response.user.profile);
      this.browserSession.updateCurrentProfile(profile);
      this.profileSaved.emit({profile, apiResult: response});
      this.editingSection.set(null);
    } catch (apiError) {
      this.browserSession.handleAuthenticatedError(apiError);
      this.profileSaved.emit({profile: normaliseProfile(this.profile()), apiError});
      const status = typeof apiError === 'object' && apiError !== null && 'status' in apiError
        ? Number((apiError as {status?: unknown}).status)
        : undefined;
      this.saveError.set(status === 409
        ? 'Your profile changed in another session. Reload and try again.'
        : 'This section could not be saved. Check the highlighted information and try again.');
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#profile-save-error')?.focus());
    } finally {
      this.browserSession.invalidateCsrf();
      this.isSaving.set(false);
    }
  }

  onLocationInputChange(query: string): void {
    this.localPostcode.set(query);
    this.localRegion.set('');
    this.localAdminDistrict.set('');
    this.localLatitude.set(undefined);
    this.localLongitude.set(undefined);
    this.locationQueries.next(query.trim());
  }

  selectLocation(location: UKLocation): void {
    this.localPostcode.set(location.postcode ?? '');
    this.localRegion.set(location.region ?? '');
    this.localAdminDistrict.set((location.name ?? '').split(',')[0].trim());
    this.localLatitude.set(location.latitude);
    this.localLongitude.set(location.longitude);
    this.locationSuggestions.set([]);
    this.showLocationDropdown.set(false);
    this.locationLookup.set(idleLocationLookup);
    this.locationQueries.next('');
  }

  toggleSelection(values: WritableSignal<string[]>, value: string): void {
    values.update(current =>
      current.includes(value)
        ? current.filter(candidate => candidate !== value)
        : [...current, value]);
  }

  isSelected(values: string[], value: string): boolean {
    return values.includes(value);
  }

  triggerFinderSearch(): void {
    this.findJobsRequested.emit();
  }

  private populate(profile: UserProfile): void {
    this.localSkills.set(profile.skills ?? []);
    this.localTargetRoles.set(profile.aspirations?.targetRoles ?? []);
    this.localPostcode.set(profile.workPreferences?.location?.postcode ?? '');
    this.localRegion.set(profile.workPreferences?.location?.region ?? '');
    this.localAdminDistrict.set(profile.workPreferences?.location?.adminDistrict ?? '');
    this.localLatitude.set(profile.workPreferences?.location?.latitude);
    this.localLongitude.set(profile.workPreferences?.location?.longitude);
    this.localCommuteRange.set(profile.workPreferences?.commuteRange);
    this.localEmploymentTypes.set(Array.from(profile.workPreferences?.employmentTypes ?? []));
    this.localWorkingPatterns.set(Array.from(profile.workPreferences?.workingPatterns ?? []));
    this.localWorkplaceArrangements.set(Array.from(
      profile.workPreferences?.workplaceArrangements ?? []));
    this.localAvailableFrom.set(profile.workPreferences?.availableFrom ?? '');
    this.localNoticePeriodDays.set(profile.workPreferences?.noticePeriodDays);
  }

  private workPreferencesPayload(): WorkPreferences {
    const employmentTypes = this.localEmploymentTypes() as unknown as
      Set<WorkPreferencesEmploymentTypesEnum>;
    const workingPatterns = this.localWorkingPatterns() as unknown as
      Set<WorkPreferencesWorkingPatternsEnum>;
    const workplaceArrangements = this.localWorkplaceArrangements() as unknown as
      Set<WorkPreferencesWorkplaceArrangementsEnum>;
    return {
      ...(this.localPostcode().trim() ? {
        location: {
          postcode: this.localPostcode().trim().toUpperCase(),
          region: this.localRegion().trim(),
          adminDistrict: this.localAdminDistrict().trim(),
          latitude: this.localLatitude(),
          longitude: this.localLongitude(),
        },
      } : {}),
      ...(this.localCommuteRange() == null ? {} : {commuteRange: this.localCommuteRange()}),
      employmentTypes,
      workingPatterns,
      workplaceArrangements,
      ...(this.localAvailableFrom() ? {availableFrom: this.localAvailableFrom()} : {}),
      ...(this.localNoticePeriodDays() == null
        ? {}
        : {noticePeriodDays: this.localNoticePeriodDays()}),
    };
  }
}
