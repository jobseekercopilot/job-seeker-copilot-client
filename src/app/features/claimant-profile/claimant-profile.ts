import { ChangeDetectionStrategy, Component, input, output, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { LocationService, UKLocation } from '../../services/location.service';
import { TagInputComponent } from '../../shared/tag-input/tag-input';
import { QualificationFormComponent } from '../../shared/qualification-form/qualification-form';
import { RoleFormComponent } from '../../shared/role-form/role-form';
import type {
  GatewayResponse,
  UserProfile,
  Qualification,
  Role
} from '../../api';
import { AspirationsTargetWeeklyHoursEnum, Configuration, ProfileService } from '../../api';
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
  private userManagementConfig = inject(Configuration);
  private locationService = inject(LocationService);

  // Inputs remain as free-text strings for backward compatibility with app.ts and localStorage
  claimantName = input<string>('');
  claimantEmail = input<string>('');
  authToken = input<string>('');
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

  commuteDistanceOptions = [5, 10, 15, 25, 50];

  constructor() {
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
    this.isEditing.set(false);
  }

  async save(): Promise<void> {
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

    this.isSaving.set(true);
    try {
      this.userManagementConfig.credentials['bearerAuth'] = () => {
        const header = this.authorizationHeader();
        return header?.replace(/^Bearer\s+/i, '');
      };
      const apiResult = await firstValueFrom(
        this.userManagementApi.updateProfile(profile)
      );
      this.profileSaved.emit({ profile, apiResult });
      this.isEditing.set(false);
    } catch (apiError) {
      this.profileSaved.emit({ profile, apiError });
    } finally {
      this.isSaving.set(false);
    }
  }

  private authorizationHeader(): string | undefined {
    const token = this.authToken().trim();
    if (!token) return undefined;
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  onLocationInputChange(query: string) {
    this.localPostcode.set(query);
    if (!query || query.trim().length < 2) {
      this.locationSuggestions.set([]);
      this.showLocationDropdown.set(false);
      return;
    }

    const cleanQuery = query.trim();
    const isPostcodeOrOutcode = /^[A-Z]{1,2}[0-9]/i.test(cleanQuery);

    if (isPostcodeOrOutcode) {
      this.locationService.getByPostcode(cleanQuery).subscribe({
        next: (res) => {
          if (res.success && res.locations && res.locations.length > 0) {
            this.locationSuggestions.set(res.locations);
            this.showLocationDropdown.set(true);
          } else {
            this.locationSuggestions.set([]);
            this.showLocationDropdown.set(false);
          }
        },
        error: () => {
          this.locationSuggestions.set([]);
          this.showLocationDropdown.set(false);
        }
      });
    } else {
      this.locationService.search(cleanQuery).subscribe({
        next: (res) => {
          if (res.success && res.locations) {
            this.locationSuggestions.set(res.locations);
            this.showLocationDropdown.set(true);
          } else {
            this.locationSuggestions.set([]);
            this.showLocationDropdown.set(false);
          }
        },
        error: () => {
          this.locationSuggestions.set([]);
          this.showLocationDropdown.set(false);
        }
      });
    }
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

    this.locationService.getByPostcode(postcode).subscribe({
      next: (res) => {
        if (res.success && res.locations && res.locations.length > 0) {
          const l = res.locations[0];
          this.localRegion.set(l.region ?? '');
          this.localAdminDistrict.set(this.safeSplitName(l.name));
        }
      }
    });

    this.locationSuggestions.set([]);
    this.showLocationDropdown.set(false);
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
