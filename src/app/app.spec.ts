import {provideHttpClient} from '@angular/common/http';
import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';
import {provideRouter, Router} from '@angular/router';
import {of} from 'rxjs';
import type {Observable} from 'rxjs';
import type {User} from './api';
import {EvidenceLibraryService, WorkPreferencesWorkplaceArrangementsEnum} from './api';
import {App} from './app';
import {routes} from './app.routes';
import type {BrowserSessionStatus} from './services/browser-session.service';
import {BrowserSessionService} from './services/browser-session.service';
import {JobService} from './services/job.service';
import {PaymentService} from './services/payment.service';
import type {PaymentOrderStatusResponse} from './services/payment.service';
import {ApplicationTrackerService} from './services/application-tracker.service';
import {RuntimeConfigurationService} from './services/runtime-configuration.service';

describe('App', () => {
  const status = signal<BrowserSessionStatus>('authenticated');
  const user = signal<User | null>({
    name: 'Alex Taylor',
    email: 'alex@example.test',
    profile: {
      skills: ['TypeScript'],
      aspirations: {targetRoles: ['Frontend developer']},
      workPreferences: {
        location: {postcode: 'RG1 1AA'},
        workplaceArrangements: new Set([WorkPreferencesWorkplaceArrangementsEnum.Hybrid]),
      },
    },
  });
  const searchJobs = vi.fn(() => of({jobs: [], totalResults: 0}));
  const wallet = vi.fn(() => of({
    remainingDocumentGenerations: 7,
    lifetimePurchasedDocumentGenerations: 7,
    lifetimeUsedDocumentGenerations: 0,
    lifetimeReversedDocumentGenerations: 0,
    reviewDebtDocumentGenerations: 0,
    freeAllowanceGranted: true,
    status: 'ACTIVE' as const,
  }));
  const orderId = 'c89d9cbb-9dfe-4f7b-9cbf-82ec67cfe9ef';
  const fulfilledOrder: PaymentOrderStatusResponse = {
    orderId,
    status: 'FULFILLED' as const,
    pricingPlanId: 'starter',
    documentGenerations: 10,
    promotionBonusDocumentGenerations: 5,
    totalGrantedDocumentGenerations: 15,
    priceMinor: 499,
    currency: 'GBP' as const,
    createdAt: '2026-08-15T10:00:00Z',
    expiresAt: '2026-08-15T11:00:00Z',
    fulfilledAt: '2026-08-15T10:02:00Z',
    generationsAdded: true,
    messageCode: 'GENERATIONS_ADDED',
    taxStatus: 'NOT_VAT_REGISTERED' as const,
    taxTreatment: 'VAT_NOT_CHARGED' as const,
    legalEntityType: 'SOLE_TRADER' as const,
    legalEntityConfigurationVersion: 'seller-v1',
  };
  const orderStatus = vi.fn<() => Observable<PaymentOrderStatusResponse>>();

  beforeEach(async () => {
    window.history.replaceState({}, '', '/dashboard');
    status.set('authenticated');
    user.set({
      id: 'user-1',
      name: 'Alex Taylor',
      email: 'alex@example.test',
      profile: {
        skills: ['TypeScript'],
        aspirations: {targetRoles: ['Frontend developer']},
        workPreferences: {
          location: {postcode: 'RG1 1AA'},
          workplaceArrangements: new Set([WorkPreferencesWorkplaceArrangementsEnum.Hybrid]),
        },
      },
    });
    searchJobs.mockClear();
    wallet.mockClear();
    orderStatus.mockReset();
    orderStatus.mockReturnValue(of(fulfilledOrder));

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideRouter(routes),
        {
          provide: BrowserSessionService,
          useValue: {
            status,
            user,
            restore: () => of(status()),
            logout: () => of({statusCode: 200, success: true, message: 'Logged out'}),
            acceptAuthenticatedUser: (next: User) => user.set(next),
            updateCurrentProfile: () => undefined,
            handleAuthenticatedError: () => undefined,
            ensureCsrf: () => of(undefined),
          },
        },
        {provide: JobService, useValue: {searchJobs}},
        {
          provide: RuntimeConfigurationService,
          useValue: {
            jobSearchMode: () => of({mode: 'FIXTURE'}),
            documentGenerationMode: () => of({mode: 'FIXTURE_LLM'}),
            commuteRoutingMode: () => of({mode: 'DISTANCE_ONLY'}),
            legalConfiguration: () => of({
              ready: false,
              status: 'DRAFT',
              minimumUserAge: 18,
              legalEntityType: 'NOT_CONFIGURED',
              taxStatus: 'NOT_CONFIGURED',
            }),
          },
        },
        {
          provide: ApplicationTrackerService,
          useValue: {
            listApplications: () => of([]),
            createApplication: vi.fn(),
            updateStatus: vi.fn(),
          },
        },
        {
          provide: EvidenceLibraryService,
          useValue: {
            listEvidence: () => of([]),
            createEvidence: vi.fn(),
            updateEvidence: vi.fn(),
            confirmEvidence: vi.fn(),
            archiveEvidence: vi.fn(),
            restoreEvidence: vi.fn(),
            hideEvidence: vi.fn(),
            showEvidence: vi.fn(),
            supersedeEvidence: vi.fn(),
          },
        },
        {
          provide: PaymentService,
          useValue: {
            wallet,
            catalog: () => of({plans: []}),
            checkoutReadiness: () => of({
              checkoutAvailable: false,
              code: 'PAYMENTS_DISABLED',
              mode: 'DISABLED',
              paymentServiceCode: 'PAYMENTS_DISABLED',
              providerCode: 'NOT_CHECKED',
            }),
            transactions: () => of({transactions: []}),
            orderStatus,
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
  });

  it('refreshes and displays document generations when the secure session is restored', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(wallet).toHaveBeenCalledWith();
    expect(fixture.componentInstance.documentCreditBalance()).toBe(7);
    expect(fixture.nativeElement.textContent).toContain('Documents: 7 generations');
  });

  it('renders the canonical product workspace with honest capability states', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Profile');
    expect(text).toContain('Job search');
    expect(text).toContain('Applications');
    expect(text).toContain('Documents');
    expect(text).toContain('Reporting & job-search evidence');
    expect(text).toContain('Document generations');
    expect(text).toContain('Fixture-backed');
    expect(fixture.componentInstance.commuteRoutingMode()).toBe('DISTANCE_ONLY');
    expect(searchJobs).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-evidence"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.workspace-tab')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.workspace-navigation')).toBeNull();

    fixture.nativeElement.querySelector('[data-testid="workspace-tab-applications"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application tracking');

    fixture.nativeElement.querySelector('[data-testid="workspace-tab-documents"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Documents, storage and export');

    fixture.nativeElement.querySelector('#btn-profile-dropdown').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Experience & achievements');
    expect((fixture.nativeElement.textContent.match(/Sign out/g) ?? [])).toHaveLength(1);
  });

  it('does not expose the dashboard while the secure session is being checked', () => {
    status.set('checking');
    user.set(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Checking your session');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-search"]')).toBeNull();
  });

  it('exposes public account content through one main landmark', () => {
    status.set('anonymous');
    user.set(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[role="main"]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('app-landing-auth[role="main"]')).not.toBeNull();
  });

  it('announces toast messages through an atomic live region', () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.toastMessage.set('Profile saved.');
    fixture.componentInstance.toastType.set('success');
    fixture.detectChanges();

    const toast = fixture.nativeElement.querySelector('#toast-notification') as HTMLElement;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.getAttribute('aria-atomic')).toBe('true');

    fixture.componentInstance.toastType.set('error');
    fixture.detectChanges();
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
  });

  it('makes the Privacy Policy and Terms publicly reachable without restoring a session', async () => {
    window.history.pushState({}, '', '/privacy');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Privacy Policy');
    expect(fixture.nativeElement.textContent).toContain(
      'Google route and commute-time calculations are not enabled',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-search"]')).toBeNull();

    window.history.pushState({}, '', '/terms');
    window.dispatchEvent(new PopStateEvent('popstate'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Terms of Use');
    expect(fixture.nativeElement.textContent).toContain('One document generation covers one successfully delivered tailored CV');
    window.history.pushState({}, '', '/dashboard');
  });

  it('trusts only the owner-scoped order record on a checkout return and strips the query', async () => {
    window.history.replaceState({}, '', `/payment/success?order_id=${orderId}`);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(orderStatus).toHaveBeenCalledWith(orderId);
    expect(window.location.search).toBe('');
    expect(fixture.componentInstance.paymentOrderState()).toBe('fulfilled');
    expect(fixture.nativeElement.textContent).toContain('Payment confirmed');
    expect(fixture.nativeElement.textContent).toContain(
      '15 document generations were added after secure server confirmation',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Stripe payment received');
  });

  it('can reconcile a late fulfilled webhook after a cancel return', async () => {
    vi.useFakeTimers();
    orderStatus
      .mockReturnValueOnce(of({
        ...fulfilledOrder,
        status: 'CHECKOUT_OPEN',
        totalGrantedDocumentGenerations: 0,
        fulfilledAt: null,
        generationsAdded: false,
        messageCode: 'PAYMENT_PENDING',
      }))
      .mockReturnValueOnce(of(fulfilledOrder));
    window.history.replaceState({}, '', `/payment/cancel?order_id=${orderId}`);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance.paymentOrderState()).toBe('checking');
    await vi.advanceTimersByTimeAsync(1_000);
    fixture.detectChanges();

    expect(orderStatus).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.paymentOrderState()).toBe('fulfilled');
    expect(fixture.nativeElement.textContent).toContain('Payment confirmed');
    fixture.destroy();
    vi.useRealTimers();
  });

  it.each([
    ['PENDING_CHECKOUT', 'PAYMENT_PENDING'],
    ['CHECKOUT_OPEN', 'PAYMENT_PENDING'],
  ] as const)(
    'keeps polling a canonical zero-grant %s order',
    async (pendingStatus, messageCode) => {
      vi.useFakeTimers();
      orderStatus
        .mockReturnValueOnce(of({
          ...fulfilledOrder,
          status: pendingStatus,
          totalGrantedDocumentGenerations: 0,
          fulfilledAt: null,
          generationsAdded: false,
          messageCode,
        }))
        .mockReturnValueOnce(of(fulfilledOrder));
      window.history.replaceState({}, '', `/payment/success?order_id=${orderId}`);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();

      expect(fixture.componentInstance.paymentOrderState()).toBe('checking');
      await vi.advanceTimersByTimeAsync(1_000);
      fixture.detectChanges();

      expect(orderStatus).toHaveBeenCalledTimes(2);
      expect(fixture.componentInstance.paymentOrderState()).toBe('fulfilled');
      fixture.destroy();
      vi.useRealTimers();
    },
  );

  it.each([
    ['CANCELLED', 'CHECKOUT_CANCELLED', 'cancelled', null],
    ['EXPIRED', 'CHECKOUT_EXPIRED', 'expired', null],
    ['REFUNDED', 'PAYMENT_REFUNDED', 'refunded', fulfilledOrder.fulfilledAt],
    ['PARTIALLY_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'refunded', fulfilledOrder.fulfilledAt],
    ['DISPUTED', 'PAYMENT_DISPUTED', 'disputed', fulfilledOrder.fulfilledAt],
    ['MANUAL_REVIEW', 'PAYMENT_REVIEW_REQUIRED', 'manual-review', null],
  ] as const)(
    'stops polling a canonical zero-grant %s order',
    async (terminalStatus, messageCode, expectedState, fulfilledAt) => {
      vi.useFakeTimers();
      orderStatus.mockReturnValue(of({
        ...fulfilledOrder,
        status: terminalStatus,
        totalGrantedDocumentGenerations: 0,
        fulfilledAt,
        generationsAdded: false,
        messageCode,
      }));
      window.history.replaceState({}, '', `/payment/cancel?order_id=${orderId}`);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(30_000);
      fixture.detectChanges();

      expect(orderStatus).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.paymentOrderState()).toBe(expectedState);
      fixture.destroy();
      vi.useRealTimers();
    },
  );

  it.each([
    ['pending order that claims granted credits', 'CHECKOUT_OPEN', 15],
    ['fulfilled order that reports zero granted credits', 'FULFILLED', 0],
  ] as const)(
    'rejects a malformed total: %s',
    async (_case, responseStatus, totalGrantedDocumentGenerations) => {
      orderStatus.mockReturnValue(of({
        ...fulfilledOrder,
        status: responseStatus,
        totalGrantedDocumentGenerations,
        fulfilledAt: responseStatus === 'FULFILLED'
          ? fulfilledOrder.fulfilledAt
          : null,
        generationsAdded: responseStatus === 'FULFILLED',
        messageCode: responseStatus === 'FULFILLED'
          ? 'GENERATIONS_ADDED'
          : 'PAYMENT_PENDING',
      }));
      window.history.replaceState({}, '', `/payment/success?order_id=${orderId}`);
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.paymentOrderState()).toBe('unavailable');
      expect(fixture.nativeElement.textContent).not.toContain('generations were added');
    },
  );

  it('does not call payment status for a malformed return identifier', () => {
    window.history.replaceState({}, '', '/payment/success?order_id=not-an-order&price=499');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(orderStatus).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(fixture.componentInstance.paymentOrderState()).toBe('invalid');
    expect(fixture.nativeElement.textContent).toContain(
      'No payment or document-generation outcome can be inferred',
    );
  });

  it('does not describe credits as added for an unrecognised server pricing record', async () => {
    orderStatus.mockReturnValue(of({
      ...fulfilledOrder,
      pricingPlanId: 'unexpected-plan',
      documentGenerations: 99,
      promotionBonusDocumentGenerations: 0,
      totalGrantedDocumentGenerations: 99,
      priceMinor: 1,
    }));
    window.history.replaceState({}, '', `/payment/success?order_id=${orderId}`);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.paymentOrderState()).toBe('unavailable');
    expect(fixture.nativeElement.textContent).toContain(
      'No payment or document-generation outcome can be inferred',
    );
    expect(fixture.nativeElement.textContent).not.toContain('generations were added');
  });

  it('does not trust a fulfilled order without matching reviewed seller and tax provenance', async () => {
    orderStatus.mockReturnValue(of({
      ...fulfilledOrder,
      taxStatus: 'VAT_REGISTERED',
      taxTreatment: 'VAT_NOT_CHARGED',
      legalEntityType: 'NOT_CONFIGURED',
      legalEntityConfigurationVersion: '',
    }));
    window.history.replaceState({}, '', `/payment/success?order_id=${orderId}`);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.paymentOrderState()).toBe('unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('generations were added');
  });

  it('enables the documents workspace for validated real OpenAI generation', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.documentGenerationMode.set('REAL_LLM');
    fixture.nativeElement.querySelector('[data-testid="workspace-tab-documents"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Real OpenAI generation');
    expect(fixture.nativeElement.querySelector('app-documents-workspace')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Document wording is fixture-generated',
    );
  });

  it('preserves search state while mounting only the selected Applications or Documents workspace', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const applicationsTab = fixture.nativeElement.querySelector(
      '[data-testid="workspace-tab-applications"]',
    ) as HTMLButtonElement;
    applicationsTab.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeWorkspaceTab()).toBe('applications');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-applications"]'))
      .not.toBeNull();
    expect((fixture.nativeElement.querySelector(
      '[data-testid="workspace-panel-search"]',
    ) as HTMLElement).hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-documents"]')).toBeNull();
    expect(applicationsTab.classList).toContain('workspace-tab-active');
    expect(applicationsTab.getAttribute('aria-current')).toBe('page');

    const documentsTab = fixture.nativeElement.querySelector(
      '[data-testid="workspace-tab-documents"]',
    ) as HTMLButtonElement;
    documentsTab.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeWorkspaceTab()).toBe('documents');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-documents"]'))
      .not.toBeNull();
    expect((fixture.nativeElement.querySelector(
      '[data-testid="workspace-panel-search"]',
    ) as HTMLElement).hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-applications"]'))
      .toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-experience"]'))
      .toBeNull();
  });

  it('opens one guarded evidence dialog without replacing the centre workspace', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector(
      '#manage-experience-evidence',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.querySelectorAll('app-evidence-library')).toHaveLength(1);
    expect(document.body.querySelector('#experience-evidence-dialog')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-search"]'))
      .not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-experience"]'))
      .toBeNull();

    fixture.componentInstance.openExperienceAndAchievements('summary');
    expect(document.body.querySelectorAll('app-evidence-library')).toHaveLength(1);
  });

  it('does not mount job search until the required preferences exist', async () => {
    user.set({
      name: 'New User',
      email: 'new@example.test',
      profile: {skills: [], aspirations: {targetRoles: []}},
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(searchJobs).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="search-setup-prompt"]'))
      .not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'We have not sent a job-search request',
    );
  });

  it('leaves a hosted account route after successful sign-in', () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.publicAccountRoute.set('signin');

    fixture.componentInstance.handleOnboarded({
      name: 'Alex Taylor',
      email: 'alex@example.test',
      profile: {
        skills: [],
        aspirations: {targetRoles: []},
        workPreferences: null,
      } as unknown as NonNullable<User['profile']>,
    });

    expect(fixture.componentInstance.publicAccountRoute()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/dashboard', {replaceUrl: true});
  });
});
