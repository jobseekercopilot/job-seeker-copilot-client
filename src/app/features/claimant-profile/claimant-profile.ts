import {CommonModule} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  type WritableSignal,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {debounceTime, distinctUntilChanged, firstValueFrom, Subject, switchMap} from 'rxjs';
import {
  EvidenceLibraryService,
  ProfileService,
  WorkPreferencesEmploymentTypesEnum,
  WorkPreferencesWorkingPatternsEnum,
  WorkPreferencesWorkplaceArrangementsEnum,
} from '../../api';
import type {
  GatewayResponse,
  EvidenceEntry,
  ProfessionalContact,
  ProfessionalLink,
  ProfilePreferencesUpdate,
  UserProfile,
  WorkPreferences,
} from '../../api';
import {normaliseProfile} from '../../models/user-profile.model';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  idleLocationLookup,
  locationFailureState,
  LocationService,
  type LocationLookupState,
  type LocationOption,
  type CanonicalLocation,
} from '../../services/location.service';
import {TagInputComponent} from '../../shared/tag-input/tag-input';

type ProfileSection =
  'jobs' | 'skills' | 'location' | 'patterns' | 'availability' | 'contact';
interface EvidenceSummaryRow {
  label: string;
  categories: string[];
}

type ExtendedWorkPreferences = WorkPreferences & {
  commuteTravelModes?: Set<'DRIVE' | 'TRANSIT'>;
  maximumDrivingMinutes?: number;
  maximumTransitMinutes?: number;
};

type ExtendedLocation = NonNullable<WorkPreferences['location']> & {
  locationId?: string;
  displayName?: string;
  countryCode?: string;
  locationType?: string;
  precision?: string;
  confidence?: string;
  googlePlaceId?: string;
  postcodesIoPlaceId?: string;
  displayNameSource?: string;
  postcodeSource?: string;
  coordinatesSource?: string;
};

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
export class ClaimantProfileComponent implements OnInit {
  private readonly profileApi = inject(ProfileService);
  private readonly evidenceApi = inject(EvidenceLibraryService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly locationService = inject(LocationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private evidenceLoadSequence = 0;

  readonly claimantName = input('');
  readonly claimantEmail = input('');
  readonly profile = input<UserProfile | null>(null);
  readonly skills = input('');
  readonly experience = input('');
  readonly aspirations = input('');
  readonly workPrefs = input('');
  readonly commuteRoutingAvailable = input(false);

  readonly profileSaved = output<{profile: UserProfile; apiResult?: GatewayResponse; apiError?: unknown}>();
  readonly findJobsRequested = output<void>();
  readonly manageEvidenceRequested = output<void>();

  readonly editingSection = signal<ProfileSection | null>(null);
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly evidenceEntries = signal<EvidenceEntry[]>([]);
  readonly evidenceLoading = signal(true);
  readonly evidenceError = signal<string | null>(null);

  readonly localSkills = signal<string[]>([]);
  readonly localTargetRoles = signal<string[]>([]);
  readonly localPostcode = signal('');
  readonly localLocationId = signal<string | undefined>(undefined);
  readonly localDisplayName = signal('');
  readonly localCountryCode = signal('GB');
  readonly localLocationType = signal<string | undefined>(undefined);
  readonly localPrecision = signal<string | undefined>(undefined);
  readonly localConfidence = signal<string | undefined>(undefined);
  readonly localGooglePlaceId = signal<string | undefined>(undefined);
  readonly localPostcodesIoPlaceId = signal<string | undefined>(undefined);
  readonly localDisplayNameSource = signal<string | undefined>(undefined);
  readonly localPostcodeSource = signal<string | undefined>(undefined);
  readonly localCoordinatesSource = signal<string | undefined>(undefined);
  readonly localRegion = signal('');
  readonly localAdminDistrict = signal('');
  readonly localLatitude = signal<number | undefined>(undefined);
  readonly localLongitude = signal<number | undefined>(undefined);
  readonly localCommuteRange = signal<number | undefined>(undefined);
  readonly localCommuteTravelModes = signal<string[]>([]);
  readonly localMaximumDrivingMinutes = signal<number | undefined>(undefined);
  readonly localMaximumTransitMinutes = signal<number | undefined>(undefined);
  readonly localEmploymentTypes = signal<string[]>([]);
  readonly localWorkingPatterns = signal<string[]>([]);
  readonly localWorkplaceArrangements = signal<string[]>([]);
  readonly localAvailableFrom = signal('');
  readonly localNoticePeriodDays = signal<number | undefined>(undefined);
  readonly localProfessionalPhone = signal('');
  readonly localProfessionalLinks = signal<ProfessionalLink[]>([]);

  readonly locationSuggestions = signal<LocationOption[]>([]);
  readonly showLocationDropdown = signal(false);
  readonly activeLocationIndex = signal(-1);
  readonly locationLookup = signal<LocationLookupState>(idleLocationLookup);
  private readonly locationQueries = new Subject<string>();

  readonly searchReady = computed(() => {
    const arrangements = this.localWorkplaceArrangements();
    const needsLocation = arrangements.some(value => value === 'ONSITE' || value === 'HYBRID');
    return this.localTargetRoles().length > 0
      && arrangements.length > 0
      && (!needsLocation || Boolean(this.localLocationId()));
  });
  readonly jobSearchPreferencesProgress = computed(() => [
    this.localTargetRoles().length > 0,
    Boolean(this.localLocationId()),
    this.localWorkingPatterns().length > 0
      || this.localEmploymentTypes().length > 0
      || this.localWorkplaceArrangements().length > 0,
    Boolean(this.localAvailableFrom()) || this.localNoticePeriodDays() != null,
  ].filter(Boolean).length);
  readonly evidenceSummaryRows: EvidenceSummaryRow[] = [
    {
      label: 'Work experience',
      categories: ['EMPLOYMENT', 'FREELANCE', 'VOLUNTEERING', 'CAREER_BREAK'],
    },
    {
      label: 'Qualifications',
      categories: ['EDUCATION', 'QUALIFICATION_TRAINING'],
    },
    {
      label: 'Projects and achievements',
      categories: ['PROJECT', 'ACHIEVEMENT', 'OTHER'],
    },
  ];

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
  readonly commuteModeOptions = [
    ['DRIVE', 'Driving'],
    ['TRANSIT', 'Public transport'],
  ] as const;

  constructor() {
    this.locationQueries.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(query => this.locationService.lookup(query)),
      takeUntilDestroyed(),
    ).subscribe(state => {
      this.locationLookup.set(state);
      this.locationSuggestions.set(state.locations);
      this.showLocationDropdown.set(state.status === 'results');
      this.activeLocationIndex.set(state.status === 'results' ? 0 : -1);
    });

    effect(() => {
      const profile = normaliseProfile(this.profile());
      const commuteRoutingAvailable = this.commuteRoutingAvailable();
      if (!this.editingSection()) this.populate(profile, commuteRoutingAvailable);
    });
  }

  ngOnInit(): void {
    void this.refreshEvidenceSummary();
  }

  async refreshEvidenceSummary(): Promise<void> {
    const requestSequence = ++this.evidenceLoadSequence;
    this.evidenceLoading.set(true);
    this.evidenceError.set(null);
    try {
      const entries = await firstValueFrom(
        this.evidenceApi.listEvidence(false, 'body', false, {transferCache: false}),
      );
      if (requestSequence !== this.evidenceLoadSequence) return;
      this.evidenceEntries.set(entries.filter(entry => entry.lifecycle === 'ACTIVE'));
    } catch (error) {
      if (requestSequence !== this.evidenceLoadSequence) return;
      this.browserSession.handleAuthenticatedError(error);
      this.evidenceError.set('Experience summary unavailable.');
    } finally {
      if (requestSequence === this.evidenceLoadSequence) {
        this.evidenceLoading.set(false);
      }
    }
  }

  evidenceSummary(row: EvidenceSummaryRow): string {
    const entries = this.evidenceEntries().filter(entry => row.categories.includes(entry.category));
    const confirmed = entries.filter(entry =>
      !entry.reviewRequired
      && this.latestEvidenceRevision(entry)?.confirmationState === 'USER_CONFIRMED').length;
    const needsReview = entries.length - confirmed;
    if (!entries.length) return 'No entries yet';
    const confirmedText = `${confirmed} confirmed`;
    return needsReview
      ? `${confirmedText} · ${needsReview} ${needsReview === 1 ? 'needs' : 'need'} review`
      : confirmedText;
  }

  openEvidenceManager(): void {
    this.manageEvidenceRequested.emit();
  }

  startEditing(section: ProfileSection): void {
    this.populate(normaliseProfile(this.profile()), this.commuteRoutingAvailable());
    this.saveError.set(null);
    this.editingSection.set(section);
  }

  cancelEditing(): void {
    if (this.isSaving()) return;
    this.populate(normaliseProfile(this.profile()), this.commuteRoutingAvailable());
    this.saveError.set(null);
    this.editingSection.set(null);
  }

  async saveSection(): Promise<void> {
    if (this.isSaving()) return;
    if (this.editingSection() === 'location'
      && this.localPostcode().trim()
      && !this.localLocationId()) {
      this.saveError.set('Choose a location from the suggestions before saving.');
      return;
    }
    const editingContact = this.editingSection() === 'contact';
    const professionalContact = editingContact ? this.professionalContactPayload() : null;
    if (editingContact && professionalContact === null) return;
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
      const response = await firstValueFrom(editingContact
        ? this.profileApi.updateProfessionalContact(
            professionalContact!,
            ifMatch,
            'body',
            false,
            {transferCache: false},
          )
        : this.profileApi.updatePreferences(update, ifMatch));
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
    this.clearCanonicalLocation();
    this.localRegion.set('');
    this.localAdminDistrict.set('');
    this.localLatitude.set(undefined);
    this.localLongitude.set(undefined);
    this.locationQueries.next(query.trim());
  }

  selectLocation(location: LocationOption): void {
    if (location.sessionId && location.suggestionId) {
      this.locationLookup.set({status: 'loading', locations: [], message: 'Confirming location…'});
      this.showLocationDropdown.set(false);
      this.locationService.resolve(location.sessionId, location.suggestionId).pipe(
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: response => {
          if (response.resolutionStatus !== 'RESOLVED' || !response.location) {
            this.locationLookup.set({
              status: 'invalid',
              locations: [],
              message: 'Choose a more precise UK location before saving.',
            });
            return;
          }
          this.applyCanonicalLocation(response.location);
        },
        error: error => this.locationLookup.set(locationFailureState(error)),
      });
      return;
    }
    this.localPostcode.set(location.postcode ?? '');
    this.localDisplayName.set(location.name ?? '');
    this.localRegion.set(location.region ?? '');
    this.localAdminDistrict.set((location.name ?? '').split(',')[0].trim());
    this.localLatitude.set(location.latitude);
    this.localLongitude.set(location.longitude);
    this.locationSuggestions.set([]);
    this.showLocationDropdown.set(false);
    this.locationLookup.set(idleLocationLookup);
    this.locationQueries.next('');
  }

  onLocationKeydown(event: KeyboardEvent): void {
    const suggestions = this.locationSuggestions();
    if (event.key === 'Escape') {
      this.showLocationDropdown.set(false);
      this.activeLocationIndex.set(-1);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.showLocationDropdown.set(true);
      this.activeLocationIndex.update(index => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeLocationIndex.update(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && this.showLocationDropdown()) {
      event.preventDefault();
      const selected = suggestions[Math.max(0, this.activeLocationIndex())];
      if (selected) this.selectLocation(selected);
    }
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

  addProfessionalLink(): void {
    if (this.localProfessionalLinks().length >= 8) return;
    this.localProfessionalLinks.update(links => [...links, {label: '', url: ''}]);
  }

  updateProfessionalLink(index: number, field: keyof ProfessionalLink, value: string): void {
    this.localProfessionalLinks.update(links => links.map((link, linkIndex) =>
      linkIndex === index ? {...link, [field]: value} : link));
  }

  removeProfessionalLink(index: number): void {
    this.localProfessionalLinks.update(links =>
      links.filter((_, linkIndex) => linkIndex !== index));
  }

  triggerFinderSearch(): void {
    this.findJobsRequested.emit();
  }

  private latestEvidenceRevision(entry: EvidenceEntry) {
    return [...entry.revisions].sort((left, right) =>
      right.revisionNumber - left.revisionNumber)[0];
  }

  private populate(profile: UserProfile, commuteRoutingAvailable: boolean): void {
    this.localSkills.set(profile.skills ?? []);
    this.localTargetRoles.set(profile.aspirations?.targetRoles ?? []);
    const preferences = profile.workPreferences as ExtendedWorkPreferences | undefined;
    const location = preferences?.location as ExtendedLocation | undefined;
    this.localPostcode.set(location?.postcode ?? '');
    this.localLocationId.set(location?.locationId);
    this.localDisplayName.set(location?.displayName ?? '');
    this.localCountryCode.set(location?.countryCode ?? 'GB');
    this.localRegion.set(location?.region ?? '');
    this.localAdminDistrict.set(location?.adminDistrict ?? '');
    this.localLatitude.set(location?.latitude);
    this.localLongitude.set(location?.longitude);
    this.localLocationType.set(location?.locationType);
    this.localPrecision.set(location?.precision);
    this.localConfidence.set(location?.confidence);
    this.localGooglePlaceId.set(location?.googlePlaceId);
    this.localPostcodesIoPlaceId.set(location?.postcodesIoPlaceId);
    this.localDisplayNameSource.set(location?.displayNameSource);
    this.localPostcodeSource.set(location?.postcodeSource);
    this.localCoordinatesSource.set(location?.coordinatesSource);
    this.localCommuteRange.set(profile.workPreferences?.commuteRange);
    this.localCommuteTravelModes.set(
      commuteRoutingAvailable ? Array.from(preferences?.commuteTravelModes ?? []) : [],
    );
    this.localMaximumDrivingMinutes.set(
      commuteRoutingAvailable ? preferences?.maximumDrivingMinutes : undefined,
    );
    this.localMaximumTransitMinutes.set(
      commuteRoutingAvailable ? preferences?.maximumTransitMinutes : undefined,
    );
    this.localEmploymentTypes.set(Array.from(profile.workPreferences?.employmentTypes ?? []));
    this.localWorkingPatterns.set(Array.from(profile.workPreferences?.workingPatterns ?? []));
    this.localWorkplaceArrangements.set(Array.from(
      profile.workPreferences?.workplaceArrangements ?? []));
    this.localAvailableFrom.set(profile.workPreferences?.availableFrom ?? '');
    this.localNoticePeriodDays.set(profile.workPreferences?.noticePeriodDays);
    this.localProfessionalPhone.set(profile.professionalContact?.phone ?? '');
    this.localProfessionalLinks.set(
      (profile.professionalContact?.links ?? []).map(link => ({...link})),
    );
  }

  private professionalContactPayload(): ProfessionalContact | null {
    const phone = this.localProfessionalPhone().trim();
    const links = this.localProfessionalLinks().map(link => ({
      label: link.label.trim(),
      url: link.url.trim(),
    }));

    if (phone.length > 40
        || (phone && !/^(?=(?:\D*\d){7,15}\D*$)[+0-9() .-]+$/.test(phone))) {
      this.rejectContact('Enter a phone number with 7 to 15 digits using standard phone punctuation.');
      return null;
    }
    if (links.length > 8) {
      this.rejectContact('Add no more than 8 professional links.');
      return null;
    }
    for (const link of links) {
      if (!link.label || link.label.length > 40 || /[\p{Cc}]/u.test(link.label)) {
        this.rejectContact('Give every professional link a label of 40 characters or fewer.');
        return null;
      }
      if (link.url.length > 512 || !link.url.startsWith('https://')) {
        this.rejectContact('Every professional link must use a valid HTTPS address.');
        return null;
      }
      try {
        const parsedUrl = new URL(link.url);
        if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname
            || parsedUrl.username || parsedUrl.password) {
          this.rejectContact('Every professional link must use a valid HTTPS address.');
          return null;
        }
      } catch {
        this.rejectContact('Every professional link must use a valid HTTPS address.');
        return null;
      }
    }

    return {
      ...(phone ? {phone} : {}),
      links,
    };
  }

  private rejectContact(message: string): void {
    this.saveError.set(message);
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>('#profile-save-error')?.focus());
  }

  private workPreferencesPayload(): WorkPreferences {
    const employmentTypes = this.localEmploymentTypes() as unknown as
      Set<WorkPreferencesEmploymentTypesEnum>;
    const workingPatterns = this.localWorkingPatterns() as unknown as
      Set<WorkPreferencesWorkingPatternsEnum>;
    const workplaceArrangements = this.localWorkplaceArrangements() as unknown as
      Set<WorkPreferencesWorkplaceArrangementsEnum>;
    return {
      ...(this.localLocationId() && this.localPostcode().trim() ? {
        location: {
          locationId: this.localLocationId(),
          displayName: this.localDisplayName().trim(),
          countryCode: this.localCountryCode(),
          postcode: this.localPostcode().trim().toUpperCase(),
          region: this.localRegion().trim(),
          adminDistrict: this.localAdminDistrict().trim(),
          latitude: this.localLatitude(),
          longitude: this.localLongitude(),
          locationType: this.localLocationType(),
          precision: this.localPrecision(),
          confidence: this.localConfidence(),
          googlePlaceId: this.localGooglePlaceId(),
          postcodesIoPlaceId: this.localPostcodesIoPlaceId(),
          displayNameSource: this.localDisplayNameSource(),
          postcodeSource: this.localPostcodeSource(),
          coordinatesSource: this.localCoordinatesSource(),
        },
      } : {}),
      ...(this.localCommuteRange() == null ? {} : {commuteRange: this.localCommuteRange()}),
      commuteTravelModes: (this.commuteRoutingAvailable()
        ? this.localCommuteTravelModes()
        : []) as unknown as Set<'DRIVE' | 'TRANSIT'>,
      ...(this.commuteRoutingAvailable()
        && this.localCommuteTravelModes().includes('DRIVE')
        && this.localMaximumDrivingMinutes() != null
        ? {maximumDrivingMinutes: this.localMaximumDrivingMinutes()}
        : {}),
      ...(this.commuteRoutingAvailable()
        && this.localCommuteTravelModes().includes('TRANSIT')
        && this.localMaximumTransitMinutes() != null
        ? {maximumTransitMinutes: this.localMaximumTransitMinutes()}
        : {}),
      employmentTypes,
      workingPatterns,
      workplaceArrangements,
      ...(this.localAvailableFrom() ? {availableFrom: this.localAvailableFrom()} : {}),
      ...(this.localNoticePeriodDays() == null
        ? {}
        : {noticePeriodDays: this.localNoticePeriodDays()}),
    } as ExtendedWorkPreferences;
  }

  private applyCanonicalLocation(location: CanonicalLocation): void {
    const normaliseField = (field: string) => field.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const provenance = (field: string) => location.fieldProvenance?.find(value =>
      normaliseField(value.field) === normaliseField(field))?.source;
    this.localLocationId.set(location.locationId);
    this.localDisplayName.set(location.displayName ?? '');
    this.localCountryCode.set(location.countryCode ?? 'GB');
    this.localPostcode.set(location.postcode ?? location.displayName ?? '');
    this.localRegion.set(location.region ?? '');
    this.localAdminDistrict.set(location.locality ?? '');
    this.localLatitude.set(location.latitude);
    this.localLongitude.set(location.longitude);
    this.localLocationType.set(location.locationType);
    this.localPrecision.set(location.precision);
    this.localConfidence.set(location.confidence);
    this.localGooglePlaceId.set(location.providerReferences?.find(value => value.provider === 'GOOGLE_PLACES')?.externalId);
    this.localPostcodesIoPlaceId.set(location.providerReferences?.find(value => value.provider === 'POSTCODES_IO')?.externalId);
    this.localDisplayNameSource.set(provenance('displayName'));
    this.localPostcodeSource.set(provenance('postcode'));
    this.localCoordinatesSource.set(provenance('coordinates'));
    this.locationSuggestions.set([]);
    this.showLocationDropdown.set(false);
    this.activeLocationIndex.set(-1);
    this.locationLookup.set({status: 'idle', locations: [], message: 'Location confirmed.'});
  }

  private clearCanonicalLocation(): void {
    this.localLocationId.set(undefined);
    this.localDisplayName.set('');
    this.localCountryCode.set('GB');
    this.localLocationType.set(undefined);
    this.localPrecision.set(undefined);
    this.localConfidence.set(undefined);
    this.localGooglePlaceId.set(undefined);
    this.localPostcodesIoPlaceId.set(undefined);
    this.localDisplayNameSource.set(undefined);
    this.localPostcodeSource.set(undefined);
    this.localCoordinatesSource.set(undefined);
  }
}
