import { ChangeDetectionStrategy, Component, OnInit, signal, PLATFORM_ID, inject, ViewChild } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ClaimantProfileComponent } from './features/claimant-profile/claimant-profile';
import { NavigationBar } from './features/navigation-bar/navigation-bar';
import { LandingAuthComponent } from './features/landing-auth/landing-auth';
import { JobResultsComponent } from './features/job-results/job-results.component';
import { ReportingPanelComponent } from './features/reporting-panel/reporting-panel';
import { PaymentPanelComponent } from './features/payment-panel/payment-panel';
import { MyApplicationsComponent } from './features/my-applications/my-applications.component';
import { DocumentsWorkspaceComponent } from './features/documents-workspace/documents-workspace.component';
import { PaymentService } from './services/payment.service';
import type { GatewayResponse, UserProfile } from './api';
import { normaliseProfile, profileToSearchText } from './models/user-profile.model';
import { FALLBACK_PENCE_PER_TOKEN, pencePerTokenFromPlans } from './utils/ai-credit';
import {removeLegacySessionData} from './services/browser-storage';

type WorkspaceTab = 'search' | 'applications' | 'documents';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    CommonModule,
    MatIconModule,
    ClaimantProfileComponent,
    NavigationBar,
    LandingAuthComponent,
    JobResultsComponent,
    ReportingPanelComponent,
    PaymentPanelComponent,
    MyApplicationsComponent,
    DocumentsWorkspaceComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private paymentService = inject(PaymentService);

  // User Onboarding & Auth Details
  isLoggedIn = signal(false);
  profileName = signal('');
  profileEmail = signal('');
  userAccountId = signal('');
  aiTokenBalance = signal<number | null>(null);
  aiCreditPencePerToken = signal(FALLBACK_PENCE_PER_TOKEN);
  paymentReturnStatus = signal<'success' | 'cancel' | null>(null);
  currentRoute = signal<'dashboard' | 'payment' | 'history'>('dashboard');

  // Claimant profile inputs retained by the non-beta shell in memory only.
  profileSkills = signal('');
  profileExperience = signal('');
  profileAspirations = signal('');
  profileWorkPrefs = signal('');

  // Structured profile state (built from the legacy free-text + new form)
  structuredProfile = signal<UserProfile | null>(null);

  // Job Search status
  searchKeyword = signal('');
  searchLocation = signal('');
  searchSector = signal('');
  isSearching = signal(false);
  activeWorkspaceTab = signal<WorkspaceTab>('search');
  selectedApplicationId = signal<string | null>(null);

  @ViewChild('jobResults') jobResults!: JobResultsComponent;
  @ViewChild('myApplications') myApplications?: MyApplicationsComponent;
  @ViewChild('documentsWorkspace') documentsWorkspace?: DocumentsWorkspaceComponent;
  @ViewChild('reportingPanel') reportingPanel!: ReportingPanelComponent;

  // Notice/Alert Toast triggers
  toastMessage = signal<string | null>(null);
  toastType = signal<'success' | 'info' | 'error'>('success');

  ngOnInit() {
    // Only run this logic if we are actually in a browser
    if (isPlatformBrowser(this.platformId)) {
      this.syncRouteState(window.location.pathname);
      this.router.events.subscribe(event => {
        if (event instanceof NavigationEnd) {
          this.syncRouteState(event.urlAfterRedirects);
        }
      });
      window.addEventListener('popstate', () => {
        this.syncRouteState(window.location.pathname);
      });
      try {
        removeLegacySessionData(localStorage, sessionStorage);
      } catch {
        console.warn('Unable to remove legacy browser session data.');
      }
    }
  }

  paymentReturnTitle(): string {
    return this.paymentReturnStatus() === 'success'
      ? 'Stripe payment received'
      : 'Stripe checkout cancelled';
  }

  paymentReturnMessage(): string {
    return this.paymentReturnStatus() === 'success'
      ? 'Thanks. Stripe is confirming the payment with Job Seeker Copilot, and your wallet is refreshed below.'
      : 'No payment was taken. You can return to the dashboard and choose an AI Credit package when you are ready.';
  }

  goToDashboard(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = '/dashboard';
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

  private detectPaymentReturnStatus(pathname: string): 'success' | 'cancel' | null {
    if (pathname === '/payment/success') return 'success';
    if (pathname === '/payment/cancel') return 'cancel';
    return null;
  }

  private syncRouteState(url: string): void {
    const pathname = this.routePath(url);
    this.paymentReturnStatus.set(this.detectPaymentReturnStatus(pathname));
    this.currentRoute.set(this.detectRoute(pathname));
  }

  private routePath(url: string): string {
    return url.split(/[?#]/, 1)[0] || '/dashboard';
  }

  private detectRoute(pathname: string): 'dashboard' | 'payment' | 'history' {
    if (pathname === '/payment/history' || pathname === '/tokens/history') return 'history';
    if (pathname === '/payment' || pathname === '/tokens') return 'payment';
    return 'dashboard';
  }

  saveProfile(showConfirmation = true) {
    if (showConfirmation) this.showToast('Claimant profile saved for this session.', 'success');
  }

  /**
   * Handle the structured profile save from the refactored claimant-profile component.
   * The component now emits a UserProfile object matching the Java backend model.
   */
  handleSaveProfile(event: { profile: UserProfile; apiResult?: GatewayResponse; apiError?: unknown }) {
    const profile = event.profile;
    this.structuredProfile.set(profile);

    // Update the retained non-beta shell's in-memory free-text signals.
    const searchText = profileToSearchText(profile);
    this.profileSkills.set(searchText.skills);
    this.profileExperience.set(searchText.experience);
    this.profileAspirations.set(searchText.aspirations);
    this.profileWorkPrefs.set(searchText.workPrefs);

    if (event.apiResult?.success) {
      this.saveProfile(false);
      this.showToast('Profile updated on server!', 'success');
    } else if (event.apiError) {
      // Keep the edit locally, but do not describe every HTTP rejection as a
      // connectivity problem. A local Docker rebuild can invalidate a token
      // when its backing account was held in a disposable container.
      this.saveProfile(false);
      const status = this.httpStatus(event.apiError);
      if (status === 401 || status === 403 || status === 404) {
        this.logout();
        this.showToast('Your session is no longer valid. Please sign in or register again.', 'error');
      } else {
        this.showToast(this.httpErrorMessage(event.apiError, 'Unable to save profile to the server.'), 'error');
      }
    } else {
      this.showToast(event.apiResult?.message || 'Failed to save profile to server', 'error');
    }
  }

  private httpStatus(error: unknown): number | undefined {
    return typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
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

  handleOnboarded(data: { profile: UserProfile; name: string; email: string }) {
    this.profileName.set(data.name);
    this.profileEmail.set(data.email);
    this.structuredProfile.set(data.profile);

    // Convert structured profile to search text for backward compatibility
    const searchText = profileToSearchText(data.profile);
    this.profileSkills.set(searchText.skills);
    this.profileExperience.set(searchText.experience);
    this.profileAspirations.set(searchText.aspirations);
    this.profileWorkPrefs.set(searchText.workPrefs);

    this.isLoggedIn.set(true);
    this.saveProfile();
    this.refreshAiTokenBalance();
    this.refreshAiCreditPricing();
    this.showToast(`Welcome, ${data.name}! Your Jobseeker Copilot workspace is initialized.`, 'success');
  }

  logout() {
    this.isLoggedIn.set(false);
    this.userAccountId.set('');
    this.showToast('Logged out of claimant session securely.', 'info');
  }

  triggerJobSearch() {
    this.activeWorkspaceTab.set('search');
    if (this.jobResults) {
      this.jobResults.refresh();
    } else {
      this.showToast('Preparing job search...', 'info');
    }
  }

  refreshReporting() {
    this.reportingPanel?.refresh();
  }

  refreshAfterAiGeneration() {
    this.jobResults?.refresh();
    this.myApplications?.refresh();
    this.documentsWorkspace?.refresh();
    this.refreshReporting();
    this.refreshAiTokenBalance();
    this.refreshAiCreditPricing();
  }

  openApplicationFromDocument(applicationId: string): void {
    this.selectedApplicationId.set(applicationId);
    this.activeWorkspaceTab.set('applications');
  }

  updateAiTokenBalance(balance: number) {
    this.aiTokenBalance.set(balance);
  }

  refreshAiTokenBalance() {
    if (!this.isLoggedIn()) return;
    this.refreshAiCreditPricing();
    this.paymentService.wallet(this.userAccountId(), '').subscribe({
      next: (wallet) => this.updateAiTokenBalance(wallet.balanceTokens ?? 0),
      error: (error) => console.warn('Unable to refresh AI token balance:', error),
    });
  }

  private refreshAiCreditPricing(): void {
    this.paymentService.pricing().subscribe({
      next: (response) => this.aiCreditPencePerToken.set(pencePerTokenFromPlans(response.plans)),
      error: (error) => console.warn('Unable to refresh AI Credit pricing:', error),
    });
  }
}
