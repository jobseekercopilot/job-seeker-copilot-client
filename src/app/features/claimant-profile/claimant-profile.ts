import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import {firstValueFrom, Subject, switchMap} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {
  idleLocationLookup,
  LocationService,
  type LocationLookupState,
  type UKLocation,
} from '../../services/location.service';
import { TagInputComponent } from '../../shared/tag-input/tag-input';
import { QualificationFormComponent } from '../../shared/qualification-form/qualification-form';
import { RoleFormComponent } from '../../shared/role-form/role-form';
import type {
  GatewayResponse,
  UserProfile,
  Qualification,
  Role
} from '../../api';
import { AspirationsTargetWeeklyHoursEnum, ProfileService } from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  normaliseProfile,
  serialiseProfile
} from '../../models/user-profile.model';

type TargetWeeklyHours = AspirationsTargetWeeklyHoursEnum;

@Component({
  selector: 'app-claimant-profile',
  imports: [
    CommonModule,
    MatIconModule,
    FormsModule,
    TagInputComponent,
    QualificationFormComponent,
    RoleFormComponent
  ],
  host: {
    'data-demo-focus': 'app-claimant-profile',
    'data-demo-focus-id': 'claimant-profile'
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './claimant-profile.html',
  styleUrl: './claimant-profile.css'
})
export class ClaimantProfileComponent {
  private userManagementApi = inject(ProfileService);
  private browserSession = inject(BrowserSessionService);
  private locationService = inject(LocationService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Free-text inputs remain for compatibility with the retained non-beta shell.
  claimantName = input<string>('');
  claimantEmail = input<string>('');
  profile = input<UserProfile | null>(null);
  skills = input<string>('');
  experience = input<string>('');
  aspirations = input<string>('');
  workPrefs = input<string>('');

  // Emit structured UserProfile JSON for API submission
  profileSaved = output<{ profile: UserProfile; apiResult?: GatewayResponse; apiError?: unknown }>();
  logoutRequested = output<void>();
  findJobsRequested = output<void>();

  isEditing = signal(false);
  isSaving = signal(false);
  saveError = signal<string | null>(null);

  // ===== Structured Form State =====
  // These are initialised from the free-text inputs when editing begins.
  localSkills = signal<string[]>([]);
  localQualifications = signal<Qualification[]>([]);
  localRoles = signal<Role[]>([]);
  localTargetRoles = signal<string[]>([]);
  localTargetWeeklyHours = signal<TargetWeeklyHours>(AspirationsTargetWeeklyHoursEnum.FullTime);

  // Work Preferences
  localPostcode = signal('');
  localRegion = signal('');
  localAdminDistrict = signal('');
  localLatitude = signal<number | undefined>(undefined);
  localLongitude = signal<number | undefined>(undefined);
  localCommuteRange = signal<number>(10);

  locationSuggestions = signal<UKLocation[]>([]);
  showLocationDropdown = signal<boolean>(false);
  locationLookup = signal<LocationLookupState>(idleLocationLookup);
  private locationQueries = new Subject<string>();

  commuteDistanceOptions = [5, 10, 15, 25, 50];

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
      const profile = this.profile() || normaliseProfile({
        skills: this.skills(),
        experience: this.experience(),
        aspirations: this.aspirations(),
        workPrefs: this.workPrefs()
      });

      if (!this.isEditing()) this.populateForm(profile);
    });
  }

  startEditing() {
    const profile = this.profile() || normaliseProfile({
      skills: this.skills(),
      experience: this.experience(),
      aspirations: this.aspirations(),
      workPrefs: this.workPrefs()
    });

    this.populateForm(profile);
    this.saveError.set(null);
    this.isEditing.set(true);
  }

  private populateForm(profile: UserProfile): void {
    this.localSkills.set(profile.skills || []);
    this.localQualifications.set(profile.qualifications || []);
    this.localRoles.set(profile.roles || []);
    this.localTargetRoles.set(profile.aspirations?.targetRoles || []);
    this.localTargetWeeklyHours.set(profile.aspirations?.targetWeeklyHours || AspirationsTargetWeeklyHoursEnum.FullTime);
    this.localPostcode.set(profile.workPreferences?.location?.postcode || '');
    this.localRegion.set(profile.workPreferences?.location?.region || '');
    this.localAdminDistrict.set(profile.workPreferences?.location?.adminDistrict || '');
    this.localLatitude.set(profile.workPreferences?.location?.latitude);
    this.localLongitude.set(profile.workPreferences?.location?.longitude);
    this.localCommuteRange.set(profile.workPreferences?.commuteRange || 10);
  }

  cancelEditing() {
    if (this.isSaving()) return;
    this.saveError.set(null);
    this.isEditing.set(false);
  }

  async save(): Promise<void> {
    if (this.isSaving()) return;
    const profile: UserProfile = serialiseProfile({
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
          region: this.localRegion(),
          adminDistrict: this.localAdminDistrict(),
          latitude: this.localLatitude(),
          longitude: this.localLongitude()
        },
        commuteRange: this.localCommuteRange()
      }
    });

    this.saveError.set(null);
    this.isSaving.set(true);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const apiResult = await firstValueFrom(
        this.userManagementApi.updateProfile(profile)
      );
      this.profileSaved.emit({ profile, apiResult });
      this.isEditing.set(false);
    } catch (apiError) {
      this.browserSession.handleAuthenticatedError(apiError);
      this.profileSaved.emit({ profile, apiError });
      this.saveError.set('Your profile could not be saved. Check your connection and try again.');
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#profile-save-error')?.focus());
    } finally {
      this.browserSession.invalidateCsrf();
      this.isSaving.set(false);
    }
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

  targetWeeklyHoursLabel(): string {
    const map: Record<string, string> = {
      'FULL_TIME': 'Full-Time (35-40 hours)',
      'PART_TIME_16_30': 'Part-Time (16-30 hours)',
      'PART_TIME_UNDER_16': 'Part-Time (Under 16 hours)',
      'FLEXIBLE': 'Flexible / Any Hours'
    };
    return map[this.localTargetWeeklyHours()] || this.localTargetWeeklyHours();
  }

  triggerLogout() {
    this.logoutRequested.emit();
  }

  triggerFinderSearch() {
    this.findJobsRequested.emit();
  }
}
