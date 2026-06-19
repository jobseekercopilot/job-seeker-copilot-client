import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UserManagementGateway } from '../../gateways/user-management-gateway';
import { LocationService, UKLocation } from '../../services/location.service';
import {
  ChangeDetectionStrategy,
  Component,
  output,
  signal,
  inject,
  Injector,
  runInInjectionContext
} from '@angular/core';

interface AuthResponse {
  success: boolean;
  statusCode: number;
  message: string;
  user?: {
    id: string;
    name: string;
    email: string;
    token: string;
    profile: {
      name: string;
      email: string;
      skills: string;
      experience: string;
      aspirations: string;
      workPrefs: string;
    };
  };
}

@Component({
  selector: 'app-landing-auth',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing-auth.html',
  styleUrl: './landing-auth.css'
})
export class LandingAuthComponent {
  private userManagementGateway = inject(UserManagementGateway);
  private locationService = inject(LocationService);

  locationSuggestions = signal<UKLocation[]>([]);
  showLocationDropdown = signal<boolean>(false);

  onboarded = output<{
    name: string;
    email: string;
    skills: string;
    experience: string;
    aspirations: string;
    workPrefs: string;
    token?: string;
  }>();

  mode = signal<'create' | 'signin'>('create');
  currentStep = signal<number>(1);
  errorMessage = signal<string | null>(null);
  isLoading = signal<boolean>(false);

  // Form Field Signals
  formName = signal('');
  formEmail = signal('');
  formPassword = signal('');
  
  formSkills = signal('Customer support receptionist, ward administrative assistant, clerical data assistant');
  formExperience = signal('Retail Team Member at Co-op (1 year) - managing cash checkouts and stocking shelves; Volunteer Office Assistant at York General Community Hub (6 months)');
  formAspirations = signal('Customer support receptionist, ward administrative assistant, clerical data assistant');
  
  // Structured Work Preferences
  formPostcode = signal('LS1 1UR');
  formTargetHours = signal('Full-Time (35-40 hours)');
  formCommuteDistance = signal('10 miles');
  formRegion = signal('Yorkshire and the Humber');
  formAdminDistrict = signal('Leeds');

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

  // Sign In Field Signals
  loginEmail = signal('');
  loginPassword = signal('');

  onLocationInputChange(query: string) {
    this.formPostcode.set(query);
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
    this.formPostcode.set(loc.postcode);
    this.formRegion.set(loc.region);
    this.formAdminDistrict.set(loc.name.split(',')[0].trim());

    this.locationService.getByPostcode(loc.postcode).subscribe({
      next: (res) => {
        if (res.success && res.locations && res.locations.length > 0) {
          const l = res.locations[0];
          this.formRegion.set(l.region);
          this.formAdminDistrict.set(l.name.split(',')[0].trim());
        }
      }
    });

    this.locationSuggestions.set([]);
    this.showLocationDropdown.set(false);
  }

  hideLocationDropdownWithDelay() {
    const injector = inject(Injector);

    setTimeout(() => {
      runInInjectionContext(injector, () => {
        this.showLocationDropdown.set(false);
      });
    }, 250);
  }

  setMode(newMode: 'create' | 'signin') {
    this.mode.set(newMode);
    if (newMode === 'create') {
      this.currentStep.set(1);
    }
  }

  isStepValid(): boolean {
    if (this.mode() !== 'create') return true;
    
    const step = this.currentStep();
    if (step === 1) {
      return this.formName().trim().length >= 2 && this.formEmail().includes('@');
    }
    if (step === 2) {
      return this.formSkills().trim().length > 5 && this.formExperience().trim().length > 5;
    }
    if (step === 3) {
      return this.formAspirations().trim().length > 3 && this.formPostcode().trim().length >= 4;
    }
    return true;
  }

  nextStep() {
    if (this.isStepValid() && this.currentStep() < 3) {
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep() {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  async completeRegistration() {
     if (!this.isStepValid()) return;
     this.isLoading.set(true);
     this.errorMessage.set(null);

     const formattedPrefs = JSON.stringify({
       hours: this.formTargetHours(),
       postcode: this.formPostcode().trim().toUpperCase(),
       distance: this.formCommuteDistance(),
       region: this.formRegion(),
       adminDistrict: this.formAdminDistrict()
     });

     const profile = {
       name: this.formName().trim(),
       email: this.formEmail().trim(),
       skills: this.formSkills().trim(),
       experience: this.formExperience().trim(),
       aspirations: this.formAspirations().trim(),
       workPrefs: formattedPrefs
     };


     const res = await this.userManagementGateway.handleRegistration(
       this.formName().trim(),
       this.formEmail().trim(),
       this.formPassword().trim(),
       profile
     );

     this.isLoading.set(false);
     if (res.success && res.user) {
       const { name, email, ...restOfProfile } = res.user.profile;

       this.onboarded.emit({
         name: res.user.name,
         email: res.user.email,
         token: res.user.token,
         ...restOfProfile
       });
     } else {
       this.errorMessage.set(res.message || 'Registration failed at gateway level.');
     }
  }

  async submitLogin() {
     const email = this.loginEmail().trim();
     const password = this.loginPassword().trim();

     if (!email || !password) {
       this.errorMessage.set('Please fill out both email and password.');
       return;
     }

     this.isLoading.set(true);
     this.errorMessage.set(null);

     const res = await this.userManagementGateway.handleLogin(email, password);

     this.isLoading.set(false);
     if (res.success && res.user) {
       // Destructure to remove duplicates from the profile object
       const { name, email, ...restOfProfile } = res.user.profile;

       this.onboarded.emit({
         name: res.user.name,
         email: res.user.email,
         token: res.user.token,
         ...restOfProfile
       });
     } else {
       this.errorMessage.set(res.message || 'Verification failed.');
     }
   }

  loadPersona(role: 'admin' | 'logistics') {
    if (role === 'admin') {
      this.onboarded.emit({
        name: 'Sarah Jenkins',
        email: 'sarah.jenkins@gmail.com',
        skills: 'Customer communication, basic office administration, patient documentation, phone reception, MS Excel, detail-oriented inputting',
        experience: 'Retail Team Member at Co-op (1 year) - managing cash checkouts and stocking shelves; Volunteer Office Assistant at York General Community Hub (6 months)',
        aspirations: 'Customer support receptionist, ward administrative assistant, clerical data assistant',
        workPrefs: JSON.stringify({
          hours: 'Full-Time (35-40 hours)',
          postcode: 'LS1 1UR',
          distance: '10 miles',
          region: 'Yorkshire and the Humber',
          adminDistrict: 'Leeds'
        })
      });
    } else {
      this.onboarded.emit({
        name: 'Marcus Vance',
        email: 'marcus.vance@live.co.uk',
        skills: 'Stock replenishment operations, forklift loading, manual inventory audits, load security safety compliance, goods in-out documentation systems, team logistics tools',
        experience: 'Depot Stock Porter at DHL Express (9 months) - sorting shipments and handling inbound cargo containers; Seasonal Warehouse Assistant at Amazon Fulfilment (5 months)',
        aspirations: 'Logistics cargo handler, warehouse logistics colleague, yard coordinator, stock control team helper',
        workPrefs: JSON.stringify({
          hours: 'Part-Time (16-30 hours)',
          postcode: 'LS11 5BY',
          distance: '15 miles',
          region: 'Yorkshire and the Humber',
          adminDistrict: 'Leeds'
        })
      });
    }
  }
}
