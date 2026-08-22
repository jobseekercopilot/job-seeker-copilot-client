import {HttpClient, HttpHeaders} from '@angular/common/http';
import {Injectable, inject} from '@angular/core';
import {catchError, Observable, switchMap, throwError} from 'rxjs';
import {BrowserSessionService} from './browser-session.service';

export class PaymentCheckoutPreparationError extends Error {
  readonly code = 'CHECKOUT_PREFLIGHT_UNAVAILABLE';

  constructor() {
    super('Secure checkout preparation failed');
    this.name = 'PaymentCheckoutPreparationError';
  }
}

export type CheckoutReadinessCode =
  | 'READY'
  | 'PAYMENTS_DISABLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'LIVE_RELEASE_NOT_AUTHORISED'
  | 'TAX_STATUS_NOT_CONFIGURED'
  | 'LEGAL_ENTITY_NOT_CONFIGURED'
  | 'PAYMENT_SERVICE_UNAVAILABLE'
  | 'PAYMENT_PROVIDER_UNAVAILABLE';
export type CheckoutReadinessMode = 'TEST' | 'LIVE' | 'FIXTURE' | 'DISABLED' | 'UNAVAILABLE';
export type PaymentServiceReadinessCode =
  | 'READY'
  | 'PAYMENTS_DISABLED'
  | 'LIVE_RELEASE_NOT_AUTHORISED'
  | 'TAX_STATUS_NOT_CONFIGURED'
  | 'LEGAL_ENTITY_NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNAVAILABLE';
export type PaymentProviderReadinessCode =
  | 'READY'
  | 'PAYMENTS_DISABLED'
  | 'LIVE_RELEASE_NOT_AUTHORISED'
  | 'NOT_CHECKED'
  | 'UNAVAILABLE';

export type PromotionStatus = 'AVAILABLE' | 'EXHAUSTED' | 'DISABLED';
export type TaxTreatment = 'VAT_NOT_CHARGED' | 'VAT_INCLUDED';
export type TaxStatus = 'NOT_CONFIGURED' | 'NOT_VAT_REGISTERED' | 'VAT_REGISTERED';
export type LegalEntityType = 'NOT_CONFIGURED' | 'SOLE_TRADER' | 'LIMITED_COMPANY';

export interface DocumentCreditPlan {
  id: string;
  name: string;
  description: string;
  documentGenerations: number;
  priceMinor: number;
  currency: 'GBP';
  fullApplicationEquivalent: number;
  promotionBonusDocumentGenerations: number;
  active: boolean;
  sortOrder: number;
}

export interface PaymentPromotion {
  id: string;
  enabled: boolean;
  status: PromotionStatus;
  bonusPercent: number;
  customerLimit: number;
}

export interface PaymentCatalogResponse {
  catalogVersion: string;
  currency: 'GBP';
  billingCountry: 'GB';
  automaticRenewal: false;
  generationUnit: 'DOCUMENT';
  freeAllowanceGenerations: number;
  plans: DocumentCreditPlan[];
  promotion: PaymentPromotion;
  taxStatus: TaxStatus;
  taxTreatment: TaxTreatment;
  displayedPriceIsCheckoutTotal: boolean;
}

export interface DocumentCreditWalletResponse {
  remainingDocumentGenerations: number;
  lifetimePurchasedDocumentGenerations: number;
  lifetimeUsedDocumentGenerations: number;
  lifetimeReversedDocumentGenerations: number;
  reviewDebtDocumentGenerations: number;
  freeAllowanceGranted: boolean;
  status: 'ACTIVE' | 'BLOCKED_REVIEW' | 'REVOKED';
}

export type DocumentCreditTransactionType =
  | 'FREE_ALLOWANCE_GRANTED'
  | 'PURCHASE'
  | 'PROMOTION_BONUS'
  | 'DOCUMENT_RESERVED'
  | 'DOCUMENT_SPENT'
  | 'DOCUMENT_RESERVATION_RELEASED'
  | 'REFUND_REVERSAL'
  | 'DISPUTE_REVERSAL'
  | 'ADJUSTMENT';

export interface DocumentCreditTransaction {
  id: string;
  type: DocumentCreditTransactionType;
  documentGenerations: number;
  balanceBeforeDocumentGenerations: number;
  balanceAfterDocumentGenerations: number;
  operationId: string;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
}

export interface DocumentCreditTransactionsResponse {
  transactions: DocumentCreditTransaction[];
}

export interface CheckoutReadinessResponse {
  checkoutAvailable: boolean;
  code: CheckoutReadinessCode;
  mode: CheckoutReadinessMode;
  paymentServiceCode: PaymentServiceReadinessCode;
  providerCode: PaymentProviderReadinessCode;
}

export interface CheckoutPricingSnapshot {
  catalogVersion: string;
  pricingPlanId: string;
  pricingPlanName: string;
  documentGenerations: number;
  priceMinor: number;
  currency: 'GBP';
  billingCountry: 'GB';
  taxStatus: TaxStatus;
  taxTreatment: TaxTreatment;
  legalEntityType: LegalEntityType;
  legalEntityConfigurationVersion: string;
  displayedPriceIsCheckoutTotal: boolean;
}

export interface CheckoutResponse {
  orderId: string;
  checkoutSessionId: string;
  url: string;
  status: 'CHECKOUT_OPEN';
  expiresAt: string;
  pricingSnapshot: CheckoutPricingSnapshot;
  promotionBonusDocumentGenerations: number;
  promotionGuaranteed: boolean;
  consumerTermsVersion: string;
  consumerAcknowledgementsRecorded: boolean;
}

export type PaymentOrderStatus =
  | 'PENDING_CHECKOUT'
  | 'CHECKOUT_OPEN'
  | 'FULFILLED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'DISPUTED'
  | 'MANUAL_REVIEW';

export type PaymentOrderMessageCode =
  | 'PAYMENT_PENDING'
  | 'GENERATIONS_ADDED'
  | 'CHECKOUT_EXPIRED'
  | 'CHECKOUT_CANCELLED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_DISPUTED'
  | 'PAYMENT_REVIEW_REQUIRED';

export interface PaymentOrderStatusResponse {
  orderId: string;
  status: PaymentOrderStatus;
  pricingPlanId: string;
  documentGenerations: number;
  promotionBonusDocumentGenerations: number;
  totalGrantedDocumentGenerations: number;
  priceMinor: number;
  currency: 'GBP';
  createdAt: string;
  expiresAt: string;
  fulfilledAt?: string | null;
  generationsAdded: boolean;
  messageCode: PaymentOrderMessageCode;
  taxStatus: TaxStatus;
  taxTreatment: TaxTreatment;
  legalEntityType: LegalEntityType;
  legalEntityConfigurationVersion: string;
}

@Injectable({providedIn: 'root'})
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly browserSession = inject(BrowserSessionService);

  catalog(): Observable<PaymentCatalogResponse> {
    return this.http.get<PaymentCatalogResponse>('/api/v2/payments/catalog');
  }

  wallet(): Observable<DocumentCreditWalletResponse> {
    return this.http.get<DocumentCreditWalletResponse>('/api/v2/payments/wallet');
  }

  transactions(limit = 20): Observable<DocumentCreditTransactionsResponse> {
    return this.http.get<DocumentCreditTransactionsResponse>(
      `/api/v2/payments/transactions?limit=${limit}`,
    );
  }

  checkoutReadiness(): Observable<CheckoutReadinessResponse> {
    return this.http.get<CheckoutReadinessResponse>(
      '/api/v2/payments/checkout-readiness',
    );
  }

  checkout(pricingPlanId: string, idempotencyKey: string): Observable<CheckoutResponse> {
    return this.browserSession.ensureCsrf().pipe(
      catchError(() => throwError(() => new PaymentCheckoutPreparationError())),
      switchMap(() => this.http.post<CheckoutResponse>(
        '/api/v2/payments/checkout',
        {
          pricingPlanId,
          billingCountry: 'GB',
          immediateSupplyRequested: true,
          cancellationRightLossAcknowledged: true,
        },
        {headers: new HttpHeaders({'Idempotency-Key': idempotencyKey})},
      )),
    );
  }

  orderStatus(orderId: string): Observable<PaymentOrderStatusResponse> {
    return this.http.get<PaymentOrderStatusResponse>(
      `/api/v2/payments/orders/${encodeURIComponent(orderId)}/status`,
    );
  }
}
