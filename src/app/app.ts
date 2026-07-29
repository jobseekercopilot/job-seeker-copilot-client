import { ChangeDetectionStrategy, Component, computed, effect, OnInit, signal, PLATFORM_ID, inject, ViewChild } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {firstValueFrom} from 'rxjs';
import { ClaimantProfileComponent } from './features/claimant-profile/claimant-profile';
import { NavigationBar } from './features/navigation-bar/navigation-bar';
import { LandingAuthComponent } from './features/landing-auth/landing-auth';
import {PasswordRecoveryComponent} from './features/password-recovery/password-recovery';
import { JobResultsComponent } from './features/job-results/job-results.component';
import { ReportingPanelComponent } from './features/reporting-panel/reporting-panel';
import { PaymentPanelComponent } from './features/payment-panel/payment-panel';
import { MyApplicationsComponent } from './features/my-applications/my-applications.component';
import { DocumentsWorkspaceComponent } from './features/documents-workspace/documents-workspace.component';
import { EvidenceLibraryComponent } from './features/evidence-library/evidence-library';
import { PaymentService } from './services/payment.service';
import type { GatewayResponse, UserProfile } from './api';
import { normaliseProfile, profileToSearchText } from './models/user-profile.model';
import { FALLBACK_PENCE_PER_TOKEN, pencePerTokenFromPlans } from './utils/ai-credit';
import {removeLegacySessionData} from './services/browser-storage';
import {BrowserSessionService} from './services/browser-session.service';
import {
  JobSearchProviderMode,
  DocumentGenerationMode,
  RuntimeConfigurationService,
} from './services/runtime-configuration.service';

type WorkspaceTab = 'search' | 'applications' | 'evidence' | 'documents';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    CommonModule,
    MatIconModule,
    ClaimantProfileComponent,
    NavigationBar,
    LandingAuthComponent,
    PasswordRecoveryComponent,
    JobResultsComponent,
    MyApplicationsComponent,
    EvidenceLibraryComponent,
    DocumentsWorkspaceComponent,
    ReportingPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private paymentService = inject(PaymentService);
  private browserSession = inject(BrowserSessionService);
  private runtimeConfiguration = inject(RuntimeConfigurationService);
  readonly sessionStatus = this.browserSession.status;

  // User Onboarding & Auth Details
  isLoggedIn = signal(false);
  profileName = signal('');
  profileEmail = signal('');
  userAccountId = signal('');
  aiTokenBalance = signal<number | null>(null);
  aiCreditPencePerToken = signal(FALLBACK_PENCE_PER_TOKEN);
  paymentReturnStatus = signal<'success' | 'cancel' | null>(null);
  currentRoute = signal<'dashboard' | 'payment' | 'history'>('dashboard');
  publicAccountRoute = signal<
    'register' | 'signin' | 'forgot' | 'reset' | null>(null);

  // Claimant profile search inputs remain in memory only.
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
  jobSearchProviderMode = signal<JobSearchProviderMode>('REQUIRED_VALIDATION');
  documentGenerationMode = signal<DocumentGenerationMode>('REQUIRED_VALIDATION');
  jobSearchProviderModeLabel = computed(() => {
    switch (this.jobSearchProviderMode()) {
      case 'FIXTURE': return 'Fixture-backed';
      case 'REAL_PROVIDERS': return 'Real providers';
      default: return 'Required validation';
    }
  });
  documentGenerationModeLabel = computed(() =>
    this.documentGenerationMode() === 'FIXTURE_LLM'
      ? 'Fixture-generated'
      : 'Not enabled for this beta',
  );
  activeWorkspaceTab = signal<WorkspaceTab>('search');
  selectedApplicationId = signal<string | null>(null);

  @ViewChild('jobResults') jobResults!: JobResultsComponent;
  @ViewChild('myApplications') myApplications?: MyApplicationsComponent;
  @ViewChild('documentsWorkspace') documentsWorkspace?: DocumentsWorkspaceComponent;
  @ViewChild('reportingPanel') reportingPanel!: ReportingPanelComponent;

  // Notice/Alert Toast triggers
  toastMessage = signal<string | null>(null);
  toastType = signal<'success' | 'info' | 'error'>('success');

  constructor() {
    effect(() => {
      const user = this.browserSession.user();
      if (user) {
        this.profileName.set(user.name ?? '');
        this.profileEmail.set(user.email ?? '');
        this.structuredProfile.set(user.profile ?? null);
        const searchText = profileToSearchText(user.profile ?? {});
        this.profileSkills.set(searchText.skills);
        this.profileExperience.set(searchText.experience);
        this.profileAspirations.set(searchText.aspirations);
        this.profileWorkPrefs.set(searchText.workPrefs);
        this.isLoggedIn.set(true);
        return;
      }
      if (this.sessionStatus() === 'anonymous') {
        this.clearAuthenticatedView();
      }
    });
  }

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
      if (!this.publicAccountRoute()) {
        void this.retrySession();
      }
      void this.loadJobSearchProviderMode();
      void this.loadDocumentGenerationMode();
    }
  }

  private async loadJobSearchProviderMode(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.runtimeConfiguration.jobSearchMode(),
      );
      this.jobSearchProviderMode.set(response.mode);
    } catch {
      this.jobSearchProviderMode.set('REQUIRED_VALIDATION');
    }
  }

  private async loadDocumentGenerationMode(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.runtimeConfiguration.documentGenerationMode(),
      );
      this.documentGenerationMode.set(response.mode);
    } catch {
      this.documentGenerationMode.set('REQUIRED_VALIDATION');
    }
  }

  async retrySession(): Promise<void> {
    await firstValueFrom(this.browserSession.restore());
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
    this.publicAccountRoute.set(this.detectPublicAccountRoute(pathname));
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

  private detectPublicAccountRoute(pathname: string):
      'register' | 'signin' | 'forgot' | 'reset' | null {
    if (pathname === '/register') return 'register';
    if (pathname === '/sign-in') return 'signin';
    if (pathname === '/forgot-password') return 'forgot';
    if (pathname === '/reset-password') return 'reset';
    return null;
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

    // Update the in-memory search inputs derived from the structured profile.
    const searchText = profileToSearchText(profile);
    this.profileSkills.set(searchText.skills);
    this.profileExperience.set(searchText.experience);
    this.profileAspirations.set(searchText.aspirations);
    this.profileWorkPrefs.set(searchText.workPrefs);

    if (event.apiResult?.success) {
      this.browserSession.updateCurrentProfile(normaliseProfile(profile));
      this.saveProfile(false);
      this.showToast('Profile updated on server!', 'success');
    } else if (event.apiError) {
      // Keep the edit locally, but do not describe every HTTP rejection as a
      // connectivity problem. A local Docker rebuild can invalidate a token
      // when its backing account was held in a disposable container.
      this.saveProfile(false);
      const status = this.httpStatus(event.apiError);
      if (status === 401 || status === 403 || status === 404) {
        this.browserSession.handleAuthenticatedError(event.apiError);
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
    this.browserSession.acceptAuthenticatedUser({
      name: data.name,
      email: data.email,
      profile: normaliseProfile(data.profile),
    });
    if (this.publicAccountRoute()) {
      this.publicAccountRoute.set(null);
      void this.router.navigateByUrl('/dashboard', {replaceUrl: true});
    }
    this.saveProfile();
    this.showToast(`Welcome, ${data.name}! Your Jobseeker Copilot workspace is initialized.`, 'success');
  }

  async logout(): Promise<void> {
    try {
      const response = await firstValueFrom(this.browserSession.logout());
      if (!response.success) {
        this.showToast('The session could not be ended. Please try again.', 'error');
        return;
      }
    } catch {
      if (this.sessionStatus() !== 'anonymous') {
        this.showToast('The session could not be ended. Please try again.', 'error');
        return;
      }
    }
    this.clearAuthenticatedView();
    this.showToast('Logged out of claimant session securely.', 'info');
  }

  private clearAuthenticatedView(): void {
    this.isLoggedIn.set(false);
    this.profileName.set('');
    this.profileEmail.set('');
    this.structuredProfile.set(null);
    this.profileSkills.set('');
    this.profileExperience.set('');
    this.profileAspirations.set('');
    this.profileWorkPrefs.set('');
    this.userAccountId.set('');
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

  refreshApplicationTracking(): void {
    this.myApplications?.refresh();
    this.documentsWorkspace?.refresh();
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
