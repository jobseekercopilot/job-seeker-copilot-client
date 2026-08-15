import {CommonModule} from '@angular/common';
import {Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {
  CheckoutReadinessCode,
  CheckoutReadinessResponse,
  CheckoutResponse,
  DocumentCreditPlan,
  DocumentCreditTransaction,
  DocumentCreditWalletResponse,
  PaymentCatalogResponse,
  PaymentCheckoutPreparationError,
  PaymentService,
} from '../../services/payment.service';

type PaymentPanelMode = 'summary' | 'purchase' | 'history';

interface ExpectedPlan {
  credits: number;
  applications: number;
  bonusCredits: number;
  name: string;
  priceMinor: number;
}

const EXPECTED_PLANS: Readonly<Record<string, ExpectedPlan>> = {
  starter: {credits: 10, applications: 5, bonusCredits: 5, name: 'Starter', priceMinor: 799},
  active: {credits: 25, applications: 12, bonusCredits: 13, name: 'Active', priceMinor: 1699},
  power: {credits: 60, applications: 30, bonusCredits: 30, name: 'Power', priceMinor: 3499},
};

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DETERMINISTIC_CHECKOUT_ERRORS = new Set([
  'CHECKOUT_DISABLED',
  'CONSUMER_ACKNOWLEDGEMENTS_REQUIRED',
  'COUNTRY_NOT_SUPPORTED',
  'IDEMPOTENCY_KEY_CONFLICT',
  'IDEMPOTENCY_KEY_INVALID',
  'IDEMPOTENCY_KEY_REQUIRED',
  'LEGAL_ENTITY_NOT_CONFIGURED',
  'LIVE_RELEASE_NOT_AUTHORISED',
  'PAYMENTS_DISABLED',
  'PAYMENT_ACCESS_REVOKED',
  'PAYMENT_REVIEW_REQUIRED',
  'PLAN_NOT_AVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENT_SERVICE_UNAVAILABLE',
  'TAX_STATUS_NOT_CONFIGURED',
  'CHECKOUT_PREFLIGHT_UNAVAILABLE',
]);

const CONFIGURATION_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const DOCUMENT_CREDIT_TRANSACTION_TYPES = new Set<DocumentCreditTransaction['type']>([
  'FREE_ALLOWANCE_GRANTED',
  'PURCHASE',
  'PROMOTION_BONUS',
  'DOCUMENT_RESERVED',
  'DOCUMENT_SPENT',
  'DOCUMENT_RESERVATION_RELEASED',
  'REFUND_REVERSAL',
  'DISPUTE_REVERSAL',
  'ADJUSTMENT',
]);

@Component({
  selector: 'app-payment-panel',
  standalone: true,
  imports: [CommonModule],
  host: {
    'data-demo-focus': 'app-payment-panel',
    '[attr.data-demo-focus-id]': 'demoFocusId()',
  },
  templateUrl: './payment-panel.html',
  styleUrls: ['./payment-panel.css'],
})
export class PaymentPanelComponent {
  userId = input<string>('');
  authToken = input<string>('');
  mode = input<PaymentPanelMode>('purchase');
  legalReady = input(false);
  legalVersion = input('');
  balanceChanged = output<number>();

  private readonly paymentService = inject(PaymentService);
  private readonly checkoutAttemptKeys = new Map<string, string>();

  catalog = signal<PaymentCatalogResponse | null>(null);
  wallet = signal<DocumentCreditWalletResponse | null>(null);
  transactions = signal<DocumentCreditTransaction[]>([]);
  readiness = signal<CheckoutReadinessResponse | null>(null);
  loading = signal(false);
  checkoutPlanId = signal<string | null>(null);
  retryPlanId = signal<string | null>(null);
  purchaseTermsAccepted = signal(false);
  dataError = signal<string | null>(null);
  checkoutError = signal<string | null>(null);

  plans = computed(() => [...(this.catalog()?.plans ?? [])]
    .filter(plan => plan.active)
    .sort((left, right) => left.sortOrder - right.sortOrder));
  checkoutAvailable = computed(() => {
    const readiness = this.readiness();
    return this.legalReady()
      && CONFIGURATION_VERSION.test(this.legalVersion())
      && this.wallet()?.status === 'ACTIVE'
      && readiness?.checkoutAvailable === true
      && readiness.code === 'READY';
  });
  promotionAvailable = computed(() => {
    const promotion = this.catalog()?.promotion;
    return promotion?.enabled === true && promotion.status === 'AVAILABLE';
  });
  spentPercent = computed(() => {
    const wallet = this.wallet();
    const remaining = wallet?.balanceDocumentCredits ?? 0;
    const spent = wallet?.lifetimeSpentDocumentCredits ?? 0;
    const total = remaining + spent;
    return total > 0 ? Math.round((spent / total) * 100) : 0;
  });
  ringStyle = computed(() =>
    `conic-gradient(#2563eb 0 ${this.spentPercent()}%, #dbeafe ${this.spentPercent()}% 100%)`,
  );
  visibleTransactions = computed(() => this.transactions());

  constructor() {
    effect(() => {
      if (this.userId() || this.authToken()) this.load();
    });
  }

  demoFocusId(): string {
    if (this.mode() === 'history') return 'document-credit-ledger';
    if (this.mode() === 'summary') return 'document-credit-summary';
    return 'document-credit-purchase';
  }

  refresh(): void {
    this.load();
  }

  acceptPurchaseTerms(event: Event): void {
    this.purchaseTermsAccepted.set((event.target as HTMLInputElement).checked);
    this.checkoutError.set(null);
  }

  buyWithStripe(plan: DocumentCreditPlan): void {
    if (!this.purchaseTermsAccepted() || !this.checkoutAvailable()) return;
    if (!Object.hasOwn(EXPECTED_PLANS, plan.id)) return;

    this.checkoutPlanId.set(plan.id);
    this.checkoutError.set(null);
    this.paymentService.checkoutReadiness().subscribe({
      next: readiness => {
        if (!this.readinessIsSafe(readiness)) {
          this.readiness.set(null);
          this.checkoutError.set(
            'Purchasing cannot be verified right now, so checkout has not been opened. No payment has been requested.',
          );
          this.checkoutPlanId.set(null);
          return;
        }
        this.readiness.set(readiness);
        if (!readiness.checkoutAvailable || readiness.code !== 'READY') {
          this.checkoutError.set(this.readinessMessage(readiness.code));
          this.checkoutPlanId.set(null);
          return;
        }
        this.startCheckout(plan);
      },
      error: () => {
        this.readiness.set(null);
        this.checkoutError.set(
          'Purchasing cannot be verified right now, so checkout has not been opened. No payment has been requested.',
        );
        this.checkoutPlanId.set(null);
      },
    });
  }

  redirectToCheckout(checkoutUrl: string): void {
    window.location.assign(checkoutUrl);
  }

  formatPrice(pence: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    }).format(pence / 100);
  }

  formatCredits(value: number | null | undefined, includeSign = false): string {
    const credits = value ?? 0;
    const sign = includeSign && credits > 0 ? '+' : '';
    const unit = Math.abs(credits) === 1 ? 'credit' : 'credits';
    return `${sign}${credits.toLocaleString('en-GB')} ${unit}`;
  }

  formatTransactionCredits(transaction: DocumentCreditTransaction): string {
    if (transaction.type === 'DOCUMENT_SPENT') return 'No further balance change';
    const amount = this.signedTransactionAmount(transaction);
    return this.formatCredits(amount, true);
  }

  formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  planUsageSummary(plan: DocumentCreditPlan): string {
    const remainder = plan.documentCredits - (plan.fullApplicationEquivalent * 2);
    const suffix = remainder === 1 ? ', plus one individual document' : '';
    return `Up to ${plan.fullApplicationEquivalent} complete applications${suffix}`;
  }

  checkoutButtonLabel(plan: DocumentCreditPlan): string {
    if (this.checkoutPlanId() === plan.id) return 'Checking secure checkout…';
    if (this.retryPlanId() === plan.id) return 'Retry checkout safely';
    return `Choose ${plan.name}`;
  }

  transactionActivity(transaction: DocumentCreditTransaction): string {
    if (transaction.type === 'DOCUMENT_RESERVED'
      || transaction.type === 'DOCUMENT_SPENT'
      || transaction.type === 'REFUND_REVERSAL'
      || transaction.type === 'DISPUTE_REVERSAL'
      || transaction.type === 'DOCUMENT_RESERVATION_RELEASED') {
      return this.defaultTransactionDescription(transaction.type);
    }
    return transaction.description.trim() || this.defaultTransactionDescription(transaction.type);
  }

  readinessMessage(code: CheckoutReadinessCode | undefined = this.readiness()?.code): string {
    if (!this.legalReady()) {
      return 'Purchasing is blocked until the public-beta legal documents and business identity have completed release review.';
    }
    if (!CONFIGURATION_VERSION.test(this.legalVersion())) {
      return 'Purchasing is blocked until the current consumer terms version can be verified.';
    }
    const wallet = this.wallet();
    if (!wallet) {
      return this.loading()
        ? 'Checking your document-credit account before enabling checkout.'
        : 'Purchasing is blocked because your document-credit account could not be verified.';
    }
    if (wallet.status === 'BLOCKED_REVIEW') {
      return 'Purchasing is paused while your payment account is reviewed.';
    }
    if (wallet.status === 'REVOKED') {
      return 'Purchasing is unavailable for this account. Contact support if you need help.';
    }
    switch (code) {
      case 'READY':
        return 'Secure one-off checkout is available.';
      case 'PROVIDER_UNAVAILABLE':
      case 'PAYMENT_PROVIDER_UNAVAILABLE':
        return 'The payment provider is temporarily unavailable. Purchasing is paused and no payment has been requested.';
      case 'PAYMENT_SERVICE_UNAVAILABLE':
        return 'The payment service is temporarily unavailable. Purchasing is paused and no payment has been requested.';
      case 'LIVE_RELEASE_NOT_AUTHORISED':
        return 'Purchasing is prepared but has not been authorised for this release.';
      case 'TAX_STATUS_NOT_CONFIGURED':
        return 'Purchasing is blocked until the seller tax status has completed release review.';
      case 'LEGAL_ENTITY_NOT_CONFIGURED':
        return 'Purchasing is blocked until the seller identity has completed release review.';
      case 'PAYMENTS_DISABLED':
      default:
        return 'Purchasing is currently disabled. You can continue using the free job-search tools.';
    }
  }

  taxMessage(): string {
    const catalog = this.catalog();
    if (catalog?.taxTreatment === 'VAT_INCLUDED') {
      return 'VAT is included in each displayed price. The displayed price is the checkout total.';
    }
    return 'Each displayed price is the total charged at checkout.';
  }

  private startCheckout(plan: DocumentCreditPlan): void {
    let idempotencyKey = this.checkoutAttemptKeys.get(plan.id);
    if (!idempotencyKey) {
      try {
        idempotencyKey = this.newIdempotencyKey();
      } catch {
        this.checkoutError.set(
          'This browser cannot create the secure identifier required for checkout. No payment has been requested.',
        );
        this.checkoutPlanId.set(null);
        return;
      }
    }
    this.checkoutAttemptKeys.set(plan.id, idempotencyKey);

    this.paymentService.checkout(plan.id, idempotencyKey).subscribe({
      next: response => {
        if (!this.checkoutResponseMatchesPlan(response, plan)) {
          this.retryPlanId.set(plan.id);
          this.checkoutError.set(
            'Checkout returned terms or pricing details that could not be verified. Use “Retry checkout safely” to check the same attempt; do not start another checkout elsewhere. Contact support if the issue continues.',
          );
          this.checkoutPlanId.set(null);
          return;
        }
        this.retryPlanId.set(null);
        this.redirectToCheckout(response.url);
      },
      error: (error: unknown) => {
        const code = this.errorCode(error);
        if (code && DETERMINISTIC_CHECKOUT_ERRORS.has(code)) {
          this.checkoutAttemptKeys.delete(plan.id);
          this.retryPlanId.set(null);
        } else {
          this.retryPlanId.set(plan.id);
        }
        this.checkoutError.set(this.checkoutErrorMessage(code));
        this.checkoutPlanId.set(null);
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.dataError.set(null);
    this.checkoutError.set(null);

    if (this.mode() === 'purchase') {
      this.paymentService.catalog().subscribe({
        next: catalog => {
          if (!this.catalogIsSafe(catalog)) {
            this.catalog.set(null);
            this.dataError.set('Pricing is unavailable because the current catalogue could not be verified.');
            return;
          }
          this.catalog.set(catalog);
        },
        error: () => {
          this.catalog.set(null);
          this.dataError.set('Document-credit pricing is temporarily unavailable.');
        },
      });
      this.paymentService.checkoutReadiness().subscribe({
        next: readiness => this.readiness.set(
          this.readinessIsSafe(readiness) ? readiness : null,
        ),
        error: () => this.readiness.set(null),
      });
    } else {
      this.catalog.set(null);
      this.readiness.set(null);
    }
    this.paymentService.wallet().subscribe({
      next: wallet => {
        if (!this.walletIsSafe(wallet)) {
          this.wallet.set(null);
          this.dataError.set(
            'Your document-credit account is unavailable because its current state could not be verified.',
          );
          this.loading.set(false);
          return;
        }
        this.wallet.set(wallet);
        this.balanceChanged.emit(wallet.balanceDocumentCredits);
        this.loading.set(false);
      },
      error: () => {
        this.wallet.set(null);
        this.dataError.set('Your document-credit balance is temporarily unavailable.');
        this.loading.set(false);
      },
    });
    if (this.mode() === 'history') this.loadTransactions();
  }

  private loadTransactions(): void {
    this.paymentService.transactions().subscribe({
      next: response => {
        if (!Array.isArray(response.transactions)
          || !response.transactions.every(transaction => this.transactionIsSafe(transaction))) {
          this.transactions.set([]);
          this.dataError.set(
            'Your document-credit history is unavailable because its current state could not be verified.',
          );
          return;
        }
        this.transactions.set(response.transactions);
      },
      error: () => this.dataError.set('Your document-credit history is temporarily unavailable.'),
    });
  }

  private catalogIsSafe(catalog: PaymentCatalogResponse): boolean {
    if (!catalog
      || typeof catalog !== 'object'
      || typeof catalog.catalogVersion !== 'string'
      || !CONFIGURATION_VERSION.test(catalog.catalogVersion)
      || catalog.currency !== 'GBP'
      || catalog.billingCountry !== 'GB'
      || catalog.automaticRenewal !== false
      || catalog.creditUnit !== 'DOCUMENT'
      || catalog.freeAllowanceCredits !== 2
      || catalog.displayedPriceIsCheckoutTotal !== true
      || !['NOT_CONFIGURED', 'NOT_VAT_REGISTERED', 'VAT_REGISTERED'].includes(catalog.taxStatus)
      || !['VAT_INCLUDED', 'VAT_NOT_CHARGED'].includes(catalog.taxTreatment)
      || (catalog.taxStatus === 'VAT_REGISTERED') !== (catalog.taxTreatment === 'VAT_INCLUDED')
      || !catalog.promotion
      || typeof catalog.promotion.id !== 'string'
      || catalog.promotion.id.trim().length === 0
      || catalog.promotion.id.length > 64
      || typeof catalog.promotion.enabled !== 'boolean'
      || !['AVAILABLE', 'EXHAUSTED', 'DISABLED'].includes(catalog.promotion.status)
      || catalog.promotion.bonusPercent !== 50
      || catalog.promotion.customerLimit !== 200
      || !Array.isArray(catalog.plans)) return false;

    const plans = catalog.plans.filter(plan => plan
      && typeof plan === 'object'
      && plan.active === true);
    if (plans.length !== Object.keys(EXPECTED_PLANS).length) return false;
    return plans.every(plan => {
      const expected = EXPECTED_PLANS[plan.id];
      return expected !== undefined
        && typeof plan.description === 'string'
        && plan.description.trim().length > 0
        && plan.description.length <= 256
        && plan.name === expected.name
        && plan.currency === 'GBP'
        && plan.documentCredits === expected.credits
        && plan.fullApplicationEquivalent === expected.applications
        && plan.promotionBonusDocumentCredits === expected.bonusCredits
        && plan.priceMinor === expected.priceMinor
        && Number.isInteger(plan.sortOrder);
    });
  }

  private walletIsSafe(wallet: DocumentCreditWalletResponse): boolean {
    return wallet !== null
      && typeof wallet === 'object'
      && [
        wallet.balanceDocumentCredits,
        wallet.lifetimePurchasedDocumentCredits,
        wallet.lifetimeSpentDocumentCredits,
        wallet.lifetimeReversedDocumentCredits,
        wallet.reviewDebtDocumentCredits,
      ].every(value => Number.isInteger(value) && value >= 0)
      && typeof wallet.freeAllowanceGranted === 'boolean'
      && ['ACTIVE', 'BLOCKED_REVIEW', 'REVOKED'].includes(wallet.status);
  }

  private readinessIsSafe(readiness: CheckoutReadinessResponse): boolean {
    if (!readiness || typeof readiness !== 'object'
      || typeof readiness.checkoutAvailable !== 'boolean') return false;
    const codeIsSafe = [
      'READY',
      'PAYMENTS_DISABLED',
      'LIVE_RELEASE_NOT_AUTHORISED',
      'TAX_STATUS_NOT_CONFIGURED',
      'LEGAL_ENTITY_NOT_CONFIGURED',
      'PROVIDER_UNAVAILABLE',
      'PAYMENT_SERVICE_UNAVAILABLE',
      'PAYMENT_PROVIDER_UNAVAILABLE',
    ].includes(readiness.code);
    const paymentServiceCodeIsSafe = [
      'READY',
      'PAYMENTS_DISABLED',
      'LIVE_RELEASE_NOT_AUTHORISED',
      'TAX_STATUS_NOT_CONFIGURED',
      'LEGAL_ENTITY_NOT_CONFIGURED',
      'PROVIDER_UNAVAILABLE',
      'UNAVAILABLE',
    ].includes(readiness.paymentServiceCode);
    const providerCodeIsSafe = [
      'READY',
      'PAYMENTS_DISABLED',
      'LIVE_RELEASE_NOT_AUTHORISED',
      'NOT_CHECKED',
      'UNAVAILABLE',
    ].includes(readiness.providerCode);
    const modeIsSafe = ['TEST', 'LIVE', 'FIXTURE', 'DISABLED', 'UNAVAILABLE']
      .includes(readiness.mode);
    if (!codeIsSafe || !paymentServiceCodeIsSafe || !providerCodeIsSafe || !modeIsSafe) {
      return false;
    }
    if (readiness.checkoutAvailable) {
      return readiness.code === 'READY'
        && readiness.mode === 'LIVE'
        && readiness.paymentServiceCode === 'READY'
        && readiness.providerCode === 'READY';
    }
    return readiness.code !== 'READY';
  }

  private transactionIsSafe(transaction: DocumentCreditTransaction): boolean {
    return transaction !== null
      && typeof transaction === 'object'
      && ORDER_ID.test(transaction.id)
      && DOCUMENT_CREDIT_TRANSACTION_TYPES.has(transaction.type)
      && Number.isInteger(transaction.documentCredits)
      && transaction.documentCredits >= 0
      && Number.isInteger(transaction.balanceBeforeDocumentCredits)
      && transaction.balanceBeforeDocumentCredits >= 0
      && Number.isInteger(transaction.balanceAfterDocumentCredits)
      && transaction.balanceAfterDocumentCredits >= 0
      && typeof transaction.operationId === 'string'
      && transaction.operationId.trim().length > 0
      && typeof transaction.description === 'string'
      && Number.isFinite(Date.parse(transaction.createdAt))
      && this.transactionBalanceChangeIsSafe(transaction);
  }

  private transactionBalanceChangeIsSafe(transaction: DocumentCreditTransaction): boolean {
    const before = transaction.balanceBeforeDocumentCredits;
    const after = transaction.balanceAfterDocumentCredits;
    const magnitude = transaction.documentCredits;
    switch (transaction.type) {
      case 'FREE_ALLOWANCE_GRANTED':
      case 'PURCHASE':
      case 'PROMOTION_BONUS':
      case 'DOCUMENT_RESERVATION_RELEASED':
        return after - before === magnitude;
      case 'DOCUMENT_RESERVED':
        return before - after === magnitude;
      case 'DOCUMENT_SPENT':
        return before === after;
      case 'REFUND_REVERSAL':
      case 'DISPUTE_REVERSAL':
        return after <= before && before - after <= magnitude;
      case 'ADJUSTMENT':
        return Math.abs(after - before) === magnitude;
    }
  }

  private checkoutResponseMatchesPlan(
    response: CheckoutResponse,
    plan: DocumentCreditPlan,
  ): boolean {
    if (!response
      || typeof response !== 'object'
      || typeof response.orderId !== 'string'
      || typeof response.checkoutSessionId !== 'string'
      || typeof response.url !== 'string'
      || typeof response.expiresAt !== 'string'
      || typeof response.consumerTermsVersion !== 'string'
      || typeof response.promotionGuaranteed !== 'boolean'
      || !response.pricingSnapshot
      || typeof response.pricingSnapshot !== 'object') return false;
    let url: URL;
    try {
      url = new URL(response.url);
    } catch {
      return false;
    }
    const catalog = this.catalog();
    const snapshot = response.pricingSnapshot;
    const expected = EXPECTED_PLANS[plan.id];
    const bonusIsSafe = Number.isInteger(response.promotionBonusDocumentCredits)
      && response.promotionBonusDocumentCredits >= 0
      && (response.promotionGuaranteed
        ? response.promotionBonusDocumentCredits === expected?.bonusCredits
        : response.promotionBonusDocumentCredits === 0);
    return catalog !== null
      && expected !== undefined
      && ORDER_ID.test(response.orderId)
      && response.checkoutSessionId.trim().length > 0
      && response.status === 'CHECKOUT_OPEN'
      && Number.isFinite(Date.parse(response.expiresAt))
      && Date.parse(response.expiresAt) > Date.now()
      && response.consumerAcknowledgementsRecorded === true
      && response.consumerTermsVersion === this.legalVersion()
      && bonusIsSafe
      && url.protocol === 'https:'
      && url.hostname === 'checkout.stripe.com'
      && snapshot.catalogVersion === catalog.catalogVersion
      && snapshot.pricingPlanId === plan.id
      && snapshot.pricingPlanName === plan.name
      && snapshot.documentCredits === plan.documentCredits
      && snapshot.priceMinor === plan.priceMinor
      && snapshot.currency === catalog.currency
      && snapshot.billingCountry === catalog.billingCountry
      && snapshot.taxStatus === catalog.taxStatus
      && snapshot.taxTreatment === catalog.taxTreatment
      && snapshot.legalEntityType !== 'NOT_CONFIGURED'
      && ['SOLE_TRADER', 'LIMITED_COMPANY'].includes(snapshot.legalEntityType)
      && typeof snapshot.legalEntityConfigurationVersion === 'string'
      && CONFIGURATION_VERSION.test(snapshot.legalEntityConfigurationVersion)
      && snapshot.displayedPriceIsCheckoutTotal === true;
  }

  private newIdempotencyKey(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    throw new Error('Secure checkout identifiers are unavailable in this browser.');
  }

  private signedTransactionAmount(transaction: DocumentCreditTransaction): number {
    const absolute = Math.abs(transaction.documentCredits);
    if (transaction.type === 'DOCUMENT_RESERVED'
      || transaction.type === 'REFUND_REVERSAL'
      || transaction.type === 'DISPUTE_REVERSAL') return -absolute;
    if (transaction.type === 'ADJUSTMENT') {
      return transaction.balanceAfterDocumentCredits < transaction.balanceBeforeDocumentCredits
        ? -absolute
        : absolute;
    }
    return absolute;
  }

  private defaultTransactionDescription(type: DocumentCreditTransaction['type']): string {
    switch (type) {
      case 'FREE_ALLOWANCE_GRANTED': return 'Free document credits added';
      case 'PURCHASE': return 'Document credits purchased';
      case 'PROMOTION_BONUS': return 'Founding offer bonus added';
      case 'DOCUMENT_RESERVED':
        return 'Document credit reserved while generation is running';
      case 'DOCUMENT_SPENT':
        return 'Delivered document completed from the reserved credit';
      case 'DOCUMENT_RESERVATION_RELEASED':
        return 'Document credit restored because generation did not complete';
      case 'REFUND_REVERSAL': return 'Credits reversed after a payment refund';
      case 'DISPUTE_REVERSAL': return 'Credits reversed after a payment dispute';
      case 'ADJUSTMENT': return 'Document-credit adjustment';
      default: return 'Document-credit activity';
    }
  }

  private errorCode(error: unknown): string | undefined {
    if (error instanceof PaymentCheckoutPreparationError) return error.code;
    if (!error || typeof error !== 'object' || !('error' in error)) return undefined;
    const body = (error as {error?: unknown}).error;
    if (!body || typeof body !== 'object') return undefined;
    const code = (body as {code?: unknown}).code;
    return typeof code === 'string' ? code : undefined;
  }

  private checkoutErrorMessage(code: string | undefined): string {
    switch (code) {
      case 'COUNTRY_NOT_SUPPORTED':
        return 'Purchases are currently available only to customers with a UK billing address.';
      case 'PLAN_NOT_AVAILABLE':
        return 'That pack is no longer available. Refresh pricing before choosing another pack.';
      case 'CHECKOUT_DISABLED':
      case 'PAYMENTS_DISABLED':
        return 'Purchasing is currently disabled. No payment has been requested.';
      case 'LIVE_RELEASE_NOT_AUTHORISED':
        return 'Purchasing has not been authorised for this release. No payment has been requested.';
      case 'TAX_STATUS_NOT_CONFIGURED':
        return 'Checkout is blocked until the seller tax status has completed release review. No payment has been requested.';
      case 'LEGAL_ENTITY_NOT_CONFIGURED':
        return 'Checkout is blocked until the seller identity has completed release review. No payment has been requested.';
      case 'PROVIDER_UNAVAILABLE':
      case 'PAYMENT_PROVIDER_UNAVAILABLE':
        return 'The payment provider is temporarily unavailable. No payment has been requested.';
      case 'PAYMENT_SERVICE_UNAVAILABLE':
        return 'The payment service is temporarily unavailable. No payment has been requested.';
      case 'PAYMENT_ACCESS_REVOKED':
        return 'Purchasing is unavailable for this account. No payment has been requested; contact support if you need help.';
      case 'PAYMENT_REVIEW_REQUIRED':
        return 'Purchasing is paused while your payment account is reviewed. No payment has been requested.';
      case 'CHECKOUT_PREFLIGHT_UNAVAILABLE':
        return 'Secure checkout could not be prepared. No payment has been requested; check your session and try again.';
      case 'CONSUMER_ACKNOWLEDGEMENTS_REQUIRED':
        return 'Checkout needs your immediate-supply and cancellation-right acknowledgement. Review the confirmation below before starting a new checkout.';
      case 'IDEMPOTENCY_KEY_REQUIRED':
      case 'IDEMPOTENCY_KEY_CONFLICT':
      case 'IDEMPOTENCY_KEY_INVALID':
        return 'A safe checkout could not be created. Refresh the page before trying a new purchase.';
      default:
        return 'We could not confirm whether checkout opened. Use “Retry checkout safely” to resume the same attempt without creating a duplicate order.';
    }
  }
}
