import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  PaymentService,
  TokenPricingPlanResponse,
  TransactionResponse,
  WalletSummaryResponse,
} from '../../services/payment.service';
import { formatGbpPence, pencePerTokenFromPlans, tokensToGbpPence } from '../../utils/ai-credit';

@Component({
  selector: 'app-payment-panel',
  standalone: true,
  imports: [CommonModule],
  host: {
    'data-demo-focus': 'app-payment-panel',
    '[attr.data-demo-focus-id]': 'demoFocusId()'
  },
  templateUrl: './payment-panel.html',
  styleUrls: ['./payment-panel.css'],
})
export class PaymentPanelComponent {
  userId = input<string>('');
  authToken = input<string>('');
  mode = input<'summary' | 'purchase' | 'history'>('purchase');
  balanceChanged = output<number>();

  demoFocusId(): string {
    if (this.mode() === 'history') return 'ai-credit-ledger';
    if (this.mode() === 'summary') return 'ai-credit-summary';
    return 'ai-credit-purchase';
  }

  private readonly paymentService = inject(PaymentService);
  wallet = signal<WalletSummaryResponse | null>(null);
  plans = signal<TokenPricingPlanResponse[]>([]);
  transactions = signal<TransactionResponse[]>([]);
  loading = signal(false);
  purchasingPlanId = signal<string | null>(null);
  checkoutPlanId = signal<string | null>(null);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  spentPercent = computed(() => {
    const wallet = this.wallet();
    const remaining = wallet?.balanceTokens ?? 0;
    const spent = wallet?.lifetimeSpentTokens ?? 0;
    const total = remaining + spent;
    return total > 0 ? Math.round((spent / total) * 100) : 0;
  });
  ringStyle = computed(() =>
    `conic-gradient(#2563eb 0 ${this.spentPercent()}%, #dbeafe ${this.spentPercent()}% 100%)`
  );
  creditPencePerToken = computed(() => pencePerTokenFromPlans(this.plans()));
  visibleTransactions = computed(() =>
    this.transactions().filter((transaction) =>
      transaction.transactionType !== 'RESERVATION' && transaction.transactionType !== 'RESERVATION_RELEASED'
    )
  );

  constructor() {
    effect(() => {
      const currentUserId = this.userId();
      const currentToken = this.authToken();
      if (currentUserId || currentToken) {
        this.load(currentUserId, currentToken);
      }
    });
  }

  refresh(): void {
    this.load(this.userId(), this.authToken());
  }

  purchase(plan: TokenPricingPlanResponse): void {
    if (!plan.id) return;
    this.purchasingPlanId.set(plan.id);
    this.error.set(null);
    this.success.set(null);
    this.paymentService.demoPurchase(this.userId(), plan.id, this.authToken()).subscribe({
      next: (response) => {
        if (response.wallet) {
          this.wallet.set(response.wallet);
          this.emitBalance(response.wallet);
        }
        this.success.set(`${plan.name ?? 'Plan'} demo purchase added ${this.formatCredit(plan.tokenAmount)} AI Credit.`);
        this.purchasingPlanId.set(null);
        this.loadTransactions(this.userId(), this.authToken());
      },
      error: (err: unknown) => {
        this.error.set(this.errorMessage(err));
        this.purchasingPlanId.set(null);
      },
    });
  }

  buyWithStripe(plan: TokenPricingPlanResponse): void {
    if (!plan.id) return;
    this.checkoutPlanId.set(plan.id);
    this.error.set(null);
    this.success.set(null);
    this.paymentService.checkout(this.userId(), plan.id, this.authToken()).subscribe({
      next: (response) => {
        if (response.checkoutUrl) {
          this.redirectToCheckout(response.checkoutUrl);
          return;
        }
        this.error.set('Stripe checkout is unavailable.');
        this.checkoutPlanId.set(null);
      },
      error: (err: unknown) => {
        this.error.set(this.errorMessage(err));
        this.checkoutPlanId.set(null);
      },
    });
  }

  redirectToCheckout(checkoutUrl: string): void {
    window.location.href = checkoutUrl;
  }

  formatTokens(value?: number): string {
    return (value ?? 0).toLocaleString();
  }

  formatPrice(pence?: number): string {
    const pounds = (pence ?? 0) / 100;
    return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
  }

  formatCredit(tokens?: number, options: { sign?: boolean } = {}): string {
    return formatGbpPence(tokensToGbpPence(tokens, this.creditPencePerToken()), options);
  }

  formatSignedTransactionCredit(transaction: TransactionResponse): string {
    return formatGbpPence(this.transactionCreditPence(transaction), { sign: true });
  }

  formatBalanceAfterCredit(transaction: TransactionResponse): string {
    return formatGbpPence(
      transaction.balanceAfterGbpPence ?? tokensToGbpPence(transaction.balanceAfter, this.creditPencePerToken()),
    );
  }

  formatTokenEquivalent(tokens?: number): string {
    return `≈ ${this.formatTokens(Math.abs(tokens ?? 0))} tokens`;
  }

  formatDate(value?: string): string {
    if (!value) return 'Date unknown';
    return new Date(value).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  planUsageSummary(plan: TokenPricingPlanResponse): string {
    switch (plan.id) {
      case 'starter':
        return 'Approx. 25-30 CV & cover letter generations';
      case 'standard':
        return 'Approx. 60-70 CV & cover letter generations';
      case 'power':
        return 'Approx. 140+ CV & cover letter generations';
      default:
        return 'AI-powered CV & cover letter generation credit';
    }
  }

  transactionActivity(transaction: TransactionResponse): string {
    if (transaction.userFacingDescription?.trim()) return transaction.userFacingDescription.trim();
    switch (transaction.transactionType) {
      case 'FREE_TRIAL_GRANTED':
        return 'Free starter AI Credit granted';
      case 'DEMO_PURCHASE':
        return 'Demo AI Credit purchase';
      case 'PURCHASE':
        return 'AI Credit purchased';
      case 'SPEND':
        return this.spendDescription(transaction);
      case 'REFUND':
        return 'AI Credit refunded';
      default:
        return transaction.description || 'AI Credit activity';
    }
  }

  private load(userId: string, token: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.paymentService.pricing().subscribe({
      next: (response) => this.plans.set(response.plans ?? []),
      error: (err: unknown) => this.error.set(this.errorMessage(err)),
    });
    this.paymentService.wallet(userId, token).subscribe({
      next: (wallet) => {
        this.wallet.set(wallet);
        this.emitBalance(wallet);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.errorMessage(err));
        this.loading.set(false);
      },
    });
    if (this.mode() === 'history') {
      this.loadTransactions(userId, token);
    }
  }

  private loadTransactions(userId: string, token: string): void {
    this.paymentService.transactions(userId, token).subscribe({
      next: (response) => this.transactions.set(response.transactions ?? []),
      error: (err: unknown) => this.error.set(this.errorMessage(err)),
    });
  }

  private emitBalance(wallet: WalletSummaryResponse): void {
    this.balanceChanged.emit(wallet.balanceTokens ?? 0);
  }

  private transactionCreditPence(transaction: TransactionResponse): number {
    if (typeof transaction.displayAmountGbpPence === 'number') return transaction.displayAmountGbpPence;
    const pence = tokensToGbpPence(transaction.tokenAmount, this.creditPencePerToken());
    return transaction.transactionType === 'SPEND' ? -pence : pence;
  }

  private spendDescription(transaction: TransactionResponse): string {
    const description = transaction.description?.trim();
    if (description && !description.includes('JOB_APPLICATION')) return this.titleCaseGeneration(description);
    return 'AI document generation';
  }

  private titleCaseGeneration(description: string): string {
    if (description.toLowerCase() === 'cv and cover letter generation') {
      return 'Generated CV & Cover Letter';
    }
    return description;
  }

  private errorMessage(error: unknown): string {
    if (typeof error !== 'object' || error === null || !('error' in error)) {
      return 'AI Credit data is unavailable.';
    }
    const body = (error as { error?: unknown }).error;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return 'AI Credit data is unavailable.';
  }
}
