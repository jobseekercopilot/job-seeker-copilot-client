import {HttpClient} from '@angular/common/http';
import {inject, Injectable} from '@angular/core';
import {map, Observable} from 'rxjs';
import {
  normalisePublicAppReleaseId,
  normalisePublicFeedbackApiUrl,
} from '../../shared/feedback-configuration';
import {
  isIsoCalendarDate,
  isReviewedIdentityValue,
} from '../../shared/release-configuration-validation';

export type JobSearchProviderMode =
  | 'FIXTURE'
  | 'REAL_PROVIDERS'
  | 'REQUIRED_VALIDATION';

interface JobSearchModeResponse {
  mode: JobSearchProviderMode;
}

export type DocumentGenerationMode =
  | 'FIXTURE_LLM'
  | 'REAL_LLM'
  | 'REQUIRED_VALIDATION';

interface DocumentGenerationModeResponse {
  mode: DocumentGenerationMode;
}

export type CommuteRoutingMode =
  | 'DISTANCE_ONLY'
  | 'GOOGLE_ROUTES'
  | 'REQUIRED_VALIDATION';

interface CommuteRoutingModeResponse {
  mode: CommuteRoutingMode;
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

export const DRAFT_LEGAL_CONFIGURATION: PublicLegalConfiguration = {
  ready: false,
  status: 'DRAFT',
  minimumUserAge: 18,
  legalEntityType: 'NOT_CONFIGURED',
  taxStatus: 'NOT_CONFIGURED',
};

export type PublicFeedbackConfiguration =
  | {enabled: false}
  | {enabled: true; submissionUrl: string; appBuild: string};

export const DISABLED_FEEDBACK_CONFIGURATION: PublicFeedbackConfiguration = {
  enabled: false,
};

export function normaliseFeedbackConfiguration(
  value: unknown,
): PublicFeedbackConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DISABLED_FEEDBACK_CONFIGURATION;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['enabled'] === false && Object.keys(candidate).length === 1) {
    return DISABLED_FEEDBACK_CONFIGURATION;
  }
  const submissionUrl = normalisePublicFeedbackApiUrl(candidate['submissionUrl']);
  const appBuild = normalisePublicAppReleaseId(candidate['appBuild']);
  if (
    candidate['enabled'] !== true
    || Object.keys(candidate).sort().join(',') !== 'appBuild,enabled,submissionUrl'
    || !submissionUrl
    || submissionUrl !== candidate['submissionUrl']
    || !appBuild
  ) {
    return DISABLED_FEEDBACK_CONFIGURATION;
  }
  return {enabled: true, submissionUrl, appBuild};
}

export function isReviewedLegalConfiguration(
  value: PublicLegalConfiguration,
): boolean {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const positiveInteger = (item: unknown) =>
    Number.isInteger(item) && Number(item) > 0;
  return value.ready === true
    && value.status === 'REVIEWED'
    && value.minimumUserAge === 18
    && ['SOLE_TRADER', 'LIMITED_COMPANY'].includes(value.legalEntityType)
    && ['NOT_VAT_REGISTERED', 'VAT_REGISTERED'].includes(value.taxStatus)
    && isIsoCalendarDate(value.effectiveDate ?? '')
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.version ?? '')
    && isReviewedIdentityValue(value.controllerName ?? '', 2)
    && isReviewedIdentityValue(value.tradingName ?? '', 2)
    && isReviewedIdentityValue(value.businessAddress ?? '', 8)
    && email.test(value.privacyEmail ?? '')
    && email.test(value.supportEmail ?? '')
    && (value.icoRegistrationStatus === 'NOT_REQUIRED_CONFIRMED'
      || (value.icoRegistrationStatus === 'REGISTERED'
        && /^[A-Za-z0-9-]{4,40}$/.test(value.icoRegistrationReference ?? '')))
    && [
      value.accountDeletionCompletionDays,
      value.documentDeletionCompletionDays,
      value.securityLogRetentionDays,
      value.supportRecordRetentionDays,
      value.financialRecordRetentionYears,
    ].every(positiveInteger);
}

@Injectable({providedIn: 'root'})
export class RuntimeConfigurationService {
  private readonly http = inject(HttpClient);

  jobSearchMode(): Observable<JobSearchModeResponse> {
    return this.http.get<JobSearchModeResponse>(
      '/api/runtime/job-search-mode',
      {withCredentials: true},
    );
  }

  documentGenerationMode(): Observable<DocumentGenerationModeResponse> {
    return this.http.get<DocumentGenerationModeResponse>(
      '/api/runtime/document-generation-mode',
      {withCredentials: true},
    );
  }

  commuteRoutingMode(): Observable<CommuteRoutingModeResponse> {
    return this.http.get<CommuteRoutingModeResponse>(
      '/api/runtime/commute-routing-mode',
      {withCredentials: true},
    );
  }

  legalConfiguration(): Observable<PublicLegalConfiguration> {
    return this.http.get<PublicLegalConfiguration>(
      '/api/runtime/legal-configuration',
      {withCredentials: true},
    );
  }

  feedbackConfiguration(): Observable<PublicFeedbackConfiguration> {
    return this.http.get<unknown>(
      '/api/runtime/feedback-configuration',
      {withCredentials: false},
    ).pipe(map(normaliseFeedbackConfiguration));
  }
}
