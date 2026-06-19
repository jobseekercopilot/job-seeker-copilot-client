import { ChangeDetectionStrategy, Component, OnInit, signal, PLATFORM_ID, inject, ViewChild } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ClaimantProfileComponent } from './features/claimant-profile/claimant-profile';
import { NavigationBar } from './features/navigation-bar/navigation-bar';
import { LandingAuthComponent } from './features/landing-auth/landing-auth';
import { UserManagementGateway } from './gateways/user-management-gateway';
import { JobResultsComponent } from './features/job-results/job-results.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    CommonModule,
    MatIconModule,
    ClaimantProfileComponent,
    NavigationBar,
    LandingAuthComponent,
    JobResultsComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private userManagementGateway = inject(UserManagementGateway);

  // User Onboarding & Auth Details
  isLoggedIn = signal(false);
  profileName = signal('Sarah Jenkins');
  profileEmail = signal('sarah.jenkins@gmail.com');

  // JWT token retrieved from login/register - exposed publicly for template binding
  authToken = '';

  // Claimant profile inputs
  profileSkills = signal('Customer communication, basic office administration, patient documentation, phone reception, MS Excel, detail-oriented inputting');
  profileExperience = signal('Retail Team Member at Co-op (1 year) - managing cash checkouts and stocking shelves; Volunteer Office Assistant at York General Community Hub (6 months)');
  profileAspirations = signal('Customer support receptionist, ward administrative assistant, clerical data assistant');
  profileWorkPrefs = signal('Full-Time preferred (30-40 hours), commutable within Leeds/Greater Manchester region');

  // Job Search status
  searchKeyword = signal('');
  searchLocation = signal('');
  searchSector = signal('');
  isSearching = signal(false);

  @ViewChild('jobResults') jobResults!: JobResultsComponent;

  // Notice/Alert Toast triggers
  toastMessage = signal<string | null>(null);
  toastType = signal<'success' | 'info' | 'error'>('success');

  ngOnInit() {
    // Only run this logic if we are actually in a browser
    if (isPlatformBrowser(this.platformId)) {
      this.loadProfileFromStorage();
    }
  }

  // Show status feedbacks
  showToast(message: string, type: 'success' | 'info' | 'error' = 'success') {
    this.toastMessage.set(message);
    this.toastType.set(type);
    setTimeout(() => {
      this.toastMessage.set(null);
    }, 4500);
  }

  // Core Storage persistent helpers (safe for SSR checks)
  private loadProfileFromStorage() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const skills = localStorage.getItem('jc_skills');
        const exp = localStorage.getItem('jc_experience');
        const asp = localStorage.getItem('jc_aspirations');
        const prefs = localStorage.getItem('jc_prefs');
        const loggedIn = localStorage.getItem('jc_logged_in');
        const name = localStorage.getItem('jc_name');
        const email = localStorage.getItem('jc_email');
        const token = localStorage.getItem('jc_token');

        if (skills) this.profileSkills.set(skills);
        if (exp) this.profileExperience.set(exp);
        if (asp) this.profileAspirations.set(asp);
        if (prefs) this.profileWorkPrefs.set(prefs);
        if (loggedIn === 'true') this.isLoggedIn.set(true);
        if (name) this.profileName.set(name);
        if (email) this.profileEmail.set(email);
        if (token) this.authToken = token;
      } catch (e: unknown) {
        console.error('Localstorage load profile failed', e);
      }
    }
  }

  saveProfile() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem('jc_skills', this.profileSkills());
        localStorage.setItem('jc_experience', this.profileExperience());
        localStorage.setItem('jc_aspirations', this.profileAspirations());
        localStorage.setItem('jc_prefs', this.profileWorkPrefs());
        localStorage.setItem('jc_logged_in', this.isLoggedIn() ? 'true' : 'false');
        localStorage.setItem('jc_name', this.profileName());
        localStorage.setItem('jc_email', this.profileEmail());
        localStorage.setItem('jc_token', this.authToken);

        this.showToast('Claimant Profile saved securely!', 'success');
      } catch (e: unknown) {
        console.error('Localstorage save profile failed', e);
      }
    }
  }

  async handleSaveProfile(profile: { skills: string; experience: string; aspirations: string; workPrefs: string }) {
      this.profileSkills.set(profile.skills);
      this.profileExperience.set(profile.experience);
      this.profileAspirations.set(profile.aspirations);
      this.profileWorkPrefs.set(profile.workPrefs);

      try {
        const result = await this.userManagementGateway.handleUpdateProfile(this.profileEmail(), {
          name: this.profileName(),
          email: this.profileEmail(),
          skills: profile.skills,
          experience: profile.experience,
          aspirations: profile.aspirations,
          workPrefs: profile.workPrefs
        }, this.authToken);

        if (result.success) {
          this.saveProfile();
          this.showToast('Profile updated on server!', 'success');
        } else {
          this.showToast(result.message || 'Failed to save profile to server', 'error');
        }
      } catch (err) {
        this.showToast('Connectivity error while saving profile', 'error');
      }
    }

  handleOnboarded(data: { name: string; email: string; skills: string; experience: string; aspirations: string; workPrefs: string; token?: string }) {
    this.profileName.set(data.name);
    this.profileEmail.set(data.email);
    this.profileSkills.set(data.skills);
    this.profileExperience.set(data.experience);
    this.profileAspirations.set(data.aspirations);
    this.profileWorkPrefs.set(data.workPrefs);
    if (data.token) {
      this.authToken = data.token;
    }
    this.isLoggedIn.set(true);
    this.saveProfile();
    this.showToast(`Welcome, ${data.name}! Your Jobseeker Copilot workspace is initialized.`, 'success');
  }

  logout() {
    this.isLoggedIn.set(false);
    this.authToken = '';
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem('jc_logged_in', 'false');
        localStorage.setItem('jc_token', '');
      } catch (e: unknown) {
        console.error('Logout save failed', e);
      }
    }
    this.showToast('Logged out of claimant session securely.', 'info');
  }

  triggerJobSearch() {
    if (this.jobResults) {
      this.jobResults.refresh();
    } else {
      this.showToast('Preparing job search...', 'info');
    }
  }
}
