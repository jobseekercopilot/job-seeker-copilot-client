import {
  isIsoCalendarDate,
  isReviewedIdentityValue,
} from '../shared/release-configuration-validation';

export type JobSearchProviderMode =
  | 'FIXTURE'
  | 'REAL_PROVIDERS'
  | 'REQUIRED_VALIDATION';

export function jobSearchProviderMode(
  environment: NodeJS.ProcessEnv = process.env,
): JobSearchProviderMode {
  const configured = environment['JOB_SEARCH_PROVIDER_MODE']?.trim().toUpperCase();
  if (!configured) return 'FIXTURE';
  if (configured === 'FIXTURE') return configured;
  if (configured === 'REAL' || configured === 'REAL_PROVIDERS') {
    return 'REAL_PROVIDERS';
  }
  return 'REQUIRED_VALIDATION';
}

export type DocumentGenerationMode =
  | 'FIXTURE_LLM'
  | 'REAL_LLM'
  | 'REQUIRED_VALIDATION';

export function documentGenerationMode(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentGenerationMode {
  const configured = environment['DOCUMENT_GENERATION_MODE']
    ?.trim()
    .toUpperCase();
  if (configured === 'FIXTURE' || configured === 'FIXTURE_LLM') {
    return 'FIXTURE_LLM';
  }
  if (configured === 'LIVE' || configured === 'REAL' || configured === 'REAL_LLM') {
    return 'REAL_LLM';
  }
  return 'REQUIRED_VALIDATION';
}

export type CommuteRoutingMode =
  | 'DISTANCE_ONLY'
  | 'GOOGLE_ROUTES'
  | 'REQUIRED_VALIDATION';

export function commuteRoutingMode(
  environment: NodeJS.ProcessEnv = process.env,
): CommuteRoutingMode {
  const configured = environment['COMMUTE_ROUTING_MODE']?.trim().toUpperCase();
  if (!configured || configured === 'DISTANCE_ONLY') return 'DISTANCE_ONLY';
  if (configured === 'GOOGLE_ROUTES') return 'GOOGLE_ROUTES';
  return 'REQUIRED_VALIDATION';
}

export interface PublicLegalConfiguration {
  ready: boolean;
  status: 'DRAFT' | 'REVIEWED';
  minimumUserAge: 18;
  legalEntityType: 'NOT_CONFIGURED' | 'SOLE_TRADER' | 'LIMITED_COMPANY';
  taxStatus: 'NOT_CONFIGURED' | 'NOT_VAT_REGISTERED' | 'VAT_REGISTERED';
  effectiveDate?: string;
  version?: string;
  controllerName?: string;
  tradingName?: string;
  businessAddress?: string;
  privacyEmail?: string;
  supportEmail?: string;
  icoRegistrationStatus?: 'REGISTERED' | 'NOT_REQUIRED_CONFIRMED';
  icoRegistrationReference?: string;
  accountDeletionCompletionDays?: number;
  documentDeletionCompletionDays?: number;
  securityLogRetentionDays?: number;
  supportRecordRetentionDays?: number;
  financialRecordRetentionYears?: number;
}

export function publicLegalConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PublicLegalConfiguration {
  const effectiveDate = environment['LEGAL_EFFECTIVE_DATE']?.trim() ?? '';
  const version = environment['LEGAL_VERSION']?.trim() ?? '';
  const configuredLegalEntityType = environment['LEGAL_ENTITY_TYPE']?.trim().toUpperCase();
  const legalEntityType: PublicLegalConfiguration['legalEntityType'] =
    configuredLegalEntityType === 'SOLE_TRADER' || configuredLegalEntityType === 'LIMITED_COMPANY'
      ? configuredLegalEntityType
      : 'NOT_CONFIGURED';
  const configuredTaxStatus = environment['TAX_STATUS']?.trim().toUpperCase();
  const taxStatus: PublicLegalConfiguration['taxStatus'] =
    configuredTaxStatus === 'NOT_VAT_REGISTERED' || configuredTaxStatus === 'VAT_REGISTERED'
      ? configuredTaxStatus
      : 'NOT_CONFIGURED';
  const controllerName = environment['LEGAL_ENTITY_NAME']?.trim() ?? '';
  const tradingName = environment['TRADING_NAME']?.trim() ?? '';
  const businessAddress = environment['BUSINESS_ADDRESS']?.trim() ?? '';
  const privacyEmail = environment['PRIVACY_EMAIL']?.trim() ?? '';
  const supportEmail = environment['SUPPORT_EMAIL']?.trim() ?? '';
  const icoStatus = environment['ICO_REGISTRATION_STATUS']?.trim().toUpperCase();
  const icoReference = environment['ICO_REGISTRATION_REFERENCE']?.trim() ?? '';
  const accountDeletionCompletionDays = positiveInteger(environment['ACCOUNT_DELETION_COMPLETION_DAYS']);
  const documentDeletionCompletionDays = positiveInteger(environment['DOCUMENT_DELETION_COMPLETION_DAYS']);
  const securityLogRetentionDays = positiveInteger(environment['SECURITY_LOG_RETENTION_DAYS']);
  const supportRecordRetentionDays = positiveInteger(environment['SUPPORT_RECORD_RETENTION_DAYS']);
  const financialRecordRetentionYears = positiveInteger(environment['FINANCIAL_RECORD_RETENTION_YEARS']);
  const icoReady = icoStatus === 'NOT_REQUIRED_CONFIRMED'
    || (icoStatus === 'REGISTERED' && /^[A-Za-z0-9-]{4,40}$/.test(icoReference));
  const ready = environment['LEGAL_DOCUMENTS_REVIEWED'] === 'true'
    && (legalEntityType === 'SOLE_TRADER' || legalEntityType === 'LIMITED_COMPANY')
    && (taxStatus === 'NOT_VAT_REGISTERED' || taxStatus === 'VAT_REGISTERED')
    && isIsoCalendarDate(effectiveDate)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)
    && isReviewedIdentityValue(controllerName, 2)
    && isReviewedIdentityValue(tradingName, 2)
    && isReviewedIdentityValue(businessAddress, 8)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)
    && icoReady
    && accountDeletionCompletionDays !== undefined
    && documentDeletionCompletionDays !== undefined
    && securityLogRetentionDays !== undefined
    && supportRecordRetentionDays !== undefined
    && financialRecordRetentionYears !== undefined;
  if (!ready) return {
    ready: false,
    status: 'DRAFT',
    minimumUserAge: 18,
    legalEntityType: 'NOT_CONFIGURED',
    taxStatus: 'NOT_CONFIGURED',
  };
  return {
    ready: true,
    status: 'REVIEWED',
    minimumUserAge: 18,
    legalEntityType,
    taxStatus,
    effectiveDate,
    version,
    controllerName,
    tradingName,
    businessAddress,
    privacyEmail,
    supportEmail,
    icoRegistrationStatus: icoStatus,
    ...(icoReference ? {icoRegistrationReference: icoReference} : {}),
    accountDeletionCompletionDays,
    documentDeletionCompletionDays,
    securityLogRetentionDays,
    supportRecordRetentionDays,
    financialRecordRetentionYears,
  };
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 3650
    ? parsed
    : undefined;
}
