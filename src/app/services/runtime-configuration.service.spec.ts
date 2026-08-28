import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {firstValueFrom} from 'rxjs';
import {
  isReviewedLegalConfiguration,
  normaliseFeedbackConfiguration,
  RuntimeConfigurationService,
  type PublicLegalConfiguration,
} from './runtime-configuration.service';

describe('reviewed legal runtime configuration', () => {
  const reviewed: PublicLegalConfiguration = {
    ready: true,
    status: 'REVIEWED',
    minimumUserAge: 18,
    legalEntityType: 'SOLE_TRADER',
    taxStatus: 'NOT_VAT_REGISTERED',
    effectiveDate: '2026-09-01',
    version: 'beta-1',
    controllerName: 'Northstar Career Services',
    tradingName: 'Job Seeker Copilot',
    businessAddress: '10 High Street, London, SW1A 1AA',
    privacyEmail: 'privacy@jobseekercopilot.com',
    supportEmail: 'support@jobseekercopilot.com',
    icoRegistrationStatus: 'NOT_REQUIRED_CONFIRMED',
    accountDeletionCompletionDays: 30,
    documentDeletionCompletionDays: 30,
    securityLogRetentionDays: 30,
    supportRecordRetentionDays: 365,
    financialRecordRetentionYears: 6,
  };

  it('accepts a complete reviewed configuration', () => {
    expect(isReviewedLegalConfiguration(reviewed)).toBe(true);
  });

  it('rejects impossible dates and identity placeholders', () => {
    expect(isReviewedLegalConfiguration({...reviewed, effectiveDate: '2026-09-31'}))
      .toBe(false);
    expect(isReviewedLegalConfiguration({...reviewed, controllerName: 'TBD'}))
      .toBe(false);
    expect(isReviewedLegalConfiguration({...reviewed, businessAddress: 'Address supplied at release'}))
      .toBe(false);
  });
});

describe('public feedback runtime configuration', () => {
  let http: HttpTestingController;
  let service: RuntimeConfigurationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(RuntimeConfigurationService);
  });

  afterEach(() => http.verify());

  it('loads the exact validated endpoint and build without credentials', async () => {
    const result = firstValueFrom(service.feedbackConfiguration());
    const request = http.expectOne('/api/runtime/feedback-configuration');
    expect(request.request.withCredentials).toBe(false);
    request.flush({
      enabled: true,
      submissionUrl: 'https://feedback.example.test/public/feedback',
      appBuild: 'client.2026-08-28.1',
    });
    await expect(result).resolves.toEqual({
      enabled: true,
      submissionUrl: 'https://feedback.example.test/public/feedback',
      appBuild: 'client.2026-08-28.1',
    });
  });

  it('fails closed for absent, inexact or unsafe values', () => {
    expect(normaliseFeedbackConfiguration({enabled: false})).toEqual({enabled: false});
    expect(normaliseFeedbackConfiguration({
      enabled: true,
      submissionUrl: 'http://feedback.example.test/public/feedback',
      appBuild: 'client.2026-08-28.1',
    })).toEqual({enabled: false});
    expect(normaliseFeedbackConfiguration({
      enabled: true,
      submissionUrl: 'https://feedback.example.test/public/feedback',
      appBuild: 'client.2026-08-28.1',
      unexpected: true,
    })).toEqual({enabled: false});
  });
});
