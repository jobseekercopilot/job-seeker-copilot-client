import { ChangeDetectionStrategy, Component, input, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { parseWorkPrefs, WorkPreference } from '../../utils/work-prefs';
import { LocationService, UKLocation } from '../../services/location.service';

@Component({
  selector: 'app-claimant-profile',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './claimant-profile.html',
  styleUrl: './claimant-profile.css'
})
export class ClaimantProfileComponent {
  private locationService = inject(LocationService);

  claimantName = input<string>('Sarah Jenkins');
  claimantEmail = input<string>('sarah.jenkins@gmail.com');
  skills = input<string>('');
  experience = input<string>('');
  aspirations = input<string>('');
  workPrefs = input<string>('');

  profileSaved = output<{ skills: string; experience: string; aspirations: string; workPrefs: string }>();
  logoutRequested = output<void>();
  findJobsRequested = output<void>();

  isEditing = signal(false);

  // Local write cache
  localSkills = signal('');
  localExperience = signal('');
  localAspirations = signal('');

  // Structured Work Preferences Write Cache
  localTargetHours = signal('');
  localPostcode = signal('');
  localCommuteDistance = signal('');
  localRegion = signal('');
  localAdminDistrict = signal('');

  locationSuggestions = signal<UKLocation[]>([]);
  showLocationDropdown = signal<boolean>(false);

  targetHoursOptions = [
    'Full-Time (35-40 hours)',
    'Part-Time (16-30 hours)',
    'Part-Time (Under 16 hours)',
    'Flexible / Any Hours'
  ];

  commuteDistanceOptions = [
    '5 miles',
    '10 miles',
    '15 miles',
    '25 miles',
    '50 miles'
  ];

  parsedWorkPrefs(): WorkPreference {
    return parseWorkPrefs(this.workPrefs());
  }

  startEditing() {
    this.localSkills.set(this.skills());
    this.localExperience.set(this.experience());
    this.localAspirations.set(this.aspirations());
    
    // Populate structured preferences from workPrefs input
    const parsed = parseWorkPrefs(this.workPrefs());
    this.localTargetHours.set(parsed.hours);
    this.localPostcode.set(parsed.postcode);
    this.localCommuteDistance.set(parsed.distance);
    this.localRegion.set(parsed.region);
    this.localAdminDistrict.set(parsed.adminDistrict);

    this.isEditing.set(true);
  }

  cancelEditing() {
    this.isEditing.set(false);
  }

  save() {
    const formattedPrefs = JSON.stringify({
      hours: this.localTargetHours(),
      postcode: this.localPostcode().trim().toUpperCase(),
      distance: this.localCommuteDistance(),
      region: this.localRegion(),
      adminDistrict: this.localAdminDistrict()
    });

    this.profileSaved.emit({
      skills: this.localSkills(),
      experience: this.localExperience(),
      aspirations: this.localAspirations(),
      workPrefs: formattedPrefs
    });
    this.isEditing.set(false);
  }

  handleUpdateSkills(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    this.localSkills.set(el.value);
  }

  handleUpdateExperience(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    this.localExperience.set(el.value);
  }

  handleUpdateAspirations(event: Event) {
    const el = event.target as HTMLInputElement;
    this.localAspirations.set(el.value);
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

  selectLocation(loc: UKLocation) {
    this.localPostcode.set(loc.postcode);
    this.localRegion.set(loc.region);
    this.localAdminDistrict.set(loc.name.split(',')[0].trim());

    this.locationService.getByPostcode(loc.postcode).subscribe({
      next: (res) => {
        if (res.success && res.locations && res.locations.length > 0) {
          const l = res.locations[0];
          this.localRegion.set(l.region);
          this.localAdminDistrict.set(l.name.split(',')[0].trim());
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

  triggerLogout() {
    this.logoutRequested.emit();
  }

  triggerFinderSearch() {
    this.findJobsRequested.emit();
  }
}
