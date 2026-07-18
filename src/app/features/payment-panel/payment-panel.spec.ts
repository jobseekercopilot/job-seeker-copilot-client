import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { PaymentPanelComponent } from './payment-panel';
import { PaymentService } from '../../services/payment.service';

describe('PaymentPanelComponent', () => {
  let balance = 20000;
  const paymentService = {
    wallet: () => of({
      userId: 'user-1',
      balanceTokens: balance,
      freeTrialGranted: true,
    }),
    pricing: () => of({
      plans: [
        {
          id: 'starter',
          name: 'Starter',
          description: 'Good for trying AI features',
          tokenAmount: 100000,
          priceGbpPence: 799,
        },
      ],
    }),
    transactions: () => of({
      transactions: [
        {
          id: 'tx-1',
          transactionType: 'FREE_TRIAL_GRANTED',
          tokenAmount: 20000,
          balanceAfter: 20000,
          description: 'Free starter AI Credit granted',
        },
      ],
    }),
    demoPurchase: () => {
      balance = 120000;
      return of({
        wallet: { userId: 'user-1', balanceTokens: balance, freeTrialGranted: true },
      });
    },
    checkout: () => of({
      sessionId: 'cs_test_123',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
    }),
  };

  beforeEach(async () => {
    balance = 20000;
    await TestBed.configureTestingModule({
      imports: [PaymentPanelComponent],
      providers: [{ provide: PaymentService, useValue: paymentService }],
    }).compileComponents();
  });

  it('renders wallet, pricing plans, and transaction history', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('AI Credit');
    expect(text).toContain('£1.60');
    expect(text).toContain('Starter');
    expect(text).toContain('Approx. 25-30 CV & cover letter generations');
  });

  it('demo purchase updates balance', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.demo-button').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('£9.59');
  });

  it('redirects to Stripe checkout URL', () => {
    const fixture = TestBed.createComponent(PaymentPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    const redirectSpy = vi.spyOn(fixture.componentInstance, 'redirectToCheckout');
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.stripe-button').click();
    fixture.detectChanges();

    expect(redirectSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_123');
  });
});
