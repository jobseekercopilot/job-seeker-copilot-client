import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting, HttpTestingController} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import {BrowserSessionService} from './browser-session.service';
import {PaymentCheckoutPreparationError, PaymentService} from './payment.service';

describe('PaymentService', () => {
  const ensureCsrf = vi.fn(() => of(undefined));

  beforeEach(() => {
    ensureCsrf.mockReset();
    ensureCsrf.mockReturnValue(of(undefined));
    TestBed.configureTestingModule({
      providers: [
        PaymentService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {provide: BrowserSessionService, useValue: {ensureCsrf}},
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('submits only the server-required UK plan and consumer acknowledgements', () => {
    const service = TestBed.inject(PaymentService);
    service.checkout('starter', 'checkout-attempt-00000001').subscribe();

    const request = TestBed.inject(HttpTestingController)
      .expectOne('/api/v2/payments/checkout');
    expect(ensureCsrf).toHaveBeenCalledOnce();
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key'))
      .toBe('checkout-attempt-00000001');
    expect(request.request.body).toEqual({
      pricingPlanId: 'starter',
      billingCountry: 'GB',
      immediateSupplyRequested: true,
      cancellationRightLossAcknowledged: true,
    });
    expect(request.request.body).not.toHaveProperty('consumerTermsVersion');
    expect(request.request.body).not.toHaveProperty('acceptedAt');
    request.flush({url: 'https://checkout.stripe.com/example'});
  });

  it('does not send checkout if its same-origin CSRF preflight is unavailable', () => {
    ensureCsrf.mockReturnValue(throwError(() => new Error('private downstream detail')));
    const service = TestBed.inject(PaymentService);
    let observedError: unknown;

    service.checkout('starter', 'checkout-attempt-00000001').subscribe({
      error: error => observedError = error,
    });

    expect(observedError).toBeInstanceOf(PaymentCheckoutPreparationError);
    TestBed.inject(HttpTestingController).expectNone('/api/v2/payments/checkout');
  });

  it('reads an owner-scoped order status without putting other state in the URL', () => {
    const service = TestBed.inject(PaymentService);
    const orderId = 'c89d9cbb-9dfe-4f7b-9cbf-82ec67cfe9ef';
    service.orderStatus(orderId).subscribe();

    const request = TestBed.inject(HttpTestingController)
      .expectOne(`/api/v2/payments/orders/${orderId}/status`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    request.flush({orderId, status: 'CHECKOUT_OPEN'});
  });
});
