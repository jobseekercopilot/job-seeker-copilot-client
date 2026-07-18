import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface WalletSummaryResponse {
  userId?: string;
  balanceTokens?: number;
  balanceGbpPence?: number;
  lifetimePurchasedTokens?: number;
  lifetimeSpentTokens?: number;
  lifetimeSpentGbpPence?: number;
  lifetimeRefundedTokens?: number;
  freeTrialGranted?: boolean;
}

export interface TransactionResponse {
  id?: string;
  transactionType?: string;
  tokenAmount?: number;
  displayAmountGbpPence?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  balanceAfterGbpPence?: number;
  description?: string;
  userFacingDescription?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt?: string;
}

export interface TransactionsResponse {
  userId?: string;
  transactions?: TransactionResponse[];
}

export interface TokenPricingPlanResponse {
  id?: string;
  name?: string;
  description?: string;
  tokenAmount?: number;
  priceGbpPence?: number;
}

export interface PricingPlansResponse {
  plans?: TokenPricingPlanResponse[];
}

export interface DemoPurchaseResponse {
  wallet?: WalletSummaryResponse;
  transaction?: TransactionResponse;
}

export interface CheckoutResponse {
  sessionId?: string;
  checkoutUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);

  wallet(userId: string, token = ''): Observable<WalletSummaryResponse> {
    return this.http.get<WalletSummaryResponse>('/api/v1/payment/wallet', {
      headers: this.headers(userId, token),
    });
  }

  transactions(userId: string, token = '', limit = 20): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>(`/api/v1/payment/transactions?limit=${limit}`, {
      headers: this.headers(userId, token),
    });
  }

  pricing(): Observable<PricingPlansResponse> {
    return this.http.get<PricingPlansResponse>('/api/v1/payment/pricing');
  }

  demoPurchase(userId: string, pricingPlanId: string, token = ''): Observable<DemoPurchaseResponse> {
    return this.http.post<DemoPurchaseResponse>(
      '/api/v1/payment/demo-purchase',
      { pricingPlanId },
      { headers: this.headers(userId, token) },
    );
  }

  checkout(userId: string, pricingPlanId: string, token = ''): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(
      '/api/v1/payment/checkout',
      { pricingPlanId },
      { headers: this.headers(userId, token) },
    );
  }

  private headers(userId: string, token: string): HttpHeaders {
    let headers = new HttpHeaders();
    if (userId) {
      headers = headers.set('X-User-Id', userId);
    }
    if (token) {
      headers = headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
    }
    return headers;
  }
}
