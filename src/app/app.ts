import { ChangeDetectionStrategy, Component, computed, effect, OnDestroy, OnInit, signal, PLATFORM_ID, inject, ViewChild } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import {MatDialog, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {firstValueFrom} from 'rxjs';
import { ClaimantProfileComponent } from './features/claimant-profile/claimant-profile';
import { NavigationBar } from './features/navigation-bar/navigation-bar';
import { LandingAuthComponent } from './features/landing-auth/landing-auth';
import {PasswordRecoveryComponent} from './features/password-recovery/password-recovery';
import {LegalNoticeComponent} from './features/legal-notice/legal-notice';
import { JobResultsComponent } from './features/job-results/job-results.component';
import { ReportingPanelComponent } from './features/reporting-panel/reporting-panel';
import { PaymentPanelComponent } from './features/payment-panel/payment-panel';
import { MyApplicationsComponent } from './features/my-applications/my-applications.component';
import { DocumentsWorkspaceComponent } from './features/documents-workspace/documents-workspace.component';
import { EvidenceLibraryComponent } from './features/evidence-library/evidence-library';
import {
  PaymentOrderStatus,
  PaymentOrderStatusResponse,
  PaymentService,
} from './services/payment.service';
import type { GatewayResponse, UserProfile } from './api';
import { normaliseProfile, profileToSearchText } from './models/user-profile.model';
import {searchReadiness} from './models/search-readiness';
import {removeLegacySessionData} from './services/browser-storage';
import {BrowserSessionService} from './services/browser-session.service';
import {
  CommuteRoutingMode,
  JobSearchProviderMode,
  DocumentGenerationMode,
  DRAFT_LEGAL_CONFIGURATION,
  isReviewedLegalConfiguration,
  RuntimeConfigurationService,
  PublicLegalConfiguration,
} from './services/runtime-configuration.service';

type WorkspaceTab = 'search' | 'applications' | 'documents';
type PaymentOrderViewState =
  | 'idle'
  | 'checking'
  | 'pending'
  | 'fulfilled'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'disputed'
  | 'manual-review'
  | 'invalid'
  | 'unavailable';

const PAYMENT_ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_POLL_DELAYS_MS = [1_000, 2_000, 3_000, 5_000] as const;
const PAYMENT_POLL_LIMIT_MS = 30_000;
const PAYMENT_ORDER_STATUSES = new Set<PaymentOrderStatus>([
  'PENDING_CHECKOUT',
  'CHECKOUT_OPEN',
  'FULFILLED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DISPUTED',
  'MANUAL_REVIEW',
]);
const PAYMENT_ORDER_MESSAGE_CODES: Readonly<Record<PaymentOrderStatus, string>> = {
  PENDING_CHECKOUT: 'PAYMENT_PENDING',
  CHECKOUT_OPEN: 'PAYMENT_PENDING',
  FULFILLED: 'GENERATIONS_ADDED',
  EXPIRED: 'CHECKOUT_EXPIRED',
  CANCELLED: 'CHECKOUT_CANCELLED',
  REFUNDED: 'PAYMENT_REFUNDED',
  PARTIALLY_REFUNDED: 'PAYMENT_PARTIALLY_REFUNDED',
  DISPUTED: 'PAYMENT_DISPUTED',
  MANUAL_REVIEW: 'PAYMENT_REVIEW_REQUIRED',
};
const PAYMENT_ORDER_PLANS: Readonly<Record<string, {
  bonusDocumentCredits: number;
  documentGenerations: number;
  priceMinor: number;
}>> = {
  starter: {bonusDocumentCredits: 5, documentGenerations: 10, priceMinor: 499},
  active: {bonusDocumentCredits: 13, documentGenerations: 25, priceMinor: 1199},
  power: {bonusDocumentCredits: 30, documentGenerations: 60, priceMinor: 1999},
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    ClaimantProfileComponent,
    NavigationBar,
    LandingAuthComponent,
    PasswordRecoveryComponent,
    LegalNoticeComponent,
    JobResultsComponent,
    MyApplicationsComponent,
    DocumentsWorkspaceComponent,
    ReportingPanelComponent,
    PaymentPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private paymentService = inject(PaymentService);
  private browserSession = inject(BrowserSessionService);
  private runtimeConfiguration = inject(RuntimeConfigurationService);
  private dialog = inject(MatDialog);
  readonly sessionStatus = this.browserSession.status;

  // User Onboarding & Auth Details
  isLoggedIn = signal(false);
  profileName = signal('');
  profileEmail = signal('');
  userAccountId = signal('');
  documentCreditBalance = signal<number | null>(null);
  paymentReturnStatus = signal<'success' | 'cancel' | null>(null);
  paymentOrderState = signal<PaymentOrderViewState>('idle');
  paymentOrder = signal<PaymentOrderStatusResponse | null>(null);
  currentRoute = signal<'dashboard' | 'payment' | 'history'>('dashboard');
  publicAccountRoute = signal<
    'register' | 'signin' | 'forgot' | 'reset' | 'privacy' | 'terms' | null>(null);

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
  commuteRoutingMode = signal<CommuteRoutingMode>('DISTANCE_ONLY');
  legalConfiguration = signal<PublicLegalConfiguration>(DRAFT_LEGAL_CONFIGURATION);
  documentGenerationModeLabel = computed(() => {
    switch (this.documentGenerationMode()) {
      case 'FIXTURE_LLM': return 'Fixture-generated';
      case 'REAL_LLM': return 'Real OpenAI generation';
      default: return 'Not enabled for this beta';
    }
  });
  activeWorkspaceTab = signal<WorkspaceTab>('search');
  readonly jobSearchReadiness = computed(() => searchReadiness(this.structuredProfile()));
  selectedApplicationId = signal<string | null>(null);

  @ViewChild('jobResults') jobResults!: JobResultsComponent;
  @ViewChild('claimantProfile') claimantProfile?: ClaimantProfileComponent;
  @ViewChild('myApplications') myApplications?: MyApplicationsComponent;
  @ViewChild('documentsWorkspace') documentsWorkspace?: DocumentsWorkspaceComponent;
  @ViewChild('reportingPanel') reportingPanel!: ReportingPanelComponent;

  // Notice/Alert Toast triggers
  toastMessage = signal<string | null>(null);
  toastType = signal<'success' | 'info' | 'error'>('success');
  private walletSessionKey = '';
  private evidenceDialogRef?: MatDialogRef<EvidenceLibraryComponent>;
  private paymentOrderId: string | null = null;
  private paymentPollStartedAt = 0;
  private paymentPollStep = 0;
  private paymentPollTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor() {
    effect(() => {
      const user = this.browserSession.user();
      if (user) {
        this.userAccountId.set(user.id ?? '');
        this.profileName.set(user.name ?? '');
        this.profileEmail.set(user.email ?? '');
        this.structuredProfile.set(user.profile ?? null);
        const searchText = profileToSearchText(user.profile ?? {});
        this.profileSkills.set(searchText.skills);
        this.profileExperience.set(searchText.experience);
        this.profileAspirations.set(searchText.aspirations);
        this.profileWorkPrefs.set(searchText.workPrefs);
        this.isLoggedIn.set(true);
        const walletSessionKey = user.id ?? user.email ?? '';
        if (walletSessionKey
            && walletSessionKey !== this.walletSessionKey) {
          this.walletSessionKey = walletSessionKey;
          this.refreshDocumentCreditBalance();
        }
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
      this.syncRouteState(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      this.router.events.subscribe(event => {
        if (event instanceof NavigationEnd) {
          this.syncRouteState(event.urlAfterRedirects);
        }
      });
      window.addEventListener('popstate', () => {
        this.syncRouteState(`${window.location.pathname}${window.location.search}${window.location.hash}`);
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
      void this.loadCommuteRoutingMode();
      void this.loadLegalConfiguration();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopPaymentPolling();
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

  private async loadCommuteRoutingMode(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.runtimeConfiguration.commuteRoutingMode(),
      );
      this.commuteRoutingMode.set(response.mode);
    } catch {
      this.commuteRoutingMode.set('DISTANCE_ONLY');
    }
  }

  private async loadLegalConfiguration(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.runtimeConfiguration.legalConfiguration(),
      );
      this.legalConfiguration.set(isReviewedLegalConfiguration(response)
        ? response
        : DRAFT_LEGAL_CONFIGURATION);
    } catch {
      this.legalConfiguration.set(DRAFT_LEGAL_CONFIGURATION);
    }
  }

  async retrySession(): Promise<void> {
    await firstValueFrom(this.browserSession.restore());
  }

  paymentReturnTitle(): string {
    switch (this.paymentOrderState()) {
      case 'fulfilled': return 'Payment confirmed';
      case 'expired': return 'Checkout expired';
      case 'cancelled': return 'Checkout cancelled';
      case 'refunded': return 'Payment refund recorded';
      case 'disputed': return 'Payment under dispute';
      case 'manual-review': return 'Payment needs review';
      case 'invalid': return 'Unable to verify this checkout return';
      case 'unavailable': return 'Payment status is temporarily unavailable';
      case 'pending': return 'Payment is still processing';
      default: return 'Checking payment status';
    }
  }

  paymentReturnMessage(): string {
    const order = this.paymentOrder();
    switch (this.paymentOrderState()) {
      case 'fulfilled':
        return `${order?.totalGrantedDocumentGenerations ?? 0} document generations were added after secure server confirmation.`;
      case 'expired':
        return 'The secure checkout expired before payment was confirmed. No document generations were added for this order.';
      case 'cancelled':
        return 'The secure server confirms that this checkout was cancelled. No document generations were added for this order.';
      case 'refunded':
        return 'The payment service has recorded a refund or partial refund. Your document generation allowance reflects the authoritative payment record.';
      case 'disputed':
        return 'The payment service has recorded a dispute. Your balance may be restricted while the payment is reviewed.';
      case 'manual-review':
        return 'This payment needs manual review. Document generations are not described as added unless fulfilment is securely confirmed.';
      case 'invalid':
        return 'This page did not contain one valid order reference. No payment or document-generation outcome can be inferred from the return link.';
      case 'unavailable':
        return 'We could not securely check the order. No payment or document-generation outcome can be inferred from this page; try the status check again.';
      case 'pending':
        return 'The secure payment record is not final yet. No document generations are described as added unless fulfilment is confirmed. You can check again.';
      default:
        return 'We are checking the owner-scoped server record. The return URL itself never confirms payment or adds document generations.';
    }
  }

  canRefreshPaymentStatus(): boolean {
    return this.paymentOrderId !== null
      && ['pending', 'unavailable'].includes(this.paymentOrderState());
  }

  refreshPaymentStatus(): void {
    if (!this.paymentOrderId) return;
    this.stopPaymentPolling();
    this.paymentPollStartedAt = Date.now();
    this.paymentPollStep = 0;
    this.paymentOrderState.set('checking');
    this.checkPaymentOrderStatus();
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
    const paymentReturnStatus = this.detectPaymentReturnStatus(pathname);
    this.paymentReturnStatus.set(paymentReturnStatus);
    if (paymentReturnStatus) {
      this.capturePaymentReturn(url, pathname);
    } else {
      this.stopPaymentPolling();
      this.paymentOrderId = null;
      this.paymentOrder.set(null);
      this.paymentOrderState.set('idle');
    }
    this.currentRoute.set(this.detectRoute(pathname));
  }

  private capturePaymentReturn(url: string, pathname: string): void {
    if (this.paymentOrderId || this.paymentOrderState() !== 'idle') return;

    let parsed: URL;
    try {
      parsed = new URL(url, window.location.origin);
    } catch {
      this.paymentOrderState.set('invalid');
      return;
    }
    const orderIds = parsed.searchParams.getAll('order_id');
    const onlyOrderId = [...parsed.searchParams.keys()].every(key => key === 'order_id');

    // Remove even a malformed return query before rendering or making any request.
    window.history.replaceState(window.history.state, '', `${pathname}${parsed.hash}`);

    if (orderIds.length !== 1 || !onlyOrderId || !PAYMENT_ORDER_ID.test(orderIds[0])) {
      this.paymentOrderState.set('invalid');
      return;
    }
    this.paymentOrderId = orderIds[0].toLowerCase();
    this.refreshPaymentStatus();
  }

  private checkPaymentOrderStatus(): void {
    const orderId = this.paymentOrderId;
    if (!orderId || this.destroyed) return;

    this.paymentService.orderStatus(orderId).subscribe({
      next: response => {
        if (this.destroyed || orderId !== this.paymentOrderId) return;
        if (!this.paymentOrderResponseIsSafe(response, orderId)) {
          this.paymentOrder.set(null);
          this.paymentOrderState.set('unavailable');
          this.stopPaymentPolling();
          return;
        }
        this.paymentOrder.set(response);
        this.applyPaymentOrderStatus(response);
      },
      error: () => {
        if (this.destroyed || orderId !== this.paymentOrderId) return;
        this.schedulePaymentStatusCheck();
      },
    });
  }

  private applyPaymentOrderStatus(response: PaymentOrderStatusResponse): void {
    switch (response.status) {
      case 'FULFILLED':
        this.stopPaymentPolling();
        this.paymentOrderState.set('fulfilled');
        this.refreshDocumentCreditBalance();
        return;
      case 'EXPIRED':
        this.stopPaymentPolling();
        this.paymentOrderState.set('expired');
        return;
      case 'CANCELLED':
        this.stopPaymentPolling();
        this.paymentOrderState.set('cancelled');
        return;
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        this.stopPaymentPolling();
        this.paymentOrderState.set('refunded');
        return;
      case 'DISPUTED':
        this.stopPaymentPolling();
        this.paymentOrderState.set('disputed');
        return;
      case 'MANUAL_REVIEW':
        this.stopPaymentPolling();
        this.paymentOrderState.set('manual-review');
        return;
      case 'PENDING_CHECKOUT':
      case 'CHECKOUT_OPEN':
        this.schedulePaymentStatusCheck();
    }
  }

  private schedulePaymentStatusCheck(): void {
    this.stopPaymentPolling();
    const elapsed = Date.now() - this.paymentPollStartedAt;
    const remaining = PAYMENT_POLL_LIMIT_MS - elapsed;
    if (remaining <= 0) {
      this.paymentOrderState.set('pending');
      return;
    }
    const configuredDelay = PAYMENT_POLL_DELAYS_MS[
      Math.min(this.paymentPollStep, PAYMENT_POLL_DELAYS_MS.length - 1)
    ];
    this.paymentPollStep += 1;
    const delay = Math.min(configuredDelay, remaining);
    this.paymentOrderState.set('checking');
    this.paymentPollTimer = setTimeout(() => {
      this.paymentPollTimer = undefined;
      this.checkPaymentOrderStatus();
    }, delay);
  }

  private stopPaymentPolling(): void {
    if (this.paymentPollTimer !== undefined) {
      clearTimeout(this.paymentPollTimer);
      this.paymentPollTimer = undefined;
    }
  }

  private paymentOrderResponseIsSafe(
    response: PaymentOrderStatusResponse,
    expectedOrderId: string,
  ): boolean {
    if (!response || typeof response.pricingPlanId !== 'string') return false;
    const plan = PAYMENT_ORDER_PLANS[response.pricingPlanId];
    const promotionIsSafe = plan !== undefined
      && (response.promotionBonusDocumentGenerations === 0
        || response.promotionBonusDocumentGenerations === plan.bonusDocumentCredits);
    const fulfilledAtIsSafe = response.status !== 'FULFILLED'
      || (typeof response.fulfilledAt === 'string'
        && Number.isFinite(Date.parse(response.fulfilledAt)));
    const grantedCreditsAreSafe = response.status === 'FULFILLED'
      ? response.totalGrantedDocumentGenerations
        === response.documentGenerations + response.promotionBonusDocumentGenerations
      : response.totalGrantedDocumentGenerations === 0;
    return typeof response?.orderId === 'string'
      && response.orderId.toLowerCase() === expectedOrderId
      && PAYMENT_ORDER_STATUSES.has(response.status)
      && plan !== undefined
      && response.currency === 'GBP'
      && ['NOT_VAT_REGISTERED', 'VAT_REGISTERED'].includes(response.taxStatus)
      && ['VAT_NOT_CHARGED', 'VAT_INCLUDED'].includes(response.taxTreatment)
      && (response.taxStatus === 'VAT_REGISTERED')
        === (response.taxTreatment === 'VAT_INCLUDED')
      && ['SOLE_TRADER', 'LIMITED_COMPANY'].includes(response.legalEntityType)
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
        .test(response.legalEntityConfigurationVersion)
      && Number.isInteger(response.documentGenerations)
      && response.documentGenerations === plan.documentGenerations
      && Number.isInteger(response.promotionBonusDocumentGenerations)
      && promotionIsSafe
      && Number.isInteger(response.totalGrantedDocumentGenerations)
      && grantedCreditsAreSafe
      && Number.isInteger(response.priceMinor)
      && response.priceMinor === plan.priceMinor
      && Number.isFinite(Date.parse(response.createdAt))
      && Number.isFinite(Date.parse(response.expiresAt))
      && fulfilledAtIsSafe
      && response.messageCode === PAYMENT_ORDER_MESSAGE_CODES[response.status]
      && response.generationsAdded === (response.status === 'FULFILLED');
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
      'register' | 'signin' | 'forgot' | 'reset' | 'privacy' | 'terms' | null {
    if (pathname === '/register') return 'register';
    if (pathname === '/sign-in') return 'signin';
    if (pathname === '/forgot-password') return 'forgot';
    if (pathname === '/reset-password') return 'reset';
    if (pathname === '/privacy') return 'privacy';
    if (pathname === '/terms') return 'terms';
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

  handleOnboarded(data: {
    profile: UserProfile;
    id?: string;
    name: string;
    email: string;
  }) {
    this.browserSession.acceptAuthenticatedUser({
      id: data.id,
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
    this.evidenceDialogRef?.close();
    this.evidenceDialogRef = undefined;
    this.isLoggedIn.set(false);
    this.profileName.set('');
    this.profileEmail.set('');
    this.structuredProfile.set(null);
    this.profileSkills.set('');
    this.profileExperience.set('');
    this.profileAspirations.set('');
    this.profileWorkPrefs.set('');
    this.userAccountId.set('');
    this.documentCreditBalance.set(null);
    this.walletSessionKey = '';
  }

  triggerJobSearch() {
    this.selectWorkspace('search');
    if (!this.jobSearchReadiness().ready) {
      this.showToast('Complete the required job preferences before searching.', 'info');
      return;
    }
    if (this.jobResults) {
      this.jobResults.refresh();
    } else {
      this.showToast('Preparing job search...', 'info');
    }
  }

  selectWorkspace(tab: WorkspaceTab): void {
    this.activeWorkspaceTab.set(tab);
  }

  openMyProfile(): void {
    setTimeout(() => {
      const missing = this.jobSearchReadiness().missing;
      this.claimantProfile?.startEditing(
        missing.includes('targetRole')
          ? 'jobs'
          : missing.includes('location')
            ? 'location'
            : missing.includes('workplace')
              ? 'patterns'
              : 'jobs',
      );
      if (isPlatformBrowser(this.platformId)) {
        document.querySelector('#left-sidebar')?.scrollIntoView({behavior: 'smooth', block: 'start'});
      }
    });
  }

  openExperienceAndAchievements(origin: 'navigation' | 'summary' = 'navigation'): void {
    if (!isPlatformBrowser(this.platformId) || this.evidenceDialogRef) return;
    const dialogRef = this.dialog.open(EvidenceLibraryComponent, {
      ariaDescribedBy: 'evidence-manager-description',
      ariaLabelledBy: 'evidence-manager-title',
      ariaModal: true,
      autoFocus: 'dialog',
      closeOnNavigation: true,
      id: 'experience-evidence-dialog',
      maxHeight: '100dvh',
      maxWidth: '100vw',
      panelClass: 'evidence-library-dialog',
      restoreFocus: origin === 'summary',
      width: 'min(72rem, calc(100vw - 2rem))',
    });
    this.evidenceDialogRef = dialogRef;
    dialogRef.componentInstance.notify.subscribe(event =>
      this.showToast(event.message, event.type));
    dialogRef.componentInstance.changed.subscribe(() =>
      void this.claimantProfile?.refreshEvidenceSummary());
    dialogRef.afterClosed().subscribe(() => {
      if (this.evidenceDialogRef === dialogRef) {
        this.evidenceDialogRef = undefined;
      }
      if (origin === 'navigation' && isPlatformBrowser(this.platformId)) {
        document.querySelector<HTMLElement>('#btn-profile-dropdown')?.focus();
      }
    });
  }

  refreshReporting() {
    this.reportingPanel?.refresh();
  }

  refreshAfterAiGeneration() {
    this.jobResults?.refresh();
    this.myApplications?.refresh();
    this.documentsWorkspace?.refresh();
    this.refreshReporting();
    this.refreshDocumentCreditBalance();
  }

  refreshApplicationTracking(): void {
    this.myApplications?.refresh();
    this.documentsWorkspace?.refresh();
  }

  openApplicationFromDocument(applicationId: string): void {
    this.selectedApplicationId.set(applicationId);
    this.selectWorkspace('applications');
  }

  updateDocumentCreditBalance(balance: number) {
    this.documentCreditBalance.set(balance);
  }

  refreshDocumentCreditBalance() {
    if (!this.isLoggedIn()) return;
    this.paymentService.wallet().subscribe({
      next: (wallet) => this.updateDocumentCreditBalance(wallet.remainingDocumentGenerations),
      error: (error) => console.warn('Unable to refresh document-credit balance:', error),
    });
  }
}
