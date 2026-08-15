import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

function assertExactMembers(actual, expected, label) {
  const actualMembers = [...(actual ?? [])].sort();
  const expectedMembers = [...expected].sort();
  if (JSON.stringify(actualMembers) !== JSON.stringify(expectedMembers)) {
    throw new Error(`${label} must require exactly ${expectedMembers.join(', ')}`);
  }
}

function assertEnum(schema, expected, label) {
  assertExactMembers(schema?.enum, expected, `${label} enum`);
}

function schema(document, name) {
  const value = document.components?.schemas?.[name];
  if (!value) throw new Error(`payment-gateway is missing schema ${name}`);
  return value;
}

function operation(document, path, method, operationId) {
  const value = document.paths?.[path]?.[method];
  if (value?.operationId !== operationId) {
    throw new Error(
      `payment-gateway must preserve ${method.toUpperCase()} ${path} as ${operationId}`,
    );
  }
  const owner = value.parameters?.find(({name, in: location}) =>
    name === 'X-Payment-Owner' && location === 'header');
  if (owner?.required !== true) {
    throw new Error(`payment-gateway ${operationId} must require X-Payment-Owner`);
  }
  return value;
}

function assertResponse(operationValue, schemaName, label) {
  const reference = operationValue.responses?.['200']?.content?.['*/*']?.schema?.$ref;
  if (reference !== `#/components/schemas/${schemaName}`) {
    throw new Error(`${label} must return ${schemaName}`);
  }
}

function validatePaymentGatewayContract(document) {
  const catalogOperation = operation(
    document,
    '/api/v2/payments/catalog',
    'get',
    'getDocumentCreditCatalog',
  );
  const walletOperation = operation(
    document,
    '/api/v2/payments/wallet',
    'get',
    'getDocumentCreditWallet',
  );
  const transactionsOperation = operation(
    document,
    '/api/v2/payments/transactions',
    'get',
    'listDocumentCreditTransactions',
  );
  const readinessOperation = operation(
    document,
    '/api/v2/payments/checkout-readiness',
    'get',
    'getDocumentCreditCheckoutReadiness',
  );
  const checkoutOperation = operation(
    document,
    '/api/v2/payments/checkout',
    'post',
    'createDocumentCreditCheckout',
  );
  const orderOperation = operation(
    document,
    '/api/v2/payments/orders/{orderId}/status',
    'get',
    'getDocumentCreditOrderStatus',
  );

  assertResponse(catalogOperation, 'DocumentCreditCatalogResponse', 'catalog');
  assertResponse(walletOperation, 'DocumentCreditWalletResponse', 'wallet');
  assertResponse(
    transactionsOperation,
    'DocumentCreditTransactionsResponse',
    'transactions',
  );
  assertResponse(readinessOperation, 'CheckoutReadinessResponse', 'readiness');
  assertResponse(orderOperation, 'PaymentOrderStatusResponse', 'order status');

  const idempotencyKey = checkoutOperation.parameters?.find(
    ({name, in: location}) => name === 'Idempotency-Key' && location === 'header',
  );
  if (idempotencyKey?.required !== true) {
    throw new Error('payment-gateway checkout must require Idempotency-Key');
  }
  if (checkoutOperation.requestBody?.required !== true
      || checkoutOperation.requestBody.content?.['application/json']?.schema?.$ref
        !== '#/components/schemas/DocumentCreditCheckoutRequest'
      || checkoutOperation.responses?.['200']?.content?.['*/*']?.schema?.$ref
        !== '#/components/schemas/DocumentCreditCheckoutResponse') {
    throw new Error('payment-gateway checkout must preserve its request and response schemas');
  }
  for (const status of ['400', '409', '422', '502', '503']) {
    if (checkoutOperation.responses?.[status]?.content?.['application/json']?.schema?.$ref
        !== '#/components/schemas/PaymentGatewayErrorResponse') {
      throw new Error(`payment-gateway checkout ${status} must return PaymentGatewayErrorResponse`);
    }
  }

  const plan = schema(document, 'Plan');
  assertExactMembers(plan.required, [
    'active',
    'currency',
    'description',
    'documentCredits',
    'fullApplicationEquivalent',
    'id',
    'name',
    'priceMinor',
    'promotionBonusDocumentCredits',
    'sortOrder',
  ], 'Plan');
  assertEnum(plan.properties?.currency, ['GBP'], 'Plan.currency');

  const promotion = schema(document, 'Promotion');
  assertExactMembers(promotion.required, [
    'bonusPercent',
    'customerLimit',
    'enabled',
    'id',
    'status',
  ], 'Promotion');
  assertEnum(
    promotion.properties?.status,
    ['AVAILABLE', 'DISABLED', 'EXHAUSTED'],
    'Promotion.status',
  );

  const catalog = schema(document, 'DocumentCreditCatalogResponse');
  assertExactMembers(catalog.required, [
    'automaticRenewal',
    'billingCountry',
    'catalogVersion',
    'creditUnit',
    'currency',
    'displayedPriceIsCheckoutTotal',
    'freeAllowanceCredits',
    'plans',
    'promotion',
    'taxStatus',
    'taxTreatment',
  ], 'DocumentCreditCatalogResponse');
  assertEnum(catalog.properties?.currency, ['GBP'], 'catalog.currency');
  assertEnum(catalog.properties?.billingCountry, ['GB'], 'catalog.billingCountry');
  assertEnum(catalog.properties?.creditUnit, ['DOCUMENT'], 'catalog.creditUnit');

  const wallet = schema(document, 'DocumentCreditWalletResponse');
  assertExactMembers(wallet.required, [
    'balanceDocumentCredits',
    'freeAllowanceGranted',
    'lifetimePurchasedDocumentCredits',
    'lifetimeReversedDocumentCredits',
    'lifetimeSpentDocumentCredits',
    'reviewDebtDocumentCredits',
    'status',
  ], 'DocumentCreditWalletResponse');
  assertEnum(
    wallet.properties?.status,
    ['ACTIVE', 'BLOCKED_REVIEW', 'REVOKED'],
    'wallet.status',
  );

  const transaction = schema(document, 'Transaction');
  assertExactMembers(transaction.required, [
    'balanceAfterDocumentCredits',
    'balanceBeforeDocumentCredits',
    'createdAt',
    'description',
    'documentCredits',
    'id',
    'operationId',
    'type',
  ], 'Transaction');
  assertEnum(transaction.properties?.type, [
    'ADJUSTMENT',
    'DISPUTE_REVERSAL',
    'DOCUMENT_RESERVED',
    'DOCUMENT_RESERVATION_RELEASED',
    'DOCUMENT_SPENT',
    'FREE_ALLOWANCE_GRANTED',
    'PROMOTION_BONUS',
    'PURCHASE',
    'REFUND_REVERSAL',
  ], 'Transaction.type');
  assertExactMembers(
    schema(document, 'DocumentCreditTransactionsResponse').required,
    ['transactions'],
    'DocumentCreditTransactionsResponse',
  );

  const readiness = schema(document, 'CheckoutReadinessResponse');
  assertExactMembers(readiness.required, [
    'checkoutAvailable',
    'code',
    'mode',
    'paymentServiceCode',
    'providerCode',
  ], 'CheckoutReadinessResponse');
  assertEnum(readiness.properties?.code, [
    'LEGAL_ENTITY_NOT_CONFIGURED',
    'LIVE_RELEASE_NOT_AUTHORISED',
    'PAYMENTS_DISABLED',
    'PAYMENT_PROVIDER_UNAVAILABLE',
    'PAYMENT_SERVICE_UNAVAILABLE',
    'PROVIDER_UNAVAILABLE',
    'READY',
    'TAX_STATUS_NOT_CONFIGURED',
  ], 'readiness.code');
  assertEnum(
    readiness.properties?.paymentServiceCode,
    [
      'LEGAL_ENTITY_NOT_CONFIGURED',
      'LIVE_RELEASE_NOT_AUTHORISED',
      'PAYMENTS_DISABLED',
      'PROVIDER_UNAVAILABLE',
      'READY',
      'TAX_STATUS_NOT_CONFIGURED',
      'UNAVAILABLE',
    ],
    'readiness.paymentServiceCode',
  );
  assertEnum(
    readiness.properties?.providerCode,
    ['LIVE_RELEASE_NOT_AUTHORISED', 'NOT_CHECKED', 'PAYMENTS_DISABLED', 'READY', 'UNAVAILABLE'],
    'readiness.providerCode',
  );
  assertEnum(
    readiness.properties?.mode,
    ['DISABLED', 'FIXTURE', 'LIVE', 'TEST', 'UNAVAILABLE'],
    'readiness.mode',
  );

  const checkoutRequest = schema(document, 'DocumentCreditCheckoutRequest');
  assertExactMembers(checkoutRequest.required, [
    'billingCountry',
    'cancellationRightLossAcknowledged',
    'immediateSupplyRequested',
    'pricingPlanId',
  ], 'DocumentCreditCheckoutRequest');
  if (checkoutRequest.properties?.billingCountry?.pattern !== 'GB') {
    throw new Error('checkout billingCountry must remain GB');
  }
  assertEnum(
    checkoutRequest.properties?.immediateSupplyRequested,
    [true],
    'checkout immediateSupplyRequested',
  );
  assertEnum(
    checkoutRequest.properties?.cancellationRightLossAcknowledged,
    [true],
    'checkout cancellationRightLossAcknowledged',
  );

  const checkoutResponse = schema(document, 'DocumentCreditCheckoutResponse');
  assertExactMembers(checkoutResponse.required, [
    'checkoutSessionId',
    'consumerAcknowledgementsRecorded',
    'consumerTermsVersion',
    'expiresAt',
    'orderId',
    'pricingSnapshot',
    'promotionBonusDocumentCredits',
    'promotionGuaranteed',
    'status',
    'url',
  ], 'DocumentCreditCheckoutResponse');
  assertEnum(checkoutResponse.properties?.status, ['CHECKOUT_OPEN'], 'checkout status');

  const pricingSnapshot = schema(document, 'PricingSnapshot');
  assertExactMembers(pricingSnapshot.required, [
    'billingCountry',
    'catalogVersion',
    'currency',
    'displayedPriceIsCheckoutTotal',
    'documentCredits',
    'legalEntityConfigurationVersion',
    'legalEntityType',
    'priceMinor',
    'pricingPlanId',
    'pricingPlanName',
    'taxStatus',
    'taxTreatment',
  ], 'PricingSnapshot');

  const orderStatus = schema(document, 'PaymentOrderStatusResponse');
  assertExactMembers(orderStatus.required, [
    'createdAt',
    'creditsAdded',
    'currency',
    'documentCredits',
    'expiresAt',
    'legalEntityConfigurationVersion',
    'legalEntityType',
    'messageCode',
    'orderId',
    'priceMinor',
    'pricingPlanId',
    'promotionBonusDocumentCredits',
    'status',
    'taxStatus',
    'taxTreatment',
    'totalGrantedDocumentCredits',
  ], 'PaymentOrderStatusResponse');
  assertEnum(orderStatus.properties?.status, [
    'CANCELLED',
    'CHECKOUT_OPEN',
    'DISPUTED',
    'EXPIRED',
    'FULFILLED',
    'MANUAL_REVIEW',
    'PARTIALLY_REFUNDED',
    'PENDING_CHECKOUT',
    'REFUNDED',
  ], 'order status');
  assertEnum(orderStatus.properties?.messageCode, [
    'CHECKOUT_CANCELLED',
    'CHECKOUT_EXPIRED',
    'CREDITS_ADDED',
    'PAYMENT_DISPUTED',
    'PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_PENDING',
    'PAYMENT_REFUNDED',
    'PAYMENT_REVIEW_REQUIRED',
  ], 'order messageCode');

  for (const value of [catalog, pricingSnapshot, orderStatus]) {
    assertEnum(
      value.properties?.taxStatus,
      ['NOT_CONFIGURED', 'NOT_VAT_REGISTERED', 'VAT_REGISTERED'],
      'taxStatus',
    );
    assertEnum(
      value.properties?.taxTreatment,
      ['VAT_INCLUDED', 'VAT_NOT_CHARGED'],
      'taxTreatment',
    );
  }
  for (const value of [pricingSnapshot, orderStatus]) {
    assertEnum(
      value.properties?.legalEntityType,
      ['LIMITED_COMPANY', 'NOT_CONFIGURED', 'SOLE_TRADER'],
      'legalEntityType',
    );
  }

  assertExactMembers(
    schema(document, 'PaymentGatewayErrorResponse').required,
    ['code', 'error', 'message'],
    'PaymentGatewayErrorResponse',
  );
}

export async function verifyManualBoundaryContracts(rootDir = defaultRoot) {
  const lockPath = resolve(rootDir, 'contracts/manual-boundaries.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));

  if (lock.schemaVersion !== 1 || !Array.isArray(lock.contracts) || lock.contracts.length === 0) {
    throw new Error(
      'manual-boundaries.lock.json must contain at least one schemaVersion 1 contract',
    );
  }

  const contractIds = new Set();
  for (const contract of lock.contracts) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(contract.id ?? '')
        || contractIds.has(contract.id)
        || contract.boundaryType !== 'manual_boundary'
        || contract.generatedClient !== false
        || !/^\d+\.\d+\.\d+$/.test(contract.version ?? '')
        || !/^jobseekercopilot\/[a-z0-9][a-z0-9.-]*$/.test(contract.sourceRepository ?? '')
        || !/^[a-f0-9]{40}$/.test(contract.sourceCommit ?? '')
        || !/^contracts\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.json$/.test(contract.path ?? '')
        || !/^[a-f0-9]{64}$/.test(contract.sha256 ?? '')
        || !Array.isArray(contract.requiredPaths)
        || contract.requiredPaths.length === 0
        || new Set(contract.requiredPaths).size !== contract.requiredPaths.length
        || contract.requiredPaths.some(path => typeof path !== 'string' || !path.startsWith('/'))) {
      throw new Error(
        `${contract.id ?? 'unknown contract'} must pin a unique manual_boundary ID, non-generated producer revision, path, required paths and SHA-256`,
      );
    }
    contractIds.add(contract.id);

    const contents = await readFile(resolve(rootDir, contract.path));
    const actualHash = sha256(contents);
    if (actualHash !== contract.sha256) {
      throw new Error(
        `${contract.id} checksum mismatch: expected ${contract.sha256}, got ${actualHash}`,
      );
    }

    const document = JSON.parse(contents.toString('utf8'));
    if (document.info?.version !== contract.version) {
      throw new Error(
        `${contract.id} version mismatch: expected ${contract.version}, got ${document.info?.version ?? 'missing'}`,
      );
    }
    for (const requiredPath of contract.requiredPaths) {
      if (!document.paths?.[requiredPath]) {
        throw new Error(`${contract.id} is missing required path ${requiredPath}`);
      }
    }
    if (contract.id === 'payment-gateway') validatePaymentGatewayContract(document);
  }

  return lock;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyManualBoundaryContracts()
    .then((lock) => console.log(
      `Verified ${lock.contracts.length} pinned manual-boundary OpenAPI contracts.`,
    ))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
