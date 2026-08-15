import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, throwError} from 'rxjs';
import {vi} from 'vitest';
import {
  PaymentCheckoutPreparationError,
  PaymentService,
} from '../../services/payment.service';
import {PaymentPanelComponent} from './payment-panel';

describe('PaymentPanelComponent', () => {
  const catalog = {
    catalogVersion: '2026-08-15',
    currency: 'GBP' as const,
    billingCountry: 'GB' as const,
    automaticRenewal: false as const,
    creditUnit: 'DOCUMENT' as const,
    freeAllowanceCredits: 2,
    displayedPriceIsCheckoutTotal: true,
    taxStatus: 'NOT_VAT_REGISTERED' as const,
    taxTreatment: 'VAT_NOT_CHARGED' as const,
    promotion: {
      id: 'founding-200',
      enabled: true,
      status: 'AVAILABLE' as const,
      bonusPercent: 50,
      customerLimit: 200,
    },
    plans: [
      {
        id: 'starter', name: 'Starter', description: 'For a focused start.',
        documentCredits: 10, priceMinor: 799, currency: 'GBP' as const,
        fullApplicationEquivalent: 5, promotionBonusDocumentCredits: 5,
        active: true, sortOrder: 1,
      },
      {
        id: 'active', name: 'Active', description: 'For an active search.',
        documentCredits: 25, priceMinor: 1699, currency: 'GBP' as const,
        fullApplicationEquivalent: 12, promotionBonusDocumentCredits: 13,
        active: true, sortOrder: 2,
      },
      {
        id: 'power', name: 'Power', description: 'For heavier use.',
        documentCredits: 60, priceMinor: 3499, currency: 'GBP' as const,
        fullApplicationEquivalent: 30, promotionBonusDocumentCredits: 30,
        active: true, sortOrder: 3,
      },
    ],
  };
  const checkoutResponse = {
    orderId: 'c89d9cbb-9dfe-4f7b-9cbf-82ec67cfe9ef',
    checkoutSessionId: 'cs_test_123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    status: 'CHECKOUT_OPEN' as const,
    expiresAt: '2099-08-15T16:00:00Z',
    pricingSnapshot: {
      catalogVersion: '2026-08-15',
      pricingPlanId: 'starter',
      pricingPlanName: 'Starter',
      documentCredits: 10,
      priceMinor: 799,
      currency: 'GBP' as const,
      billingCountry: 'GB' as const,
      taxStatus: 'NOT_VAT_REGISTERED' as const,
      taxTreatment: 'VAT_NOT_CHARGED' as const,
      legalEntityType: 'SOLE_TRADER' as const,
      legalEntityConfigurationVersion: 'seller-v1',
      displayedPriceIsCheckoutTotal: true,
    },
    promotionBonusDocumentCredits: 5,
    promotionGuaranteed: true,
    consumerTermsVersion: 'public-beta-v1',
    consumerAcknowledgementsRecorded: true,
  };
  const checkout = vi.fn((_planId: string, _idempotencyKey: string) => of(checkoutResponse));
  const paymentService = {
    wallet: () => of({
      balanceDocumentCredits: 2,
      lifetimePurchasedDocumentCredits: 2,
      lifetimeSpentDocumentCredits: 2,
      lifetimeReversedDocumentCredits: 0,
      reviewDebtDocumentCredits: 0,
      freeAllowanceGranted: true,
      status: 'ACTIVE' as const,
    }),
    catalog: () => of(catalog),
    checkoutReadiness: () => of({
      checkoutAvailable: true,
      code: 'READY' as const,
      mode: 'LIVE',
      paymentServiceCode: 'READY',
      providerCode: 'READY',
    }),
    transactions: () => of({
      transactions: [
        {
          id: 'c6d1d329-78d4-4dd1-bf75-5f30fdaec764',
          type: 'FREE_ALLOWANCE_GRANTED' as const,
          documentCredits: 2,
          balanceBeforeDocumentCredits: 0,
          balanceAfterDocumentCredits: 2,
          operationId: 'FREE_ALLOWANCE:user-1',
          description: 'Free document credits added',
          createdAt: '2026-08-15T10:00:00Z',
        },
        {
          id: 'af9f39c1-df42-4be9-97e9-4c87c8f7ea02',
          type: 'DOCUMENT_RESERVED' as const,
          documentCredits: 1,
          balanceBeforeDocumentCredits: 2,
          balanceAfterDocumentCredits: 1,
          operationId: 'DOCUMENT_RESERVATION_CREATE:test',
          description: 'Credit reserved',
          createdAt: '2026-08-15T10:01:00Z',
        },
        {
          id: '6e9f91aa-e716-4789-bfa1-b234efb4eec5',
          type: 'REFUND_REVERSAL' as const,
          documentCredits: 10,
          balanceBeforeDocumentCredits: 1,
          balanceAfterDocumentCredits: 0,
          operationId: 'REFUND:order-1',
          description: 'Credits restored after a refund',
          createdAt: '2026-08-15T11:00:00Z',
        },
        {
          id: '977b0b53-139e-47ab-999c-c08ac5fb2b15',
          type: 'DOCUMENT_RESERVATION_RELEASED' as const,
          documentCredits: 1,
          balanceBeforeDocumentCredits: 0,
          balanceAfterDocumentCredits: 1,
          operationId: 'DOCUMENT_RESERVATION_RELEASE:test',
          description: '',
          createdAt: '2026-08-15T11:01:00Z',
        },
        {
          id: 'c3d38711-2d43-4783-8f4f-b23ff395b921',
          type: 'DOCUMENT_SPENT' as const,
          documentCredits: 1,
          balanceBeforeDocumentCredits: 1,
          balanceAfterDocumentCredits: 1,
          operationId: 'DOCUMENT_DELIVERY:test',
          description: 'Document generated successfully',
          createdAt: '2026-08-15T11:02:00Z',
        },
      ],
    }),
    checkout,
  };

  beforeEach(async () => {
    checkout.mockClear();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{provide: PaymentService, useValue: paymentService}],
    }).compileComponents();
  });

  it('renders exact document-credit packs without exposing model tokens', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('2 credits available');
    expect(text).toContain('Starter');
    expect(text).toContain('£7.99');
    expect(text).toContain('10 credits');
    expect(text).toContain('Active');
    expect(text).toContain('25 credits');
    expect(text).toContain('Power');
    expect(text).toContain('60 credits');
    expect(text).toContain('No subscription or automatic renewal');
    expect(text).not.toContain('token');
    expect(text).not.toContain('25–30');
  });

  it('has no automated accessibility violations in purchase and history modes', async () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect((await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    })).violations).toEqual([]);

    fixture.componentRef.setInput('mode', 'history');
    fixture.detectChanges();
    expect((await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    })).violations).toEqual([]);
  });

  it('keeps the wallet summary independent from catalogue and checkout availability', async () => {
    const unavailableCatalog = vi.fn(() => throwError(() => new Error('unavailable')));
    const unavailableReadiness = vi.fn(() => throwError(() => new Error('unavailable')));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {
          ...paymentService,
          catalog: unavailableCatalog,
          checkoutReadiness: unavailableReadiness,
        },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('mode', 'summary');
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    expect(unavailableCatalog).not.toHaveBeenCalled();
    expect(unavailableReadiness).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('2 credits');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('fails closed when catalogue bonus metadata does not match the approved packs', async () => {
    const unsafeCatalog = {
      ...catalog,
      plans: catalog.plans.map(plan => plan.id === 'active'
        ? {...plan, promotionBonusDocumentCredits: 12}
        : plan),
    };
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, catalog: () => of(unsafeCatalog)},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Pricing is unavailable because the current catalogue could not be verified.',
    );
    expect(fixture.nativeElement.querySelectorAll('.pricing-card')).toHaveLength(0);
  });

  it.each([
    ['DISABLED', false],
    ['EXHAUSTED', true],
  ] as const)(
    'renders base packs without advertising an unavailable %s promotion',
    async (status, enabled) => {
      const unavailablePromotionCatalog = {
        ...catalog,
        promotion: {...catalog.promotion, enabled, status},
        plans: catalog.plans.map(plan => ({
          ...plan,
          promotionBonusDocumentCredits: 0,
        })),
      };
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [PaymentPanelComponent],
        providers: [{
          provide: PaymentService,
          useValue: {
            ...paymentService,
            catalog: () => of(unavailablePromotionCatalog),
          },
        }],
      }).compileComponents();
      const fixture = TestBed.createComponent(PaymentPanelComponent);
      fixture.componentRef.setInput('userId', 'user-1');
      fixture.componentRef.setInput('legalReady', true);
      fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('.pricing-card')).toHaveLength(3);
      expect(fixture.nativeElement.textContent).not.toContain(
        'Pricing is unavailable because the current catalogue could not be verified.',
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'Founding customer offer currently available',
      );
    },
  );

  it.each([
    ['available promotion with zero bonuses', true, 'AVAILABLE', 0],
    ['disabled promotion with advertised bonuses', false, 'DISABLED', 5],
    ['exhausted promotion with advertised bonuses', true, 'EXHAUSTED', 5],
    ['available status while promotion is disabled', false, 'AVAILABLE', 5],
    ['exhausted status while promotion is disabled', false, 'EXHAUSTED', 0],
  ] as const)(
    'fails closed for malformed catalogue state: %s',
    async (_case, enabled, status, starterBonus) => {
      const malformedCatalog = {
        ...catalog,
        promotion: {...catalog.promotion, enabled, status},
        plans: catalog.plans.map(plan => ({
          ...plan,
          promotionBonusDocumentCredits: starterBonus === 0
            ? 0
            : plan.promotionBonusDocumentCredits,
        })),
      };
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [PaymentPanelComponent],
        providers: [{
          provide: PaymentService,
          useValue: {...paymentService, catalog: () => of(malformedCatalog)},
        }],
      }).compileComponents();
      const fixture = TestBed.createComponent(PaymentPanelComponent);
      fixture.componentRef.setInput('userId', 'user-1');
      fixture.componentRef.setInput('legalReady', true);
      fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Pricing is unavailable because the current catalogue could not be verified.',
      );
      expect(fixture.nativeElement.querySelectorAll('.pricing-card')).toHaveLength(0);
    },
  );

  it.each([
    ['duplicate plan ids', catalog.plans.map((plan, index) => index === 1
      ? {...plan, id: 'starter'}
      : plan)],
    ['non-canonical sort order', catalog.plans.map(plan => plan.id === 'power'
      ? {...plan, sortOrder: 2}
      : plan)],
  ])('fails closed for %s in the server catalogue', async (_case, plans) => {
    const malformedCatalog = {...catalog, plans};
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, catalog: () => of(malformedCatalog)},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Pricing is unavailable because the current catalogue could not be verified.',
    );
    expect(fixture.nativeElement.querySelectorAll('.pricing-card')).toHaveLength(0);
  });

  it('fails closed when founding-offer availability is not canonical', async () => {
    const unsafeCatalog = {
      ...catalog,
      promotion: {...catalog.promotion, customerLimit: 201},
    };
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, catalog: () => of(unsafeCatalog)},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Pricing is unavailable because the current catalogue could not be verified.',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Founding customer offer currently available',
    );
  });

  it('requires UK one-off-purchase acknowledgement before opening checkout', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const checkbox = fixture.nativeElement.querySelector(
      '.purchase-confirmation input',
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
    button.click();
    fixture.detectChanges();

    expect(checkout).toHaveBeenCalledOnce();
    expect(checkout.mock.calls[0][0]).toBe('starter');
    expect(checkout.mock.calls[0][1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_test_123',
    );
  });

  it('fails closed when checkout readiness is not authorised', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {
          ...paymentService,
          checkoutReadiness: () => of({
            checkoutAvailable: false,
            code: 'LIVE_RELEASE_NOT_AUTHORISED',
            mode: 'DISABLED',
            paymentServiceCode: 'LIVE_RELEASE_NOT_AUTHORISED',
            providerCode: 'NOT_CHECKED',
          }),
        },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Purchasing is prepared but has not been authorised for this release.',
    );
    expect(Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.stripe-button'))
      .every(button => button.disabled)).toBe(true);
  });

  it('does not open checkout when the final readiness response is internally inconsistent', async () => {
    const readiness = vi.fn()
      .mockReturnValueOnce(of({
        checkoutAvailable: true,
        code: 'READY' as const,
        mode: 'LIVE' as const,
        paymentServiceCode: 'READY' as const,
        providerCode: 'READY' as const,
      }))
      .mockReturnValueOnce(of({
        checkoutAvailable: true,
        code: 'READY' as const,
        mode: 'TEST' as const,
        paymentServiceCode: 'READY' as const,
        providerCode: 'READY' as const,
      }));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkoutReadiness: readiness},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '.purchase-confirmation input',
    ) as HTMLInputElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(checkout).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Purchasing cannot be verified right now',
    );
  });

  it('explains an unconfigured seller identity without enabling checkout', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {
          ...paymentService,
          checkoutReadiness: () => of({
            checkoutAvailable: false,
            code: 'LEGAL_ENTITY_NOT_CONFIGURED',
            mode: 'DISABLED',
            paymentServiceCode: 'LEGAL_ENTITY_NOT_CONFIGURED',
            providerCode: 'NOT_CHECKED',
          }),
        },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Purchasing is blocked until the seller identity has completed release review.',
    );
    expect(Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.stripe-button'))
      .every(button => button.disabled)).toBe(true);
  });

  it('distinguishes payment-service and payment-provider readiness failures', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    expect(fixture.componentInstance.readinessMessage('PAYMENT_SERVICE_UNAVAILABLE'))
      .toContain('payment service is temporarily unavailable');
    expect(fixture.componentInstance.readinessMessage('PAYMENT_PROVIDER_UNAVAILABLE'))
      .toContain('payment provider is temporarily unavailable');
  });

  it('keeps checkout disabled for a wallet in payment review', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {
          ...paymentService,
          wallet: () => of({
            balanceDocumentCredits: 2,
            lifetimePurchasedDocumentCredits: 0,
            lifetimeSpentDocumentCredits: 0,
            lifetimeReversedDocumentCredits: 0,
            reviewDebtDocumentCredits: 1,
            freeAllowanceGranted: true,
            status: 'BLOCKED_REVIEW',
          }),
        },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Purchasing is paused while your payment account is reviewed.',
    );
    expect(Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('.stripe-button'),
    ).every(button => button.disabled)).toBe(true);
  });

  it('reuses an idempotency key after an ambiguous checkout failure', async () => {
    const ambiguousCheckout = vi.fn((_planId: string, _idempotencyKey: string) => of(checkoutResponse))
      .mockReturnValueOnce(throwError(() => ({status: 504})))
      .mockReturnValueOnce(of(checkoutResponse));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkout: ambiguousCheckout},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement).click();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry checkout safely');
    button.click();
    fixture.detectChanges();

    expect(ambiguousCheckout).toHaveBeenCalledTimes(2);
    expect(ambiguousCheckout.mock.calls[0][1]).toBe(ambiguousCheckout.mock.calls[1][1]);
    expect(redirectSpy).toHaveBeenCalledOnce();
  });

  it('classifies checkout failures only by the canonical code field', async () => {
    const malformedCheckout = vi.fn(() => throwError(() => ({
      status: 503,
      error: {
        error: 'COUNTRY_NOT_SUPPORTED',
        message: 'untrusted downstream message',
      },
    })));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkout: malformedCheckout},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement)
      .click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'We could not confirm whether checkout opened.',
    );
    expect(fixture.nativeElement.textContent).toContain('Retry checkout safely');
    expect(fixture.nativeElement.textContent).not.toContain('UK billing address');
  });

  it('reports a failed checkout preflight as no payment requested', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {
          ...paymentService,
          checkout: () => throwError(() => new PaymentCheckoutPreparationError()),
        },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement)
      .click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Secure checkout could not be prepared. No payment has been requested',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Retry checkout safely');
  });

  it('does not redirect when the server-recorded consumer terms version differs', async () => {
    const mismatchedTermsCheckout = vi.fn(() => of({
      ...checkoutResponse,
      consumerTermsVersion: 'public-beta-v2',
    }));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkout: mismatchedTermsCheckout},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement)
      .click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Checkout returned terms or pricing details that could not be verified.',
    );
  });

  it('does not redirect when checkout acknowledgements or the pricing snapshot are unverified', async () => {
    const unsafeCheckout = vi.fn(() => of({
      ...checkoutResponse,
      consumerAcknowledgementsRecorded: false,
      pricingSnapshot: {
        ...checkoutResponse.pricingSnapshot,
        priceMinor: 899,
      },
    }));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkout: unsafeCheckout},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Checkout returned terms or pricing details that could not be verified.',
    );
  });

  it('fails closed without throwing when checkout returns an incomplete body', async () => {
    const incompleteCheckout = vi.fn(() => of({
      orderId: checkoutResponse.orderId,
      url: checkoutResponse.url,
      status: 'CHECKOUT_OPEN',
    }));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkout: incompleteCheckout},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement)
      .click();
    fixture.detectChanges();

    expect(() => (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click()).not.toThrow();
    fixture.detectChanges();

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.checkoutError()).toContain(
      'terms or pricing details that could not be verified',
    );
  });

  it('rejects checkout snapshots without reviewed seller and matching tax provenance', async () => {
    const unsafeCheckout = vi.fn(() => of({
      ...checkoutResponse,
      pricingSnapshot: {
        ...checkoutResponse.pricingSnapshot,
        legalEntityType: 'NOT_CONFIGURED' as const,
        taxStatus: 'VAT_REGISTERED' as const,
      },
    }));
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {...paymentService, checkout: unsafeCheckout},
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('legalReady', true);
    fixture.componentRef.setInput('legalVersion', checkoutResponse.consumerTermsVersion);
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.purchase-confirmation input') as HTMLInputElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '[data-analytics-plan="starter"] button',
    ) as HTMLButtonElement).click();

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.checkoutError()).toContain(
      'terms or pricing details that could not be verified',
    );
  });

  it('shows exact reservation, delivery, restoration and reversal balance semantics', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('mode', 'history');
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Free document credits added');
    expect(fixture.nativeElement.textContent).toContain('Credits reversed after a payment refund');
    expect(fixture.nativeElement.textContent).not.toContain('Credits restored after a refund');
    expect(fixture.nativeElement.textContent).toContain('-10 credits');
    expect(fixture.nativeElement.textContent).toContain(
      'Document credit restored because generation did not complete',
    );
    expect(fixture.nativeElement.textContent).toContain('+1 credit');
    expect(fixture.nativeElement.textContent).toContain(
      'Document credit reserved while generation is running',
    );
    expect(fixture.nativeElement.textContent).toContain('-1 credit');
    expect(fixture.nativeElement.textContent).toContain(
      'Delivered document completed from the reserved credit',
    );
    expect(fixture.nativeElement.textContent).toContain('No further balance change');
    expect(fixture.nativeElement.textContent).not.toContain('Document generated successfully');
  });

  it('fails closed instead of rendering an incomplete transaction ledger', async () => {
    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{
        provide: PaymentService,
        useValue: {
          ...paymentService,
          transactions: () => of({transactions: [{
            id: 'tx-without-a-verified-contract',
            type: 'PURCHASE',
            documentCredits: 10,
          }]}),
        },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('mode', 'history');
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'history is unavailable because its current state could not be verified',
    );
    expect(fixture.nativeElement.querySelector('.transactions-row')).toBeNull();
  });
});
